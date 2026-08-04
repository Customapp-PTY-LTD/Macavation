---
depends_on: phase2-0d-fix-ui-verify-and-add-merge-gate.md
---

# Migration hygiene: one canonical directory, and a prefix linter to keep it

## Context

`migrations/` holds **292 `.sql` files** and is the canonical location — `supabase/config.toml:3` says
so explicitly: `# Apply migrations: npm run db:apply -- migrations/<file>.sql`. Around that canonical
directory three kinds of clutter have accumulated, and there is no check stopping more.

**1. A second migration directory.** `supabase/migrations/` holds 2 files,
`20260227000001_upsert_kernel_production_all_date_keyed.sql` and
`20260227000002_upsert_kernel_production_auto_status.sql`, both **byte-identical** to files already in
`migrations/` (verified with `diff`). Nothing in any script or config reads that path — the only
non-git reference in the repo is prose in `docs/database/BRANCH_CONSOLIDATION_PLAN.md`. It is also a
live hazard: `supabase/migrations/` is the path the Supabase CLI reads, so a `supabase db push` would
apply those two and ignore the other 290.

**2. Non-migration artifacts inside `migrations/`.** `migrations/_mcp_manual_oil.json` and the
directory `migrations/_mcp_apply_chunks_soh/` are leftovers from one-off MCP apply runs. Anything
scanning `migrations/` for `.sql` skips them, but they make the canonical directory look like scratch
space.

**3. ~34 one-off apply scripts.** `scripts/` holds 64 `.mjs`/`.cjs`/`.js` files; `package.json`
exposes 18. A large block of the remainder is migration archaeology from specific past batches —
`_apply_batch_01_loop.mjs`, `apply_batch_08_runner.mjs`, `mcp_apply_batch08_loop.mjs`,
`run_seq_mcp_apply.mjs`, and so on. Every one of the 34 named below was checked and has **zero**
references from `package.json`, from `.github/`, or from any other script.

**And nothing prevents recurrence.** Prefixes are already inconsistent: **20 timestamp prefixes are
duplicated** (so the apply order between those pairs is undefined by filename), including a live
collision on `20260813090000`, which is shared by
`20260813090000_whatsapp_inbound_shared_inbox.sql` and
`20260813090000_fix_get_daily_digest_dashboard_targets.sql`. Separately, a set of prefixes carry
impossible dates — month `03` with days `32` through `45` — because the prefix was used as an ad-hoc
sequence counter, silently decoupling lexical order from chronological order.

**`depends_on`:** this plan waits on the `ui:verify` gate plan because both edit `package.json`'s
`test:fleet` script.

## Scope

**In:** deleting `supabase/migrations/`; relocating 2 artifacts out of `migrations/`; archiving 34
unreferenced one-off scripts; a new `migrations:verify` linter wired into `test:fleet`.

**Out — do not rename any existing migration.** The 20 duplicate prefixes and the impossible-date
prefixes stay exactly as they are. Applied migration names are recorded outside this repo, and
`scripts/applied_migration_names.json` is the local record of them; renaming a file that has already
been applied would make the repo disagree with the database about what ran. The linter grandfathers
them instead.

**Out — every `.json` file in `scripts/` stays put.** Six of them are written or read by live
`package.json` scripts: `uat_migration_apply_results.json` (`apply-pending-uat-migrations.mjs`),
`prod_migration_apply_results.json` (`apply-pending-prod-migrations.mjs`),
`prod_config_sync_results.json` (`sync-config-uat-to-prod.mjs`),
`prod_permission_sync_results.json` (`sync-permissions-uat-to-prod.mjs`),
`prod_to_uat_copy_results.json` (`copy-prod-data-to-uat.mjs`), `uat_advisors_report.json`
(`check-uat-advisors.mjs`). Moving any of them would break live tooling for a purely cosmetic gain.
Leave all 12 `.json` files in `scripts/` alone.

**Out:** authoring or applying any migration. This plan adds no `.sql` content.

## Work

### 1. Delete `supabase/migrations/`

Remove both files and the directory. Confirm byte-identity first rather than trusting this document:

```bash
diff supabase/migrations/20260227000001_upsert_kernel_production_all_date_keyed.sql \
     migrations/20260227000001_upsert_kernel_production_all_date_keyed.sql
diff supabase/migrations/20260227000002_upsert_kernel_production_auto_status.sql \
     migrations/20260227000002_upsert_kernel_production_auto_status.sql
```

Both must report no differences. **If either differs, stop and report it** — a divergent copy is a
content question, not a cleanup one, and must not be resolved by guessing which side is right.

Do not touch `supabase/config.toml`, `supabase/functions/`, `supabase/projects.json` or
`supabase/remote.toml`.

### 2. Move the two non-migration artifacts out of `migrations/`

```
migrations/_mcp_manual_oil.json        ->  scripts/archive/_mcp_manual_oil.json
migrations/_mcp_apply_chunks_soh/      ->  scripts/archive/_mcp_apply_chunks_soh/
```

After this, `ls migrations/ | grep -v '\.sql$'` must print nothing.

### 3. Archive the 34 unreferenced one-off apply scripts

Create `scripts/archive/` and move these into it. All are `git mv`, not deletions — they are a record
of how past batches were applied, and someone may need to read one.

```
_apply_all_seed_chunks_mcp.mjs      _apply_seq07_sequential.mjs      apply_batch_10_seed_execute.mjs
_apply_batch_01_loop.mjs            _gen_check_applied.mjs           apply_batch_10_seed_full.mjs
_apply_batch_01_one.mjs             _list_unapplied.sql              apply_batch_migrations.mjs
_apply_batch_10_seed_mcp_loop.mjs   _mcp_apply_batch.mjs             apply_seq_mcp_step.mjs
_apply_batch_item.mjs               _mcp_exec_chunk_via_api.mjs      apply_seq_remaining.mjs
_apply_batch_mcp.mjs                _prepare_mcp_chunk_payload.mjs   mcp_apply_batch08_loop.mjs
_apply_batch_mcp_one.mjs            _prod_bootstrap_dashboard_alerts.sql  run_seq_mcp_apply.mjs
_apply_one_payload.mjs              _prod_role_permissions_dedupe.sql
_apply_prod_phase2_remaining.mjs    _prod_schema_check.sql
_apply_seq07_api.mjs                _run_all_batch_10_seed_chunks.mjs
_apply_seq07_mcp_loop.mjs           _seq07_mcp_apply_one.mjs
_split_batch_10_seed.mjs            _soh_batches/  (directory)
```

That list is 33 entries plus the `_soh_batches/` directory. Two files matching the same name patterns
are **excluded on purpose** because other files reference them:

- `scripts/_diff_chunks.json` — a `.json`, and out of scope per Scope above.
- `scripts/_repo_unapplied_check.sql` — has one inbound reference. Leave it.

**Re-derive the list rather than trusting it.** For each candidate, confirm zero references before
moving:

```bash
grep -rl "<filename>" package.json scripts/ .github/ | grep -v "scripts/<filename>$"
```

If any candidate returns a reference, leave it in place and say so in the run summary. Do not move a
file and then patch the reference — that turns a filing exercise into a behaviour change.

Add a short `scripts/archive/README.md` saying these are one-off migration-apply runners kept for the
historical record, that none is referenced by `package.json`, and that new work should use
`npm run db:apply`.

### 4. `scripts/verify-migration-prefixes.mjs` — the new linter

A hermetic Node script (pure `fs`, no network, no dependencies) that reads `migrations/*.sql` and
fails when a filename prefix is malformed or collides.

Rules:

1. Every `.sql` filename must start with a 14-digit prefix followed by `_`.
2. That prefix must be a real UTC timestamp — parse as `YYYYMMDDHHMMSS` and reject an impossible
   month/day/hour/minute/second.
3. No two files may share a prefix.
4. `migrations/` must contain nothing but `.sql` files.

**The current tree violates rules 2 and 3, so the linter must grandfather what already exists** or it
can never be added. Implement that with a committed baseline:

- `scripts/migration-prefix-baseline.json` — generated by this plan, listing the duplicate prefixes
  and the invalid-date prefixes **currently** present. Derive it by running the checks against the tree
  as it is; do not hand-type it from this document.
- A violation whose prefix is in the baseline is reported as a warning and does **not** fail the run.
- Any violation *not* in the baseline fails with `file:line`-style detail.
- The baseline is append-never: the script must not rewrite it at runtime.

Include a header comment stating plainly that the baseline records pre-existing debt that is
deliberately not being renamed (because those migrations are already applied), and that the correct
response to a new failure is to fix the filename, never to extend the baseline.

Print a one-line summary on success, matching the house style of the other verifiers, e.g.
`MIGRATION PREFIXES OK (292 files, N grandfathered).`

### 5. `package.json` — expose and gate it

Add the script and append it to the gate, preserving the `ui:verify` step the prerequisite plan added:

```
"migrations:verify": "node scripts/verify-migration-prefixes.mjs"
```

```
"test:fleet": "npm run routing:verify && npm run username:verify && node scripts/verify-phase2-migrations.mjs && npm run ui:verify && npm run migrations:verify"
```

Do not otherwise alter `test:fleet`, and keep every warning in the `"//test:fleet"` comment key intact.

## Guardrails

- **Do not rename, delete, edit or reorder any file in `migrations/`.** Not one `.sql` byte changes.
  Forward-only applies to filenames too here, because these migrations are already applied.
- **Do not extend the baseline to silence a real problem** and do not "fix" the duplicate
  `20260813090000` pair by renaming either file.
- **Do not move or edit any `.json` in `scripts/`.**
- **Do not touch `scripts/verify-phase2-migrations.mjs`.** It asserts that 10 named Phase 2 migration
  files exist; this plan moves none of them, so it must keep passing untouched.
- **Do not add an npm dependency.** The linter is `fs` and `path` only. No `package-lock.json`.
- **Do not weaken `test:fleet`** — the chain only grows.
- Do not touch `supabase/config.toml`, `supabase/functions/`, `supabase/projects.json`,
  `supabase/remote.toml`, or anything under `WebPortal/`.
- Do not touch `docs/` — a separate plan owns it, including
  `docs/database/BRANCH_CONSOLIDATION_PLAN.md`, which mentions the directory being deleted here. Leave
  that mention; correcting it belongs with the docs pass.

## Acceptance criteria

1. `supabase/migrations/` no longer exists. Nothing else under `supabase/` is modified.
2. `ls migrations/ | grep -v '\.sql$'` prints nothing, and `ls migrations/*.sql | wc -l` prints
   **292** — unchanged.
3. `git diff --stat -- migrations/` shows **no modified `.sql` file** (only the two artifact
   relocations, if git records them under that path).
4. `scripts/archive/` exists, contains the moved one-offs and a `README.md`, and
   `ls scripts/*.mjs scripts/*.cjs scripts/*.js | wc -l` has dropped accordingly.
5. Every file moved into `scripts/archive/` was verified to have zero inbound references; any candidate
   that turned out to be referenced was left in place and named in the run summary.
6. `scripts/_diff_chunks.json` and `scripts/_repo_unapplied_check.sql` are still in `scripts/`, and all
   12 `.json` files in `scripts/` are unmoved and unmodified.
7. `npm run migrations:verify` exits 0 on the current tree and prints its summary line.
8. `scripts/migration-prefix-baseline.json` exists, was generated from the tree, and contains the
   duplicate prefix `20260813090000`.
9. Deliberately breaking a name (e.g. temporarily copying a migration to
   `migrations/20260813090000_x.sql`) makes `npm run migrations:verify` exit non-zero. Revert any such
   temporary file before finishing — the final tree must be clean.
10. `package.json` exposes `migrations:verify`, and `test:fleet` runs `routing:verify`,
    `username:verify`, `verify-phase2-migrations.mjs`, `ui:verify` and `migrations:verify` in that
    order.
11. `npm run test:fleet` passes. `scripts/verify-phase2-migrations.mjs` is byte-identical.
12. No new npm dependency; no `package-lock.json`; no file under `WebPortal/` or `docs/` modified.
