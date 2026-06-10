# Macavation UAT database (dev branch)

Development on the **`dev`** git branch uses the UAT Supabase project:

- **URL:** https://nmdmddugxclpqrwylyfa.supabase.co
- **Project ref:** `nmdmddugxclpqrwylyfa`

Production (`sofanhfpxifgdtooefzq`) is only used for `prod` and `demo` environment keys in the Web Portal.

## One-time setup

### 1. Anon / publishable API key

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → **Macavation UAT** → **Settings** → **API**.
2. Copy the **anon** (legacy JWT) or **publishable** key.
3. Set `uat.anonKey` in [`supabase/projects.json`](../../supabase/projects.json).
4. Sync portal config and verify:

```bash
npm run supabase:sync-portal
npm run db:check-project
```

### 2. Supabase CLI (migrations)

```bash
supabase login
supabase link --project-ref nmdmddugxclpqrwylyfa
npm run db:apply -- migrations/<your-migration>.sql
```

### 3. Cursor MCP

Ensure workspace MCP (or your user MCP URL) points at UAT:

`https://mcp.supabase.com/mcp?project_ref=nmdmddugxclpqrwylyfa`

Before MCP SQL/migrations, `get_project_url` must return `https://nmdmddugxclpqrwylyfa.supabase.co`.

## Lambda proxy

Localhost (`127.0.0.1`) uses the **`dev`** portal environment: direct PostgREST calls target **UAT**, but **login and most module data** go through the **Lambda proxy**. Until a UAT Lambda exists, localhost still shows **production** data.

Verify routing:

```bash
npm run verify:portal-routing
```

### Why localhost matches production today

The production Lambda (`WebPortal/index_supabase.js`) has `SUPABASE_URL` set to production. All environments share that URL in portal config until `uat.lambdaProxyUrl` is set.

### UAT Lambda setup (required for true UAT local dev)

Full checklist: [UAT_LAMBDA.md](UAT_LAMBDA.md).

1. Deploy a **second** Lambda (copy `WebPortal/index_supabase.js` + dependencies) or use a separate alias with UAT env vars:
   - `SUPABASE_URL` = `https://nmdmddugxclpqrwylyfa.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY` = UAT service role key (Dashboard → Settings → API)
   - `ENABLE_DATABASE_AUTH` = `true`
   - Copy other required env vars from production (JWT secret, CORS, etc.)
2. Copy the function URL (must end with `/proxy/function` for portal config).
3. Set `uat.lambdaProxyUrl` in [`supabase/projects.json`](../../supabase/projects.json).
4. Sync portal config:

```bash
npm run supabase:sync-portal
npm run db:check-project
npm run verify:portal-routing
```

After step 4, `dev`/`uat` environments use the UAT Lambda; `prod`/`demo` keep the production Lambda.

## Copy production data into UAT

After UAT schema is up to date (`npm run db:apply-pending-uat`), copy live data from **main/production**:

```bash
npm run db:copy-prod-to-uat
```

This uses PostgREST + service_role (via Supabase CLI) — no Docker required. To clear UAT first, truncate public tables in the SQL editor or run `.tmp/truncate_uat_public.sql` via `supabase db query --linked --file …`, then re-run the copy.

Resume after a partial failure:

```bash
npm run db:copy-prod-to-uat -- --from=table_name
```

Results are logged to `scripts/prod_to_uat_copy_results.json`.

**Not copied:** Supabase Auth users (`auth` schema), Storage objects, or tables not exposed in the PostgREST API. Apply pending migrations if inserts fail on column/schema mismatch.

## UAT schema health

Check migration drift and common advisor issues:

```bash
supabase link --project-ref nmdmddugxclpqrwylyfa
npm run db:check-uat-advisors
```

Apply pending migrations to UAT:

```bash
npm run db:apply-pending-uat
# batches: node scripts/apply-pending-uat-migrations.mjs --limit 20
# skip failures: node scripts/apply-pending-uat-migrations.mjs --continue-on-error
```

Results are logged to `scripts/uat_migration_apply_results.json`. Re-run after fixing failed migration SQL.
