import { test as base, expect } from '@playwright/test';
import { getSupabaseAdmin } from '../helpers/database.helper';

/**
 * Test Data Types - Match database schema
 */

// User test data
export interface UserTestData {
  email: string;
  password: string;
  role: string;
  expected_dashboard: string;
}

// Contact test data
export interface ContactTestData {
  id?: string;
  contact_code?: string;
  company_name: string;
  contact_type: 'customer' | 'supplier' | 'grower' | 'both' | 'nis_supplier' | 'oil_processor' | 'kernel_customer';
  primary_contact_name?: string;
  primary_contact_email?: string;
  primary_contact_phone?: string;
  primary_contact_mobile?: string;
  phone?: string;
  trading_name?: string;
  status: 'active' | 'inactive' | 'prospect' | 'suspended';
  farm_name?: string;
  cultivar?: string;
  hectares_planted?: number;
  credit_limit?: number;
  payment_terms?: number;
  // Address fields
  physical_address_line1?: string;
  physical_city?: string;
  physical_province?: string;
  physical_area?: string;
  physical_postal_code?: string;
  // Oil processor specific
  rate_crude_kernel?: number;
  rate_food_kernel?: number;
  notes?: string;
}

// Sample submission test data
export interface SampleTestData {
  id?: string;
  sample_code?: string;
  grower_id: string;
  grower_name?: string;
  sample_weight_kg: number;
  cultivar?: string;
  crack_out_percentage?: number;
  moisture_percentage?: number;
  status: 'pending' | 'testing' | 'approved' | 'rejected' | 'expired';
  price_tier?: string;
}

// Production batch test data
export interface ProductionBatchTestData {
  id?: string;
  batch_number?: string;
  nis_weight_kg: number;
  current_step?: number;
  status: string;
  total_kernel_output_kg?: number;
  crack_out_percentage?: number;
  quality_hold?: boolean;
  positive_release?: boolean;
}

// Oil production batch test data
export interface OilBatchTestData {
  id?: string;
  batch_number?: string;
  kernel_input_kg: number;
  oil_output_litres?: number;
  oil_output_kg?: number;
  press_temperature_celsius?: number;
  oil_yield_percentage?: number;
  status: string;
}

// Quality test data
export interface QualityTestData {
  id?: string;
  test_code?: string;
  test_type: string;
  entity_type: 'production_batch' | 'oil_production_batch' | 'sample';
  batch_number?: string;
  result_status: 'pending' | 'passed' | 'failed' | 'conditional';
  moisture_percentage?: number;
  ffa_percentage?: number;
}

// Stock item test data
export interface StockItemTestData {
  id?: string;
  stock_code?: string;
  product_type: 'kernel' | 'oil' | 'oil_cake';
  style?: string;
  grade?: string;
  quantity_kg: number;
  location: string;
  status: 'available' | 'hold' | 'reserved' | 'dispatched';
  production_batch_id?: string;
  oil_batch_id?: string;
}

// Financial calculation test data
export interface PaymentCalculationTestData {
  grower_id: string;
  grower_name: string;
  net_kernel_kg: number;
  price_per_kg: number;
  gross_amount: number;
  moisture_percentage: number;
  moisture_deduction: number;
  unsound_percentage: number;
  unsound_deduction: number;
  total_deductions?: number;
  net_payment: number;
}

// Quality thresholds
export interface QualityThresholds {
  max_moisture_percentage: number;
  max_ffa_percentage: number;
  min_crack_out_percentage: number;
  premium_crack_out_minimum: number;
}

// Complete test data set loaded from database
export interface TestDataSet {
  users: {
    superAdmin: UserTestData;
    generalManager: UserTestData;
    productionManager: UserTestData;
    qaSupervsor: UserTestData;
    salesExecutive: UserTestData;
    oilPlantManager: UserTestData;
    officeAdministrator: UserTestData;
    invalidUser: UserTestData;
    deactivatedUser: UserTestData;
  };
  contacts: {
    growerActive: ContactTestData;
    growerKhoza: ContactTestData;
    growerSuspended: ContactTestData;
    customerOriental: ContactTestData;
    customerSuspended: ContactTestData;
    newGrowerTemplate: ContactTestData;
    newCustomerTemplate: ContactTestData;
    newNisSupplierTemplate: ContactTestData;
    newOilProcessorTemplate: ContactTestData;
    newKernelCustomerTemplate: ContactTestData;
  };
  samples: {
    approved: SampleTestData;
    pending: SampleTestData;
    rejected: SampleTestData;
    newTemplate: SampleTestData;
  };
  productionBatches: {
    completed: ProductionBatchTestData;
    inCracking: ProductionBatchTestData;
    onHold: ProductionBatchTestData;
    inDrying: ProductionBatchTestData;
    newTemplate: ProductionBatchTestData;
  };
  oilBatches: {
    completed: OilBatchTestData;
    pressing: OilBatchTestData;
    onHold: OilBatchTestData;
    inStorage: OilBatchTestData;
    temperatureTestData: {
      max_cold_press_temp: number;
      acceptable_temp: number;
      exceeding_temp: number;
      warning_message: string;
    };
  };
  qualityTests: {
    passed: QualityTestData;
    failed: QualityTestData;
    oilPassed: QualityTestData;
    kernelThresholds: QualityThresholds;
    oilThresholds: {
      max_ffa_percentage: number;
      max_peroxide_value: number;
      max_moisture_percentage: number;
      min_oil_yield_percentage: number;
    };
  };
  stock: {
    kernelAvailable: StockItemTestData;
    kernelOnHold: StockItemTestData;
    oilBulk: StockItemTestData;
    warehouseLocations: {
      cold_rooms: string[];
      tank_farm: string;
      dispatch: string;
      receiving: string;
    };
  };
  payments: {
    standardCalculation: PaymentCalculationTestData;
    withDeductions: PaymentCalculationTestData;
    pricingTiers: Record<string, { min_crack_out: number; price_per_kg: number }>;
    deductionRules: {
      moisture_threshold: number;
      moisture_deduction_per_half_percent: number;
      unsound_deduction_rate: number;
      foreign_material_threshold: number;
    };
  };
}

/**
 * Fixture type definitions
 */
export interface TestDataFixtures {
  testData: TestDataSet;
  generateContact: (overrides?: Partial<ContactTestData>) => ContactTestData;
  generateSample: (overrides?: Partial<SampleTestData>) => SampleTestData;
  generateBatch: (overrides?: Partial<ProductionBatchTestData>) => ProductionBatchTestData;
  generateOilBatch: (overrides?: Partial<OilBatchTestData>) => OilBatchTestData;
  uniqueId: () => string;
  uniqueCode: (prefix: string) => string;
}

/**
 * Generate a unique ID for test data
 */
function uniqueId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Generate a unique code with prefix
 */
function uniqueCode(prefix: string): string {
  return `${prefix}-E2E-${Date.now().toString(36).toUpperCase()}`;
}

/**
 * Load test data from the database e2e_test_data_records table
 */
async function loadTestDataFromDatabase(): Promise<TestDataSet> {
  const supabase = getSupabaseAdmin();
  
  // Load all test data records
  const { data: records, error } = await supabase
    .from('e2e_test_data_records')
    .select(`
      *,
      e2e_test_data_sets!inner(set_name, module)
    `)
    .order('data_key');
  
  if (error) {
    console.warn('Failed to load test data from database, using defaults:', error.message);
    return getDefaultTestData();
  }
  
  // Transform records into organized test data
  const dataBySetAndKey: Record<string, Record<string, any>> = {};
  
  for (const record of records || []) {
    const setName = record.e2e_test_data_sets.set_name;
    if (!dataBySetAndKey[setName]) {
      dataBySetAndKey[setName] = {};
    }
    dataBySetAndKey[setName][record.data_key] = {
      ...record.data_value,
      id: record.entity_id,
    };
  }
  
  return {
    users: {
      superAdmin: dataBySetAndKey['auth_test_data']?.['super_admin'] || getDefaultTestData().users.superAdmin,
      generalManager: dataBySetAndKey['auth_test_data']?.['valid_general_manager'] || getDefaultTestData().users.generalManager,
      productionManager: dataBySetAndKey['auth_test_data']?.['valid_production_manager'] || getDefaultTestData().users.productionManager,
      qaSupervsor: dataBySetAndKey['auth_test_data']?.['valid_qa_supervisor'] || getDefaultTestData().users.qaSupervsor,
      salesExecutive: dataBySetAndKey['auth_test_data']?.['valid_sales_executive'] || getDefaultTestData().users.salesExecutive,
      oilPlantManager: dataBySetAndKey['auth_test_data']?.['valid_oil_plant_manager'] || getDefaultTestData().users.oilPlantManager,
      officeAdministrator: dataBySetAndKey['auth_test_data']?.['valid_office_administrator'] || getDefaultTestData().users.officeAdministrator,
      invalidUser: dataBySetAndKey['auth_test_data']?.['invalid_user'] || getDefaultTestData().users.invalidUser,
      deactivatedUser: dataBySetAndKey['auth_test_data']?.['deactivated_user'] || getDefaultTestData().users.deactivatedUser,
    },
    contacts: {
      growerActive: dataBySetAndKey['crm_test_data']?.['grower_van_der_merwe'] || getDefaultTestData().contacts.growerActive,
      growerKhoza: dataBySetAndKey['crm_test_data']?.['grower_khoza'] || getDefaultTestData().contacts.growerKhoza,
      growerSuspended: dataBySetAndKey['crm_test_data']?.['grower_suspended'] || getDefaultTestData().contacts.growerSuspended,
      customerOriental: dataBySetAndKey['crm_test_data']?.['customer_oriental'] || getDefaultTestData().contacts.customerOriental,
      customerSuspended: dataBySetAndKey['crm_test_data']?.['customer_suspended'] || getDefaultTestData().contacts.customerSuspended,
      newGrowerTemplate: dataBySetAndKey['crm_test_data']?.['new_grower_template'] || getDefaultTestData().contacts.newGrowerTemplate,
      newCustomerTemplate: dataBySetAndKey['crm_test_data']?.['new_customer_template'] || getDefaultTestData().contacts.newCustomerTemplate,
      newNisSupplierTemplate: dataBySetAndKey['crm_test_data']?.['new_nis_supplier_template'] || getDefaultTestData().contacts.newNisSupplierTemplate,
      newOilProcessorTemplate: dataBySetAndKey['crm_test_data']?.['new_oil_processor_template'] || getDefaultTestData().contacts.newOilProcessorTemplate,
      newKernelCustomerTemplate: dataBySetAndKey['crm_test_data']?.['new_kernel_customer_template'] || getDefaultTestData().contacts.newKernelCustomerTemplate,
    },
    samples: {
      approved: dataBySetAndKey['grower_intake_test_data']?.['sample_approved'] || getDefaultTestData().samples.approved,
      pending: dataBySetAndKey['grower_intake_test_data']?.['sample_pending'] || getDefaultTestData().samples.pending,
      rejected: dataBySetAndKey['grower_intake_test_data']?.['sample_rejected'] || getDefaultTestData().samples.rejected,
      newTemplate: dataBySetAndKey['grower_intake_test_data']?.['new_sample_template'] || getDefaultTestData().samples.newTemplate,
    },
    productionBatches: {
      completed: dataBySetAndKey['kernel_production_test_data']?.['batch_completed'] || getDefaultTestData().productionBatches.completed,
      inCracking: dataBySetAndKey['kernel_production_test_data']?.['batch_in_cracking'] || getDefaultTestData().productionBatches.inCracking,
      onHold: dataBySetAndKey['kernel_production_test_data']?.['batch_on_hold'] || getDefaultTestData().productionBatches.onHold,
      inDrying: dataBySetAndKey['kernel_production_test_data']?.['batch_in_drying'] || getDefaultTestData().productionBatches.inDrying,
      newTemplate: dataBySetAndKey['kernel_production_test_data']?.['new_batch_template'] || getDefaultTestData().productionBatches.newTemplate,
    },
    oilBatches: {
      completed: dataBySetAndKey['oil_production_test_data']?.['oil_batch_completed'] || getDefaultTestData().oilBatches.completed,
      pressing: dataBySetAndKey['oil_production_test_data']?.['oil_batch_pressing'] || getDefaultTestData().oilBatches.pressing,
      onHold: dataBySetAndKey['oil_production_test_data']?.['oil_batch_on_hold'] || getDefaultTestData().oilBatches.onHold,
      inStorage: dataBySetAndKey['oil_production_test_data']?.['oil_batch_in_storage'] || getDefaultTestData().oilBatches.inStorage,
      temperatureTestData: dataBySetAndKey['oil_production_test_data']?.['temperature_test_data'] || getDefaultTestData().oilBatches.temperatureTestData,
    },
    qualityTests: {
      passed: dataBySetAndKey['quality_test_data']?.['quality_test_passed'] || getDefaultTestData().qualityTests.passed,
      failed: dataBySetAndKey['quality_test_data']?.['quality_test_failed'] || getDefaultTestData().qualityTests.failed,
      oilPassed: dataBySetAndKey['quality_test_data']?.['oil_quality_test_passed'] || getDefaultTestData().qualityTests.oilPassed,
      kernelThresholds: dataBySetAndKey['quality_test_data']?.['kernel_quality_thresholds'] || getDefaultTestData().qualityTests.kernelThresholds,
      oilThresholds: dataBySetAndKey['quality_test_data']?.['oil_quality_thresholds'] || getDefaultTestData().qualityTests.oilThresholds,
    },
    stock: {
      kernelAvailable: dataBySetAndKey['stock_test_data']?.['kernel_stock_style0'] || getDefaultTestData().stock.kernelAvailable,
      kernelOnHold: dataBySetAndKey['stock_test_data']?.['kernel_stock_on_hold'] || getDefaultTestData().stock.kernelOnHold,
      oilBulk: dataBySetAndKey['stock_test_data']?.['oil_stock_bulk'] || getDefaultTestData().stock.oilBulk,
      warehouseLocations: dataBySetAndKey['stock_test_data']?.['warehouse_locations'] || getDefaultTestData().stock.warehouseLocations,
    },
    payments: {
      standardCalculation: dataBySetAndKey['financial_test_data']?.['payment_calculation_standard'] || getDefaultTestData().payments.standardCalculation,
      withDeductions: dataBySetAndKey['financial_test_data']?.['payment_calculation_with_deductions'] || getDefaultTestData().payments.withDeductions,
      pricingTiers: dataBySetAndKey['financial_test_data']?.['kernel_pricing_tiers'] || getDefaultTestData().payments.pricingTiers,
      deductionRules: dataBySetAndKey['financial_test_data']?.['deduction_rules'] || getDefaultTestData().payments.deductionRules,
    },
  };
}

/**
 * Get default test data when database is not available
 */
function getDefaultTestData(): TestDataSet {
  return {
    users: {
      superAdmin: {
        email: process.env.SUPER_ADMIN_EMAIL || 'kishan@customapp.co.za',
        password: process.env.SUPER_ADMIN_PASSWORD || 'Testing123$',
        role: 'Super Admin',
        expected_dashboard: '/dashboard',
      },
      generalManager: {
        email: process.env.GENERAL_MANAGER_EMAIL || '',
        password: process.env.GENERAL_MANAGER_PASSWORD || '',
        role: 'General Manager',
        expected_dashboard: '/dashboard',
      },
      productionManager: {
        email: process.env.PRODUCTION_MANAGER_EMAIL || '',
        password: process.env.PRODUCTION_MANAGER_PASSWORD || '',
        role: 'Production Manager',
        expected_dashboard: '/kernel-production',
      },
      qaSupervsor: {
        email: process.env.QA_SUPERVISOR_EMAIL || '',
        password: process.env.QA_SUPERVISOR_PASSWORD || '',
        role: 'QA Supervisor',
        expected_dashboard: '/quality-assurance',
      },
      salesExecutive: {
        email: process.env.SALES_EXECUTIVE_EMAIL || '',
        password: process.env.SALES_EXECUTIVE_PASSWORD || '',
        role: 'Sales Executive',
        expected_dashboard: '/sales-forecasting',
      },
      oilPlantManager: {
        email: 'brandon.morrison@macavation.co.za',
        password: process.env.OIL_PLANT_MANAGER_PASSWORD || 'password1',
        role: 'Oil Plant Manager',
        expected_dashboard: '/oil-production',
      },
      officeAdministrator: {
        email: process.env.OFFICE_ADMINISTRATOR_EMAIL || '',
        password: process.env.OFFICE_ADMINISTRATOR_PASSWORD || '',
        role: 'Office Administrator',
        expected_dashboard: '/grower-intake',
      },
      invalidUser: {
        email: 'invalid@macavation.co.za',
        password: 'wrongpassword',
        role: '',
        expected_dashboard: '',
      },
      deactivatedUser: {
        email: 'deactivated@macavation.co.za',
        password: 'Password123!',
        role: '',
        expected_dashboard: '',
      },
    },
    contacts: {
      growerActive: {
        id: 'ed7e5e2e-2b09-4893-bae8-e1820f76a053',
        contact_code: 'GRW-001',
        company_name: 'Van der Merwe Macadamias',
        contact_type: 'grower',
        farm_name: 'Macadamia Heights',
        cultivar: 'Beaumont',
        status: 'active',
      },
      growerKhoza: {
        id: '4a4216d2-fcc7-41da-ad4e-40371c0fb49b',
        contact_code: 'GRW-002',
        company_name: 'Khoza Farming Trust',
        contact_type: 'grower',
        farm_name: 'Green Valley Farm',
        cultivar: 'A4',
        status: 'active',
      },
      growerSuspended: {
        id: 'c5e09d9e-9922-40b7-8a76-51e48fa0b28a',
        contact_code: 'GRW-009',
        company_name: 'Riverside Plantations',
        contact_type: 'grower',
        status: 'suspended',
      },
      customerOriental: {
        id: 'e33a6a12-c8ac-461b-9eb8-40d995c69308',
        contact_code: 'CUS-001',
        company_name: 'Oriental Foods Trading Co.',
        contact_type: 'customer',
        credit_limit: 2000000,
        payment_terms: 60,
        status: 'active',
      },
      customerSuspended: {
        id: '686ee10f-adfd-4070-a17c-710fe532a355',
        contact_code: 'CUS-007',
        company_name: 'Durban Snack Foods',
        contact_type: 'customer',
        status: 'suspended',
      },
      newGrowerTemplate: {
        company_name: 'E2E Test Grower',
        contact_type: 'grower',
        primary_contact_name: 'Test Grower Person',
        primary_contact_email: 'test.grower@example.com',
        phone: '+27 11 123 4567',
        farm_name: 'Test Farm',
        cultivar: 'Beaumont',
        hectares_planted: 50,
        status: 'active',
      },
      newCustomerTemplate: {
        company_name: 'E2E Test Customer',
        contact_type: 'customer',
        primary_contact_name: 'Test Customer Person',
        primary_contact_email: 'test.customer@example.com',
        phone: '+27 21 987 6543',
        credit_limit: 100000,
        payment_terms: 30,
        status: 'active',
      },
      newNisSupplierTemplate: {
        company_name: 'E2E NIS Supplier',
        contact_type: 'nis_supplier',
        trading_name: 'E2E Trading NIS',
        primary_contact_name: 'John NIS Supplier',
        primary_contact_email: 'nis.supplier@example.com',
        primary_contact_phone: '+27 11 123 4567',
        primary_contact_mobile: '+27 82 111 2222',
        province: 'Mpumalanga',
        area: 'Nelspruit',
        notes: 'E2E Test NIS Supplier',
        status: 'active',
      },
      newOilProcessorTemplate: {
        company_name: 'E2E Oil Processor',
        contact_type: 'oil_processor',
        trading_name: 'E2E Oil Processing',
        primary_contact_name: 'Jane Oil Processor',
        primary_contact_email: 'oil.processor@example.com',
        primary_contact_phone: '+27 11 234 5678',
        primary_contact_mobile: '+27 82 222 3333',
        province: 'KwaZulu-Natal',
        rate_crude_kernel: 125.50,
        rate_cake: 45.00,
        notes: 'E2E Test Oil Processor',
        status: 'active',
      },
      newKernelCustomerTemplate: {
        company_name: 'E2E Kernel Customer',
        contact_type: 'kernel_customer',
        trading_name: 'E2E Kernel Trading',
        primary_contact_name: 'Bob Kernel Customer',
        primary_contact_email: 'kernel.customer@example.com',
        primary_contact_phone: '+27 21 345 6789',
        primary_contact_mobile: '+27 82 333 4444',
        credit_limit: 500000,
        payment_terms: 30,
        notes: 'E2E Test Kernel Customer',
        status: 'active',
      },
    },
    samples: {
      approved: {
        id: 'f21c66e6-1087-49a6-8003-b246cd211bbd',
        sample_code: 'SAMP-2026-001',
        grower_id: 'ed7e5e2e-2b09-4893-bae8-e1820f76a053',
        grower_name: 'Van der Merwe Macadamias',
        sample_weight_kg: 5.2,
        cultivar: 'Beaumont',
        crack_out_percentage: 32.5,
        moisture_percentage: 1.8,
        status: 'approved',
        price_tier: 'Premium Grade A',
      },
      pending: {
        id: '26137b80-c0d8-4373-b032-6d04692517bf',
        sample_code: 'SAMP-EC-001',
        grower_id: 'ed7e5e2e-2b09-4893-bae8-e1820f76a053',
        sample_weight_kg: 5.0,
        crack_out_percentage: 30.0,
        moisture_percentage: 2.0,
        status: 'pending',
      },
      rejected: {
        id: 'b7529169-f620-4f63-ae2a-4042c76db2a5',
        sample_code: 'SAMP-EC-003',
        grower_id: '9fef3eac-9725-487b-a77f-069523a038a9',
        sample_weight_kg: 5.0,
        crack_out_percentage: 24.99,
        moisture_percentage: 1.8,
        status: 'rejected',
      },
      newTemplate: {
        grower_id: 'ed7e5e2e-2b09-4893-bae8-e1820f76a053',
        sample_weight_kg: 5.0,
        cultivar: 'Beaumont',
        status: 'pending',
      },
    },
    productionBatches: {
      completed: {
        id: 'a1fd3ef7-4cc5-430e-8781-b4048ea9d34c',
        batch_number: 'KB-2026-001',
        nis_weight_kg: 4520,
        current_step: 17,
        status: 'completed',
        total_kernel_output_kg: 1540.5,
        crack_out_percentage: 34.1,
        positive_release: true,
      },
      inCracking: {
        id: '0ab015f6-d556-48b4-994e-ff1740287c8d',
        batch_number: 'KB-EC-001',
        nis_weight_kg: 5000,
        current_step: 3,
        status: 'cracking',
        quality_hold: false,
      },
      onHold: {
        id: '58d251ca-b70c-47a7-9d1f-b578649fc805',
        batch_number: 'KB-EC-003',
        nis_weight_kg: 3000,
        current_step: 4,
        status: 'hold',
        quality_hold: true,
      },
      inDrying: {
        id: '238a4248-5c36-40f1-9606-9346b8590bc1',
        batch_number: 'KB-EC-004',
        nis_weight_kg: 4200,
        current_step: 8,
        status: 'drying',
      },
      newTemplate: {
        nis_weight_kg: 5000,
        status: 'receiving',
      },
    },
    oilBatches: {
      completed: {
        id: '180523fc-3cf6-481b-a668-7cb8fe709e80',
        batch_number: 'OB-2026-002',
        kernel_input_kg: 350,
        oil_output_litres: 238,
        oil_output_kg: 214.2,
        press_temperature_celsius: 47,
        oil_yield_percentage: 68.0,
        status: 'completed',
      },
      pressing: {
        id: '0d36ee65-bd87-4bf9-b980-668d8b33ba2b',
        batch_number: 'OB-EC-001',
        kernel_input_kg: 300,
        press_temperature_celsius: 42,
        status: 'pressing',
      },
      onHold: {
        id: '40b3096f-ef96-4382-a738-9c6c4d723698',
        batch_number: 'OB-EC-002',
        kernel_input_kg: 280,
        oil_output_litres: 188,
        press_temperature_celsius: 42.1,
        oil_yield_percentage: 67.0,
        status: 'hold',
      },
      inStorage: {
        id: 'cabc7720-9d77-495b-a7da-7c0660e9bec5',
        batch_number: 'OB-EC-007',
        kernel_input_kg: 380,
        oil_output_litres: 258,
        press_temperature_celsius: 41,
        oil_yield_percentage: 67.9,
        status: 'storage',
      },
      temperatureTestData: {
        max_cold_press_temp: 42,
        acceptable_temp: 40,
        exceeding_temp: 43,
        warning_message: 'Press temperature exceeds cold-press limit of 42°C',
      },
    },
    qualityTests: {
      passed: {
        id: '34913009-3e0d-4c6b-bca9-3292d995e3e2',
        test_code: 'QT-2026-001',
        test_type: 'Moisture Test',
        entity_type: 'production_batch',
        batch_number: 'KB-2026-001',
        result_status: 'passed',
        moisture_percentage: 1.2,
      },
      failed: {
        id: '72c4e890-c984-46c6-87f8-d0f68fc0303b',
        test_code: 'QT-EC-002',
        test_type: 'PAA Concentration',
        entity_type: 'production_batch',
        batch_number: 'KB-2026-004',
        result_status: 'failed',
      },
      oilPassed: {
        id: 'b452f4f4-bee9-4b8e-ba55-daa640dbb587',
        test_code: 'QT-2026-010',
        test_type: 'Full Oil Panel',
        entity_type: 'oil_production_batch',
        batch_number: 'OB-2026-002',
        result_status: 'passed',
        moisture_percentage: 0.04,
        ffa_percentage: 0.09,
      },
      kernelThresholds: {
        max_moisture_percentage: 1.5,
        max_ffa_percentage: 0.1,
        min_crack_out_percentage: 25,
        premium_crack_out_minimum: 32,
      },
      oilThresholds: {
        max_ffa_percentage: 0.1,
        max_peroxide_value: 10,
        max_moisture_percentage: 0.05,
        min_oil_yield_percentage: 65,
      },
    },
    stock: {
      kernelAvailable: {
        id: 'e479ef35-0c9b-487d-931d-0420407a70e4',
        stock_code: 'STK-K-2026-001',
        product_type: 'kernel',
        style: 'Style 0',
        grade: 'Premium A',
        quantity_kg: 520,
        location: 'Cold Room 1',
        status: 'available',
        production_batch_id: 'a1fd3ef7-4cc5-430e-8781-b4048ea9d34c',
      },
      kernelOnHold: {
        id: 'b952fd39-344e-4ada-93a4-b316014f1599',
        stock_code: 'STK-K-2026-006',
        product_type: 'kernel',
        style: 'Style 0',
        grade: 'Standard',
        quantity_kg: 250,
        location: 'Cold Room Hold',
        status: 'hold',
      },
      oilBulk: {
        id: 'e12c3cea-8936-43a7-89ab-a6029a6f89df',
        stock_code: 'STK-O-2026-003',
        product_type: 'oil',
        style: 'Bulk Tank',
        grade: 'Virgin Cold Pressed',
        quantity_kg: 257,
        location: 'Tank Farm',
        status: 'available',
      },
      warehouseLocations: {
        cold_rooms: ['Cold Room 1', 'Cold Room 2', 'Cold Room 3', 'Cold Room Hold'],
        tank_farm: 'Tank Farm',
        dispatch: 'Dispatch Area',
        receiving: 'Receiving Bay',
      },
    },
    payments: {
      standardCalculation: {
        grower_id: 'ed7e5e2e-2b09-4893-bae8-e1820f76a053',
        grower_name: 'Van der Merwe Macadamias',
        net_kernel_kg: 400,
        price_per_kg: 150,
        gross_amount: 60000,
        moisture_percentage: 1.5,
        moisture_deduction: 0,
        unsound_percentage: 0,
        unsound_deduction: 0,
        net_payment: 60000,
      },
      withDeductions: {
        grower_id: '4a4216d2-fcc7-41da-ad4e-40371c0fb49b',
        grower_name: 'Khoza Farming Trust',
        net_kernel_kg: 350,
        price_per_kg: 150,
        gross_amount: 52500,
        moisture_percentage: 3.0,
        moisture_deduction: 525,
        unsound_percentage: 5.0,
        unsound_deduction: 2625,
        total_deductions: 3150,
        net_payment: 49350,
      },
      pricingTiers: {
        premium_a: { min_crack_out: 32, price_per_kg: 165 },
        premium_b: { min_crack_out: 30, price_per_kg: 155 },
        standard_a: { min_crack_out: 28, price_per_kg: 145 },
        standard_b: { min_crack_out: 25, price_per_kg: 130 },
      },
      deductionRules: {
        moisture_threshold: 2.5,
        moisture_deduction_per_half_percent: 0.01,
        unsound_deduction_rate: 1.0,
        foreign_material_threshold: 0.5,
      },
    },
  };
}

/**
 * Generate test contact data with unique identifiers
 */
function generateContact(overrides: Partial<ContactTestData> = {}): ContactTestData {
  const id = uniqueId();
  return {
    company_name: `E2E Test Company ${id}`,
    contact_type: 'customer',
    primary_contact_name: `Test Contact ${id}`,
    primary_contact_email: `e2e-test-${id}@example.com`,
    phone: '+27123456789',
    status: 'active',
    ...overrides,
  };
}

/**
 * Generate test sample data with unique identifiers
 */
function generateSample(overrides: Partial<SampleTestData> = {}): SampleTestData {
  return {
    grower_id: 'ed7e5e2e-2b09-4893-bae8-e1820f76a053',
    sample_weight_kg: 5.0,
    cultivar: 'Beaumont',
    crack_out_percentage: 30.0,
    moisture_percentage: 2.0,
    status: 'pending',
    ...overrides,
  };
}

/**
 * Generate test production batch data
 */
function generateBatch(overrides: Partial<ProductionBatchTestData> = {}): ProductionBatchTestData {
  return {
    nis_weight_kg: 5000,
    current_step: 1,
    status: 'receiving',
    quality_hold: false,
    ...overrides,
  };
}

/**
 * Generate test oil batch data
 */
function generateOilBatch(overrides: Partial<OilBatchTestData> = {}): OilBatchTestData {
  return {
    kernel_input_kg: 350,
    press_temperature_celsius: 40,
    status: 'preparation',
    ...overrides,
  };
}

// Cache for test data
let cachedTestData: TestDataSet | null = null;

/**
 * Extended test with test data fixtures
 */
export const test = base.extend<TestDataFixtures>({
  testData: async ({}, use) => {
    // Load from cache or database
    if (!cachedTestData) {
      try {
        cachedTestData = await loadTestDataFromDatabase();
      } catch (error) {
        console.warn('Using default test data:', error);
        cachedTestData = getDefaultTestData();
      }
    }
    await use(cachedTestData);
  },

  generateContact: async ({}, use) => {
    await use(generateContact);
  },

  generateSample: async ({}, use) => {
    await use(generateSample);
  },

  generateBatch: async ({}, use) => {
    await use(generateBatch);
  },

  generateOilBatch: async ({}, use) => {
    await use(generateOilBatch);
  },

  uniqueId: async ({}, use) => {
    await use(uniqueId);
  },

  uniqueCode: async ({}, use) => {
    await use(uniqueCode);
  },
});

export { expect };
