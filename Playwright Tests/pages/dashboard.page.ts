import { Page, Locator, expect } from '@playwright/test';

/**
 * Page Object Model for Dashboard
 */
export class DashboardPage {
  readonly page: Page;
  
  // Locators
  readonly sidebar: Locator;
  readonly mainContent: Locator;
  readonly userInfo: Locator;
  readonly logoutButton: Locator;
  readonly metricCards: Locator;
  readonly exceptionsList: Locator;
  readonly quickActions: Locator;

  constructor(page: Page) {
    this.page = page;
    
    this.sidebar = page.locator('.sidebar, #sidebar');
    this.mainContent = page.locator('#mainContent, .main-content');
    this.userInfo = page.locator('.user-info, #userInfo');
    this.logoutButton = page.locator('#logoutBtn, .logout-btn');
    this.metricCards = page.locator('.metric-card, .kpi-card');
    this.exceptionsList = page.locator('.exceptions-list, #exceptionsList');
    this.quickActions = page.locator('.quick-actions, #quickActions');
  }

  /**
   * Navigate to dashboard
   */
  async goto() {
    await this.page.goto('/#dashboard-grid');
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Assert user is on dashboard
   */
  async expectOnDashboard() {
    await expect(this.sidebar).toBeVisible();
    await expect(this.mainContent).toBeVisible();
  }

  /**
   * Navigate to a module via sidebar
   */
  async navigateToModule(moduleName: string) {
    const navLink = this.page.locator(`[route="${moduleName}-grid"], [href="#${moduleName}-grid"]`);
    await navLink.click();
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Click on a metric card
   */
  async clickMetric(metricName: string) {
    const metric = this.metricCards.filter({ hasText: metricName }).first();
    await metric.click();
  }

  /**
   * Get metric value
   */
  async getMetricValue(metricName: string): Promise<string> {
    const metric = this.metricCards.filter({ hasText: metricName }).first();
    const value = metric.locator('.metric-value, .value');
    return await value.textContent() || '';
  }

  /**
   * Logout
   */
  async logout() {
    await this.logoutButton.click();
    await this.page.waitForURL(/signin\.html|login/, { timeout: 10000 });
  }

  /**
   * Get current user name from header
   */
  async getCurrentUserName(): Promise<string> {
    return await this.userInfo.textContent() || '';
  }

  /**
   * Check if module is accessible in sidebar
   */
  async isModuleVisible(moduleName: string): Promise<boolean> {
    const navLink = this.page.locator(`[route="${moduleName}-grid"], [href="#${moduleName}-grid"]`);
    return await navLink.isVisible();
  }

  /**
   * Get list of visible modules in sidebar
   */
  async getVisibleModules(): Promise<string[]> {
    const links = this.sidebar.locator('[route], a[href^="#"]');
    const count = await links.count();
    const modules: string[] = [];
    
    for (let i = 0; i < count; i++) {
      const route = await links.nth(i).getAttribute('route') || 
                    await links.nth(i).getAttribute('href');
      if (route) {
        modules.push(route.replace('#', '').replace('-grid', ''));
      }
    }
    
    return modules;
  }

  /**
   * Wait for dashboard data to load
   */
  async waitForDataLoad() {
    // Wait for metrics to populate
    await this.page.waitForFunction(() => {
      const metrics = document.querySelectorAll('.metric-value, .kpi-value');
      return metrics.length > 0;
    }, { timeout: 10000 });
  }
}
