# Macavation portal — design diagnosis & unification plan

*Audited 2026-07-08 against the live dev build: 10-screen walkthrough (evidence in
[`docs/design/audit/`](audit/)), full CSS inventory, and git archaeology of every
design generation. This is the plan of record for making the portal look like one
product.*

---

## Part 1 — Diagnosis

### 1.1 What the design is *trying* to be

The evidence (tokens, the sign-in page, the client-site alignment commit, the newest
docs) points at one clear intent:

> **A calm, warm, confident operations tool.** Flat surfaces, warm off-whites
> (`#F7F7F5`), one brand green (`#198754`, matched to macavation.co.za), Inter
> everywhere, soft 8–12px radii, tinted status pills, quiet chrome around dense
> operational data.

The sign-in page is the best expression of it. The Stock (Kernel) screen is the best
in-app expression. **The intent is good — the problem is that four design
generations shipped on top of each other and nobody retired the losers.**

### 1.2 The four generations still on screen

| Gen | Era | What it wanted | What's still leaking |
|---|---|---|---|
| 0 | Dec 2025 | Phoenix Bootstrap admin template | 341 `var(--phoenix-*)` refs; `main.css` is still Phoenix-native; Bootstrap-blue `#0d6efd` in 18 places |
| 1 | Dec 2025 | "Process-driven" exception/metric UI | `metric-ui.css` (raw Bootstrap hex), Bootstrap Icons on the dashboard, My Day's saturated red/gold/blue column bars |
| 2 | Feb 2026 | Macavation brand: sharp corners, cream, flat `#008950`, 5px, pink modal titles | `#008950` (a *different* green) in table-actions/admin/kernel CSS; `MODULE_UI_PATTERNS.md` still prescribes sharp corners; pink `#FF005E` navbar wordmark |
| 3 | Feb–Mar 2026 | "Clean & Minimal" `--mac-*` tokens aligned to the client site (`#198754`, 8–12px radii, dark mode) | The current tokens — but only ~6 of 34 module CSS files are token-native |
| 4 | Jul 2026 | MacTableActions + row-height standardisation | Good — this is the pattern to generalise |

### 1.3 What an end user actually experiences (from the walkthrough)

1. **The product changes personality between screens.** Sign-in is warm and green;
   the app header shouts the brand in **pink**; the dashboard alerts arrive in a
   mustard-gold banner; **My Day greets you with a purple-blue gradient hero and
   three columns headed in saturated gold, pure red, and Bootstrap blue**
   ([03-my-day.png](audit/03-my-day.png)) — red reading as "error" when it just
   means "production queue". Nothing else in the app looks like this screen.
2. **Color has no consistent meaning.** Six greens, four text-grays, three status
   palettes and five badge idioms coexist. Blue is sometimes "info", sometimes a
   calendar accent, sometimes a column header, sometimes a focus ring. When color
   stops meaning anything, users stop reading it — which defeats a status-driven
   ops tool.
3. **Text hierarchy is gone.** All three text tokens are `#1F1F1F` in light mode
   (the July contrast fix overshot). Every label, hint and value has equal weight,
   so dense screens read as a wall. (Dark mode still has a proper 3-tier triad —
   light mode lost it.)
4. **Broken components erode trust.** The admin Users table renders Status as
   solid green/red blocks with unreadable text ([08-admin.png](audit/08-admin.png)).
   The Add User modal's Cancel is a **filled red button** — visually more dangerous
   than Save ([09-admin-user-modal.png](audit/09-admin-user-modal.png)).
5. **The data itself breaks the aesthetic.** "Oil yield **100000%**", "Sound kernel
   recovery **0%**", "Cover: — · —" on the executive dashboard
   ([02-dashboard.png](audit/02-dashboard.png)). To an executive that reads as
   "this system is wrong", no matter how nice the tiles are. Placeholder/derived
   values are part of design.
6. **Primary actions don't guide.** My Day puts a filled green button on *every*
   row; dispatch cards carry three buttons of three weights each. When everything
   is primary, nothing is.
7. **Auth surfaces are three different products.** Sign-in (own hand-copied token
   values, pill buttons), reset-password (hand-inlined hex), the app (tokens). The
   sign-in Google button renders in **Indonesian** ("Lanjutkan dengan Google") —
   locale not pinned.
8. **Dark mode is a trap.** A visible sidebar toggle, but only 1 of 34 module CSS
   files has dark rules — flip it and grids render as white boxes on dark chrome.
9. **Chrome is loud, data is quiet.** Huge page titles, multi-sentence instructional
   paragraphs above almost every table (3 lines of microcopy on Stock before any
   data), two Help buttons visible at once in the admin modal. The reading order
   should be: data first, guidance on demand.

### 1.4 What's already right (build on this, don't restart)

- `design-tokens.css` exists and dark-mode values are defined.
- `kanban.css`, `dashboard.css`, `admin_grid.css`, crm/roles/users CSS are already
  token-native — proof the migration works.
- **MacTableActions** (Gen 4) proves the winning pattern: one shared JS+CSS
  standard, documented, rolled through every grid in one commit.
- One typeface (Inter), one reference module convention (kernel-production), tables
  standardised on shared row-height tokens.
- The sign-in page demonstrates the target feeling — we're unifying *toward*
  something that already exists.

---

## Part 2 — The plan

**Strategy: define one aesthetic (Part 2.1), encode it in tokens and five shared
components (2.2–2.3), migrate surfaces in priority order (2.4–2.5), then make the
standard self-enforcing so it can't drift again (2.6).** Each phase is shippable
alone on dev, verified with the same screenshot walkthrough.

### 2.1 The aesthetic, stated once (the north star)

**"Quiet chrome, loud data."** A calm, warm, professional tool for people who look
at it eight hours a day.

1. **One green.** `#198754` is the only interactive/brand color. It marks: the one
   primary action per view, links/clickable row keys, active nav. `#008950`,
   `#2c5530`, `#28a745` are retired. **Pink `#FF005E` survives only in the navbar
   wordmark** (client brand); it never appears in components.
2. **Color = meaning, never decoration.** Exactly one semantic set: success
   `#2DA44E` · warning `#D4A72C` · danger `#CF222E` · info `#0969DA`, always as
   *tinted pill / tinted panel* (tint background + strong text), never solid slabs.
   Bootstrap-blue `#0d6efd` is banned. Red is reserved for destructive/danger —
   never a column header, never a Cancel button.
3. **Three text tones, restored.** Light mode: text `#1F1F1F`, secondary
   `#52524E`, tertiary `#6E6E68` (both AA on `#F7F7F5`). Hierarchy comes from
   tone + size, not bold-everything.
4. **One shape language.** Radii only from tokens (8/10/12px + pill *for badges
   only*). No sharp corners, no pill buttons in-app.
5. **One primary action per view.** Filled green appears once per screen/card
   context; everything else is outline or ghost. Cancel is always ghost/neutral.
   Destructive confirmation happens in the dialog, not by painting buttons red.
6. **Chrome recedes.** Page title smaller (`h1.h4`-scale), instructional paragraphs
   collapse into a single muted line or the Help link, one Help entry point per
   view. Numbers and tables get the ink.
7. **States are designed.** One shared loading row, one empty-state block, and a
   rule for absurd values: derived metrics render `—` when inputs are missing —
   never `100000%`.

### 2.2 Phase 0 — Stop the visible bleeding (≤1 day, immediate user-visible wins)

| # | Fix | Where |
|---|---|---|
| 0.1 | Restore the light-mode text triad (`#52524E` / `#6E6E68`) | `design-tokens.css:25-27` + remove the `.text-muted`/`.text-secondary` flattening in `main.css:1185-1198` |
| 0.2 | Fix admin Status badges (unreadable solid blocks) | admin users/roles render path + badge CSS |
| 0.3 | Cancel buttons: ghost/neutral, never filled red | `modal_user.html` + sweep `btn-danger` cancels |
| 0.4 | My Day: kill the gradient hero + saturated red/gold/blue column bars → warm flat panel + tinted section headers; demote per-row filled buttons to outline | `my_day.css` / `my_day.js` |
| 0.5 | Kernel calendar + focus rings: Bootstrap blue → green/info tokens | `kernel_production_grid.css`, `mobile-first.css:48` |
| 0.6 | Executive dashboard: guard absurd/placeholder metrics to `—` | `executive_dashboard.js` render guards |
| 0.7 | Pin the Google button locale to `en` | signin GSI init |
| 0.8 | Hide the dark-mode toggle until Phase 5 (it's structurally broken) | `index.html:455` |

### 2.3 Phase 1 — Token & component consolidation (2–3 days)

1. **Tokens** (`design-tokens.css`):
   - Add a type scale: `--mac-text-xs .75rem / sm .8125rem / base .875rem /
     md 1rem / lg 1.25rem / xl 1.75rem` (the census found **34** ad-hoc sizes; these
     6 cover the app).
   - Radius + spacing already exist — enforcement comes from `ui:verify` (Phase 4).
   - Retire the local re-definitions of macadamia/forest/gold in `index.css:2-15`.
2. **Five shared components** (each = small CSS + tiny JS helper, the
   MacTableActions recipe):
   - **`MacStatus`** — the single status→pill map (`macStatus(status)` returns the
     tinted pill HTML). Replaces the 5 badge languages incl. `batch-status.css`
     Material palette and every hand-rolled `bg-success` template string.
   - **Buttons** — codify `btn-primary` (green filled, the only filled), outline,
     ghost; remap `btn-success` usages (31) to `btn-primary`; fix the green→blue
     hover bug (`main.css:715`).
   - **Cards/tiles** — one card + one KPI-tile spec (replaces `metric-ui.css` raw
     hex tiles); consistent tile grid on the dashboard.
   - **Swal theme** — one `Swal.mixin` in `common.js` (brand-styled confirm/cancel,
     one radius) so all **619** `Swal.fire` calls inherit a single look; delete the
     three competing skins.
   - **States** — `macLoadingRow()` / `macEmptyState()` helpers replacing 61
     hand-rolled "Loading..." variants.
3. **Icons** — standardise on Font Awesome (822 uses); replace the 109 `bi-` uses
   (11 files, dashboard-era) and drop the Bootstrap Icons CDN link.
4. **Docs**: replace `UI_DESIGN_INSTRUCTIONS.md` (it still prescribes Gen-2 values
   — `#008950`, 5px, `far` icons — that the tokens moved past) and retire
   `MODULE_UI_PATTERNS.md`. One doc: `docs/design/DESIGN_SYSTEM.md`, matching the
   tokens *exactly*.

### 2.4 Phase 2 — Kill the legacy layers (2–3 days)

1. **`main.css` de-Phoenixing**: it's the biggest file (1684 lines) and still
   Phoenix-native. Rewrite its component blocks onto `--mac-*` tokens; collapse the
   duplicate skins (`main.css` vs `index.css` both define `.card`, `.btn-primary`,
   `.form-control`, modals — the double-definition is *why* fixes keep landing
   twice). Target: `index.css` absorbs the winning definitions; `main.css` shrinks
   to layout/scaffolding.
2. Delete dead layers: `pwa-offline.css` (246 lines, PWA disabled), the
   `--macadamia-*`/`--forest-*`/`--wedgewood` bridge consumers (~23 refs), stub
   module CSS files (11 files of 1–8 lines).
3. Auth surfaces: `signin.css` imports `design-tokens.css` instead of hand-copied
   values (fix the pill-button divergence while there); `reset-password.html` uses
   the shared tokens; both keep the split-panel look — it's the brand's best face.

### 2.5 Phase 3 — Module sweep (1–2 weeks, mechanical, one module per PR)

Priority = user traffic: kernel pipeline (grower-intake → kernel-production →
stock → dispatch) → oil pipeline → dashboard/My Day → CRM/support → admin/test.
Per module checklist:

- [ ] Raw hex → tokens (`#dee2e6`→border, `#212529`→text, `#0d6efd`→green/info…)
- [ ] `var(--phoenix-*)` → `--mac-*`
- [ ] Badges → `MacStatus`; buttons → the three-tier grammar (one filled per view)
- [ ] Loading/empty → shared helpers; microcopy paragraphs → one muted line
- [ ] Header = reference pattern (title + one-line subtitle + toolbar, one Help)
- [ ] Dark-mode render check (this is what makes Phase 5 possible)

`grower_intake_grid.css` (476 lines, 36 raw hex) and `kernel_production_grid.css`
(330, 38 raw hex) are the heaviest; `metric-ui.css` dies into the Phase-1 tile.

### 2.6 Phase 4 — Make it self-enforcing (1 day, do not skip)

This codebase is edited by multiple people and AI agents in parallel — **standards
here only survive as executable checks** (proven by routing:verify / rbac:verify).

- **`npm run ui:verify`** — fails CI/pre-promotion on: raw hex outside
  `design-tokens.css` (small allowlist), any new `--phoenix-*` consumer, banned
  values (`#0d6efd`, `#008950`, `bi-` icons), per-module `td/th` padding,
  `bg-success|bg-danger` badge strings in JS templates (must use `MacStatus`),
  `Swal.fire` with inline styling, filled-red cancel buttons.
- Add `ui:verify` to the DEV_TO_PROD checklist §1 next to the other verifies.
- The screenshot walkthrough (the spec used for this audit) becomes
  `npm run ui:screens` — rerun after each phase and eyeball the same 10 frames.

### 2.7 Phase 5 — Dark mode, properly (optional, after the sweep)

The tokens already define dark values; after Phase 3 the modules stop hardcoding
light. Then: re-enable the toggle, walk the 10 screens dark, patch stragglers.
Until then the toggle stays hidden — a half-dark mode is worse than none.

---

## Sequencing summary

| Phase | Effort | User sees |
|---|---|---|
| 0 — Stop the bleeding | ≤1 day | Readable hierarchy again; My Day stops screaming; broken badges fixed; no absurd KPIs |
| 1 — Tokens + 5 components | 2–3 days | One button/badge/dialog language everywhere |
| 2 — Legacy layer removal | 2–3 days | Sign-in/app/reset feel like one product; smaller CSS, fewer double-styles |
| 3 — Module sweep | 1–2 wks (parallelisable per module) | Every screen matches the reference |
| 4 — `ui:verify` guardrails | 1 day | It stays fixed |
| 5 — Dark mode | 2–3 days | A dark mode that actually works |

All work lands on **dev** first, per the standing promotion rule (dev → demo →
prod), and each phase re-runs the 10-screen walkthrough as its acceptance check.

## Decisions needed from the owner

1. **Pink**: confirm it survives only as the navbar wordmark (recommended), or
   retire it entirely.
2. **Dark mode**: OK to hide the toggle until Phase 5?
3. **Microcopy**: OK to collapse instructional paragraphs into single muted lines +
   Help links (the text is preserved in the help guide)?
4. Phase 0 can start immediately on dev — go/no-go.
