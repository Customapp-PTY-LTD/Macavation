import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env.e2e
dotenv.config({ path: path.join(__dirname, '.env.e2e') });

/**
 * Playwright configuration for Macavation E2E tests
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests',
  
  /* Run tests in files in parallel */
  fullyParallel: false, // Disable parallel for more reliable test execution
  
  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: !!process.env.CI,
  
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  
  /* Limit workers for more stable execution */
  workers: 1,
  
  /* Reporter to use */
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
    // Custom Supabase reporter to store test results in database
    ['./reporters/supabase.reporter.ts'],
  ],
  
  /* Shared settings for all the projects below */
  use: {
    /* Base URL for the application - uses demo environment by default */
    baseURL: process.env.BASE_URL || 'https://demo-macavation.customapp.org',
    
    /* Collect trace when retrying the failed test */
    trace: 'on-first-retry',
    
    /* Screenshot on failure */
    screenshot: 'only-on-failure',
    
    /* Video on failure */
    video: 'on-first-retry',
    
    /* Default timeout for actions */
    actionTimeout: 15000,
    
    /* Default navigation timeout */
    navigationTimeout: 30000,
  },

  /* Configure projects for major browsers - run only Chromium for faster testing */
  projects: [
    {
      name: 'chromium',
      use: { 
        ...devices['Desktop Chrome'],
        // No storageState - tests handle their own authentication via fixtures
      },
    },

    // Uncomment to run on other browsers:
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
  ],

  /* Run your local dev server before starting the tests */
  // Uncomment this if you want Playwright to start the server automatically:
  // webServer: {
  //   command: 'npx serve -l 5500 ..',
  //   url: 'http://localhost:5500',
  //   reuseExistingServer: !process.env.CI,
  //   timeout: 120000,
  // },

  /* Global timeout for each test */
  timeout: 60000,
  
  /* Expect timeout */
  expect: {
    timeout: 10000,
  },
});
