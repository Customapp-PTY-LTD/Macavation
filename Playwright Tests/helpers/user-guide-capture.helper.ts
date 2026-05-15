import { Locator, Page } from '@playwright/test';
import { navigateToModule } from './navigation.helper';

export type CaptureKind = 'grid' | 'crm-tab' | 'modal' | 'svg-only';

export interface CaptureAction {
  route: string;
  kind: CaptureKind;
  tabSelector?: string;
  openSelector?: string;
  modalSelector?: string;
  /** Navigate here before open (e.g. end-sample modals on kernel production). */
  prepareRoute?: string;
  /** Bootstrap tab on admin-grid: people | roles */
  adminTab?: 'people' | 'roles';
  skip?: string;
}

export async function closeVisibleModal(page: Page): Promise<void> {
  const close = page.locator('.modal.show .btn-close, .modal.show [data-bs-dismiss="modal"]').first();
  if (await close.isVisible().catch(() => false)) {
    await close.click({ timeout: 3000 }).catch(() => {});
    await page.waitForSelector('.modal.show', { state: 'hidden', timeout: 8000 }).catch(() => {});
  }
}

export async function waitForModal(page: Page, modalSelector: string): Promise<Locator> {
  const modal = page.locator(`${modalSelector}.show`).first();
  await modal.waitFor({ state: 'visible', timeout: 20000 });
  await page
    .locator(`${modalSelector}.show .modal-dialog, ${modalSelector}.show .modal-content`)
    .first()
    .waitFor({ state: 'visible', timeout: 15000 })
    .catch(() => {});
  await page.waitForTimeout(400);
  return modal;
}

async function dismissBlockingOverlays(page: Page): Promise<void> {
  const swalConfirm = page.locator('.swal2-container.swal2-backdrop-show button.swal2-confirm');
  if (await swalConfirm.isVisible({ timeout: 1500 }).catch(() => false)) {
    await swalConfirm.click().catch(() => {});
    await page.waitForTimeout(300);
  }
}

async function clickFirstIfVisible(page: Page, selector: string): Promise<boolean> {
  await dismissBlockingOverlays(page);
  const el = page.locator(selector).first();
  if (await el.isVisible({ timeout: 8000 }).catch(() => false)) {
    await el.click();
    return true;
  }
  return false;
}

async function prepareAdminTab(page: Page, tab: 'people' | 'roles'): Promise<void> {
  const sel = tab === 'people' ? '#users-tab' : '#roles-tab';
  await clickFirstIfVisible(page, sel);
  await page.waitForTimeout(500);
}

export async function runCaptureAction(page: Page, action: CaptureAction): Promise<void> {
  if (action.kind === 'svg-only') return;

  const route = action.prepareRoute || action.route;
  await navigateToModule(page, route);

  if (action.route === 'admin-grid' && action.adminTab) {
    await prepareAdminTab(page, action.adminTab);
  }

  if (action.kind === 'crm-tab' && action.tabSelector) {
    await clickFirstIfVisible(page, action.tabSelector);
    await page.waitForTimeout(600);
    return;
  }

  if (action.kind === 'modal') {
    if (action.openSelector) {
      const opened = await clickFirstIfVisible(page, action.openSelector);
      if (!opened) throw new Error(`Open control not found: ${action.openSelector}`);
    }
    if (action.modalSelector) {
      await waitForModal(page, action.modalSelector);
    }
  }
}

export async function screenshotCapture(
  page: Page,
  action: CaptureAction,
  outputPath: string
): Promise<void> {
  if (action.kind === 'svg-only') return;

  let target: Locator;
  if (action.kind === 'modal' && action.modalSelector) {
    target = page.locator(`${action.modalSelector}.show`).first();
  } else {
    target = page.locator('#content-area').first();
    await target.waitFor({ state: 'visible', timeout: 20000 });
  }

  await page.waitForTimeout(400);
  await target.screenshot({ path: outputPath, animations: 'disabled' });

  if (action.kind === 'modal') {
    await closeVisibleModal(page);
  }
}
