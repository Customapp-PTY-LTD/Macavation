# Role credentials for Playwright (RBAC & kernel role tests)

Seed test accounts were removed from the Macavation database. **Role-based tests no longer use hardcoded emails** for those roles—they must be supplied via environment variables.

## What changed

| Area | Behaviour |
|------|-----------|
| **`fixtures/test-data.fixture.ts`** | General Manager, Production Manager, QA Supervisor, Sales Executive, and Office Administrator use **env-only** email + password (`GENERAL_MANAGER_EMAIL` / `GENERAL_MANAGER_PASSWORD`, etc.). No hardcoded seed emails. |
| **`auth/rbac.spec.ts`** | Tests **skip** when email or password is missing, with a message naming the env vars to set. |
| **`auth/login.spec.ts`** | Same for role dashboard redirect tests (TC-AUTH-004 … TC-AUTH-008). |
| **`kernel-production/kernel-roles.spec.ts`** | Same for kernel module access by role. |
| **`kernel-production/kernel-role-operations.spec.ts`** | Same for GM / PM / QA / Sales / Office Admin kernel flows. |

**Oil Plant Manager** still defaults to a fixed email in the fixture; set `OIL_PLANT_MANAGER_PASSWORD` (and optionally email if you add support later).

## Required environment variables (CI / local)

For **real users** in each role, set **both** email and password. If either is missing, the related tests are **skipped**.

| Role | Email variable | Password variable |
|------|----------------|-------------------|
| General Manager | `GENERAL_MANAGER_EMAIL` | `GENERAL_MANAGER_PASSWORD` |
| Production Manager | `PRODUCTION_MANAGER_EMAIL` | `PRODUCTION_MANAGER_PASSWORD` |
| QA Supervisor | `QA_SUPERVISOR_EMAIL` | `QA_SUPERVISOR_PASSWORD` |
| Sales Executive | `SALES_EXECUTIVE_EMAIL` | `SALES_EXECUTIVE_PASSWORD` |
| Office Administrator | `OFFICE_ADMINISTRATOR_EMAIL` | `OFFICE_ADMINISTRATOR_PASSWORD` |
| Oil Plant Manager | *(default in fixture)* | `OIL_PLANT_MANAGER_PASSWORD` |

### Example (`.env.e2e` or CI secrets)

```bash
GENERAL_MANAGER_EMAIL=gm.user@example.com
GENERAL_MANAGER_PASSWORD=your-secret

PRODUCTION_MANAGER_EMAIL=pm.user@example.com
PRODUCTION_MANAGER_PASSWORD=your-secret

QA_SUPERVISOR_EMAIL=qa.user@example.com
QA_SUPERVISOR_PASSWORD=your-secret

SALES_EXECUTIVE_EMAIL=sales.user@example.com
SALES_EXECUTIVE_PASSWORD=your-secret

OFFICE_ADMINISTRATOR_EMAIL=office.user@example.com
OFFICE_ADMINISTRATOR_PASSWORD=your-secret

OIL_PLANT_MANAGER_PASSWORD=your-secret
```

Also keep **`BASE_URL`**, **`CLIENT_GUID`**, and Super Admin vars as documented in the main [README.md](./README.md).

## Git reference (when this landed)

- Changes were introduced on **`dev`** and merged to **`demo`** (commits around removal of seed users + env-based fixtures; e.g. `cd51445` / `669cafd` era—see repo history for exact hashes).

## Related migration

Database cleanup for old seed users is in repo:

`migrations/20260318000002_remove_seed_users_mar_2026_playwright.sql`

Apply via your normal Supabase migration flow on each environment.
