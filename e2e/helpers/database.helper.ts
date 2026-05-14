import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Database helper for direct database access in tests
 * Uses service key for full access - only for test setup/teardown
 */

let supabaseClient: SupabaseClient | null = null;

/**
 * Get Supabase client with service key (admin access)
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (!supabaseClient) {
    const url = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!url || !serviceKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
    }

    supabaseClient = createClient(url, serviceKey);
  }
  return supabaseClient;
}

/**
 * Deletes Playwright user-crud disposable accounts (e2e.*@test.macavation.co.za).
 * Call from test.afterAll so runs do not clutter User & access / Users grids.
 * Requires SUPABASE_URL and SUPABASE_SERVICE_KEY; no-op if unset.
 */
export async function cleanupE2ePlaywrightFixtureUsers(): Promise<void> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return;
  }
  const supabase = getSupabaseAdmin();
  const { data: rows, error } = await supabase
    .from('users')
    .select('id')
    .ilike('email', 'e2e.%@test.macavation.co.za');

  if (error) {
    console.warn('[cleanupE2ePlaywrightFixtureUsers]', error.message);
    return;
  }

  for (const row of rows || []) {
    const { error: delErr } = await supabase.auth.admin.deleteUser(row.id);
    if (delErr) {
      console.warn('[cleanupE2ePlaywrightFixtureUsers] auth.admin.deleteUser', row.id, delErr.message);
    }
  }

  const { error: pubErr } = await supabase.from('users').delete().ilike('email', 'e2e.%@test.macavation.co.za');
  if (pubErr) {
    console.warn('[cleanupE2ePlaywrightFixtureUsers] public.users delete', pubErr.message);
  }
}

/**
 * Interface for test data records from database
 */
export interface E2ETestDataRecord {
  id: string;
  data_set_id: string;
  entity_type: string;
  entity_id?: string;
  data_key: string;
  data_value: Record<string, unknown>;
  purpose?: string;
  cleanup_required: boolean;
}

/**
 * Get test data by set name and key
 */
export async function getTestData(setName: string, dataKey: string): Promise<E2ETestDataRecord | null> {
  const supabase = getSupabaseAdmin();
  
  const { data, error } = await supabase
    .from('e2e_test_data_records')
    .select(`
      *,
      e2e_test_data_sets!inner(set_name)
    `)
    .eq('e2e_test_data_sets.set_name', setName)
    .eq('data_key', dataKey)
    .single();

  if (error) {
    console.warn(`Failed to get test data ${setName}/${dataKey}:`, error.message);
    return null;
  }
  
  return data;
}

/**
 * Get all test data for a module
 */
export async function getTestDataByModule(module: string): Promise<E2ETestDataRecord[]> {
  const supabase = getSupabaseAdmin();
  
  const { data, error } = await supabase
    .from('e2e_test_data_records')
    .select(`
      *,
      e2e_test_data_sets!inner(set_name, module)
    `)
    .eq('e2e_test_data_sets.module', module);

  if (error) {
    console.warn(`Failed to get test data for module ${module}:`, error.message);
    return [];
  }
  
  return data || [];
}

/**
 * Create a test scenario in the database
 */
export async function createTestScenario(data: {
  scenario_code: string;
  scenario_name: string;
  module_name: string;
  feature_name?: string;
  test_type?: string;
  severity_level?: string;
  description?: string;
  preconditions?: string;
  expected_result: string;
}) {
  const supabase = getSupabaseAdmin();
  
  const { data: result, error } = await supabase
    .from('test_scenarios')
    .insert(data)
    .select()
    .single();

  if (error) throw error;
  return result;
}

/**
 * Record a test instance (test run result)
 */
export async function recordTestInstance(data: {
  scenario_id: string;
  run_batch_id?: string;
  environment?: string;
  status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped' | 'blocked' | 'error';
  actual_result?: string;
  error_message?: string;
  duration_ms?: number;
  severity_level_at_run?: string;
  deployment_impact?: string;
}) {
  const supabase = getSupabaseAdmin();
  
  const { data: result, error } = await supabase
    .from('test_instances')
    .insert({
      ...data,
      environment: data.environment || process.env.TEST_ENV || 'local',
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw error;
  return result;
}

/**
 * Create a test run batch
 */
export async function createTestBatch(data: {
  batch_name: string;
  description?: string;
  environment?: string;
  version_tested?: string;
  build_number?: string;
}) {
  const supabase = getSupabaseAdmin();
  
  const { data: result, error } = await supabase
    .from('test_run_batches')
    .insert({
      ...data,
      environment: data.environment || process.env.TEST_ENV || 'local',
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw error;
  return result;
}

/**
 * Update test batch with final results
 */
export async function completeTestBatch(
  batchId: string,
  results: {
    total_tests: number;
    passed_count: number;
    failed_count: number;
    skipped_count: number;
    blocked_count: number;
    error_count: number;
  }
) {
  const supabase = getSupabaseAdmin();
  
  // Calculate overall status and recommendation
  const overallStatus = results.failed_count > 0 || results.error_count > 0 
    ? 'failed' 
    : 'passed';
  
  let deploymentRecommendation = 'proceed';
  if (results.failed_count > 0) {
    // Check if any critical tests failed
    const { data: criticalFails } = await supabase
      .from('test_instances')
      .select('id, severity_level_at_run')
      .eq('run_batch_id', batchId)
      .eq('status', 'failed')
      .eq('severity_level_at_run', 'critical');
    
    if (criticalFails && criticalFails.length > 0) {
      deploymentRecommendation = 'block';
    } else {
      deploymentRecommendation = 'hold';
    }
  }

  const { data: result, error } = await supabase
    .from('test_run_batches')
    .update({
      ...results,
      overall_status: overallStatus,
      deployment_recommendation: deploymentRecommendation,
      completed_at: new Date().toISOString(),
    })
    .eq('id', batchId)
    .select()
    .single();

  if (error) throw error;
  return result;
}

/**
 * Get scenario by code
 */
export async function getScenarioByCode(scenarioCode: string) {
  const supabase = getSupabaseAdmin();
  
  const { data, error } = await supabase
    .from('test_scenarios')
    .select('*')
    .eq('scenario_code', scenarioCode)
    .single();

  if (error) throw error;
  return data;
}

/**
 * Clean up test data created during tests
 */
export async function cleanupTestData(table: string, ids: string[]) {
  if (ids.length === 0) return;
  
  const supabase = getSupabaseAdmin();
  
  const { error } = await supabase
    .from(table)
    .delete()
    .in('id', ids);

  if (error) {
    console.warn(`Failed to cleanup ${table}:`, error.message);
  }
}

/**
 * Soft delete test data (set is_active = false)
 */
export async function softDeleteTestData(table: string, ids: string[]) {
  if (ids.length === 0) return;
  
  const supabase = getSupabaseAdmin();
  
  const { error } = await supabase
    .from(table)
    .update({ is_active: false })
    .in('id', ids);

  if (error) {
    console.warn(`Failed to soft delete ${table}:`, error.message);
  }
}

/**
 * Get user by email
 */
export async function getUserByEmail(email: string) {
  const supabase = getSupabaseAdmin();
  
  const { data, error } = await supabase
    .from('Users')
    .select('*, UserRoles(*)')
    .eq('email', email)
    .single();

  if (error) throw error;
  return data;
}

/**
 * Create a test user
 */
export async function createTestUser(data: {
  email: string;
  full_name?: string;
  role_id?: string;
  is_active?: boolean;
}) {
  const supabase = getSupabaseAdmin();
  
  const { data: result, error } = await supabase
    .from('Users')
    .insert({
      email: data.email,
      full_name: data.full_name || 'E2E Test User',
      role_id: data.role_id,
      is_active: data.is_active !== false,
    })
    .select()
    .single();

  if (error) throw error;
  return result;
}

/**
 * Get contacts for testing
 */
export async function getTestContacts(limit = 10, contactType?: string) {
  const supabase = getSupabaseAdmin();
  
  let query = supabase
    .from('contacts')
    .select('*')
    .eq('is_active', true);
    
  if (contactType) {
    query = query.eq('contact_type', contactType);
  }
  
  const { data, error } = await query.limit(limit);

  if (error) throw error;
  return data;
}

/**
 * Create a test contact
 */
export async function createTestContact(data: {
  company_name: string;
  contact_type: 'customer' | 'supplier' | 'grower' | 'both';
  primary_contact_name?: string;
  primary_contact_email?: string;
  status?: string;
  farm_name?: string;
  cultivar?: string;
}) {
  const supabase = getSupabaseAdmin();
  
  const { data: result, error } = await supabase
    .from('contacts')
    .insert({
      ...data,
      status: data.status || 'active',
      is_active: true,
    })
    .select()
    .single();

  if (error) throw error;
  return result;
}

/**
 * Get production batches for testing
 */
export async function getTestBatches(limit = 10, status?: string) {
  const supabase = getSupabaseAdmin();
  
  let query = supabase
    .from('production_batches')
    .select('*')
    .eq('is_active', true);
    
  if (status) {
    query = query.eq('status', status);
  }
  
  const { data, error } = await query.limit(limit);

  if (error) throw error;
  return data;
}

/**
 * Create a test production batch
 */
export async function createTestProductionBatch(data: {
  batch_number?: string;
  nis_weight_kg: number;
  grower_id?: string;
  mrd_id?: string;
  status?: string;
}) {
  const supabase = getSupabaseAdmin();
  
  // Generate batch number if not provided
  const batchNumber = data.batch_number || `KB-E2E-${Date.now().toString(36).toUpperCase()}`;
  
  const { data: result, error } = await supabase
    .from('production_batches')
    .insert({
      batch_number: batchNumber,
      nis_weight_kg: data.nis_weight_kg,
      grower_id: data.grower_id,
      mrd_id: data.mrd_id,
      status: data.status || 'receiving',
      current_step: 1,
      is_active: true,
    })
    .select()
    .single();

  if (error) throw error;
  return result;
}

/**
 * Get sample submissions for testing
 */
export async function getTestSamples(limit = 10, status?: string) {
  const supabase = getSupabaseAdmin();
  
  let query = supabase
    .from('sample_submissions')
    .select('*, contacts!sample_submissions_grower_id_fkey(company_name)')
    .eq('is_active', true);
    
  if (status) {
    query = query.eq('status', status);
  }
  
  const { data, error } = await query.limit(limit);

  if (error) throw error;
  return data;
}

/**
 * Create a test sample submission
 */
export async function createTestSample(data: {
  grower_id: string;
  sample_weight_kg: number;
  cultivar?: string;
  status?: string;
}) {
  const supabase = getSupabaseAdmin();
  
  const sampleCode = `SAMP-E2E-${Date.now().toString(36).toUpperCase()}`;
  
  const { data: result, error } = await supabase
    .from('sample_submissions')
    .insert({
      sample_code: sampleCode,
      grower_id: data.grower_id,
      sample_weight_kg: data.sample_weight_kg,
      cultivar: data.cultivar || 'Beaumont',
      status: data.status || 'pending',
      is_active: true,
    })
    .select()
    .single();

  if (error) throw error;
  return result;
}

/**
 * Get oil production batches for testing
 */
export async function getTestOilBatches(limit = 10, status?: string) {
  const supabase = getSupabaseAdmin();
  
  let query = supabase
    .from('oil_production_batches')
    .select('*')
    .eq('is_active', true);
    
  if (status) {
    query = query.eq('status', status);
  }
  
  const { data, error } = await query.limit(limit);

  if (error) throw error;
  return data;
}

/**
 * Create a test oil batch
 */
export async function createTestOilBatch(data: {
  kernel_input_kg: number;
  kernel_batch_ids?: string[];
  status?: string;
}) {
  const supabase = getSupabaseAdmin();
  
  const batchNumber = `OB-E2E-${Date.now().toString(36).toUpperCase()}`;
  
  const { data: result, error } = await supabase
    .from('oil_production_batches')
    .insert({
      batch_number: batchNumber,
      kernel_input_kg: data.kernel_input_kg,
      kernel_batch_ids: data.kernel_batch_ids,
      status: data.status || 'preparation',
      current_step: 1,
      is_active: true,
    })
    .select()
    .single();

  if (error) throw error;
  return result;
}

/**
 * Get stock items for testing
 */
export async function getTestStockItems(limit = 10, productType?: string) {
  const supabase = getSupabaseAdmin();
  
  let query = supabase
    .from('stock_items')
    .select('*')
    .eq('is_active', true);
    
  if (productType) {
    query = query.eq('product_type', productType);
  }
  
  const { data, error } = await query.limit(limit);

  if (error) throw error;
  return data;
}

/**
 * Create a test stock item
 */
export async function createTestStockItem(data: {
  product_type: 'kernel' | 'oil' | 'oil_cake';
  style?: string;
  grade?: string;
  quantity_kg: number;
  location: string;
  production_batch_id?: string;
  oil_batch_id?: string;
}) {
  const supabase = getSupabaseAdmin();
  
  const stockCode = `STK-E2E-${Date.now().toString(36).toUpperCase()}`;
  
  const { data: result, error } = await supabase
    .from('stock_items')
    .insert({
      stock_code: stockCode,
      product_type: data.product_type,
      style: data.style || 'Style 0',
      grade: data.grade || 'Standard',
      quantity_kg: data.quantity_kg,
      available_kg: data.quantity_kg,
      location: data.location,
      production_batch_id: data.production_batch_id,
      oil_batch_id: data.oil_batch_id,
      status: 'available',
      is_active: true,
    })
    .select()
    .single();

  if (error) throw error;
  return result;
}

/**
 * Get quality tests for testing
 */
export async function getTestQualityTests(limit = 10, entityType?: string) {
  const supabase = getSupabaseAdmin();
  
  let query = supabase
    .from('quality_tests')
    .select('*')
    .eq('is_active', true);
    
  if (entityType) {
    query = query.eq('entity_type', entityType);
  }
  
  const { data, error } = await query.limit(limit);

  if (error) throw error;
  return data;
}

/**
 * Create a test quality test record
 */
export async function createTestQualityTest(data: {
  test_type: string;
  entity_type: 'production_batch' | 'oil_production_batch' | 'sample';
  entity_id?: string;
  batch_number?: string;
  result_status?: string;
  moisture_percentage?: number;
  ffa_percentage?: number;
}) {
  const supabase = getSupabaseAdmin();
  
  const testCode = `QT-E2E-${Date.now().toString(36).toUpperCase()}`;
  
  const { data: result, error } = await supabase
    .from('quality_tests')
    .insert({
      test_code: testCode,
      test_type: data.test_type,
      entity_type: data.entity_type,
      entity_id: data.entity_id,
      batch_number: data.batch_number,
      result_status: data.result_status || 'pending',
      moisture_percentage: data.moisture_percentage,
      ffa_percentage: data.ffa_percentage,
      is_active: true,
    })
    .select()
    .single();

  if (error) throw error;
  return result;
}

/**
 * Cleanup tracker for test data created during a test run
 */
export class TestDataCleanup {
  private cleanupTasks: Array<{ table: string; ids: string[] }> = [];
  
  /**
   * Track an entity for cleanup
   */
  track(table: string, id: string) {
    const existing = this.cleanupTasks.find(t => t.table === table);
    if (existing) {
      existing.ids.push(id);
    } else {
      this.cleanupTasks.push({ table, ids: [id] });
    }
  }
  
  /**
   * Execute cleanup for all tracked entities
   */
  async cleanup() {
    for (const task of this.cleanupTasks.reverse()) {
      await cleanupTestData(task.table, task.ids);
    }
    this.cleanupTasks = [];
  }
  
  /**
   * Execute soft delete for all tracked entities
   */
  async softCleanup() {
    for (const task of this.cleanupTasks.reverse()) {
      await softDeleteTestData(task.table, task.ids);
    }
    this.cleanupTasks = [];
  }
}
