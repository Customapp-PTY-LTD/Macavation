---
depends_on: phase2-0d-fix-ui-verify-and-add-merge-gate.md
retry_of: a81aef50-042f-485d-a75b-fd30199e006d
---

# Migration hygiene: one canonical directory, and a prefix linter to keep it

## Context

`migrations/` is the canonical location for migrations — `supabase/config.toml:3` says so explicitly:
`# Apply migrations: npm run db:apply -- migrations/<file>.sql`. Two kinds of clutter have accumulated
around that directory, and there is no check stopping more.

**1. A second migration directory.** `supabase/migrations/` holds 2 files,
`20260227000001_upsert_kernel_production_all_date_keyed.sql` and
`20260227000002_upsert_kernel_production_auto_status.sql`, both also present in `migrations/`. Nothing
in any script or config reads that path — the only non-git reference in the repo is prose at
`docs/database/BRANCH_CONSOLIDATION_PLAN.md:26`. It is also a live hazard: `supabase/migrations/` is
the path the Supabase CLI reads, so a `supabase db push` would apply those two and ignore everything
in `migrations/`.

**2. Non-migration artifacts inside `migrations/`.** `migrations/_mcp_manual_oil.json` and the
directory `migrations/_mcp_apply_chunks_soh/` (7 `chunk_00N.sql` files plus
`apply_migration_payload.json`) are leftovers from one-off MCP apply runs. Anything scanning the top
level of `migrations/` for `.sql` skips them, but they make the canonical directory look like scratch
space, and the nested `chunk_00N.sql` files are `.sql` files that are not migrations.

**And nothing prevents recurrence.** Prefix hygiene is already inconsistent. There is a live
collision on `20260813090000`, shared by `20260813090000_whatsapp_inbound_shared_inbox.sql` and
`20260813090000_fix_get_daily_digest_dashboard_targets.sql`, so the apply order between those two is
undefined by filename. Separately, a set of prefixes carry impossible dates — month `03` with a day
number past 31 (e.g. `20260332000003`, `20260340000001`, `20260341000002`) — because the prefix was
used as an ad-hoc sequence counter, silently decoupling lexical order from chronological order.

**Counts are deliberately not asserted in this plan.** Do not trust or reproduce any file-count or
violation-count figure from prose; every number this run needs must be **derived from the tree at run
time** and recorded in the generated baseline. See "Derived counts, not asserted counts" below.

**`depends_on`:** this plan waits on the `ui:verify` gate plan because both edit `package.json`'s
`test:fleet` script. `test:fleet` currently ends with `npm run ui:verify`; confirm that before editing.

## Scope

**In:** deleting `supabase/migrations/`; relocating 2 artifacts out of `migrations/`; a new
`migrations:verify` linter wired into `test:fleet`.

**Out — no script archiving of any kind.** An earlier draft of this plan proposed archiving ~34
one-off apply scripts from `scripts/`. **Those files do not exist in this checkout and that step is
cancelled.** `scripts/` top level holds exactly 23 files (19 `.mjs`, 1 `.cjs`, 2 `.js`, 1 `.ps1`) and
**zero `.json` files**. Do not move, rename, delete or edit any existing file in `scripts/`. In
particular do not touch `apply-migration.mjs` (backs `npm run db:apply`), `apply-migration-prod.mjs`,
`apply-pending-uat-migrations.mjs`, `apply-pending-prod-migrations.mjs`,
`apply_user_guide_help_links.mjs`, the `import-*.js` files, or `check-supabase-project.mjs` (run by
`.github/workflows/supabase-project-guard.yml` on every push to `main`/`master`/`prod` and on every
PR). If you find yourself hunting for "one-off apply scripts to archive", stop: that work is not in
this plan.

**Out — `scripts/_soh_batches/` is untouchable.** `.gitignore:36-38` reads
`# One-off MCP / batch execution artifacts (do not commit)` … `scripts/_soh_batches/`. It holds
hundreds of generated MCP payload files. Do not move it, do not `git add` it, do not `git add -f`
anything under it, and do not copy any of its contents into a non-ignored path. Same for
`agent-tools/` and `.tmp-issues-stash/`.

**Out — do not rename any existing migration.** The duplicate prefixes and the impossible-date
prefixes stay exactly as they are. Applied migration names are recorded outside this repo; renaming a
file that has already been applied would make the repo disagree with the database about what ran. The
linter grandfathers them instead.

**Out:** authoring or applying any migration. This plan adds no `.sql` content and runs no SQL.

## Derived counts, not asserted counts

Wherever a count is needed, compute it and record it; never hard-code one from prose.

- Before making any change, capture the baseline top-level count:
  `ls migrations/*.sql | wc -l` → call this `N_BEFORE`.
- After all changes, `ls migrations/*.sql | wc -l` must equal `N_BEFORE` exactly.
- Record `N_BEFORE` in the generated baseline JSON as `sqlFileCount`, and state the actual number in
  the run summary.
- The same applies to the number of duplicate-prefix groups and invalid-date prefixes: derive them,
  record them, report them. Do not assert a figure you did not compute in this run.

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

Do not touch `supabase/config.toml`, `supabase/functions/`, `supabase/projects.json`,
`supabase/remote.toml`, or `supabase/.temp/`.

### 2. Move the two non-migration artifacts out of `migrations/`

```
migrations/_mcp_manual_oil.json        ->  scripts/archive/_mcp_manual_oil.json
migrations/_mcp_apply_chunks_soh/      ->  scripts/archive/_mcp_apply_chunks_soh/
```

Constraints on this move:

- **Only move paths that git already tracks.** Verify first with
  `git ls-files migrations/_mcp_manual_oil.json migrations/_mcp_apply_chunks_soh` — every path you
  move must appear in that output. Use `git mv`. This is a rename of already-committed content, so it
  publishes nothing new. If any path is *not* tracked (i.e. it is ignored or untracked), **leave it
  where it is and report it** — do not `mv`-then-`add` it, and do not force-add it.
- Do not open, edit or rewrite the contents of either artifact.

After this, `ls migrations/ | grep -v '\.sql$'` must print nothing, and `migrations/` must contain no
subdirectories.

Create `scripts/archive/` with a short `README.md` stating that it holds one-off MCP apply artifacts
relocated out of the canonical `migrations/` directory, that they are kept for the historical record
only, that nothing in `package.json` or `.github/` reads them, and that new migration work should use
`npm run db:apply -- migrations/<file>.sql`. Do not claim in that README that any script was archived
here — none was.

### 3. `scripts/verify-migration-prefixes.mjs` — the new linter

A hermetic Node script (`node:fs` / `node:path` only, no network, no dependencies) that reads the
**top level** of a migrations directory and fails when a filename prefix is malformed or collides.

Rules:

1. Every `.sql` filename must start with a 14-digit prefix followed by `_`.
2. That prefix must be a real UTC timestamp — parse as `YYYYMMDDHHMMSS` and reject an impossible
   month/day/hour/minute/second (round-trip the parsed components through `Date.UTC` and require they
   come back unchanged).
3. No two files may share a prefix.
4. The directory must contain nothing but `.sql` files — no other extensions, no subdirectories.

Scan the top level only (`readdirSync` with `withFileTypes`, do not recurse); subdirectory presence is
itself a rule-4 violation, so there is nothing to recurse into on a clean tree.

**Directory argument.** Accept an optional first CLI argument naming the directory to check, defaulting
to `migrations/` resolved relative to the repo root. This exists so the negative test in step 5 can run
against a throwaway fixture directory instead of writing into `migrations/`. Resolve the baseline file
from the script's own location, not from the target directory, so grandfathering behaves identically
whichever directory is being checked.

**Grandfathering — keyed on exact filename sets, not on bare prefixes.** The current tree violates
rules 2 and 3, so the linter must grandfather what already exists or it can never be added. The keying
matters, because grandfathering a bare *prefix* would let a brand-new third file adopt a known-bad
prefix and pass. Implement it as:

- `scripts/migration-prefix-baseline.json`, generated by this run from the tree as it is. Do not
  hand-type it from this document. Shape:

  ```json
  {
    "generatedFrom": "migrations/",
    "sqlFileCount": <N_BEFORE>,
    "duplicatePrefixes": { "<prefix>": ["<file-a>.sql", "<file-b>.sql"] },
    "invalidDatePrefixes": { "<prefix>": ["<file>.sql"] }
  }
  ```

  Filename arrays are sorted, basenames only, no directory component.

- A **rule-3 (duplicate)** group is grandfathered only if the prefix is a key in `duplicatePrefixes`
  **and** the sorted set of filenames currently sharing that prefix is exactly equal to the recorded
  array. Any difference — an added file, a removed file, a renamed file — is a fresh violation and
  **fails**.
- A **rule-2 (invalid date)** violation is grandfathered only if that exact filename is listed under
  its prefix in `invalidDatePrefixes`. A new file with an impossible date **fails**, even if its prefix
  is already a key.
- Rules 1 and 4 are never grandfathered.
- Grandfathered violations print as warnings and do not affect the exit code. Every non-grandfathered
  violation prints one line naming the offending file and the rule it broke, and the script exits
  non-zero.
- The baseline is read-only at runtime: the script must never write, extend or regenerate it. No
  `--update-baseline` flag, no auto-heal path.

Include a header comment stating plainly that the baseline records pre-existing debt that is
deliberately not being renamed (because those migrations are already applied), that entries are keyed
on exact filename sets so a new collision on a known-bad prefix still fails, and that the correct
response to a new failure is to fix the filename — never to extend the baseline.

Print a one-line uppercase summary on success, matching the house style of the other verifiers (see
`scripts/verify-ui-standard.mjs:149`), with both numbers derived at run time, e.g.
`MIGRATION PREFIXES OK (<n> files, <g> grandfathered).`

### 4. `package.json` — expose and gate it

Add the script and append it to the gate, preserving the `ui:verify` step the prerequisite plan added:

```
"migrations:verify": "node scripts/verify-migration-prefixes.mjs"
```

```
"test:fleet": "npm run routing:verify && npm run username:verify && node scripts/verify-phase2-migrations.mjs && npm run ui:verify && npm run migrations:verify"
```

Do not otherwise alter `test:fleet`, and keep the `"//test:fleet"` comment key and every warning in it
intact.

### 5. Prove the linter fails on a new violation — without writing into `migrations/`

Do **not** create a temporary `.sql` file inside `migrations/`; a leftover there becomes a permanent
bogus migration filename in the canonical directory.

Instead, build a throwaway fixture directory under the OS temp dir (`os.tmpdir()`), outside the repo
working tree, containing two files whose prefix is a valid timestamp that is **not** in the generated
baseline and that collide with each other, e.g. `20270101000000_a.sql` and `20270101000000_b.sql`, each
holding a single SQL comment. Run `node scripts/verify-migration-prefixes.mjs <fixture-dir>` and
confirm it exits non-zero and names the collision. Also confirm a malformed name (e.g. `nope.sql`) and
a non-`.sql` entry each fail in that same fixture. Delete the fixture afterwards. Report the observed
exit codes in the run summary. Nothing under the repo working tree may be created or left behind by
this test.

## Guardrails

- **Do not rename, delete, edit or reorder any `.sql` file in `migrations/`.** Not one byte changes.
  Forward-only applies to filenames here, because these migrations are already applied.
- **Do not create any file inside `migrations/`,** not even temporarily.
- **Do not extend the baseline to silence a problem,** and do not "fix" the duplicate
  `20260813090000` pair by renaming either file.
- **Do not move, rename, delete or edit anything in `scripts/`** other than adding the three new paths
  this plan creates (`verify-migration-prefixes.mjs`, `migration-prefix-baseline.json`, `archive/`).
- **Do not touch anything gitignored.** No `git add -f`. Specifically `scripts/_soh_batches/`,
  `agent-tools/`, `.tmp-issues-stash/`, `supabase/.temp/`.
- **Do not touch `scripts/verify-phase2-migrations.mjs`.** It asserts that 10 named migration files
  exist in `migrations/`; this plan moves none of them, so it must keep passing untouched.
- **Do not touch `.github/`.** `supabase-project-guard.yml` must keep running
  `node scripts/check-supabase-project.mjs`.
- **Do not add an npm dependency.** The linter is `node:fs` / `node:path` only. No
  `package-lock.json`, no `node_modules`.
- **Do not weaken `test:fleet`** — the chain only grows, and it stays hermetic (no network, no browser,
  no service-role key).
- Do not touch `supabase/config.toml`, `supabase/functions/`, `supabase/projects.json`,
  `supabase/remote.toml`, or anything under `WebPortal/`.
- Do not touch `docs/`. `docs/database/BRANCH_CONSOLIDATION_PLAN.md:26` mentions the directory being
  deleted here, and `docs/markdown-archive/README.md:9` mentions `scripts/_soh_batches/`; leave both
  mentions exactly as they are. Correcting them belongs to the docs pass.
- If any premise in this plan turns out to be false against the tree, **stop and report it** rather
  than substituting a nearby file that looks similar.

## Acceptance criteria

1. `supabase/migrations/` no longer exists. Nothing else under `supabase/` is modified.
2. `ls migrations/ | grep -v '\.sql$'` prints nothing, `migrations/` contains no subdirectory, and
   `ls migrations/*.sql | wc -l` equals the `N_BEFORE` captured before any change. Both the before and
   after numbers are stated in the run summary; no count is copied from this document.
3. `git diff --stat -- migrations/` shows **no modified `.sql` file** — only the two artifact
   relocations, recorded as renames.
4. `scripts/archive/` exists and contains exactly the relocated `_mcp_manual_oil.json`, the relocated
   `_mcp_apply_chunks_soh/` directory, and a `README.md`. Nothing else was placed there.
5. `scripts/` top level is otherwise unchanged: it still holds its original 23 files (19 `.mjs`,
   1 `.cjs`, 2 `.js`, 1 `.ps1`) plus the two new files this plan adds, and no pre-existing file in
   `scripts/` was moved, renamed, deleted or edited. No script was archived.
6. `git status --porcelain` shows nothing added under `scripts/_soh_batches/`, `agent-tools/` or
   `.tmp-issues-stash/`, and `.gitignore` is unmodified.
7. `npm run migrations:verify` exits 0 on the final tree and prints its uppercase summary line with
   run-derived counts.
8. `scripts/migration-prefix-baseline.json` exists, was generated from the tree in this run, records
   `sqlFileCount`, and its `duplicatePrefixes` contains the key `20260813090000` mapped to exactly the
   two filenames that share it.
9. The temp-directory negative test in step 5 ran: a fresh duplicate prefix not present in the
   baseline, a malformed filename, and a non-`.sql` entry each made the linter exit non-zero. The
   fixture was outside the repo and has been deleted; `git status --porcelain` shows no stray file.
10. Adding a third file to a baselined duplicate group would fail (verified in a temp fixture, not in
    `migrations/`): grandfathering is keyed on the exact filename set, not on the bare prefix.
11. `package.json` exposes `migrations:verify`, and `test:fleet` runs `routing:verify`,
    `username:verify`, `verify-phase2-migrations.mjs`, `ui:verify` and `migrations:verify` in that
    order, with the `"//test:fleet"` comment key intact.
12. `npm run test:fleet` passes. `scripts/verify-phase2-migrations.mjs` is byte-identical.
13. No new npm dependency; no `package-lock.json`; no file under `WebPortal/`, `docs/` or `.github/`
    modified.
