# Documentation Index

Complete guide to using this template for building new applications.

## Getting Started

1. **New to the template?** Start with `SETUP.md`
2. **Understanding architecture?** Read `PATTERNS.md`
3. **Creating your first module?** Follow `MODULE_GUIDE.md`
4. **Need quick reference?** Check `QUICK_REFERENCE.md`

## Documentation Files

### Setup & Configuration

- **[SETUP.md](SETUP.md)** - Complete setup guide for new projects
  - Step-by-step installation
  - Configuration instructions
  - Environment setup
  - Testing and deployment

### Architecture & Patterns

- **[PATTERNS.md](PATTERNS.md)** - Design patterns and architecture
  - Module-based routing pattern
  - Data layer abstraction
  - RBAC implementation
  - Error handling patterns
  - Common design principles

- **[LESSONS_LEARNED.md](LESSONS_LEARNED.md)** - Production lessons learned
  - Common mistakes and solutions
  - Timing issues and fixes
  - Authentication flow patterns
  - Cache invalidation strategies
  - Critical anti-patterns to avoid

### Development Guides

- **[MODULE_GUIDE.md](MODULE_GUIDE.md)** - Creating new modules
  - Step-by-step module creation
  - Template file customization
  - Integration with routing
  - Common customizations
  - Troubleshooting

- **[RBAC_GUIDE.md](RBAC_GUIDE.md)** - Role-Based Access Control
  - Database structure
  - Permission setup
  - Frontend checks
  - Best practices
  - Common patterns

- **[DATABASE_GUIDE.md](DATABASE_GUIDE.md)** - Database patterns
  - Table design
  - Function templates
  - Naming conventions
  - Security best practices
  - Common patterns

### Reference

- **[QUICK_REFERENCE.md](QUICK_REFERENCE.md)** - Quick lookup guide
  - Common code snippets
  - Function naming patterns
  - Configuration examples
  - Error solutions
  - File locations

## Template Files

### Module Templates

Location: `templates/module/`

- `module_html_template.html` - HTML template for modules
- `module_js_template.js` - JavaScript template for modules
- `module_css_template.css` - CSS template for modules

**Usage**: Copy to `modules/[your-module]/` and replace placeholders.

### Database Templates

Location: `templates/database/`

- `example_table.sql` - Table creation template
- `example_functions.sql` - Database function templates (CRUD)
- `rbac_setup.sql` - RBAC permission setup template

**Usage**: Copy to Supabase SQL Editor, modify, and execute.

## Recommended Reading Order

### For New Projects

1. **SETUP.md** - Get your project set up
2. **PATTERNS.md** - Understand the architecture
3. **LESSONS_LEARNED.md** - Avoid common mistakes
4. **MODULE_GUIDE.md** - Create your first module
5. **RBAC_GUIDE.md** - Set up security
6. **DATABASE_GUIDE.md** - Create database functions

### For Quick Tasks

1. **QUICK_REFERENCE.md** - Find what you need quickly
2. Specific guide for your task (MODULE_GUIDE, RBAC_GUIDE, etc.)

### For Understanding Architecture

1. **PATTERNS.md** - Core patterns and principles
2. **LESSONS_LEARNED.md** - Why decisions were made
3. **MODULE_GUIDE.md** - See patterns in action

## Key Concepts

### Module-Based Architecture

Each feature is a self-contained module:
- `modules/[module-name]/html/` - UI template
- `modules/[module-name]/js/` - Module logic
- `modules/[module-name]/css/` - Module styles

### Data Layer Abstraction

All API calls go through `data-functions.js`:
- Consistent error handling
- Built-in caching
- Rate limiting
- Request/response logging

### RBAC Security

Database-level permissions:
- `roles` table - User roles
- `role_permissions` table - Permissions mapping
- Lambda proxy checks permissions

### Function Naming

Consistent database function naming:
- `get_[entity]s()` - List all
- `get_[entity]_by_id(p_id)` - Get one
- `create_[entity]_simple(p_*)` - Create
- `update_[entity]_simple(p_id, p_*)` - Update
- `delete_[entity]_hard(p_id)` - Delete

## Common Workflows

### Creating a New Module

1. Copy module templates
2. Replace placeholders
3. Create database table
4. Create database functions
5. Add RBAC permissions
6. Add data functions
7. Add route configuration
8. Add router initializer
9. Test module

**Guide**: `MODULE_GUIDE.md`

### Setting Up RBAC

1. Create roles in database
2. Create database functions with SECURITY DEFINER
3. Add permissions to role_permissions table
4. Test with different user roles

**Guide**: `RBAC_GUIDE.md`

### Database Setup

1. Create table with standard fields
2. Create CRUD functions
3. Add error handling
4. Add RBAC permissions
5. Test functions

**Guide**: `DATABASE_GUIDE.md`

## Troubleshooting

**Module not loading?**
- Check `MODULE_GUIDE.md` troubleshooting section
- Verify route configuration
- Check router initializer

**Data not loading?**
- See `LESSONS_LEARNED.md` - Data Functions Timing Issues
- Check data-functions.js configuration
- Verify database functions exist

**Permission errors?**
- See `RBAC_GUIDE.md` troubleshooting
- Check role_permissions table
- Verify user's role assignment

**Need quick code?**
- Check `QUICK_REFERENCE.md` for snippets
- Copy from template files
- Reference existing modules

## Additional Resources

- Template files in `templates/` directory
- Example module structure in `modules/example-module/`
- Configuration templates in root directory
- Original FruitLive implementation (for reference)

## Getting Help

1. Check relevant documentation file
2. Review template examples
3. Check `QUICK_REFERENCE.md` for quick answers
4. Review `LESSONS_LEARNED.md` for common issues
5. Review original FruitLive patterns

## Version

Template Version: 1.0.0
Last Updated: 2024
Based on: FruitLive Production Architecture

