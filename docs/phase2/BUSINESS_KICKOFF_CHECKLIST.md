# Phase 2 business kickoff checklist

Complete in **Week 1** — parallel to dev UAT verification.

## Pete historical data

- [ ] Kickoff meeting scheduled (Pete, CustomApp)
- [ ] Template shared: [`PETE_HISTORICAL_DATA_TEMPLATE.md`](PETE_HISTORICAL_DATA_TEMPLATE.md)
- [ ] Confirmed: batch-level vs monthly aggregates for 24 months
- [ ] Oil SOH snapshot scope agreed (or N/A documented)
- [ ] Shell waste sales tracking confirmed with Pete
- [ ] Target delivery date: ___________

## Alert thresholds (Josslyn + Mark)

| Product | Style / grade | Min qty (kg) | Owner sign-off |
|---------|---------------|--------------|----------------|
| Kernel | SP | | |
| Kernel | 0 | | |
| Kernel | 1 | | |
| Oil finished | * | | |
| Oil RM | * | | |
| Shell | * | | |

Configure in portal: **Admin → Stock Alert Rules**

## Dashboard targets (Paul)

| Metric key | Target value | Period |
|------------|--------------|--------|
| total_production_kg | | monthly |
| quality_pass_rate | | monthly |
| sound_kernel_recovery | | monthly (optional) |

Configure in portal: **Admin → Dashboard Targets**

## Daily report recipients (Paul)

| Name | Email | WhatsApp number | Channel |
|------|-------|-----------------|---------|
| | | | email |
| | | | whatsapp |

Configure in portal: **Admin → Scheduled Reports**

## WhatsApp Business API (Macavation IT)

- [ ] Meta Business account verified
- [ ] WhatsApp Business API app created
- [ ] Phone number registered and approved
- [ ] Access token + Phone Number ID shared securely with CustomApp
- [ ] Test message sent to Paul

**Lead time:** 2–6 weeks — start immediately; Phase 2 cannot sign off without WhatsApp.

## Resend email (if not configured)

- [ ] Domain verified for `reports@macavation.co.za` (or agreed sender)
- [ ] `RESEND_API_KEY` configured in Supabase Edge Function secrets

## Role matrix for permissions (Paul + department heads)

Confirm which roles receive each action (configure in **Role Actions** after dev rollout):

| Action | Production Mgr | QA | Stock | Oil | Sales | Admin |
|--------|----------------|-----|-------|-----|-------|-------|
| stock.adjust_soh | | | | | | |
| kernel.job_card.approve | | | | | | |
| oil.consolidated.manage | | | | | | |
| grower.procurement.manage | | | | | | |
| alerts.resolve | | | | | | |
