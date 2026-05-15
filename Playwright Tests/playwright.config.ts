import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env.e2e
dotenv.config({ path: path.join(__dirname, '.env.e2e') });

/**
 * Playwright configuration for Macavation E2E tests
 * QA Blueprint: tests live under Playwright Tests/{module-name}/{module-name}.spec.ts
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  /* Blueprint: module specs under Playwright Tests/{module-name}/ */
  testDir: '.',

  /* Run tests in files in parallel */
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,

  reporter: [
    ['html', { open: process.env.CI ? 'never' : 'on-failure' }],
    ['list'],
    ['./reporters/supabase.reporter.ts'],
  ],

  use: {
    baseURL: process.env.BASE_URL || 'https://demo-macavation.customapp.org',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  timeout: 60000,
  expect: { timeout: 10000 },
});
