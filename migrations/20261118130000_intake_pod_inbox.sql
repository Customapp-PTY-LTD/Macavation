-- ============================================================================
-- Proof of delivery sent on WhatsApp -> waiting on Grower Intake (Henry, 18 Nov 2026)
--
-- A staff member with grower.intake.create sends a photo / PDF of a transporter's proof of delivery
-- to the Macavation WhatsApp number. whatsapp-inbound downloads it, the AI reads it (the same
-- read_pod reader the "Read the proof of delivery" button uses), the photo is stored, and one row
-- lands here. Grower Intake lists the waiting rows; "Book in" opens Book in a truck already filled
-- from `reading`, and saving the delivery closes the row as booked. Nothing here creates a batch.
--
-- Writes from WhatsApp: intake_pod_inbox_add, service_role only (whatsapp-inbound).
-- Portal: get_intake_pod_inbox (read) and close_intake_pod_inbox (booked / dismissed).
--
-- Down:
--   DROP FUNCTION public.close_intake_pod_inbox(uuid, text, uuid, uuid);
--   DROP FUNCTION public.get_intake_pod_inbox(integer);
--   DROP FUNCTION public.intake_pod_inbox_add(text, text, uuid, text, text, text, jsonb, uuid);
--   DROP TABLE public.intake_pod_inbox;
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.intake_pod_inbox (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    received_at  timestamptz NOT NULL DEFAULT now(),
    source       text NOT NULL DEFAULT 'whatsapp' CHECK (source IN ('whatsapp')),
    wamid        text UNIQUE,
    from_phone   text,
    sent_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
    file_id      text,
    file_link    text,
    file_name    text,
    reading      jsonb NOT NULL DEFAULT '{}'::jsonb,
    supplier_id  uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
    status       text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'booked', 'dismissed')),
    batch_id     uuid REFERENCES public.batches(id) ON DELETE SET NULL,
    closed_at    timestamptz,
    closed_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
    updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_intake_pod_inbox_waiting ON public.intake_pod_inbox (received_at DESC) WHERE status = 'waiting';
CREATE INDEX IF NOT EXISTS idx_intake_pod_inbox_sent_by ON public.intake_pod_inbox (sent_by);
CREATE INDEX IF NOT EXISTS idx_intake_pod_inbox_supplier_id ON public.intake_pod_inbox (supplier_id);
CREATE INDEX IF NOT EXISTS idx_intake_pod_inbox_batch_id ON public.intake_pod_inbox (batch_id);
CREATE INDEX IF NOT EXISTS idx_intake_pod_inbox_closed_by ON public.intake_pod_inbox (closed_by);

-- Only the functions below touch the table.
ALTER TABLE public.intake_pod_inbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.intake_pod_inbox FROM PUBLIC, anon, authenticated;

-- ── WhatsApp: add one ──────────────────────────────────────────────────────
-- Idempotent on wamid (Control Room can deliver the same message twice).
CREATE OR REPLACE FUNCTION public.intake_pod_inbox_add(
    p_wamid       text,
    p_from_phone  text,
    p_sent_by     uuid,
    p_file_id     text,
    p_file_link   text,
    p_file_name   text,
    p_reading     jsonb,
    p_supplier_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id uuid;
    v_supplier uuid;
BEGIN
    -- A stale or wrong supplier id is dropped rather than failing the whole row.
    SELECT c.id INTO v_supplier FROM public.contacts c WHERE c.id = p_supplier_id;

    INSERT INTO public.intake_pod_inbox (wamid, from_phone, sent_by, file_id, file_link, file_name, reading, supplier_id)
    VALUES (NULLIF(btrim(p_wamid), ''), p_from_phone, p_sent_by, p_file_id, p_file_link, p_file_name,
            COALESCE(p_reading, '{}'::jsonb), v_supplier)
    ON CONFLICT (wamid) DO NOTHING
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
        SELECT i.id INTO v_id FROM public.intake_pod_inbox i WHERE i.wamid = NULLIF(btrim(p_wamid), '');
        RETURN jsonb_build_object('success', true, 'id', v_id, 'deduped', true);
    END IF;
    RETURN jsonb_build_object('success', true, 'id', v_id, 'deduped', false);
END;
$$;

-- ── Portal: the waiting list ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_intake_pod_inbox(p_limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT jsonb_build_object('success', true, 'items', COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.received_at DESC), '[]'::jsonb))
    FROM (
        SELECT i.id, i.received_at, i.from_phone, i.file_id, i.file_link, i.file_name, i.reading, i.supplier_id,
               COALESCE(NULLIF(btrim(concat_ws(' ', u.first_name, u.last_name)), ''), u.email) AS sent_by_name,
               COALESCE(c.company_name, c.trading_name) AS supplier_name,
               c.supplier_number
        FROM public.intake_pod_inbox i
        LEFT JOIN public.users u ON u.id = i.sent_by
        LEFT JOIN public.contacts c ON c.id = i.supplier_id
        WHERE i.status = 'waiting'
        ORDER BY i.received_at DESC
        LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)
    ) x;
$$;

-- ── Portal: booked (after Save delivery) or dismissed ──────────────────────
CREATE OR REPLACE FUNCTION public.close_intake_pod_inbox(
    p_id            uuid,
    p_status        text,
    p_batch_id      uuid DEFAULT NULL,
    p_actor_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rows integer;
BEGIN
    IF p_status NOT IN ('booked', 'dismissed') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Status must be booked or dismissed.');
    END IF;
    UPDATE public.intake_pod_inbox
       SET status = p_status,
           batch_id = CASE WHEN p_status = 'booked' THEN (SELECT b.id FROM public.batches b WHERE b.id = p_batch_id) END,
           closed_at = now(),
           closed_by = (SELECT u.id FROM public.users u WHERE u.id = p_actor_user_id),
           updated_at = now()
     WHERE id = p_id AND status = 'waiting';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'This POD was already booked in or dismissed.');
    END IF;
    RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.intake_pod_inbox_add(text, text, uuid, text, text, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.intake_pod_inbox_add(text, text, uuid, text, text, text, jsonb, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_intake_pod_inbox(integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.close_intake_pod_inbox(uuid, text, uuid, uuid) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
