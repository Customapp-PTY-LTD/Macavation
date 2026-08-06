-- Business request: kernel styles '0' and '1' should stop triggering low-stock red-flag alerts.
-- Deactivate (not delete) the rules so they remain visible/re-enable-able in the Stock Alert
-- Rules admin screen, and auto-resolve any currently-open alerts already raised under them so
-- nothing is left stuck as "active" once evaluate_stock_alerts stops touching this rule.

UPDATE public.stock_alert_rules
SET is_active = false
WHERE product_type = 'kernel' AND style IN ('0', '1');

UPDATE public.dashboard_alerts
SET status = 'resolved',
    resolved_at = now(),
    resolved_note = 'Auto-resolved: kernel style 0/1 stock alert rule deactivated'
WHERE status = 'active'
  AND (batch_number LIKE 'STKRULE-kernel-0-%' OR batch_number LIKE 'STKRULE-kernel-1-%');
