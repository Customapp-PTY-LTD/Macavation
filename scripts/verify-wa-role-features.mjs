#!/usr/bin/env node
/**
 * wa-role-features:verify — guards the fix for the WhatsApp bot reading zero feature grants for a
 * super user, and guards the portal-side security property that fix had to preserve:
 *   migrations/20260907120000_whatsapp_role_feature_keys.sql  (the bot's own reader)
 *   supabase/functions/whatsapp-inbound/index.ts              (loadFeatureKeys, which calls it)
 *
 * WHAT WENT WRONG, and therefore what must not come back. public.get_role_features_for_role
 * carries `AND (portal_actor_is_super_user() OR r.role_name <> 'super_user')`. The bot calls RPCs
 * on the service-role key with no portal session, so that guard evaluated false and a super user's
 * 32 grants came back as 0 rows — the menu denied itself to the one role meant to see all of it.
 *
 * There were two ways to fix it and only one is safe. Widening the portal function's guard to
 * admit the service role would have loosened a function anon and authenticated can both execute.
 * The safe fix is a SEPARATE reader granted to service_role only. This script exists to stop
 * anyone "simplifying" it back, in either direction:
 *
 *   1. The bot must call whatsapp_role_feature_keys, never get_role_features_for_role.
 *   2. whatsapp_role_feature_keys must be granted to service_role and NOT to anon/authenticated.
 *   3. get_role_features_for_role must still carry its super_user guard somewhere in migrations/.
 *
 * Follows the same `.ts` discipline as verify-wa-plumbing.mjs and verify-wa-staff-menu.mjs: `.ts`
 * type annotations are not valid JS, so this script never evaluates the edge function — it asserts
 * textually against the real source, and the failure message names the file to fix.
 *
 * Pure fs reads. No network, no database, no browser, no dependency — safe for test:fleet.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const REL_MIGRATION = 'migrations/20260907120000_whatsapp_role_feature_keys.sql';
const REL_INBOUND = 'supabase/functions/whatsapp-inbound/index.ts';
const REL_MIGRATIONS_DIR = 'migrations';

const NEW_FN = 'whatsapp_role_feature_keys';
const PORTAL_FN = 'get_role_features_for_role';

/** Normalise CRLF before any comparison — same reason as verify-wa-plumbing.mjs. */
function readFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\r\n').join('\n');
}

const migrationSrc = readFile(REL_MIGRATION);
const inboundSrc = readFile(REL_INBOUND);

// ---- tiny harness (same shape as the sibling verifiers) -------------------------------------
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
 * The body of loadFeatureKeys, isolated so an assertion about "the bot's feature read" cannot be
 * accidentally satisfied by a mention of the same RPC name in a comment elsewhere in the file.
 */
function loadFeatureKeysBody() {
  const start = inboundSrc.indexOf('async function loadFeatureKeys');
  if (start === -1) {
    fail(
      `${REL_INBOUND}: could not find "async function loadFeatureKeys". If it was renamed, update ` +
        `this verifier to match — do not delete the assertion.`
    );
  }
  // Walk to the matching close brace of the function body.
  const open = inboundSrc.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < inboundSrc.length; i++) {
    const c = inboundSrc[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return inboundSrc.slice(start, i + 1);
    }
  }
  fail(`${REL_INBOUND}: loadFeatureKeys body is not brace-balanced — cannot verify it.`);
}

// ---- 1. the bot reads its own function, not the portal's ------------------------------------

check('loadFeatureKeys calls whatsapp_role_feature_keys', () => {
  const body = loadFeatureKeysBody();
  if (!body.includes(`rpc('${NEW_FN}'`)) {
    fail(
      `${REL_INBOUND}: loadFeatureKeys must call rpc('${NEW_FN}'). The bot runs on the ` +
        `service-role key with no portal session, so ${PORTAL_FN} returns ZERO rows for ` +
        `super_user and the menu denies itself. See ${REL_MIGRATION}.`
    );
  }
});

check(`loadFeatureKeys does NOT call ${PORTAL_FN}`, () => {
  const body = loadFeatureKeysBody();
  if (body.includes(`rpc('${PORTAL_FN}'`)) {
    fail(
      `${REL_INBOUND}: loadFeatureKeys must not call rpc('${PORTAL_FN}') — its ` +
        `portal_actor_is_super_user() guard is false for the service role, which is the exact ` +
        `fault ${REL_MIGRATION} fixes. Call ${NEW_FN} instead.`
    );
  }
});

check('loadFeatureKeys still fails closed to an empty set', () => {
  const body = loadFeatureKeysBody();
  // Three exits — no roleId, an error, a throw — must all yield an empty Set, never a full menu.
  const emptyReturns = (body.match(/return new Set\(\)/g) || []).length;
  if (emptyReturns < 3) {
    fail(
      `${REL_INBOUND}: loadFeatureKeys must return an empty Set on every failure path (no role ` +
        `id, RPC error, thrown error) — found ${emptyReturns} of the 3 expected ` +
        `"return new Set()" exits. An unreadable permission table must never widen what somebody ` +
        `can read over WhatsApp.`
    );
  }
  if (!/catch\s*\(/.test(body)) {
    fail(`${REL_INBOUND}: loadFeatureKeys must keep its try/catch — a throw must not reach the caller.`);
  }
});

check('loadFeatureKeys still admits only value === \'true\'', () => {
  const body = loadFeatureKeysBody();
  if (!body.includes("=== 'true'")) {
    fail(
      `${REL_INBOUND}: loadFeatureKeys must keep the explicit === 'true' test. ${NEW_FN} filters ` +
        `to granted rows in SQL, but the caller must not depend on that alone — a 'false' row ` +
        `arriving from any future caller must never read as a grant.`
    );
  }
});

// ---- 2. the new function is service_role only -----------------------------------------------

check(`${NEW_FN} is defined in its migration`, () => {
  if (!new RegExp(`CREATE OR REPLACE FUNCTION\\s+public\\.${NEW_FN}\\s*\\(`, 'i').test(migrationSrc)) {
    fail(`${REL_MIGRATION}: must CREATE OR REPLACE FUNCTION public.${NEW_FN}(uuid).`);
  }
});

check(`${NEW_FN} is SECURITY DEFINER with a pinned search_path`, () => {
  if (!/SECURITY DEFINER/i.test(migrationSrc)) {
    fail(`${REL_MIGRATION}: ${NEW_FN} must be SECURITY DEFINER — it reads role_features, which is revoked from every role but service_role.`);
  }
  if (!/SET search_path TO 'public'/i.test(migrationSrc)) {
    fail(
      `${REL_MIGRATION}: ${NEW_FN} must pin SET search_path TO 'public'. A SECURITY DEFINER ` +
        `function without a pinned search_path is resolvable against a caller-controlled schema.`
    );
  }
});

check(`${NEW_FN} is granted to service_role`, () => {
  if (!new RegExp(`GRANT EXECUTE ON FUNCTION\\s+public\\.${NEW_FN}\\(uuid\\)\\s+TO\\s+service_role`, 'i').test(migrationSrc)) {
    fail(`${REL_MIGRATION}: ${NEW_FN} must GRANT EXECUTE ... TO service_role, or the bot cannot call it.`);
  }
});

check(`${NEW_FN} is revoked from anon and authenticated`, () => {
  for (const role of ['PUBLIC', 'anon', 'authenticated']) {
    const re = new RegExp(`REVOKE ALL ON FUNCTION\\s+public\\.${NEW_FN}\\(uuid\\)\\s+FROM\\s+${role}`, 'i');
    if (!re.test(migrationSrc)) {
      fail(
        `${REL_MIGRATION}: ${NEW_FN} must be REVOKEd from ${role}. This function has no actor ` +
          `guard — it is safe ONLY because service_role is the only grantee. The browser calls ` +
          `PostgREST as anon with a committed key, so an anon grant here would let anyone read ` +
          `any role's grants.`
      );
    }
  }
});

check(`${NEW_FN} is never granted to anon or authenticated`, () => {
  const re = new RegExp(`GRANT[^;]*ON FUNCTION\\s+public\\.${NEW_FN}[^;]*TO[^;]*\\b(anon|authenticated)\\b`, 'i');
  if (re.test(migrationSrc)) {
    fail(
      `${REL_MIGRATION}: ${NEW_FN} must not be granted to anon or authenticated. The portal keeps ` +
        `using ${PORTAL_FN}, whose guard is what stops a non-super-user reading a super user's grants.`
    );
  }
});

// ---- 3. the portal's guard is still there ---------------------------------------------------

check(`${PORTAL_FN} still carries its super_user guard somewhere in ${REL_MIGRATIONS_DIR}/`, () => {
  const dir = path.join(ROOT, REL_MIGRATIONS_DIR);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  let guarded = false;
  let definedIn = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8').split('\r\n').join('\n');
    if (!new RegExp(`FUNCTION\\s+public\\.${PORTAL_FN}\\s*\\(`, 'i').test(src)) continue;
    definedIn.push(f);
    // The guard, tolerant of whitespace and of the two operands appearing in either order.
    if (/portal_actor_is_super_user\s*\(\s*\)/i.test(src) && /role_name\s*<>\s*'super_user'/i.test(src)) {
      guarded = true;
    }
  }
  if (definedIn.length === 0) {
    fail(
      `${REL_MIGRATIONS_DIR}/: no migration defines public.${PORTAL_FN}. If the portal function ` +
        `was intentionally removed, update this verifier deliberately — do not delete the check.`
    );
  }
  if (!guarded) {
    fail(
      `${REL_MIGRATIONS_DIR}/: the latest definition of public.${PORTAL_FN} (in ` +
        `${definedIn.join(', ')}) no longer carries BOTH portal_actor_is_super_user() and ` +
        `role_name <> 'super_user'. That guard is the only thing stopping a merely-admin portal ` +
        `actor reading a super user's grants. The WhatsApp bot has its own reader (${NEW_FN}) ` +
        `precisely so this guard never has to be widened — do not widen it.`
    );
  }
});

// ---- report ---------------------------------------------------------------------------------

if (failures.length) {
  console.error(`\nwa-role-features:verify FAILED — ${failures.length} of ${failures.length + passCount} checks\n`);
  for (const f of failures) {
    console.error(`  ✗ ${f.description}`);
    console.error(`    ${f.message}\n`);
  }
  process.exit(1);
}
console.log(`wa-role-features:verify passed — ${passCount} checks`);
