# Playwright Tests (QA Strategy Blueprint)

Per **BluePrint/QA_STRATEGY_BLUEPRINT** (Phase 3 – Execution, Overview and Test Structure), tests live under:

```
Playwright Tests/
├── playwright.config.ts
├── package.json
├── global-setup.ts
├── fixtures/           # Shared fixtures (auth, test-data)
├── helpers/            # Navigation, API, database, wait
├── reporters/          # Supabase reporter
├── database/           # QA tables / seed SQL
├── pages/              # Optional page objects
├── auth/               # Auth module specs (login.spec.ts, rbac.spec.ts)
├── kernel-production/  # kernel-production.spec.ts
├── kernel-dispatch/    # kernel-dispatch.spec.ts
├── stock-management/   # stock-management.spec.ts, stock-kernel.spec.ts
├── crm/
├── dashboard/
├── financial-management/
├── grower-intake/
├── oil-production/
├── quality-assurance/
└── user-management/
```

## Naming (Blueprint)

- **Spec files:** `{module-name}.spec.ts` (e.g. `kernel-production.spec.ts`)
- **Multi-word modules:** kebab-case (e.g. `stock-management`, `kernel-dispatch`)

## Run tests

From this directory (`Playwright Tests/`):

```bash
npm install
npm test
npm run test:kernel-modules   # Kernel Production + Dispatch + Stock (Kernel)
npm run test:kernel           # Kernel Production only
npm run test:kernel-dispatch
npm run test:stock-kernel
```

Set `BASE_URL` and `CLIENT_GUID` in `.env.e2e` (copy from `.env.e2e.example` if present). Do not commit `.env.e2e` or `test-results/`.

### Help screenshots

After UI changes that affect help topics:

```bash
npm run capture-user-guide
node ../scripts/apply_user_guide_help_links.mjs
```

- **Grids only (fast):** `npm run capture-user-guide:grids-only`
- Writes PNGs to `WebPortal/help/assets/screenshots/`
- Routes: `helpers/user-guide-screenshot-routes.ts`
- Per-topic capture (CRM tabs, modals): `helpers/user-guide-capture-actions.ts`

Requires `.env.e2e` with `BASE_URL`, `CLIENT_GUID`, and Super Admin credentials (see `.env.e2e.example`). SVG diagrams live in `docs/user-guide/assets/` and are copied to `WebPortal/help/assets/` when you run the generator script.

### Role-based tests (RBAC, login redirects, kernel role ops)

**→ Full guide:** [README-ROLE-CREDENTIALS.md](./README-ROLE-CREDENTIALS.md)

Set per-role **email + password** env vars for real users, or those tests are **skipped**. Quick reference:

| Role | Variables |
|------|-----------|
| General Manager | `GENERAL_MANAGER_EMAIL`, `GENERAL_MANAGER_PASSWORD` |
| Production Manager | `PRODUCTION_MANAGER_EMAIL`, `PRODUCTION_MANAGER_PASSWORD` |
| QA Supervisor | `QA_SUPERVISOR_EMAIL`, `QA_SUPERVISOR_PASSWORD` |
| Sales Executive | `SALES_EXECUTIVE_EMAIL`, `SALES_EXECUTIVE_PASSWORD` |
| Office Administrator | `OFFICE_ADMINISTRATOR_EMAIL`, `OFFICE_ADMINISTRATOR_PASSWORD` |
| Oil Plant Manager | `OIL_PLANT_MANAGER_EMAIL`, `OIL_PLANT_MANAGER_PASSWORD` |
