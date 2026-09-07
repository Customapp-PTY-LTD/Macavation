#!/usr/bin/env node
/**
 * wa-optout:verify — regression guard for the WhatsApp report opt-out and daily-pause RESUME:
 *   migrations/<ts>_report_opt_out.sql                     (opted_out_at, the two new RPCs, the
 *                                                            report_daily_recipients gate)
 *   supabase/functions/whatsapp-inbound/index.ts            (handleOptOutVerbs pre-gate
 *                                                            interceptor, commandResume)
 *   supabase/functions/send-report-whatsapp/index.ts        (per-recipient opt-out refusal)
 *   supabase/functions/send-daily-digest-whatsapp/index.ts  (the third sender's opt-out gate)
 *
 * WHAT WENT WRONG TWICE BEFORE, and therefore what this guards:
 *   - An INSERT into report_recipients that left display_name NULL (NOT NULL column) — raises
 *     23502 at runtime, swallowed by the edge function, opt-out silently not recorded.
 *   - A new RPC resolving a phone through report_recipient_by_inbound_phone or the same
 *     is_active-filtered idiom — a second STOP, a START, or an admin-deactivated roster row would
 *     then be permanently unreachable.
 *   - report_daily_recipients rewritten in a way that drops the pause clause while adding the
 *     opt-out clause.
 *
 * Follows the same `.ts` discipline as verify-wa-plumbing.mjs, verify-wa-staff-menu.mjs and
 * verify-wa-role-features.mjs: `.ts` type annotations are not valid JS, so this script never
 * evaluates a `.ts` file — it asserts textually against the real source, and every failure names
 * the file to fix. Pure fs reads, node:assert, no dependency, no network — test:fleet must stay
 * hermetic (package.json's own //test:fleet note).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const REL_MIGRATIONS_DIR = 'migrations';
const REL_INBOUND = 'supabase/functions/whatsapp-inbound/index.ts';
const REL_SEND_REPORT = 'supabase/functions/send-report-whatsapp/index.ts';
const REL_SEND_DIGEST = 'supabase/functions/send-daily-digest-whatsapp/index.ts';
const REL_SUBSCRIPTIONS_MIGRATION = 'migrations/20260825090000_report_subscriptions_and_staff.sql';
const REL_RECIPIENTS_MIGRATION = 'migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql';

/** Normalise CRLF before any comparison — same reason as verify-wa-plumbing.mjs. */
function readFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\r\n').join('\n');
}

/** Locates the (single) new migration by suffix, rather than hard-coding its timestamp. */
function findOptOutMigration() {
  const dir = path.join(ROOT, REL_MIGRATIONS_DIR);
  const matches = fs.readdirSync(dir).filter((f) => f.endsWith('_report_opt_out.sql'));
  if (matches.length === 0) {
    fail(
      `${REL_MIGRATIONS_DIR}/: no file matching *_report_opt_out.sql found. This plan's migration ` +
        `is missing.`
    );
  }
  if (matches.length > 1) {
    fail(
      `${REL_MIGRATIONS_DIR}/: expected exactly one *_report_opt_out.sql, found ${matches.length}: ` +
        `${matches.join(', ')}.`
    );
  }
  return `${REL_MIGRATIONS_DIR}/${matches[0]}`;
}

const REL_OPTOUT_MIGRATION = findOptOutMigration();

const migrationSrc = readFile(REL_OPTOUT_MIGRATION);
const inboundSrc = readFile(REL_INBOUND);
const sendReportSrc = readFile(REL_SEND_REPORT);
const sendDigestSrc = readFile(REL_SEND_DIGEST);

// ---- tiny test harness (same shape as the sibling verifiers) --------------------------------
const failures = [];
let passCount = 0;
function check(description, fn) {
  try {
    fn();
    passCount++;
  } catch (e) {
    failures.push({ description, message: e && e.message ? e.message : String(e) });
  }
}
function fail(msg) {
  throw new Error(msg);
}

/**
 * Walks from `declaration`'s first `{` to the matching close brace — the loadFeatureKeysBody
 * idiom from scripts/verify-wa-role-features.mjs:69-89, copied here (not imported: these
 * verifiers are deliberately standalone, dependency-free scripts) because it is the only isolation
 * idiom in this repo that is safe for a function containing NESTED braces (object literals,
 * nested if/try blocks) — the fnBody `\n}\n` idiom below is only safe for a function with none.
 */
function isolateByBraceDepth(source, relPath, declaration) {
  const start = source.indexOf(declaration);
  if (start === -1) {
    fail(
      `${relPath}: could not find ${JSON.stringify(declaration)}. If it was renamed, update this ` +
        `verifier to match — do not delete the assertion.`
    );
  }
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  fail(`${relPath}: ${JSON.stringify(declaration)} body is not brace-balanced — cannot verify it.`);
}

/**
 * Isolates one `CREATE OR REPLACE FUNCTION ... AS $fn$ ... $fn$;` block from a migration file.
 * isolateByBraceDepth above is a JS/TS idiom and does not apply here: these are PL/pgSQL and SQL
 * function bodies, which use BEGIN/END and no curly braces at all — walking for '{' would never
 * find one and would silently mis-isolate (or fail) every SQL check. Every function in this
 * repo's migrations uses the literal `$fn$` dollar-quote tag (grep confirms it), so anchoring on
 * that tag rather than a generic dollar-quote scanner is deliberate, not a shortcut.
 */
function isolateSqlFunction(source, relPath, declaration) {
  const start = source.indexOf(declaration);
  if (start === -1) {
    fail(
      `${relPath}: could not find ${JSON.stringify(declaration)}. If it was renamed, update this ` +
        `verifier to match — do not delete the assertion.`
    );
  }
  const bodyStart = source.indexOf('AS $fn$', start);
  if (bodyStart === -1) {
    fail(`${relPath}: could not find "AS $fn$" after ${JSON.stringify(declaration)}.`);
  }
  const bodyEnd = source.indexOf('$fn$;', bodyStart + 'AS $fn$'.length);
  if (bodyEnd === -1) {
    fail(`${relPath}: could not find the closing "$fn$;" after ${JSON.stringify(declaration)}.`);
  }
  return source.slice(start, bodyEnd + '$fn$;'.length);
}

/**
 * The scripts/verify-wa-staff-menu.mjs `fnBody` idiom: from `declaration` to the first line-start
 * `}`. Cheaper than brace-depth walking and fine for a function whose body has no nested
 * multi-line object literal that itself ends a line with a lone `}` — checked against
 * commandResume's actual source below (see the isolation sanity check in assertion 7).
 */
function isolateByNewlineClose(source, relPath, declaration) {
  const at = source.indexOf(declaration);
  if (at === -1) {
    fail(
      `${relPath}: could not find ${JSON.stringify(declaration)}. If it was renamed, update this ` +
        `verifier to match — do not delete the assertion.`
    );
  }
  const fn = source.slice(at);
  const end = fn.indexOf('\n}\n');
  if (end === -1) {
    fail(`${relPath}: ${JSON.stringify(declaration)} has no line-start "}" close — cannot verify it.`);
  }
  return fn.slice(0, end);
}

// ================================================================================================
// 1. report_daily_recipients() gains the opt-out clause WITHOUT losing the pause clause.
//
// Rewriting this function is exactly how the pause silently disappears — the regression that
// matters here is losing rs.muted_until / report_sast_today(), not just failing to add
// opted_out_at.
// ================================================================================================

check('report_daily_recipients() adds opted_out_at IS NULL and keeps the pause clause', () => {
  const body = isolateSqlFunction(
    migrationSrc,
    REL_OPTOUT_MIGRATION,
    'CREATE OR REPLACE FUNCTION public.report_daily_recipients()'
  );
  const must = [
    'rr.opted_out_at IS NULL',
    'rs.muted_until IS NULL',
    'public.report_sast_today()',
    'rr.is_active',
    'rs.is_active',
    'ORDER BY rr.display_name',
  ];
  for (const needle of must) {
    if (!body.includes(needle)) {
      fail(
        `${REL_OPTOUT_MIGRATION}: report_daily_recipients() no longer contains ${JSON.stringify(needle)}. ` +
          `The gate belongs in the SELECTOR and must add opted_out_at IS NULL WITHOUT dropping the ` +
          `existing is_active / pause clauses — see migrations/20260825090000_report_subscriptions_and_staff.sql:260-277.`
      );
    }
  }
});

// ================================================================================================
// 2. Both new RPCs are SECURITY DEFINER, pin search_path, and are service_role-only.
// ================================================================================================

for (const [fnDecl, fnSig] of [
  ['CREATE OR REPLACE FUNCTION public.report_set_opt_out(', 'public.report_set_opt_out(text, boolean)'],
  ['CREATE OR REPLACE FUNCTION public.report_opt_out_status(', 'public.report_opt_out_status(text)'],
]) {
  check(`${fnSig} is SECURITY DEFINER with a pinned search_path`, () => {
    const fnBlock = isolateSqlFunction(migrationSrc, REL_OPTOUT_MIGRATION, fnDecl);
    const header = fnBlock.slice(0, fnBlock.indexOf('AS $fn$'));
    if (!/SECURITY DEFINER/.test(header)) {
      fail(`${REL_OPTOUT_MIGRATION}: ${fnSig} must be SECURITY DEFINER.`);
    }
    if (!/SET search_path\s*=\s*public/.test(header)) {
      fail(`${REL_OPTOUT_MIGRATION}: ${fnSig} must pin SET search_path = public.`);
    }
  });

  check(`${fnSig} is granted to service_role and NOT to anon/authenticated`, () => {
    const revokeRe = new RegExp(
      `REVOKE ALL ON FUNCTION ${escapeRe(fnSig)} FROM PUBLIC, anon, authenticated;`
    );
    const grantRe = new RegExp(`GRANT EXECUTE ON FUNCTION ${escapeRe(fnSig)} TO service_role;`);
    if (!revokeRe.test(migrationSrc)) {
      fail(
        `${REL_OPTOUT_MIGRATION}: missing "REVOKE ALL ON FUNCTION ${fnSig} FROM PUBLIC, anon, authenticated;" — ` +
          `these RPCs take a bare phone number; an anon/authenticated grant would let anyone opt ` +
          `somebody else out, or enumerate a confidential distribution list.`
      );
    }
    if (!grantRe.test(migrationSrc)) {
      fail(`${REL_OPTOUT_MIGRATION}: missing "GRANT EXECUTE ON FUNCTION ${fnSig} TO service_role;".`);
    }
  });
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ================================================================================================
// 3. The insert branch supplies a non-NULL display_name.
//
// report_recipients.display_name is `text NOT NULL`
// (migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql:77). An INSERT that
// leaves it NULL raises 23502 at runtime, the edge function swallows it, and the opt-out is
// silently not recorded while every textual check on the caller passes. This is the schema fact
// that blocked this exact plan twice before.
// ================================================================================================

check('the INSERT into report_recipients supplies a non-NULL display_name', () => {
  const columnList = '(display_name, phone, source, is_active, opted_out_at)';
  const valuesLine = "(v_canon, v_canon, 'whatsapp_chat', false, now())";
  if (!migrationSrc.includes(columnList)) {
    fail(
      `${REL_OPTOUT_MIGRATION}: expected the column list ${columnList} on the INSERT INTO ` +
        `report_recipients. ${REL_RECIPIENTS_MIGRATION}:77 declares display_name text NOT NULL — ` +
        `an INSERT that omits or nulls it raises 23502 at runtime and the opt-out is silently lost.`
    );
  }
  if (!migrationSrc.includes(valuesLine)) {
    fail(
      `${REL_OPTOUT_MIGRATION}: expected the VALUES line ${valuesLine} supplying display_name = ` +
        `v_canon (the canonical phone form — see ${REL_RECIPIENTS_MIGRATION}:77, display_name text NOT NULL).`
    );
  }
});

// ================================================================================================
// 4. Neither new RPC resolves through the is_active-filtered bridge.
// ================================================================================================

check('the migration does not resolve a phone through report_recipient_by_inbound_phone', () => {
  if (migrationSrc.includes('report_recipient_by_inbound_phone')) {
    fail(
      `${REL_OPTOUT_MIGRATION}: must not reference report_recipient_by_inbound_phone. That RPC ` +
        `filters "AND rr.is_active" (${REL_SUBSCRIPTIONS_MIGRATION}:311), which would make a second ` +
        `STOP, a START, or an admin-deactivated roster row permanently unreachable.`
    );
  }
});

check('both new RPCs resolve without the is_active filter', () => {
  const bodies = [
    isolateSqlFunction(migrationSrc, REL_OPTOUT_MIGRATION, 'CREATE OR REPLACE FUNCTION public.report_set_opt_out('),
    isolateSqlFunction(migrationSrc, REL_OPTOUT_MIGRATION, 'CREATE OR REPLACE FUNCTION public.report_opt_out_status('),
  ];
  for (const body of bodies) {
    if (!body.includes('public.chat_normalize_phone(rr.phone) = v_key')) {
      fail(
        `${REL_OPTOUT_MIGRATION}: expected "public.chat_normalize_phone(rr.phone) = v_key" (the same ` +
          `idiom set_report_subscription_by_phone uses at ${REL_SUBSCRIPTIONS_MIGRATION}:360, minus ` +
          `the is_active filter) in both new RPC bodies.`
      );
    }
  }
});

// ================================================================================================
// 5. RESUME is registered; START keeps its existing meaning.
// ================================================================================================

check('RESUME: commandResume is registered in COMMAND_HANDLERS', () => {
  if (!inboundSrc.includes('RESUME: commandResume')) {
    fail(`${REL_INBOUND}: expected "RESUME: commandResume" in COMMAND_HANDLERS.`);
  }
});

check('START: commandMenu is still present — the greeting was not dropped or repointed', () => {
  if (!inboundSrc.includes('START: commandMenu')) {
    fail(
      `${REL_INBOUND}: expected "START: commandMenu" still in COMMAND_HANDLERS. The pre-gate ` +
        `interceptor must give this binding a second job WITHOUT changing it — an opted-out number's ` +
        `START is answered by handleOptOutVerbs before COMMAND_HANDLERS is ever reached; everybody ` +
        `else's START must still open the menu.`
    );
  }
});

// ================================================================================================
// 6. STOP is reachable for an unenrolled number, in the right position, inside
//    processCommandForMessage — NOT the first (wrong) occurrence of outcome: 'not_enrolled', which
//    sits inside tryConfirmEnrolment and is defined earlier in the file.
// ================================================================================================

check(
  "the pre-gate interceptor runs before staff resolution and before the not_enrolled reply, inside processCommandForMessage",
  () => {
    const fnBody = isolateByBraceDepth(inboundSrc, REL_INBOUND, 'async function processCommandForMessage');

    // Isolation sanity check FIRST: outcome: 'not_enrolled' appears TWICE in the whole file (once
    // in tryConfirmEnrolment's six-digit-code failure path, once in processCommandForMessage's own
    // unenrolled branch). A bare file-wide indexOf would always find the FIRST one — which is
    // defined earlier in the file than processCommandForMessage itself — so it could never catch a
    // real regression regardless of where the interceptor call actually sits. If this isolated
    // body does not contain EXACTLY ONE occurrence, the isolation boundary drifted (or a second
    // occurrence was added inside this same function) and the ordering check below cannot be
    // trusted — fail loudly naming what changed, rather than silently comparing against the wrong
    // occurrence again.
    const notEnrolledCount = (fnBody.match(/outcome: 'not_enrolled'/g) || []).length;
    if (notEnrolledCount !== 1) {
      fail(
        `${REL_INBOUND}: expected exactly 1 occurrence of "outcome: 'not_enrolled'" inside ` +
          `processCommandForMessage's isolated body, found ${notEnrolledCount}. The isolation ` +
          `boundary may have drifted, or a second occurrence was added inside this function — do ` +
          `not loosen this check, fix what changed.`
      );
    }

    // Now the three-way ordering, entirely WITHIN the isolated body (sound because the sanity
    // check above just proved there is exactly one 'not_enrolled' to compare against).
    const optOutIdx = fnBody.indexOf("handleOptOutVerbs(sb, from, wamid, rawBody, replyId)");
    const resolveIdx = fnBody.indexOf("sb.rpc('whatsapp_resolve_staff_user'");
    const notEnrolledIdx = fnBody.indexOf("outcome: 'not_enrolled'");

    if (optOutIdx === -1) {
      fail(
        `${REL_INBOUND}: processCommandForMessage no longer calls ` +
          `"handleOptOutVerbs(sb, from, wamid, rawBody, replyId)". STOP must be checked before the ` +
          `enrolment gate and before any pending-command handling (contract 5).`
      );
    }
    if (resolveIdx === -1) {
      fail(`${REL_INBOUND}: processCommandForMessage no longer calls whatsapp_resolve_staff_user.`);
    }
    if (!(optOutIdx < resolveIdx && resolveIdx < notEnrolledIdx)) {
      fail(
        `${REL_INBOUND}: expected source order inside processCommandForMessage to be ` +
          `handleOptOutVerbs(...) < whatsapp_resolve_staff_user < outcome: 'not_enrolled' ` +
          `(found at ${optOutIdx}, ${resolveIdx}, ${notEnrolledIdx}). This script never executes ` +
          `.ts, so source order is what proves the interceptor runs before resolution and before ` +
          `the unenrolled reply. The interceptor must sit inside processCommandForMessage's ` +
          `existing try (the 2xx rule — a non-2xx or a timeout is dropped forever by Control Room, ` +
          `never retried). A COMMAND_HANDLERS.STOP entry is deliberately absent: CommandContext ` +
          `does not exist before whatsapp_resolve_staff_user succeeds, so STOP cannot be a ` +
          `COMMAND_HANDLERS verb.`
      );
    }
  }
);

// ================================================================================================
// 7. commandResume checks subscribed_daily / muted_until BEFORE calling
//    set_report_subscription_by_phone — the guard that stops RESUME creating or re-enabling a
//    subscription nobody consented to.
// ================================================================================================

check(
  'commandResume guards subscribed_daily/muted_until before calling set_report_subscription_by_phone',
  () => {
    const body = isolateByNewlineClose(inboundSrc, REL_INBOUND, 'async function commandResume');
    const subIdx = body.indexOf('subscribed_daily');
    const mutedIdx = body.indexOf('muted_until');
    const callIdx = body.indexOf("rpc('set_report_subscription_by_phone'");
    if (subIdx === -1 || mutedIdx === -1) {
      fail(`${REL_INBOUND}: commandResume must read both subscribed_daily and muted_until.`);
    }
    if (callIdx === -1) {
      fail(`${REL_INBOUND}: commandResume must call set_report_subscription_by_phone.`);
    }
    if (!(subIdx < callIdx && mutedIdx < callIdx)) {
      fail(
        `${REL_INBOUND}: commandResume must check subscribed_daily and muted_until BEFORE calling ` +
          `set_report_subscription_by_phone. That RPC CREATES a subscription it does not find ` +
          `(INSERT ... ON CONFLICT DO UPDATE SET is_active = true, ` +
          `${REL_SUBSCRIPTIONS_MIGRATION}:367-374) — calling it for a kind the person never ` +
          `subscribed to, or a row an administrator switched off, would sign them up or re-enable ` +
          `consent they never gave.`
      );
    }
  }
);

// ================================================================================================
// 8. HELP_COMMAND_LIST mentions both new verbs — the list the bot shows cannot drift from the
//    verbs it answers.
// ================================================================================================

check('HELP_COMMAND_LIST mentions STOP and RESUME', () => {
  const start = inboundSrc.indexOf('const HELP_COMMAND_LIST');
  if (start === -1) fail(`${REL_INBOUND}: could not find "const HELP_COMMAND_LIST".`);
  const end = inboundSrc.indexOf(';', start);
  const block = inboundSrc.slice(start, end === -1 ? undefined : end + 1);
  if (!/\bSTOP\b/.test(block)) fail(`${REL_INBOUND}: HELP_COMMAND_LIST must mention STOP.`);
  if (!/\bRESUME\b/.test(block)) fail(`${REL_INBOUND}: HELP_COMMAND_LIST must mention RESUME.`);
});

// ================================================================================================
// 9. send-report-whatsapp calls report_opt_out_status before begin_report_delivery, and never
//    queries report_recipients directly.
//
// Both are matched in their QUOTED rpc-call form ('report_opt_out_status', 'begin_report_delivery')
// rather than the bare identifier — this file's own header comment names
// "begin_report_delivery, complete_report_delivery, record_report_pdf_storage" in prose near the
// top, well before any code, so a bare-identifier indexOf would find that comment first and always
// report the wrong order regardless of what the code actually does.
// ================================================================================================

check("send-report-whatsapp calls report_opt_out_status before begin_report_delivery, no raw table filter", () => {
  const optOutIdx = sendReportSrc.indexOf("'report_opt_out_status'");
  const beginIdx = sendReportSrc.indexOf("'begin_report_delivery'");
  if (optOutIdx === -1) {
    fail(`${REL_SEND_REPORT}: expected a call to rpc(sb, 'report_opt_out_status', ...).`);
  }
  if (beginIdx === -1) {
    fail(`${REL_SEND_REPORT}: expected a call to rpc(sb, 'begin_report_delivery', ...).`);
  }
  if (!(optOutIdx < beginIdx)) {
    fail(
      `${REL_SEND_REPORT}: 'report_opt_out_status' (${optOutIdx}) must appear before the first ` +
        `'begin_report_delivery' (${beginIdx}) call. The opt-out refusal (contract 3) must run ` +
        `before this sender starts a delivery attempt for an opted-out number.`
    );
  }
  if (sendReportSrc.includes("from('report_recipients')")) {
    fail(
      `${REL_SEND_REPORT}: must not query report_recipients directly — the lookup is the named RPC ` +
        `report_opt_out_status, never a raw table filter comparing the browser's phone string ` +
        `against unnormalised report_recipients.phone (which would match nobody and silently ` +
        `refuse nobody).`
    );
  }
});

check('send-report-whatsapp declares its own isMissingRpcError (function or const arrow)', () => {
  if (!/(?:function\s+isMissingRpcError\s*\(|const\s+isMissingRpcError\s*=)/.test(sendReportSrc)) {
    fail(
      `${REL_SEND_REPORT}: expected a local "function isMissingRpcError(" or ` +
        `"const isMissingRpcError =" declaration. This file cannot import isMissingRpc from ` +
        `whatsapp-inbound/index.ts (not exported, and this file imports neither ../_shared/* nor ` +
        `../whatsapp-inbound/*) — a bare reference to an undeclared isMissingRpc must not pass this check.`
    );
  }
});

check(
  'send-report-whatsapp keeps the fail-open and fail-closed opt-out branches as two distinct arms',
  () => {
    if (!/isMissingRpcError\(e\)/.test(sendReportSrc)) {
      fail(`${REL_SEND_REPORT}: expected "isMissingRpcError(e)" used as a condition.`);
    }
    // Scope the continue-count to the opt-out check block specifically (between the first
    // 'report_opt_out_status' call and the block's own end marker), not the whole file — the
    // per-recipient loop below has its own unrelated `continue`s once a send is attempted.
    const blockStart = sendReportSrc.indexOf("'report_opt_out_status'");
    const blockEnd = sendReportSrc.indexOf('End opt-out refusal', blockStart);
    if (blockStart === -1 || blockEnd === -1) {
      fail(`${REL_SEND_REPORT}: could not isolate the opt-out check block to count its continue statements.`);
    }
    const block = sendReportSrc.slice(blockStart, blockEnd);
    const continueCount = (block.match(/\bcontinue;/g) || []).length;
    if (continueCount !== 2) {
      fail(
        `${REL_SEND_REPORT}: expected exactly 2 "continue;" statements inside the opt-out check ` +
          `block (one fail-closed on a real error, one for an explicit opted-out refusal), found ` +
          `${continueCount}. This is the guard against the fail-open and fail-closed branches being ` +
          `silently collapsed into a single generic catch.`
      );
    }
  }
);

// ================================================================================================
// 9c. send-daily-digest-whatsapp gates the third sender.
// ================================================================================================

check(
  'send-daily-digest-whatsapp calls report_opt_out_status before the meta-proxy fetch, and declares its own isMissingRpcError',
  () => {
    const optOutIdx = sendDigestSrc.indexOf("'report_opt_out_status'");
    const fetchIdx = sendDigestSrc.indexOf('fetch(`${CONTROL_ROOM_BASE_URL}/meta-proxy`');
    if (optOutIdx === -1) {
      fail(`${REL_SEND_DIGEST}: expected a call to supabase.rpc('report_opt_out_status', ...).`);
    }
    if (fetchIdx === -1) {
      fail(`${REL_SEND_DIGEST}: expected the meta-proxy fetch call.`);
    }
    if (!(optOutIdx < fetchIdx)) {
      fail(
        `${REL_SEND_DIGEST}: 'report_opt_out_status' (${optOutIdx}) must appear before the first ` +
          `meta-proxy fetch (${fetchIdx}) — this sender reads scheduled_reports directly, entirely ` +
          `outside report_recipients / report_daily_recipients' own gate, and the STOP reply's ` +
          `promise is false for as long as this sender can send unchecked.`
      );
    }
    if (!/(?:function\s+isMissingRpcError\s*\(|const\s+isMissingRpcError\s*=)/.test(sendDigestSrc)) {
      fail(
        `${REL_SEND_DIGEST}: expected a local "function isMissingRpcError(" or ` +
          `"const isMissingRpcError =" declaration — a third independent copy, not an import from ` +
          `either of the other two files (neither exports it, and this file imports nothing local).`
      );
    }
  }
);

// ================================================================================================
// 10. No new normaliser and no new sweep candidate — cheap early warning; the authoritative exact
//     counts (6 JS/TS, 3 SQL) live in scripts/verify-report-whatsapp-parity.mjs.
//     Count confirmed by hand against this tree on 2026-09-07: 3 normalizePhone declarations
//     (send-daily-digest-whatsapp, send-report-whatsapp, send-whatsapp-message).
// ================================================================================================

check('exactly 3 normalizePhone declarations across supabase/functions, no fourth copy', () => {
  const fnDir = path.join(ROOT, 'supabase/functions');
  const hits = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts')) {
        const src = fs.readFileSync(full, 'utf8');
        if (/function normalizePhone\(/.test(src)) hits.push(path.relative(ROOT, full).split(path.sep).join('/'));
      }
    }
  })(fnDir);
  if (hits.length !== 3) {
    fail(
      `supabase/functions/: expected exactly 3 "function normalizePhone(" declarations, found ` +
        `${hits.length}: ${hits.join(', ')}. scripts/verify-report-whatsapp-parity.mjs asserts the ` +
        `authoritative exact count (6 JS/TS sweep candidates) — this is a cheaper early warning, ` +
        `not a replacement for it.`
    );
  }
});

check('whatsapp-inbound does not gain the digit-strip normaliser idiom', () => {
  if (inboundSrc.includes('replace(/\\D/g')) {
    fail(
      `${REL_INBOUND}: must not contain replace(/\\D/g — that idiom plus a "27" substring is exactly ` +
        `what scripts/verify-report-whatsapp-parity.mjs's JS/TS sweep counts, and its exact-count ` +
        `assertion (6 files) would break.`
    );
  }
});

// ================================================================================================
// 11. The new migration does not contain the SQL digit-strip idiom either.
// ================================================================================================

check('the new migration does not contain the SQL digit-strip idiom', () => {
  if (migrationSrc.includes("'\\D', '', 'g'")) {
    fail(
      `${REL_OPTOUT_MIGRATION}: must not contain '\\D', '', 'g' — that idiom plus a "27" substring is ` +
        `exactly what scripts/verify-report-whatsapp-parity.mjs's SQL sweep counts (currently exactly ` +
        `3 files), and its exact-count assertion would break.`
    );
  }
});

// ---- report -------------------------------------------------------------------------------

if (failures.length) {
  console.error(`\nwa-optout:verify FAILED — ${failures.length} of ${failures.length + passCount} checks\n`);
  for (const f of failures) {
    console.error(`  ✗ ${f.description}`);
    console.error(`    ${f.message}\n`);
  }
  process.exit(1);
}
console.log(`wa-optout:verify passed — ${passCount} checks (migration: ${REL_OPTOUT_MIGRATION})`);
