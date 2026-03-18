import { test, expect } from '../fixtures';
import { navigateToModule } from '../helpers/navigation.helper';

/**
 * Kernel modules – Role-based access (QA Blueprint: different user roles see what they should).
 * Full e2e: login as role → open Stock (Kernel), Kernel Production, Kernel Dispatch → no Access Denied, content loads.
 */

const KERNEL_ROUTES = [
  { route: 'stock-management-kernel', name: 'Stock (Kernel)', selector: '#kernelBatchJourneyCard, #stockManagementTitle' },
  { route: 'kernel-production-grid', name: 'Kernel Production', selector: '#kpSilosGrid, #kpKanbanBoard, .module-content' },
  { route: 'kernel-dispatch-grid', name: 'Kernel Dispatch', selector: '#kdKanbanBoard, #kdTableCards, .module-content' },
] as const;

test.describe('Kernel modules - Role-based access @kernel @rbac', () => {

  test('TC-KR-001: Sales Executive can access Stock (Kernel)', async ({ testData, loginAsSalesExecutive }) => {
    test.skip(!testData.users.salesExecutive?.password, 'Sales Executive password not set');
    const page = await loginAsSalesExecutive();
    await page.waitForLoadState('networkidle');
    await navigateToModule(page, 'stock-management-kernel');
    await page.waitForTimeout(1500);
    await expect(page.locator('#content-area:has-text("Access Denied")')).not.toBeVisible();
    await expect(page.locator('#stockManagementTitle, #kernelBatchJourneyCard, .module-content').first()).toBeVisible({ timeout: 10000 });
  });

  test('TC-KR-002: Sales Executive can access Kernel Production', async ({ testData, loginAsSalesExecutive }) => {
    test.skip(!testData.users.salesExecutive?.password, 'Sales Executive password not set');
    const page = await loginAsSalesExecutive();
    await page.waitForLoadState('networkidle');
    await navigateToModule(page, 'kernel-production-grid');
    await page.waitForTimeout(1500);
    await expect(page.locator('#content-area:has-text("Access Denied")')).not.toBeVisible();
    await expect(page.locator('#kpSilosGrid, #kpKanbanBoard, .module-content').first()).toBeVisible({ timeout: 10000 });
  });

  test('TC-KR-003: Sales Executive can access Kernel Dispatch', async ({ testData, loginAsSalesExecutive }) => {
    test.skip(!testData.users.salesExecutive?.password, 'Sales Executive password not set');
    const page = await loginAsSalesExecutive();
    await page.waitForLoadState('networkidle');
    await navigateToModule(page, 'kernel-dispatch-grid');
    await page.waitForTimeout(1500);
    await expect(page.locator('#content-area:has-text("Access Denied")')).not.toBeVisible();
    await expect(page.locator('#kdKanbanBoard, #kdTableCards, .module-content').first()).toBeVisible({ timeout: 10000 });
  });

  test('TC-KR-004: Production Manager can access Stock (Kernel)', async ({ testData, loginAsProductionManager }) => {
    test.skip(!testData.users.productionManager?.password, 'Production Manager password not set');
    const page = await loginAsProductionManager();
    await page.waitForLoadState('networkidle');
    await navigateToModule(page, 'stock-management-kernel');
    await page.waitForTimeout(1500);
    await expect(page.locator('#content-area:has-text("Access Denied")')).not.toBeVisible();
    await expect(page.locator('#stockManagementTitle, #kernelBatchJourneyCard, .module-content').first()).toBeVisible({ timeout: 10000 });
  });

  test('TC-KR-005: Production Manager can access Kernel Production', async ({ testData, loginAsProductionManager }) => {
    test.skip(!testData.users.productionManager?.password, 'Production Manager password not set');
    const page = await loginAsProductionManager();
    await page.waitForLoadState('networkidle');
    await navigateToModule(page, 'kernel-production-grid');
    await page.waitForTimeout(1500);
    await expect(page.locator('#content-area:has-text("Access Denied")')).not.toBeVisible();
    await expect(page.locator('#kpSilosGrid, #kpKanbanBoard, .module-content').first()).toBeVisible({ timeout: 10000 });
  });

  test('TC-KR-006: Production Manager can access Kernel Dispatch', async ({ testData, loginAsProductionManager }) => {
    test.skip(!testData.users.productionManager?.password, 'Production Manager password not set');
    const page = await loginAsProductionManager();
    await page.waitForLoadState('networkidle');
    await navigateToModule(page, 'kernel-dispatch-grid');
    await page.waitForTimeout(1500);
    await expect(page.locator('#content-area:has-text("Access Denied")')).not.toBeVisible();
    await expect(page.locator('#kdKanbanBoard, #kdTableCards, .module-content').first()).toBeVisible({ timeout: 10000 });
  });

  test('TC-KR-007: General Manager can access all Kernel modules', async ({ testData, loginAsGeneralManager }) => {
    test.skip(!testData.users.generalManager?.password, 'General Manager password not set');
    const page = await loginAsGeneralManager();
    await page.waitForLoadState('networkidle');
    for (const { route, selector } of KERNEL_ROUTES) {
      await navigateToModule(page, route);
      await page.waitForTimeout(1000);
      await expect(page.locator('#content-area:has-text("Access Denied")')).not.toBeVisible();
      await expect(page.locator(selector).first()).toBeVisible({ timeout: 10000 });
    }
  });

  test('TC-KR-008: QA Supervisor can access Stock (Kernel) and Kernel Production', async ({ testData, loginAsQASupervisor }) => {
    test.skip(!testData.users.qaSupervsor?.password, 'QA Supervisor password not set');
    const page = await loginAsQASupervisor();
    await page.waitForLoadState('networkidle');
    await navigateToModule(page, 'stock-management-kernel');
    await page.waitForTimeout(1500);
    await expect(page.locator('#content-area:has-text("Access Denied")')).not.toBeVisible();
    await navigateToModule(page, 'kernel-production-grid');
    await page.waitForTimeout(1500);
    await expect(page.locator('#content-area:has-text("Access Denied")')).not.toBeVisible();
    await expect(page.locator('#kpSilosGrid, .module-content').first()).toBeVisible({ timeout: 10000 });
  });
});
