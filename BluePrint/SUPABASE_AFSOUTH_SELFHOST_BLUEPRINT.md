# Supabase -> af-south-1 self-host migration blueprint

How to move a Customapp product's Supabase workload from managed supabase.com (no
af-south-1 region exists) to a self-hosted Supabase stack on EC2 in Cape Town, for
POPIA / client data-residency requirements.

**Source of truth (use this, do not copy-paste):** the shared toolkit repo
**`Customapp-PTY-LTD/supabase-afsouth-stack`** - Terraform module + docker overlay +
scripts, all parameterised by `product`, with a one-command scaffolder:
`./create-za-stack.sh --product <slug> --env <dev|prod>`. Fixes there reach every
stack. Worked example with evidence: `jacana-portal/docs/migration/supabase-selfhost/RUNBOOK.md`.
Live stacks built from this pattern: jacana (since 2026-07-03) and customapp-services.
ASCII hyphens only.

---

## 0. Decide whether to migrate at all

- Managed Supabase: ~USD 25-40/month, zero ops. Self-hosted: ~USD 90 (dev) - 150 (prod)
  /month PLUS you own patching, backups, upgrades, uptime.
- Migrate ONLY when a client/compliance requirement demands in-country data. Everything
  else stays managed.
- Check whether the managed project is SHARED by several products before promising
  anything (jacana's was - see gotcha G1).

## 1. Architecture doctrine

- **Prod: one EC2 stack per client/product** (m5.large). Blast-radius isolation,
  per-client billing, and re-homeable into the client's own AWS account (the Terraform
  takes `aws_profile`).
- **Non-prod: consolidate.** dev+demo share ONE stack per product (proven). When 2+
  products are self-hosted, host their non-prod stacks side by side on one bigger EC2
  (m5.2xlarge holds 4-6 compose stacks; one Caddy routes by hostname).
- **Never share one STACK (one Postgres/anon key) across products** - that recreates
  the shared-project entanglement this blueprint exists to escape.
- Naming: `<product>-supabase-<env>` for instance/SG/IAM/secret,
  `dev-<product>-supabase.customapp.co.za` / `<product>-supabase.customapp.co.za` DNS,
  buckets `<product>-supabase-{storage|backups}-<env>-<account>`.

## 2. Stack shape (what you get)

Official supabase/supabase docker compose, pinned SHA, Postgres matched to the managed
project's version. Caddy terminates TLS (ports 80/443 only; no SSH - SSM). Storage API
on an S3 backend via instance role. pg_cron + pg_net + supabase_vault + pgsql-http
extensions. Edge functions bind-mounted into `volumes/functions/` with the vendored
`main` router. Secrets rendered from AWS Secrets Manager at bootstrap. Nightly pg_dump
to S3 + EBS snapshots + CloudWatch alarms. Kong also on host loopback 127.0.0.1:8000
for Studio/psql via SSM tunnels.

## 3. Migration phases (checklist)

### Phase 0 - evidence (repo becomes source of truth)
- [ ] `supabase functions list` -> download every deployed function the product calls
      into `supabase/functions/`; diff repo-vs-deployed for drift; record verify_jwt flags
- [ ] Frontend function surface: `grep -rhoE "functions/v1/[a-z0-9-]+" js modules *.html scripts`
      (include oauth-callback pages - jacana's oauth-callback.html called two functions)
- [ ] `pg_dump --schema-only` -> commit (REDACT embedded JWTs first - see G2)
- [ ] Inventory via SQL: `cron.job` (there will be more jobs than you think), vault
      secret names + count, table sizes, tenant GUID(s), unique dedupe indexes
- [ ] `supabase secrets list` (names) + find per-tenant secrets hiding in TABLES (G4)
- [ ] Grep DB function bodies for the project URL: `SELECT proname FROM pg_proc WHERE
      prosrc LIKE '%<project-ref>%'` (G3)

### Phase 1 - infrastructure
- [ ] Copy `infra/supabase/` from jacana-portal; set `-var product=<slug>`
- [ ] `terraform init` with per-product state key; `apply -var env=dev`
- [ ] `gen-env.mjs dev` (PRODUCT=<slug>) - mints JWT secret/keys, writes Secrets Manager
- [ ] `package-and-upload.sh dev` then bootstrap via SSM
- [ ] Verify: `/rest/v1/` 200 with new anon key, functions 401 unauthenticated,
      `/storage/v1/status` 200, backup object lands in S3

### Phase 2 - data + bring-up
- [ ] Apply schema (render redacted JWT placeholders with the NEW stack's keys)
- [ ] `CREATE EXTENSION IF NOT EXISTS http` and run `repoint-db-functions.sh` (G3)
- [ ] Tenant-slice copy (`copy-full-slice.sh` pattern): classify ALL tables -
      scoped (tenant column - case-insensitive! G5) / FK-children / global reference /
      SKIP client-keyed tables with no tenant column. Load with
      `session_replication_role=replica` (G6), per-table DELETE for idempotency
- [ ] Copy the tenant's config row(s) holding per-tenant OAuth secrets (G4)
- [ ] Storage binaries via Storage-API re-upload (self-registers storage.objects; use
      the stack's public HTTPS URL - kong has no host port, G7)
- [ ] Cron from the 0331-style template (internal `http://kong:8000/...` URL; secrets
      via vault lookup, never inline JWTs)
- [ ] Disable mailbox polling on load; fill function secrets in Secrets Manager
- [ ] Repoint the product's `appRouteConfig.json` dev/demo blocks + hunt hardcoded
      project URLs in JS; run the product's test suites

### Phase 3 - cutover (per env)
- [ ] Freeze: unschedule the managed cron for this tenant
- [ ] Final slice re-run (idempotent) + storage delta + Vault/token refresh check
- [ ] Repoint remaining env blocks; push (Amplify deploys = the cutover)
- [ ] Switch polling ownership: disable tenant accounts on managed, enable on ZA,
      run one poll cycle, confirm success + dedupe
- [ ] Old project: idle 7 days (rollback insurance) -> archive dump -> pause -> delete
      at day 45-60; rotate its keys at decommission (G2)

### Phase 4 - hardening
- [ ] Restore drill (nightly dump + .env secret -> scratch instance -> smoke test)
- [ ] SNS alarm subscription CONFIRMED (it sits PendingConfirmation until clicked)
- [ ] CSP `connect-src` includes the new stack host (G8)
- [ ] Update client residency docs; add DEV_ACCESS.md for the team

### Phase 5 - keeping the stack up to date (the update model)

Four layers, automated at different levels (reference: jacana-portal
`docs/migration/supabase-selfhost/RUNBOOK.md` "Operations" section):

- **App layer (functions/overlay/scripts): auto-deploy on push.** `deploy-backend.sh`
  (package overlay -> re-run bootstrap via SSM -> health checks) wired to a GitHub
  Actions workflow with an OIDC role (`github-deploy.tf` - no stored AWS keys; role
  gets only S3 put on `bootstrap/*`, tag-scoped ssm:SendCommand, GetCommandInvocation).
- **SQL migrations: never auto-applied** - deliberate psql/DBHub; the workflow summary
  lists pushed migration files as a reminder.
- **Platform images: notification only.** Monthly workflow diffs the pinned SHA's
  compose image tags vs upstream and opens an issue; a human runs `stack-upgrade.sh`
  (pre-flight backup, image diff, refuses Postgres MAJOR bumps) - dev first, one week
  soak, then prod.
- **OS patches: fully automatic** via unattended-upgrades (security pocket, no
  auto-reboot) installed by bootstrap; weekly cron publishes to the SNS alarms topic
  when a reboot is pending (instance role needs sns:Publish on the topic).

Data refresh stays on-demand - once cut over, the ZA stack is authoritative; never
schedule the tenant-slice copy.

## 4. Gotchas (each cost real time - do not rediscover)

- **G1 shared project:** the managed project may serve multiple products (jacana's had
  43 functions across 2+ products). Scope = dedicated stack + tenant slice; other
  products stay untouched.
- **G2 embedded JWTs:** service_role/anon JWTs are hardcoded inside DB function bodies
  and cron commands. Redact before committing schema dumps; re-render per stack; rotate
  managed keys at decommission.
- **G3 DB functions call the project URL:** triggers (e.g. a smart_forms pipeline
  trigger) POST to `https://<ref>.supabase.co` from inside Postgres. Repoint to
  `http://kong:8000` after every schema load (`repoint-db-functions.sh`); one needs the
  pgsql-http extension.
- **G4 per-tenant secrets in tables:** OAuth client secrets can live in a Broker/config
  table (resolved by an RPC), not in env. The mail poller dies without that row. Copy it
  (binary COPY so values never print).
- **G5 inconsistent tenant columns:** `broker_guid`, `BrokerGUID`, `BrokerageGUID` -
  detect case-insensitively or you will misclassify tenant tables as global and leak
  other tenants' data. Some tenant tables have NO tenant column (client/policy-keyed) -
  SKIP those, do not full-copy.
- **G6 trigger-disable rollback:** a batched `ALTER TABLE ... DISABLE TRIGGER ALL` is
  one transaction - one failure re-enables everything silently. Use
  `SET session_replication_role=replica` per load session instead.
- **G7 self-hosted differences:** no `supabase secrets` / `functions deploy` / Supabase
  MCP (cloud Management API only). Functions = volume mount + compose restart; secrets =
  Secrets Manager + re-bootstrap; SQL = DBHub/psql over SSM tunnel; GUI = Studio via
  `studio.sh`. Single global VERIFY_JWT (no per-function flag) - all callers must send
  the anon key. Edge-runtime crash-loops without the vendored `main` router. Host :5432
  is supavisor (user `postgres.<tenant-id>`), kong is loopback :8000. DBHub MCP setup
  must include `-p pg` in the npx args (dbhub@latest does not bundle the Postgres
  driver; setup-mcp.mjs does this) - verify with `mcp-smoke.mjs`.
- **G8 CSP:** `connect-src *.supabase.co` no longer covers the backend - add the
  self-hosted host or the portal breaks when CSP enforces.
- **G9 safe overlap:** verify a unique message-id (or equivalent) index before cutover;
  it is what makes old/new running simultaneously harmless.
- **G10 Vault:** managed Vault secrets decrypt only in that project. Export via
  `vault.decrypted_secrets` -> `vault.create_secret()` piped host-to-host, or rehydrate
  from `*_temp` columns. Expect orphan bloat (jacana: 11,724 secrets for 16 accounts) -
  only migrate referenced ones. Self-hosted Vault keys off VAULT_ENC_KEY in the stack
  env, so dump + env secret = complete restore.

## 5. Team access (per product)

`setup-mcp.mjs` (PRODUCT=<slug>) writes a DBHub MCP entry for Cursor
(`.cursor/mcp.json`, gitignored) and Claude Code, credentials pulled from Secrets
Manager - IAM-gated, nothing shared out of band. Daily use: `db-tunnel.sh` +
DBHub-<Product>ZA; `studio.sh` for the GUI. Hand devs DEV_ACCESS.md (template in
jacana-portal `docs/migration/supabase-selfhost/`).
