-- ============================================================================
-- Period (weekly/monthly) WhatsApp report senders — the recipient, instance and
-- idempotency plumbing that send-period-report/index.ts needs.
--
-- WHAT IS MISSING TODAY, stated only as this checkout can prove it: the only two
-- selectors over report_subscriptions hard-code rs.report_kind = 'daily'
-- (migrations/20260825090000_report_subscriptions_and_staff.sql:272 and :309, and the
-- post-wa-flow-02 report_daily_recipients() at migrations/20260907130000_report_opt_out.sql:238),
-- while set_report_subscription (20260825090000_report_subscriptions_and_staff.sql:187-213)
-- already accepts 'weekly' and 'monthly' as report_kind values. A user ticking the Weekly or
-- Monthly column in the distribution panel therefore writes a report_subscriptions row that
-- nothing in this repo ever reads. This file does not add or change any row-count or
-- date-stamped measurement of that state — it cannot be checked against a live database from
-- this checkout — it only records the code fact above, which is directly visible in the cited
-- files and line numbers.
--
-- WHAT THIS ADDS — three new, read-only-selection/read functions, all service_role only:
--   1. public.report_recipients_for_kind(p_kind text) — the parameterised sibling of
--      report_daily_recipients(), selecting active, non-opted-out, non-muted recipients
--      subscribed to a normalised 'weekly' or 'monthly' report_kind. report_daily_recipients()
--      itself is left byte-identical; it is not rewritten to delegate to this function.
--   2. public.latest_published_instance(p_period_type text) — returns a bare uuid (not jsonb):
--      the caller only ever needs the id to pass to get_report_instance and to
--      period_report_already_sent, and a bare-scalar return keeps the "read directly from
--      `data`, never through the TABLE-returning rpcRows helper" discipline identical to
--      daily_report_already_sent's. It resolves to the newest published instance of that period
--      type whose period_start is either the current period's start or the immediately
--      preceding period's start — never the current period alone, because a weekly/monthly
--      report published after its own period has ended (the normal case near a period boundary)
--      would otherwise never be selected; and never unbounded, because an unprompted broadcast
--      of a months-old backlog instance the moment this ships would not be a "send" so much as a
--      surprise. It deliberately does not call get_report_current_period: that function computes
--      the period containing *today*, and pinning to it produces exactly the missed-instance bug
--      this function exists to avoid.
--   3. public.period_report_already_sent(p_report_instance_id uuid) — the per-instance,
--      per-message-kind idempotency guard. Keyed on report_instance_id (a fresh republish is a
--      fresh, sendable id by design — there is no "force" to bypass) AND on
--      message_kind = 'template', because send-report-whatsapp's manual send path calls
--      begin_report_delivery without p_report_kind/p_message_kind
--      (supabase/functions/send-report-whatsapp/index.ts:509-526), which default to
--      'weekly'/'text' (20260825091000_daily_production_report.sql:124-127) — without the
--      message_kind clause, one manual send to one person would permanently suppress the
--      automatic broadcast to everyone else for that same instance.
--
-- OUT OF SCOPE: applying this migration. That is a human step, on dev first, outside this repo
-- and outside this plan.
--
-- Idempotent to re-run: every function is CREATE OR REPLACE, every grant statement is safe to
-- repeat, and there is no destructive DDL anywhere in this file.
-- ============================================================================

-- ============================================================================
-- 1. report_recipients_for_kind(p_kind text)
--
-- Parameterised sibling of report_daily_recipients()
-- (migrations/20260907130000_report_opt_out.sql:226-244), left byte-identical and NOT rewritten
-- to delegate here. Same is_active / opted_out_at / muted_until / phone-normalisation / ordering
-- shape; the only change is the join predicate, which matches a normalised report_kind instead of
-- the literal 'daily'. Only 'week'/'weekly' and 'month'/'monthly' (case/whitespace-insensitive)
-- normalise to a real report_kind; anything else — including 'daily', '', and NULL — normalises
-- to NULL, which the join can never match, so the function returns zero rows rather than falling
-- back onto the daily roster.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.report_recipients_for_kind(p_kind text)
RETURNS TABLE (
    recipient_id uuid,
    display_name text,
    phone        text,
    is_staff     boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
    SELECT rr.id, rr.display_name, public.report_normalize_wa_phone(rr.phone), rr.is_staff
    FROM public.report_recipients rr
    JOIN public.report_subscriptions rs
      ON rs.recipient_id = rr.id
     AND rs.report_kind = (
             CASE lower(TRIM(COALESCE(p_kind, '')))
                 WHEN 'week'    THEN 'weekly'
                 WHEN 'weekly'  THEN 'weekly'
                 WHEN 'month'   THEN 'monthly'
                 WHEN 'monthly' THEN 'monthly'
                 ELSE NULL
             END
         )
    WHERE rr.is_active
      AND rs.is_active
      AND rr.opted_out_at IS NULL
      AND (rs.muted_until IS NULL OR rs.muted_until < public.report_sast_today())
    ORDER BY rr.display_name;
$fn$;

COMMENT ON FUNCTION public.report_recipients_for_kind(text) IS
    'Parameterised sibling of report_daily_recipients() for report_kind = weekly/monthly. '
    'Normalises p_kind to weekly/monthly/NULL inline; an unrecognised or daily p_kind matches no '
    'subscription row and returns zero rows. report_daily_recipients() itself is unmodified.';

-- ============================================================================
-- 2. latest_published_instance(p_period_type text)
--
-- Newest published instance for the given period type, restricted to the current period's start
-- or the immediately preceding period's start. Both boundaries come from existing helpers
-- (report_normalise_period_start, report_sast_today) — no calendar arithmetic is recomputed here,
-- and get_report_current_period is deliberately not called: it resolves the period containing
-- *today*, and a weekly/monthly report published after its own period has ended (the normal case)
-- would then never be selected.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.latest_published_instance(p_period_type text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
    WITH bounds AS (
        SELECT k.kind,
               public.report_normalise_period_start(k.kind, public.report_sast_today()) AS cur
        FROM (SELECT CASE lower(TRIM(COALESCE(p_period_type, '')))
                          WHEN 'week'    THEN 'weekly'
                          WHEN 'weekly'  THEN 'weekly'
                          WHEN 'month'   THEN 'monthly'
                          WHEN 'monthly' THEN 'monthly'
                          ELSE NULL
                     END AS kind) k
    )
    SELECT ri.id
    FROM public.report_instances ri, bounds b
    WHERE b.kind IS NOT NULL
      AND ri.period_type = b.kind
      AND ri.status = 'published'
      AND ri.period_start IN (b.cur, public.report_normalise_period_start(b.kind, b.cur - 1))
    ORDER BY ri.period_start DESC, ri.version DESC, ri.published_at DESC NULLS LAST
    LIMIT 1;
$fn$;

COMMENT ON FUNCTION public.latest_published_instance(text) IS
    'Newest published report_instances row for p_period_type (weekly/monthly), restricted to the '
    'current period''s start or the immediately preceding one. The two-period window is the whole '
    'staleness bound: a report published late for the period just ended still sends; a months-old '
    'backlog instance does not fire an unprompted broadcast. Returns NULL for an unrecognised '
    'period type or when no published instance falls in that window. Deliberately does not call '
    'get_report_current_period, which resolves the period containing today and would miss an '
    'instance published after its own period ended.';

-- ============================================================================
-- 3. period_report_already_sent(p_report_instance_id uuid)
--
-- Idempotency guard for the automatic template send only. Keyed on report_instance_id (a
-- republished/superseded report is a new instance id, a fresh sendable key by design) AND on
-- message_kind = 'template' — see the file header for why the message_kind clause is required.
-- Returns false, never NULL, for a NULL argument.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.period_report_already_sent(p_report_instance_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
    SELECT EXISTS (
        SELECT 1 FROM public.report_deliveries d
        WHERE d.report_instance_id = p_report_instance_id
          AND d.status = 'sent'
          AND d.message_kind = 'template'
    );
$fn$;

COMMENT ON FUNCTION public.period_report_already_sent(uuid) IS
    'True only if this exact report_instance_id has already had a sent, template-kind delivery. '
    'The message_kind = ''template'' clause is required: send-report-whatsapp''s manual send path '
    'calls begin_report_delivery without p_report_kind/p_message_kind, which default to '
    'weekly/text, so a manual send must not be mistaken for the automatic broadcast having '
    'already run.';

-- ============================================================================
-- 4. Grants — service_role only, matching
--    migrations/20260907130000_report_opt_out.sql:251-254 exactly.
-- ============================================================================

REVOKE ALL ON FUNCTION public.report_recipients_for_kind(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_recipients_for_kind(text) TO service_role;

REVOKE ALL ON FUNCTION public.latest_published_instance(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.latest_published_instance(text) TO service_role;

REVOKE ALL ON FUNCTION public.period_report_already_sent(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.period_report_already_sent(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
