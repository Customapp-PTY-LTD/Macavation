/**
 * The `macavation_alert` WhatsApp template definition — a repo-local DESCRIPTOR, not a Meta
 * template-creation payload. Same convention as scripts/wa-template-daily-production.mjs and
 * scripts/wa-template-period-reports.mjs (see either file's own header for the fuller rationale):
 * this file makes no network call, reads no environment variable, reads no credential, names no
 * Control Room URL and no Supabase project ref. It is not a submission client (this repo has none)
 * and it does not know, and does not assert, whether this template has been submitted to or
 * approved by Meta. That is a human's step, outside this repo.
 *
 * Body wording and the three body parameters ({{1}} = severity label, {{2}} = alert title,
 * {{3}} = a one-line detail) mirror buildAlertTemplateParams in
 * supabase/functions/send-alert-whatsapp/index.ts. If that function's wording or parameter order
 * ever changes, re-derive this body from it and re-check this comment.
 *
 * The two button labels are fixed by contract 6 of the plan this file was built from: "Mark
 * resolved" and "Menu" — no "Snooze" (nothing in this codebase models a snooze for
 * dashboard_alerts; adding one is out of scope here). Unlike scripts/wa-template-daily-
 * production.mjs's and scripts/wa-template-period-reports.mjs's buttons, "Mark resolved" is NOT
 * static: it carries a per-alert reply id built by buildReplyId
 * (supabase/functions/send-alert-whatsapp/index.ts), because an alert push is per-alert and needs
 * to say which one — those other templates' buttons never needed to carry anything beyond "which
 * action". "Menu" stays static and dispatches through the SAME TEMPLATE_BUTTON_ROUTES.menu entry
 * the daily/period templates' own "Menu" button already uses
 * (supabase/functions/whatsapp-inbound/index.ts).
 *
 * No dependency, no import beyond Node stdlib (none needed at all). Safe to run with zero
 * environment configured.
 */

export const TEMPLATE_BUTTONS = [
  { kind: 'quick_reply', text: 'Mark resolved' },
  { kind: 'quick_reply', text: 'Menu' },
];

export const TEMPLATE = {
  name: 'macavation_alert',
  language: 'en',
  category: 'UTILITY',
  body: ['{{1}} alert: {{2}}', '{{3}}'].join('\n'),
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
