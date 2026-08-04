---
depends_on: phase2-0a-remove-dead-code-and-untrack-junk.md
---

# Delete the duplicate non-deployed top-level tree

## Context

`CLAUDE.md` names this as a standing hazard:

> **There is a second, parallel top-level tree** (`modules/`, `css/`, `js/`) holding 3 modules against
> `WebPortal/modules/`'s 31. It is **not deployed** by the app above and **not scanned** by
> `ui:verify`. Check which tree you are in before editing — a fix applied there never reaches the dev
> site.

The Amplify app builds with `appRoot: WebPortal`, so `WebPortal/index.html` is the deployed site root.
Nothing in a browser ever loads the top-level tree: there is no root `index.html`, and the PWA stack
that once served from the root was retired (`WebPortal/index.html:12`,
`WebPortal/js/index.js:34-35`).

The divergence is **bidirectional**, which is why this is a hazard rather than a stale copy:
`modules/admin/html/admin_grid.html` is 532 lines against `WebPortal`'s 399, and
`modules/stock-management/html/stock_management_grid.html` is 415 against `WebPortal`'s 342 — the dead
tree is *ahead* in those two files and behind in the rest. Someone has been editing both.

**`depends_on`:** this plan waits on the dead-code removal plan because both touch
`scripts/check-supabase-project.mjs`. That plan deliberately leaves the script alone; this one owns
every edit to it.

## What is actually there

13 tracked files across 3 modules, plus 157 empty directories (untracked, so invisible to git) whose
names describe a product scope that never existed in `WebPortal/` — `chemicals/`, `crops/`,
`labour/`, `postharvest/`, `water/`, `compliance/`, `test-data/`, `test-scenarios/`.

```
js/appRouter.js                                          847 lines  (WebPortal: 932)
js/appRouteConfig.json                                   537 lines  (WebPortal: 758)
css/main.css                                            1321 lines  (WebPortal: 1758)
css/index.css                                            527 lines  (WebPortal:  705)
modules/admin/html/admin_grid.html                       532 lines  (WebPortal:  399)
modules/stock-management/js/stock_management_grid.js     2037 lines (WebPortal: 2470)
modules/stock-management/html/stock_management_grid.html  415 lines (WebPortal:  342)
modules/stock-management/css/stock_management_grid.css    157 lines (byte-identical)
modules/modal-stock-send-to-dispatch/html/…html            33 lines
modules/modal-stock-send-to-dispatch/js/…js               100 lines (WebPortal equivalent: 497)
styles.css                                               241 lines (zero references repo-wide)
```

## The three scripts that still write to it

This is the load-bearing part of the plan. Three Node scripts know the dead tree by hardcoded path,
so the deletion is not complete until they stop naming it.

**All three already guard with `existsSync`**, so deleting the tree first and editing them second
cannot break anything — verified at `sync-portal-supabase-config.mjs:80`
(`if (!fs.existsSync(abs)) return;`), `check-supabase-project.mjs:191-193` and `:165`, and
`verify-routing-guarantee.cjs:36`. **The edits below are dead-config removal, not bug fixes.** Do not
add defensive code; the guards are already there.

| Script | Line | What to remove |
|---|---|---|
| `scripts/sync-portal-supabase-config.mjs` | `:172` | `patchRouteConfig('js/appRouteConfig.json');` — every `npm run supabase:sync-portal` currently rewrites the dead file. Also drop the `(and js/appRouteConfig.json)` aside from the header comment at `:3`. |
| `scripts/check-supabase-project.mjs` | `:31` | `'js',` from `SCAN_DIRS` |
| | `:59` | `'js/appRouteConfig.json',` from `REQUIRED_FILES` |
| | `:162` | the second element of `['WebPortal/js/appRouteConfig.json', 'js/appRouteConfig.json']` |
| | `:36-37` | `'qa-data-seeder.html'` and `'test-scenarios-viewer.html'` from `SCAN_FILES` — the prerequisite plan deleted both files |
| `scripts/verify-routing-guarantee.cjs` | `:35` | the first element of `['js/appRouter.js', 'WebPortal/js/appRouter.js']` |

Two notes on those:

- **`REQUIRED_FILES` (`check-supabase-project.mjs:56-63`) is declared and never read.** There is no
  loop over it anywhere in the file. Removing an entry therefore changes no behaviour. Remove it for
  tidiness, and do not add the missing enforcement loop — that would be a new guard rule, which is out
  of scope for a deletion plan.
- **`verify-routing-guarantee.cjs` is half the fleet merge gate** (`test:fleet` runs
  `routing:verify`). After the edit it checks one tree instead of two. Its `if (!checked) throw new
  Error('no appRouter files found')` at `:56` still passes, because `WebPortal/js/appRouter.js`
  remains. Do not touch the 15-host routing proof itself.

## Work

### 1. Delete the tree

```
modules/          (whole directory, including the 157 empty subdirectories)
css/              (whole directory)
js/               (whole directory)
styles.css        (root file, zero references repo-wide)
```

Delete the directories entirely, not file-by-file — the empty subdirectories are untracked and will
not show in the diff, but leaving them behind preserves the exact confusion this plan removes.

### 2. Strip the six references

Make the edits in the table above. Nothing else in those three files changes.

### 3. Update `CLAUDE.md`

Remove the "There is a second, parallel top-level tree" paragraph. Replace it with one short sentence
recording that the tree was deleted and that `WebPortal/` is now the only application tree, so nobody
reads the old warning and goes looking for a directory that no longer exists.

Do not restructure the rest of the file. In particular leave the `npm ci` paragraph and the
`ui:verify` paragraph exactly as they are. The `ui:verify` violation count is being changed by a
different plan in this batch, and its `CLAUDE.md` wording is corrected by hand afterwards — editing it
here would conflict.

## Guardrails

- **Deletions and reference-stripping only.** No behaviour change to any surviving script beyond
  removing the dead paths.
- **Do not touch anything under `WebPortal/`.** The whole point is that `WebPortal/` is the real tree;
  this plan must not "sync" anything from the dead tree into it. Where the dead tree is *ahead*
  (`admin_grid.html`, `stock_management_grid.html`), that content is **discarded on purpose** — it was
  never deployed and has never been reviewed against the live tree. Do not port it.
- **Do not weaken `npm run test:fleet`** or any script it calls. `routing:verify` must still run its
  full host matrix against `WebPortal/js/appRouter.js`.
- **Do not add the missing `REQUIRED_FILES` enforcement loop.**
- **Do not add or remove an npm dependency**, and do not create a `package-lock.json`.
- **Do not modify `package.json`.**
- Do not touch `docs/`, `BluePrint/`, `.claude/rules/` or `.cursor/rules/` — other plans own those.
- Do not delete `WebPortal/modules/supply-chain-flow/`; a human decision is pending on it.
- No `.sql` file is added, deleted or modified by this plan.

## Acceptance criteria

1. Top-level `modules/`, `css/` and `js/` no longer exist, and neither does root `styles.css`.
2. `git ls-files | grep -cE "^(modules|css|js)/|^styles\.css$"` prints `0`.
3. `WebPortal/` file count is unchanged: `git ls-files WebPortal/ | wc -l` matches its value before
   this plan. **No file under `WebPortal/` is modified.**
4. `grep -n "js/appRouteConfig" scripts/sync-portal-supabase-config.mjs scripts/check-supabase-project.mjs`
   returns only `WebPortal/js/appRouteConfig.json` matches — no bare `js/appRouteConfig.json`.
5. `grep -n "'js'," scripts/check-supabase-project.mjs` returns nothing.
6. `grep -n "qa-data-seeder\|test-scenarios-viewer" scripts/check-supabase-project.mjs` returns nothing.
7. `scripts/verify-routing-guarantee.cjs:35` iterates exactly one path, `WebPortal/js/appRouter.js`.
8. `npm run test:fleet` passes, and its `routing:verify` step still prints
   `ROUTING GUARANTEE HOLDS for this tree`.
9. `node scripts/check-supabase-project.mjs` exits 0 and prints `Supabase project guard OK`.
10. `CLAUDE.md` no longer contains the string `second, parallel top-level tree`.
11. `package.json` is byte-identical to its state before this plan.
