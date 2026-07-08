import { test, expect, Page, ConsoleMessage } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { navigateToModule } from '../helpers/navigation.helper';

/**
 * Deployed-site smoke test (run against the URL in BASE_URL).
 *
 * Journey: login → dashboard loads clean → kernel dispatch grid loads
 * (regression for the resurrected-overload bug) → CRM create contact →
 * deactivate it via the UI.
 *
 * The UI delete is a soft-delete (is_active=false); hard-delete the row
 * afterwards with scripts (see run notes) if the test data must not remain.
 *
 * Credentials come from SMOKE_EMAIL / SMOKE_PASSWORD — never hardcode them.
 */

const EMAIL = process.env.SMOKE_EMAIL || '';
const PASSWORD = process.env.SMOKE_PASSWORD || '';
const STAMP = process.env.SMOKE_STAMP || `${Date.now()}`;
const COMPANY_NAME = `E2E PROD SMOKE ${STAMP}`;
// SMOKE_READONLY=1 skips the CRM create/deactivate steps (no writes at all).
const READONLY = process.env.SMOKE_READONLY === '1';
// When set (e.g. "sofanhfpxifgdtooefzq"), assert the app resolved its Supabase
// URL to this project ref — proves which database the host routes to.
const EXPECT_REF = process.env.SMOKE_EXPECT_REF || '';

// Console errors that indicate the bugs this release fixed (or new breakage).
const FATAL_CONSOLE_PATTERNS = [
  /Could not choose the best candidate function/i,
  /column .* does not exist/i,
  /appRouter is required/i,
  /blocked by CORS policy/i,
  /Failed to load resource: the server responded with a status of (400|500)/i,
];

// Known-benign noise on this app.
const IGNORED_CONSOLE_PATTERNS = [
  /favicon/i,
  /Service Worker/i,
  /404.*favicon/i,
  /get_sales_forecasts|get_financial_transactions/i,
];

function watchConsole(page: Page, sink: string[]) {
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return;
    const text = msg.text();
    if (IGNORED_CONSOLE_PATTERNS.some((re) => re.test(text))) return;
    if (FATAL_CONSOLE_PATTERNS.some((re) => re.test(text))) sink.push(text);
  });
  page.on('pageerror', (err) => sink.push(`pageerror: ${err.message}`));
}

test.describe('Deployed-site smoke @prod-smoke', () => {
  test.skip(!EMAIL || !PASSWORD, 'SMOKE_EMAIL / SMOKE_PASSWORD not set');

  test('login, dashboards, dispatch grid, CRM create + deactivate', async ({ page }) => {
    test.setTimeout(240_000);
    const fatalErrors: string[] = [];
    watchConsole(page, fatalErrors);

    await test.step('login', async () => {
      const login = new LoginPage(page);
      await login.goto();
      await login.loginAndWait(EMAIL, PASSWORD);
      // networkidle never settles on the polling dashboard; wait for the shell.
      await page.waitForSelector('#content-area', { state: 'visible', timeout: 30_000 });
    });

    if (EXPECT_REF) {
      await test.step(`app routes to database ${EXPECT_REF}`, async () => {
        const resolvedUrl = await page.evaluate(async () => {
          // @ts-ignore — app globals
          if (typeof _appRouter !== 'undefined' && _appRouter.ensureConfigured) {
            // @ts-ignore
            await _appRouter.ensureConfigured();
            // @ts-ignore
            return _appRouter.SupabaseUrl || '';
          }
          // @ts-ignore
          return (window.MACAVATION_SUPABASE && window.MACAVATION_SUPABASE.url) || '';
        });
        expect(resolvedUrl, `app resolved Supabase URL: ${resolvedUrl}`).toContain(EXPECT_REF);
      });
    }

    await test.step('dashboard loads clean', async () => {
      await page.waitForSelector('#content-area', { state: 'visible', timeout: 30_000 });
      // Executive dashboard KPI content should render (SOH fix regression).
      await page.waitForTimeout(4_000); // let dashboard RPC batch settle
      expect(fatalErrors, `console errors on dashboard:\n${fatalErrors.join('\n')}`).toHaveLength(0);
    });

    await test.step('kernel dispatch grid loads (overload regression)', async () => {
      await navigateToModule(page, 'kernel-dispatch-grid');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2_000);
      expect(
        fatalErrors.filter((e) => /Could not choose/i.test(e)),
        'PostgREST overload ambiguity is back'
      ).toHaveLength(0);
      expect(fatalErrors, `console errors on dispatch grid:\n${fatalErrors.join('\n')}`).toHaveLength(0);
    });

    if (READONLY) {
      expect(fatalErrors, `fatal console errors during run:\n${fatalErrors.join('\n')}`).toHaveLength(0);
      return;
    }

    await test.step('CRM: create test contact', async () => {
      await navigateToModule(page, 'crm-grid');
      await page.waitForSelector('#nisSuppliersTable', { state: 'visible', timeout: 30_000 });

      await page.click('#addContactBtn');
      await page.waitForSelector('#contactModal.show', { state: 'visible' });
      await page.waitForTimeout(500);

      await page.selectOption('#contactType', 'nis_supplier');
      await page.fill('#companyName', COMPANY_NAME);
      const email = page.locator('#primaryContactEmail');
      if (await email.isVisible().catch(() => false)) {
        await email.fill(`e2e.smoke.${STAMP}@test.invalid`);
      }
      await page.click('#saveContactBtn');

      // Success alert, then the grid reloads.
      const swal = page.locator('.swal2-popup');
      await swal.waitFor({ state: 'visible', timeout: 15_000 });
      const isError = await page.locator('.swal2-icon-error').isVisible().catch(() => false);
      const swalText = await page.locator('.swal2-html-container, .swal2-title').first().textContent().catch(() => '');
      expect(isError, `contact save failed: ${swalText}`).toBe(false);
      await page.click('.swal2-confirm').catch(() => {});
      await page.waitForTimeout(2_000);

      await expect(
        page.locator(`#nisSuppliersTable tr:has-text("${COMPANY_NAME}")`).first()
      ).toBeVisible({ timeout: 15_000 });
    });

    await test.step('CRM: deactivate test contact via UI', async () => {
      const row = page.locator(`#nisSuppliersTable tr:has-text("${COMPANY_NAME}")`).first();
      // Row actions live behind the shared MacTableActions ellipsis — open it first.
      await row.locator('.mac-table-actions [data-bs-toggle="dropdown"]').click();
      await page.waitForTimeout(400);
      await page.locator('.delete-contact-btn:visible').first().click();

      await page.waitForSelector('.swal2-popup', { state: 'visible', timeout: 10_000 });
      await page.click('.swal2-confirm'); // "Yes, deactivate it!"

      // Success alert after the RPC completes.
      await page.waitForSelector('.swal2-popup:has-text("Deactivated")', { timeout: 15_000 });
      await page.click('.swal2-confirm').catch(() => {});
      await page.waitForTimeout(2_000);

      await expect(
        page.locator(`#nisSuppliersTable tr:has-text("${COMPANY_NAME}")`)
      ).toHaveCount(0, { timeout: 15_000 });
    });

    expect(fatalErrors, `fatal console errors during run:\n${fatalErrors.join('\n')}`).toHaveLength(0);
  });
});
