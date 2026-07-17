-- Retire claude-sonnet-4-20250514 (removed from Anthropic API).
-- Align with Libra portal-assistant default: claude-sonnet-4-6.

ALTER TABLE public.assistant_client
  ALTER COLUMN assistant_model SET DEFAULT 'claude-sonnet-4-6';

UPDATE public.assistant_client
SET assistant_model = 'claude-sonnet-4-6'
WHERE assistant_model IS NULL
   OR assistant_model = 'claude-sonnet-4-20250514';
