# FruitLive - Module 5: Crop Monitoring

## Overview
Growth curve intelligence for accurate yield and sizing projections to pack sheds.

## Key Features
- Fruit size tracking (circumference, length, weight)
- Growth curves by variety/block/farm
- Year-on-year comparison
- Yield & sizing projections
- Quality sampling records
- Nematode monitoring from lab data
- Weekly fruit measurements
- Export projections to pack sheds

## Database Schema

```sql
CREATE TABLE fruit_measurements (
    id UUID PRIMARY KEY,
    farm_id UUID REFERENCES farms(id),
    block_id UUID REFERENCES blocks(id),
    variety_id UUID REFERENCES varieties(id),
    measurement_date DATE,
    days_after_full_bloom INT,
    sample_size INT,
    circumference_avg DECIMAL(6,2), -- mm
    circumference_min DECIMAL(6,2),
    circumference_max DECIMAL(6,2),
    length_avg DECIMAL(6,2), -- mm
    weight_avg DECIMAL(8,2), -- grams
    color_score DECIMAL(4,2),
    firmness DECIMAL(6,2),
    dry_matter DECIMAL(5,2),
    notes TEXT,
    measured_by UUID REFERENCES users(id),
    created_at TIMESTAMP
);

CREATE TABLE growth_curves (
    id UUID PRIMARY KEY,
    farm_id UUID REFERENCES farms(id),
    variety_id UUID REFERENCES varieties(id),
    season_year INT,
    full_bloom_date DATE,
    curve_data JSONB, -- Array of {day, size}
    created_at TIMESTAMP
);

CREATE TABLE yield_projections (
    id UUID PRIMARY KEY,
    farm_id UUID REFERENCES farms(id),
    block_id UUID REFERENCES blocks(id),
    variety_id UUID REFERENCES varieties(id),
    projection_date DATE,
    harvest_date_estimated DATE,
    total_cartons INT,
    size_distribution JSONB, -- {65mm: 120, 70mm: 450, ...}
    confidence_score DECIMAL(4,2),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP
);

CREATE TABLE nematode_samples (
    id UUID PRIMARY KEY,
    farm_id UUID REFERENCES farms(id),
    block_id UUID REFERENCES blocks(id),
    sample_date DATE,
    lab_name VARCHAR(255),
    nematode_count INT,
    nematode_type VARCHAR(100),
    severity VARCHAR(20),
    recommendation TEXT,
    lab_report_url VARCHAR(500),
    created_at TIMESTAMP
);

CREATE TABLE quality_samples (
    id UUID PRIMARY KEY,
    farm_id UUID REFERENCES farms(id),
    block_id UUID REFERENCES blocks(id),
    variety_id UUID REFERENCES varieties(id),
    sample_date DATE,
    brix DECIMAL(4,2),
    firmness DECIMAL(6,2),
    color_percentage DECIMAL(5,2),
    dry_matter DECIMAL(5,2),
    defects_percentage DECIMAL(5,2),
    grade VARCHAR(20), -- 'Class 1', 'Class 2'
    agent_name VARCHAR(255),
    created_at TIMESTAMP
);
```

## API Endpoints

### GET /api/crops/measurements?farmId=&blockId=&seasonYear=
### POST /api/crops/measurements
### GET /api/crops/growth-curves/:varietyId/:seasonYear
### GET /api/crops/projections/:farmId
### POST /api/crops/quality-samples
### GET /api/crops/nematodes/:blockId

## Business Logic

```typescript
async function calculateGrowthCurve(varietyId: string, seasonYear: number) {
  const measurements = await getMeasurements({ varietyId, seasonYear });
  const fullBloomDate = await getFullBloomDate(varietyId, seasonYear);
  
  const curveData = measurements.map(m => ({
    day: differenceInDays(m.measurementDate, fullBloomDate),
    size: m.circumferenceAvg
  }));
  
  return {
    varietyId,
    seasonYear,
    fullBloomDate,
    curveData,
    projectedHarvestSize: predictFinalSize(curveData)
  };
}

async function projectYield(blockId: string) {
  const currentMeasurements = await getLatestMeasurements(blockId);
  const historicalCurves = await getHistoricalCurves(blockId);
  
  // Compare current growth to historical
  const growthRate = calculateGrowthRate(currentMeasurements);
  const sizeDistribution = predictSizeDistribution(
    currentMeasurements,
    historicalCurves,
    growthRate
  );
  
  return {
    blockId,
    estimatedHarvestDate: predictHarvestDate(growthRate),
    totalCartons: calculateExpectedCartons(blockId, sizeDistribution),
    sizeDistribution,
    confidenceScore: calculateConfidence(currentMeasurements, historicalCurves)
  };
}
```

## UI Components

```tsx
interface GrowthCurveChartProps {
  farmId: string;
  varietyId: string;
  seasonYear: number;
  compareSeasons: number[]; // Previous years to overlay
}

interface YieldProjectionDashboardProps {
  farmId: string;
  projections: YieldProjection[];
  onExport: () => void; // Export to pack shed
}

interface FruitMeasurementFormProps {
  farmId: string;
  blocks: Block[];
  onSubmit: (measurement: MeasurementInput) => void;
}
```

## Dependencies
```json
{
  "dependencies": {
    "recharts": "^2.7.2",
    "regression": "^2.0.1"
  }
}
```
