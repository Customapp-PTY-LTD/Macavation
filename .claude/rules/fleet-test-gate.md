# Fleet test gate — where this repo's tests gate a merge (Claude Code)

Apply this whenever the user asks how to **make tests block a fleet merge**, how to **turn on /
change the test gate**, why a change **merged without tests**, or wants this repo's fleet runs
verified before they land on the base branch.

## What the gate is

Agent Fleet merges a plan's result **straight into this repo's base branch** (usually `dev`),
which typically auto-deploys. The **test gate** is the only thing that can block that merge on
tests: after the engine pushes its working branch, the fleet runs a configured command and only
merges if it passes.

- **A command is set** → tests run on every change; a failure blocks the merge (nothing lands,
  nothing deploys).
- **No command is set** → the run is recorded `tests_status: none` and **merges anyway,
  unverified**. Silence is not a gate.
- **`require_tests: true`** → "no tests" becomes a block instead of allow-with-flag.

## Where it is set — NOT in this repo

The gate lives in the **`Customapp-PTY-LTD/agent-fleet`** repo's `config/repos.json`, changed by
a **pull request to that repo** (the fleet runs the command unattended, so it is a reviewed
security control — deliberately not read from this repo's `package.json`, and not editable from
the portal). Add or edit this repo's block:

```json
{
  "repo": "Customapp-PTY-LTD/THIS-REPO",
  "base_branch": "dev",
  "plan_ref": "dev-agent",
  "enabled": true,
  "test_command": "npm ci && npm run test:fleet",
  "require_tests": true
}
```

## How this repo helps: the `test:fleet` script convention

Point the gate at a **`test:fleet` npm script** in this repo, rather than naming a raw command in
the central config. That gives the fleet a **stable target**: the command in `config/repos.json`
never changes, while what this repo actually tests can evolve here without another central PR.

```jsonc
// package.json
"scripts": {
  "test:fleet": "…the fast, self-contained gate for fleet merges…"
}
```

Two rules for what `test:fleet` may do, both learned the hard way:

- **Fast and self-contained** — no browser, no login, no deployed environment. An end-to-end /
  Playwright suite that needs a running app will *error* (not fail) and block **every** merge in
  a repo that was merging fine. If you need browser coverage, make it hermetic (mock mode, its
  own `webServer` on `127.0.0.1`, no auth).
- **Run it in a fresh clone first**, exactly as the gate will (`npm ci && npm run test:fleet`). A
  command that only passes because your machine has stray packages will fail on every run.

**Residual risk, stated honestly.** The `test:fleet` convention trades one property for another:
the central config can't be weakened without a PR to `agent-fleet`, but the *script it points at*
lives in this repo, where a fleet run can edit it. A plan can't delete its own gate, but it could
**hollow it out** — rewrite `test:fleet` to `exit 0` or quietly drop assertions — and still
"pass". So every change to `package.json` scripts and to the gate itself deserves explicit
scrutiny in diff review. If you need the command itself tamper-proof, name it inline in
`config/repos.json` instead of delegating to a repo script: you lose the stable-target benefit but
close this hole.

## See the current state

The portal's **Configuration** page shows every project's live gate state — Gated / Tests
required / **None — merges unverified** / Blocks-all — and how to change it:
`https://dev.d2zheavn62lwu9.amplifyapp.com/config.html`.
