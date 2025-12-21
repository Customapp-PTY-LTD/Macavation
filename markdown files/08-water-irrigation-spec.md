# FruitLive - Module 8: Water & Irrigation

## Overview
Water license compliance with daily pump meter readings and irrigation scheduling.

## Key Features
- Pump meter reading capture
- Usage by block (m³/hectare)
- License allocation tracking
- Irrigation scheduling
- Efficiency analytics
- Global GAP water records
- License threshold alerts

## Database Schema

```sql
CREATE TABLE water_licenses (
    id UUID PRIMARY KEY,
    farm_id UUID REFERENCES farms(id),
    license_number VARCHAR(100),
    source VARCHAR(100), -- 'borehole', 'river', 'dam'
    annual_allocation INT, -- cubic meters
    allocation_period VARCHAR(20), -- 'annual', 'seasonal'
    start_date DATE,
    end_date DATE,
    license_document_url VARCHAR(500),
    created_at TIMESTAMP
);

CREATE TABLE pump_stations (
    id UUID PRIMARY KEY,
    farm_id UUID REFERENCES farms(id),
    name VARCHAR(100),
    location VARCHAR(255),
    water_source VARCHAR(100),
    meter_type VARCHAR(50),
    capacity_m3_per_hour DECIMAL(10,2),
    created_at TIMESTAMP
);

CREATE TABLE pump_readings (
    id UUID PRIMARY KEY,
    pump_station_id UUID REFERENCES pump_stations(id),
    reading_date DATE,
    reading_time TIME,
    meter_reading INT, -- Total cumulative reading
    daily_usage INT, -- m³ used that day
    operator_id UUID REFERENCES workers(id),
    notes TEXT,
    created_at TIMESTAMP
);

CREATE TABLE irrigation_schedules (
    id UUID PRIMARY KEY,
    farm_id UUID REFERENCES farms(id),
    block_id UUID REFERENCES blocks(id),
    schedule_date DATE,
    duration_hours DECIMAL(4,2),
    estimated_volume_m3 DECIMAL(10,2),
    actual_volume_m3 DECIMAL(10,2),
    irrigation_method VARCHAR(50), -- 'drip', 'micro', 'overhead'
    status VARCHAR(20), -- 'scheduled', 'in_progress', 'completed'
    completed_at TIMESTAMP,
    created_at TIMESTAMP
);

CREATE TABLE block_water_usage (
    id UUID PRIMARY KEY,
    farm_id UUID REFERENCES farms(id),
    block_id UUID REFERENCES blocks(id),
    usage_date DATE,
    volume_m3 DECIMAL(10,2),
    hectares DECIMAL(10,2),
    m3_per_hectare DECIMAL(10,2),
    created_at TIMESTAMP
);
```

## API Endpoints

### GET /api/water/licenses?farmId=
### GET /api/water/pump-readings?farmId=&startDate=&endDate=
### POST /api/water/pump-readings
### GET /api/water/usage-summary?farmId=&year=
### GET /api/water/schedules?farmId=&date=
### POST /api/water/schedules
### GET /api/water/efficiency/:blockId

## Business Logic

```typescript
async function calculateDailyUsage(pumpStationId: string, date: Date) {
  const todayReading = await getPumpReading(pumpStationId, date);
  const yesterdayReading = await getPumpReading(
    pumpStationId, 
    subDays(date, 1)
  );
  
  const dailyUsage = todayReading.meterReading - yesterdayReading.meterReading;
  
  await updatePumpReading(todayReading.id, { dailyUsage });
  
  return dailyUsage;
}

async function checkLicenseCompliance(farmId: string, year: number) {
  const license = await getWaterLicense(farmId, year);
  const totalUsage = await getTotalWaterUsage(farmId, year);
  
  const percentageUsed = (totalUsage / license.annualAllocation) * 100;
  
  if (percentageUsed > 90) {
    await createAlert({
      farmId,
      type: 'critical',
      message: `Water usage at ${percentageUsed}% of annual allocation`
    });
  }
  
  return {
    allocation: license.annualAllocation,
    used: totalUsage,
    remaining: license.annualAllocation - totalUsage,
    percentageUsed
  };
}
```

## UI Components

```tsx
interface PumpReadingFormProps {
  farmId: string;
  pumpStations: PumpStation[];
  onSubmit: (reading: ReadingInput) => void;
}

interface WaterUsageDashboardProps {
  farmId: string;
  license: WaterLicense;
  currentUsage: number;
  byBlock: BlockUsage[];
}

interface IrrigationSchedulerProps {
  farmId: string;
  blocks: Block[];
  schedules: IrrigationSchedule[];
  onSchedule: (schedule: ScheduleInput) => void;
}
```
