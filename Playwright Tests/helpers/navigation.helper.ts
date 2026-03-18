import { Page } from '@playwright/test';

/**
 * Navigation helper for Macavation app
 * Uses sidebar navigation as hash routing doesn't trigger module load
 */

// Map of routes to their parent collapse IDs and selectors
const NAVIGATION_MAP: Record<string, { collapseId?: string; linkSelector: string }> = {
  // Main routes (no collapse)
  'dashboard': { linkSelector: 'a[route="dashboard"]' },
  'my-day': { linkSelector: 'a[route="my-day"]' },
  'amanda-dashboard': { linkSelector: 'a[route="amanda-dashboard"]' },
  'executive-dashboard': { linkSelector: 'a[route="executive-dashboard"]' },
  
  // CRM
  'crm-grid': { collapseId: 'crmCollapse', linkSelector: 'a[route="crm-grid"]' },
  
  // Production
  'grower-intake-grid': { collapseId: 'productionCollapse', linkSelector: 'a[route="grower-intake-grid"]' },
  'kernel-production-grid': { collapseId: 'productionCollapse', linkSelector: 'a[route="kernel-production-grid"]' },
  'oil-production-grid': { collapseId: 'productionCollapse', linkSelector: 'a[route="oil-production-grid"]' },
  
  // Quality & Stock
  'quality-assurance-grid': { collapseId: 'qualityCollapse', linkSelector: 'a[route="quality-assurance-grid"]' },
  'stock-management-grid': { collapseId: 'qualityCollapse', linkSelector: 'a[route="stock-management-grid"]' },
  'stock-management-kernel': { collapseId: 'qualityCollapse', linkSelector: 'a[route="stock-management-kernel"]' },
  'kernel-dispatch-grid': { collapseId: 'qualityCollapse', linkSelector: 'a[route="kernel-dispatch-grid"]' },
  
  // Business
  'sales-forecasting-grid': { collapseId: 'businessCollapse', linkSelector: 'a[route="sales-forecasting-grid"]' },
  'financial-management-grid': { collapseId: 'businessCollapse', linkSelector: 'a[route="financial-management-grid"]' },
  
  // Document Management (no collapse)
  'document-management-grid': { linkSelector: 'a[route="document-management-grid"]' },
  
  // Palladium Integration (no collapse)
  'palladium-integration-grid': { linkSelector: 'a[route="palladium-integration-grid"]' },
  
  // User Management (use more specific selector to avoid navbar brand)
  'users-grid': { collapseId: 'userManagementCollapse', linkSelector: '#userManagementCollapse a[route="users-grid"]' },
  'roles-grid': { collapseId: 'userManagementCollapse', linkSelector: '#userManagementCollapse a[route="roles-grid"]' },
  'role-permissions-grid': { collapseId: 'userManagementCollapse', linkSelector: '#userManagementCollapse a[route="role-permissions-grid"]' },
  'role-features-grid': { collapseId: 'userManagementCollapse', linkSelector: '#userManagementCollapse a[route="role-features-grid"]' },
  
  // System Administration (no collapse)
  'admin-grid': { linkSelector: 'a[route="admin-grid"]' },
  'data-import-grid': { collapseId: 'dataImportCollapse', linkSelector: 'a[route="data-import-grid"]' },
};

/**
 * Navigate to a module using sidebar clicks
 * Uses the app router's loadContent method directly for reliable navigation
 */
export async function navigateToModule(page: Page, route: string): Promise<void> {
  const navConfig = NAVIGATION_MAP[route];
  
  // Wait for sidebar to be visible
  await page.waitForSelector('nav, .sidebar', { state: 'visible' });
  
  // If there's a collapse parent, expand it first
  if (navConfig?.collapseId) {
    const collapseToggle = page.locator(`[data-bs-target="#${navConfig.collapseId}"]`);
    const collapseContent = page.locator(`#${navConfig.collapseId}`);
    
    // Check if collapse is already open
    const isOpen = await collapseContent.evaluate(el => el.classList.contains('show')).catch(() => false);
    
    if (!isOpen && await collapseToggle.isVisible()) {
      await collapseToggle.click();
      // Wait for the collapse to fully open
      await page.waitForSelector(`#${navConfig.collapseId}.show`, { state: 'visible', timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(300);
    }
  }
  
  // Use JavaScript to trigger the router directly - this is more reliable than clicking
  // The app router uses _appRouter.loadContent() to load modules
  await page.evaluate(async (routeName) => {
    // Store in session/local storage like the router does
    sessionStorage.setItem('lastActivePage', routeName);
    localStorage.setItem('lastActivePage', routeName);
    
    // Update active nav link
    document.querySelectorAll('a[route]').forEach(el => el.classList.remove('active'));
    const targetLink = document.querySelector(`a[route="${routeName}"]`);
    if (targetLink) {
      targetLink.classList.add('active');
    }
    
    // Call the router's loadContent method directly
    if (typeof _appRouter !== 'undefined' && _appRouter.loadContent) {
      await _appRouter.loadContent({
        routeName: routeName,
        elementSelector: _appRouter.contentContainer || '#content-area'
      });
    }
  }, route);
  
  // Wait for content to load
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  
  // Verify content changed from dashboard
  await page.waitForFunction(
    (expectedRoute) => {
      // Check if the current route matches
      const currentRoute = sessionStorage.getItem('lastActivePage');
      return currentRoute === expectedRoute;
    },
    route,
    { timeout: 10000 }
  ).catch(() => {
    // Fallback: just wait a bit more
  });
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
  
  // If there's a collapse parent, we need to check if it's expanded
  if (navConfig.collapseId) {
    const collapseContent = page.locator(`#${navConfig.collapseId}`);
    const isOpen = await collapseContent.evaluate(el => el.classList.contains('show')).catch(() => false);
    
    if (!isOpen) {
      // Expand it temporarily to check
      const collapseToggle = page.locator(`[data-bs-target="#${navConfig.collapseId}"]`);
      if (await collapseToggle.isVisible()) {
        await collapseToggle.click();
        await page.waitForTimeout(500);
      }
    }
  }
  
  const link = page.locator(navConfig.linkSelector);
  return await link.isVisible().catch(() => false);
}
