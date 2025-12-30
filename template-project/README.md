# Project Template - Based on FruitLive Architecture

This template provides a complete scaffolding for building enterprise applications using the proven patterns from FruitLive. It includes all the structure, patterns, and lessons learned to help you build robust, scalable applications quickly.

## Quick Start

1. **Copy this template** to your new project directory
2. **Update configuration** files with your project details (see `SETUP.md`)
3. **Configure your backend** (Supabase/Lambda or your API)
4. **Start building modules** using the module template

## What's Included

### ✅ Complete Folder Structure
- Core JavaScript utilities and services
- Module-based architecture
- Routing configuration
- PWA support
- Testing setup

### ✅ Design Patterns
- Module-based routing pattern
- Data layer abstraction (data-functions.js)
- RBAC (Role-Based Access Control)
- Authentication & authorization
- Error handling & logging
- Performance monitoring
- Response caching
- Input validation & sanitization

### ✅ Best Practices
- Security-first approach
- Process-driven design
- Exception-based workflows
- Offline-first PWA capabilities
- Comprehensive error handling

### ✅ Lessons Learned
- Common pitfalls and how to avoid them
- Data loading timing issues
- Authentication flow patterns
- Module initialization patterns
- Cache invalidation strategies

## Architecture Overview

```
YourApp/
├── js/                    # Core application files
│   ├── appRouter.js       # Module-based routing system
│   ├── data-functions.js  # Data layer abstraction
│   ├── auth-service.js    # Authentication service
│   └── ...
├── modules/               # Feature modules
│   └── example-module/    # Template module
│       ├── html/
│       ├── js/
│       └── css/
├── css/                   # Global styles
├── templates/             # Template files for new modules
└── docs/                  # Documentation & guides
```

## Key Design Principles

1. **Module-Based Architecture**: Each feature is a self-contained module with HTML, JS, and CSS
2. **Separation of Concerns**: Clear separation between data layer, routing, and UI
3. **RBAC-First**: Role-based access control built into the foundation
4. **Security by Default**: Input validation, sanitization, and SQL injection prevention
5. **Performance Optimized**: Caching, rate limiting, and lazy loading
6. **Offline-First**: PWA capabilities for field workers and mobile users

## Documentation

- **SETUP.md** - Detailed setup instructions
- **PATTERNS.md** - Design patterns and architecture decisions
- **LESSONS_LEARNED.md** - Common mistakes and solutions
- **RBAC_GUIDE.md** - Role-Based Access Control implementation
- **MODULE_GUIDE.md** - How to create new modules
- **DATABASE_GUIDE.md** - Database schema patterns and examples

## Next Steps

1. Read `SETUP.md` for configuration instructions
2. Review `PATTERNS.md` to understand the architecture
3. Check `LESSONS_LEARNED.md` to avoid common pitfalls
4. Use the module template to create your first feature
5. Follow the RBAC guide when adding new database functions

## Support

For questions or issues, refer to the documentation files or the original FruitLive implementation.

