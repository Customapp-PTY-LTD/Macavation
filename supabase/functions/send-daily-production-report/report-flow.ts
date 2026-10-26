/**
 * The 17:30 report as a WhatsApp Flow (supabase/flows/daily-production-report.flow.json).
 *
 * Pure builders only - no env, no network. Everything is computed ONCE per run from the same
 * get_daily_digest() payload the text template uses, and frozen into the template's FLOW button as
 * the SUMMARY screen's launch data. Opening the Flow at 20:00 still shows the 17:30 figures, which
 * is why every screen says "As at 17:30 SAST".
 *
 * Screen data contract (must match the Flow JSON exactly - Meta rejects undeclared keys):
 *   SUMMARY: { label: string, description: string, rows: NavigationList item[] }
 *   DETAIL:  { body_markdown: string }   (passed per row in on-click-action.payload)
 * A NavigationList must be the only component on its screen (Meta validation, 13 Oct 2026), so the
 * date and the "not captured" note live in the list's own label/description.
 *
 * The daily target is kernel_pipeline_settings.daily_cracking_target_kg (Kernel Pipeline Settings,
 * migrations/20261013110000). Null means nobody set one: no % and no target row is shown anywhere.
 */

// deno-lint-ignore no-explicit-any
type AnyRow = Record<string, any>;

/** Approved-template names, one per weekday, per Control Room's Daily variation standard. */
export const FLOW_TEMPLATE_BY_WEEKDAY: Record<number, string> = {
  1: 'daily_production_flow_m',
  2: 'daily_production_flow_t',
  3: 'daily_production_flow_w',
  4: 'daily_production_flow_th',
  5: 'daily_production_flow_f',
};

const NBSP = ' ';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Whole number with a non-breaking thousands space; null stays null. */
function fmt(v: number | null): string | null {
  if (v === null) return null;
  const neg = v < 0;
  const s = String(Math.round(Math.abs(v))).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return (neg ? '-' : '') + s;
}

function kg(v: number | null): string {
  const f = fmt(v);
  return f === null ? 'not captured' : `${f}${NBSP}kg`;
}

/** A row's right-hand figure: a dash, never "not captured", which would not fit in 10 characters. */
function endKg(v: number | null): string {
  return v === null ? '-' : kg(v);
}

function endLitres(v: number | null): string {
  return v === null ? '-' : litres(v);
}

/** "2026-10-19" -> "19 Oct", for the 10-character right-hand slot. */
function dayMonth(dateStr: unknown): string | null {
  if (typeof dateStr !== 'string' || !dateStr.trim()) return null;
  const d = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function litres(v: number | null): string {
  const f = fmt(v);
  return f === null ? 'not captured' : `${f}${NBSP}L`;
}

/** "2026-10-13" -> "Tue 13 Oct". The weekday of a calendar date is timezone-free. */
export function dayLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "2026-11-05" -> "5 Nov 2026"; anything unparseable comes back unchanged. */
function shortDate(dateStr: unknown): string | null {
  if (typeof dateStr !== 'string' || !dateStr.trim()) return null;
  const d = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Strips characters that would break a markdown table cell or a template parameter. */
function cell(s: string): string {
  return s.replace(/[|\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
}

function table(rows: [string, string][]): string {
  return '| | |\n|---|---|\n' + rows.map(([a, b]) => `| ${cell(a)} | ${cell(b)} |`).join('\n');
}

const AS_AT = 'As at 17:30 SAST. This week runs from Monday.';

/**
 * Meta's NavigationList item length caps. The Flow validator only checks the Flow JSON, never the
 * launch data, so an over-long value is accepted at send time and then fails on the handset with
 * "Something went wrong" - which is what the first live send did on 13 Oct 2026 ("Kernel on hand
 * 57 505 kg" = 24, "19 Oct 2026" = 11, "NIS runs out" = 12). Caps as documented by Meta for
 * NavigationList; every value below is written to fit, and fit() is the backstop.
 */
export const ROW_LIMITS = { title: 30, description: 20, endTitle: 10, endDescription: 10 } as const;

/** Hard-caps a row value, ending in an ellipsis when it had to be cut. */
export function fit(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

function row(id: string, title: string, description: string, endTitle: string, endDescription: string, body: string) {
  return {
    id,
    'main-content': { title: fit(title, ROW_LIMITS.title), description: fit(description, ROW_LIMITS.description) },
    end: { title: fit(endTitle, ROW_LIMITS.endTitle), description: fit(endDescription, ROW_LIMITS.endDescription) },
    'on-click-action': {
      name: 'navigate',
      next: { type: 'screen', name: 'DETAIL' },
      payload: { body_markdown: body },
    },
  };
}

export type FlowReport = {
  /** Template body {{2}}: today's cracked figure, with % of target when a target is set. */
  headline: string;
  /** SUMMARY screen launch data. */
  actionData: { label: string; description: string; rows: AnyRow[] };
  /** Plain-text audit rendering stored on the delivery row. */
  auditText: string;
};

export function buildFlowReport(digest: AnyRow, dateStr: string, targetKg: number | null): FlowReport {
  const ks = (digest?.kernel_stats as AnyRow) ?? {};
  const oil = (digest?.oil_stats as AnyRow) ?? {};
  const ext = (digest?.extended_kpis as AnyRow) ?? {};
  const alerts: AnyRow[] = Array.isArray(digest?.open_alerts) ? digest.open_alerts : [];

  const cracked = toNum(ks.kg_cracked_today);
  const crackedWk = toNum(ks.kg_cracked_week);
  const packed = toNum(ks.kg_packed_today);
  const packedWk = toNum(ks.kg_packed_week);
  const oilToday = toNum(oil.litres_today);
  const oilWk = toNum(oil.litres_week);
  const batches = toNum(ks.batches_in_production);
  const onHand = toNum(ext.kernel_soh_kg);
  const nisRunOut = shortDate(digest?.nis_runway?.final_depletion_date);
  const nisRunOutShort = dayMonth(digest?.nis_runway?.final_depletion_date);
  const target = targetKg !== null && targetKg > 0 ? targetKg : null;

  // A day with nothing cracked by 17:30 is reported as such, never as a % of target. Whether the
  // sheets are late or nothing ran cannot be told apart from the digest, so the wording covers both.
  const nothingYet = cracked === null || cracked === 0;
  const pctOfTarget = !nothingYet && target !== null ? Math.round((cracked! / target) * 100) : null;

  const headline = nothingYet
    ? 'not captured yet'
    : pctOfTarget !== null
      ? `${kg(cracked)} (${pctOfTarget}% of target)`
      : kg(cracked);

  const crackedRows: [string, string][] = [['Today', nothingYet ? 'Not captured yet' : kg(cracked)]];
  if (target !== null) {
    crackedRows.push(['Target today', kg(target)]);
    if (!nothingYet) {
      const diff = cracked! - target;
      crackedRows.push(['Difference', `${diff >= 0 ? '+' : '-'}${kg(Math.abs(diff))}`]);
    }
  }
  crackedRows.push(['This week', kg(crackedWk)]);
  crackedRows.push(['Batches in production', fmt(batches) ?? 'not captured']);
  const crackedBody =
    `# Kernel cracked\n\n${table(crackedRows)}\n\n` +
    (target === null ? 'No daily target is set. It is set on Kernel Pipeline Settings.\n\n' : '') +
    AS_AT;

  const alertsBody = alerts.length
    ? '# Open alerts\n\n' +
      alerts
        .slice(0, 10)
        // Plain bullets, no bold: alert titles carry literal asterisks (e.g. "Low stock: Protein *").
        .map((a) => `- ${cell(String(a.title ?? 'Alert'))} (${cell(String(a.severity ?? 'alert'))})`)
        .join('\n') +
      (alerts.length > 10 ? `\n\nAnd ${alerts.length - 10} more on the portal.` : '') +
      '\n\nAlerts are cleared on the portal, not from here.'
    : '# Open alerts\n\nNo open alerts at 17:30.';

  const rows = [
    row(
      'cracked',
      'Kernel cracked',
      `Week ${kg(crackedWk)}`,
      nothingYet ? '-' : endKg(cracked),
      nothingYet
        ? 'Not in yet'
        : pctOfTarget !== null
          ? (`${pctOfTarget}% target`.length <= ROW_LIMITS.endDescription ? `${pctOfTarget}% target` : `${pctOfTarget}%`)
          : 'today',
      crackedBody
    ),
    row(
      'packed',
      'Kernel packed',
      `Week ${kg(packedWk)}`,
      endKg(packed),
      'today',
      `# Kernel packed\n\n${table([['Today', kg(packed)], ['This week', kg(packedWk)]])}\n\n${AS_AT}`
    ),
    row(
      'oil',
      'Oil',
      `Week ${litres(oilWk)}`,
      endLitres(oilToday),
      'today',
      `# Oil\n\n${table([['Today', litres(oilToday)], ['This week', litres(oilWk)]])}\n\n${AS_AT}`
    ),
    row(
      'stock',
      'Stock and cover',
      `On hand ${kg(onHand)}`,
      nisRunOutShort ?? '-',
      'NIS ends',
      `# Stock and cover\n\n${table([
        ['Kernel on hand', kg(onHand)],
        ['NIS runs out', nisRunOut ?? 'not calculable, no crack rate set'],
      ])}\n\n${AS_AT}`
    ),
    row(
      'alerts',
      'Open alerts',
      alerts.length ? cell(String(alerts[0].title ?? 'Alert')).slice(0, 60) : 'Nothing open',
      String(alerts.length),
      alerts.length ? 'open' : 'all clear',
      alertsBody
    ),
  ];

  const label = dayLabel(dateStr);
  const description =
    `Figures as at 17:30 SAST · ${fmt(batches) ?? 'no'} batches in production.` +
    (nothingYet ? " No cracking was captured for today by 17:30, so this week's totals run up to the last capture." : '') +
    ' Tap a row for the detail.';

  const auditText = [
    `Production report · ${label} (Flow)`,
    `Kernel cracked today: ${headline}`,
    `Kernel packed: ${kg(packed)} today, ${kg(packedWk)} this week`,
    `Oil: ${litres(oilToday)} today, ${litres(oilWk)} this week`,
    `Kernel on hand: ${kg(onHand)}; NIS runs out: ${nisRunOut ?? 'not calculable'}`,
    `Open alerts: ${alerts.length}`,
  ].join('\n');

  return { headline, actionData: { label, description, rows }, auditText };
}
