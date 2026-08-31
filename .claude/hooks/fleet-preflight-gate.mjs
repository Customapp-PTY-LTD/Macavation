#!/usr/bin/env node
// FLEET PRE-FLIGHT GATE - a Claude Code PreToolUse hook matching ExitPlanMode. Runs the fleet's
// real plan-review gate (via the agent-fleet toolkit's scripts/preflight-review.sh --json - same
// model, same prompt, same checks the live gate runs) against a plan the moment it is about to be
// finalized, so a flagged plan is fixed before a human ever sees "should I push this" - not after
// a paid round trip through the real pipeline. Installed by agent-fleet's scripts/onboard-repo.sh
// (this file is the SOURCE at agent-fleet/templates/fleet-preflight-gate.mjs; onboarding copies it
// to THIS repo's .claude/hooks/fleet-preflight-gate.mjs and wires a PreToolUse entry into this
// repo's COMMITTED .claude/settings.json).
//
// CLIENT-SIDE, BEST-EFFORT, BYPASSABLE - NOT A SECURITY BOUNDARY. This runs on a developer's own
// machine, outside any CI sandbox, and can always be skipped: hand-edit the plan and push
// directly, decline Claude Code's workspace-trust prompt for this repo, or delete this file. The
// real security boundary is the server-side plan-review/diff-review gates in agent-fleet's own
// run-plan.yml, which this cannot weaken and does not touch. This is an ADOPTION aid: on the
// common path it catches most of what would otherwise be a paid, multi-minute block, before the
// human ever sees the plan as "ready."
//
// INJECTION HARDENING - required, not optional, because this runs against content this codebase
// already treats as untrusted everywhere else (the plan text, the checkout, the gate's own
// findings text quoting repo content):
//   - stdin is parsed with JSON.parse only, via parseHookInput() - never grep/sed/regex-scraping.
//   - the plan's content is read from the tool_input payload when present (authoritative) -
//     directory-scanning .cursor/plans/ is only a fallback for a payload shape this hasn't seen.
//   - the preflight check is invoked via execFile with an argv ARRAY - never a shell string, so
//     nothing in the plan, a file path, or a findings string can be interpreted by a shell.
//   - this hook's own stdout is built with JSON.stringify only, via buildHookResponse() - never
//     string concatenation - so a findings string (which quotes repo content) can never break
//     this hook's own output structure.
//   - a fallback-scanned plan path is validated to resolve UNDER .cursor/plans/ before being read
//     (isPathUnderPlansDir) - untrusted input is data, never a trusted location.
//
// FAIL OPEN, VISIBLY. Anything that goes wrong that ISN'T a real BLOCK verdict from the gate - no
// AGENT_FLEET_TOOLKIT_PATH configured (and no checkout found at the documented default location
// either), no ANTHROPIC_API_KEY, a network blip, the script missing - allows the exit, and always
// writes a warning to stderr. stderr is NOT a reliable channel, though - Claude Code does not
// guarantee a hook's stderr reaches the developer, and this already caused at least one real
// missed block (see docs/fleet-user-guide.md's "One-time setup" section). So the SAME short
// reason is now ALSO embedded directly in this hook's JSON response (permissionDecisionReason) -
// the one channel Claude Code's own hook protocol does guarantee carries through - never just
// "see stderr". Silent zero enforcement - a developer believing this is protecting them when it
// quietly never runs - would be a worse failure than a loud one.
//
// CACHE CORRECTNESS - replays a VERDICT, never silently skips past a BLOCK. A cache hit on a prior
// BLOCK re-denies with the cached findings at zero cost; only a hit on a prior PASS allows the
// exit. The key covers plan content AND repo state (git HEAD + a hash of the working-tree diff),
// never plan content alone - a stale PASS must not survive a pull or a local code edit the plan's
// claims depended on. See computeCacheKey/decideFromCache.
//
// EXPLICIT HUMAN OVERRIDE: setting FLEET_PREFLIGHT_SKIP=1 allows the exit immediately, with a
// visible note that the check was skipped by explicit request - never a silent, undocumented
// bypass a developer could stumble into by accident.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
// This hook lives at <target-repo>/.claude/hooks/fleet-preflight-gate.mjs.
export const REPO_ROOT = resolve(HERE, "..", "..");
export const PLANS_DIR = resolve(REPO_ROOT, ".cursor", "plans");
const CACHE_FILE = resolve(REPO_ROOT, ".claude", "hooks", ".fleet-preflight-cache.json");
const CACHE_MAX_ENTRIES = 50; // small bound - this is a dev-machine convenience cache, not a database

const OVERRIDE_ENV = "FLEET_PREFLIGHT_SKIP";
const TOOLKIT_ENV = "AGENT_FLEET_TOOLKIT_PATH";

// ------------------------------------------------------------------------------------------------
// PURE / UNIT-TESTABLE - no filesystem, no child process, no network. See
// runner/fleet-preflight-gate.test.ts.
// ------------------------------------------------------------------------------------------------

/**
 * A plan is "fleet-bound" - worth the cost of a real gate call - if it carries a fleet-recognizable
 * frontmatter key (engine/model/notify/depends_on/preview_path/retry_of), lives under the path both
 * submit templates teach (.cursor/plans/), OR its own BODY describes submitting itself there.
 *
 * That third check exists because real usage looks nothing like the first two. Frontmatter is
 * explicitly optional by design (CLAUDE.md's "Plan format": "A plan with no frontmatter at all is
 * the normal case, not a degraded one"), and a native ExitPlanMode call only ever carries the
 * plan's TEXT (ExitPlanMode's tool_input shape is `{plan: string}`, no path field at all) - so
 * frontmatter/path detection can never fire for the single most common real path: a developer
 * says "submit this to the fleet," Claude Code drafts an ordinary plan with its own "## Fleet
 * submission" section spelling out "copy this file into `.cursor/plans/...`" and "push to
 * `dev-agent`" - and never mentions frontmatter at all. Confirmed missed live (2026-08-13): a
 * real plan drafted exactly that way, with an explicit fleet-submission section, was not
 * recognized and the toolkit check was skipped entirely.
 *
 * Anything that matches none of the three is an ordinary Claude Code plan never destined for
 * dev-agent; running an Opus-priced review on every one of those is the fastest way for a
 * developer to just delete this hook - but the cost of a FALSE positive here (one skippable local
 * check on a plan that happens to mention these fairly specific terms) is far smaller than the
 * cost of a FALSE negative (silently skipping the one check this hook exists to run), so this
 * errs toward catching more real submissions over avoiding every possible over-trigger.
 */
export function isFleetBoundPlan(planContent, planPath) {
  const normalizedPath = (planPath || "").replace(/\\/g, "/");
  if (normalizedPath.includes("/.cursor/plans/") || normalizedPath.startsWith(".cursor/plans/")) return true;
  const body = planContent || "";
  const fm = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fm && /^(engine|model|notify|depends_on|preview_path|retry_of)\s*:/m.test(fm[1])) return true;
  return /\.cursor\/plans\//.test(body) || /\bdev-agent\b/.test(body);
}

/** Parses the hook's stdin payload. Never throws - malformed input is data, and the caller's job
 * is to fail open on a null return, not to crash the developer's Claude Code session. */
export function parseHookInput(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * The plan's content, preferring the tool_input payload itself over guessing a file location -
 * ExitPlanMode's exact tool_input shape is not pinned in Claude Code's hooks documentation, so
 * this checks the field names a `{plan: "..."}` shape would use, and returns undefined (never a
 * guess) if none is present - the caller falls back to a directory scan only in that case.
 */
export function extractPlanFromPayload(payload) {
  const toolInput = payload && typeof payload === "object" ? payload.tool_input : undefined;
  if (!toolInput || typeof toolInput !== "object") return undefined;
  if (typeof toolInput.plan === "string" && toolInput.plan.trim()) return { content: toolInput.plan, path: undefined };
  if (typeof toolInput.path === "string" && toolInput.path.trim()) return { content: undefined, path: toolInput.path };
  return undefined;
}

/** A fallback-scanned path must resolve UNDER plansDir - untrusted input is data, never a trusted
 * location. Rejects `..` traversal and anything LEXICALLY outside plansDir.
 *
 * NOT symlink-aware, deliberately, not by oversight: this is pure path.resolve/path.relative
 * string logic - it never touches the filesystem, so a symlink at .cursor/plans/foo.md pointing
 * outside the repo would still pass this check (scanForNewestPlan's statSync follows it too, the
 * same gap one level up). Closing that would mean a filesystem-touching realpathSync re-check,
 * which only works once the target exists and would cost this function its current pure-function
 * unit tests. Left as a lexical-only check on proportionality, not impossibility: this hook is
 * documented, repeatedly, as client-side/best-effort/not-a-security-boundary (see the file
 * header), and planting that symlink already requires the same local filesystem access an
 * attacker would need to edit this hook script directly. Contrast runner/blueprint-context.ts's
 * symlink handling, which IS filesystem-aware - because that runs server-side, judging an
 * untrusted repo, which is a real trust boundary. */
export function isPathUnderPlansDir(candidatePath, plansDir) {
  const resolved = resolve(plansDir, candidatePath);
  const rel = relative(plansDir, resolved);
  return rel !== "" && !rel.startsWith("..") && !rel.split(sep).includes("..");
}

/** Cache key: plan content hash + repo-state hash. Repo state alone (not just plan content) is
 * required - a stale PASS must not survive a pull or a local edit to code the plan's claims
 * depended on. `repoStateHash` of `undefined` (git commands failed) still yields a valid but
 * distinct key every time repo state cannot be determined - see readGitStateHash's own comment for
 * why that is the safe direction, not a bug. */
export function computeCacheKey(planContent, repoStateHash) {
  const h = createHash("sha256");
  h.update("plan:");
  h.update(planContent || "");
  h.update("\nrepo:");
  h.update(repoStateHash || "unknown");
  return h.digest("hex");
}

/**
 * Looks up a key in the cache object. Returns a definite decision only on a hit - a MISS is
 * `{ hit: false }`, and the caller must run the real check, never assume a default. On a hit, the
 * verdict is REPLAYED exactly: "block" stays a deny, "pass" stays an allow - this is the bug this
 * design fixed from its first draft (see the plan doc's "Changes from the second Fable review"):
 * a cache that only remembered "was this checked" (not the verdict) would let an unchanged,
 * already-BLOCKed plan sail through a retry.
 */
export function decideFromCache(cache, key) {
  const entry = cache && typeof cache === "object" ? cache[key] : undefined;
  if (!entry || (entry.verdict !== "pass" && entry.verdict !== "block")) return { hit: false };
  return { hit: true, verdict: entry.verdict, findings: entry.findings };
}

/** Bounds the cache to CACHE_MAX_ENTRIES, dropping the oldest by `at` - a dev-machine convenience
 * cache must not grow without bound across months of plans. Pure: takes/returns a plain object. */
export function pruneCache(cache, maxEntries) {
  const entries = Object.entries(cache || {});
  if (entries.length <= maxEntries) return cache || {};
  entries.sort((a, b) => (a[1]?.at || "").localeCompare(b[1]?.at || ""));
  return Object.fromEntries(entries.slice(entries.length - maxEntries));
}

/**
 * Builds this hook's stdout - ALWAYS via JSON.stringify (never string concatenation), so a
 * findings string that quotes repo content can never break the hook's own output structure. Uses
 * Claude Code's documented PreToolUse hookSpecificOutput shape.
 */
export function buildHookResponse(decision, reason) {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  });
}

// ------------------------------------------------------------------------------------------------
// IMPURE - filesystem, child process, git. Thin by design; the logic above carries the weight.
// ------------------------------------------------------------------------------------------------

function readStdin() {
  return new Promise((resolvePromise) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolvePromise(data));
    process.stdin.on("error", () => resolvePromise(data));
  });
}

// Default timeout suits the quick git calls below (readGitStateHash) - the real preflight
// invocation (a genuine model call, "~1-2 minutes" per preflight-review.ts's own header) passes
// its own, much longer timeout explicitly. A shared short default would silently kill every real
// check before it could ever complete.
function run(cmd, args, opts) {
  return new Promise((resolvePromise) => {
    execFile(cmd, args, { timeout: 15_000, ...opts }, (err, stdout) => {
      resolvePromise(err ? undefined : String(stdout));
    });
  });
}

/**
 * Repo-state hash: `git rev-parse HEAD` + the tracked working-tree diff + `git status --porcelain`
 * (so a NEW untracked file changes the key even though its content isn't hashed - a known,
 * accepted gap, not an oversight: hashing untracked file bytes too would be more complete but
 * costlier for large new files, and this is a dev-convenience cache, not a security boundary).
 * `undefined` when git itself is unavailable or this isn't a git checkout - the caller
 * (computeCacheKey) still produces a valid key in that case, just one that makes a cache hit
 * rarer (every call effectively re-checks), which is the CORRECT tradeoff per the design doc:
 * correctness over cache-hit rate.
 */
async function readGitStateHash(repoRoot) {
  const head = await run("git", ["rev-parse", "HEAD"], { cwd: repoRoot });
  if (head === undefined) return undefined;
  const diff = (await run("git", ["diff", "HEAD"], { cwd: repoRoot })) ?? "";
  const status = (await run("git", ["status", "--porcelain"], { cwd: repoRoot })) ?? "";
  return createHash("sha256").update(head.trim()).update("\n").update(diff).update("\n").update(status).digest("hex");
}

function readCache() {
  try {
    return JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
  } catch {
    // Absent or corrupt -> empty cache, i.e. "always re-check" - the safe direction, never
    // "always allow".
    return {};
  }
}

function writeCache(cache) {
  try {
    mkdirSync(dirname(CACHE_FILE), { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(pruneCache(cache, CACHE_MAX_ENTRIES)));
  } catch (err) {
    console.error(`fleet-preflight-gate: could not write the local cache (non-fatal): ${err.message}`);
  }
}

/**
 * Directory-scan fallback (racy, best-effort - only reached when the payload carries no plan
 * content or path at all): the most recently modified .md file under .cursor/plans/.
 */
function scanForNewestPlan(plansDir) {
  try {
    const files = readdirSync(plansDir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => ({ f, mtime: statSync(resolve(plansDir, f)).mtimeMs }));
    if (files.length === 0) return undefined;
    files.sort((a, b) => b.mtime - a.mtime);
    return files[0].f;
  } catch {
    return undefined;
  }
}

/**
 * Writes a hard-to-miss, bordered, multi-line warning to stderr for every fail-open branch in this
 * file - still exactly ONE console.error call per call site (same as before), so nothing about the
 * FAIL OPEN, VISIBLY contract (see the file header) changes; only the LOUDNESS of the existing
 * warning does. A quiet one-line stderr warning is exactly what let a developer believe this hook
 * was protecting them when AGENT_FLEET_TOOLKIT_PATH was never actually set on their machine (see
 * the investigation this change comes from) - every caller below still returns `undefined` right
 * after calling this, and main()'s handling of that `undefined` (fail open, allow the exit) is
 * unchanged.
 */
function warnLoud(bodyLines) {
  const border = "=".repeat(78);
  console.error(
    [
      "",
      border,
      "  FLEET PRE-FLIGHT GATE IS NOT PROTECTING YOU RIGHT NOW",
      border,
      ...bodyLines.map((line) => (line ? `  ${line}` : "")),
      border,
      "",
    ].join("\n"),
  );
}

/** Invokes the real check via argv array (never a shell string). Returns `{ result, reason }`:
 * `result` is `{ verdict, findings }` on a genuine check, `undefined` on ANY failure (missing
 * toolkit, missing credential, crash, non-JSON output, an unexpected verdict) - the caller fails
 * open on an undefined `result`. `reason` is a short, human-readable sentence naming what actually
 * went wrong, set on every `undefined`-result path - the caller embeds it directly in the JSON
 * response it hands back to Claude Code, not just in the stderr warning (see the file header's
 * FAIL OPEN, VISIBLY section for why stderr alone is not good enough).
 *
 * TEST SEAM: FLEET_PREFLIGHT_TEST_STUB, when set, short-circuits to a canned verdict instead of
 * invoking the real script - the ONLY way the automated test harness exercises the full hook
 * end-to-end (stdin -> stdout) without a real model call. Setting env vars on a machine already
 * means arbitrary local code execution, so this is not a new attack surface - it exists purely so
 * fleet-preflight-gate.test.ts can spawn this file as a real child process and assert on its real
 * stdout, matching the plan's own "simulates the ExitPlanMode tool-call JSON a hook would
 * receive" verification requirement. */
async function runPreflightCheck(planContent, repoRoot) {
  if (process.env.FLEET_PREFLIGHT_TEST_STUB) {
    try {
      return { result: JSON.parse(process.env.FLEET_PREFLIGHT_TEST_STUB) };
    } catch {
      return { result: undefined, reason: "FLEET_PREFLIGHT_TEST_STUB was malformed (test-only path)" };
    }
  }
  let toolkitPath = process.env[TOOLKIT_ENV];
  if (!toolkitPath) {
    // Narrow, EXACT-path fallback only - never a directory search. This path gets EXECUTED
    // (bash ${scriptPath} ...) a few lines down, so quietly running whatever a broad search
    // happened to find would trade a missing check for an unreviewed one - the opposite of safer.
    // Matches the ONE documented default checkout location (docs/fleet-user-guide.md's
    // "git clone ... ~/agent-fleet").
    const defaultToolkitPath = resolve(homedir(), "agent-fleet");
    const defaultScriptPath = resolve(defaultToolkitPath, "scripts", "preflight-review.sh");
    if (existsSync(defaultScriptPath)) {
      // The check can actually run from here - no warning, because nothing is actually
      // unprotected right now.
      toolkitPath = defaultToolkitPath;
    } else {
      const reason = `${TOOLKIT_ENV} is not set and no checkout was found at the default location (${defaultToolkitPath})`;
      warnLoud([
        `${TOOLKIT_ENV} is not set - skipping the local pre-flight check.`,
        "The real gate still runs when you push, but only after a slower, real-dollar-cost round trip.",
        "",
        `FIX: Set ${TOOLKIT_ENV} to your agent-fleet checkout to enable this.`,
      ]);
      // CONFIG-FIXABLE, not transient: the developer can fix this in one command, right now -
      // see the "ask" branch in main() below. Contrast the timeout/crash/malformed-output paths
      // further down, which stay "allow" because asking the developer to retype the SAME
      // unfixable answer on every flaky network blip would be the wrong kind of friction.
      return {
        result: undefined,
        reason,
        kind: "config",
        askReason:
          `The local fleet pre-flight check isn't configured on this machine (${TOOLKIT_ENV} not set, no checkout at ${defaultToolkitPath}). ` +
          `Set it up now: setx ${TOOLKIT_ENV} "<path to your agent-fleet checkout>" (open a new terminal afterward), or continue without the local check - the server-side gate still runs regardless.`,
      };
    }
  }
  const scriptPath = resolve(toolkitPath, "scripts", "preflight-review.sh");
  if (!existsSync(scriptPath)) {
    const reason = `${scriptPath} does not exist - check ${TOOLKIT_ENV}`;
    warnLoud([
      `${scriptPath} does not exist - skipping the local pre-flight check.`,
      `Check ${TOOLKIT_ENV} points at a checkout of agent-fleet.`,
    ]);
    return {
      result: undefined,
      reason,
      kind: "config",
      askReason:
        `${TOOLKIT_ENV} points at "${toolkitPath}", but ${scriptPath} does not exist there - it doesn't look like an agent-fleet checkout. ` +
        `Fix ${TOOLKIT_ENV} to point at a real agent-fleet checkout, or continue without the local check - the server-side gate still runs regardless.`,
    };
  }

  const tmpPlanFile = resolve(dirname(CACHE_FILE), `.preflight-input-${process.pid}.md`);
  try {
    mkdirSync(dirname(tmpPlanFile), { recursive: true });
    writeFileSync(tmpPlanFile, planContent);
    // ~1-2 minutes expected (a real model call) - 5 minutes of headroom before this hook gives up
    // and fails open, rather than the short default suited to the git calls above.
    const stdout = await run("bash", [scriptPath, tmpPlanFile, repoRoot, "--json"], {
      cwd: repoRoot,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 300_000,
    });
    if (stdout === undefined) {
      const reason = "the local pre-flight check did not complete (timed out or produced no output)";
      warnLoud([`${reason} - skipping.`]);
      return { result: undefined, reason };
    }
    const lastLine = stdout.trim().split("\n").pop() || "";
    const parsed = JSON.parse(lastLine);
    if (parsed.verdict !== "pass" && parsed.verdict !== "block") {
      return { result: undefined, reason: "the local pre-flight check returned an unexpected verdict" };
    }
    return { result: { verdict: parsed.verdict, findings: parsed.findings || "" } };
  } catch (err) {
    const reason = `local pre-flight check crashed (${err.message})`;
    warnLoud([`${reason} - skipping.`]);
    return { result: undefined, reason };
  } finally {
    try {
      if (existsSync(tmpPlanFile)) unlinkSync(tmpPlanFile);
    } catch {
      /* best-effort - a leftover temp file costs nothing worse than disk, never a correctness issue */
    }
  }
}

// Returns the response string rather than writing it directly - see the bottom of the file for
// why: process.exit() right after an async write to a pipe can truncate it, so there must be
// exactly ONE write, followed by exactly one exit, once the write's own callback confirms it
// flushed.
async function main() {
  const raw = await readStdin();
  const payload = parseHookInput(raw);
  if (!payload) {
    console.error("fleet-preflight-gate: could not parse stdin as JSON - allowing (fail open).");
    return buildHookResponse("allow", "fleet-preflight-gate: malformed hook input");
  }

  if (payload.tool_name && payload.tool_name !== "ExitPlanMode") {
    return buildHookResponse("allow", "fleet-preflight-gate: not an ExitPlanMode call");
  }

  let planContent;
  const fromPayload = extractPlanFromPayload(payload);
  if (fromPayload?.content) {
    planContent = fromPayload.content;
  } else {
    const candidate = fromPayload?.path || scanForNewestPlan(PLANS_DIR);
    if (candidate && isPathUnderPlansDir(candidate, PLANS_DIR)) {
      try {
        planContent = readFileSync(resolve(PLANS_DIR, candidate), "utf-8");
      } catch {
        planContent = undefined;
      }
    }
  }

  if (!planContent) {
    console.error("fleet-preflight-gate: could not determine the plan's content - allowing (fail open).");
    return buildHookResponse("allow", "fleet-preflight-gate: no plan content available");
  }

  if (!isFleetBoundPlan(planContent, fromPayload?.path)) {
    return buildHookResponse("allow", "fleet-preflight-gate: plan shows no fleet-bound signal");
  }

  if (process.env[OVERRIDE_ENV]) {
    console.error(`fleet-preflight-gate: ${OVERRIDE_ENV} is set - skipping the local check by explicit request.`);
    return buildHookResponse("allow", `fleet-preflight-gate: skipped (${OVERRIDE_ENV} set)`);
  }

  const repoStateHash = await readGitStateHash(REPO_ROOT);
  const key = computeCacheKey(planContent, repoStateHash);
  const cache = readCache();
  const cached = decideFromCache(cache, key);
  if (cached.hit) {
    return cached.verdict === "block"
      ? buildHookResponse("deny", `[cached] ${cached.findings}`)
      : buildHookResponse("allow", "fleet-preflight-gate: cached PASS for this plan/repo state");
  }

  const { result, reason, kind, askReason } = await runPreflightCheck(planContent, REPO_ROOT);
  if (!result) {
    // Genuinely unable to run the check - fail open, but not always silently. The stderr
    // warnings above already fired; this puts the SAME reason into the one channel Claude Code's
    // own hook protocol guarantees to carry (the JSON response itself), since stderr alone is not
    // a reliable way to reach the developer - see the file header's FAIL OPEN, VISIBLY section.
    //
    // "config" (TOOLKIT_ENV unset/wrong) is fixable by the developer in one command right now, so
    // this surfaces as "ask" - Claude Code's own permission-prompt flow - rather than a silent
    // allow the developer would have to notice in scrollback. Every OTHER fail-open reason
    // (timeout, crash, malformed verdict/stdin, no plan content) stays "allow": those are
    // transient or our-own-error cases asking wouldn't fix, and asking on every flaky network
    // blip is the wrong kind of friction, not a helpful nudge.
    if (kind === "config") {
      return buildHookResponse("ask", askReason ?? reason ?? "fleet-preflight-gate: local check not configured");
    }
    return buildHookResponse(
      "allow",
      `fleet-preflight-gate: local check unavailable this time (${reason ?? "see stderr"}) - the real gate still runs on push`,
    );
  }

  // planBodyHash (sql/042): a hash of the plan text this hook actually checked, recorded on the
  // cache entry as the effectiveness marker's local half - see sql/042_preflight_hook_marker.sql
  // and runner/preflight-hook-verdict.ts for the server side that later verifies against it.
  // Deliberately a PLAIN hash of the plan content alone, not combined with repo state like
  // computeCacheKey's key above - this one has a different job (identifying the plan body that
  // was checked), not identifying a cache slot.
  const planBodyHash = createHash("sha256").update(planContent).digest("hex");
  cache[key] = { verdict: result.verdict, findings: result.findings, planBodyHash, at: new Date().toISOString() };
  writeCache(cache);

  return result.verdict === "block"
    ? buildHookResponse("deny", result.findings)
    : buildHookResponse("allow", "fleet-preflight-gate: PASS");
}

// EXPLICIT process.exit() is required, not cosmetic: reading process.stdin (readStdin() above)
// puts it into flowing mode, and a Node process that has done so does not always exit on its own
// once the event loop would otherwise be empty - a well-known Node gotcha for stdin-reading CLIs.
// Without this, the hook can hang indefinitely after already having decided, which on a caller
// with no independent timeout (a real Claude Code hook invocation) has no other backstop.
//
// EXACTLY ONE WRITE, THEN EXIT ONLY AFTER IT FLUSHES: process.exit() called immediately after an
// async write to a pipe (stdout is a pipe for both a real hook invocation and a spawned test) can
// TRUNCATE that write, because pipe writes are not guaranteed synchronous - Node's own docs warn
// against exiting before a write's callback confirms it has flushed. main() therefore returns the
// response string rather than writing it itself, so there is exactly one write here, and the exit
// happens only inside that write's own callback.
main()
  .catch((err) => {
    console.error(`fleet-preflight-gate: unexpected error (${err.message}) - allowing (fail open).`);
    return buildHookResponse("allow", "fleet-preflight-gate: unexpected error, see stderr");
  })
  .then((response) => {
    process.stdout.write(response, () => {
      // Exit status is never how a decision is communicated (the JSON on stdout is) - reset to 0
      // unconditionally so a caller that happens to check the exit code never misreads this as a
      // crash.
      process.exitCode = 0;
      process.exit();
    });
  });
