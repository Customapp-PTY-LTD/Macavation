-- Stock adjustments were ignored on batches with an approved job card.
--
-- get_kernel_batches takes an approved job card's figures as the batch's stock, and "Adjust
-- Stock" (adjust_kernel_stock_on_hand) records each change as a stock_adjustment row appended
-- to kernel.packing_data. The job-card branch never reads packing_data, so on those batches
-- every adjustment saved but never moved the remaining figure the Stock grid, Send to Dispatch
-- and the stock alerts all read. Seen live 19 Oct 2026 on Bn 44 26 42 (4L stuck at 171 after
-- -49, +44, +42) and also affecting Bn 49 26 30 (-31 of 4L ignored since 4 Aug).
--
-- Fix: remaining_by_style / remaining_by_style_cartons for job-card batches become job card +
-- stock adjustments - dispatched. yield_by_style(_cartons) stay as the job card says, so
-- recovery % and weekly stock-in (production figures) are unchanged.
--
-- get_kernel_batches is patched in place from its live definition rather than restated: dev and
-- prod carry textually different (equivalent) bodies, and the patch asserts its exact swap count
-- so it fails loudly instead of half-applying if the body ever changes shape.

CREATE OR REPLACE FUNCTION public.kernel_job_card_yield_with_adjustments(
    p_job_card jsonb,
    p_packing jsonb,
    p_unit text DEFAULT 'kg'
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
    WITH base AS (
        SELECT COALESCE(
                   CASE WHEN p_unit = 'cartons'
                        THEN public.kernel_yield_cartons_from_job_card(p_job_card)
                        ELSE public.kernel_yield_kg_from_job_card(p_job_card)
                   END,
                   '{}'::jsonb) AS j
    ),
    style_map(style, prefix) AS (
        VALUES ('SP', 'sk_sp'), ('0', 'sk_0'), ('1', 'sk_1'), ('1S', 'sk_1s'), ('4L', 'sk_4l'),
               ('5', 'sk_5'), ('6', 'sk_6'), ('7/8', 'bt_78'),
               ('Butter High Oil', 'bt_high'), ('Butter Low Oil', 'bt_low')
    ),
    adj AS (
        SELECT m.style,
               COALESCE(SUM(NULLIF(e ->> (m.prefix || CASE WHEN p_unit = 'cartons' THEN '_cartons' ELSE '_qty' END), '')::numeric), 0) AS delta
        FROM style_map m
        LEFT JOIN LATERAL jsonb_array_elements(
            CASE WHEN jsonb_typeof(p_packing) = 'array' THEN p_packing ELSE '[]'::jsonb END
        ) e ON (e ->> 'stock_adjustment') = 'true'
        GROUP BY m.style
    )
    SELECT base.j || COALESCE(
               (SELECT jsonb_object_agg(a.style, COALESCE(NULLIF(base.j ->> a.style, '')::numeric, 0) + a.delta)
                FROM adj a WHERE a.delta <> 0),
               '{}'::jsonb)
    FROM base;
$function$;

DO $patch$
DECLARE
    v_def text := pg_get_functiondef('public.get_kernel_batches(character varying,character varying,integer,integer)'::regprocedure);
    v_kg_old text := '(public.kernel_yield_kg_from_job_card(k.job_card_data) ->>';
    v_kg_new text := '(public.kernel_job_card_yield_with_adjustments(k.job_card_data, k.packing_data, ''kg'') ->>';
    v_ct_old text := '(public.kernel_yield_cartons_from_job_card(k.job_card_data) ->>';
    v_ct_new text := '(public.kernel_job_card_yield_with_adjustments(k.job_card_data, k.packing_data, ''cartons'') ->>';
    v_kg_hits int;
    v_ct_hits int;
BEGIN
    IF position('kernel_job_card_yield_with_adjustments' IN v_def) > 0 THEN
        RAISE NOTICE 'get_kernel_batches already counts stock adjustments; nothing to do';
        RETURN;
    END IF;

    v_kg_hits := (length(v_def) - length(replace(v_def, v_kg_old, ''))) / length(v_kg_old);
    v_ct_hits := (length(v_def) - length(replace(v_def, v_ct_old, ''))) / length(v_ct_old);
    IF v_kg_hits <> 10 OR v_ct_hits <> 10 THEN
        RAISE EXCEPTION 'get_kernel_batches has an unexpected shape (kg swaps %, carton swaps %, expected 10 each); patch by hand', v_kg_hits, v_ct_hits;
    END IF;

    EXECUTE replace(replace(v_def, v_kg_old, v_kg_new), v_ct_old, v_ct_new);
END
$patch$;
