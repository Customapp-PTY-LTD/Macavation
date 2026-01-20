import { test as base, expect, Page } from '@playwright/test';
import { 
  test as testDataTest, 
  TestDataSet, 
  ContactTestData, 
  SampleTestData, 
  ProductionBatchTestData, 
  OilBatchTestData 
} from './test-data.fixture';
import { TestDataCleanup } from '../helpers/database.helper';

/**
 * Authentication Fixtures for Macavation E2E Tests
 * 
 * Provides authenticated sessions for different user roles
 */

export interface AuthFixtures {
  /** Test data from database */
  testData: TestDataSet;
  
  /** Generate unique contact data */
  generateContact: (overrides?: Partial<ContactTestData>) => ContactTestData;
  
  /** Generate unique sample data */
  generateSample: (overrides?: Partial<SampleTestData>) => SampleTestData;
  
  /** Generate unique batch data */
  generateBatch: (overrides?: Partial<ProductionBatchTestData>) => ProductionBatchTestData;
  
  /** Generate unique oil batch data */
  generateOilBatch: (overrides?: Partial<OilBatchTestData>) => OilBatchTestData;
  
  /** Generate unique ID */
  uniqueId: () => string;
  
  /** Generate unique code with prefix */
  uniqueCode: (prefix: string) => string;
  
  /** Authenticated page for the General Manager role */
  authenticatedPage: Page;
  
  /** Login as Super Admin and return the page */
  loginAsSuperAdmin: () => Promise<Page>;
  
  /** Login as General Manager and return the page */
  loginAsGeneralManager: () => Promise<Page>;
  
  /** Login as Production Manager and return the page */
  loginAsProductionManager: () => Promise<Page>;
  
  /** Login as QA Supervisor and return the page */
  loginAsQASupervisor: () => Promise<Page>;
  
  /** Login as Sales Executive and return the page */
  loginAsSalesExecutive: () => Promise<Page>;
  
  /** Login as Oil Plant Manager and return the page */
  loginAsOilPlantManager: () => Promise<Page>;
  
  /** Login as Office Administrator and return the page */
  loginAsOfficeAdministrator: () => Promise<Page>;
  
  /** Login with custom credentials */
  loginAs: (email: string, password: string) => Promise<Page>;
  
  /** Logout the current user */
  logout: () => Promise<void>;
  
  /** Data cleanup tracker */
  cleanup: TestDataCleanup;
}

// Client GUID for Macavation demo environment
const CLIENT_GUID = process.env.CLIENT_GUID || '9e1d961a-bfc2-469d-8526-8af75f536656';

/**
 * Login helper function
 */
async function performLogin(page: Page, email: string, password: string, expectedRedirect?: string | RegExp): Promise<Page> {
  // Navigate to login page with client GUID
  await page.goto(`/signin.html?cc=${CLIENT_GUID}`);
  
  // Wait for login form to be ready
  await page.waitForSelector('#signinForm', { state: 'visible' });
  
  // Fill in credentials
  await page.fill('#email', email);
  await page.fill('#password', password);
  
  // Click login button (specific to signin form to avoid signup button)
  await page.click('#signinForm button[type="submit"]');
  
  // Wait for navigation
  if (expectedRedirect) {
    await page.waitForURL(expectedRedirect, { timeout: 15000 });
  } else {
    // Wait for any navigation away from signin
    await page.waitForFunction(() => !window.location.pathname.includes('signin'), { timeout: 15000 });
  }
  
  return page;
}

/**
 * Extended test with authentication fixtures
 */
export const test = testDataTest.extend<AuthFixtures>({
  testData: async ({ testData }, use) => {
    await use(testData);
  },
  
  cleanup: async ({}, use) => {
    const cleanup = new TestDataCleanup();
    await use(cleanup);
    // Automatically run cleanup after test
    await cleanup.softCleanup();
  },
  
  authenticatedPage: async ({ page, testData }, use) => {
    // Login as Super Admin by default (has full access)
    const user = testData.users.superAdmin;
    await performLogin(page, user.email, user.password);
    await use(page);
  },
  
  loginAsSuperAdmin: async ({ page, testData }, use) => {
    await use(async () => {
      const user = testData.users.superAdmin;
      return performLogin(page, user.email, user.password);
    });
  },
  
  loginAsGeneralManager: async ({ page, testData }, use) => {
    await use(async () => {
      const user = testData.users.generalManager;
      return performLogin(page, user.email, user.password);
    });
  },
  
  loginAsProductionManager: async ({ page, testData }, use) => {
    await use(async () => {
      const user = testData.users.productionManager;
      return performLogin(page, user.email, user.password);
    });
  },
  
  loginAsQASupervisor: async ({ page, testData }, use) => {
    await use(async () => {
      const user = testData.users.qaSupervsor;
      return performLogin(page, user.email, user.password);
    });
  },
  
  loginAsSalesExecutive: async ({ page, testData }, use) => {
    await use(async () => {
      const user = testData.users.salesExecutive;
      return performLogin(page, user.email, user.password);
    });
  },
  
  loginAsOilPlantManager: async ({ page, testData }, use) => {
    await use(async () => {
      const user = testData.users.oilPlantManager;
      return performLogin(page, user.email, user.password);
    });
  },
  
  loginAsOfficeAdministrator: async ({ page, testData }, use) => {
    await use(async () => {
      const user = testData.users.officeAdministrator;
      return performLogin(page, user.email, user.password);
    });
  },
  
  loginAs: async ({ page }, use) => {
    await use(async (email: string, password: string) => {
      return performLogin(page, email, password);
    });
  },
  
  logout: async ({ page }, use) => {
    await use(async () => {
      // Click logout button or trigger logout
      const logoutButton = page.locator('#logoutBtn, [data-action="logout"], .logout-btn');
      if (await logoutButton.isVisible()) {
        await logoutButton.click();
      } else {
        // Fallback: Clear storage and navigate to login
        await page.evaluate(() => {
          localStorage.clear();
          sessionStorage.clear();
        });
        await page.goto('/signin.html');
      }
      await page.waitForURL(/.*signin.html/);
    });
  },
});

export { expect };

/**
 * Helper to get page with specific role for use outside fixtures
 */
export async function loginWithRole(page: Page, role: 'superAdmin' | 'generalManager' | 'productionManager' | 'qaSupervisor' | 'salesExecutive' | 'oilPlantManager' | 'officeAdministrator', testData: TestDataSet): Promise<Page> {
  const userMap = {
    superAdmin: testData.users.superAdmin,
    generalManager: testData.users.generalManager,
    productionManager: testData.users.productionManager,
    qaSupervisor: testData.users.qaSupervsor,
    salesExecutive: testData.users.salesExecutive,
    oilPlantManager: testData.users.oilPlantManager,
    officeAdministrator: testData.users.officeAdministrator,
  };
  
  const user = userMap[role];
  return performLogin(page, user.email, user.password);
}
