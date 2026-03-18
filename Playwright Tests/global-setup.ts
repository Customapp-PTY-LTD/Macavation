import { chromium, FullConfig } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables from .env.e2e
dotenv.config({ path: path.join(__dirname, '.env.e2e') });

/**
 * Global setup for Playwright tests
 * - Loads environment variables
 * - Creates authenticated state for reuse across tests
 * - Sets up test environment
 */

async function globalSetup(config: FullConfig) {
  console.log('🚀 Starting global setup...');
  
  // Verify environment is configured
  if (!process.env.SUPABASE_URL) {
    console.warn('⚠️  SUPABASE_URL not set - database features will use fallback data');
  }
  
  // Ensure auth directory exists
  const authDir = path.join(__dirname, 'playwright', '.auth');
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Get base URL from config
    const baseURL = config.projects[0]?.use?.baseURL || 'http://localhost:5500';
    
    console.log(`📍 Base URL: ${baseURL}`);

    // Navigate to login page
    await page.goto(`${baseURL}/signin.html`);
    
    // Wait for login form to be ready
    await page.waitForSelector('#email, #loginForm', { timeout: 10000 });

    // Login with default test user
    const email = process.env.TEST_SUPER_USER_EMAIL || 'superuser@macavation.co.za';
    const password = process.env.TEST_SUPER_USER_PASSWORD || 'testpassword';

    console.log(`🔐 Logging in as: ${email}`);

    await page.fill('#email', email);
    await page.fill('#password', password);
    await page.click('button[type="submit"], #loginBtn');

    // Wait for successful login - redirect to main page
    await page.waitForURL(/index\.html|#dashboard/, { timeout: 30000 });
    
    // Wait for the page to fully load
    await page.waitForSelector('.sidebar, #mainContent, .user-info', { timeout: 10000 });

    console.log('✅ Login successful');

    // Save authentication state
    await context.storageState({ path: path.join(authDir, 'user.json') });
    
    console.log('💾 Authentication state saved');

  } catch (error) {
    console.error('❌ Global setup failed:', error);
    
    // Take screenshot for debugging
    await page.screenshot({ 
      path: path.join(__dirname, 'test-results', 'setup-failure.png'),
      fullPage: true 
    });
    
    throw error;
  } finally {
    await browser.close();
  }

  console.log('✅ Global setup complete');
}

export default globalSetup;
