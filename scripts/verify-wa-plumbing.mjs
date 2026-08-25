#!/usr/bin/env node
/**
 * wa-plumbing:verify — regression check for the shared WhatsApp send/parse plumbing added under
 * supabase/functions/_shared/ (wa-limits.ts, wa-send.ts, wa-inbound.ts).
 *
 * How this stays honest for `.ts` — this is fixed, do not improvise. `.ts` type annotations are
 * not valid JS and cannot be loaded into a `vm` context (see
 * scripts/verify-report-whatsapp-payload.mjs:12-19 and the parity script's "Models followed"
 * note). This script does NOT hand-roll a TS-stripper and does NOT add a transpiler. It follows
 * the repo's documented `.ts` pattern instead: assert the exact function source block is still
 * present VERBATIM in the `.ts` file, then re-declare an identical plain-JS copy inside this
 * script and run every behavioural case against that copy. If a future edit changes the `.ts`,
 * the presence assertion fails loudly and names what to update — silent drift is impossible,
 * only a caught one.
 *
 * No `Deno` shim is needed anywhere in this script: no `.ts` file is ever evaluated, so
 * module-scope `Deno.env.get(...)` calls in wa-send.ts are never touched.
 *
 * Decision rule (no judgement call left open): every PURE function gets both a literal-presence
 * assertion and a re-declared-copy behavioural test. Anything that is NOT pure
 * (sendViaControlRoom, sendText, verifyControlRoomSignature, the module-scope env constants)
 * gets a literal/substring assertion only.
 *
 * No dependency, no test framework, no node --test. node:assert is sufficient.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const WA_LIMITS_PATH = path.join(ROOT, 'supabase/functions/_shared/wa-limits.ts');
const WA_SEND_PATH = path.join(ROOT, 'supabase/functions/_shared/wa-send.ts');
const WA_INBOUND_PATH = path.join(ROOT, 'supabase/functions/_shared/wa-inbound.ts');
const SEND_REPORT_PATH = path.join(ROOT, 'supabase/functions/send-report-whatsapp/index.ts');

function readFile(full) {
  return fs.readFileSync(full, 'utf8');
}

const waLimitsSrc = readFile(WA_LIMITS_PATH);
const waSendSrc = readFile(WA_SEND_PATH);
const waInboundSrc = readFile(WA_INBOUND_PATH);
const sendReportSrc = readFile(SEND_REPORT_PATH);

// ---- tiny test harness (same shape as verify-report-whatsapp-picker.mjs:72) -------------------
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

const REL_WA_LIMITS = 'supabase/functions/_shared/wa-limits.ts';
const REL_WA_SEND = 'supabase/functions/_shared/wa-send.ts';
const REL_WA_INBOUND = 'supabase/functions/_shared/wa-inbound.ts';

// ================================================================================================
// 1. Base-URL drift, without writing the URL into this script.
// ================================================================================================

check('wa-send.ts fallback base URL matches send-report-whatsapp/index.ts', () => {
  const m = sendReportSrc.match(/const CONTROL_ROOM_BASE_URL = '([^']+)';/);
  assert.ok(m, 'could not find CONTROL_ROOM_BASE_URL literal in send-report-whatsapp/index.ts');
  const url = m[1];
  assert.ok(
    waSendSrc.includes(url),
    `wa-send.ts does not contain the same fallback URL (${JSON.stringify(url)}) as send-report-whatsapp/index.ts`
  );
});

// ================================================================================================
// 2. content:{text} shape, not content:{body}.
// ================================================================================================

check('wa-send.ts uses content:{text}, never content:{body}', () => {
  assert.ok(waSendSrc.includes('content: { text'), 'expected literal "content: { text" in wa-send.ts');
  assert.ok(!waSendSrc.includes('content: { body'), 'wa-send.ts must never contain "content: { body"');
});

// ================================================================================================
// Re-declared pure copies — wa-limits.ts
// ================================================================================================

const TRUNCATE_LITERAL = block([
  "export function truncate(s: string, max: number): string {",
  '  if (s.length <= max) return s;',
  '  if (max <= 1) return s.slice(0, max);',
  "  return s.slice(0, max - 1) + '…';",
  '}',
]);

check('presence: wa-limits.ts truncate', () => {
  assertPresent(waLimitsSrc, REL_WA_LIMITS, 'truncate', TRUNCATE_LITERAL);
});

function truncate(s, max) {
  if (s.length <= max) return s;
  if (max <= 1) return s.slice(0, max);
  return s.slice(0, max - 1) + '…';
}

const PAGINATE_ROWS_LITERAL = block([
  'export function paginateRows<T>(',
  '  rows: T[],',
  '  maxRows: number,',
  '  moreLabel?: string',
  '): { page: T[]; hasMore: boolean } {',
  '  if (rows.length <= maxRows) {',
  '    return { page: rows, hasMore: false };',
  '  }',
  "  const canReserve = typeof moreLabel === 'string' && moreLabel.length > 0 && maxRows > 1;",
  '  const pageSize = canReserve ? maxRows - 1 : maxRows;',
  '  return { page: rows.slice(0, pageSize), hasMore: true };',
  '}',
]);

check('presence: wa-limits.ts paginateRows', () => {
  assertPresent(waLimitsSrc, REL_WA_LIMITS, 'paginateRows', PAGINATE_ROWS_LITERAL);
});

function paginateRows(rows, maxRows, moreLabel) {
  if (rows.length <= maxRows) {
    return { page: rows, hasMore: false };
  }
  const canReserve = typeof moreLabel === 'string' && moreLabel.length > 0 && maxRows > 1;
  const pageSize = canReserve ? maxRows - 1 : maxRows;
  return { page: rows.slice(0, pageSize), hasMore: true };
}

// ================================================================================================
// Re-declared pure copies — wa-send.ts
// ================================================================================================

class WaSendError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WaSendError';
  }
}

const MAX_LIST_TITLE = 24;
const MAX_LIST_SECTION = 24;
const MAX_BUTTON_CTA = 20;
const MAX_BUTTONS = 3;
const MAX_LIST_ROWS = 10;
const MAX_REPLY_ID = 74;

const BUILD_TEXT_BODY_LITERAL = block([
  'export function buildTextBody(to: string, text: string): WaMessageBody {',
  "  if (!text || !text.trim()) {",
  "    throw new WaSendError('buildTextBody: text must not be empty.');",
  '  }',
  "  return { to, type: 'text', content: { text } };",
  '}',
]);

check('presence: wa-send.ts buildTextBody', () => {
  assertPresent(waSendSrc, REL_WA_SEND, 'buildTextBody', BUILD_TEXT_BODY_LITERAL);
});

function buildTextBody(to, text) {
  if (!text || !text.trim()) {
    throw new WaSendError('buildTextBody: text must not be empty.');
  }
  return { to, type: 'text', content: { text } };
}

const BUILD_BUTTONS_BODY_LITERAL = block([
  "export function buildButtonsBody(to: string, bodyText: string, buttons: WaButton[]): WaMessageBody {",
  '  if (!buttons || buttons.length === 0) {',
  "    throw new WaSendError('buildButtonsBody: buttons must not be empty.');",
  '  }',
  '  if (buttons.length > MAX_BUTTONS) {',
  '    throw new WaSendError(`buildButtonsBody: at most ${MAX_BUTTONS} buttons are allowed, got ${buttons.length}.`);',
  '  }',
  '  for (const b of buttons) {',
  '    if (b.title.length > MAX_BUTTON_CTA) {',
  '      throw new WaSendError(',
  '        `buildButtonsBody: button title exceeds ${MAX_BUTTON_CTA} characters: ${JSON.stringify(b.title)}`',
  '      );',
  '    }',
  '  }',
  '  return {',
  '    to,',
  "    type: 'interactive',",
  '    content: {',
  "      type: 'button',",
  '      body: { text: bodyText },',
  '      action: {',
  "        buttons: buttons.map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title } })),",
  '      },',
  '    },',
  '  };',
  '}',
]);

check('presence: wa-send.ts buildButtonsBody', () => {
  assertPresent(waSendSrc, REL_WA_SEND, 'buildButtonsBody', BUILD_BUTTONS_BODY_LITERAL);
});

function buildButtonsBody(to, bodyText, buttons) {
  if (!buttons || buttons.length === 0) {
    throw new WaSendError('buildButtonsBody: buttons must not be empty.');
  }
  if (buttons.length > MAX_BUTTONS) {
    throw new WaSendError(`buildButtonsBody: at most ${MAX_BUTTONS} buttons are allowed, got ${buttons.length}.`);
  }
  for (const b of buttons) {
    if (b.title.length > MAX_BUTTON_CTA) {
      throw new WaSendError(
        `buildButtonsBody: button title exceeds ${MAX_BUTTON_CTA} characters: ${JSON.stringify(b.title)}`
      );
    }
  }
  return {
    to,
    type: 'interactive',
    content: {
      type: 'button',
      body: { text: bodyText },
      action: {
        buttons: buttons.map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title } })),
      },
    },
  };
}

const BUILD_LIST_BODY_LITERAL = block([
  'export function buildListBody(',
  '  to: string,',
  '  bodyText: string,',
  '  buttonLabel: string,',
  '  sections: WaListSection[]',
  '): WaMessageBody {',
  '  if (!sections || sections.length === 0) {',
  "    throw new WaSendError('buildListBody: sections must not be empty.');",
  '  }',
  '  let totalRows = 0;',
  '  for (const section of sections) {',
  '    if (section.title.length > MAX_LIST_SECTION) {',
  '      throw new WaSendError(',
  '        `buildListBody: section title exceeds ${MAX_LIST_SECTION} characters: ${JSON.stringify(section.title)}`',
  '      );',
  '    }',
  '    for (const row of section.rows) {',
  '      if (row.title.length > MAX_LIST_TITLE) {',
  '        throw new WaSendError(',
  '          `buildListBody: row title exceeds ${MAX_LIST_TITLE} characters: ${JSON.stringify(row.title)}`',
  '        );',
  '      }',
  '      totalRows++;',
  '    }',
  '  }',
  '  if (totalRows > MAX_LIST_ROWS) {',
  '    throw new WaSendError(`buildListBody: at most ${MAX_LIST_ROWS} rows total are allowed, got ${totalRows}.`);',
  '  }',
  '  return {',
  '    to,',
  "    type: 'interactive',",
  '    content: {',
  "      type: 'list',",
  '      body: { text: bodyText },',
  '      action: { button: buttonLabel, sections },',
  '    },',
  '  };',
  '}',
]);

check('presence: wa-send.ts buildListBody', () => {
  assertPresent(waSendSrc, REL_WA_SEND, 'buildListBody', BUILD_LIST_BODY_LITERAL);
});

function buildListBody(to, bodyText, buttonLabel, sections) {
  if (!sections || sections.length === 0) {
    throw new WaSendError('buildListBody: sections must not be empty.');
  }
  let totalRows = 0;
  for (const section of sections) {
    if (section.title.length > MAX_LIST_SECTION) {
      throw new WaSendError(
        `buildListBody: section title exceeds ${MAX_LIST_SECTION} characters: ${JSON.stringify(section.title)}`
      );
    }
    for (const row of section.rows) {
      if (row.title.length > MAX_LIST_TITLE) {
        throw new WaSendError(
          `buildListBody: row title exceeds ${MAX_LIST_TITLE} characters: ${JSON.stringify(row.title)}`
        );
      }
      totalRows++;
    }
  }
  if (totalRows > MAX_LIST_ROWS) {
    throw new WaSendError(`buildListBody: at most ${MAX_LIST_ROWS} rows total are allowed, got ${totalRows}.`);
  }
  return {
    to,
    type: 'interactive',
    content: {
      type: 'list',
      body: { text: bodyText },
      action: { button: buttonLabel, sections },
    },
  };
}

const URL_PARAM_RE_LITERAL = "const URL_PARAM_RE = /^https?:\\/\\//i;";

check('presence: wa-send.ts URL_PARAM_RE', () => {
  assertPresent(waSendSrc, REL_WA_SEND, 'URL_PARAM_RE', URL_PARAM_RE_LITERAL);
});

const BUILD_TEMPLATE_BODY_LITERAL = block([
  'export function buildTemplateBody(',
  '  to: string,',
  '  templateName: string,',
  '  languageCode: string,',
  '  components?: WaTemplateComponent[]',
  '): WaMessageBody {',
  '  if (components && components.length > 0) {',
  '    for (const c of components) {',
  "      if (c.type === 'button' && c.sub_type === 'url') {",
  '        for (const p of c.parameters) {',
  '          if (URL_PARAM_RE.test(p.text)) {',
  '            throw new WaSendError(',
  "              'buildTemplateBody: a url-button parameter must be only the suffix that replaces {{1}} ' +",
  "                `in the template's base URL, never a full URL. Got: ${JSON.stringify(p.text)}`",
  '            );',
  '          }',
  '        }',
  '      }',
  '    }',
  '  }',
  '',
  '  const content: Record<string, unknown> = {',
  '    name: templateName,',
  '    language: { code: languageCode },',
  '  };',
  '  if (components && components.length > 0) {',
  '    content.components = components;',
  '  }',
  "  return { to, type: 'template', content };",
  '}',
]);

check('presence: wa-send.ts buildTemplateBody', () => {
  assertPresent(waSendSrc, REL_WA_SEND, 'buildTemplateBody', BUILD_TEMPLATE_BODY_LITERAL);
});

const URL_PARAM_RE = /^https?:\/\//i;
function buildTemplateBody(to, templateName, languageCode, components) {
  if (components && components.length > 0) {
    for (const c of components) {
      if (c.type === 'button' && c.sub_type === 'url') {
        for (const p of c.parameters) {
          if (URL_PARAM_RE.test(p.text)) {
            throw new WaSendError(
              'buildTemplateBody: a url-button parameter must be only the suffix that replaces {{1}} ' +
                `in the template's base URL, never a full URL. Got: ${JSON.stringify(p.text)}`
            );
          }
        }
      }
    }
  }

  const content = {
    name: templateName,
    language: { code: languageCode },
  };
  if (components && components.length > 0) {
    content.components = components;
  }
  return { to, type: 'template', content };
}

const BUILD_REPLY_ID_LITERAL = block([
  'export function buildReplyId(ns: string, action: string, arg?: string): string {',
  '  const segments = arg === undefined ? [ns, action] : [ns, action, arg];',
  '  for (const seg of segments) {',
  '    if (!REPLY_SEGMENT_RE.test(seg)) {',
  '      throw new WaSendError(`buildReplyId: invalid segment ${JSON.stringify(seg)}.`);',
  '    }',
  '  }',
  "  const id = segments.join(':');",
  '  if (id.length > MAX_REPLY_ID) {',
  '    throw new WaSendError(`buildReplyId: id exceeds ${MAX_REPLY_ID} characters: ${JSON.stringify(id)}`);',
  '  }',
  '  return id;',
  '}',
]);

check('presence: wa-send.ts buildReplyId', () => {
  assertPresent(waSendSrc, REL_WA_SEND, 'buildReplyId', BUILD_REPLY_ID_LITERAL);
});

const REPLY_SEGMENT_RE = /^[a-z0-9][a-z0-9_-]{0,23}$/;
function buildReplyId(ns, action, arg) {
  const segments = arg === undefined ? [ns, action] : [ns, action, arg];
  for (const seg of segments) {
    if (!REPLY_SEGMENT_RE.test(seg)) {
      throw new WaSendError(`buildReplyId: invalid segment ${JSON.stringify(seg)}.`);
    }
  }
  const id = segments.join(':');
  if (id.length > MAX_REPLY_ID) {
    throw new WaSendError(`buildReplyId: id exceeds ${MAX_REPLY_ID} characters: ${JSON.stringify(id)}`);
  }
  return id;
}

const PARSE_REPLY_ID_LITERAL = block([
  "export function parseReplyId(id: string): { ns: string; action: string; arg?: string } | null {",
  "  if (typeof id !== 'string') return null;",
  "  const segments = id.split(':');",
  '  if (segments.length !== 2 && segments.length !== 3) return null;',
  '  for (const seg of segments) {',
  '    if (!REPLY_SEGMENT_RE.test(seg)) return null;',
  '  }',
  '  const [ns, action, arg] = segments;',
  '  return arg === undefined ? { ns, action } : { ns, action, arg };',
  '}',
]);

check('presence: wa-send.ts parseReplyId', () => {
  assertPresent(waSendSrc, REL_WA_SEND, 'parseReplyId', PARSE_REPLY_ID_LITERAL);
});

function parseReplyId(id) {
  if (typeof id !== 'string') return null;
  const segments = id.split(':');
  if (segments.length !== 2 && segments.length !== 3) return null;
  for (const seg of segments) {
    if (!REPLY_SEGMENT_RE.test(seg)) return null;
  }
  const [ns, action, arg] = segments;
  return arg === undefined ? { ns, action } : { ns, action, arg };
}

const TO_WA_PHONE_LITERAL = block([
  'export function toWaPhone(phone: string): string {',
  "  const digits = phone.replace(/\\D/g, '');",
  '  if (!digits) {',
  "    throw new WaSendError('toWaPhone: input contains no digits.');",
  '  }',
  '  return `+${digits}`;',
  '}',
]);

check('presence: wa-send.ts toWaPhone', () => {
  assertPresent(waSendSrc, REL_WA_SEND, 'toWaPhone', TO_WA_PHONE_LITERAL);
});

function toWaPhone(phone) {
  const digits = phone.replace(/\D/g, '');
  if (!digits) {
    throw new WaSendError('toWaPhone: input contains no digits.');
  }
  return `+${digits}`;
}

// ================================================================================================
// Re-declared pure copies — wa-inbound.ts
// ================================================================================================

const PARSE_SIGNATURE_HEADER_LITERAL = block([
  'export function parseSignatureHeader(header: unknown): string | null {',
  "  if (typeof header !== 'string') return null;",
  '  const trimmed = header.trim();',
  "  if (!trimmed.startsWith('sha256=')) return null;",
  "  const hex = trimmed.slice('sha256='.length);",
  '  if (!hex) return null;',
  '  if (!/^[0-9a-f]+$/i.test(hex)) return null;',
  '  return hex.toLowerCase();',
  '}',
]);

check('presence: wa-inbound.ts parseSignatureHeader', () => {
  assertPresent(waInboundSrc, REL_WA_INBOUND, 'parseSignatureHeader', PARSE_SIGNATURE_HEADER_LITERAL);
});

function parseSignatureHeader(header) {
  if (typeof header !== 'string') return null;
  const trimmed = header.trim();
  if (!trimmed.startsWith('sha256=')) return null;
  const hex = trimmed.slice('sha256='.length);
  if (!hex) return null;
  if (!/^[0-9a-f]+$/i.test(hex)) return null;
  return hex.toLowerCase();
}

const TIMING_SAFE_EQUAL_LITERAL = block([
  'export function timingSafeEqual(a: string, b: string): boolean {',
  '  const enc = new TextEncoder();',
  '  const ab = enc.encode(a);',
  '  const bb = enc.encode(b);',
  '  let diff = ab.length ^ bb.length;',
  '  const len = Math.max(ab.length, bb.length);',
  '  for (let i = 0; i < len; i++) {',
  '    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);',
  '  }',
  '  return diff === 0;',
  '}',
]);

check('presence: wa-inbound.ts timingSafeEqual', () => {
  assertPresent(waInboundSrc, REL_WA_INBOUND, 'timingSafeEqual', TIMING_SAFE_EQUAL_LITERAL);
});

function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

const SANITIZE_SENDER_NAME_LITERAL = block([
  'export function sanitizeSenderName(raw: unknown): string | undefined {',
  "  if (typeof raw !== 'string') return undefined;",
  "  const noNewlines = raw.replace(/[\\r\\n]+/g, ' ');",
  '  const trimmed = noNewlines.trim();',
  '  if (!trimmed) return undefined;',
  "  const firstWord = trimmed.split(/\\s+/)[0] ?? '';",
  '  const capped = firstWord.slice(0, 20);',
  '  if (!/\\p{L}/u.test(capped)) return undefined;',
  '  return capped;',
  '}',
]);

check('presence: wa-inbound.ts sanitizeSenderName', () => {
  assertPresent(waInboundSrc, REL_WA_INBOUND, 'sanitizeSenderName', SANITIZE_SENDER_NAME_LITERAL);
});

function sanitizeSenderName(raw) {
  if (typeof raw !== 'string') return undefined;
  const noNewlines = raw.replace(/[\r\n]+/g, ' ');
  const trimmed = noNewlines.trim();
  if (!trimmed) return undefined;
  const firstWord = trimmed.split(/\s+/)[0] ?? '';
  const capped = firstWord.slice(0, 20);
  if (!/\p{L}/u.test(capped)) return undefined;
  return capped;
}

const IS_NON_EMPTY_STRING_LITERAL = block([
  'function isNonEmptyString(v: unknown): v is string {',
  "  return typeof v === 'string' && v.length > 0;",
  '}',
]);

check('presence: wa-inbound.ts isNonEmptyString', () => {
  assertPresent(waInboundSrc, REL_WA_INBOUND, 'isNonEmptyString', IS_NON_EMPTY_STRING_LITERAL);
});

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

const CLASSIFY_MESSAGE_LITERAL = block([
  'export function classifyMessage(msg: unknown, senderName: string | undefined): ExtractedMessage {',
  "  if (!msg || typeof msg !== 'object') return { kind: 'unsupported' };",
  '  const m = msg as Record<string, unknown>;',
  '',
  '  const from = m.from;',
  '  const id = m.id;',
  '  const type = m.type;',
  '  if (!isNonEmptyString(from) || !isNonEmptyString(id) || !isNonEmptyString(type)) {',
  "    return { kind: 'unsupported' };",
  '  }',
  '',
  "  if (type === 'text') {",
  '    const text = (m.text as Record<string, unknown> | undefined)?.body;',
  '    if (isNonEmptyString(text)) {',
  "      return { kind: 'text', from, id, text, senderName };",
  '    }',
  "    return { kind: 'unsupported' };",
  '  }',
  '',
  "  if (type === 'interactive') {",
  '    const interactive = (m.interactive as Record<string, unknown> | undefined) ?? {};',
  '    const interactiveType = interactive.type;',
  "    if (interactiveType === 'button_reply') {",
  '      const br = (interactive.button_reply as Record<string, unknown> | undefined) ?? {};',
  '      if (isNonEmptyString(br.id) && isNonEmptyString(br.title)) {',
  "        return { kind: 'button_reply', from, id, replyId: br.id, replyTitle: br.title, senderName };",
  '      }',
  "      return { kind: 'unsupported' };",
  '    }',
  "    if (interactiveType === 'list_reply') {",
  '      const lr = (interactive.list_reply as Record<string, unknown> | undefined) ?? {};',
  '      if (isNonEmptyString(lr.id) && isNonEmptyString(lr.title)) {',
  "        return { kind: 'list_reply', from, id, replyId: lr.id, replyTitle: lr.title, senderName };",
  '      }',
  "      return { kind: 'unsupported' };",
  '    }',
  "    return { kind: 'unsupported' };",
  '  }',
  '',
  '  // A tap on a quick-reply button attached to an APPROVED TEMPLATE arrives as type:\'button\', not',
  "  // 'interactive'. See the function comment above for why this branch is not dead code.",
  "  if (type === 'button') {",
  '    const btn = (m.button as Record<string, unknown> | undefined) ?? {};',
  '    const text = btn.text;',
  '    const payload = btn.payload;',
  '    if (!isNonEmptyString(text) && !isNonEmptyString(payload)) {',
  "      return { kind: 'unsupported' };",
  '    }',
  '    const replyTitle = isNonEmptyString(text) ? text : (payload as string);',
  '    const replyId = isNonEmptyString(payload) ? payload : (text as string);',
  "    return { kind: 'button_reply', from, id, replyId, replyTitle, senderName };",
  '  }',
  '',
  "  return { kind: 'unsupported' };",
  '}',
]);

check('presence: wa-inbound.ts classifyMessage', () => {
  assertPresent(waInboundSrc, REL_WA_INBOUND, 'classifyMessage', CLASSIFY_MESSAGE_LITERAL);
});

function classifyMessage(msg, senderName) {
  if (!msg || typeof msg !== 'object') return { kind: 'unsupported' };
  const m = msg;

  const from = m.from;
  const id = m.id;
  const type = m.type;
  if (!isNonEmptyString(from) || !isNonEmptyString(id) || !isNonEmptyString(type)) {
    return { kind: 'unsupported' };
  }

  if (type === 'text') {
    const text = m.text?.body;
    if (isNonEmptyString(text)) {
      return { kind: 'text', from, id, text, senderName };
    }
    return { kind: 'unsupported' };
  }

  if (type === 'interactive') {
    const interactive = m.interactive ?? {};
    const interactiveType = interactive.type;
    if (interactiveType === 'button_reply') {
      const br = interactive.button_reply ?? {};
      if (isNonEmptyString(br.id) && isNonEmptyString(br.title)) {
        return { kind: 'button_reply', from, id, replyId: br.id, replyTitle: br.title, senderName };
      }
      return { kind: 'unsupported' };
    }
    if (interactiveType === 'list_reply') {
      const lr = interactive.list_reply ?? {};
      if (isNonEmptyString(lr.id) && isNonEmptyString(lr.title)) {
        return { kind: 'list_reply', from, id, replyId: lr.id, replyTitle: lr.title, senderName };
      }
      return { kind: 'unsupported' };
    }
    return { kind: 'unsupported' };
  }

  if (type === 'button') {
    const btn = m.button ?? {};
    const text = btn.text;
    const payload = btn.payload;
    if (!isNonEmptyString(text) && !isNonEmptyString(payload)) {
      return { kind: 'unsupported' };
    }
    const replyTitle = isNonEmptyString(text) ? text : payload;
    const replyId = isNonEmptyString(payload) ? payload : text;
    return { kind: 'button_reply', from, id, replyId, replyTitle, senderName };
  }

  return { kind: 'unsupported' };
}

const EXTRACT_MESSAGE_LITERAL = block([
  'export function extractMessage(payload: unknown): ExtractedMessage {',
  '  try {',
  '    const p = payload as Record<string, unknown> | null | undefined;',
  '    const entry = Array.isArray(p?.entry) ? (p!.entry as unknown[]) : [];',
  '    const change0 = (entry[0] as Record<string, unknown> | undefined)?.changes;',
  '    const changes = Array.isArray(change0) ? (change0 as unknown[]) : [];',
  '    const value = (changes[0] as Record<string, unknown> | undefined)?.value as',
  '      | Record<string, unknown>',
  '      | undefined;',
  '',
  '    const contacts = Array.isArray(value?.contacts) ? (value!.contacts as unknown[]) : [];',
  '    const profileName = (contacts[0] as Record<string, unknown> | undefined)?.profile as',
  '      | Record<string, unknown>',
  '      | undefined;',
  '    const senderName = sanitizeSenderName(profileName?.name);',
  '',
  '    const messages = Array.isArray(value?.messages) ? (value!.messages as unknown[]) : [];',
  '    if (messages.length > 0) {',
  '      return classifyMessage(messages[0], senderName);',
  '    }',
  '',
  '    const statuses = Array.isArray(value?.statuses) ? (value!.statuses as unknown[]) : [];',
  '    if (statuses.length > 0) {',
  "      return { kind: 'status' };",
  '    }',
  '',
  "    return { kind: 'unsupported' };",
  '  } catch (e) {',
  "    console.error('[wa-inbound] extractMessage failed:', (e as Error)?.message || e);",
  "    return { kind: 'unsupported' };",
  '  }',
  '}',
]);

check('presence: wa-inbound.ts extractMessage', () => {
  assertPresent(waInboundSrc, REL_WA_INBOUND, 'extractMessage', EXTRACT_MESSAGE_LITERAL);
});

function extractMessage(payload) {
  try {
    const p = payload;
    const entry = Array.isArray(p?.entry) ? p.entry : [];
    const change0 = entry[0]?.changes;
    const changes = Array.isArray(change0) ? change0 : [];
    const value = changes[0]?.value;

    const contacts = Array.isArray(value?.contacts) ? value.contacts : [];
    const profileName = contacts[0]?.profile;
    const senderName = sanitizeSenderName(profileName?.name);

    const messages = Array.isArray(value?.messages) ? value.messages : [];
    if (messages.length > 0) {
      return classifyMessage(messages[0], senderName);
    }

    const statuses = Array.isArray(value?.statuses) ? value.statuses : [];
    if (statuses.length > 0) {
      return { kind: 'status' };
    }

    return { kind: 'unsupported' };
  } catch (e) {
    return { kind: 'unsupported' };
  }
}

// ================================================================================================
// Non-pure — literal/substring assertions only (sendViaControlRoom, sendText,
// verifyControlRoomSignature, module-scope env constants).
// ================================================================================================

check('substring: wa-send.ts env constants read CONTROL_ROOM_BASE_URL/FORWARD_SECRET/CHANNEL_SLUG', () => {
  assert.ok(waSendSrc.includes("Deno.env.get('CONTROL_ROOM_BASE_URL')"));
  assert.ok(waSendSrc.includes("Deno.env.get('CONTROL_ROOM_FORWARD_SECRET')"));
  assert.ok(waSendSrc.includes("Deno.env.get('CONTROL_ROOM_CHANNEL_SLUG')"));
});

check('substring: wa-send.ts sendViaControlRoom composes and signs the exact posted string once', () => {
  assert.ok(waSendSrc.includes('async function sendViaControlRoom(body: WaMessageBody)'));
  assert.ok(waSendSrc.includes('JSON.stringify({'));
  assert.ok(waSendSrc.includes('await hmacSha256Hex(FORWARD_SECRET, requestBody)'));
  assert.ok(waSendSrc.includes("`sha256=${signature}`"));
  // No exported sender for buttons/list/template — checked precisely (not a bare substring, since
  // the file's own trailing comment legitimately mentions these names) by the regex check below.
});

check('substring: wa-send.ts sendText is buildTextBody + sendViaControlRoom, the only exported sender', () => {
  assert.ok(waSendSrc.includes('export async function sendText(to: string, text: string)'));
  assert.ok(waSendSrc.includes('const body = buildTextBody(to, text);'));
  assert.ok(waSendSrc.includes('return sendViaControlRoom(body);'));
});

check('substring: wa-inbound.ts verifyControlRoomSignature verifies before parsing', () => {
  assert.ok(waInboundSrc.includes('export async function verifyControlRoomSignature('));
  assert.ok(waInboundSrc.includes('Callers verify before parsing the body at all'));
  assert.ok(waInboundSrc.includes('if (!secret) return false;'));
});

// ================================================================================================
// 13. Unconfirmed-contract markers.
// ================================================================================================

check('wa-send.ts header carries an UNCONFIRMED marker', () => {
  assert.ok(waSendSrc.includes('UNCONFIRMED'));
});

check('wa-send.ts does not export sendButtons / sendList / sendTemplate', () => {
  assert.ok(!/export (async )?function sendButtons/.test(waSendSrc));
  assert.ok(!/export (async )?function sendList/.test(waSendSrc));
  assert.ok(!/export (async )?function sendTemplate/.test(waSendSrc));
});

// ================================================================================================
// 6/toWaPhone-comments. Behavioural + comment checks.
// ================================================================================================

check('wa-send.ts carries the "not an SA normaliser" warning and the SWEEP_ALLOWLIST-coupling comment', () => {
  assert.ok(waSendSrc.includes('NOT a South African normaliser'));
  assert.ok(waSendSrc.includes('SWEEP_ALLOWLIST'));
});

// ================================================================================================
// Behavioural test cases.
// ================================================================================================

// --- 2/3. Builders produce the documented shapes -------------------------------------------------

check('buildTextBody returns exactly { to, type: "text", content: { text } }', () => {
  const body = buildTextBody('+27821234567', 'hello');
  assert.deepEqual(body, { to: '+27821234567', type: 'text', content: { text: 'hello' } });
});

check('buildTextBody rejects empty/whitespace text', () => {
  assert.throws(() => buildTextBody('+27821234567', ''), WaSendError);
  assert.throws(() => buildTextBody('+27821234567', '   '), WaSendError);
});

check('buildButtonsBody produces type:interactive with the documented content shape', () => {
  const body = buildButtonsBody('+27821234567', 'Pick one', [{ id: 'a', title: 'A' }]);
  assert.equal(body.type, 'interactive');
  assert.deepEqual(body.content, {
    type: 'button',
    body: { text: 'Pick one' },
    action: { buttons: [{ type: 'reply', reply: { id: 'a', title: 'A' } }] },
  });
});

check('buildListBody produces type:interactive with the documented content shape', () => {
  const sections = [{ title: 'Sec', rows: [{ id: 'r1', title: 'Row' }] }];
  const body = buildListBody('+27821234567', 'Choose', 'Open', sections);
  assert.equal(body.type, 'interactive');
  assert.deepEqual(body.content, {
    type: 'list',
    body: { text: 'Choose' },
    action: { button: 'Open', sections },
  });
});

check('buildTemplateBody omits components entirely (not []) when none are passed', () => {
  const body = buildTemplateBody('+27821234567', 'weekly_report', 'en');
  assert.equal(body.type, 'template');
  assert.deepEqual(body.content, { name: 'weekly_report', language: { code: 'en' } });
  assert.equal('components' in body.content, false, 'components key must be absent, not []');
});

check('buildTemplateBody includes components when passed', () => {
  const components = [{ type: 'body', parameters: [{ type: 'text', text: 'x' }] }];
  const body = buildTemplateBody('+27821234567', 'weekly_report', 'en', components);
  assert.equal('components' in body.content, true);
  assert.deepEqual(body.content.components, components);
});

// --- 4. Caps rejected -------------------------------------------------------------------------

check('buildButtonsBody rejects a 4th button', () => {
  const buttons = [
    { id: 'a', title: 'A' },
    { id: 'b', title: 'B' },
    { id: 'c', title: 'C' },
    { id: 'd', title: 'D' },
  ];
  assert.throws(() => buildButtonsBody('to', 'body', buttons), WaSendError);
});

check('buildButtonsBody rejects a 21-character button label', () => {
  assert.throws(() => buildButtonsBody('to', 'body', [{ id: 'a', title: 'x'.repeat(21) }]), WaSendError);
});

check('buildButtonsBody rejects an empty button list', () => {
  assert.throws(() => buildButtonsBody('to', 'body', []), WaSendError);
});

check('buildListBody rejects an 11th row across two sections', () => {
  const sections = [
    { title: 'S1', rows: Array.from({ length: 6 }, (_, i) => ({ id: `r${i}`, title: `Row ${i}` })) },
    { title: 'S2', rows: Array.from({ length: 5 }, (_, i) => ({ id: `t${i}`, title: `Row ${i}` })) },
  ];
  assert.throws(() => buildListBody('to', 'body', 'more', sections), WaSendError);
});

check('buildListBody rejects a 25-character row title', () => {
  const sections = [{ title: 'S1', rows: [{ id: 'r1', title: 'x'.repeat(25) }] }];
  assert.throws(() => buildListBody('to', 'body', 'more', sections), WaSendError);
});

check('buildListBody rejects a 25-character section title', () => {
  const sections = [{ title: 'x'.repeat(25), rows: [{ id: 'r1', title: 'Row' }] }];
  assert.throws(() => buildListBody('to', 'body', 'more', sections), WaSendError);
});

check('buildListBody rejects an empty section list', () => {
  assert.throws(() => buildListBody('to', 'body', 'more', []), WaSendError);
});

// --- 5. URL-button parameter validation ---------------------------------------------------------

check('buildTemplateBody rejects a full URL in a url-button parameter', () => {
  const components = [
    { type: 'button', sub_type: 'url', index: 0, parameters: [{ type: 'text', text: 'https://example.com/x' }] },
  ];
  assert.throws(() => buildTemplateBody('to', 'tpl', 'en', components), WaSendError);
});

check('buildTemplateBody accepts a plain suffix in a url-button parameter', () => {
  const components = [
    { type: 'button', sub_type: 'url', index: 0, parameters: [{ type: 'text', text: 'wk34-2026' }] },
  ];
  assert.doesNotThrow(() => buildTemplateBody('to', 'tpl', 'en', components));
});

// --- 6. toWaPhone --------------------------------------------------------------------------------

check("toWaPhone('27821234567') === '+27821234567'", () => {
  assert.equal(toWaPhone('27821234567'), '+27821234567');
});

check("toWaPhone('+27 82 123 4567') === '+27821234567'", () => {
  assert.equal(toWaPhone('+27 82 123 4567'), '+27821234567');
});

check("toWaPhone('') throws", () => {
  assert.throws(() => toWaPhone(''), WaSendError);
});

check("toWaPhone('abc') throws", () => {
  assert.throws(() => toWaPhone('abc'), WaSendError);
});

// --- 7. buildReplyId / parseReplyId --------------------------------------------------------------

check("buildReplyId('rpt','confirm','wk34-2026') === 'rpt:confirm:wk34-2026'", () => {
  assert.equal(buildReplyId('rpt', 'confirm', 'wk34-2026'), 'rpt:confirm:wk34-2026');
});

check('parseReplyId round-trips buildReplyId', () => {
  const id = buildReplyId('rpt', 'confirm', 'wk34-2026');
  assert.deepEqual(parseReplyId(id), { ns: 'rpt', action: 'confirm', arg: 'wk34-2026' });
});

check("buildReplyId('RPT','x') throws (uppercase segment invalid)", () => {
  assert.throws(() => buildReplyId('RPT', 'x'), WaSendError);
});

check('buildReplyId throws on a 25-character segment', () => {
  assert.throws(() => buildReplyId('rpt', 'x'.repeat(25)), WaSendError);
});

check("parseReplyId('nonsense') returns null without throwing", () => {
  assert.equal(parseReplyId('nonsense'), null);
});

check("parseReplyId('a:b:c:d') returns null without throwing", () => {
  assert.equal(parseReplyId('a:b:c:d'), null);
});

check("parseReplyId('') returns null without throwing", () => {
  assert.equal(parseReplyId(''), null);
});

// --- 8. truncate -----------------------------------------------------------------------------

check("truncate('abcdef', 6) === 'abcdef'", () => {
  assert.equal(truncate('abcdef', 6), 'abcdef');
});
check("truncate('abcdef', 4) === 'abc…'", () => {
  assert.equal(truncate('abcdef', 4), 'abc…');
});
check("truncate('abcdef', 1) === 'a'", () => {
  assert.equal(truncate('abcdef', 1), 'a');
});
check("truncate('abcdef', 0) === ''", () => {
  assert.equal(truncate('abcdef', 0), '');
});

// --- 9. paginateRows ---------------------------------------------------------------------------

check('paginateRows([1,2], 5) -> {page:[1,2], hasMore:false}', () => {
  const r = paginateRows([1, 2], 5);
  assert.deepEqual(r, { page: [1, 2], hasMore: false });
});

check('paginateRows([1,2,3], 2) -> page.length===2, hasMore===true', () => {
  const r = paginateRows([1, 2, 3], 2);
  assert.equal(r.page.length, 2);
  assert.equal(r.hasMore, true);
});

check("paginateRows([1,2,3], 2, 'More') -> page.length===1, hasMore===true", () => {
  const r = paginateRows([1, 2, 3], 2, 'More');
  assert.equal(r.page.length, 1);
  assert.equal(r.hasMore, true);
});

check("paginateRows([1,2,3], 1, 'More') -> page.length===1 (never 0), hasMore===true", () => {
  const r = paginateRows([1, 2, 3], 1, 'More');
  assert.equal(r.page.length, 1);
  assert.equal(r.hasMore, true);
});

// --- 10. classifyMessage / extractMessage --------------------------------------------------------

function envelope(message, opts = {}) {
  const value = { messages: message ? [message] : [] };
  if (opts.statuses) value.statuses = opts.statuses;
  if (opts.profileName) value.contacts = [{ wa_id: message?.from, profile: { name: opts.profileName } }];
  return { entry: [{ changes: [{ value }] }] };
}

check('extractMessage: interactive button_reply', () => {
  const msg = {
    from: '27821234567',
    id: 'wamid.1',
    type: 'interactive',
    interactive: { type: 'button_reply', button_reply: { id: 'rpt:confirm', title: 'Confirm' } },
  };
  const r = extractMessage(envelope(msg));
  assert.equal(r.kind, 'button_reply');
  assert.equal(r.replyId, 'rpt:confirm');
  assert.equal(r.replyTitle, 'Confirm');
});

check('extractMessage: type:button template tap WITH payload', () => {
  const msg = { from: '27821234567', id: 'wamid.2', type: 'button', button: { text: 'Yes', payload: 'rpt:yes' } };
  const r = extractMessage(envelope(msg));
  assert.equal(r.kind, 'button_reply');
  assert.equal(r.replyId, 'rpt:yes');
  assert.equal(r.replyTitle, 'Yes');
});

check('extractMessage: type:button template tap WITHOUT payload (text only)', () => {
  const msg = { from: '27821234567', id: 'wamid.3', type: 'button', button: { text: 'Yes' } };
  const r = extractMessage(envelope(msg));
  assert.equal(r.kind, 'button_reply');
  assert.equal(r.replyId, 'Yes');
  assert.equal(r.replyTitle, 'Yes');
});

check('extractMessage: list_reply', () => {
  const msg = {
    from: '27821234567',
    id: 'wamid.4',
    type: 'interactive',
    interactive: { type: 'list_reply', list_reply: { id: 'rpt:pick:wk34', title: 'Week 34' } },
  };
  const r = extractMessage(envelope(msg));
  assert.equal(r.kind, 'list_reply');
  assert.equal(r.replyId, 'rpt:pick:wk34');
  assert.equal(r.replyTitle, 'Week 34');
});

check('extractMessage: text', () => {
  const msg = { from: '27821234567', id: 'wamid.5', type: 'text', text: { body: 'HELP' } };
  const r = extractMessage(envelope(msg));
  assert.equal(r.kind, 'text');
  assert.equal(r.text, 'HELP');
});

check('extractMessage: statuses-only payload -> status', () => {
  const r = extractMessage(envelope(null, { statuses: [{ id: 'wamid.6', status: 'delivered' }] }));
  assert.equal(r.kind, 'status');
});

check('extractMessage: {} -> unsupported', () => {
  assert.equal(extractMessage({}).kind, 'unsupported');
});

check('extractMessage: null -> unsupported', () => {
  assert.equal(extractMessage(null).kind, 'unsupported');
});

check('extractMessage: message missing id -> unsupported', () => {
  const msg = { from: '27821234567', type: 'text', text: { body: 'hi' } };
  assert.equal(extractMessage(envelope(msg)).kind, 'unsupported');
});

check("extractMessage: type:'image' -> unsupported", () => {
  const msg = { from: '27821234567', id: 'wamid.7', type: 'image', image: { id: 'media1' } };
  assert.equal(extractMessage(envelope(msg)).kind, 'unsupported');
});

// --- 11. sanitizeSenderName -----------------------------------------------------------------------

check("sanitizeSenderName('😀😀') === undefined", () => {
  assert.equal(sanitizeSenderName('😀😀'), undefined);
});
check("sanitizeSenderName('Thabo Mokoena') === 'Thabo'", () => {
  assert.equal(sanitizeSenderName('Thabo Mokoena'), 'Thabo');
});
check("sanitizeSenderName('  ') === undefined", () => {
  assert.equal(sanitizeSenderName('  '), undefined);
});
check('sanitizeSenderName(42) === undefined', () => {
  assert.equal(sanitizeSenderName(42), undefined);
});
check('a 30-character single word is capped at 20', () => {
  const result = sanitizeSenderName('x'.repeat(30));
  assert.equal(result.length, 20);
});

// --- 12. parseSignatureHeader / timingSafeEqual ---------------------------------------------------

check("parseSignatureHeader('sha256=ab12') === 'ab12'", () => {
  assert.equal(parseSignatureHeader('sha256=ab12'), 'ab12');
});
check("parseSignatureHeader('ab12') === null", () => {
  assert.equal(parseSignatureHeader('ab12'), null);
});
check("parseSignatureHeader('sha256=') === null", () => {
  assert.equal(parseSignatureHeader('sha256='), null);
});
check("parseSignatureHeader('sha256=zz') === null", () => {
  assert.equal(parseSignatureHeader('sha256=zz'), null);
});
check('parseSignatureHeader(null) === null', () => {
  assert.equal(parseSignatureHeader(null), null);
});
check('parseSignatureHeader(undefined) === null', () => {
  assert.equal(parseSignatureHeader(undefined), null);
});

check("timingSafeEqual('abc','abc') === true", () => {
  assert.equal(timingSafeEqual('abc', 'abc'), true);
});
check("timingSafeEqual('abc','abd') === false", () => {
  assert.equal(timingSafeEqual('abc', 'abd'), false);
});
check("timingSafeEqual('abc','abcd') === false", () => {
  assert.equal(timingSafeEqual('abc', 'abcd'), false);
});

// ================================================================================================
// Report
// ================================================================================================

if (failures.length) {
  console.error(`\nWA PLUMBING VIOLATIONS (${failures.length}):\n`);
  for (const f of failures) {
    console.error('  ' + f);
  }
  console.error(`\n${passCount} passed, ${failures.length} failed.`);
  process.exit(1);
}

console.log(`WA PLUMBING VERIFY OK (${passCount} checks passed).`);
