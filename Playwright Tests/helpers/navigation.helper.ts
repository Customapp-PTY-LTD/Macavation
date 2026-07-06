import { Page, expect } from '@playwright/test';

/**
 * Navigation helper for Macavation app
 * Uses sidebar navigation as hash routing doesn't trigger module load
 */

type NavConfig = {
  /** Parent collapse panels to expand in order (outer → inner) */
  collapseIds?: string[];
  linkSelector: string;
};

// Map of routes to sidebar location (Phase 2: Home, pipelines, Support)
const NAVIGATION_MAP: Record<string, NavConfig> = {
  dashboard: { collapseIds: ['homeCollapse'], linkSelector: 'a[route="dashboard"]' },
  'my-day': { collapseIds: ['homeCollapse'], linkSelector: 'a[route="my-day"]' },
  'amanda-dashboard': { linkSelector: 'a[route="amanda-dashboard"]' },
  'executive-dashboard': { linkSelector: 'a[route="executive-dashboard"]' },
  'batch-journey': { linkSelector: 'a[route="batch-journey"]' },

  'crm-grid': {
    collapseIds: ['supportCollapse', 'crmCollapse'],
    linkSelector: 'a[route="crm-grid"]',
  },

  'grower-intake-grid': { collapseIds: ['kernelCollapse'], linkSelector: 'a[route="grower-intake-grid"]' },
  'kernel-production-grid': { collapseIds: ['kernelCollapse'], linkSelector: 'a[route="kernel-production-grid"]' },
  'stock-management-kernel': { collapseIds: ['kernelCollapse'], linkSelector: 'a[route="stock-management-kernel"]' },
  'kernel-dispatch-grid': { collapseIds: ['kernelCollapse'], linkSelector: 'a[route="kernel-dispatch-grid"]' },

  'supplier-intake-grid': { collapseIds: ['oilCollapse'], linkSelector: 'a[route="supplier-intake-grid"]' },
  'oil-production-grid': { collapseIds: ['oilCollapse'], linkSelector: 'a[route="oil-production-grid"]' },
  'stock-management-oil': { collapseIds: ['oilCollapse'], linkSelector: 'a[route="stock-management-oil"]' },
  'oil-dispatch-grid': { collapseIds: ['oilCollapse'], linkSelector: 'a[route="oil-dispatch-grid"]' },

  'kernel-production-forecast-grid': {
    collapseIds: ['supportCollapse'],
    linkSelector: 'a[route="kernel-production-forecast-grid"]',
  },
  'oil-production-forecast-grid': {
    collapseIds: ['supportCollapse'],
    linkSelector: 'a[route="oil-production-forecast-grid"]',
  },
  'quality-assurance-grid': {
    collapseIds: ['supportCollapse', 'qualityCollapse'],
    linkSelector: 'a[route="quality-assurance-grid"]',
  },
  'document-management-grid': {
    collapseIds: ['supportCollapse'],
    linkSelector: 'a[route="document-management-grid"]',
  },
  'sales-forecasting-grid': {
    collapseIds: ['supportCollapse', 'businessCollapse'],
    linkSelector: 'a[route="sales-forecasting-grid"]',
  },
  'financial-management-grid': {
    collapseIds: ['supportCollapse', 'businessCollapse'],
    linkSelector: 'a[route="financial-management-grid"]',
  },
  'palladium-integration-grid': {
    collapseIds: ['supportCollapse'],
    linkSelector: 'a[route="palladium-integration-grid"]',
  },

  'stock-management-grid': { linkSelector: 'a[route="stock-management-grid"]' },

  'admin-grid': {
    collapseIds: ['userManagementCollapse'],
    linkSelector: 'a[route="admin-grid"]',
  },
  'features-grid': {
    collapseIds: ['userManagementCollapse'],
    linkSelector: '#userManagementCollapse a[route="features-grid"]',
  },
  'role-actions-grid': {
    collapseIds: ['userManagementCollapse'],
    linkSelector: 'a[route="role-actions-grid"]',
  },
  'users-grid': {
    collapseIds: ['userManagementCollapse'],
    linkSelector: '#userManagementCollapse a[route="users-grid"], a[route="admin-grid"]',
  },
  'roles-grid': {
    collapseIds: ['userManagementCollapse'],
    linkSelector: '#userManagementCollapse a[route="roles-grid"], a[route="admin-grid"]',
  },
  'role-permissions-grid': {
    collapseIds: ['userManagementCollapse'],
    linkSelector: '#userManagementCollapse a[route="role-permissions-grid"]',
  },
  'role-features-grid': {
    collapseIds: ['userManagementCollapse'],
    linkSelector: '#userManagementCollapse a[route="role-features-grid"]',
  },
  'test-data-grid': {
    collapseIds: ['testManagementCollapse'],
    linkSelector: 'a[route="test-data-grid"]',
  },
  'test-scenarios-grid': {
    collapseIds: ['testManagementCollapse'],
    linkSelector: 'a[route="test-scenarios-grid"]',
  },
  'data-import-grid': { collapseIds: ['dataImportCollapse'], linkSelector: 'a[route="data-import-grid"]' },
};

async function expandCollapse(page: Page, collapseId: string): Promise<void> {
  const collapseContent = page.locator(`#${collapseId}`);
  const isOpen = await collapseContent.evaluate((el) => el.classList.contains('show')).catch(() => false);
  if (isOpen) return;

  const collapseToggle = page.locator(`[data-bs-target="#${collapseId}"]`).first();
  if (await collapseToggle.isVisible().catch(() => false)) {
    await collapseToggle.click();
    await page.waitForSelector(`#${collapseId}.show`, { state: 'visible', timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(200);
  }
}

/**
 * Navigate to a module using sidebar clicks
 * Uses the app router's loadContent method directly for reliable navigation
 */
export async function navigateToModule(page: Page, route: string): Promise<void> {
  const navConfig = NAVIGATION_MAP[route];

  await page.waitForSelector('nav, .sidebar', { state: 'visible' });

  for (const collapseId of navConfig?.collapseIds || []) {
    await expandCollapse(page, collapseId);
  }

  await page.evaluate(async (routeName) => {
    sessionStorage.setItem('lastActivePage', routeName);
    localStorage.setItem('lastActivePage', routeName);

    document.querySelectorAll('a[route]').forEach((el) => el.classList.remove('active'));
    const targetLink = document.querySelector(`a[route="${routeName}"]`);
    if (targetLink) {
      targetLink.classList.add('active');
    }

    if (typeof _appRouter !== 'undefined' && _appRouter.loadContent) {
      await _appRouter.loadContent({
        routeName: routeName,
        elementSelector: _appRouter.contentContainer || '#content-area',
      });
    }
  }, route);

  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);

  await page
    .waitForFunction(
      (expectedRoute) => sessionStorage.getItem('lastActivePage') === expectedRoute,
      route,
      { timeout: 10000 }
    )
    .catch(() => {});
}

/** User & access hub — People tab (falls back to legacy users-grid on older deployments) */
export async function navigateToAdminUsers(page: Page): Promise<void> {
  await navigateToModule(page, 'admin-grid');

  const onAdminHub = await page.locator('.admin-access-module').isVisible({ timeout: 4000 }).catch(() => false);
  if (!onAdminHub) {
    await navigateToModule(page, 'users-grid');
    await expect(page.locator('#usersTable')).toBeVisible({ timeout: 20000 });
    return;
  }

  const usersTab = page.locator('#users-tab');
  if (await usersTab.isVisible().catch(() => false)) {
    await usersTab.click();
  }
  await expect(page.locator('#adminUsersTable')).toBeVisible({ timeout: 20000 });
  await page
    .locator('#usersTableBody')
    .filter({ hasText: 'Loading' })
    .waitFor({ state: 'hidden', timeout: 20000 })
    .catch(() => {});
}

/** User & access hub — Roles tab (falls back to legacy roles-grid on older deployments) */
export async function navigateToAdminRoles(page: Page): Promise<void> {
  await navigateToModule(page, 'admin-grid');

  const onAdminHub = await page.locator('.admin-access-module').isVisible({ timeout: 4000 }).catch(() => false);
  if (!onAdminHub) {
    await navigateToModule(page, 'roles-grid');
    await expect(page.locator('#rolesTable')).toBeVisible({ timeout: 20000 });
    return;
  }

  await page.locator('#roles-tab').click();
  await expect(page.locator('#adminRolesTable')).toBeVisible({ timeout: 20000 });
  await page
    .locator('#rolesTableBody')
    .filter({ hasText: 'Loading' })
    .waitFor({ state: 'hidden', timeout: 20000 })
    .catch(() => {});
}

/** Stock (Kernel): navigate and wait until kernel stock UI is ready */
export async function navigateToStockKernel(page: Page): Promise<void> {
  await navigateToModule(page, 'stock-management-kernel');

  const title = page.locator('#stockManagementTitle');
  const hasTitle = await title.isVisible({ timeout: 8000 }).catch(() => false);
  if (!hasTitle) {
    await navigateToModule(page, 'stock-management-grid');
  }

  await expect(title).toBeVisible({ timeout: 25000 });

  await page.evaluate(() => {
    const sel = document.getElementById('filterStockStream');
    if (sel) sel.value = 'kernel';
    const route = (typeof _appRouter !== 'undefined' && _appRouter) ? _appRouter.currentRoute : '';
    if (typeof _stockManagementGrid !== 'undefined' && _stockManagementGrid.applyStreamFromRoute) {
      if (route !== 'stock-management-kernel') {
        if (typeof _appRouter !== 'undefined') _appRouter.currentRoute = 'stock-management-kernel';
      }
      _stockManagementGrid.applyStreamFromRoute();
    } else if (typeof _stockManagementGrid !== 'undefined' && _stockManagementGrid.toggleKernelBatchJourney) {
      _stockManagementGrid.toggleKernelBatchJourney('kernel');
    }
  });

  await page.waitForTimeout(500);
  await waitForStockKernelReady(page);
}

/** Stock (Kernel): wait until batch journey panel is shown */
export async function waitForStockKernelReady(page: Page): Promise<void> {
  await expect(page.locator('#stockManagementTitle')).toContainText(/Stock \(Kernel\)|Stock Management/, {
    timeout: 25000,
  });
  await page.waitForFunction(
    () => {
      const card = document.getElementById('kernelBatchJourneyCard');
      if (!card) return false;
      return window.getComputedStyle(card).display !== 'none';
    },
    { timeout: 30000 }
  );
}

/**
 * Navigate to dashboard
 */
export async function navigateToDashboard(page: Page): Promise<void> {
  const dashboardLink = page.locator('a[route="dashboard"]');
  if (await dashboardLink.isVisible()) {
    await dashboardLink.click();
    await page.waitForLoadState('networkidle');
  }
}

/**
 * Check if a module link is visible in sidebar
 */
export async function isModuleVisible(page: Page, route: string): Promise<boolean> {
  const navConfig = NAVIGATION_MAP[route];
  if (!navConfig) return false;

  for (const collapseId of navConfig.collapseIds || []) {
    await expandCollapse(page, collapseId);
  }

  const link = page.locator(navConfig.linkSelector).first();
  return link.isVisible().catch(() => false);
}
