-- Keep the day-by-day packing lines when a job card is approved.
--
-- Problem (Mike / Mark, 20 Nov 2026): the WhatsApp report showed ~5.96 t packed on Mon 16 Nov
-- when only ~1 t was packed that day. Approving a job card ran
--   packing_data := kernel_packing_keep_adjustments(sync_kernel_job_card_to_packing_data(jc), packing_data)
-- and sync_kernel_job_card_to_packing_data returns ONE line holding the whole job-card total,
-- dated packing_completion_date. keep_adjustments then threw away every daily line except
-- stock adjustments, so Bn 70 26 60 (packed 5-16 Nov) landed 5,068.98 kg on 16 Nov.
-- Every daily packed figure reads these lines (production_day_sk_packed_kg_live ->
-- data_production_daily -> get_daily_digest / 19:00 WhatsApp, and get_packing_log).
--
-- Fix: when the job card is a single line, keep the dated daily lines and turn the job-card
-- line into a BALANCE line = job card minus the sum of the daily lines, per numeric key
-- (per-style kg + cartons and the totals). The balance line keeps the completion date and
-- job_card_authoritative, and is marked job_card_balance.
--   * Per-style totals over the whole array still equal the job card exactly, so stock on hand,
--     transfer counts and positive release (which sum every line) are unchanged.
--   * Re-saving an approved job card is idempotent: old job_card_authoritative lines (balance
--     or legacy single line) are dropped and recomputed; daily lines are never touched.
--   * Batches already collapsed have no daily lines left, so they behave exactly as before.
--   * upsert_kernel_production already refuses packing edits once the job card is approved,
--     so the kept daily lines cannot be changed afterwards.
-- Callers (unchanged): approve_kernel_job_card, upsert_kernel_job_card, complete_kernel_batch(uuid).

CREATE OR REPLACE FUNCTION public.kernel_packing_keep_adjustments(p_new jsonb, p_old jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
    WITH new_arr AS (
        SELECT CASE WHEN jsonb_typeof(p_new) = 'array' THEN p_new ELSE '[]'::jsonb END AS a
    ),
    old_lines AS (
        SELECT e.value AS v, e.ordinality AS o
        FROM jsonb_array_elements(
                 CASE WHEN jsonb_typeof(p_old) = 'array' THEN p_old ELSE '[]'::jsonb END
             ) WITH ORDINALITY AS e(value, ordinality)
        WHERE jsonb_typeof(e.value) = 'object'
    ),
    adjustments AS (
        SELECT v, o FROM old_lines WHERE (v ->> 'stock_adjustment') = 'true'
    ),
    -- Daily lines are only kept when the job card is the usual single line (so the balance is
    -- subtracted once). Undated lines are dropped, as before: they count on no day anyway.
    daily AS (
        SELECT ol.v, ol.o
        FROM old_lines ol, new_arr
        WHERE jsonb_array_length(new_arr.a) = 1
          AND COALESCE(ol.v ->> 'stock_adjustment', '') <> 'true'
          AND COALESCE(ol.v ->> 'job_card_authoritative', '') <> 'true'
          AND public.kernel_day_date(ol.v) IS NOT NULL
    ),
    job_card AS (
        SELECT n.value AS j, n.ordinality AS o
        FROM new_arr, jsonb_array_elements(new_arr.a) WITH ORDINALITY AS n(value, ordinality)
    ),
    balanced AS (
        SELECT jc.o,
               CASE WHEN NOT EXISTS (SELECT 1 FROM daily) THEN jc.j
               ELSE jc.j
                    || COALESCE((
                           SELECT jsonb_object_agg(
                                      kv.key,
                                      (kv.value)::numeric - COALESCE((
                                          SELECT SUM(btrim(d.v ->> kv.key)::numeric)
                                          FROM daily d
                                          WHERE btrim(COALESCE(d.v ->> kv.key, '')) ~ '^[-+]?([0-9]+\.?[0-9]*|\.[0-9]+)$'
                                      ), 0))
                           FROM jsonb_each_text(jc.j) AS kv(key, value)
                           WHERE jsonb_typeof(jc.j -> kv.key) = 'number'
                       ), '{}'::jsonb)
                    || '{"job_card_balance": true}'::jsonb
               END AS b
        FROM job_card jc
    )
    SELECT COALESCE((SELECT jsonb_agg(v ORDER BY o) FROM daily), '[]'::jsonb)
        || COALESCE((SELECT jsonb_agg(b ORDER BY o) FROM balanced), '[]'::jsonb)
        || COALESCE((SELECT jsonb_agg(v ORDER BY o) FROM adjustments), '[]'::jsonb);
$function$;
