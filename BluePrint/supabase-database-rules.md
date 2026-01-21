# Supabase Database Best Practices

## Overview

This guide covers best practices for designing, structuring, and maintaining your Supabase PostgreSQL database.

---

## 1. Schema Design

### Use UUIDs as Primary Keys

```sql
-- Prefer UUIDs over serial integers for primary keys
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Benefits:**
- No sequential exposure (prevents enumeration attacks)
- Works well with distributed systems
- Safe to expose in URLs

### Use Appropriate Data Types

| Use Case | Recommended Type |
|----------|------------------|
| Timestamps | `TIMESTAMPTZ` (not `TIMESTAMP`) |
| Currency | `NUMERIC(precision, scale)` or `BIGINT` (cents) |
| Boolean flags | `BOOLEAN` (not integers) |
| JSON data | `JSONB` (not `JSON`) |
| Email/URLs | `TEXT` with constraints |
| Enums | `TEXT` with CHECK or PostgreSQL ENUM |

```sql
-- Use TIMESTAMPTZ for proper timezone handling
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb
);
```

### Use Meaningful Naming Conventions

```sql
-- Tables: plural, snake_case
CREATE TABLE user_profiles (...);
CREATE TABLE order_items (...);

-- Columns: snake_case, descriptive
user_id, created_at, is_active, total_amount

-- Indexes: idx_tablename_columns
CREATE INDEX idx_orders_user_id ON orders(user_id);

-- Foreign keys: fk_tablename_reference
ALTER TABLE orders ADD CONSTRAINT fk_orders_user
  FOREIGN KEY (user_id) REFERENCES users(id);
```

---

## 2. Foreign Keys & Relationships

### Always Define Foreign Key Constraints

```sql
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0)
);
```

### Choose Appropriate ON DELETE Actions

| Action | Use When |
|--------|----------|
| `CASCADE` | Child records should be deleted with parent |
| `RESTRICT` | Prevent deletion if children exist |
| `SET NULL` | Preserve child but remove reference |
| `SET DEFAULT` | Assign a default value on deletion |

---

## 3. Indexing Strategy

### Index Foreign Keys

```sql
-- Foreign keys are NOT automatically indexed in PostgreSQL
CREATE TABLE comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID REFERENCES posts(id),
  user_id UUID REFERENCES users(id),
  content TEXT NOT NULL
);

-- Add indexes for foreign keys used in queries
CREATE INDEX idx_comments_post_id ON comments(post_id);
CREATE INDEX idx_comments_user_id ON comments(user_id);
```

### Index Columns Used in WHERE Clauses

```sql
-- If you frequently query by status
CREATE INDEX idx_orders_status ON orders(status);

-- Partial index for common queries
CREATE INDEX idx_orders_pending ON orders(created_at)
  WHERE status = 'pending';
```

### Use Composite Indexes Wisely

```sql
-- Order matters: put most selective column first
CREATE INDEX idx_orders_user_status ON orders(user_id, status);

-- This index helps queries filtering by user_id
-- or by user_id AND status, but NOT status alone
```

### Consider GIN Indexes for JSONB

```sql
-- For JSONB containment queries
CREATE INDEX idx_products_metadata ON products USING GIN (metadata);

-- Query: SELECT * FROM products WHERE metadata @> '{"category": "electronics"}';
```

---

## 4. Constraints & Validation

### Use CHECK Constraints

```sql
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(name) >= 1),
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'archived')),
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0)
);
```

### Use UNIQUE Constraints

```sql
-- Single column unique
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL
);

-- Composite unique constraint
CREATE TABLE team_members (
  team_id UUID REFERENCES teams(id),
  user_id UUID REFERENCES users(id),
  PRIMARY KEY (team_id, user_id)
);
```

### Use NOT NULL Appropriately

```sql
-- Require essential fields
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,           -- Required
  total NUMERIC(10,2) NOT NULL,    -- Required
  notes TEXT,                       -- Optional
  shipped_at TIMESTAMPTZ           -- Optional, set later
);
```

---

## 5. Triggers & Functions

### Use Triggers for Automatic Timestamps

```sql
-- Create a reusable function
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to tables
CREATE TABLE posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER posts_updated_at
  BEFORE UPDATE ON posts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
```

### Use Triggers for Denormalization

```sql
-- Keep a count in parent table
CREATE OR REPLACE FUNCTION update_comment_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE posts SET comment_count = comment_count + 1
    WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE posts SET comment_count = comment_count - 1
    WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER comments_count_trigger
  AFTER INSERT OR DELETE ON comments
  FOR EACH ROW
  EXECUTE FUNCTION update_comment_count();
```

---

## 6. Performance Best Practices

### Use Connection Pooling

- Supabase provides PgBouncer for connection pooling
- Use the pooled connection string for serverless environments
- Use direct connection for migrations and long-running operations

### ⚠️ NEVER Select All Rows — Always Use LIMIT

**This is a critical rule.** Selecting all data from a table without a row limit can:
- Crash your application with out-of-memory errors
- Exhaust your database connections
- Cause massive bandwidth costs
- Create denial-of-service conditions as tables grow

```sql
-- ❌ NEVER DO THIS — unbounded queries are dangerous
SELECT * FROM orders;
SELECT * FROM users WHERE status = 'active';
SELECT id, email FROM customers;

-- ✅ ALWAYS use LIMIT to cap results
SELECT * FROM orders LIMIT 100;
SELECT * FROM users WHERE status = 'active' LIMIT 50;
SELECT id, email FROM customers LIMIT 25;
```

### Use Pagination for All List Queries

```sql
-- Offset-based pagination (simple but slower for deep pages)
SELECT * FROM posts
ORDER BY created_at DESC
LIMIT 20 OFFSET 0;

-- Cursor-based pagination (better performance for large datasets)
SELECT * FROM posts
WHERE created_at < $1
ORDER BY created_at DESC
LIMIT 20;

-- Keyset pagination with multiple columns
SELECT * FROM products
WHERE (price, id) > ($last_price, $last_id)
ORDER BY price, id
LIMIT 20;
```

### Set Sensible Maximum Limits

```sql
-- In your application code, enforce maximum limits
-- Even if client requests 10000 rows, cap it

-- Example: Cap at 100 rows maximum
SELECT * FROM items
ORDER BY created_at DESC
LIMIT LEAST($requested_limit, 100);
```

### Avoid SELECT *

```sql
-- ❌ Fetches unnecessary data
SELECT * FROM users;

-- ✅ Fetch only needed columns
SELECT id, email, name FROM users;
```

### Use EXPLAIN ANALYZE

```sql
-- Analyze query performance
EXPLAIN ANALYZE
SELECT * FROM orders
WHERE user_id = 'uuid-here'
AND status = 'pending';
```

---

## 7. Migration Best Practices

### Use Incremental Migrations

```sql
-- migrations/20240115000000_create_users.sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- migrations/20240116000000_add_user_name.sql
ALTER TABLE users ADD COLUMN name TEXT;
```

### Make Migrations Reversible When Possible

```sql
-- Up migration
ALTER TABLE users ADD COLUMN phone TEXT;

-- Down migration (document in comments)
-- ALTER TABLE users DROP COLUMN phone;
```

### Avoid Breaking Changes

```sql
-- ❌ BAD: Drops column immediately
ALTER TABLE users DROP COLUMN legacy_field;

-- ✅ GOOD: Deprecate first, then remove in later migration
-- Step 1: Mark as nullable, stop writing
ALTER TABLE users ALTER COLUMN legacy_field DROP NOT NULL;
-- Step 2: Deploy code that doesn't use the column
-- Step 3: Drop in a later migration
```

---

## 8. Backup & Recovery

### Enable Point-in-Time Recovery

- Supabase Pro plans include daily backups and PITR
- For production apps, ensure backups are enabled
- Test recovery procedures periodically

### Export Critical Data

```sql
-- Use pg_dump for manual backups
-- Run from terminal, not SQL editor
pg_dump -h db.project.supabase.co -U postgres -d postgres > backup.sql
```

---

## 9. Realtime Considerations

### Design Tables for Realtime

```sql
-- Smaller, focused tables work better with Realtime
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES channels(id),
  user_id UUID NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for subscription filters
CREATE INDEX idx_messages_channel_id ON messages(channel_id);
```

### Avoid Frequent Updates to Large Rows

```sql
-- ❌ BAD: Large JSON updated frequently
CREATE TABLE user_state (
  user_id UUID PRIMARY KEY,
  full_state JSONB  -- Contains everything
);

-- ✅ GOOD: Separate frequently-updated data
CREATE TABLE user_presence (
  user_id UUID PRIMARY KEY,
  status TEXT,
  last_seen TIMESTAMPTZ
);
```

---

## 10. Storage Integration

### Link Storage Objects to Database Records

```sql
CREATE TABLE user_avatars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,  -- e.g., 'avatars/user-uuid/image.png'
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Clean Up Orphaned Files

```sql
-- Use triggers or scheduled jobs to clean storage
CREATE OR REPLACE FUNCTION delete_avatar_file()
RETURNS TRIGGER AS $$
BEGIN
  -- Call edge function or queue job to delete from storage
  PERFORM net.http_post(
    url := 'https://your-project.supabase.co/functions/v1/cleanup-avatar',
    body := json_build_object('path', OLD.storage_path)::text
  );
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
```

---

## Quick Reference Checklist

- [ ] UUIDs used for primary keys
- [ ] `TIMESTAMPTZ` used for all timestamps
- [ ] Foreign keys defined with appropriate ON DELETE
- [ ] Indexes created for foreign keys and frequent WHERE columns
- [ ] CHECK constraints for data validation
- [ ] NOT NULL on required fields
- [ ] `updated_at` triggers on mutable tables
- [ ] Connection pooling configured for serverless
- [ ] **ALL queries use LIMIT — never select unbounded rows**
- [ ] Pagination implemented for list endpoints
- [ ] Maximum row limits enforced in application code
- [ ] Migrations are incremental and non-breaking

---

## Additional Resources

- [Supabase Database Documentation](https://supabase.com/docs/guides/database)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/current/)
- [Supabase Realtime](https://supabase.com/docs/guides/realtime)
