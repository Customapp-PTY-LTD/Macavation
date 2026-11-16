/**
 * Supabase Edge Function: the daily 13:00 SAST WhatsApp reminder about open My Day tasks.
 * Called by public.cron_send_open_task_reminders()
 * (migrations/20261116180000_open_task_whatsapp_reminder.sql) — see that migration for who is
 * reminded and why.
 *
 * Sends the approved template `macavation_open_tasks`:
 *   "Hi {{1}}, you still have {{2}} open tasks in Macavation, the oldest from {{3}}.
 *    Please open My Day to finish them."
 *
 * Auth: Bearer WA_CRON_AUTH_SECRET, constant-time compare — the same gate and the same secret as
 * send-daily-production-report (see its header: the runtime's SUPABASE_SERVICE_ROLE_KEY no longer
 * equals the Vault wa_cron_service_role_key the cron wrapper sends). SUPABASE_SERVICE_ROLE_KEY is
 * still used for the outgoing database client.
 *
 * Body (all optional):
 *   { "dry_run": true }        list who would be messaged, send nothing, write nothing
 *   { "user_id": "<uuid>" }    only this person (for a one-off test)
 *
 * Every attempt is written to task_reminder_wa_sends; a 'sent' row stops that person getting a
 * second reminder the same SAST day.
 *
 * Deploy: supabase functions deploy send-task-reminder-whatsapp --no-verify-jwt
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { sendTemplate, type WaTemplateComponent } from '../_shared/wa-send.ts';
import { timingSafeEqual } from '../_shared/wa-inbound.ts';

const TEMPLATE_NAME = 'macavation_open_tasks';
const MAX_RECIPIENTS = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// deno-lint-ignore no-explicit-any
type AnyRow = Record<string, any>;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Template parameters may not contain newlines, tabs or runs of spaces. */
function clean(s: string): string {
  return s.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
}

function sastToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(new Date());
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { success: false, error: 'Method not allowed.' });

  const provided = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const expected = (Deno.env.get('WA_CRON_AUTH_SECRET') || '').trim();
  if (!provided || !expected || !timingSafeEqual(provided, expected)) {
    return json(401, { success: false, error: 'Service key required.' });
  }

  let body: AnyRow = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text);
  } catch {
    return json(400, { success: false, error: 'Request body must be JSON.' });
  }
  const dryRun = body?.dry_run === true;
  const onlyUser = typeof body?.user_id === 'string' ? body.user_id.trim() : '';
  if (onlyUser && !UUID_RE.test(onlyUser)) {
    return json(400, { success: false, error: 'user_id must be a uuid.' });
  }

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data, error } = await sb.rpc('open_task_reminder_recipients', {
    p_user_id: onlyUser || null,
  });
  if (error) {
    console.error('[send-task-reminder-whatsapp] recipients failed:', error.message);
    return json(502, { success: false, error: 'Could not load the reminder list.' });
  }
  let recipients = (Array.isArray(data) ? data : []) as AnyRow[];
  if (recipients.length > MAX_RECIPIENTS) {
    console.warn(`[send-task-reminder-whatsapp] capping ${recipients.length} recipients at ${MAX_RECIPIENTS}.`);
    recipients = recipients.slice(0, MAX_RECIPIENTS);
  }

  if (dryRun) {
    return json(200, {
      dry_run: true,
      would_send: recipients.map((r) => ({
        first_name: r.first_name,
        role_name: r.role_name,
        task_count: r.task_count,
        oldest: r.oldest_label,
      })),
    });
  }

  const today = sastToday();
  let sent = 0;
  let failed = 0;
  const results: AnyRow[] = [];

  for (const r of recipients) {
    const params = [String(r.first_name || 'there'), String(r.task_count), String(r.oldest_label || 'earlier')];
    const components: WaTemplateComponent[] = [
      { type: 'body', parameters: params.map((text) => ({ type: 'text' as const, text: clean(text) })) },
    ];

    let ok = false;
    let wamid: string | null = null;
    let err: string | null = null;
    try {
      const res = await sendTemplate(String(r.phone), TEMPLATE_NAME, 'en', components);
      ok = res.ok;
      wamid = res.wamid;
      err = res.error;
    } catch (e) {
      err = String((e as Error)?.message || e);
    }

    const { error: logError } = await sb.from('task_reminder_wa_sends').insert({
      user_id: r.user_id,
      sent_on: today,
      phone: r.phone,
      task_count: r.task_count,
      status: ok ? 'sent' : 'failed',
      external_message_id: wamid,
      error: err,
    });
    if (logError) console.warn('[send-task-reminder-whatsapp] log insert failed:', logError.message);

    if (ok) sent++;
    else failed++;
    results.push({ first_name: r.first_name, role_name: r.role_name, status: ok ? 'sent' : 'failed', error: err });
  }

  return json(200, { sent, failed, results });
});
