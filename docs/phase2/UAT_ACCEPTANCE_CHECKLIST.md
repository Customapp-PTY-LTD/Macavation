# Phase 2 UAT acceptance checklist

Use before Macavation Phase 2 sign-off. Reference: [PHASE2_IMPLEMENTATION_PLAN.md](PHASE2_IMPLEMENTATION_PLAN.md)

## Success criteria

| # | Criterion | Test | Pass |
|---|-----------|------|------|
| 1 | Leadership uses dashboard / daily report | Paul confirms daily use for 2 weeks | |
| 2 | Red flags prevent stock-outs | Alert fires below threshold; resolves when stock recovers | |
| 3 | Oil consolidated batches with lab results | ≥1 consolidation in production with lab ref/doc | |
| 4 | Two years of history in trends | Production trends chart shows 24-month range (after Pete import) | |

## Functional tests

### Dashboard
- [ ] Sound kernel recovery, oil yield, stock on hand widgets load
- [ ] Oil forecast chart displays open demand by week
- [ ] Consolidated batch summary shows open count and litres
- [ ] Active alerts show Resolve button (authorized roles)
- [ ] Produced vs target and runway widgets accurate

### Stock alerts
- [ ] Stock Alert Rules admin saves thresholds
- [ ] Alert appears when SOH below minimum (kernel stock grid)
- [ ] Alert auto-clears when SOH recovers (or manual resolve)
- [ ] Scheduled cron evaluation runs (edge function logs)

### Daily reporting
- [ ] Email digest received by test subscriber
- [ ] WhatsApp digest received by test number (Business API configured)
- [ ] Digest includes oil stats, runway, produced vs target variance

### Grower intake
- [ ] Mass balance shows NIS in, cracked, packed, procurement variance
- [ ] This-week procurement summary card loads
- [ ] Procurement calendar convert-to-batch still works

### Shell waste
- [ ] Saving production stages with shell total creates/updates shell lot
- [ ] Dispatch shell lot marks status dispatched

### Permissions
- [ ] Role without `stock.adjust_soh` cannot adjust stock (UI + API)
- [ ] Role Actions admin lists Phase 2 action keys
- [ ] `actionAccess.apply` runs after route load

### Messaging
- [ ] Compose with entity link shows badge in inbox
- [ ] Clicking notification navigates to linked route

### Oil module
- [ ] Batch search with date/status filters returns results
- [ ] Consolidated batch lab ref editable

### Historical data (when Pete file ready)
- [ ] Kernel CSV import via portal or CLI
- [ ] Oil historical import RPC succeeds on sample row
- [ ] Procurement CSV script generates valid SQL

## Sign-off

| Role | Name | Date |
|------|------|------|
| General manager | | |
| Stock admin | | |
| CustomApp lead | | |
