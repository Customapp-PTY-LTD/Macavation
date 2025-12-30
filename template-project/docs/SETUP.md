# Setup Guide

This guide will help you set up a new project using this template.

## Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- Code editor (VS Code recommended)
- Supabase account (for backend)
- AWS account (for Lambda proxy, optional)

## Step 1: Copy Template

```bash
# Copy the template to your project directory
cp -r template-project /path/to/your-new-project
cd /path/to/your-new-project

# Or clone and use as starting point
git clone <template-repo> your-project-name
cd your-project-name
```

## Step 2: Update Project Configuration

### 2.1 Update package.json

Edit `package.json`:
```json
{
  "name": "your-project-name",
  "version": "1.0.0",
  "description": "Your project description"
}
```

### 2.2 Update appRouteConfig.json

Edit `js/appRouteConfig.json`:
```json
{
  "defaultRoute": "dashboard",
  "environmentSettings": {
    "default": {
      "SupabaseUrl": "YOUR_SUPABASE_URL",
      "LambdaProxyUrl": "YOUR_LAMBDA_PROXY_URL"
    }
  }
}
```

Replace:
- `YOUR_SUPABASE_URL`: Your Supabase project URL
- `YOUR_LAMBDA_PROXY_URL`: Your Lambda proxy URL (if using)

### 2.3 Update manifest.json

Edit `manifest.json`:
```json
{
  "name": "Your App Name",
  "short_name": "YourApp",
  "description": "Your app description",
  "theme_color": "#YOUR_THEME_COLOR"
}
```

### 2.4 Update index.html

Edit `index.html`:
- Update title and meta tags
- Update navbar brand name
- Update navigation links
- Update favicon path

## Step 3: Install Dependencies

```bash
npm install
```

## Step 4: Set Up Backend (Supabase)

### 4.1 Create Supabase Project

1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Create new project
3. Note your project URL and anon key

### 4.2 Set Up Database Schema

1. Go to SQL Editor in Supabase
2. Create tables following patterns in `templates/database/`
3. Create RBAC tables (roles, role_permissions, users)
4. Create database functions

See `docs/DATABASE_GUIDE.md` for detailed database setup.

### 4.3 Configure RBAC

1. Create roles in `roles` table
2. Set up permissions in `role_permissions` table
3. Assign roles to users

See `docs/RBAC_GUIDE.md` for RBAC setup.

## Step 5: Configure Authentication

### 5.1 Update Auth Configuration

Edit `js/auth-service.js`:
- Update Lambda proxy URL
- Update authentication endpoints
- Configure token storage

### 5.2 Create Sign-in Page

Copy and customize `signin.html`:
- Update branding
- Update authentication flow
- Configure OAuth providers (if using)

## Step 6: Update Data Functions

Edit `js/data-functions.js`:
- Update `proxyUrl` to your Lambda proxy URL
- Add your database function methods
- Configure cache invalidation mapping

## Step 7: Create Your First Module

1. Copy module template:
```bash
cp -r templates/module/* modules/your-module-name/
```

2. Rename files and update content:
- Replace `[MODULE_NAME]` with your module name
- Replace `[MODULE_NAME_DISPLAY]` with display name
- Update HTML, JS, and CSS

3. Add route to `js/appRouteConfig.json`

4. Add initializer to `js/appRouter.js`

5. Add navigation link to `index.html`

See `docs/MODULE_GUIDE.md` for detailed module creation.

## Step 8: Set Up PWA (Optional)

### 8.1 Generate Icons

Generate PWA icons in different sizes:
- 72x72, 96x96, 128x128, 144x144, 152x152
- 192x192, 384x384, 512x512

Place them in `icons/` directory.

### 8.2 Update Service Worker

Edit `sw.js`:
- Update cache version
- Update static assets list
- Configure caching strategies

### 8.3 Test PWA

1. Serve application over HTTPS
2. Open Chrome DevTools > Application > Service Workers
3. Test offline functionality

## Step 9: Environment Configuration

### 9.1 Development

For local development:
- Update `appRouteConfig.json` dev settings
- Use local Supabase instance or dev project
- Configure CORS if needed

### 9.2 Production

For production:
- Update `appRouteConfig.json` prod settings
- Set up production Supabase project
- Configure production Lambda proxy
- Set up CI/CD pipeline

## Step 10: Testing

### 10.1 Install Test Dependencies

```bash
npm install --save-dev @playwright/test
```

### 10.2 Run Tests

```bash
# Run all tests
npm test

# Run in headed mode
npm run test:headed

# Run with UI
npm run test:ui
```

## Step 11: Build and Deploy

### 11.1 Build for Production

```bash
npm run build
```

This will:
- Bundle JavaScript
- Minify CSS
- Optimize assets

### 11.2 Deploy

Deploy the built files to your hosting provider:
- Static hosting (Netlify, Vercel, GitHub Pages)
- S3 + CloudFront
- Your own server

## Common Setup Issues

### Issue: dataFunctions not available

**Solution**: Ensure scripts load in correct order in `index.html`:
1. jQuery
2. Bootstrap
3. common.js
4. data-functions.js
5. appRouter.js

### Issue: CORS errors

**Solution**: 
- Configure CORS in Supabase dashboard
- Configure CORS in Lambda proxy
- Use proxy if needed

### Issue: Authentication not working

**Solution**:
- Check Lambda proxy URL in `appRouteConfig.json`
- Verify token storage (localStorage)
- Check authentication flow in `signin.html`

### Issue: Module not loading

**Solution**:
- Check route name in `appRouteConfig.json`
- Verify module initializer in `appRouter.js`
- Check console for script loading errors
- Ensure module function is exported correctly

## Next Steps

1. ✅ Review `docs/PATTERNS.md` for architecture patterns
2. ✅ Read `docs/LESSONS_LEARNED.md` to avoid common mistakes
3. ✅ Follow `docs/MODULE_GUIDE.md` to create modules
4. ✅ Set up `docs/RBAC_GUIDE.md` for security
5. ✅ Configure `docs/DATABASE_GUIDE.md` for database setup

## Getting Help

- Review documentation in `docs/` directory
- Check template examples in `modules/example-module/`
- Review original FruitLive implementation
- Check error messages in browser console

## Project Checklist

- [ ] Project name and description updated
- [ ] Configuration files updated (appRouteConfig, manifest, package.json)
- [ ] Supabase project created and configured
- [ ] Database schema created
- [ ] RBAC set up
- [ ] Authentication configured
- [ ] Data functions updated
- [ ] First module created and tested
- [ ] PWA configured (if needed)
- [ ] Environment settings configured
- [ ] Tests passing
- [ ] Build successful
- [ ] Deployed to staging/production

