import { Page, Locator, expect } from '@playwright/test';

/**
 * Page Object Model for Login Page
 */
export class LoginPage {
  readonly page: Page;
  
  // Locators
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly loginButton: Locator;
  readonly errorMessage: Locator;
  readonly forgotPasswordLink: Locator;
  readonly googleLoginButton: Locator;

  constructor(page: Page) {
    this.page = page;
    
    this.emailInput = page.locator('#email');
    this.passwordInput = page.locator('#password');
    // Use specific selector for signin form to avoid signup button
    this.loginButton = page.locator('#signinForm button[type="submit"]');
    this.errorMessage = page.locator('.swal2-popup, .error-message, .alert-danger, #errorMessage, .toast-error');
    this.forgotPasswordLink = page.locator('a[href*="forgot"], #forgotPasswordLink, .forgot-password');
    this.googleLoginButton = page.locator('#googleLogin, .google-btn, .btn-google');
  }

  /**
   * Navigate to login page
   */
  async goto() {
    await this.page.goto('/signin.html');
    await this.page.waitForSelector('#signinForm', { state: 'visible' });
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Login with email and password
   */
  async login(email: string, password: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.loginButton.click();
  }

  /**
   * Login and wait for successful redirect
   */
  async loginAndWait(email: string, password: string) {
    await this.login(email, password);
    await this.page.waitForURL(/index\.html|#dashboard/, { timeout: 30000 });
  }

  /**
   * Assert login error is displayed
   */
  async expectError(message?: string) {
    await expect(this.errorMessage).toBeVisible();
    if (message) {
      await expect(this.errorMessage).toContainText(message);
    }
  }

  /**
   * Assert user is on login page
   */
  async expectOnLoginPage() {
    await expect(this.emailInput).toBeVisible();
    await expect(this.passwordInput).toBeVisible();
  }

  /**
   * Clear login form
   */
  async clearForm() {
    await this.emailInput.clear();
    await this.passwordInput.clear();
  }

  /**
   * Get error message text
   */
  async getErrorText(): Promise<string> {
    return await this.errorMessage.textContent() || '';
  }

  /**
   * Check if login button is disabled
   */
  async isLoginDisabled(): Promise<boolean> {
    return await this.loginButton.isDisabled();
  }

  /**
   * Click forgot password link
   */
  async clickForgotPassword() {
    await this.forgotPasswordLink.click();
  }
}
