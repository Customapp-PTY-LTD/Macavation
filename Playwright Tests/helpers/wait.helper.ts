import { Page, Locator } from '@playwright/test';

/**
 * Wait helper utilities for E2E tests
 */

/**
 * Wait for network to be idle (no pending requests)
 */
export async function waitForNetworkIdle(page: Page, timeout = 5000): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout });
}

/**
 * Wait for API response containing specific data
 */
export async function waitForApiResponse(
  page: Page,
  urlPattern: string | RegExp,
  timeout = 10000
): Promise<any> {
  const response = await page.waitForResponse(
    (resp) => {
      if (typeof urlPattern === 'string') {
        return resp.url().includes(urlPattern);
      }
      return urlPattern.test(resp.url());
    },
    { timeout }
  );
  return response.json();
}

/**
 * Wait for element to contain specific text
 */
export async function waitForText(
  page: Page,
  selector: string,
  text: string,
  timeout = 10000
): Promise<void> {
  await page.waitForSelector(selector, { timeout });
  await page.waitForFunction(
    ({ sel, txt }) => {
      const el = document.querySelector(sel);
      return el && el.textContent?.includes(txt);
    },
    { sel: selector, txt: text },
    { timeout }
  );
}

/**
 * Wait for table to have at least N rows
 */
export async function waitForTableRows(
  page: Page,
  tableSelector: string,
  minRows: number,
  timeout = 10000
): Promise<void> {
  await page.waitForFunction(
    ({ sel, min }) => {
      const table = document.querySelector(sel);
      if (!table) return false;
      const rows = table.querySelectorAll('tbody tr');
      return rows.length >= min;
    },
    { sel: tableSelector, min: minRows },
    { timeout }
  );
}

/**
 * Wait for loading indicator to disappear
 */
export async function waitForLoadingComplete(
  page: Page,
  loadingSelector = '.loading, .spinner, [data-loading]',
  timeout = 30000
): Promise<void> {
  try {
    // First check if loading indicator exists
    const loading = await page.$(loadingSelector);
    if (loading) {
      // Wait for it to disappear
      await page.waitForSelector(loadingSelector, { 
        state: 'hidden',
        timeout 
      });
    }
  } catch {
    // Loading indicator might never appear, which is fine
  }
}

/**
 * Wait for toast/notification message
 */
export async function waitForToast(
  page: Page,
  message?: string,
  timeout = 5000
): Promise<string> {
  const toastSelector = '.toast, .notification, .alert, [role="alert"]';
  
  await page.waitForSelector(toastSelector, { timeout });
  
  const toast = page.locator(toastSelector).first();
  const text = await toast.textContent() || '';
  
  if (message && !text.includes(message)) {
    throw new Error(`Toast message "${text}" does not contain "${message}"`);
  }
  
  return text;
}

/**
 * Wait for modal to open
 */
export async function waitForModal(
  page: Page,
  modalSelector = '.modal, [role="dialog"]',
  timeout = 5000
): Promise<Locator> {
  await page.waitForSelector(modalSelector, { 
    state: 'visible',
    timeout 
  });
  return page.locator(modalSelector).first();
}

/**
 * Wait for modal to close
 */
export async function waitForModalClose(
  page: Page,
  modalSelector = '.modal, [role="dialog"]',
  timeout = 5000
): Promise<void> {
  await page.waitForSelector(modalSelector, { 
    state: 'hidden',
    timeout 
  });
}

/**
 * Retry an action until it succeeds or times out
 */
export async function retry<T>(
  action: () => Promise<T>,
  maxAttempts = 3,
  delayMs = 1000
): Promise<T> {
  let lastError: Error | undefined;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await action();
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
  
  throw lastError;
}

/**
 * Wait for page URL to match pattern
 */
export async function waitForUrlPattern(
  page: Page,
  pattern: string | RegExp,
  timeout = 10000
): Promise<void> {
  await page.waitForURL(pattern, { timeout });
}

/**
 * Wait for specific number of elements
 */
export async function waitForElementCount(
  page: Page,
  selector: string,
  count: number,
  timeout = 10000
): Promise<void> {
  await page.waitForFunction(
    ({ sel, cnt }) => {
      const elements = document.querySelectorAll(sel);
      return elements.length === cnt;
    },
    { sel: selector, cnt: count },
    { timeout }
  );
}
