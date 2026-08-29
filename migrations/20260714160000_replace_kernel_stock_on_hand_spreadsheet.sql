-- Replace kernel stock-on-hand with consolidated spreadsheet snapshot (2026-07-14).
-- Source: stock-on-hand sheet (styles SP / 1S / 4L / 5 / 6).
-- One kernel row per batch with all styles combined.
-- Packing cartons/kg are set to (desired remaining + already dispatched) so
-- get_kernel_batches remaining_by_style_cartons matches the sheet exactly.
-- Job-card style quantities are cleared so packing_data is authoritative.
-- Any prior complete stock batch not in this list is deactivated.

DO $$
DECLARE
    v_kg_per_carton numeric := 11.34;
    v_bid uuid;
    v_kid uuid;
    v_disp jsonb;
    v_pack jsonb;
    v_jc jsonb;
    v_sp numeric; v_1s numeric; v_4l numeric; v_5 numeric; v_6 numeric;
    v_dsp numeric; v_d1s numeric; v_d4l numeric; v_d5 numeric; v_d6 numeric;
    rec record;
    v_norm text;
    v_kept text[] := ARRAY[]::text[];
BEGIN
    -- Canonical batch list (consolidated). Carton columns are DESIRED REMAINING.
    -- Zenith Style 5 blank BN on sheet → 49.26.11 (matches existing Bn 49 26 11 / BB 2027-10-28).
    -- Eucalypt Style 1S cartons read as 3 from sheet.
    FOR rec IN (
        SELECT * FROM (VALUES
            -- multi-style + SP-led
            ('55.26.13.3',  'Big 5 Mac',                          '2027-11-13'::date, 0.12::numeric, 10::numeric, 0::numeric,  0::numeric,  3::numeric, 0::numeric),
            ('32.26.14',    'AP Vos & Seuns',                     '2027-11-18'::date, 0.24,         103,         3,          17,         0,          0),
            ('26.26.15',    'Mattison',                           '2027-11-25'::date, 0.15,         3,           75,         51,         0,          0),
            ('49.26.16',    'Zenith Estate',                      '2027-12-10'::date, 0.06,         181,         8,          213,        34,         0),
            ('36.26.17',    'Tad Poles',                          '2027-12-18'::date, 0.21,         62,          8,          54,         15,         0),
            ('07.26.18',    'Eucalypt Forestry',                  '2027-12-19'::date, 0.30,         41,          3,          66,         15,         0),
            ('56.26.19',    'Mac-Eden Estate',                    '2027-11-22'::date, 0.15,         6,           21,         28,         0,          0),
            ('63.26.20',    'Gala Macs',                          '2027-12-02'::date, 0.19,         3,           18,         31,         342,        0),
            ('02.26.22',    'Tamboti',                            '2027-12-23'::date, 0.22,         61,          6,          98,         24,         0),
            ('16.26.23',    'AH Bennett',                         '2027-12-29'::date, 0.15,         13,          0,          18,         2,          0),
            -- Style 5 (+ shared Style 6 where applicable)
            ('55.1.25.50.1','Big 5',                              '2027-07-08'::date, 0.33,         0,           0,          0,          29,         0),
            ('55.1.25.51.1','Big 5',                              '2027-07-08'::date, 0.26,         0,           0,          0,          5,          0),
            ('60.1.25.56',  'Breechoost CC',                      '2027-09-02'::date, 0.64,         0,           0,          0,          31,         2),
            ('56.26.06',    'Mac-Eden Estate',                    '2027-10-13'::date, 0.12,         0,           0,          0,          35,         0),
            ('07.26.05',    'Eucalypt Forestry',                  '2027-10-14'::date, 0.07,         0,           0,          0,          14,         2),
            ('55.26.09.01', 'Big 5 Mac',                          '2027-10-22'::date, 0.14,         0,           0,          0,          20,         0),
            ('32.26.10',    'AP Vos & Seuns',                     '2027-10-27'::date, 0.25,         0,           0,          0,          24,         1),
            ('49.26.11',    'Zenith Estate',                      '2027-10-28'::date, 0.10,         0,           0,          0,          49,         0),
            ('62.26.12',    'Hohls Farming',                      '2027-11-07'::date, 0.37,         0,           0,          0,          8,          0),
            ('55.26.13.1',  'Big 5 Mac',                          '2027-11-08'::date, 0.12,         0,           0,          0,          8,          0),
            ('55.26.13.2',  'Big 5 Mac',                          '2027-11-12'::date, 0.14,         0,           0,          0,          2,          0),
            ('55.26.13.4',  'Big 5 Mac',                          '2027-11-14'::date, 0.14,         0,           0,          0,          3,          0),
            -- Style 6 only
            ('55.1.25.50.2','Big 5',                              '2027-07-13'::date, 0.19,         0,           0,          0,          0,          3),
            ('55.1.25.51.2','Big 5',                              '2027-07-23'::date, 0.32,         0,           0,          0,          0,          11),
            ('55.1.25.51.3','Big 5',                              '2027-07-28'::date, 0.38,         0,           0,          0,          0,          21),
            ('32.4.25.55',  'AP Vos & Seuns',                     '2027-08-02'::date, 0.62,         0,           0,          0,          0,          2),
            ('55.26.01',    'Big 5 Mac',                          '2027-09-13'::date, 0.20,         0,           0,          0,          0,          1),
            ('32.26.02',    'AP Vos & Seuns',                     '2027-09-17'::date, 0.19,         0,           0,          0,          0,          2),
            ('29.26.04',    'Talana Macs',                        '2027-10-13'::date, 0.16,         0,           0,          0,          0,          1),
            ('11.26.07',    'Pylon Park Sugar Estate (Pty) Ltd',  '2027-10-20'::date, 0.27,         0,           0,          0,          0,          1),
            ('36.26.08',    'Tad Poles',                          '2027-10-21'::date, 0.25,         0,           0,          0,          0,          1)
        ) AS t(canon, supplier, bb_date, ffa_pct, ct_sp, ct_1s, ct_4l, ct_5, ct_6)
    ) LOOP
        v_norm := lower(trim(both '.' from regexp_replace(
            regexp_replace(rec.canon, '^bn[\s.]*', '', 'i'),
            '[\s_-]+', '.', 'g'
        )));

        -- Prefer an existing active kernel whose normalized batch_id matches canon / known aliases.
        v_kid := NULL;
        v_bid := NULL;
        SELECT k.id, b.id
          INTO v_kid, v_bid
        FROM public.kernel k
        JOIN public.batches b ON b.id = k.batch_id
        WHERE b.batch_type = 'kernel'
          AND k.is_active = true
          AND (
            lower(trim(both '.' from regexp_replace(regexp_replace(b.batch_id, '^bn[\s.]*', '', 'i'), '[\s_-]+', '.', 'g'))) = v_norm
            OR (v_norm = '55.26.09.01' AND lower(trim(both '.' from regexp_replace(regexp_replace(b.batch_id, '^bn[\s.]*', '', 'i'), '[\s_-]+', '.', 'g'))) IN ('55.26.09.01', '55.26.09.1'))
            OR (v_norm = '55.1.25.51.2' AND lower(trim(both '.' from regexp_replace(regexp_replace(b.batch_id, '^bn[\s.]*', '', 'i'), '[\s_-]+', '.', 'g'))) IN ('55.1.25.51.2', '55.1.2.25.51.2'))
            OR (v_norm IN ('07.26.05', '07.26.18') AND lower(trim(both '.' from regexp_replace(regexp_replace(b.batch_id, '^bn[\s.]*', '', 'i'), '[\s_-]+', '.', 'g'))) IN (v_norm, ltrim(v_norm, '0')))
            OR (v_norm IN ('02.26.22') AND lower(trim(both '.' from regexp_replace(regexp_replace(b.batch_id, '^bn[\s.]*', '', 'i'), '[\s_-]+', '.', 'g'))) IN ('02.26.22', '2.26.22'))
          )
        ORDER BY
            CASE WHEN b.batch_id ~ '^[0-9]' THEN 0 ELSE 1 END, -- prefer dotted numeric form when tied
            CASE WHEN b.batch_id = rec.canon THEN 0 ELSE 1 END,
            k.updated_at DESC NULLS LAST
        LIMIT 1;

        -- Fall back to inactive / any batch row with matching number.
        IF v_kid IS NULL THEN
            SELECT b.id INTO v_bid
            FROM public.batches b
            WHERE b.batch_type = 'kernel'
              AND (
                lower(trim(both '.' from regexp_replace(regexp_replace(b.batch_id, '^bn[\s.]*', '', 'i'), '[\s_-]+', '.', 'g'))) = v_norm
                OR (v_norm = '55.26.09.01' AND lower(trim(both '.' from regexp_replace(regexp_replace(b.batch_id, '^bn[\s.]*', '', 'i'), '[\s_-]+', '.', 'g'))) IN ('55.26.09.01', '55.26.09.1'))
                OR (v_norm = '55.1.25.51.2' AND lower(trim(both '.' from regexp_replace(regexp_replace(b.batch_id, '^bn[\s.]*', '', 'i'), '[\s_-]+', '.', 'g'))) IN ('55.1.25.51.2', '55.1.2.25.51.2'))
              )
            ORDER BY b.is_active DESC, b.updated_at DESC NULLS LAST
            LIMIT 1;

            IF v_bid IS NOT NULL THEN
                SELECT k.id INTO v_kid FROM public.kernel k WHERE k.batch_id = v_bid ORDER BY k.is_active DESC, k.updated_at DESC NULLS LAST LIMIT 1;
            END IF;
        END IF;

        IF v_bid IS NULL THEN
            INSERT INTO public.batches (batch_id, batch_type, is_active)
            VALUES (rec.canon, 'kernel', true)
            ON CONFLICT (batch_id) DO UPDATE SET is_active = true, batch_type = 'kernel'
            RETURNING id INTO v_bid;
            IF v_bid IS NULL THEN
                SELECT id INTO v_bid FROM public.batches WHERE batch_id = rec.canon LIMIT 1;
            END IF;
        ELSE
            UPDATE public.batches SET is_active = true, updated_at = now() WHERE id = v_bid;
        END IF;

        -- Dispatched cartons by style for this kernel (0 if new).
        v_dsp := 0; v_d1s := 0; v_d4l := 0; v_d5 := 0; v_d6 := 0;
        IF v_kid IS NOT NULL THEN
            SELECT
                COALESCE(SUM(CASE WHEN le->>'style' = 'SP' THEN COALESCE(NULLIF(le->>'cartons','')::numeric, NULLIF(le->>'quantity_kg','')::numeric / v_kg_per_carton) ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN le->>'style' = '1S' THEN COALESCE(NULLIF(le->>'cartons','')::numeric, NULLIF(le->>'quantity_kg','')::numeric / v_kg_per_carton) ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN le->>'style' = '4L' THEN COALESCE(NULLIF(le->>'cartons','')::numeric, NULLIF(le->>'quantity_kg','')::numeric / v_kg_per_carton) ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN le->>'style' = '5' THEN COALESCE(NULLIF(le->>'cartons','')::numeric, NULLIF(le->>'quantity_kg','')::numeric / v_kg_per_carton) ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN le->>'style' = '6' THEN COALESCE(NULLIF(le->>'cartons','')::numeric, NULLIF(le->>'quantity_kg','')::numeric / v_kg_per_carton) ELSE 0 END), 0)
            INTO v_dsp, v_d1s, v_d4l, v_d5, v_d6
            FROM public.kernel_dispatch_orders o
            CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.lines, '[]'::jsonb)) le
            WHERE NULLIF(le->>'kernel_id', '')::uuid = v_kid;
        END IF;

        v_sp  := COALESCE(rec.ct_sp, 0)  + COALESCE(v_dsp, 0);
        v_1s  := COALESCE(rec.ct_1s, 0)  + COALESCE(v_d1s, 0);
        v_4l  := COALESCE(rec.ct_4l, 0)  + COALESCE(v_d4l, 0);
        v_5   := COALESCE(rec.ct_5, 0)   + COALESCE(v_d5, 0);
        v_6   := COALESCE(rec.ct_6, 0)   + COALESCE(v_d6, 0);

        v_pack := jsonb_build_array(jsonb_build_object(
            'date', '2026-07-14',
            'sk_sp_qty',  round(v_sp  * v_kg_per_carton, 2), 'sk_0_qty', 0, 'sk_1_qty', 0,
            'sk_1s_qty',  round(v_1s  * v_kg_per_carton, 2),
            'sk_4l_qty',  round(v_4l  * v_kg_per_carton, 2),
            'sk_5_qty',   round(v_5   * v_kg_per_carton, 2),
            'sk_6_qty',   round(v_6   * v_kg_per_carton, 2),
            'bt_78_qty', 0, 'bt_high_qty', 0, 'bt_low_qty', 0,
            'sk_sp_cartons', v_sp,  'sk_0_cartons', 0, 'sk_1_cartons', 0,
            'sk_1s_cartons', v_1s,
            'sk_4l_cartons', v_4l,
            'sk_5_cartons',  v_5,
            'sk_6_cartons',  v_6,
            'bt_78_cartons', 0, 'bt_high_cartons', 0, 'bt_low_cartons', 0
        ));

        -- Keep best-before / packing date only — no style qty arrays (packing_data drives SOH).
        v_jc := jsonb_build_object(
            'best_before_date', rec.bb_date,
            'packing_completion_date', '2026-07-14',
            'soh_snapshot_source', 'spreadsheet_2026-07-14'
        );

        IF v_kid IS NOT NULL THEN
            UPDATE public.kernel SET
                grower_name = rec.supplier,
                packing_data = v_pack,
                job_card_data = v_jc,
                qa_data = jsonb_build_object('ffa_result', rec.ffa_pct, 'ffa', rec.ffa_pct),
                status = 'complete',
                jobcard_approved = true,
                is_active = true,
                production_finished_at = COALESCE(production_finished_at, now()),
                updated_at = now()
            WHERE id = v_kid;
        ELSE
            INSERT INTO public.kernel (
                batch_id, grower_name, status, packing_data, job_card_data, qa_data,
                received_date, production_finished_at, jobcard_approved, is_active
            ) VALUES (
                v_bid, rec.supplier, 'complete', v_pack, v_jc,
                jsonb_build_object('ffa_result', rec.ffa_pct, 'ffa', rec.ffa_pct),
                '2026-07-01'::date, now(), true, true
            )
            RETURNING id INTO v_kid;
        END IF;

        v_kept := array_append(v_kept, v_kid::text);
    END LOOP;

    -- Deactivate every other active complete/stock kernel (remove current SOH not on sheet).
    UPDATE public.kernel k
    SET is_active = false, updated_at = now()
    FROM public.batches b
    WHERE k.batch_id = b.id
      AND b.batch_type = 'kernel'
      AND k.is_active = true
      AND k.status IN ('complete', 'dispatch', 'qa')
      AND NOT (k.id::text = ANY (v_kept));

    -- Deactivate typo duplicate Big 5 Style 6 batch if still active alongside canonical.
    UPDATE public.kernel k
    SET is_active = false, updated_at = now()
    FROM public.batches b
    WHERE k.batch_id = b.id
      AND k.is_active = true
      AND b.batch_id IN ('55.1.2.25.51.2')
      AND EXISTS (
          SELECT 1 FROM public.kernel k2
          JOIN public.batches b2 ON b2.id = k2.batch_id
          WHERE k2.is_active = true
            AND b2.batch_id IN ('55.1.25.51.2', 'Bn 55 1 25 51 2')
      );
END;
$$;
