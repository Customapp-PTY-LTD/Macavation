# Phase 2 UAT verification checklist

Run after applying [`migrations/20260706100000_phase2_implementation_complete.sql`](../migrations/20260706100000_phase2_implementation_complete.sql) and prior Phase 2 migrations.

## Pre-flight

```bash
npm run db:check-project
# Must report: dev → UAT / nmdmddugxclpqrwylyfa

npm run db:apply -- migrations/20260706100000_phase2_implementation_complete.sql
```

Or run the verification script:

```bash
node scripts/verify-phase2-migrations.mjs
```

## Required migrations (Phase 2 cluster)

| Migration | Feature |
|-----------|---------|
| `20260601090000_kernel_intake_procurement.sql` | Procurement calendar |
| `20260602110000_dashboard_targets.sql` | Dashboard targets |
| `20260602120000_dashboard_forecast_aggregates.sql` | Forecast charts |
| `20260602130000_stock_alerts_and_accuracy.sql` | Stock alert rules |
| `20260602140000_oil_consolidated_shell_massbalance.sql` | Oil consolidated, shell lots, mass balance |
| `20260602150000_notifications.sql` | In-app messaging |
| `20260602160000_scheduled_reports.sql` | Daily digest schema |
| `20260629120000_phase2_portal_features.sql` | Runway, oil trends, default alert rules |
| `20260706100000_phase2_implementation_complete.sql` | Phase 2 completion RPCs |

## Smoke test (UAT portal)

| Module | Route | Pass |
|--------|-------|------|
| Executive dashboard | Home → Dashboard | KPI cards, charts, alerts, runway load |
| Stock alert rules | Admin → Stock Alert Rules | List + save rule |
| Scheduled reports | Admin → Scheduled Reports | Add email subscriber, preview digest |
| Messaging compose | Admin → Send Message | Compose + send |
| Role actions | Admin → Role Actions | List actions |
| Grower intake | Grower Intake | Procurement calendar + mass balance card |
| Oil production | Oil Production | Search, consolidated batches |
| Kernel stock | Stock → Kernel | Stock grid + shell lots |

## Edge functions (deploy to UAT)

```bash
supabase functions deploy send-daily-digest --project-ref nmdmddugxclpqrwylyfa
supabase functions deploy send-daily-digest-whatsapp --project-ref nmdmddugxclpqrwylyfa
supabase functions deploy evaluate-stock-alerts-cron --project-ref nmdmddugxclpqrwylyfa
```

**Secrets:** `RESEND_API_KEY`, `DIGEST_FROM_EMAIL`, `CONTROL_ROOM_FORWARD_SECRET`, `CONTROL_ROOM_CHANNEL_SLUG`

**Cron (Supabase Dashboard → Edge Functions):**

| Function | Schedule | Timezone |
|----------|----------|----------|
| `send-daily-digest` | `0 6 * * *` | Africa/Johannesburg |
| `send-daily-digest-whatsapp` | `5 6 * * *` | Africa/Johannesburg |
| `evaluate-stock-alerts-cron` | `0 7,12,17 * * *` | Africa/Johannesburg |

## Sign-off

- [ ] All migrations applied without error
- [ ] Smoke tests pass for all modules above
- [ ] Test email digest received
- [ ] Test WhatsApp digest received (after Business API approval)
- [ ] Gaps logged in ClickUp Phase 2 list
