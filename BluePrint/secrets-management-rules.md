# Secrets Management Rules

## Overview

This guide covers one rule, applied everywhere: **no key, token, password, or connection string
of any kind is ever hardcoded as a literal in committed source** - not in JavaScript, not in
Lambda code, not in SQL migrations, not in config files, not in tests, not in comments showing
"an example." This is cross-cutting on purpose - it is not a database rule (see
`supabase-database-rules.md` for RLS/access-control guidance) and not a JS rule; it applies to
every language and every layer this stack touches.

**This rule makes no exception for keys that are "meant to be public."** Supabase's own anon
key, for example, is designed to be embedded in a frontend bundle - RLS is what actually gates
access to data, not the anon key's secrecy. That is a valid point about *access control*, but it
is not a license to hardcode the key's literal value in source. Load every key - anon/publishable
included - from environment configuration, the same way a genuinely secret key is loaded. Two
independent reasons, neither of which depends on whether a specific key is "sensitive":

- **Rotation.** A hardcoded literal means rotating any key - planned or in response to a leak -
  requires a code change and a redeploy. An env-var reference means rotation is a config change.
- **Uniform enforcement.** A rule with an exception ("hardcoding is fine for keys that are
  supposed to be public") requires whoever - or whatever - is checking the rule to correctly
  judge which category a given key falls into. A scanner (automated or human) can verify "is this
  a literal key in source" far more reliably than "is this specific key's public exposure
  actually safe here." The simple, exceptionless rule is the one that can actually be enforced.

## The Rule

**Every credential - API key, database password, connection string, JWT signing secret,
publishable/anon key, service-role key, OAuth client secret, webhook signing secret - is read
from environment configuration at runtime, never written as a literal string in a file that gets
committed.**

```javascript
// BAD - hardcoded literal, regardless of which kind of key this is
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.xxxxxxxxxxxx";
const supabaseUrl = "https://xyzcompany.supabase.co";

// GOOD - loaded from environment/config, never a literal in the file
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabaseUrl = process.env.SUPABASE_URL;
```

```sql
-- BAD - a connection string or password embedded in a migration or stored procedure
CREATE SERVER remote_db FOREIGN DATA WRAPPER postgres_fdw
  OPTIONS (host 'db.example.com', dbname 'prod', password 'Sup3rSecret!');

-- GOOD - reference a config/secret store the migration itself never sees the value of
-- (this stack's own service-credential rotation design: each live credential lives in its own
-- secret store entry, fetched by the runtime, never baked into a migration or a repo file)
```

```javascript
// BAD - a Lambda handler with a literal API key "just for this one function"
const STRIPE_KEY = "sk_live_xxxxxxxxxxxxxxxxxxxxxxxx";

// GOOD
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
```

**No carve-out for test fixtures or examples showing a "sample" key.** If a test genuinely needs
a key-shaped string, use an obviously-fake placeholder that cannot be mistaken for or accidentally
match a real credential pattern (e.g. `"test-placeholder-not-a-real-key"`), not a real-looking
JWT or a real-format-but-random string - both an automated scanner and a human reviewer should be
able to tell at a glance that it is not live.

## Why This Is Enforced, Not Just Advised

A documentation rule alone cannot reliably stop a hardcoded secret from merging - a plan or an AI
coding agent that hardcodes a key can just as easily fail to read (or ignore) this file. This
stack's automation (Agent Fleet) backs this rule with a **mandatory, deterministic secret-scanning
gate** that runs against every change before it can merge, on every repo, with no per-repo
opt-out beyond a narrow, logged, PR-reviewed exception for a specific confirmed false positive.
The gate does not try to judge whether a specific key's exposure is "probably fine" - it flags
every hardcoded key-shaped literal, always, exactly matching this document's own no-exceptions
stance. See that system's own documentation for the mechanics; the point for this document is
simpler: **the rule stated here is the one the gate enforces, so writing code that matches this
guide is what keeps a change from being blocked.**

## Quick Reference Checklist

- [ ] No API key, token, password, or connection string appears as a literal string anywhere in
  a committed file - source, migration, config, or test
- [ ] This includes keys "meant to be public" (e.g. a Supabase anon/publishable key) - loaded
  from environment configuration, not hardcoded, regardless of its own sensitivity
- [ ] A test needing a key-shaped value uses an obviously-fake placeholder, never a real-format
  sample that could be mistaken for a live credential
- [ ] Rotating any credential is a configuration change, never a code change
- [ ] See `supabase-database-rules.md`'s RLS/access-control section for the separate question of
  *what a key is allowed to reach* - this document covers *whether the key's value is ever
  written into source*, a different question with a simpler, exceptionless answer
