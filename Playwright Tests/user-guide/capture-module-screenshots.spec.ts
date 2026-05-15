/**
 * Capture screenshots for WebPortal/help (grids, CRM tabs, modals).
 *
 * Run from repo:  cd "Playwright Tests" && npm run capture-user-guide
 *
 * Requires .env.e2e with valid credentials and BASE_URL (see playwright.config.ts).
 */
import * as fs from 'fs';
import * as path from 'path';
import { test } from '../fixtures';
import {
  getCaptureAction,
  getGridCaptureRoutes,
  getGuideIdsForRoute,
  getTopicCaptureIds,
} from '../helpers/user-guide-capture-actions';
import {
  runCaptureAction,
  screenshotCapture,
} from '../helpers/user-guide-capture.helper';

const SCREENSHOT_DIR = path.join(__dirname, '../../WebPortal/help/assets/screenshots');

test.describe('User guide screenshots @user-guide', () => {
  test.describe.configure({ timeout: 360_000 });

  test.beforeAll(() => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  });

  test('capture grid screenshots', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.waitForLoadState('networkidle');

    for (const route of getGridCaptureRoutes()) {
      const guideIds = getGuideIdsForRoute(route);
      const primary = guideIds[0] || route;
      const primaryPath = path.join(SCREENSHOT_DIR, `${primary}.png`);
      const action = getCaptureAction(primary);
      if (!action || action.skip) {
        console.warn(`[user-guide] skip grid route ${route}:`, action?.skip || 'no action');
        continue;
      }
      try {
        await runCaptureAction(page, action);
        await screenshotCapture(page, action, primaryPath);
        for (let i = 1; i < guideIds.length; i++) {
          fs.copyFileSync(primaryPath, path.join(SCREENSHOT_DIR, `${guideIds[i]}.png`));
        }
        console.log(`[user-guide] grid ${route} → ${primary}.png (+${guideIds.length - 1} copies)`);
      } catch (e) {
        console.warn(`[user-guide] skip route ${route} (${primary}):`, (e as Error).message);
      }
    }
  });

  test('capture topic screenshots (CRM tabs and modals)', async ({ authenticatedPage }) => {
    test.setTimeout(900_000);
    const page = authenticatedPage;
    await page.waitForLoadState('networkidle');

    for (const guideId of getTopicCaptureIds()) {
      const action = getCaptureAction(guideId);
      if (!action) continue;
      if (action.skip) {
        console.warn(`[user-guide] skip topic ${guideId}:`, action.skip);
        continue;
      }
      const outPath = path.join(SCREENSHOT_DIR, `${guideId}.png`);
      try {
        await runCaptureAction(page, action);
        await screenshotCapture(page, action, outPath);
        console.log(`[user-guide] topic ${guideId}`);
      } catch (e) {
        console.warn(`[user-guide] skip topic ${guideId}:`, (e as Error).message);
      }
    }
  });
});
