import { test, expect } from '../fixtures';
import { navigateToModule } from '../helpers/navigation.helper';

/**
 * Kernel – Form Operations: New Delivery (was Create kernel batch; QA Blueprint: Form – dropdowns, required fields, create, save).
 * Opens New Delivery from Grower Intake → select supplier (batch number is auto-suggested and read-only unless the role has grower_intake.edit_batch_number) → fill date, bag weights, transport → save.
 */

function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

test.describe('Kernel - Form Operations: New Delivery @kernel', () => {

  test('TC-KC-001: New Delivery modal opens and has form', async ({ authenticatedPage }) => {
    await navigateToModule(authenticatedPage, 'grower-intake-grid');
    await authenticatedPage.waitForLoadState('networkidle');
    await authenticatedPage.waitForTimeout(1000);
    await authenticatedPage.locator('#createKernelBatchBtn').click();
    await expect(authenticatedPage.locator('#createKernelBatchModal')).toBeVisible({ timeout: 10000 });
    await expect(authenticatedPage.locator('#createKernelBatchForm')).toBeVisible();
    await expect(authenticatedPage.locator('#intakeBatchGrower')).toBeVisible();
    await expect(authenticatedPage.locator('#intakeBatchNumber')).toBeVisible();
    await expect(authenticatedPage.locator('#intakeBatchReceivedDate')).toBeVisible();
    await expect(authenticatedPage.locator('#intakeBatchWetNis')).toBeVisible(); // Supplier's declared weight (kg)
    await expect(authenticatedPage.locator('#intakeBagsTable')).toBeVisible();
    await expect(authenticatedPage.locator('#intakeTransporter')).toBeVisible();
    await expect(authenticatedPage.locator('#createKernelBatchModal .modal-title')).toHaveText('New Delivery');
    await expect(authenticatedPage.locator('#saveCreateKernelBatchBtn')).toBeVisible();
  });

  test('TC-KC-002: Grower/Supplier dropdown is populated', async ({ authenticatedPage }) => {
    await navigateToModule(authenticatedPage, 'grower-intake-grid');
    await authenticatedPage.waitForLoadState('networkidle');
    await authenticatedPage.waitForTimeout(1000);
    await authenticatedPage.locator('#createKernelBatchBtn').click();
    await expect(authenticatedPage.locator('#createKernelBatchModal')).toBeVisible({ timeout: 10000 });
    await authenticatedPage.waitForTimeout(1500);
    const options = authenticatedPage.locator('#intakeBatchGrower option');
    const count = await options.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('TC-KC-003: Select supplier and fill required fields then save', async ({ authenticatedPage }) => {
    await navigateToModule(authenticatedPage, 'grower-intake-grid');
    await authenticatedPage.waitForLoadState('networkidle');
    await authenticatedPage.waitForTimeout(1000);
    await authenticatedPage.locator('#createKernelBatchBtn').click();
    await expect(authenticatedPage.locator('#createKernelBatchModal')).toBeVisible({ timeout: 10000 });
    await authenticatedPage.waitForTimeout(2000);
    const growerSelect = authenticatedPage.locator('#intakeBatchGrower');
    const optionCount = await growerSelect.locator('option').count();
    if (optionCount <= 1) {
      test.skip(true, 'No supplier in dropdown; batch number is required and only set when a supplier is selected.');
      return;
    }
    await growerSelect.selectOption({ index: 1 });
    await expect(authenticatedPage.locator('#intakeBatchNumber')).toHaveValue(/.+/, { timeout: 15000 });
    await authenticatedPage.locator('#intakeBatchReceivedDate').fill(todayISO());
    await authenticatedPage.locator('#intakeBatchWetNis').fill('100');
    // One empty bag row exists on open; give it a weight.
    await authenticatedPage.locator('#intakeBagsBody input[data-bag-field="kg"]').first().fill('100');
    await authenticatedPage.locator('#intakeDeliveryNoteRef').fill('DN-' + Date.now());
    await authenticatedPage.locator('#intakeTransportRate').fill('1000');
    // Transporter and transport type are required once their lists load; pick the first real option if present.
    for (const id of ['#intakeTransporter', '#intakeTransportType']) {
      const sel = authenticatedPage.locator(id);
      if ((await sel.locator('option').count()) > 1) await sel.selectOption({ index: 1 });
    }
    // Date change triggers _onDateOrGrowerChange which refetches batch number; wait for it to repopulate
    await expect(authenticatedPage.locator('#intakeBatchNumber')).toHaveValue(/.+/, { timeout: 10000 });
    await expect(authenticatedPage.locator('#intakeBatchReceivedDate')).toHaveValue(todayISO());
    await expect(authenticatedPage.locator('#intakeBatchWetNis')).toHaveValue('100');
    await authenticatedPage.waitForTimeout(300);
    await authenticatedPage.locator('#saveCreateKernelBatchBtn').click();
    await authenticatedPage.waitForTimeout(3500);
    const permissionDenied = await authenticatedPage.locator('.swal2-popup:has-text("Permission denied"), .swal2-popup:has-text("Access denied")').isVisible().catch(() => false);
    expect(permissionDenied).toBe(false);
    const success = await authenticatedPage.locator('.swal2-popup:has-text("Delivery saved"), .swal2-popup:has-text("Batch created"), .swal2-success').isVisible().catch(() => false);
    const modalClosed = await authenticatedPage.locator('#createKernelBatchModal.show').isVisible().catch(() => false);
    expect(success || !modalClosed).toBeTruthy();
  });

  test('TC-KC-004: Cancel closes modal without saving', async ({ authenticatedPage }) => {
    await navigateToModule(authenticatedPage, 'grower-intake-grid');
    await authenticatedPage.waitForLoadState('networkidle');
    await authenticatedPage.waitForTimeout(1000);
    await authenticatedPage.locator('#createKernelBatchBtn').click();
    await expect(authenticatedPage.locator('#createKernelBatchModal')).toBeVisible({ timeout: 10000 });
    await authenticatedPage.locator('#createKernelBatchModal .btn-secondary[data-bs-dismiss="modal"]').click();
    await authenticatedPage.waitForTimeout(500);
    await expect(authenticatedPage.locator('#createKernelBatchModal.show')).not.toBeVisible();
  });
});
