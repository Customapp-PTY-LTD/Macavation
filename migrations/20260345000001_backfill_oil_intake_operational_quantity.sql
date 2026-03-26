-- Oil supplier batches released to production with a second weigh stored in
-- weight_before_production_kg: ensure quantity_kg is the operational (before production)
-- weight and weight_at_intake_for_comparison_kg preserves the receiving weight.
-- Only touches rows where comparison was never set and quantity_kg still differs from
-- weight_before_production_kg (legacy client did not update quantity_kg).

UPDATE public.oil o
SET intake_data = COALESCE(o.intake_data, '{}'::jsonb)
  || jsonb_build_object(
    'weight_at_intake_for_comparison_kg', sub.qty,
    'quantity_kg', sub.wbp
  )
FROM (
  SELECT
    o2.id,
    COALESCE(
      NULLIF(trim(COALESCE(o2.intake_data->>'quantity_kg', '')), '')::numeric,
      NULLIF(trim(COALESCE(o2.intake_data#>>'{items,0,quantity_kg}', '')), '')::numeric
    ) AS qty,
    NULLIF(trim(COALESCE(o2.intake_data->>'weight_before_production_kg', '')), '')::numeric AS wbp
  FROM public.oil o2
  WHERE o2.status = 'production'
    AND o2.intake_data ? 'weight_before_production_kg'
    AND NULLIF(trim(COALESCE(o2.intake_data->>'weight_before_production_kg', '')), '') IS NOT NULL
    AND (
      o2.intake_data->>'weight_at_intake_for_comparison_kg' IS NULL
      OR trim(COALESCE(o2.intake_data->>'weight_at_intake_for_comparison_kg', '')) = ''
    )
) sub
WHERE o.id = sub.id
  AND sub.wbp IS NOT NULL
  AND sub.qty IS NOT NULL
  AND abs(sub.qty - sub.wbp) > 0.0001;
