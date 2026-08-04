# Give `docs/` an index, and remove the archive's duplicate copies

## Context

`docs/` holds **197 files across 14 subdirectories and has no README or index at any level**, so there
is no way to tell which of several similarly-named documents is current. That is not a cosmetic
problem: `CLAUDE.md` already warns that one duplicated document actively caused a bug —

> Note the pattern in `docs/RBAC_GUIDE.md` grants a new function to **every** role — that is how this
> drifted.

**19 documentation basenames exist in two or more locations.** The worst concentration is
`docs/markdown-archive/`, described in `.cursorrules` as legacy notes, where **18 of its 29 files share
a basename with a document still living in `docs/`** — including three PWA guides for a feature that
has been retired, two of which are also still in the live `docs/guides/`.

This plan adds the missing index and clears the archive duplicates. It deliberately leaves the two
genuinely contested decisions to a human.

## Scope

**In:** a new `docs/README.md` index; de-duplicating `docs/markdown-archive/` against live docs;
relocating the oddly-named `markdown files/` directory.

**Out — `docs/RBAC_GUIDE.md`, `docs/guides/RBAC_GUIDE.md` and `BluePrint/RBAC_GUIDE.md` stay exactly as
they are.** All three differ (161, 536 and 466 lines), and `CLAUDE.md` says the pattern in the `docs/`
copy is the one that caused the live permission drift. Choosing which survives is a correctness
judgment about RBAC guidance, not a filing decision, and getting it wrong would enshrine the harmful
pattern as canonical. Record it in the index as an open question instead.

**Out — `BluePrint/` is not moved.** `CLAUDE.md:37` cites `BluePrint/RBAC_GUIDE.md` by path, so folding
that directory means editing `CLAUDE.md`, which two other plans in this batch already edit. Deferred to
avoid a three-way conflict, and because it is entangled with the RBAC decision above.

**Out — `.claude/rules/` and `.cursor/rules/`.** They hold the same three rules diverged by 244 lines,
and reconciling them needs a human: `CLAUDE.md` points at one set and `.cursorrules` at the other, and
these are the rules that govern agent behaviour in this repo, including this run. Note it in the index;
change nothing.

**Out:** `docs/user-guide/` (48 files) and `WebPortal/help/` — the user-guide renderings are a content
consolidation, not a filing one, and `.cursor/rules/user-guide-update.mdc` makes them a live
deliverable of other work.

## Work

### 1. De-duplicate `docs/markdown-archive/` against the live tree

For each file in `docs/markdown-archive/`, look for the same basename elsewhere under `docs/` or
`BluePrint/`:

```bash
for f in docs/markdown-archive/*; do
  b=$(basename "$f")
  find docs BluePrint -name "$b" -not -path "docs/markdown-archive/*"
done
```

18 files currently match. For each match, **compare the contents**:

- **Byte-identical** → delete the `docs/markdown-archive/` copy. The live one is the same document and
  the archive adds nothing.
- **Different** → **keep both** and list the pair in the index's open-questions section with both line
  counts. A divergent archive copy may hold content the live one lost; deciding which is right is a
  content judgment and is out of scope.

Do not delete any `docs/markdown-archive/` file whose basename is unique to the archive — those are the
only copy of whatever they contain.

Known members of the 18 include `DATABASE_FUNCTIONS_REQUIRED.md`, `PROCESS-DRIVEN-DESIGN-PRINCIPLES.md`,
`PROCESS_DRIVEN_COMPLETE.md`, `PROCESS_DRIVEN_IMPLEMENTATION.md`, `PWA_IMPLEMENTATION_SUMMARY.md`,
`PWA_OFFLINE_GUIDE.md`, `PWA_ROLES_GUIDE.md`, `ROLE_ACCESS_UPDATE.md` and
`admin_portal_complete_instructions.mdc`. **Re-derive the full list with the command above** rather
than working from this excerpt.

Also delete `docs/markdown-archive/INSTRUCTIONS-DROPDOWNS-IN-TABLES copy.md` if and only if
`INSTRUCTIONS-DROPDOWNS-IN-TABLES.md` exists beside it and the two are identical apart from the
` copy` suffix. Its name makes it a duplicate by construction, but confirm before removing.

### 2. Relocate `markdown files/`

A directory whose name contains a space, holding exactly one file,
`markdown files/ISSUES_REGISTER_SETUP.md`. Move it to `docs/setup/ISSUES_REGISTER_SETUP.md` and remove
the directory.

Check for inbound references first (`grep -rn "markdown files" . --exclude-dir=node_modules
--exclude-dir=.git`) and update any that exist. A space in a path breaks unquoted shell and script
references, so if anything does reference it, say so in the run summary.

### 3. `docs/README.md` — the index

A new file, and the main deliverable. It must be genuinely useful for navigation, not a directory
listing that will rot. Structure it as:

- **One opening line** stating that `docs/` is reference material and that `CLAUDE.md` at the repo root
  is the authority on architecture for anyone editing the portal.
- **A table of the 14 subdirectories**: path, one-line purpose, file count. The subdirectories and
  their current counts: `architecture` 3, `database` 6, `demo` 2, `design` 13, `examples` 1, `guides`
  10, `implementation` 3, `markdown-archive` 29, `modules` 15, `phase2` 18, `proposals` 1, `setup` 7,
  `testing` 3, `user-guide` 48. Re-derive the counts after step 1, since that step changes
  `markdown-archive`.
- **A "start here" shortlist** naming the handful that are actually current and load-bearing:
  `docs/design/DESIGN_SYSTEM.md` (enforced by `npm run ui:verify`),
  `docs/RBAC_NEW_FUNCTION_CHECKLIST.md`, `docs/phase2/PHASE2_IMPLEMENTATION_PLAN.md`.
- **A "known stale" note** covering `docs/markdown-archive/` (legacy per `.cursorrules`), the PWA
  documents that survive in the live tree for a retired feature, and
  `docs/database/DATABASE_FUNCTIONS_REQUIRED.md`, whose content predates most of 2026's migrations.
- **An "open questions" section** — the point of this plan. List, without resolving:
  1. **`RBAC_GUIDE.md` exists three times** (`docs/` 161 lines, `docs/guides/` 536, `BluePrint/` 466)
     and `CLAUDE.md` says the `docs/` copy carries the grant-to-every-role pattern that caused the
     permission drift. Needs a human to pick the survivor.
  2. **`.claude/rules/` and `.cursor/rules/`** hold the same three rules diverged by 244 lines, with
     `CLAUDE.md` and `.cursorrules` pointing at different sets.
  3. **`BluePrint/`** is 13 files of generic, non-project-specific boilerplate that probably belongs
     under `docs/reference/` or nowhere.
  4. Any divergent archive/live pairs found in step 1, with both line counts.
  5. **The user guide exists in several renderings** across `docs/` and `WebPortal/help/`, with
     screenshots stored in two places.

**State the two effort figures as unreconciled, do not pick one.**
`docs/phase2/progress-update-2026-07-28.html` tells the client "roughly 10 to 15 days" of remaining
development while `docs/phase2/PHASE2_IMPLEMENTATION_PLAN.md` says "~77-93 person-days", written three
days later. Both are client-facing. Record the contradiction as an open question — the numbers cannot
be checked from inside this repo, so do not assert either as correct.

Do not claim in the index that any document is accurate or current unless the claim rests on something
checkable from the repo (a script that enforces it, or a date in the file). Where you cannot tell,
say so.

## Guardrails

- **Do not edit the contents of any existing document.** This plan deletes exact duplicates, moves one
  file, and adds one new file. No document's text is rewritten — in particular not any
  `RBAC_GUIDE.md`, and not `docs/phase2/PHASE2_IMPLEMENTATION_PLAN.md` (a later plan re-baselines it).
- **Do not delete a document that is the only copy of its content**, and never delete on basename
  alone — always diff first.
- **Do not touch `CLAUDE.md`, `.cursorrules`, `.claude/rules/`, or `.cursor/rules/`.** Other plans in
  this batch edit `CLAUDE.md`; the rules directories need a human.
- **Do not touch `BluePrint/`.**
- **Do not touch `WebPortal/`** at all, including `WebPortal/help/`.
- **Do not touch `docs/user-guide/`** or any screenshot.
- **Do not modify `package.json`**, add an npm dependency, or add a `.sql` file.
- Do not add a docs linter or link checker — worth doing, but a separate deliverable.

## Acceptance criteria

1. `docs/README.md` exists and contains: a subdirectory table with per-directory file counts, a
   "start here" shortlist, a known-stale note, and an open-questions section.
2. The open-questions section names all five items, including the three `RBAC_GUIDE.md` paths with
   their line counts and the unreconciled 10-15 vs 77-93 day contradiction, and asserts neither figure
   as correct.
3. All three `RBAC_GUIDE.md` files still exist, byte-identical:
   `find . -name RBAC_GUIDE.md -not -path "./node_modules/*" -not -path "./.claude/worktrees/*" | wc -l`
   prints `3`, and `git diff --stat` lists none of them.
4. Every file deleted from `docs/markdown-archive/` was byte-identical to a surviving copy elsewhere.
   Any divergent pair was kept and is listed in the index. The run summary states how many were deleted
   and how many were kept as divergent.
5. `markdown files/` no longer exists; `docs/setup/ISSUES_REGISTER_SETUP.md` does.
6. `git diff --stat` shows **no modification to any pre-existing `.md`, `.mdc` or `.html` file** —
   only deletions, the one rename, and the new `docs/README.md`.
7. `CLAUDE.md`, `.cursorrules`, `.claude/rules/*`, `.cursor/rules/*` and everything under `BluePrint/`
   and `WebPortal/` are untouched.
8. `package.json` is byte-identical; no npm dependency added; no `.sql` file added.
9. `npm run test:fleet` passes.
