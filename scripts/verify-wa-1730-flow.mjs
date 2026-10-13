/**
 * Static checks for the 17:30 report Flow. Hermetic: fs reads only, no network, no Deno.
 *
 * Guards the seams a reviewer cannot see from one file:
 *   1. The Flow JSON's SUMMARY screen declares exactly the launch-data keys report-flow.ts sends,
 *      and the NavigationList is the only component on it (Meta rejects anything else).
 *   2. DETAIL takes body_markdown, which is what every row's payload carries.
 *   3. The five template names agree between report-flow.ts and the descriptor script.
 *   4. The template body has exactly {{1}} and {{2}} and is one line.
 *   5. The sender only takes the Flow path when WA_DAILY_REPORT_1730_FLOW_ID is set, and keeps the
 *      text-template fallback.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
let checks = 0;
const fail = (m) => {
  console.error(`wa-1730-flow:verify FAILED - ${m}`);
  process.exit(1);
};
const ok = (cond, m) => {
  checks++;
  if (!cond) fail(m);
};

const flow = JSON.parse(read('supabase/flows/daily-production-report.flow.json'));
const summary = flow.screens.find((s) => s.id === 'SUMMARY');
const detail = flow.screens.find((s) => s.id === 'DETAIL');
ok(summary && detail, 'Flow must have SUMMARY and DETAIL screens');
ok(
  JSON.stringify(Object.keys(summary.data).sort()) === JSON.stringify(['description', 'label', 'rows']),
  `SUMMARY must declare exactly label, description, rows (has ${Object.keys(summary.data).join(', ')})`
);
ok(
  summary.layout.children.length === 1 && summary.layout.children[0].type === 'NavigationList',
  'SUMMARY layout must be a single NavigationList'
);
ok(detail.terminal === true && 'body_markdown' in detail.data, 'DETAIL must be terminal and take body_markdown');

const builder = read('supabase/functions/send-daily-production-report/report-flow.ts');
ok(/actionData:\s*\{\s*label,\s*description,\s*rows\s*\}/.test(builder), 'report-flow.ts must send { label, description, rows }');
ok(/payload:\s*\{\s*body_markdown:/.test(builder), 'every row must navigate to DETAIL with body_markdown');
ok(/name:\s*'DETAIL'/.test(builder), "rows must navigate to the 'DETAIL' screen");

const builderNames = [...builder.matchAll(/'(daily_production_flow_[a-z]+)'/g)].map((m) => m[1]).sort();
const descriptor = await import(new URL('./wa-template-daily-production-flow.mjs', import.meta.url));
const descriptorNames = descriptor.TEMPLATES.map((t) => t.name).sort();
ok(
  JSON.stringify(builderNames) === JSON.stringify(descriptorNames) && builderNames.length === 5,
  `template names differ: report-flow.ts ${builderNames} vs descriptor ${descriptorNames}`
);
const vars = [...descriptor.BODY.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1]);
ok(JSON.stringify(vars) === JSON.stringify(['1', '2']), 'template body must use exactly {{1}} and {{2}}');
ok(!descriptor.BODY.includes('\n'), 'template body must be one line');

const sender = read('supabase/functions/send-daily-production-report/index.ts');
ok(/Deno\.env\.get\('WA_DAILY_REPORT_1730_FLOW_ID'\)/.test(sender), 'sender must read WA_DAILY_REPORT_1730_FLOW_ID');
ok(/const flowTemplateName = FLOW_ID \?/.test(sender), 'Flow path must be gated on FLOW_ID');
ok(/sub_type: 'flow'/.test(sender), 'sender must attach a flow button');
ok(/if \(!flowTemplateName \|\| !result\.ok\)/.test(sender), 'sender must fall back to the text template');

console.log(`wa-1730-flow:verify passed - ${checks} checks.`);
