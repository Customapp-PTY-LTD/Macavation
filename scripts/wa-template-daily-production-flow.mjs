/**
 * Offline descriptors for the five 17:30 "Open report" templates - what someone with WhatsApp
 * Manager / Control Room template access must create BY HAND. Control Room's create_template
 * tool does not accept FLOW buttons (its own schema says so, 13 Oct 2026), so these cannot be
 * submitted from this repo.
 *
 * Body variables, in the order supabase/functions/send-daily-production-report/index.ts sends them:
 *   {{1}}  the day, e.g. "Tue 13 Oct"                       (dayLabel in report-flow.ts)
 *   {{2}}  e.g. "4 820 kg (93% of target)", "4 820 kg", or "not captured yet"  (FlowReport.headline)
 * The whole body is one line on purpose: Meta rejects a variable that is the last token before a
 * line break (see scripts/wa-template-daily-production.mjs for the 2026-09-17 rejection).
 *
 * The FLOW button must point at the PUBLISHED "Daily production report 1730" Flow
 * (supabase/flows/daily-production-report.flow.json; draft id 1105160955214810 on 13 Oct 2026),
 * action "navigate", first screen SUMMARY. Its launch data is sent per message, not stored here.
 *
 * Names follow Control Room's Daily variation standard (short weekday suffix). Must match
 * FLOW_TEMPLATE_BY_WEEKDAY in supabase/functions/send-daily-production-report/report-flow.ts.
 *
 * No dependency, no network. Run: node scripts/wa-template-daily-production-flow.mjs
 */

export const FLOW_NAME = 'Daily production report 1730';
export const FLOW_FIRST_SCREEN = 'SUMMARY';
export const HEADER = 'Production report';
export const BODY =
  'Production report for {{1}} is ready. Kernel cracked today is {{2}} as at 17:30. ' +
  'Tap Open report for packing, oil, stock and alerts.';
export const FOOTER = 'Macavation daily report';
export const BUTTON = { kind: 'flow', text: 'Open report', flowAction: 'navigate', firstScreen: FLOW_FIRST_SCREEN };

const WEEKDAY_SUFFIXES = ['m', 't', 'w', 'th', 'f'];

export const TEMPLATES = WEEKDAY_SUFFIXES.map((suffix) => ({
  name: `daily_production_flow_${suffix}`,
  language: 'en',
  category: 'UTILITY',
  header: HEADER,
  body: BODY,
  footer: FOOTER,
  buttons: [BUTTON],
}));

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('wa-template-daily-production-flow.mjs')) {
  console.log('Create these five templates by hand (not submitted, not verified against Meta):\n');
  for (const t of TEMPLATES) {
    console.log(`  name:     ${t.name}`);
    console.log(`  language: ${t.language}   category: ${t.category}`);
    console.log(`  header:   ${t.header}`);
    console.log(`  body:     ${t.body}`);
    console.log(`  footer:   ${t.footer}`);
    console.log(`  button:   FLOW "${BUTTON.text}" -> "${FLOW_NAME}", ${BUTTON.flowAction}, first screen ${BUTTON.firstScreen}`);
    console.log('');
  }
}
