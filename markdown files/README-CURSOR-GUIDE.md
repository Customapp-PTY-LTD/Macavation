# FruitLive Module Specifications - Cursor Implementation Guide

## Overview
This directory contains comprehensive technical specifications for all 9 modules of the FruitLive farm management platform. Each specification is designed to be used with Cursor AI to generate production-ready code.

## Module List

1. **Dashboard** (`01-dashboard-spec.md`) - Command center with multi-farm selector and KPIs
2. **Labour Management** (`02-labour-management-spec.md`) - Workforce allocation and cross-farm transfers
3. **Compliance & Audits** (`03-compliance-audits-spec.md`) - Global GAP and certification management
4. **Chemical Management** (`04-chemical-management-spec.md`) - Spray programs and PHI tracking
5. **Crop Monitoring** (`05-crop-monitoring-spec.md`) - Growth curves and yield projections
6. **Asset Management** (`06-asset-management-spec.md`) - Fleet, fuel, and equipment tracking
7. **Post-Harvest** (`07-post-harvest-spec.md`) - Traceability and market analysis
8. **Water & Irrigation** (`08-water-irrigation-spec.md`) - Water license compliance
9. **Administration** (`09-administration-spec.md`) - Multi-farm portfolio and user management

## How to Use with Cursor

### Method 1: Module-by-Module Generation

1. **Start with Core Infrastructure**
   ```bash
   # In Cursor, open a new project
   # Create the base directory structure first
   ```

2. **Create Database Schema**
   - Open `01-dashboard-spec.md` in Cursor
   - Ask Cursor: "Generate the PostgreSQL database schema from this spec"
   - Review and apply migrations
   - Repeat for each module

3. **Generate API Endpoints**
   - Open module spec in Cursor
   - Ask Cursor: "Generate the API endpoints defined in this spec using Express and TypeScript"
   - For each module, create `src/api/[module-name]/routes.ts`

4. **Create React Components**
   - Ask Cursor: "Generate all React components from the UI Components section"
   - Components will be created in `src/features/[module-name]/components/`

5. **Implement Business Logic**
   - Ask Cursor: "Implement the business logic functions from this spec"
   - Logic goes in `src/features/[module-name]/services/`

### Method 2: Full Stack Generation

Ask Cursor to generate the entire module at once:

```
Using the specification in [module-name-spec.md], generate:
1. Database schema (Prisma/TypeORM)
2. API routes with validation
3. React components with TypeScript
4. Redux state management
5. API service layer

Follow the file structure defined in the spec.
```

### Method 3: Specific Component Generation

For targeted development:

```
From 02-labour-management-spec.md, generate only:
- The WorkerList component with filters
- The API endpoint GET /api/labour/workers
- The Redux slice for worker state management
```

## Database Setup

### Using Prisma (Recommended)

1. **Initialize Prisma**
   ```bash
   npm install prisma @prisma/client
   npx prisma init
   ```

2. **Generate Schema from Specs**
   - Combine all SQL schemas from module specs
   - Convert to Prisma schema format
   - Ask Cursor: "Convert this SQL schema to Prisma schema"

3. **Run Migrations**
   ```bash
   npx prisma migrate dev --name init
   ```

### Using Raw SQL

1. **Create Migration Files**
   - Extract SQL from each module spec
   - Create numbered migration files: `001_dashboard.sql`, `002_labour.sql`, etc.

2. **Apply Migrations**
   ```bash
   psql -U postgres -d fruitlive < migrations/001_dashboard.sql
   ```

## Frontend Setup

### Technology Stack
- **Framework**: React 18+ with TypeScript
- **State Management**: Redux Toolkit + RTK Query
- **Styling**: Tailwind CSS or Bootstrap 5
- **Routing**: React Router v6
- **Forms**: React Hook Form + Zod
- **Charts**: Recharts
- **Date Handling**: date-fns

### Project Structure
```
src/
├── features/
│   ├── dashboard/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── services/
│   │   ├── slices/
│   │   └── pages/
│   ├── labour/
│   ├── compliance/
│   ├── chemicals/
│   ├── crops/
│   ├── assets/
│   ├── postHarvest/
│   ├── water/
│   └── admin/
├── shared/
│   ├── components/
│   ├── hooks/
│   ├── utils/
│   └── types/
├── store/
└── App.tsx
```

## Backend Setup

### Technology Stack
- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Database**: PostgreSQL 14+
- **ORM**: Prisma or TypeORM
- **Validation**: Zod
- **Authentication**: JWT
- **File Storage**: S3 or local with Multer

### Project Structure
```
src/
├── api/
│   ├── dashboard/
│   │   ├── routes.ts
│   │   ├── controllers.ts
│   │   └── validators.ts
│   ├── labour/
│   ├── compliance/
│   └── [other modules]
├── services/
├── middleware/
├── utils/
└── server.ts
```

## Development Workflow

### Phase 1: Core Setup (Week 1)
1. Set up database and schemas
2. Implement authentication
3. Create base UI components (Navbar, Layout)
4. Set up Redux store

### Phase 2: Core Modules (Weeks 2-4)
1. **Week 2**: Dashboard + Labour Management
2. **Week 3**: Compliance + Chemical Management
3. **Week 4**: Crop Monitoring + Asset Management

### Phase 3: Advanced Modules (Weeks 5-6)
1. **Week 5**: Post-Harvest + Water & Irrigation
2. **Week 6**: Administration module

### Phase 4: Integration & Testing (Week 7-8)
1. Cross-module integration
2. End-to-end testing
3. Performance optimization
4. Security hardening

## Cursor Prompts Cheat Sheet

### For Database Schema
```
Generate a Prisma schema from the SQL in this spec, using:
- UUID for all IDs
- Proper relations
- Enums for status fields
- Timestamps for audit trails
```

### For API Routes
```
Create Express routes for [module] with:
- TypeScript types
- Zod validation
- Error handling
- Async/await patterns
- Proper HTTP status codes
```

### For React Components
```
Create a [ComponentName] component with:
- TypeScript props interface
- React Hook Form for forms
- Tailwind CSS styling
- Proper loading/error states
- Accessibility (ARIA labels)
```

### For State Management
```
Create a Redux slice for [module] with:
- TypeScript types
- RTK Query for API calls
- Proper selectors
- Optimistic updates
```

## Testing Strategy

### Unit Tests
Ask Cursor to generate:
```
Generate Jest unit tests for the business logic in this spec:
- Test all edge cases
- Mock database calls
- Test validation
- Test error handling
```

### Integration Tests
```
Generate integration tests for the API endpoints:
- Test full request/response cycle
- Test authentication
- Test database interactions
- Use test database
```

### E2E Tests
```
Generate Playwright E2E tests for:
- User login flow
- [Specific workflow from spec]
- Form submission
- Navigation
```

## Environment Variables

Create `.env` file:
```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/fruitlive

# API
API_PORT=3000
API_URL=http://localhost:3000

# Authentication
JWT_SECRET=your-secret-key
JWT_EXPIRY=7d

# File Storage
STORAGE_TYPE=local # or 's3'
STORAGE_PATH=./uploads
AWS_S3_BUCKET=fruitlive-uploads

# Email (for alerts)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-password
```

## Deployment

### Production Checklist
- [ ] Environment variables set
- [ ] Database migrations applied
- [ ] Build optimizations enabled
- [ ] Error logging configured (Sentry)
- [ ] HTTPS enabled
- [ ] CORS configured
- [ ] Rate limiting enabled
- [ ] Database backups scheduled

### Docker Setup
Ask Cursor to generate:
```
Create Docker configuration for this application:
- Multi-stage build for frontend
- Node.js backend container
- PostgreSQL database
- Nginx reverse proxy
- Docker Compose for local development
```

## Common Issues & Solutions

### Database Migrations
**Issue**: Foreign key constraint errors
**Solution**: Ensure migrations run in correct order (parent tables first)

### API Performance
**Issue**: Slow queries with joins
**Solution**: Add database indexes as specified in module specs

### Frontend Bundle Size
**Issue**: Large bundle size
**Solution**: 
- Use code splitting per module
- Lazy load routes
- Tree-shake unused components

## Support & Documentation

### Additional Resources
- **Prisma Docs**: https://www.prisma.io/docs
- **Redux Toolkit**: https://redux-toolkit.js.org
- **React Hook Form**: https://react-hook-form.com
- **Tailwind CSS**: https://tailwindcss.com/docs

### Getting Help
1. Review the specific module spec thoroughly
2. Use Cursor's "Explain this code" feature
3. Ask Cursor to debug specific issues
4. Reference the integration points section for cross-module dependencies

## Next Steps

1. **Choose Your Starting Point**
   - Start with Dashboard (simplest)
   - Or start with Administration (core infrastructure)

2. **Set Up Development Environment**
   - Install dependencies
   - Configure database
   - Set up environment variables

3. **Generate First Module**
   - Open spec in Cursor
   - Follow Method 1 or 2 above
   - Test thoroughly

4. **Iterate**
   - Add modules one at a time
   - Test integration after each module
   - Refactor shared components

## Success Criteria

Your implementation should:
- ✅ Match the database schema exactly
- ✅ Implement all specified API endpoints
- ✅ Include all UI components listed
- ✅ Handle all business logic cases
- ✅ Pass integration tests
- ✅ Follow TypeScript best practices
- ✅ Be mobile responsive
- ✅ Include proper error handling
- ✅ Have comprehensive logging

## Tips for Using Cursor Effectively

1. **Be Specific**: Reference exact sections of the spec
2. **Iterate**: Generate, review, refine, repeat
3. **Test Early**: Ask Cursor to generate tests alongside code
4. **Use Context**: Keep related specs open for cross-module features
5. **Review Code**: Don't blindly accept generated code - review and understand it
6. **Customize**: Specs are comprehensive but you can adapt to your needs

---

**Ready to build FruitLive?** Start with the Dashboard spec and let Cursor guide you through creating a world-class farm management platform! 🚀
