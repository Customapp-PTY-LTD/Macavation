/**
 * The `macavation_daily_production` WhatsApp template definition — a repo-local DESCRIPTOR, not a
 * Meta template-creation payload. This file makes no network call, reads no environment variable,
 * reads no credential, names no Control Room URL and no Supabase project ref. It is not a
 * submission client (this repo has none — see scripts/verify-wa-template-buttons.mjs's own header
 * for why) and it does not know, and does not assert, whether this template has been submitted to
 * or approved by Meta. That is a human's step, outside this repo, using whatever Meta gives for
 * template creation — the exact wire shape Meta's API wants is not verifiable from this checkout,
 * and mapping TEMPLATE_BUTTONS onto it is that human's job, not this file's.
 *
 * Body wording is derived from `renderedBodyText` in
 * supabase/functions/send-daily-production-report/index.ts (the plain-text audit rendering of
 * what is actually sent), with `{{1}}`..`{{7}}` standing in for `params[0]`..`params[6]` — the
 * seven-parameter, fixed-order array `buildTemplateParams` in that same file returns. If that
 * function's wording or parameter order ever changes, re-derive this body from it and re-check
 * this comment.
 *
 * No dependency, no import beyond Node stdlib (none needed at all). Safe to run with zero
 * environment configured.
 */

export const TEMPLATE_BUTTONS = [
  { kind: 'quick_reply', text: 'View report' },
  { kind: 'quick_reply', text: 'Menu' },
];

export const TEMPLATE = {
  name: 'macavation_daily_production',
  language: 'en',
  category: 'UTILITY',
  body: [
    'Daily production report for {{1}}',
    'Cracked: {{2}} kg',
    'SK packed: {{3}} kg',
    'Wholes: {{4}}%',
    'NIS received: {{5}} kg',
    'WTD cracked: {{6}} kg',
    'WTD target: {{7}} kg',
  ].join('\n'),
  buttons: TEMPLATE_BUTTONS,
};

// ---- Printer — runs at module top level, since nothing imports this file. ----------------------
console.log('WhatsApp template definition (offline descriptor — not submitted, not verified against Meta):');
console.log('');
console.log(`  name:     ${TEMPLATE.name}`);
console.log(`  language: ${TEMPLATE.language}`);
console.log(`  category: ${TEMPLATE.category}`);
console.log('');
console.log('  body:');
for (const line of TEMPLATE.body.split('\n')) {
  console.log(`    ${line}`);
}
console.log('');
console.log('  buttons:');
TEMPLATE.buttons.forEach((b, i) => {
  console.log(`    ${i + 1}. [${b.kind}] ${b.text}`);
});
console.log('');
console.log(
  'This is a definition only. A human must submit it to Meta, and this checkout cannot see ' +
    'whether it has been, or whether Meta has approved it.'
);
