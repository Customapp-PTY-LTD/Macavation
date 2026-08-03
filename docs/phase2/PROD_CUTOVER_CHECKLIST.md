# Production cutover checklist (dev → prod)

Use after merging `dev` into `prod` in Git. **Git merge does not update the production database.**

**Production Supabase:** `sofanhfpxifgdtooefzq`  
**UAT (reference for permissions/config):** `nmdmddugxclpqrwylyfa`

---

## 1. Schema migrations (SQL)

Link CLI to **production**, apply pending migrations, then re-link to UAT for day-to-day dev:

```bash
supabase link --project-ref sofanhfpxifgdtooefzq
node scripts/apply-pending-prod-migrations.mjs --only-phase2
# or all pending: node scripts/apply-pending-prod-migrations.mjs
supabase link --project-ref nmdmddugxclpqrwylyfa
```

**Phase 2 files (minimum):**

| Migration | Purpose |
|-----------|---------|
| `20260629120000_phase2_portal_features.sql` | Oil trends, runway, default alert rules, Phase 2 admin features |
| `20260629140000_fix_kernel_runway_summary.sql` | Runway RPC fix |
| `20260706100000_phase2_implementation_complete.sql` | Alerts, KPIs, digest, mass balance, shell, permissions seeds |
| `20260706110000_phase2_grants_fix.sql` | Re-grants after signature changes |

Results log: `scripts/prod_migration_apply_results.json`

---

## 2. Permission data (three layers)

Migrations seed **catalogues** and **admin defaults**. Departmental access must be synced from UAT (or configured manually on prod).

| Layer | Tables | Script |
|-------|--------|--------|
| Screens / menu | `features`, `role_features` | `sync-permissions-uat-to-prod.mjs` |
| Buttons | `actions`, `role_actions` | same |
| API / RPC | `role_permissions` | same |

```bash
node scripts/sync-permissions-uat-to-prod.mjs --dry-run
node scripts/sync-permissions-uat-to-prod.mjs
```

**After sync:** all affected users **log out and back in** (cached `featureKeys` / `actionKeys`).

**Do not copy:** `users` table or auth accounts from UAT to prod.

Admin screens to spot-check on prod:

- **Role Features** — sidebar visibility per role  
- **Role Actions** — button keys (`kernel.job_card.approve`, `alerts.resolve`, etc.)  
- **Role Permissions** — RPC grants (403 if missing)

---

## 3. Operational config

Copy tuned values from UAT (or set manually on prod):

```bash
node scripts/sync-config-uat-to-prod.mjs --dry-run
node scripts/sync-config-uat-to-prod.mjs
```

| Table | Contents |
|-------|----------|
| `dashboard_targets` | KPI targets (Paul) |
| `stock_alert_rules` | Red-flag thresholds |
| `scheduled_reports` | Daily digest email/WhatsApp subscribers |

Results: `scripts/prod_config_sync_results.json`

---

## 4. Edge functions + secrets + cron

Deploy to **production** project:

```bash
supabase functions deploy send-daily-digest --project-ref sofanhfpxifgdtooefzq
supabase functions deploy send-daily-digest-whatsapp --project-ref sofanhfpxifgdtooefzq
supabase functions deploy evaluate-stock-alerts-cron --project-ref sofanhfpxifgdtooefzq

# WhatsApp inbound webhook — MUST use --no-verify-jwt. Control Room sends no Supabase
# JWT; the X-Control-Room-Signature HMAC is the authentication. With verify_jwt on,
# every forward is rejected at the gateway and no inbound message is ever received.
supabase functions deploy whatsapp-inbound --project-ref sofanhfpxifgdtooefzq --no-verify-jwt
```

**Secrets (Supabase Dashboard → Edge Functions → production):**

- `RESEND_API_KEY`
- `DIGEST_FROM_EMAIL`
- `CONTROL_ROOM_FORWARD_SECRET` (Control Room → Channels → your channel → Overview → Product destination → Generate). Signs **both** directions — outbound sends and the inbound webhook verify against this same secret.
- `CONTROL_ROOM_CHANNEL_SLUG` (your channel's code in Control Room)

**WhatsApp inbound registration (Control Room side — nothing arrives until this is done):**

Control Room → Channels → your channel → Overview → Product destination: set the product
Supabase project ref plus function name `whatsapp-inbound`, or the equivalent webhook URL
override — `https://<project-ref>.supabase.co/functions/v1/whatsapp-inbound`. Until this
is set, Control Room logs inbound events on its side and forwards nothing, so the CRM →
WhatsApp inbox stays empty no matter how many customers message the number.

Note: Meta does **not** replay history. Only messages received after registration appear;
conversations that happened before it will not be backfilled.

**Cron (Africa/Johannesburg):**

| Function | Schedule |
|----------|----------|
| `send-daily-digest` | `0 6 * * *` |
| `send-daily-digest-whatsapp` | `5 6 * * *` |
| `evaluate-stock-alerts-cron` | `0 7,12,17 * * *` |

---

## 5. Portal + Lambda

- Production portal host serves **`prod`** branch (already merged).
- Production Lambda must stay on `sofanhfpxifgdtooefzq` (`production.lambdaProxyUrl` in `supabase/projects.json`).
- Verify: `npm run verify:portal-routing`

---

## 6. Smoke test (one user per role)

- [ ] Login, sidebar shows expected modules  
- [ ] Executive dashboard loads KPIs  
- [ ] Stock alert rule saves  
- [ ] Job card approve + release (Production Manager)  
- [ ] Document Management → New folder  
- [ ] Test email digest (scheduled report subscriber)  
- [ ] No `403 RBAC_PERMISSION_DENIED` on Phase 2 screens  

---

## 7. Do not copy from UAT

- Test batches, Playwright seed users, scratch procurement rows  
- Full database dump (would overwrite live prod data)  
- Auth users (`auth.users`)

---

## Audit queries (run on each environment)

```sql
SELECT r.role_name, f.key
FROM role_features rf
JOIN roles r ON r.id = rf.role_id
JOIN features f ON f.id = rf.feature_id
WHERE rf.value = 'true'
ORDER BY 1, 2;

SELECT r.role_name, a.key
FROM role_actions ra
JOIN roles r ON r.id = ra.role_id
JOIN actions a ON a.id = ra.action_id
WHERE ra.value = 'true'
ORDER BY 1, 2;
```

See also: [UAT verification](UAT_VERIFICATION_CHECKLIST.md) · [UAT acceptance](UAT_ACCEPTANCE_CHECKLIST.md)
