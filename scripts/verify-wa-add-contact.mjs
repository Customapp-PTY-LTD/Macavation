#!/usr/bin/env node
/**
 * wa-add-contact:verify — regression guard for the WhatsApp /contact guided "add a CRM contact"
 * flow added to:
 *   supabase/functions/whatsapp-inbound/index.ts   (the "Add contact" section: CONTACT_NS,
 *                                                    CONTACT_TYPES, the draft state machine, the
 *                                                    MENU_ITEMS/COMMAND_HANDLERS/handleCommand/
 *                                                    processCommandForMessage wiring, and the
 *                                                    STAGED_COMMAND_HANDLERS.ADD_CONTACT handler)
 *   migrations/20261001120000_whatsapp_add_contact_support.sql (the two new RPCs this flow needs)
 *
 * Same `.ts` discipline as verify-wa-plumbing.mjs / verify-wa-staff-menu.mjs / verify-wa-my-
 * reports.mjs: `.ts` type annotations are not valid JS and this script never evaluates the `.ts`
 * file. Every PURE function gets a literal-presence assertion (the exact source block must still
 * be in index.ts) AND a re-declared plain-JS copy that every behavioural check below actually
 * runs against. If a future edit changes the `.ts`, the presence assertion fails loudly and names
 * what to update — silent drift between this script's copy and the real function is impossible,
 * only a caught one.
 *
 * Pure fs reads, node:assert, no dependency, no network — test:fleet must stay hermetic.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const REL_INBOUND = 'supabase/functions/whatsapp-inbound/index.ts';
const REL_MIGRATION = 'migrations/20261001120000_whatsapp_add_contact_support.sql';

/** Normalise CRLF before any comparison — same reason as every sibling verifier. */
function readFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\r\n').join('\n');
}

const inboundSrc = readFile(REL_INBOUND);
const migrationSrc = readFile(REL_MIGRATION);

// ---- tiny test harness (same shape as every sibling verifier) --------------------------------
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
// 1. Literal-presence — the pure functions this script re-declares and behaviourally tests below.
// ================================================================================================

assertPresent(
  inboundSrc,
  REL_INBOUND,
  'CONTACT_NS',
  "const CONTACT_NS = 'contact';"
);

assertPresent(
  inboundSrc,
  REL_INBOUND,
  'CONTACT_TYPES',
  block([
    "const CONTACT_TYPES: { key: string; label: string }[] = [",
    "  { key: 'nis_supplier', label: 'NIS Supplier' },",
    "  { key: 'oil_processor', label: 'Oil Processor' },",
    "  { key: 'oil_ingredient_supplier', label: 'Oil Ingredient Supplier' },",
    "  { key: 'oil_protein_customer', label: 'Oil & Protein Customer' },",
    "  { key: 'kernel_customer', label: 'Kernel Customer' },",
    '];',
  ])
);

assertPresent(
  inboundSrc,
  REL_INBOUND,
  'ADD_CONTACT_STEP_ORDER',
  "const ADD_CONTACT_STEP_ORDER = ['type', 'company', 'person', 'mobile', 'email'] as const;"
);

assertPresent(
  inboundSrc,
  REL_INBOUND,
  'nextAddContactStep',
  block([
    'function nextAddContactStep(fields: AddContactDraftFields, from: AddContactStep): AddContactStep {',
    "  const startIndex = from === 'done' ? ADD_CONTACT_STEP_ORDER.length : ADD_CONTACT_STEP_ORDER.indexOf(from);",
    '  for (let i = Math.max(startIndex, 0); i < ADD_CONTACT_STEP_ORDER.length; i++) {',
    '    const step = ADD_CONTACT_STEP_ORDER[i];',
    '    const value = fields[ADD_CONTACT_STEP_FIELD[step]];',
    "    if (value === null || value === undefined || String(value).trim() === '') return step;",
    '  }',
    "  return 'done';",
    '}',
  ])
);

assertPresent(
  inboundSrc,
  REL_INBOUND,
  'contactTypeFromInput',
  block([
    'function contactTypeFromInput(input: string): string | null {',
    '  const trimmed = input.trim();',
    '  if (!trimmed) return null;',
    '  if (/^[1-5]$/.test(trimmed)) {',
    '    return CONTACT_TYPES[Number(trimmed) - 1]?.key ?? null;',
    '  }',
    "  const lowerKey = trimmed.toLowerCase().replace(/\\s+/g, '_');",
    '  const byKey = CONTACT_TYPES.find((t) => t.key === lowerKey);',
    '  if (byKey) return byKey.key;',
    '  const lowerLabel = trimmed.toLowerCase();',
    '  const byLabel = CONTACT_TYPES.find((t) => t.label.toLowerCase() === lowerLabel);',
    '  return byLabel ? byLabel.key : null;',
    '}',
  ])
);

assertPresent(
  inboundSrc,
  REL_INBOUND,
  'contactTypeLabel',
  block([
    'function contactTypeLabel(key: string | null): string {',
    "  if (!key) return '—';",
    '  return CONTACT_TYPES.find((t) => t.key === key)?.label ?? key;',
    '}',
  ])
);

assertPresent(
  inboundSrc,
  REL_INBOUND,
  'isSkipAnswer',
  block([
    'function isSkipAnswer(input: string): boolean {',
    '  const normalised = input.trim().toLowerCase();',
    "  return normalised === 'skip' || normalised === '-' || normalised === 'none' || normalised === 'n/a';",
    '}',
  ])
);

assertPresent(
  inboundSrc,
  REL_INBOUND,
  'validateCompanyName',
  block([
    'function validateCompanyName(input: string): { ok: true; value: string } | { ok: false; error: string } {',
    '  const trimmed = input.trim();',
    '  if (!trimmed) {',
    "    return { ok: false, error: 'Company name cannot be empty. What is the company name?' };",
    '  }',
    '  if (trimmed.length > 255) {',
    "    return { ok: false, error: 'That company name is too long (max 255 characters). What is the company name?' };",
    '  }',
    '  return { ok: true, value: trimmed };',
    '}',
  ])
);

assertPresent(
  inboundSrc,
  REL_INBOUND,
  'normaliseMobile',
  block([
    'function normaliseMobile(input: string): { ok: true; value: string } | { ok: false; error: string } {',
    "  const stripped = input.trim().replace(/[\\s()-]/g, '');",
    "  const hasPlus = stripped.startsWith('+');",
    '  const digits = hasPlus ? stripped.slice(1) : stripped;',
    '  if (!/^\\d{7,15}$/.test(digits)) {',
    '    return {',
    '      ok: false,',
    `      error: "That doesn't look like a mobile number. Please reply with a mobile number, or SKIP.",`,
    '    };',
    '  }',
    '  return { ok: true, value: hasPlus ? `+${digits}` : digits };',
    '}',
  ])
);

assertPresent(
  inboundSrc,
  REL_INBOUND,
  'ADD_CONTACT_EMAIL_RE + validateEmail',
  block([
    "const ADD_CONTACT_EMAIL_RE = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;",
    '',
    '/** Matches primary_contact_email varchar(255). */',
    'function validateEmail(input: string): { ok: true; value: string } | { ok: false; error: string } {',
    '  const trimmed = input.trim();',
    '  if (!ADD_CONTACT_EMAIL_RE.test(trimmed)) {',
    '    return {',
    '      ok: false,',
    `      error: "That doesn't look like an email address. Please reply with an email address, or SKIP.",`,
    '    };',
    '  }',
    '  if (trimmed.length > 255) {',
    '    return {',
    '      ok: false,',
    "      error: 'That email address is too long (max 255 characters). Please reply with an email address, or SKIP.',",
    '    };',
    '  }',
    '  return { ok: true, value: trimmed };',
    '}',
  ])
);

assertPresent(
  inboundSrc,
  REL_INBOUND,
  'buildAddContactSummary',
  block([
    'function buildAddContactSummary(fields: AddContactDraftFields): string {',
    '  const lines = [',
    '    `Type: ${contactTypeLabel(fields.contact_type)}`,',
    "    `Company: ${fields.company_name ?? '—'}`,",
    "    `Contact person: ${fields.primary_contact_name ?? '—'}`,",
    "    `Mobile: ${fields.primary_contact_mobile ?? '—'}`,",
    "    `Email: ${fields.primary_contact_email ?? '—'}`,",
    '  ];',
    '  return `New contact:\\n\\n${lines.join(\'\\n\')}`;',
    '}',
  ])
);

assertPresent(
  inboundSrc,
  REL_INBOUND,
  'extractSharedContact',
  block([
    '  const name = contact?.name?.formatted_name;',
    '  const company = contact?.org?.company;',
    '  const phone = contact?.phones?.[0]?.phone ?? contact?.phones?.[0]?.wa_id;',
    '  const email = contact?.emails?.[0]?.email;',
    '  return {',
    "    company_name: typeof company === 'string' && company.trim() ? company.trim() : null,",
    "    primary_contact_name: typeof name === 'string' && name.trim() ? name.trim() : null,",
    "    primary_contact_mobile: typeof phone === 'string' && phone.trim() ? phone.trim() : null,",
    "    primary_contact_email: typeof email === 'string' && email.trim() ? email.trim() : null,",
    '  };',
    '}',
  ])
);

assertPresent(
  inboundSrc,
  REL_INBOUND,
  'sanitisePrefillCompany',
  block([
    'function sanitisePrefillCompany(v: string | null): string | null {',
    '  if (!v) return null;',
    '  const r = validateCompanyName(v);',
    '  return r.ok ? r.value : null;',
    '}',
  ])
);

assertPresent(
  inboundSrc,
  REL_INBOUND,
  'sanitisePrefillName',
  block([
    'function sanitisePrefillName(v: string | null): string | null {',
    '  if (!v) return null;',
    '  const trimmed = v.trim();',
    '  return trimmed && trimmed.length <= 255 ? trimmed : null;',
    '}',
  ])
);

assertPresent(
  inboundSrc,
  REL_INBOUND,
  'sanitisePrefillMobile',
  block([
    'function sanitisePrefillMobile(v: string | null): string | null {',
    '  if (!v) return null;',
    '  const r = normaliseMobile(v);',
    '  return r.ok ? r.value : null;',
    '}',
  ])
);

assertPresent(
  inboundSrc,
  REL_INBOUND,
  'sanitisePrefillEmail',
  block([
    'function sanitisePrefillEmail(v: string | null): string | null {',
    '  if (!v) return null;',
    '  const r = validateEmail(v);',
    '  return r.ok ? r.value : null;',
    '}',
  ])
);

// ================================================================================================
// 2. Literal-presence — the wiring (MENU_ITEMS, COMMAND_HANDLERS, handleCommand,
//    processCommandForMessage, STAGED_COMMAND_HANDLERS.ADD_CONTACT).
// ================================================================================================

assertPresent(
  inboundSrc,
  REL_INBOUND,
  'MENU_ITEMS addcontact entry',
  block([
    "    action: 'addcontact',",
    "    title: 'Add contact',",
    "    feature: 'crm-grid',",
    '    subMenu: startAddContact,',
  ])
);

assertPresent(
  inboundSrc,
  REL_INBOUND,
  'COMMAND_HANDLERS CONTACT/ADDCONTACT/NEWCONTACT',
  block([
    "  CONTACT: (ctx) => renderMenuItem(ctx, 'addcontact'),",
    "  ADDCONTACT: (ctx) => renderMenuItem(ctx, 'addcontact'),",
    "  NEWCONTACT: (ctx) => renderMenuItem(ctx, 'addcontact'),",
  ])
);

assertPresent(inboundSrc, REL_INBOUND, 'handleCommand CONTACT_NS tap branch', 'if (parsed && parsed.ns === CONTACT_NS) {');
assertPresent(inboundSrc, REL_INBOUND, 'handleCommand dispatchContactTypeTap call', 'return dispatchContactTypeTap(ctx, parsed.action);');
assertPresent(inboundSrc, REL_INBOUND, 'handleCommand routeAddContactDraft call', 'const draftResult = await routeAddContactDraft(ctx);');

assertPresent(inboundSrc, REL_INBOUND, "processCommandForMessage type === 'contacts' branch", "} else if (type === 'contacts') {");
assertPresent(
  inboundSrc,
  REL_INBOUND,
  'processCommandForMessage startAddContact dispatch',
  block([
    '    const result =',
    "      type === 'contacts'",
    '        ? await startAddContact(ctx, extractSharedContact(msg?.contacts?.[0]))',
    '        : await handleCommand(ctx);',
  ])
);

assertPresent(
  inboundSrc,
  REL_INBOUND,
  'STAGED_COMMAND_HANDLERS.ADD_CONTACT create_contact_simple call',
  block([
    "      const { data, error } = await ctx.sb.rpc('create_contact_simple', {",
    '        p_contact_type: contactType,',
    '        p_company_name: companyName,',
    '        p_primary_contact_name: payload?.primary_contact_name ?? null,',
    '        p_primary_contact_mobile: payload?.primary_contact_mobile ?? null,',
    '        p_primary_contact_email: payload?.primary_contact_email ?? null,',
    '      });',
  ])
);

// ================================================================================================
// 3. Migration file — the two new RPCs are service_role only, never anon/authenticated/PUBLIC.
// ================================================================================================

check('migration defines whatsapp_peek_pending_command', () => {
  assert.ok(migrationSrc.includes('CREATE OR REPLACE FUNCTION public.whatsapp_peek_pending_command('));
});
check('migration defines whatsapp_find_contacts_by_company', () => {
  assert.ok(migrationSrc.includes('CREATE OR REPLACE FUNCTION public.whatsapp_find_contacts_by_company('));
});
check('whatsapp_peek_pending_command: REVOKE from PUBLIC/anon/authenticated, GRANT to service_role only', () => {
  assert.ok(migrationSrc.includes('REVOKE ALL ON FUNCTION public.whatsapp_peek_pending_command(text, uuid) FROM PUBLIC;'));
  assert.ok(migrationSrc.includes('REVOKE ALL ON FUNCTION public.whatsapp_peek_pending_command(text, uuid) FROM anon;'));
  assert.ok(migrationSrc.includes('REVOKE ALL ON FUNCTION public.whatsapp_peek_pending_command(text, uuid) FROM authenticated;'));
  assert.ok(migrationSrc.includes('GRANT EXECUTE ON FUNCTION public.whatsapp_peek_pending_command(text, uuid) TO service_role;'));
});
check('whatsapp_find_contacts_by_company: REVOKE from PUBLIC/anon/authenticated, GRANT to service_role only', () => {
  assert.ok(migrationSrc.includes('REVOKE ALL ON FUNCTION public.whatsapp_find_contacts_by_company(text) FROM PUBLIC;'));
  assert.ok(migrationSrc.includes('REVOKE ALL ON FUNCTION public.whatsapp_find_contacts_by_company(text) FROM anon;'));
  assert.ok(migrationSrc.includes('REVOKE ALL ON FUNCTION public.whatsapp_find_contacts_by_company(text) FROM authenticated;'));
  assert.ok(migrationSrc.includes('GRANT EXECUTE ON FUNCTION public.whatsapp_find_contacts_by_company(text) TO service_role;'));
});
check('whatsapp_find_contacts_by_company excludes soft-deleted contacts and caps at 5 rows', () => {
  assert.ok(migrationSrc.includes('c.deleted_at IS NULL'));
  assert.ok(migrationSrc.includes('LIMIT 5;'));
});

// ================================================================================================
// 4. Re-declared plain-JS copies of the pure functions above — every behavioural case runs
//    against THESE, never against the .ts file (which this script never evaluates).
// ================================================================================================

const CONTACT_TYPES = [
  { key: 'nis_supplier', label: 'NIS Supplier' },
  { key: 'oil_processor', label: 'Oil Processor' },
  { key: 'oil_ingredient_supplier', label: 'Oil Ingredient Supplier' },
  { key: 'oil_protein_customer', label: 'Oil & Protein Customer' },
  { key: 'kernel_customer', label: 'Kernel Customer' },
];

const ADD_CONTACT_STEP_ORDER = ['type', 'company', 'person', 'mobile', 'email'];

const ADD_CONTACT_STEP_FIELD = {
  type: 'contact_type',
  company: 'company_name',
  person: 'primary_contact_name',
  mobile: 'primary_contact_mobile',
  email: 'primary_contact_email',
};

function nextAddContactStep(fields, from) {
  const startIndex = from === 'done' ? ADD_CONTACT_STEP_ORDER.length : ADD_CONTACT_STEP_ORDER.indexOf(from);
  for (let i = Math.max(startIndex, 0); i < ADD_CONTACT_STEP_ORDER.length; i++) {
    const step = ADD_CONTACT_STEP_ORDER[i];
    const value = fields[ADD_CONTACT_STEP_FIELD[step]];
    if (value === null || value === undefined || String(value).trim() === '') return step;
  }
  return 'done';
}

function contactTypeFromInput(input) {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^[1-5]$/.test(trimmed)) {
    return CONTACT_TYPES[Number(trimmed) - 1]?.key ?? null;
  }
  const lowerKey = trimmed.toLowerCase().replace(/\s+/g, '_');
  const byKey = CONTACT_TYPES.find((t) => t.key === lowerKey);
  if (byKey) return byKey.key;
  const lowerLabel = trimmed.toLowerCase();
  const byLabel = CONTACT_TYPES.find((t) => t.label.toLowerCase() === lowerLabel);
  return byLabel ? byLabel.key : null;
}

function contactTypeLabel(key) {
  if (!key) return '—';
  return CONTACT_TYPES.find((t) => t.key === key)?.label ?? key;
}

function isSkipAnswer(input) {
  const normalised = input.trim().toLowerCase();
  return normalised === 'skip' || normalised === '-' || normalised === 'none' || normalised === 'n/a';
}

function validateCompanyName(input) {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, error: 'Company name cannot be empty. What is the company name?' };
  }
  if (trimmed.length > 255) {
    return { ok: false, error: 'That company name is too long (max 255 characters). What is the company name?' };
  }
  return { ok: true, value: trimmed };
}

function normaliseMobile(input) {
  const stripped = input.trim().replace(/[\s()-]/g, '');
  const hasPlus = stripped.startsWith('+');
  const digits = hasPlus ? stripped.slice(1) : stripped;
  if (!/^\d{7,15}$/.test(digits)) {
    return {
      ok: false,
      error: "That doesn't look like a mobile number. Please reply with a mobile number, or SKIP.",
    };
  }
  return { ok: true, value: hasPlus ? `+${digits}` : digits };
}

const ADD_CONTACT_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmail(input) {
  const trimmed = input.trim();
  if (!ADD_CONTACT_EMAIL_RE.test(trimmed)) {
    return {
      ok: false,
      error: "That doesn't look like an email address. Please reply with an email address, or SKIP.",
    };
  }
  if (trimmed.length > 255) {
    return {
      ok: false,
      error: 'That email address is too long (max 255 characters). Please reply with an email address, or SKIP.',
    };
  }
  return { ok: true, value: trimmed };
}

function buildAddContactSummary(fields) {
  const lines = [
    `Type: ${contactTypeLabel(fields.contact_type)}`,
    `Company: ${fields.company_name ?? '—'}`,
    `Contact person: ${fields.primary_contact_name ?? '—'}`,
    `Mobile: ${fields.primary_contact_mobile ?? '—'}`,
    `Email: ${fields.primary_contact_email ?? '—'}`,
  ];
  return `New contact:\n\n${lines.join('\n')}`;
}

function extractSharedContact(contact) {
  const name = contact?.name?.formatted_name;
  const company = contact?.org?.company;
  const phone = contact?.phones?.[0]?.phone ?? contact?.phones?.[0]?.wa_id;
  const email = contact?.emails?.[0]?.email;
  return {
    company_name: typeof company === 'string' && company.trim() ? company.trim() : null,
    primary_contact_name: typeof name === 'string' && name.trim() ? name.trim() : null,
    primary_contact_mobile: typeof phone === 'string' && phone.trim() ? phone.trim() : null,
    primary_contact_email: typeof email === 'string' && email.trim() ? email.trim() : null,
  };
}

function sanitisePrefillCompany(v) {
  if (!v) return null;
  const r = validateCompanyName(v);
  return r.ok ? r.value : null;
}

function sanitisePrefillName(v) {
  if (!v) return null;
  const trimmed = v.trim();
  return trimmed && trimmed.length <= 255 ? trimmed : null;
}

function sanitisePrefillMobile(v) {
  if (!v) return null;
  const r = normaliseMobile(v);
  return r.ok ? r.value : null;
}

function sanitisePrefillEmail(v) {
  if (!v) return null;
  const r = validateEmail(v);
  return r.ok ? r.value : null;
}

// ================================================================================================
// 5. Behavioural checks against the re-declared copies above.
// ================================================================================================

const EMPTY_FIELDS = {
  contact_type: null,
  company_name: null,
  primary_contact_name: null,
  primary_contact_mobile: null,
  primary_contact_email: null,
};

check('nextAddContactStep: all-null fields from the start -> type (typed-flow entry point)', () => {
  assert.equal(nextAddContactStep(EMPTY_FIELDS, 'type'), 'type');
});
check('nextAddContactStep: type filled -> company', () => {
  assert.equal(nextAddContactStep({ ...EMPTY_FIELDS, contact_type: 'nis_supplier' }, 'type'), 'company');
});
check('nextAddContactStep: prefill flow — company/person/mobile/email already filled -> type only (contact_type can never be prefilled)', () => {
  const fields = {
    contact_type: null,
    company_name: 'Acme',
    primary_contact_name: 'Jane',
    primary_contact_mobile: '+27821234567',
    primary_contact_email: 'jane@acme.co.za',
  };
  assert.equal(nextAddContactStep(fields, 'type'), 'type');
});
check('nextAddContactStep: every field filled -> done', () => {
  const fields = {
    contact_type: 'nis_supplier',
    company_name: 'Acme',
    primary_contact_name: 'Jane',
    primary_contact_mobile: '+27821234567',
    primary_contact_email: 'jane@acme.co.za',
  };
  assert.equal(nextAddContactStep(fields, 'type'), 'done');
});
check('nextAddContactStep: a blank string field counts as unfilled, same as null', () => {
  assert.equal(nextAddContactStep({ ...EMPTY_FIELDS, contact_type: 'nis_supplier', company_name: '   ' }, 'type'), 'company');
});
check("nextAddContactStep: from:'done' never re-asks anything", () => {
  assert.equal(nextAddContactStep(EMPTY_FIELDS, 'done'), 'done');
});

check('contactTypeFromInput: digit 1-5 resolves by position', () => {
  assert.equal(contactTypeFromInput('1'), 'nis_supplier');
  assert.equal(contactTypeFromInput('5'), 'kernel_customer');
});
check('contactTypeFromInput: digit 0 or 6 is invalid', () => {
  assert.equal(contactTypeFromInput('0'), null);
  assert.equal(contactTypeFromInput('6'), null);
});
check('contactTypeFromInput: enum key, case-insensitive', () => {
  assert.equal(contactTypeFromInput('OIL_PROCESSOR'), 'oil_processor');
});
check('contactTypeFromInput: display label, case-insensitive', () => {
  assert.equal(contactTypeFromInput('oil & protein customer'), 'oil_protein_customer');
  assert.equal(contactTypeFromInput('Kernel Customer'), 'kernel_customer');
});
check('contactTypeFromInput: unrecognised text -> null', () => {
  assert.equal(contactTypeFromInput('banana'), null);
  assert.equal(contactTypeFromInput(''), null);
  assert.equal(contactTypeFromInput('   '), null);
});

check('contactTypeLabel: known key -> label, null key -> em dash, unknown key -> key itself', () => {
  assert.equal(contactTypeLabel('kernel_customer'), 'Kernel Customer');
  assert.equal(contactTypeLabel(null), '—');
  assert.equal(contactTypeLabel('not_a_real_type'), 'not_a_real_type');
});

check('isSkipAnswer: recognises skip/-/none/n-a, case-insensitive, trims', () => {
  assert.equal(isSkipAnswer('skip'), true);
  assert.equal(isSkipAnswer('SKIP'), true);
  assert.equal(isSkipAnswer(' - '), true);
  assert.equal(isSkipAnswer('None'), true);
  assert.equal(isSkipAnswer('n/a'), true);
});
check('isSkipAnswer: a real answer is not a skip', () => {
  assert.equal(isSkipAnswer('Jane Smith'), false);
  assert.equal(isSkipAnswer(''), false);
});

check('validateCompanyName: empty/whitespace-only rejected', () => {
  assert.equal(validateCompanyName('').ok, false);
  assert.equal(validateCompanyName('   ').ok, false);
});
check('validateCompanyName: trims and accepts a normal name', () => {
  const r = validateCompanyName('  Acme Oils  ');
  assert.equal(r.ok, true);
  assert.equal(r.value, 'Acme Oils');
});
check('validateCompanyName: over 255 chars rejected (matches company_name varchar(255))', () => {
  assert.equal(validateCompanyName('x'.repeat(256)).ok, false);
  assert.equal(validateCompanyName('x'.repeat(255)).ok, true);
});

check('normaliseMobile: strips spaces/dashes/parentheses, keeps a leading +', () => {
  const r = normaliseMobile('+27 (82) 123-4567');
  assert.equal(r.ok, true);
  assert.equal(r.value, '+27821234567');
});
check('normaliseMobile: bare digits with no + are accepted as-is', () => {
  const r = normaliseMobile('0821234567');
  assert.equal(r.ok, true);
  assert.equal(r.value, '0821234567');
});
check('normaliseMobile: fewer than 7 digits rejected', () => {
  assert.equal(normaliseMobile('123456').ok, false);
});
check('normaliseMobile: more than 15 digits rejected', () => {
  assert.equal(normaliseMobile('1234567890123456').ok, false);
});
check('normaliseMobile: non-numeric junk rejected', () => {
  assert.equal(normaliseMobile('call me maybe').ok, false);
});

check('validateEmail: a well-formed address is accepted and trimmed', () => {
  const r = validateEmail('  jane@acme.co.za  ');
  assert.equal(r.ok, true);
  assert.equal(r.value, 'jane@acme.co.za');
});
check('validateEmail: missing @ or missing dot rejected', () => {
  assert.equal(validateEmail('janeacme.co.za').ok, false);
  assert.equal(validateEmail('jane@acmecoza').ok, false);
});
check('validateEmail: over 255 chars rejected (matches primary_contact_email varchar(255))', () => {
  const longLocal = 'a'.repeat(250);
  assert.equal(validateEmail(`${longLocal}@acme.co.za`).ok, false);
});

check('buildAddContactSummary: renders every field, em dash for unset ones', () => {
  const s = buildAddContactSummary({
    contact_type: 'nis_supplier',
    company_name: 'Acme',
    primary_contact_name: null,
    primary_contact_mobile: '+27821234567',
    primary_contact_email: null,
  });
  assert.ok(s.startsWith('New contact:\n\n'));
  assert.ok(s.includes('Type: NIS Supplier'));
  assert.ok(s.includes('Company: Acme'));
  assert.ok(s.includes('Contact person: —'));
  assert.ok(s.includes('Mobile: +27821234567'));
  assert.ok(s.includes('Email: —'));
});

check('extractSharedContact: pulls company/name/phone/email off a well-formed card', () => {
  const card = {
    name: { formatted_name: 'Jane Smith' },
    org: { company: 'Acme Oils' },
    phones: [{ phone: '+27821234567' }],
    emails: [{ email: 'jane@acme.co.za' }],
  };
  const r = extractSharedContact(card);
  assert.equal(r.company_name, 'Acme Oils');
  assert.equal(r.primary_contact_name, 'Jane Smith');
  assert.equal(r.primary_contact_mobile, '+27821234567');
  assert.equal(r.primary_contact_email, 'jane@acme.co.za');
});
check('extractSharedContact: falls back to phones[0].wa_id when .phone is absent', () => {
  const card = { phones: [{ wa_id: '27821234567' }] };
  assert.equal(extractSharedContact(card).primary_contact_mobile, '27821234567');
});
check('extractSharedContact: a missing/malformed card degrades to all-null, never throws', () => {
  assert.deepEqual(extractSharedContact(undefined), {
    company_name: null,
    primary_contact_name: null,
    primary_contact_mobile: null,
    primary_contact_email: null,
  });
  assert.deepEqual(extractSharedContact({}), {
    company_name: null,
    primary_contact_name: null,
    primary_contact_mobile: null,
    primary_contact_email: null,
  });
});
check('extractSharedContact: blank-string card fields are treated as absent (null), not kept', () => {
  const card = { name: { formatted_name: '   ' }, org: { company: '' } };
  const r = extractSharedContact(card);
  assert.equal(r.company_name, null);
  assert.equal(r.primary_contact_name, null);
});

check('sanitisePrefillCompany: null/empty -> null; valid value -> trimmed value; too-long -> null (silently dropped, never kept)', () => {
  assert.equal(sanitisePrefillCompany(null), null);
  assert.equal(sanitisePrefillCompany('  Acme  '), 'Acme');
  assert.equal(sanitisePrefillCompany('x'.repeat(256)), null);
});
check('sanitisePrefillName: null -> null; trims; over 255 chars -> null', () => {
  assert.equal(sanitisePrefillName(null), null);
  assert.equal(sanitisePrefillName('  Jane Smith  '), 'Jane Smith');
  assert.equal(sanitisePrefillName('x'.repeat(256)), null);
});
check('sanitisePrefillMobile: null -> null; a malformed card phone silently drops (never surfaces a bad value)', () => {
  assert.equal(sanitisePrefillMobile(null), null);
  assert.equal(sanitisePrefillMobile('not a number'), null);
  assert.equal(sanitisePrefillMobile('+27 82 123 4567'), '+27821234567');
});
check('sanitisePrefillEmail: null -> null; a malformed card email silently drops (never surfaces a bad value)', () => {
  assert.equal(sanitisePrefillEmail(null), null);
  assert.equal(sanitisePrefillEmail('not-an-email'), null);
  assert.equal(sanitisePrefillEmail('jane@acme.co.za'), 'jane@acme.co.za');
});

// ================================================================================================
// Report
// ================================================================================================

if (failures.length) {
  console.error(`\nWA ADD-CONTACT VIOLATIONS (${failures.length}):\n`);
  for (const f of failures) {
    console.error('  ' + f);
  }
  console.error(`\n${passCount} passed, ${failures.length} failed.`);
  process.exit(1);
}

console.log(`WA ADD-CONTACT VERIFY OK (${passCount} checks passed).`);
