/**
 * The five `daily_production_template_<suffix>` WhatsApp template definitions — repo-local
 * DESCRIPTORS, not a Meta template-creation payload. This file makes no network call, reads no
 * environment variable, reads no credential, names no Control Room URL and no Supabase project
 * ref. It is not a submission client (this repo has none — see scripts/verify-wa-template-buttons.mjs's
 * own header for why) and it does not know, and does not assert, whether any of these templates
 * has been submitted to or approved by Meta. That is a human's step, outside this repo, using
 * whatever Meta gives for template creation — the exact wire shape Meta's API wants is not
 * verifiable from this checkout, and mapping TEMPLATE_BUTTONS onto it is that human's job, not
 * this file's.
 *
 * There are five templates, one per weekday (Monday–Friday), named per Control Room's Daily
 * variation standard: `daily_production_template_` + a short suffix (`m`/`t`/`w`/`th`/`f`), never
 * the weekday spelled out — Control Room's send-template locates the rest of the set by appending
 * that exact suffix, so a spelled-out name is never rotated to. See
 * supabase/functions/send-daily-production-report/index.ts's TEMPLATE_NAME_BY_WEEKDAY, which picks
 * one of these five names by the report date's weekday and skips outright on Saturday/Sunday, since
 * no template exists for those two days. All five share identical body wording and buttons; only
 * `name` differs between them.
 *
 * Body wording is derived from `renderedBodyText` in
 * supabase/functions/send-daily-production-report/index.ts (the plain-text audit rendering of
 * what is actually sent), with `{{1}}`..`{{8}}` standing in for `params[0]`..`params[7]` — the
 * eight-parameter, fixed-order array `buildTemplateParams` in that same file returns. This wording
 * deliberately matches the on-demand "Production today" menu reply (MENU_ITEMS' `production` entry
 * in supabase/functions/whatsapp-inbound/index.ts) word for word, since both read the same
 * get_daily_digest() figures — a member should see the same thing whether it is pushed to them at
 * 17:00 or they ask for it themselves. If either wording changes, re-derive the other from it and
 * re-check this comment.
 *
 * The trailing "." after {{8}} is required, not decorative: Meta rejects a template body whose
 * literal last (or first) token is a variable placeholder ("Variables can't be at the start or end
 * of the template", error code 100/2388299 — hit and confirmed live against Control Room's
 * templates-api on 2026-09-17 submitting these exact five templates before this fix). Never let the
 * body's last characters be `{{n}}` with nothing after it.
 *
 * No dependency, no import beyond Node stdlib (none needed at all). Safe to run with zero
 * environment configured.
 */

export const TEMPLATE_BUTTONS = [
  { kind: 'quick_reply', text: 'View report' },
  { kind: 'quick_reply', text: 'Menu' },
];

// {{1}} cannot be the last token on its line: Meta's "variable can't be at the start or end"
// check (100/2388299) also trips when a variable is the last token before a line break, not
// only at the very end of the whole body — confirmed live against Control Room's templates-api
// on 2026-09-17 (all 5 daily templates failed at Meta with this error despite the body's overall
// last character being a literal "." after {{8}}, because {{1}} sat right before the line 1 \n).
// A trailing "report" after {{1}} keeps it from ending line 1.
const BODY = [
  'Production · {{1}} report',
  'Kernel cracked: {{2}} kg today, {{3}} kg this week',
  'Kernel packed: {{4}} kg today, {{5}} kg this week',
  'Oil: {{6}} L today, {{7}} L this week',
  'Batches in production: {{8}}.',
].join('\n');

// Control Room's Daily variation standard: send-template locates the rest of a weekday set by
// appending this exact suffix, so it must be the short form, never the weekday spelled out.
const WEEKDAY_SUFFIXES = ['m', 't', 'w', 'th', 'f'];

export const TEMPLATES = WEEKDAY_SUFFIXES.map((suffix) => ({
  name: `daily_production_template_${suffix}`,
  language: 'en',
  category: 'UTILITY',
  body: BODY,
  buttons: TEMPLATE_BUTTONS,
}));

// ---- Printer — runs at module top level, since nothing imports this file. ----------------------
console.log('WhatsApp template definitions (offline descriptors — not submitted, not verified against Meta):');
console.log('');
for (const template of TEMPLATES) {
  console.log(`  name:     ${template.name}`);
  console.log(`  language: ${template.language}`);
  console.log(`  category: ${template.category}`);
  console.log('');
  console.log('  body:');
  for (const line of template.body.split('\n')) {
    console.log(`    ${line}`);
  }
  console.log('');
  console.log('  buttons:');
  template.buttons.forEach((b, i) => {
    console.log(`    ${i + 1}. [${b.kind}] ${b.text}`);
  });
  console.log('');
  console.log('  ----------------------------------------------------------------');
  console.log('');
}
console.log(
  `These are definitions only, for ${TEMPLATES.length} separate templates. A human must submit each to ` +
    'Meta, and this checkout cannot see whether any has been, or whether Meta has approved it.'
);
