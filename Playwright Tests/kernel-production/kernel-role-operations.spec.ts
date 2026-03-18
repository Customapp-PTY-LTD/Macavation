import { test, expect } from '../fixtures';
import { navigateToModule } from '../helpers/navigation.helper';

/**
 * Kernel-only E2E: role-based access and operations for Kernel modules.
 * Each role can access: Grower Intake, Kernel Production, Stock (Kernel), Kernel Dispatch.
 * Operations: no Access Denied, Send to Dispatch modal + buyer select where applicable.
 * Users have password1 (created in Supabase for E2E).
 */

const KERNEL_MODULES: { route: string; name: string; contentSelector: string }[] = [
  { route: 'grower-intake-grid', name: 'Grower Intake', contentSelector: '.module-content, #growerIntakeGrid' },
  { route: 'kernel-production-grid', name: 'Kernel Production', contentSelector: '#kpSilosGrid, #kpKanbanBoard, .module-content' },
  { route: 'stock-management-kernel', name: 'Stock (Kernel)', contentSelector: '#kernelBatchJourneyCard, #stockManagementTitle, .module-content' },
  { route: 'kernel-dispatch-grid', name: 'Kernel Dispatch', contentSelector: '#kdKanbanBoard, #kdTableCards, .module-content' },
];

function noAccessDenied(page: import('@playwright/test').Page) {
  return expect(page.locator('#content-area:has-text("Access Denied")')).not.toBeVisible();
}

test.describe('Kernel role operations - General Manager @kernel @rbac', () => {
  test('General Manager: access all Kernel modules, no Access Denied', async ({ testData, loginAsGeneralManager }) => {
    test.skip(!testData.users.generalManager?.email || !testData.users.generalManager?.password, 'Set GENERAL_MANAGER_EMAIL and GENERAL_MANAGER_PASSWORD');
    const page = await loginAsGeneralManager();
    await page.waitForLoadState('networkidle');
    for (const mod of KERNEL_MODULES) {
      await navigateToModule(page, mod.route);
      await page.waitForTimeout(1200);
      await noAccessDenied(page);
      await expect(page.locator(mod.contentSelector).first()).toBeVisible({ timeout: 12000 });
    }
  });

  test('General Manager: Stock (Kernel) - Send to Dispatch buyer dropdown', async ({ testData, loginAsGeneralManager }) => {
    test.skip(!testData.users.generalManager?.email || !testData.users.generalManager?.password, 'Set GENERAL_MANAGER_EMAIL and GENERAL_MANAGER_PASSWORD');
    const page = await loginAsGeneralManager();
    await page.waitForLoadState('networkidle');
    await navigateToModule(page, 'stock-management-kernel');
    await page.waitForTimeout(1500);
    await noAccessDenied(page);
    await page.locator('#sendToDispatchBtn').click();
    await expect(page.locator('#sendToDispatchModal')).toBeVisible({ timeout: 8000 });
    const buyerSelect = page.locator('#dispatchBuyerContact');
    await expect(buyerSelect).toBeVisible({ timeout: 5000 });
    await expect(buyerSelect.locator('option').first()).toBeAttached({ timeout: 10000 });
    const count = await buyerSelect.locator('option').count();
    expect(count).toBeGreaterThanOrEqual(1);
    await page.locator('#sendToDispatchModal .btn-close, [data-bs-dismiss="modal"]').first().click().catch(() => {});
  });
});

test.describe('Kernel role operations - Production Manager @kernel @rbac', () => {
  test('Production Manager: access all Kernel modules, no Access Denied', async ({ testData, loginAsProductionManager }) => {
    test.skip(!testData.users.productionManager?.email || !testData.users.productionManager?.password, 'Set PRODUCTION_MANAGER_EMAIL and PRODUCTION_MANAGER_PASSWORD');
    const page = await loginAsProductionManager();
    await page.waitForLoadState('networkidle');
    for (const mod of KERNEL_MODULES) {
      await navigateToModule(page, mod.route);
      await page.waitForTimeout(1200);
      await noAccessDenied(page);
      await expect(page.locator(mod.contentSelector).first()).toBeVisible({ timeout: 12000 });
    }
  });
});

test.describe('Kernel role operations - QA Supervisor @kernel @rbac', () => {
  test('QA Supervisor: access all Kernel modules, no Access Denied', async ({ testData, loginAsQASupervisor }) => {
    test.skip(!testData.users.qaSupervsor?.email || !testData.users.qaSupervsor?.password, 'Set QA_SUPERVISOR_EMAIL and QA_SUPERVISOR_PASSWORD');
    const page = await loginAsQASupervisor();
    await page.waitForLoadState('networkidle');
    for (const mod of KERNEL_MODULES) {
      await navigateToModule(page, mod.route);
      await page.waitForTimeout(1200);
      await noAccessDenied(page);
      await expect(page.locator(mod.contentSelector).first()).toBeVisible({ timeout: 12000 });
    }
  });

  test('QA Supervisor: Stock (Kernel) - Send to Dispatch modal opens', async ({ testData, loginAsQASupervisor }) => {
    test.skip(!testData.users.qaSupervsor?.email || !testData.users.qaSupervsor?.password, 'Set QA_SUPERVISOR_EMAIL and QA_SUPERVISOR_PASSWORD');
    const page = await loginAsQASupervisor();
    await page.waitForLoadState('networkidle');
    await navigateToModule(page, 'stock-management-kernel');
    await page.waitForTimeout(1500);
    await noAccessDenied(page);
    await page.locator('#sendToDispatchBtn').click();
    await expect(page.locator('#sendToDispatchModal')).toBeVisible({ timeout: 8000 });
    await page.locator('#sendToDispatchModal .btn-close, [data-bs-dismiss="modal"]').first().click().catch(() => {});
  });
});

test.describe('Kernel role operations - Sales Executive @kernel @rbac', () => {
  test('Sales Executive: access all Kernel modules, no Access Denied', async ({ testData, loginAsSalesExecutive }) => {
    test.skip(!testData.users.salesExecutive?.email || !testData.users.salesExecutive?.password, 'Set SALES_EXECUTIVE_EMAIL and SALES_EXECUTIVE_PASSWORD');
    const page = await loginAsSalesExecutive();
    await page.waitForLoadState('networkidle');
    for (const mod of KERNEL_MODULES) {
      await navigateToModule(page, mod.route);
      await page.waitForTimeout(1200);
      await noAccessDenied(page);
      await expect(page.locator(mod.contentSelector).first()).toBeVisible({ timeout: 12000 });
    }
  });
});

test.describe('Kernel role operations - Oil Plant Manager @kernel @rbac', () => {
  test('Oil Plant Manager: access all Kernel modules, no Access Denied', async ({ testData, loginAsOilPlantManager }) => {
    test.skip(!testData.users.oilPlantManager?.password, 'Oil Plant Manager password not set');
    const page = await loginAsOilPlantManager();
    await page.waitForLoadState('networkidle');
    for (const mod of KERNEL_MODULES) {
      await navigateToModule(page, mod.route);
      await page.waitForTimeout(1200);
      await noAccessDenied(page);
      await expect(page.locator(mod.contentSelector).first()).toBeVisible({ timeout: 12000 });
    }
  });
});

test.describe('Kernel role operations - Office Administrator @kernel @rbac', () => {
  test('Office Administrator: access all Kernel modules, no Access Denied', async ({ testData, loginAsOfficeAdministrator }) => {
    test.skip(!testData.users.officeAdministrator?.email || !testData.users.officeAdministrator?.password, 'Set OFFICE_ADMINISTRATOR_EMAIL and OFFICE_ADMINISTRATOR_PASSWORD');
    const page = await loginAsOfficeAdministrator();
    await page.waitForLoadState('networkidle');
    for (const mod of KERNEL_MODULES) {
      await navigateToModule(page, mod.route);
      await page.waitForTimeout(1200);
      await noAccessDenied(page);
      await expect(page.locator(mod.contentSelector).first()).toBeVisible({ timeout: 12000 });
    }
  });
});
