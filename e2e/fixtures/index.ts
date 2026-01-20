/**
 * Macavation E2E Test Fixtures
 * 
 * This file exports all fixtures for easy importing in tests.
 * 
 * Usage in tests:
 * ```typescript
 * import { test, expect } from '../fixtures';
 * 
 * test('my test', async ({ authenticatedPage, testData, generateContact }) => {
 *   // Use authenticated page, test data, and generators
 * });
 * ```
 */

import { test as base, expect } from '@playwright/test';
import { 
  TestDataFixtures, 
  TestDataSet,
  ContactTestData,
  SampleTestData,
  ProductionBatchTestData,
  OilBatchTestData,
  test as testDataTest 
} from './test-data.fixture';
import { AuthFixtures, test as authTest } from './auth.fixture';

// Combined fixtures interface
interface CombinedFixtures extends TestDataFixtures, AuthFixtures {}

// Re-export the combined test with all fixtures
export const test = authTest;

export { expect };

// Export types for test data
export type {
  TestDataSet,
  ContactTestData,
  SampleTestData,
  ProductionBatchTestData,
  OilBatchTestData,
  TestDataFixtures,
  AuthFixtures,
};

// Re-export types from test-data.fixture
export type {
  UserTestData,
  QualityTestData,
  StockItemTestData,
  PaymentCalculationTestData,
  QualityThresholds,
} from './test-data.fixture';

// Export utility functions
export { loginWithRole } from './auth.fixture';

// Export database helpers for advanced use cases
export {
  getSupabaseAdmin,
  getTestData,
  getTestDataByModule,
  createTestScenario,
  recordTestInstance,
  createTestBatch as createTestRunBatch,
  completeTestBatch as completeTestRunBatch,
  getScenarioByCode,
  cleanupTestData,
  softDeleteTestData,
  getUserByEmail,
  createTestUser,
  getTestContacts,
  createTestContact,
  getTestBatches,
  createTestProductionBatch,
  getTestSamples,
  createTestSample,
  getTestOilBatches,
  createTestOilBatch,
  getTestStockItems,
  createTestStockItem,
  getTestQualityTests,
  createTestQualityTest,
  TestDataCleanup,
} from '../helpers/database.helper';
