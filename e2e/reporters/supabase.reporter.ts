import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Custom Playwright Reporter that stores test results in Supabase
 * 
 * This reporter saves:
 * - Test run batches (test_run_batches table)
 * - Individual test instances (test_instances table)
 * 
 * Requires SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables.
 */

interface TestInstanceData {
  scenario_id?: string;
  scenario_code: string;
  run_batch_id?: string;
  environment: string;
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
  status: 'passed' | 'failed' | 'skipped' | 'timedOut';
  actual_result?: string;
  error_message?: string;
  error_stack?: string;
  step_results?: object[];
  browser_info?: object;
  tester_notes?: string;
}

class SupabaseReporter implements Reporter {
  private supabase: SupabaseClient | null = null;
  private batchId: string | null = null;
  private testInstances: TestInstanceData[] = [];
  private startTime: Date = new Date();
  private config: FullConfig | null = null;
  private totalTests = 0;
  private passedCount = 0;
  private failedCount = 0;
  private skippedCount = 0;
  private enabled = true;

  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.warn('[SupabaseReporter] SUPABASE_URL or SUPABASE_SERVICE_KEY not set. Test results will not be stored.');
      this.enabled = false;
      return;
    }

    try {
      this.supabase = createClient(supabaseUrl, supabaseKey);
      console.log('[SupabaseReporter] Initialized - will store test results in Supabase');
    } catch (error) {
      console.error('[SupabaseReporter] Failed to initialize Supabase client:', error);
      this.enabled = false;
    }
  }

  onBegin(config: FullConfig, suite: Suite) {
    if (!this.enabled) return;

    this.config = config;
    this.startTime = new Date();
    this.totalTests = suite.allTests().length;
    this.testInstances = [];
    this.passedCount = 0;
    this.failedCount = 0;
    this.skippedCount = 0;

    console.log(`[SupabaseReporter] Starting test run with ${this.totalTests} tests`);
  }

  onTestEnd(test: TestCase, result: TestResult) {
    if (!this.enabled) return;

    // Extract test code from title (e.g., "TC-AUTH-001: Super Admin Login" -> "TC-AUTH-001")
    const titleMatch = test.title.match(/^(TC-[A-Z]+-\d+)/);
    const scenarioCode = titleMatch ? titleMatch[1] : test.title.substring(0, 50);

    // Track counts
    if (result.status === 'passed') this.passedCount++;
    else if (result.status === 'failed' || result.status === 'timedOut') this.failedCount++;
    else if (result.status === 'skipped') this.skippedCount++;

    // Extract browser info
    const browserInfo = {
      name: test.parent?.project()?.name || 'unknown',
      ...test.parent?.project()?.use,
    };

    // Build test instance data
    const instanceData: TestInstanceData = {
      scenario_code: scenarioCode,
      environment: process.env.TEST_ENVIRONMENT || 'local',
      started_at: new Date(result.startTime).toISOString(),
      completed_at: new Date(result.startTime.getTime() + result.duration).toISOString(),
      duration_ms: result.duration,
      status: result.status as 'passed' | 'failed' | 'skipped' | 'timedOut',
      browser_info: browserInfo,
      tester_notes: `Full title: ${test.titlePath().join(' > ')}`,
    };

    // Add error info if failed
    if (result.status === 'failed' || result.status === 'timedOut') {
      const error = result.errors[0];
      if (error) {
        instanceData.error_message = error.message?.substring(0, 1000);
        instanceData.error_stack = error.stack?.substring(0, 5000);
      }
    }

    // Extract step results
    if (result.steps.length > 0) {
      instanceData.step_results = result.steps.map((step, index) => ({
        step_number: index + 1,
        step_name: step.title,
        status: step.error ? 'failed' : 'passed',
        duration_ms: step.duration,
        error: step.error?.message?.substring(0, 500),
      }));
    }

    this.testInstances.push(instanceData);
  }

  async onEnd(result: FullResult) {
    if (!this.enabled || !this.supabase) {
      console.log('[SupabaseReporter] Skipping database save (not enabled)');
      return;
    }

    const endTime = new Date();
    const totalDuration = endTime.getTime() - this.startTime.getTime();

    try {
      // Create test run batch
      const batchData = {
        batch_name: `Playwright Run - ${this.startTime.toISOString().split('T')[0]}`,
        description: `Automated Playwright test run`,
        environment: process.env.TEST_ENVIRONMENT || 'local',
        version_tested: process.env.APP_VERSION || 'unknown',
        build_number: process.env.BUILD_NUMBER || null,
        started_at: this.startTime.toISOString(),
        completed_at: endTime.toISOString(),
        total_tests: this.totalTests,
        passed_count: this.passedCount,
        failed_count: this.failedCount,
        skipped_count: this.skippedCount,
        blocked_count: 0,
        error_count: this.failedCount,
        overall_status: result.status,
        deployment_recommendation: this.failedCount === 0 ? 'approve' : 'review',
        recommendation_notes: this.failedCount === 0 
          ? 'All tests passed' 
          : `${this.failedCount} test(s) failed - review required`,
      };

      console.log('[SupabaseReporter] Creating test run batch...');
      const { data: batch, error: batchError } = await this.supabase
        .from('test_run_batches')
        .insert(batchData)
        .select()
        .single();

      if (batchError) {
        console.error('[SupabaseReporter] Failed to create batch:', batchError.message);
        return;
      }

      this.batchId = batch.id;
      console.log(`[SupabaseReporter] Created batch: ${batch.id}`);

      // Lookup scenario IDs from test_scenarios table
      const scenarioCodes = this.testInstances.map(t => t.scenario_code);
      const { data: scenarios } = await this.supabase
        .from('test_scenarios')
        .select('id, scenario_code')
        .in('scenario_code', scenarioCodes);

      const scenarioMap = new Map(scenarios?.map(s => [s.scenario_code, s.id]) || []);

      // Insert test instances with batch ID and scenario IDs
      const instancesWithBatch = this.testInstances.map(instance => ({
        scenario_id: scenarioMap.get(instance.scenario_code) || null,
        scenario_code: instance.scenario_code,
        run_batch_id: this.batchId,
        run_number: 1,
        environment: instance.environment,
        started_at: instance.started_at,
        completed_at: instance.completed_at,
        duration_ms: instance.duration_ms,
        status: instance.status,
        actual_result: instance.actual_result || null,
        error_message: instance.error_message || null,
        error_stack: instance.error_stack || null,
        step_results: instance.step_results || null,
        browser_info: instance.browser_info || null,
        tester_notes: instance.tester_notes || null,
        severity_level_at_run: 'medium', // Default severity
        executed_by_name: 'Playwright Automation',
      }));

      console.log(`[SupabaseReporter] Inserting ${instancesWithBatch.length} test instances...`);
      const { error: instancesError } = await this.supabase
        .from('test_instances')
        .insert(instancesWithBatch);

      if (instancesError) {
        console.error('[SupabaseReporter] Failed to insert instances:', instancesError.message);
      } else {
        console.log(`[SupabaseReporter] Successfully stored ${instancesWithBatch.length} test results`);
      }

      // Print summary
      console.log('\n[SupabaseReporter] ═══════════════════════════════════════');
      console.log(`  Batch ID: ${this.batchId}`);
      console.log(`  Total: ${this.totalTests} | Passed: ${this.passedCount} | Failed: ${this.failedCount} | Skipped: ${this.skippedCount}`);
      console.log(`  Duration: ${(totalDuration / 1000).toFixed(2)}s`);
      console.log('═══════════════════════════════════════\n');

    } catch (error) {
      console.error('[SupabaseReporter] Error saving results:', error);
    }
  }
}

export default SupabaseReporter;
