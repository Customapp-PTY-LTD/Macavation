/**
 * Capture #content-area screenshots for docs/user-guide.html (one PNG per guide section id).
 *
 * Run from repo:  cd e2e && npx playwright test tests/user-guide/capture-module-screenshots.spec.ts
 *
 * Requires .env.e2e with valid credentials and BASE_URL (see playwright.config.ts).
 * Uses the Playwright test runner (CLI), not the Playwright MCP browser tool.
 */
import * as fs from 'fs';
import * as path from 'path';
import { test } from '../../fixtures';
import { navigateToModule } from '../../helpers/navigation.helper';
import { GUIDE_TO_APP_ROUTE } from '../../helpers/user-guide-screenshot-routes';

const SCREENSHOT_DIR = path.join(__dirname, '../../../WebPortal/help/assets/screenshots');

test.describe('User guide screenshots @user-guide', () => {
  test.describe.configure({ timeout: 240_000 });

  test('capture module screenshots for docs', async ({ authenticatedPage }) => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

    await authenticatedPage.waitForLoadState('networkidle');
    const content = authenticatedPage.locator('#content-area').first();

    const byRoute = new Map<string, string[]>();
    for (const [guideId, route] of Object.entries(GUIDE_TO_APP_ROUTE)) {
      if (route == null) continue;
      if (!byRoute.has(route)) byRoute.set(route, []);
      byRoute.get(route)!.push(guideId);
    }

    for (const [route, guideIds] of byRoute) {
      const primary = guideIds[0];
      const primaryPath = path.join(SCREENSHOT_DIR, `${primary}.png`);
      try {
        await navigateToModule(authenticatedPage, route);
        await content.waitFor({ state: 'visible', timeout: 20000 });
        await authenticatedPage.waitForTimeout(600);
        await content.screenshot({ path: primaryPath, animations: 'disabled' });
        for (let i = 1; i < guideIds.length; i++) {
          const dest = path.join(SCREENSHOT_DIR, `${guideIds[i]}.png`);
          fs.copyFileSync(primaryPath, dest);
        }
      } catch (e) {
        console.warn(`[user-guide] skip route ${route} (${primary}):`, (e as Error).message);
      }
    }
  });
});
