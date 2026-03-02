-- Create features and role_features tables for DB-driven sidebar/module access control.
-- features: stores each app module/route as a named feature.
-- role_features: junction table mapping roles to their enabled features.

-- 1. Features table
CREATE TABLE IF NOT EXISTS public.features (
    id BIGSERIAL PRIMARY KEY,
    key VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_features_key ON public.features (key);
CREATE INDEX IF NOT EXISTS idx_features_active ON public.features (is_active);

-- 2. Role-features junction table
CREATE TABLE IF NOT EXISTS public.role_features (
    id BIGSERIAL PRIMARY KEY,
    role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
    feature_id BIGINT NOT NULL REFERENCES public.features(id) ON DELETE CASCADE,
    value TEXT NOT NULL DEFAULT 'true',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(role_id, feature_id)
);

CREATE INDEX IF NOT EXISTS idx_role_features_role ON public.role_features (role_id);
CREATE INDEX IF NOT EXISTS idx_role_features_feature ON public.role_features (feature_id);
CREATE INDEX IF NOT EXISTS idx_role_features_value ON public.role_features (value);
