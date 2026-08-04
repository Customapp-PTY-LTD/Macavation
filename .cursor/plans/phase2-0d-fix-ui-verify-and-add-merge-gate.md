# Clear the 65 `ui:verify` violations and make `ui:verify` a merge gate

## Context

`scripts/verify-ui-standard.mjs` proves the design standard in `docs/design/DESIGN_SYSTEM.md`. It
currently **fails on `dev` with exactly 65 violations**, which is why `package.json` deliberately
excludes it from the fleet merge gate. Its own `"//test:fleet"` comment key records the intent:

> `ui:verify` is deliberately EXCLUDED for now: it fails on dev today with 65 design-system violations
> in the Mac assistant/mascot CSS; add it here once those are fixed.

`CLAUDE.md` repeats the warning and tells contributors not to fix them as a side effect of unrelated
work. The result is a documented, permanently-deferred wart, and the design system has **no
enforcement on merges at all**.

This plan clears all 65 and makes the checker a gate, so the standard cannot silently rot again.

### How the checker actually works — read this before choosing fixes

Two facts from `scripts/verify-ui-standard.mjs` decide the whole approach:

1. **`design-tokens.css` is exempt from every hex rule.** Line 64 sets
   `const isTokens = file.endsWith('design-tokens.css')`, and line 72 wraps the raw-hex, legacy-var
   and banned-rgba checks in `if (!isTokens)`. A hex literal inside that one file is never flagged.
2. **Outside that file, *every* hex is flagged** — line 74 matches `/#[0-9a-fA-F]{3,8}\b/` and line 77
   exempts only `#fff`, `#ffffff`, `#000`, `#000000`. Note `#999` is **not** exempt.

`BANNED_HEX` (`:26-38`) is **declared and never read** — `grep -c BANNED_HEX` returns 1, its own
declaration. So there is no "allowed non-token hex" tier: the rule is simply *hexes live in
`design-tokens.css`, nowhere else.*

The gradient rule (`:88`) sits **outside** the `!isTokens` guard, so gradients are banned everywhere,
including in `design-tokens.css`.

### Why most of these are not a colour-rebrand job

50 of the 65 are in `css/mac-assistant.css` (35) and `css/mac-mascot.css` (15). Many are **character
artwork** values, not UI semantics — `#1a1a1a` mascot outlines, `#C4A8B0` blush, `#4A7C59` and
`#2D4A3E` assistant brand greens. Forcing those into `--mac-danger`/`--mac-text` would change how the
mascot is drawn, which needs a designer, not an agent.

Given fact (1) above, there is a better fix that satisfies the standard with **zero visual change**:
give that palette proper names inside `design-tokens.css` and reference them. The standard's real
intent is "colour is declared in one place", and this achieves it exactly.

So the work splits cleanly:

- **Where an existing token already equals the hex, or is the obvious semantic owner** → use it.
- **Where the hex is bespoke artwork** → name it as a new token in `design-tokens.css` and reference it.

## Scope

**In:** all 65 violations across 6 files; new tokens in `design-tokens.css`; `ui:verify` added to
`test:fleet`; the `"//test:fleet"` comment key updated.

**Out:** any change to how anything looks, except the 3 gradients (unavoidable — the standard bans
gradients) and the 4 icon swaps. No re-theming, no token-value changes.

**Out:** `WebPortal/help/` — the checker skips it (`SKIP_DIRS`, `:42`) as a standalone doc theme.

## Work

### 1. `WebPortal/css/design-tokens.css` — name the assistant and mascot palettes

Add a clearly-commented block of new `--mac-*` custom properties holding the bespoke values below,
**at their current exact values** so nothing renders differently. Suggested names; keep the `--mac-`
prefix, since the checker's message and the rest of the system assume it.

| Current hex | Suggested token | Used in |
|---|---|---|
| `#4A7C59` | `--mac-assistant-green` | assistant `:2`, `:228`, `:262`, `:537`; mascot `:342` |
| `#2D4A3E` | `--mac-assistant-green-dark` | assistant `:3`; mascot `:31`, `:211` |
| `#2d6a64` | `--mac-assistant-teal` | assistant `:437`, `:641` |
| `#333333` | `--mac-assistant-ink` | assistant `:4` |
| `#f7faf9` | `--mac-assistant-surface` | assistant `:150` |
| `#f8f9fc` | `--mac-assistant-surface-alt` | assistant `:354` |
| `#f5f8fa` | `--mac-assistant-surface-cool` | assistant `:806` |
| `#e4ecf3` | `--mac-assistant-surface-edge` | assistant `:814` |
| `#c5d0d8` | `--mac-assistant-border-cool` | assistant `:804` |
| `#ffb44f` | `--mac-assistant-amber` | assistant `:549` |
| `#842029` | `--mac-assistant-danger-dark` | assistant `:581` |
| `#999` | `--mac-assistant-muted` | assistant `:794` |
| `#1a1a1a` | `--mac-mascot-ink` | mascot `:212`, `:222`, `:242`, `:252`, `:264` ×2, `:265` |
| `#C4A8B0` | `--mac-mascot-blush` | mascot `:264` |

Do **not** add tokens for the hexes in step 2 — those map to tokens that already exist.

### 2. Replace hexes that an existing token already covers

These are Bootstrap defaults or exact matches for current tokens. Use the existing token, do not mint
a new one.

| Hex | Token | Note |
|---|---|---|
| `#198754` | `var(--mac-green)` | exact match — `--mac-green: #198754` |
| `#146c43` | `var(--mac-green-hover)` | exact match |
| `#dc3545` | `var(--mac-danger)` | Bootstrap red → semantic token |
| `#ffc107` | `var(--mac-warning)` | Bootstrap amber |
| `#0dcaf0` | `var(--mac-info)` | Bootstrap cyan |
| `#6c757d` | `var(--mac-text-tertiary)` | Bootstrap gray-600 |
| `#adb5bd` | `var(--mac-border-strong)` | Bootstrap gray-500 |
| `#f8f9fa` | `var(--mac-bg)` | Bootstrap gray-100 |
| `#b8860b` | `var(--mac-warning-text)` | retired Material goldenrod |

Applies in `css/mac-assistant.css`, `css/mac-mascot.css`, `css/mac-section-collapse.css`, and
`modules/admin/css/admin_grid.css` (`:325-326` `#dc3545`, `:331-332` `#ffc107`, `:337-338` `#198754`,
`:343-344` `#0dcaf0` — 8 violations, all Bootstrap semantics).

### 3. `WebPortal/css/mac-section-collapse.css:21` — drop the legacy variable

The line is one hex violation and one legacy-var violation at once:

```css
    background-color: var(--phoenix-light, #f8f9fa);
```

Replace the whole declaration with `background-color: var(--mac-bg-tertiary);`. The `--phoenix-*`
family is matched by `LEGACY_VARS` (`:40`) and must not survive anywhere outside the bridge in
`design-tokens.css`.

### 4. The 3 gradients — flatten to the dominant stop

The standard is flat design, so these must become solid colours. Use the stop named below so the
choice is deterministic rather than a matter of taste.

| File:line | Current | Replace with |
|---|---|---|
| `css/mac-assistant.css:354` | `linear-gradient(180deg, #f8f9fc 0%, #fff 100%)` | `var(--mac-bg)` — the gradient runs near-white to white; the flat page background is the honest equivalent |
| `css/mac-mascot.css:342` | `linear-gradient(145deg, #4A7C59 0%, #198754 55%, #146c43 100%)` | `var(--mac-green)` — the brand green, which is already the 55% mid-stop |
| `css/mac-mascot.css:380` | `linear-gradient(180deg, rgba(109, 88, 34, 0.65), rgba(25, 135, 84, 0.75))` | `rgba(var(--mac-green-rgb), 0.75)` — the second stop; `--mac-green-rgb` already exists, and `rgb(25,135,84)` is `--mac-green` |

Note `:342` is four violations on one line (three hexes plus the gradient) and `:354` is two — the
substitutions above clear all of them.

These three are the only changes in this plan a human should eyeball on the dev site afterwards.
**Flag them in the run summary** rather than claiming the visual result is verified: there is no
headless canvas here and the checker only proves the gradient is gone, not that the flat colour looks
right.

### 5. The 4 Bootstrap Icons — swap to Font Awesome

`modules/dashboard/html/dashboard_unified.html`. This repo already uses Font Awesome 6 names
elsewhere (`fa-clock-rotate-left`, `fa-circle-question`), so use FA6 equivalents:

| Line | Current | Replace with |
|---|---|---|
| `:19` | `bi bi-bar-chart` | `fas fa-chart-column` |
| `:92` | `bi bi-speedometer2` | `fas fa-gauge-high` |
| `:124` | `bi bi-clock-history` | `fas fa-clock-rotate-left` |
| `:537` | `bi bi-clock` | `fas fa-clock` |

Change only the `bi bi-*` class on each line. Each of those four headings already carries a second,
correct `fas fa-chevron-up mac-section-collapse-icon` element — leave it alone.

**This is the live dashboard markup.** `dashboard_unified.html` serves three dashboards partitioned by
`data-access` wrappers. These four edits are inside existing `<h5>` headings, so no markup moves
between blocks — do not restructure anything, and do not add or remove a `data-dashboard-widget`
attribute.

### 6. `modules/admin/html/admin_grid.html:393` — button grammar

```html
<button type="button" class="btn btn-success" id="issueResolveSubmitBtn">
```

Change `btn-success` to `btn-primary`. Keep the id and every other attribute. `btn-primary` is already
the brand-green filled button, so this is the intended appearance.

### 7. `package.json` — add the gate

Append `ui:verify` to the `test:fleet` chain, keeping the existing steps and their order:

```
"test:fleet": "npm run routing:verify && npm run username:verify && node scripts/verify-phase2-migrations.mjs && npm run ui:verify"
```

Then rewrite the `"//test:fleet"` comment key so it no longer says `ui:verify` is excluded — it is now
included, and the sentence explaining why it was deferred is obsolete. **Keep every other warning in
that comment verbatim**, in particular that `rbac:verify`, `audit:verify` and the Playwright suite must
never be added (they need Supabase service-role keys or a deployed app and would error, blocking every
merge).

`ui:verify` is safe in the gate: pure `fs` reads, no network, no browser, and it runs in seconds.

**This plan does not land unless all 65 are fixed** — the moment `ui:verify` joins `test:fleet`, its
own gate checks the work. That is deliberate. Do not add the gate while leaving violations, and do not
weaken the checker to make them pass.

## Guardrails

- **Never edit `scripts/verify-ui-standard.mjs`.** Not to add an exemption, not to add a file to
  `SKIP_DIRS`, not to soften a rule. The fix is the CSS/HTML, never the checker. This is the one edit
  that would make the whole plan pointless.
- **Do not remove `BANNED_HEX`** even though it is dead code — deleting it is a separate judgment call
  about whether the missing enforcement should be added instead, and it does not belong in this diff.
- **Do not change any existing token's value** in `design-tokens.css`. Add new properties only.
- **Do not touch `WebPortal/help/`** — the checker skips it and a separate plan owns docs.
- **Do not restructure `dashboard_unified.html`.** Four class strings change; nothing else. Markup
  placed in the wrong `data-access` block appears on the wrong dashboard, and anything carrying
  `data-dashboard-widget` is hidden unless its id is registered in three separate places.
- **Do not add or remove an npm dependency**, and do not create a `package-lock.json`.
- Do not add a `.sql` file. Do not delete any file.
- Do not "fix" unrelated CSS while in these files.

## Acceptance criteria

1. `npm run ui:verify` exits 0 and prints `UI STANDARD HOLDS for this tree`.
2. `package.json`'s `test:fleet` ends with `&& npm run ui:verify`, and `npm run test:fleet` passes.
3. The `"//test:fleet"` comment key no longer claims `ui:verify` is excluded, and still warns against
   `rbac:verify`, `audit:verify` and the Playwright suite.
4. **`scripts/verify-ui-standard.mjs` is byte-identical** to its state before this plan.
   `git diff --stat` must not list it.
5. `grep -c "linear-gradient" WebPortal/css/mac-assistant.css WebPortal/css/mac-mascot.css` returns 0
   for both.
6. `grep -rn "bi bi-" WebPortal/modules/dashboard/html/dashboard_unified.html` returns nothing.
7. `grep -rn "btn-success" WebPortal/modules/admin/html/admin_grid.html` returns nothing.
8. `grep -rn -- "--phoenix" WebPortal/css/mac-section-collapse.css` returns nothing.
9. Every hex literal outside `design-tokens.css` is gone from the six touched files:
   `grep -rnE "#[0-9a-fA-F]{3,8}\b" WebPortal/css/mac-assistant.css WebPortal/css/mac-mascot.css WebPortal/css/mac-section-collapse.css WebPortal/modules/admin/css/admin_grid.css`
   returns only `#fff`/`#000` forms, if any.
10. `WebPortal/css/design-tokens.css` contains the new `--mac-assistant-*` and `--mac-mascot-*`
    properties, and `git diff` on that file shows **additions only** — no existing token value changed.
11. No new npm dependency; no `package-lock.json`; no `.sql` file added; no file deleted.
12. The run summary flags the 3 flattened gradients as needing a human visual check on the dev site.
