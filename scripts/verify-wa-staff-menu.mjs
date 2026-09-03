#!/usr/bin/env node
/**
 * wa-staff-menu:verify — regression check for the staff WhatsApp enrolment + menu path:
 *   supabase/functions/whatsapp-enrol-staff/index.ts   (mints and texts the enrolment code)
 *   supabase/functions/whatsapp-inbound/index.ts       (the menu, and reply-id dispatch)
 *   WebPortal/modules/modals/modal-user/{html,js}      (the admin-side Send enrolment code UI)
 *   WebPortal/js/data-functions.js                     (the browser's call into the edge function)
 *
 * Follows the same `.ts` discipline as scripts/verify-wa-plumbing.mjs, and for the same reason:
 * `.ts` type annotations are not valid JS and cannot be loaded into a `vm` context, so this script
 * never evaluates a `.ts` file. Pure helpers get a literal-presence assertion plus a re-declared
 * plain-JS copy that the behavioural cases run against; anything impure (a send, an RPC, a DOM
 * handler) gets a textual assertion only. Silent drift is impossible — a changed `.ts` fails the
 * presence assertion and the message names what to update.
 *
 * MENU_ITEMS is the exception, deliberately. Its rows carry `render` closures, so re-declaring the
 * whole array here would mean maintaining a second copy of every report's wording — a copy that
 * would drift and prove nothing. Instead the item TABLE (action/title/feature) is parsed out of
 * the real source and the invariants are asserted against the real data: that is what actually
 * has to hold.
 *
 * No dependency, no test framework, no node --test. node:assert is sufficient.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const REL_INBOUND = 'supabase/functions/whatsapp-inbound/index.ts';
const REL_ENROL = 'supabase/functions/whatsapp-enrol-staff/index.ts';
const REL_LIMITS = 'supabase/functions/_shared/wa-limits.ts';
const REL_MODAL_HTML = 'WebPortal/modules/modals/modal-user/html/modal_user.html';
const REL_MODAL_JS = 'WebPortal/modules/modals/modal-user/js/modal_user.js';
const REL_DATA_FN = 'WebPortal/js/data-functions.js';

/** Normalise CRLF before any comparison — same reason as verify-wa-plumbing.mjs:41-45. */
function readFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\r\n').join('\n');
}

const inboundSrc = readFile(REL_INBOUND);
const enrolSrc = readFile(REL_ENROL);
const limitsSrc = readFile(REL_LIMITS);
const modalHtml = readFile(REL_MODAL_HTML);
const modalJs = readFile(REL_MODAL_JS);
const dataFnSrc = readFile(REL_DATA_FN);

// ---- tiny test harness (same shape as verify-wa-plumbing.mjs:54-63) --------------------------
const failures = [];
let passCount = 0;
function check(description, fn) {
  try {
    fn();
    passCount++;
  } catch (err) {
    failures.push(`${description}: ${err && err.message ? err.message : err}`);
  }
}

function block(lines) {
  return lines.join('\n');
}

function assertPresent(source, relPath, label, literal) {
  if (!source.includes(literal)) {
    throw new Error(
      `${relPath}: "${label}" no longer matches the literal source block this script re-declares. ` +
        `Update both the .ts file and this script's copy together.`
    );
  }
}

// ================================================================================================
// 1. The reserved-key convention: 0 = back, 99 = main menu, never the legacy 9.
// ================================================================================================

check("COMMAND_HANDLERS registers '0' and '99'", () => {
  assert.ok(inboundSrc.includes("'0': commandMenu"), "expected \"'0': commandMenu\" in COMMAND_HANDLERS");
  assert.ok(inboundSrc.includes("'99': commandMenu"), "expected \"'99': commandMenu\" in COMMAND_HANDLERS");
});

check("the legacy '9' is never registered as a navigation key", () => {
  assert.ok(
    !/'9':\s*command/.test(inboundSrc),
    "whatsapp-inbound registers a '9' handler — 0 is back and 99 is main menu, and 9 is the retired key"
  );
});

check('the verb lookup is guarded with hasOwnProperty', () => {
  // COMMAND_HANDLERS is a plain object, so a bare index also resolves Object.prototype members
  // and would invoke one as a handler. `verb` is attacker-controlled text off a public WhatsApp
  // line, so the guard is explicit rather than left to the accident that no prototype member is
  // spelled in capitals.
  assert.ok(
    inboundSrc.includes('Object.prototype.hasOwnProperty.call(COMMAND_HANDLERS, verb)'),
    'expected handleCommand to guard the COMMAND_HANDLERS lookup with hasOwnProperty'
  );
  assert.ok(
    !/const handler = COMMAND_HANDLERS\[verb\]/.test(inboundSrc),
    'the unguarded COMMAND_HANDLERS[verb] lookup is back'
  );
});

// ================================================================================================
// 2. Dispatch is on the reply ID, never on the row's display title.
// ================================================================================================

check('a menu tap dispatches through parseReplyId, not the reply title', () => {
  assert.ok(
    inboundSrc.includes('parseReplyId(ctx.replyId)'),
    'expected handleCommand to parse ctx.replyId via parseReplyId'
  );
  assert.ok(
    !/replyTitle/.test(inboundSrc.replace(/^\s*\*.*$/gm, '')),
    'whatsapp-inbound dispatches on replyTitle somewhere outside a comment — titles are display ' +
      'text and must never select a command'
  );
});

check('rawBody for a tap carries the reply id, so the audit log records what was dispatched', () => {
  assert.ok(
    inboundSrc.includes('rawBody = classified.replyId'),
    'expected the interactive branch to log the reply id as rawBody'
  );
});

check('interactive and template-button message types both reach the dispatcher', () => {
  assert.ok(
    inboundSrc.includes("type === 'interactive' || type === 'button'"),
    "expected processCommandForMessage to accept both 'interactive' and 'button' message types"
  );
});

check('the 6-digit enrolment path stays text-only', () => {
  assert.ok(
    inboundSrc.includes('if (!replyId && /^\\d{6}$/.test(trimmedBody))'),
    'the unenrolled 6-digit enrolment branch must be guarded on !replyId — a tap is not a code'
  );
});

// ================================================================================================
// 3. The menu item table — parsed from the real source, invariants asserted on the real data.
// ================================================================================================

const ITEM_RE = /action:\s*'([^']+)',\s*\n\s*title:\s*'([^']+)',\s*\n\s*feature:\s*'([^']+)',/g;
const items = [...inboundSrc.matchAll(ITEM_RE)].map((m) => ({
  action: m[1],
  title: m[2],
  feature: m[3],
}));

check('MENU_ITEMS parses out of whatsapp-inbound', () => {
  assert.ok(
    items.length >= 1,
    'no MENU_ITEMS entries found — either the menu was removed or the item shape changed and this ' +
      'script\'s ITEM_RE needs updating alongside it'
  );
});

// MAX_LIST_TITLE / MAX_LIST_ROWS are read from wa-limits.ts rather than restated, so a change
// there cannot leave this script asserting a stale cap.
function limitFrom(name) {
  const m = limitsSrc.match(new RegExp(`export const ${name} = (\\d+);`));
  assert.ok(m, `could not read ${name} from ${REL_LIMITS}`);
  return Number(m[1]);
}

check('every row title fits MAX_LIST_TITLE (buildListBody THROWS above it, it does not truncate)', () => {
  const max = limitFrom('MAX_LIST_TITLE');
  for (const item of items) {
    assert.ok(
      item.title.length <= max,
      `row title ${JSON.stringify(item.title)} is ${item.title.length} chars, over the ${max} cap — ` +
        `buildListBody would throw and the member would get no menu at all`
    );
  }
});

check('the whole menu fits MAX_LIST_ROWS even with every feature enabled', () => {
  const max = limitFrom('MAX_LIST_ROWS');
  assert.ok(
    items.length <= max,
    `${items.length} menu items exceeds the ${max}-row cap; visibleItems() slices to it, but the ` +
      `items past the cap would be silently unreachable`
  );
});

// The segment rule is wa-send.ts's own REPLY_SEGMENT_RE. buildReplyId throws on a violation, so an
// invalid action means commandMenu raises instead of sending.
const REPLY_SEGMENT_RE = /^[a-z0-9][a-z0-9_-]{0,23}$/;

check('every action is a valid buildReplyId segment', () => {
  for (const item of items) {
    assert.ok(
      REPLY_SEGMENT_RE.test(item.action),
      `action ${JSON.stringify(item.action)} is not a valid reply-id segment — buildReplyId would throw`
    );
  }
});

check('actions are unique (a duplicate would make one item unreachable)', () => {
  const seen = new Set();
  for (const item of items) {
    assert.ok(!seen.has(item.action), `duplicate action ${JSON.stringify(item.action)}`);
    seen.add(item.action);
  }
});

check('every item is gated on a feature key', () => {
  for (const item of items) {
    assert.ok(
      item.feature && item.feature.trim().length > 0,
      `item ${JSON.stringify(item.action)} has no feature key — an ungated item would be readable ` +
        `by every enrolled role`
    );
  }
});

// ================================================================================================
// 4. Re-declared pure copies — the role filter and the two formatters.
// ================================================================================================

const VISIBLE_ITEMS_LITERAL = block([
  'function visibleItems(featureKeys: Set<string>): MenuItem[] {',
  "  // MAX_LIST_ROWS is Meta's cap for one list and buildListBody throws above it. MENU_ITEMS is",
  '  // well under it today; the slice means adding a seventh, eighth… item can never turn a menu',
  '  // send into a thrown error for a role that happens to have everything enabled.',
  '  return MENU_ITEMS.filter((i) => featureKeys.has(i.feature)).slice(0, MAX_LIST_ROWS);',
  '}',
]);

check('presence: whatsapp-inbound visibleItems', () => {
  assertPresent(inboundSrc, REL_INBOUND, 'visibleItems', VISIBLE_ITEMS_LITERAL);
});

// Identical plain-JS copy of the block asserted above.
const MAX_LIST_ROWS_COPY = limitFrom('MAX_LIST_ROWS');
function visibleItemsCopy(MENU_ITEMS, featureKeys) {
  return MENU_ITEMS.filter((i) => featureKeys.has(i.feature)).slice(0, MAX_LIST_ROWS_COPY);
}

check('visibleItems: a role with no features sees nothing', () => {
  const menu = [{ action: 'a', feature: 'f1' }, { action: 'b', feature: 'f2' }];
  assert.deepEqual(visibleItemsCopy(menu, new Set()), []);
});

check('visibleItems: only enabled features survive, in MENU_ITEMS order', () => {
  const menu = [
    { action: 'a', feature: 'f1' },
    { action: 'b', feature: 'f2' },
    { action: 'c', feature: 'f1' },
  ];
  assert.deepEqual(
    visibleItemsCopy(menu, new Set(['f1'])).map((i) => i.action),
    ['a', 'c']
  );
});

check('visibleItems: never returns more than MAX_LIST_ROWS rows', () => {
  const menu = Array.from({ length: MAX_LIST_ROWS_COPY + 5 }, (_, i) => ({
    action: `a${i}`,
    feature: 'f1',
  }));
  assert.equal(visibleItemsCopy(menu, new Set(['f1'])).length, MAX_LIST_ROWS_COPY);
});

const NUM_LITERAL = block([
  'function num(v: unknown, dp = 0): string {',
  "  if (v === null || v === undefined || v === '') return '—';",
  '  const n = Number(v);',
  "  if (!Number.isFinite(n)) return '—';",
  "  return n.toLocaleString('en-ZA', { minimumFractionDigits: dp, maximumFractionDigits: dp });",
  '}',
]);

check('presence: whatsapp-inbound num', () => {
  assertPresent(inboundSrc, REL_INBOUND, 'num', NUM_LITERAL);
});

// Identical plain-JS copy of the block asserted above.
function numCopy(v, dp = 0) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-ZA', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

check('num: an ABSENT figure is an em dash, never a real zero', () => {
  // The point of the explicit null guard: Number(null) and Number('') are both 0, and 0 is
  // finite, so a Number.isFinite check alone would report "no target set" as "0 kg". The live
  // digest returns genuine nulls for runway.weeks_cover and produced_vs_target.target_kg.
  assert.equal(numCopy(null), '—');
  assert.equal(numCopy(undefined), '—');
  assert.equal(numCopy(''), '—');
  assert.equal(numCopy('not a number'), '—');
});

check('num: a real zero still renders as zero', () => {
  assert.equal(numCopy(0), '0');
  assert.equal(numCopy('0'), '0');
});

check('num: honours the decimal places asked for, in the portal-wide en-ZA form', () => {
  // Expected values are COMPUTED, not spelled out: en-ZA punctuates as "21 591,36" (space
  // thousands, comma decimal) and hardcoding that here would just re-test Node's own ICU. What
  // matters is that dp is honoured and the locale is the one the portal already uses.
  const expect2 = (21591.36).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const expect0 = (21591.36).toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  assert.equal(numCopy(21591.36, 2), expect2);
  assert.equal(numCopy(21591.36, 0), expect0);
  assert.notEqual(expect2, expect0, 'dp must actually change the output');
});

const PCT_LITERAL = block([
  'function pct(v: unknown): string {',
  "  if (v === null || v === undefined || v === '') return '—';",
  '  const n = Number(v);',
  "  return Number.isFinite(n) ? `${n.toFixed(1)}%` : '—';",
  '}',
]);

check('presence: whatsapp-inbound pct', () => {
  assertPresent(inboundSrc, REL_INBOUND, 'pct', PCT_LITERAL);
});

function pctCopy(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return Number.isFinite(n) ? `${n.toFixed(1)}%` : '—';
}

check('pct: one decimal place, em dash when absent, 0% when genuinely zero', () => {
  assert.equal(pctCopy(12.34), '12.3%');
  assert.equal(pctCopy(0), '0.0%');
  assert.equal(pctCopy(null), '—');
  assert.equal(pctCopy(undefined), '—');
});

// ================================================================================================
// 5. A tap is a request, not an authorisation.
// ================================================================================================

check('renderMenuItem re-checks the role before rendering', () => {
  const fn = inboundSrc.slice(inboundSrc.indexOf('async function renderMenuItem'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.ok(
    body.includes('loadFeatureKeys(ctx.sb, ctx.roleId)'),
    'renderMenuItem must reload the role features — a reply id can arrive from a menu sent before ' +
      'the role changed, or be replayed by hand'
  );
  assert.ok(
    body.includes('visibleItems('),
    'renderMenuItem must resolve the action against the role\'s CURRENT visible set'
  );
});

check('loadFeatureKeys fails closed to an empty set', () => {
  const fn = inboundSrc.slice(inboundSrc.indexOf('async function loadFeatureKeys'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  const returns = [...body.matchAll(/return\s+new Set\(\)/g)];
  assert.ok(
    returns.length >= 3,
    'expected every failure path in loadFeatureKeys (no role, RPC error, throw) to return an empty ' +
      `Set; found ${returns.length}`
  );
  assert.ok(
    !/return\s+new Set\(Object\.keys/.test(body),
    'loadFeatureKeys must never fall back to a full feature set'
  );
});

// ================================================================================================
// 6. The enrolment edge function.
// ================================================================================================

check('whatsapp-enrol-staff never returns or logs the code', () => {
  // The RPC hands us `started.code`; it may appear exactly twice — assigned, and interpolated into
  // the WhatsApp message. Anywhere else (a response body, a console line) would defeat the point.
  const occurrences = [...enrolSrc.matchAll(/\bcode\b/g)];
  assert.ok(occurrences.length > 0, 'expected the function to read a code at all');
  assert.ok(
    !/json\(\{[^}]*\bcode:/s.test(enrolSrc),
    'the enrolment code must never appear in a JSON response body'
  );
  assert.ok(
    !/console\.(log|error|warn)\([^)]*\$\{code\}/.test(enrolSrc),
    'the enrolment code must never be interpolated into a log line'
  );
});

check('whatsapp-enrol-staff checks admin.users.manage BEFORE minting', () => {
  const permIdx = enrolSrc.indexOf('whatsapp_user_manages_users');
  const mintIdx = enrolSrc.indexOf('whatsapp_start_enrolment', permIdx > -1 ? permIdx : 0);
  assert.ok(permIdx > -1, 'expected a whatsapp_user_manages_users check');
  assert.ok(mintIdx > permIdx, 'the permission check must run before whatsapp_start_enrolment');
});

check('whatsapp-enrol-staff derives the requesting user from the session, never the request body', () => {
  assert.ok(
    enrolSrc.includes('p_requesting_user_id: requestingUserId'),
    'expected p_requesting_user_id to come from the validated session'
  );
  assert.ok(
    !/p_requesting_user_id:\s*(body|String\(body)/.test(enrolSrc),
    'p_requesting_user_id must never be read from the request body — it would be an unauthenticated claim'
  );
});

check('whatsapp-enrol-staff refuses a closed 24-hour window before minting a code', () => {
  // Anchored on the CALL SITE, not the bare RPC name: that name also appears several times in the
  // file's doc header, so an indexOf on it alone finds a comment and compares the wrong things.
  const windowIdx = enrolSrc.indexOf('window_closed');
  const mintIdx = enrolSrc.indexOf("rpc(sb, 'whatsapp_start_enrolment'");
  assert.ok(windowIdx > -1, 'expected a window_closed refusal');
  assert.ok(mintIdx > -1, "expected a rpc(sb, 'whatsapp_start_enrolment' call site");
  assert.ok(
    windowIdx < mintIdx,
    'the window check must refuse before whatsapp_start_enrolment is called, or a code is burnt on ' +
      'a message Meta will drop'
  );
});

check('whatsapp-enrol-staff canonicalises the phone in the DATABASE, not locally', () => {
  assert.ok(
    enrolSrc.includes("sb.rpc('chat_normalize_phone'"),
    'expected the phone to be canonicalised via chat_normalize_phone'
  );
  // scripts/verify-report-whatsapp-parity.mjs asserts an exact count of files carrying this
  // idiom. A local normaliser here would break that gate AND add a seventh copy of a function
  // whose SA rules must not be re-implemented (see _shared/wa-send.ts on toWaPhone).
  assert.ok(
    !enrolSrc.includes('replace(/\\D/g'),
    'whatsapp-enrol-staff must not re-implement phone normalisation'
  );
});

// ================================================================================================
// 7. The admin-side UI.
// ================================================================================================

check('the modal carries the enrolment section, hidden by default', () => {
  assert.ok(modalHtml.includes('id="whatsappEnrolSection"'), 'expected #whatsappEnrolSection');
  assert.ok(modalHtml.includes('id="btnSendEnrolCode"'), 'expected #btnSendEnrolCode');
  assert.ok(
    /id="whatsappEnrolSection"[^>]*style="display: none;"/.test(modalHtml),
    'the section must start hidden — there is nothing to enrol against while adding a user'
  );
});

check('the modal uses btn-primary, not the banned btn-success', () => {
  // ui:verify bans btn-success repo-wide (btn-primary is the one filled green). Asserted here too
  // so this button is covered even if the section is moved to another file.
  const section = modalHtml.slice(modalHtml.indexOf('id="whatsappEnrolSection"'));
  const sectionEnd = section.indexOf('</div>\n                        </div>');
  assert.ok(
    !section.slice(0, sectionEnd > -1 ? sectionEnd : 800).includes('btn-success'),
    'btn-success is banned by the design standard'
  );
});

check('the Send-code listener is guarded against a double attach', () => {
  assert.ok(
    modalJs.includes("enrolBtn.getAttribute('data-listener-bound') !== 'true'"),
    'init() runs from two places (this file and appRouter.js) — without the guard a click would ' +
      'send two enrolment codes, and only the second would still be valid'
  );
});

check('clearForm resets the enrolment section', () => {
  const fn = modalJs.slice(modalJs.indexOf('clearForm: function'));
  const body = fn.slice(0, fn.indexOf('\n        },'));
  assert.ok(
    body.includes("getElementById('whatsappEnrolSection')"),
    'form.reset() cannot clear a script-set pill — a stale "Enrolled" badge would show on the next user'
  );
});

check('the modal never writes the enrolment status with innerHTML from raw user data', () => {
  const fn = modalJs.slice(modalJs.indexOf('renderEnrolmentStatus: function'));
  const body = fn.slice(0, fn.indexOf('\n        },'));
  // The pill comes from MacStatus.pill (which escapes its own label) or the escapeHtml fallback;
  // the phone number goes in as textContent. Neither may become raw innerHTML.
  assert.ok(
    !/innerHTML\s*=\s*[^;]*enrolledPhone/.test(body),
    'the stored phone number must be set with textContent, never innerHTML'
  );
  assert.ok(
    body.includes('helpEl.textContent'),
    'expected the help line to be set with textContent'
  );
});

check('data-functions sends the session token and posts to whatsapp-enrol-staff', () => {
  const fn = dataFnSrc.slice(dataFnSrc.indexOf('sendWhatsappEnrolmentCode: async function'));
  const body = fn.slice(0, fn.indexOf('\n        },'));
  assert.ok(body.includes("'/functions/v1/whatsapp-enrol-staff'"), 'expected the edge-function path');
  assert.ok(body.includes("'X-Portal-Session': authToken"), 'expected the portal session header');
  assert.ok(
    body.includes('if (!authToken)'),
    'must refuse to issue the fetch at all without a real portal session'
  );
});

// ================================================================================================
// Report
// ================================================================================================

if (failures.length > 0) {
  console.error(`\nWA STAFF MENU VERIFY FAILED (${failures.length} of ${failures.length + passCount}):\n`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error('');
  process.exit(1);
}

console.log(
  `WA STAFF MENU VERIFY OK (${passCount} checks passed; ${items.length} menu items validated).`
);
