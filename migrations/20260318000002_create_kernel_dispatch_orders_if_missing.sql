-- kernel_dispatch_orders is required by get_kernel_batches (has_dispatch, remaining_by_style).
-- Create it if missing so Grower Intake and Kernel Production lists load.
-- Applied via Supabase MCP 2026-03-18 for Macavation project where table was missing.

CREATE TABLE IF NOT EXISTS public.kernel_dispatch_orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    buyer_name text,
    buyer_contact_id uuid,
    delivery_date date,
    best_before_date date,
    status text NOT NULL DEFAULT 'pending',
    lines jsonb NOT NULL DEFAULT '[]',
    record jsonb NOT NULL DEFAULT '{}',
    dispatched_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kernel_dispatch_orders_created ON public.kernel_dispatch_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kernel_dispatch_orders_status ON public.kernel_dispatch_orders(status);
