# FruitLive - Module 7: Post-Harvest Management

## Overview
Farm-to-fork traceability with consignment tracking and market performance analysis.

## Key Features
- Consignment tracking (pallet → carton level)
- Full traceability (block → pack → delivery)
- Mock recall capability
- Market performance analysis
- Size distribution tracking
- Return projections
- Cold chain monitoring
- Quality issue tracking

## Database Schema

```sql
CREATE TABLE consignments (
    id UUID PRIMARY KEY,
    consignment_number VARCHAR(50) UNIQUE,
    farm_id UUID REFERENCES farms(id),
    pack_date DATE,
    variety_id UUID REFERENCES varieties(id),
    block_id UUID REFERENCES blocks(id),
    carton_count INT,
    pallet_count INT,
    destination_market VARCHAR(100),
    destination_country VARCHAR(100),
    packaging_type VARCHAR(50),
    exporter VARCHAR(255),
    status VARCHAR(20), -- 'packed', 'in_transit', 'delivered'
    delivery_date DATE,
    estimated_value DECIMAL(12,2),
    actual_value DECIMAL(12,2),
    created_at TIMESTAMP
);

CREATE TABLE pallets (
    id UUID PRIMARY KEY,
    pallet_number VARCHAR(50) UNIQUE,
    consignment_id UUID REFERENCES consignments(id),
    carton_count INT,
    gross_weight DECIMAL(10,2),
    cold_chain_maintained BOOLEAN DEFAULT TRUE,
    temperature_log JSONB,
    created_at TIMESTAMP
);

CREATE TABLE cartons (
    id UUID PRIMARY KEY,
    carton_id VARCHAR(50) UNIQUE,
    pallet_id UUID REFERENCES pallets(id),
    consignment_id UUID REFERENCES consignments(id),
    block_id UUID REFERENCES blocks(id),
    variety_id UUID REFERENCES varieties(id),
    pack_date DATE,
    pack_line VARCHAR(50),
    pack_house VARCHAR(255),
    picker_team_id UUID,
    grade VARCHAR(20),
    size VARCHAR(20),
    weight DECIMAL(8,2),
    batch_number VARCHAR(100),
    created_at TIMESTAMP
);

CREATE TABLE market_performance (
    id UUID PRIMARY KEY,
    consignment_id UUID REFERENCES consignments(id),
    market VARCHAR(100),
    cartons_sent INT,
    avg_price_per_carton DECIMAL(10,2),
    total_revenue DECIMAL(12,2),
    quality_feedback TEXT,
    rating INT, -- 1-5
    created_at TIMESTAMP
);

CREATE TABLE traceability_chain (
    id UUID PRIMARY KEY,
    carton_id UUID REFERENCES cartons(id),
    chain_data JSONB, -- Complete chain from orchard to customer
    created_at TIMESTAMP
);
```

## API Endpoints

### GET /api/post-harvest/consignments?farmId=&status=
### POST /api/post-harvest/consignments
### GET /api/post-harvest/consignments/:id
### GET /api/post-harvest/trace/:cartonId
### POST /api/post-harvest/market-performance
### GET /api/post-harvest/size-distribution?farmId=&varietyId=&seasonYear=
### POST /api/post-harvest/mock-recall

## Business Logic

```typescript
async function traceCarton(cartonId: string) {
  const carton = await getCarton(cartonId);
  const pallet = await getPallet(carton.palletId);
  const consignment = await getConsignment(carton.consignmentId);
  const block = await getBlock(carton.blockId);
  
  // Get all related records
  const sprayRecords = await getSprayApplications({
    blockId: carton.blockId,
    beforeDate: carton.packDate
  });
  
  const labourRecords = await getLabourAllocations({
    blockId: carton.blockId,
    date: carton.pickDate
  });
  
  return {
    carton: {
      id: carton.cartonId,
      packDate: carton.packDate,
      packHouse: carton.packHouse,
      packLine: carton.packLine,
      grade: carton.grade,
      size: carton.size
    },
    origin: {
      farm: block.farm.name,
      block: block.name,
      variety: carton.variety.name,
      rows: "12-15" // From labour records
    },
    picking: {
      date: carton.pickDate,
      team: labourRecords[0].indunaName,
      workers: labourRecords.length
    },
    treatments: sprayRecords.map(s => ({
      date: s.applicationDate,
      chemical: s.chemical.tradeName,
      phi: s.phiDate,
      compliant: s.phiDate < carton.packDate
    })),
    coldChain: {
      maintained: pallet.coldChainMaintained,
      temperatureLog: pallet.temperatureLog
    },
    delivery: {
      consignmentNumber: consignment.consignmentNumber,
      destination: consignment.destinationMarket,
      deliveryDate: consignment.deliveryDate,
      customer: consignment.exporter
    }
  };
}
```

## UI Components

```tsx
interface ConsignmentTrackerProps {
  farmId: string;
  consignments: Consignment[];
  onRecordConsignment: (input: ConsignmentInput) => void;
}

interface TraceabilitySearchProps {
  onSearch: (cartonId: string) => void;
  traceResult: TraceabilityChain | null;
}

interface MarketAnalysisProps {
  farmId: string;
  seasonYear: number;
  performance: MarketPerformance[];
}
```
