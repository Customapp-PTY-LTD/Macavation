/**
 * The `macavation_weekly_report` and `macavation_monthly_report` WhatsApp template definitions —
 * repo-local DESCRIPTORS, not a Meta template-creation payload. This file makes no network call,
 * reads no environment variable, reads no credential, names no Control Room URL and no Supabase
 * project ref. It is not a submission client (this repo has none — see
 * scripts/verify-wa-template-buttons.mjs's own header, and
 * scripts/wa-template-daily-production.mjs's header, for why) and it does not know, and does not
 * assert, whether either template has been submitted to or approved by Meta. That is a human's
 * step, outside this repo, using whatever Meta gives for template creation — the exact wire shape
 * Meta's API wants is not verifiable from this checkout.
 *
 * Body wording and the two body parameters ({{1}} = period_label, {{2}} = published_at truncated
 * to YYYY-MM-DD) are fixed by the plan this file was built from — this file authors none of the
 * wording itself, it only records it.
 *
 * The two button labels below are duplicated from scripts/wa-template-daily-production.mjs
 * deliberately, rather than imported: importing that file would execute its top-level printer as
 * a side effect. scripts/verify-wa-period-reports.mjs asserts these stay identical to that file's
 * TEMPLATE_BUTTONS, so they cannot drift silently.
 *
 * No dependency, no import beyond Node stdlib (none needed at all). Safe to run with zero
 * environment configured.
 */

export const PERIOD_TEMPLATE_BUTTONS = [
  { kind: 'quick_reply', text: 'View report' },
  { kind: 'quick_reply', text: 'Menu' },
];

export const TEMPLATE_WEEKLY = {
  name: 'macavation_weekly_report',
  language: 'en',
  category: 'UTILITY',
  body: [
    'Macavation weekly report — {{1}}',
    'Published {{2}}',
    'Tap "View report" for your link, or "Menu" for other options.',
  ].join('\n'),
  buttons: PERIOD_TEMPLATE_BUTTONS,
};

export const TEMPLATE_MONTHLY = {
  name: 'macavation_monthly_report',
  language: 'en',
  category: 'UTILITY',
  body: [
    'Macavation monthly report — {{1}}',
    'Published {{2}}',
    'Tap "View report" for your link, or "Menu" for other options.',
  ].join('\n'),
  buttons: PERIOD_TEMPLATE_BUTTONS,
};

// ---- Printer — runs at module top level, since nothing imports this file. ----------------------
function printTemplate(t) {
  console.log(`  name:     ${t.name}`);
  console.log(`  language: ${t.language}`);
  console.log(`  category: ${t.category}`);
  console.log('');
  console.log('  body:');
  for (const line of t.body.split('\n')) {
    console.log(`    ${line}`);
  }
  console.log('');
  console.log('  buttons:');
  t.buttons.forEach((b, i) => {
    console.log(`    ${i + 1}. [${b.kind}] ${b.text}`);
  });
  console.log('');
}

console.log('WhatsApp template definitions (offline descriptors — not submitted, not verified against Meta):');
console.log('');
printTemplate(TEMPLATE_WEEKLY);
printTemplate(TEMPLATE_MONTHLY);
console.log(
  'These are definitions only. A human must submit each to Meta, and this checkout cannot see ' +
    'whether either has been, or whether Meta has approved it.'
);
