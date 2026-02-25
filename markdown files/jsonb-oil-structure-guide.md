# Macavation Oil Production System - JSONB Structure Guide

Complete reference for all JSONB column structures in the database.

---

## Table of Contents
1. [SHIFT Table](#1-shift-table)
2. [PRODUCT Table](#2-product-table)
3. [OIL_BIN Table](#3-oil_bin-table)
4. [OIL Table](#4-oil-table)
   - [intake_data](#oilintake_data)
   - [production_data](#oilproduction_data)
   - [stock_data](#oilstock_data)
   - [dispatch_data](#oildispatch_data)

---

## 1. SHIFT TABLE

### `shift.shift_tracking` (jsonb)

**Purpose:** Tracks time-based material processing during a shift

**Structure:**
```json
{
  "entries": [
    {
      "time": "08:00",
      "crude_kernel": 500,
      "kernel_dust": 50,
      "crush": 100,
      "cracker_dust": 25,
      "cake": 150,
      "description": "First batch processing",
      "batches": ["BN1.26.01", "BN2.26.01"]
    },
    {
      "time": "10:00",
      "crude_kernel": 600,
      "kernel_dust": 60,
      "crush": 120,
      "cracker_dust": 30,
      "cake": 180,
      "description": "Second batch processing",
      "batches": ["BN3.26.01"]
    }
  ],
  "totals": {
    "crude_kernel": 2000,
    "kernel_dust": 200,
    "crush": 400,
    "cracker_dust": 100,
    "cake": 600
  },
  "oil_batches": ["oil-uuid-1", "oil-uuid-2", "oil-uuid-3"]
}
```

**Field Definitions:**

| Field Path | Type | Required | Description |
|------------|------|----------|-------------|
| `entries` | array | Yes | Array of time-based entries |
| `entries[].time` | string | Yes | Time of entry (HH:MM format) |
| `entries[].crude_kernel` | number | Yes | Crude kernel weight/quantity |
| `entries[].kernel_dust` | number | Yes | Kernel dust weight/quantity |
| `entries[].crush` | number | Yes | Crush weight/quantity |
| `entries[].cracker_dust` | number | Yes | Cracker dust weight/quantity |
| `entries[].cake` | number | Yes | Cake weight/quantity |
| `entries[].description` | string | No | Notes about this entry |
| `entries[].batches` | array of strings | Yes | Batch numbers being processed |
| `totals` | object | Yes | Sum totals for the shift |
| `totals.crude_kernel` | number | Yes | Total crude kernel |
| `totals.kernel_dust` | number | Yes | Total kernel dust |
| `totals.crush` | number | Yes | Total crush |
| `totals.cracker_dust` | number | Yes | Total cracker dust |
| `totals.cake` | number | Yes | Total cake |
| `oil_batches` | array of uuids | Yes | References to oil table records |

---

## 2. PRODUCT TABLE

### `product.product_specs` (jsonb)

**Purpose:** Defines product specifications and references batches

**Structure:**
```json
{
  "description": "Cold pressed macadamia oil - food grade",
  "standard_temperature": 85,
  "standard_speed_infeed": 50,
  "standard_speed_press": 30,
  "press_type": "Press 1",
  "expected_yield_percentage": 40,
  "shelf_life_months": 24,
  "storage_temp": "15-25°C",
  "packaging_options": ["1kg", "5kg", "25kg", "5L", "10L", "IBC"],
  "quality_standards": ["ISO 9001", "HACCP"],
  "certifications": ["Organic", "Non-GMO"],
  "allergen_info": "Contains tree nuts",
  "safety_notes": "Store away from direct sunlight",
  "oil_batches": ["oil-uuid-1", "oil-uuid-3", "oil-uuid-5"]
}
```

**Field Definitions:**

| Field Path | Type | Required | Description |
|------------|------|----------|-------------|
| `description` | string | Yes | Product description |
| `standard_temperature` | number | No | Standard processing temperature (protein powder) |
| `standard_speed_infeed` | number | No | Standard infeed speed (protein powder) |
| `standard_speed_press` | number | No | Standard press speed (protein powder) |
| `press_type` | string | No | Type of press used |
| `expected_yield_percentage` | number | No | Expected yield percentage |
| `shelf_life_months` | number | No | Shelf life in months |
| `storage_temp` | string | No | Storage temperature range |
| `packaging_options` | array of strings | No | Available packaging sizes |
| `quality_standards` | array of strings | No | Quality standard certifications |
| `certifications` | array of strings | No | Product certifications |
| `allergen_info` | string | No | Allergen information |
| `safety_notes` | string | No | Safety and handling notes |
| `oil_batches` | array of uuids | Yes | References to oil table records |

---

## 3. OIL_BIN TABLE

### `oil_bin.bin_data` (jsonb)

**Purpose:** Tracks bin capacity, contents, and batch references

**Structure:**
```json
{
  "capacity_litres": 1000,
  "current_level_litres": 850,
  "oil_batches": ["oil-uuid-1", "oil-uuid-2"],
  "last_cleaned": "2026-01-05",
  "location": "Production floor A",
  "bin_number": "IBC 1",
  "status": "in_use"
}
```

**Field Definitions:**

| Field Path | Type | Required | Description |
|------------|------|----------|-------------|
| `capacity_litres` | number | Yes | Maximum capacity in litres |
| `current_level_litres` | number | Yes | Current fill level in litres |
| `oil_batches` | array of uuids | Yes | References to oil table records |
| `last_cleaned` | string (date) | No | Last cleaning date (YYYY-MM-DD) |
| `location` | string | No | Physical location of bin |
| `bin_number` | string | No | Bin identifier/label |
| `status` | string | No | Current status (in_use, empty, cleaning) |

---

## 4. OIL TABLE

### `oil.intake_data` (jsonb)

**Purpose:** Supplier intake and receiving information

**Structure:**
```json
{
  "date_received": "2026-01-05",
  "delivery_note_reference": "DN12345",
  "supplier": "Macavation Estate",
  "supplier_details": "Contact: John Doe, 123-456-7890",
  "items": [
    {
      "reference_po_number": "PO001",
      "description": "Raw kernel",
      "batch": "BN 1.26.01",
      "carton_bulk_bags": "50 bags",
      "quantity": 1000,
      "manufactured_date": "2026-01-01",
      "best_before_date": "2027-01-01"
    }
  ],
  "vehicle_checks": {
    "is_clean": true,
    "is_enclosed": true,
    "no_hazards": true,
    "no_pest": true,
    "pallets_good_condition": true,
    "raw_materials_good_condition": true
  },
  "available_batch_numbers": [
    {
      "supplier": "Global macadamias",
      "next_batch": "BN 1.26.01"
    },
    {
      "supplier": "Lowveld nut processing",
      "next_batch": "BN 2.26.01"
    },
    {
      "supplier": "Mac-Eden estate",
      "next_batch": "BN 3.26.01"
    },
    {
      "supplier": "Ambermacs",
      "next_batch": "BN 4.26.01"
    },
    {
      "supplier": "Macavation",
      "next_batch": "BN 5.26.01"
    },
    {
      "supplier": "Northdale farm",
      "next_batch": "BN 6.26.01"
    },
    {
      "supplier": "Green Farm nuts Co",
      "next_batch": "BN 7.26.01"
    },
    {
      "supplier": "Sabie Valley",
      "next_batch": "BN 8.26.01"
    }
  ]
}
```

**Field Definitions:**

| Field Path | Type | Required | Description |
|------------|------|----------|-------------|
| `date_received` | string (date) | Yes | Date of receiving (YYYY-MM-DD) |
| `delivery_note_reference` | string | Yes | Delivery note/PO number |
| `supplier` | string | Yes | Supplier name |
| `supplier_details` | string | No | Additional supplier information |
| `items` | array | Yes | Array of received items |
| `items[].reference_po_number` | string | Yes | PO/Reference number |
| `items[].description` | string | Yes | Item description |
| `items[].batch` | string | Yes | Batch number |
| `items[].carton_bulk_bags` | string | No | Packaging description |
| `items[].quantity` | number | Yes | Quantity received |
| `items[].manufactured_date` | string (date) | No | Manufacturing date |
| `items[].best_before_date` | string (date) | No | Expiry/best before date |
| `vehicle_checks` | object | Yes | Vehicle inspection checklist |
| `vehicle_checks.is_clean` | boolean | Yes | Vehicle cleanliness check |
| `vehicle_checks.is_enclosed` | boolean | Yes | Vehicle fully enclosed check |
| `vehicle_checks.no_hazards` | boolean | Yes | No hazardous substances check |
| `vehicle_checks.no_pest` | boolean | Yes | No pest infestation check |
| `vehicle_checks.pallets_good_condition` | boolean | Yes | Pallets condition check |
| `vehicle_checks.raw_materials_good_condition` | boolean | Yes | Raw materials condition check |
| `available_batch_numbers` | array | No | List of available batch numbers by supplier |
| `available_batch_numbers[].supplier` | string | Yes | Supplier name |
| `available_batch_numbers[].next_batch` | string | Yes | Next batch number |

---

### `oil.production_data` (jsonb)

**Purpose:** Production details including manufacturing, GMP checklist, and protein powder details

**Structure:**
```json
{
  "batch_number_product_produced": "BP001",
  "name_of_product": "Food Grade Oil",
  "start_time": "08:00",
  "end_time": "16:00",
  "oil_bins": ["bin-uuid-1", "bin-uuid-2"],
  "oil_bin_details": [
    {
      "bin_id": "bin-uuid-1",
      "ibc_bn": "IBC 1",
      "literage": 1000,
      "start_time": "08:00",
      "end_time": "12:00"
    },
    {
      "bin_id": "bin-uuid-2",
      "ibc_bn": "IBC 2",
      "literage": 1000,
      "start_time": "12:00",
      "end_time": "16:00"
    },
    {
      "bin_id": "bin-uuid-3",
      "ibc_bn": "IBC 3",
      "literage": 1000
    }
  ],
  "raw_materials": [
    {
      "batch_number": "BN1",
      "weight_raw_in": 500,
      "weight_oil_out": 200,
      "weight_cake_out": 300
    }
  ],
  "recipe": {
    "oil_kernel": 500,
    "cracker_dust": 50,
    "kernel_dust": 100,
    "crush": 25,
    "cake": 150
  },
  "waste": {
    "general_waste": 10,
    "floor_waste": 5,
    "product_waste": 3,
    "oil_from_filter": 2,
    "hydraulic_press_total": 1
  },
  "gmp_checklist": {
    "date": "2026-01-05",
    "checks": [
      {
        "id": 1,
        "action": "Check that cleaning has been done correctly",
        "details": "Check that cleaning has been done according to the cleaning schedule. Pass ✓ Fail ✗",
        "checked_by": "John",
        "signed": true,
        "comments": {
          "food_grade_division": "Clean",
          "root_room": "Clean",
          "oil_press_room": "Clean",
          "non_food_grade_division": "Clean"
        }
      },
      {
        "id": 2,
        "action": "Check the daily processing temperatures",
        "details": "Check temperatures of processing room. Pass ✓ Failing",
        "checked_by": "John",
        "signed": true,
        "comments": {
          "actual_temp": 85,
          "spec_temp": "80-95",
          "variance": "< / >",
          "first_oil_press_screw": "80-95",
          "second_oil_press_screw": "110-125",
          "food_grade_line": "115-135",
          "kek": "60-75"
        }
      },
      {
        "id": 3,
        "action": "Check product in progress",
        "details": "Ensure that there is no product on the floor, and no containers left open.",
        "checked_by": "John",
        "signed": true
      },
      {
        "id": 4,
        "action": "Verify accuracy of final product scale",
        "details": "Check accuracy of packing scale using the official test weights. Tolerance: 0.100kg",
        "checked_by": "John",
        "signed": true,
        "comments": {
          "actual": "",
          "variance": "< / >",
          "scale_1": "",
          "scale_2": "",
          "scale_3": ""
        }
      },
      {
        "id": 5,
        "action": "Consumable utensil daily check",
        "details": "Check for broken utensils, or metal/plastic chips off utensils. Remove damaged utensils from production.",
        "checked_by": "John",
        "signed": true,
        "comments": {
          "stanley_knives": {"broken": false, "replaced": false},
          "cleaning_equipment": {"broken": false, "replaced": false},
          "scoops": {"broken": false, "replaced": false}
        }
      },
      {
        "id": 6,
        "action": "Check belts and machinery",
        "details": "Check that all general machinery is in good repair. If not, complete a maintenance job card.",
        "checked_by": "John",
        "signed": true
      },
      {
        "id": 7,
        "action": "Check production sheets",
        "details": "Check that daily production sheets are completed correctly.",
        "checked_by": "John",
        "signed": true
      },
      {
        "id": 8,
        "action": "Check glass and hard plastics",
        "details": "Check for cracks and chips - refer to glass and hard plastics register.",
        "checked_by": "John",
        "signed": true
      },
      {
        "id": 9,
        "action": "Hand Washing",
        "details": "Ensure that hand washing is done according to Hand Hygiene Policy.",
        "checked_by": "John",
        "signed": true
      },
      {
        "id": 10,
        "action": "Pallets",
        "details": "Ensure that all pallets are clean, and not broken before entering factory. Check that pallets are stacked neatly.",
        "checked_by": "John",
        "signed": true
      },
      {
        "id": 11,
        "action": "Rare earth magnet checks",
        "details": "Ensure that magnets are cleaned and all metal removed",
        "checked_by": "John",
        "signed": true,
        "comments": {
          "07h00": "Pass",
          "12h00": "Pass",
          "14h00": "Pass",
          "17h30": "Pass"
        }
      },
      {
        "id": 12,
        "action": "Identification of product in the factory",
        "details": "Ensure all Product are easily identifiable (name of product, production date, best before date, batch number, supplier name, etc)",
        "checked_by": "John",
        "signed": true
      }
    ]
  },
  "protein_details": {
    "press": "Press 1",
    "temperature": 85,
    "speed_infeed": 50,
    "speed_press": 30,
    "batch_number_product_produced": "BP001",
    "batch_number_oil_produced": "BO001",
    "raw_materials": [
      {
        "batch_number": "BN1",
        "weight_raw_in": 500,
        "weight_cake_out": 300,
        "total_protein_powder": 200
      }
    ],
    "comments": "Production ran smoothly"
  }
}
```

**Field Definitions:**

| Field Path | Type | Required | Description |
|------------|------|----------|-------------|
| `batch_number_product_produced` | string | Yes | Batch number of product produced |
| `name_of_product` | string | Yes | Name of product produced |
| `start_time` | string | No | Production start time (HH:MM) |
| `end_time` | string | No | Production end time (HH:MM) |
| `oil_bins` | array of uuids | Yes | References to oil_bin table |
| `oil_bin_details` | array | Yes | Detailed bin usage information |
| `oil_bin_details[].bin_id` | uuid | Yes | Reference to oil_bin.id |
| `oil_bin_details[].ibc_bn` | string | Yes | IBC bin number/name |
| `oil_bin_details[].literage` | number | Yes | Litres filled in this bin |
| `oil_bin_details[].start_time` | string | No | Start time for this bin (HH:MM) |
| `oil_bin_details[].end_time` | string | No | End time for this bin (HH:MM) |
| `raw_materials` | array | Yes | Raw materials used |
| `raw_materials[].batch_number` | string | Yes | Raw material batch number |
| `raw_materials[].weight_raw_in` | number | Yes | Raw material weight input |
| `raw_materials[].weight_oil_out` | number | Yes | Oil weight output |
| `raw_materials[].weight_cake_out` | number | Yes | Cake weight output |
| `recipe` | object | No | Recipe quantities used |
| `recipe.oil_kernel` | number | No | Oil kernel quantity |
| `recipe.cracker_dust` | number | No | Cracker dust quantity |
| `recipe.kernel_dust` | number | No | Kernel dust quantity |
| `recipe.crush` | number | No | Crush quantity |
| `recipe.cake` | number | No | Cake quantity |
| `waste` | object | Yes | Waste tracking |
| `waste.general_waste` | number | Yes | General waste amount |
| `waste.floor_waste` | number | Yes | Floor waste amount |
| `waste.product_waste` | number | Yes | Product waste amount |
| `waste.oil_from_filter` | number | No | Oil waste from filter |
| `waste.hydraulic_press_total` | number | No | Hydraulic press waste |
| `gmp_checklist` | object | Yes | Good Manufacturing Practice checklist |
| `gmp_checklist.date` | string (date) | Yes | Checklist date (YYYY-MM-DD) |
| `gmp_checklist.checks` | array | Yes | Array of GMP checks |
| `gmp_checklist.checks[].id` | number | Yes | Check ID/number |
| `gmp_checklist.checks[].action` | string | Yes | Action/check description |
| `gmp_checklist.checks[].details` | string | No | Detailed instructions |
| `gmp_checklist.checks[].checked_by` | string | Yes | Person who performed check |
| `gmp_checklist.checks[].signed` | boolean | Yes | Whether check was signed off |
| `gmp_checklist.checks[].comments` | object | No | Additional comments/data |
| `protein_details` | object | No | Protein powder production details |
| `protein_details.press` | string | Yes | Press machine used |
| `protein_details.temperature` | number | Yes | Processing temperature |
| `protein_details.speed_infeed` | number | Yes | Infeed speed setting |
| `protein_details.speed_press` | number | Yes | Press speed setting |
| `protein_details.batch_number_product_produced` | string | Yes | Product batch number |
| `protein_details.batch_number_oil_produced` | string | No | Oil batch number |
| `protein_details.raw_materials` | array | Yes | Raw materials for protein |
| `protein_details.raw_materials[].batch_number` | string | Yes | Batch number |
| `protein_details.raw_materials[].weight_raw_in` | number | Yes | Raw material input weight |
| `protein_details.raw_materials[].weight_cake_out` | number | Yes | Cake output weight |
| `protein_details.raw_materials[].total_protein_powder` | number | Yes | Total protein powder produced |
| `protein_details.comments` | string | No | Production notes |

---

### `oil.stock_data` (jsonb)

**Purpose:** Stock location and QA test results

**Structure:**
```json
{
  "location": "Warehouse A",
  "bin_location": "A-12",
  "quantity_available": 1000,
  "reserved": 200,
  "qa_tests": {
    "ffa": {
      "result": 2,
      "required": true
    },
    "moisture": {
      "result": 5,
      "required": true
    },
    "peroxide": {
      "result": 34,
      "required": true
    },
    "external_lab": {
      "result": "4",
      "required": true
    },
    "internal_micro": {
      "result": "1",
      "required": true
    },
    "completed_at": "2026-02-23T10:27:31.084424+00:00",
    "lab_test_pdf_url": "https://channelbucket.s3.af-south-1.amazonaws.com/EFS%20Assist/PreInspections/noQ1d_PGFleetInspection%20QA%20Report.pdf",
    "supervisor_signed_by": "Tester",
    "nut_plant_manager_signed_by": "Tester 1"
  },
  "sensory_evaluation": {
    "appearance": "Pass",
    "aroma_taste": "Pass",
    "texture": "Pass",
    "comments": "Product meets all sensory standards"
  }
}
```

**Field Definitions:**

| Field Path | Type | Required | Description |
|------------|------|----------|-------------|
| `location` | string | No | Storage warehouse location |
| `bin_location` | string | No | Specific bin/shelf location |
| `quantity_available` | number | Yes | Available quantity in stock |
| `reserved` | number | No | Reserved/allocated quantity |
| `qa_tests` | object | Yes | Quality assurance test results |
| `qa_tests.ffa` | object | Yes | Free Fatty Acid test |
| `qa_tests.ffa.result` | number | Yes | FFA test result value |
| `qa_tests.ffa.required` | boolean | Yes | Whether test is required |
| `qa_tests.moisture` | object | Yes | Moisture content test |
| `qa_tests.moisture.result` | number | Yes | Moisture test result value |
| `qa_tests.moisture.required` | boolean | Yes | Whether test is required |
| `qa_tests.peroxide` | object | Yes | Peroxide value test |
| `qa_tests.peroxide.result` | number | Yes | Peroxide test result value |
| `qa_tests.peroxide.required` | boolean | Yes | Whether test is required |
| `qa_tests.external_lab` | object | Yes | External laboratory test |
| `qa_tests.external_lab.result` | string | Yes | Lab test result |
| `qa_tests.external_lab.required` | boolean | Yes | Whether test is required |
| `qa_tests.internal_micro` | object | Yes | Internal microbiology test |
| `qa_tests.internal_micro.result` | string | Yes | Micro test result |
| `qa_tests.internal_micro.required` | boolean | Yes | Whether test is required |
| `qa_tests.completed_at` | string (timestamp) | Yes | QA completion timestamp (ISO 8601) |
| `qa_tests.lab_test_pdf_url` | string | No | URL to lab report PDF document |
| `qa_tests.supervisor_signed_by` | string | Yes | Supervisor name/signature |
| `qa_tests.nut_plant_manager_signed_by` | string | Yes | Plant manager name/signature |
| `sensory_evaluation` | object | No | Sensory evaluation results |
| `sensory_evaluation.appearance` | string | No | Appearance test result |
| `sensory_evaluation.aroma_taste` | string | No | Aroma and taste result |
| `sensory_evaluation.texture` | string | No | Texture test result |
| `sensory_evaluation.comments` | string | No | Sensory evaluation comments |

---

### `oil.dispatch_data` (jsonb)

**Purpose:** Dispatch orders and delivery information

**Structure:**
```json
{
  "orders": [
    {
      "order_id": "ORD001",
      "customer": "ABC Company Ltd",
      "dispatch_date": "2026-01-10",
      "lines": [
        {
          "style": "5P",
          "quantity_kg": 4
        },
        {
          "style": "0",
          "quantity_kg": 4
        },
        {
          "style": "1M",
          "quantity_kg": 1
        },
        {
          "style": "1S",
          "quantity_kg": 4
        },
        {
          "style": "4L",
          "quantity_kg": 5
        },
        {
          "style": "S",
          "quantity_kg": 2
        },
        {
          "style": "6",
          "quantity_kg": 1
        },
        {
          "style": "7/8",
          "quantity_kg": 1
        }
      ]
    }
  ]
}
```

**Field Definitions:**

| Field Path | Type | Required | Description |
|------------|------|----------|-------------|
| `orders` | array | Yes | Array of dispatch orders |
| `orders[].order_id` | string | Yes | Unique order identifier |
| `orders[].customer` | string | Yes | Customer name |
| `orders[].dispatch_date` | string (date) | Yes | Dispatch date (YYYY-MM-DD) |
| `orders[].lines` | array | Yes | Order line items |
| `orders[].lines[].style` | string | Yes | Product style/code/size |
| `orders[].lines[].quantity_kg` | number | Yes | Quantity in kilograms |

---

## Notes

### Data Types
- **string**: Text data
- **number**: Numeric values (integer or decimal)
- **boolean**: true/false values
- **array**: List of items
- **object**: Nested structure
- **uuid**: Universally unique identifier
- **string (date)**: Date in YYYY-MM-DD format
- **string (timestamp)**: ISO 8601 timestamp format

### Required vs Optional
- **Required**: Field must be present in the JSON structure
- **No/Optional**: Field can be omitted if not applicable

### References Between Tables
- `oil_batches` arrays contain UUIDs that reference `oil.id`
- `oil_bins` arrays contain UUIDs that reference `oil_bin.id`
- These create Many-to-Many relationships without foreign key constraints

### Best Practices
1. Always validate JSON structure before inserting
2. Use consistent date formats (YYYY-MM-DD for dates, ISO 8601 for timestamps)
3. Maintain array references up-to-date when creating/updating records
4. Store all numeric values as numbers, not strings
5. Use descriptive keys that match form field names

---

**Document Version:** 1.0  
**Last Updated:** 2026-02-25