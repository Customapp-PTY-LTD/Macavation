-- kernel_day_kg: prefer endqty1 over totalqty.
--
-- Supersedes the body created in 20260813091000_kernel_cracking_kg_helpers.sql, which deliberately
-- preserved the historical coalesce(totalqty, total_qty, 0) while the choice of field was open.
-- That question is decided here. See docs/database/KG_CRACKED_UNDERCOUNT_INVESTIGATION.md for the
-- full record, including the objections raised against this change and how each was answered.
--
-- WHY endqty1: it is the kg of nut-in-shell put through the cracker on that day. Measured against
-- production data:
--
--   * Kernel actually packed averages 19.6% of batch NIS received (range 12.6-26.1%) -- that is the
--     real recovery yield.
--   * endqty1 summed per batch averages 114.7% of batch NIS received.
--
--   endqty1 therefore cannot be an output/kernel measure; at ~115% of intake it can only be an
--   input-side quantity. It follows that the stored cracking_percentage (totalqty / batch NIS,
--   typically 10-14% per day) is "percent of the batch processed that day", NOT a recovery yield --
--   a batch is processed over roughly 8-12 days, and those daily percentages sum toward 100%, not
--   toward 20%. Note that the front end labels totalqty "Total Kernel Output" and "Kernel Cracked
--   (kg)" (modal_production_stages.js:1220,1265). Those labels are misleading and are the reason
--   this took two attempts to settle; the arithmetic above is authoritative over the labels.
--
--   * totalqty is blank on the days that endqty1 covers, so preferring it recovers real production
--     that is currently reported as zero.
--
-- HONEST CAVEATS -- read before quoting any number from this change:
--
--   1. The applied effect is the RAW uplift, +80,955.3 kg (113,634.8 -> 194,590.1) across all
--      history. Roughly 34,000 kg of that comes from ONE bad row: batch Bn 32 26 10 on 2026-04-23
--      records endqty1 = 39,853 against a batch of 12,309.3 kg (3.2x the entire intake) and also
--      breaks the startqty1 - silo1 = endqty1 identity (54,853 - 1,500 = 53,353 <> 39,853).
--      An earlier draft of this change quoted +41,102.3 kg / 26.6% with implausible rows excluded.
--      That figure is NOT achievable here: this function receives one cracking-day element and can
--      see neither the batch NIS total nor sibling rows, so it has no basis on which to exclude
--      anything. Do not quote 26.6% as the effect of this migration.
--
--   2. endqty1 per-batch totals range from 13.9% to 366.5% of NIS received, averaging above 100%.
--      More nut cannot be fed than was received, so the source data is materially unreliable:
--      75 of 120 cracking day-rows carry no tonnage in any field, 5 batches over-record by
--      45,185.5 kg in total, and 15 of 41 complete batches have no cracking rows at all.
--      This migration makes the field choice correct. It does NOT make the data correct, and any
--      throughput/rate derived from cracking_data should be treated as indicative only until
--      capture improves. Escalated to the production team; tracked in the investigation doc.
--
-- No call site changes: get_dashboard_kernel_stats, get_production_trends_daily and
-- get_kernel_mass_balance were already routed through this helper by
-- 20260813092000_route_cracking_kg_through_helpers.sql, so this single function is the entire
-- behavioural change.
--
-- STABLE, not IMMUTABLE: text::date depends on the DateStyle GUC (kept consistent with
-- kernel_day_date in the same helper family).

CREATE OR REPLACE FUNCTION public.kernel_day_kg(p_elem jsonb)
RETURNS numeric
LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(
      NULLIF(TRIM(p_elem ->> 'endqty1'), '')::numeric,
      NULLIF(TRIM(p_elem ->> 'totalqty'), '')::numeric,
      NULLIF(TRIM(p_elem ->> 'total_qty'), '')::numeric,
      0)::numeric;
$$;

COMMENT ON FUNCTION public.kernel_day_kg(jsonb) IS
  'Kg of nut-in-shell put through the cracker for one cracking_data day-entry. Prefers endqty1 '
  '(the operator-captured start-minus-silo figure), falling back to totalqty then the legacy '
  'total_qty spelling. endqty1 takes precedence because totalqty is left blank on days with silo '
  'carry-over, which reports real production as zero. Evidence that endqty1 is an input-side '
  'measure rather than kernel output: packed kernel averages 19.6% of batch NIS received, while '
  'endqty1 sums to ~114.7% of it. Applied effect across history is +80,955.3 kg raw, of which '
  '~34,000 kg comes from one bad row (batch Bn 32 26 10, 2026-04-23) that needs re-keying by the '
  'production team. Source data is known-unreliable -- see '
  'docs/database/KG_CRACKED_UNDERCOUNT_INVESTIGATION.md before deriving any rate from it.';

DO $$
DECLARE
    v_role_id record;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id.id, 'function', 'kernel_day_kg', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
