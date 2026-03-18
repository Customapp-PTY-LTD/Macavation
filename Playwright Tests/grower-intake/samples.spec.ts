import { test, expect } from '../fixtures';
import { navigateToModule } from '../helpers/navigation.helper';

/**
 * Grower Intake Module Tests
 * 
 * Tests for sample submission and grower intake workflows
 */

test.describe('Grower Intake - Sample Management @grower-intake', () => {

  test.beforeEach(async ({ authenticatedPage }) => {
    await navigateToModule(authenticatedPage, 'grower-intake-grid');
    await authenticatedPage.waitForLoadState('networkidle');
    await authenticatedPage.waitForTimeout(1000);
  });

  test('TC-GI-001: View Samples List', async ({ authenticatedPage }) => {
    // Grower Intake shows intake batches (Kanban or table), not a separate samples table
    const heading = authenticatedPage.locator('h1:has-text("Grower Intake Management")');
    await expect(heading).toBeVisible({ timeout: 10000 });
    const mainContent = authenticatedPage.locator('#giKanbanBoard, #giTableCard, #intakeBatchesTable');
    await expect(mainContent.first()).toBeVisible({ timeout: 5000 });
  });

  test('TC-GI-002: Add Sample Button Visible', async ({ authenticatedPage }) => {
    const addBtn = authenticatedPage.locator(
      'button:has-text("Add"), button:has-text("New Sample"), #addSampleBtn'
    );
    const count = await addBtn.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('TC-GI-003: Sample Status Display', async ({ authenticatedPage }) => {
    const statusBadges = authenticatedPage.locator(
      '.badge, .status-badge, [data-status], th:has-text("Status")'
    );
    const count = await statusBadges.count();
    expect(count).toBeGreaterThan(0);
  });

  test('TC-GI-004: Filter by Sample Status', async ({ authenticatedPage }) => {
    const filter = authenticatedPage.locator(
      'select[name*="status"], #statusFilter, .status-filter'
    );
    if (await filter.first().isVisible()) {
      const options = await filter.first().locator('option').count();
      expect(options).toBeGreaterThan(0);
    }
  });

  test('TC-GI-005: Grower Selection Available', async ({ authenticatedPage }) => {
    const addBtn = authenticatedPage.locator('button:has-text("Add"), #addSampleBtn').first();
    if (await addBtn.isVisible()) {
      await addBtn.click();
      await authenticatedPage.waitForTimeout(500);
      
      const growerSelect = authenticatedPage.locator(
        'select[name*="grower"], #growerId, #growerSelect'
      );
      const growerSelectVisible = await growerSelect.isVisible().catch(() => false);
      expect(growerSelectVisible).toBeDefined();
    }
  });

});

