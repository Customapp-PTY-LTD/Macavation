# Macavation design system

The single source of truth for how the portal looks. Enforced by
`npm run ui:verify` (fails on drift — same idea as routing:verify / rbac:verify).
If this doc and the code disagree, the code + `ui:verify` win; fix this doc.

> Reference module when unsure: **kernel-production**. Reference surface for the
> "target feel": the **sign-in page**.

## The aesthetic in one line

**Quiet chrome, loud data.** A calm, warm, professional tool for people who look
at it all day. Flat surfaces, warm off-whites, one green, tinted status pills,
generous but consistent density.

## Tokens — the only values you may use

All in `WebPortal/css/design-tokens.css`. Never hardcode a hex (white/black
excepted); never re-declare tokens in another file.

**Color**
- Brand / interactive: `--mac-green` `#198754` (+ `--mac-green-hover`, `--mac-green-light`, `--mac-green-rgb`). The ONLY interactive colour: primary actions, links, clickable row keys, active nav.
- Pink `--mac-pink` `#FF005E`: **navbar wordmark only.** Never in components.
- Neutrals: `--mac-bg` `#F7F7F5` · `--mac-bg-secondary` `#FFFFFF` · `--mac-bg-tertiary` `#F0F0EE` · `--mac-border` `#E3E3E0` · `--mac-border-strong` `#D3D3D0`.
- Text (three tones = the hierarchy): `--mac-text` `#1F1F1F` · `--mac-text-secondary` `#52524E` · `--mac-text-tertiary` `#6E6E68`. Do not collapse these.
- Semantic (always as a *tint*: `-light` background + strong text — never a solid slab): success `#2DA44E` · warning `#D4A72C` (text on tint: `--mac-warning-text`) · danger `#CF222E` · info `#0969DA`.
- **Meaning, not decoration:** success = done/healthy · info = in motion · warning = waiting · danger = blocked/destructive · neutral = off/none. Bootstrap blue `#0d6efd`, the Material status palette, and the retired greens (`#008950`, `#2c5530`, `#28a745`) are banned.

**Type scale** (no other font sizes): `--mac-text-xs .75` · `-sm .8125` · `-base .875` · `-md 1` · `-lg 1.25` · `-xl 1.75rem`. One typeface: Inter (`--mac-font`).

**Radius** `--mac-radius-sm/md/lg` (8/10/12px) + `--mac-radius-pill` (badges only). **Spacing** `--mac-space-xs…2xl` (4→48). **Shadows** `--mac-shadow-sm/md/lg/card`. No gradients.

## Components (shared — use these, don't re-invent)

| Concern | Use | File |
|---|---|---|
| Status pill | `MacStatus.pill(status)` | `js/mac-status.js` (+ `.mac-pill-*` in index.css) |
| Row actions | `MacTableActions.render(...)` (⋯ dropdown) | `js/table-actions.js` + `css/table-actions.css` |
| Loading / empty | `macLoadingRow(n)` · `macEmptyRow(n,text)` · `macEmptyState(icon,title,hint)` | `js/ui-states.js` |
| Dialogs | `Swal.fire(...)` — inherits the one skin | `css/swal-theme.css` (no other file styles `.swal2-*`) |
| KPI tiles | `.metric-card` + `.metric-*` | `css/metric-ui.css` |
| Row height | global table standard (`--mac-table-cell-padding-*`) | `css/index.css` — modules must NOT set bare `td/th` padding |

**Buttons (grammar):** one filled green **`btn-primary`** per view (the primary action). `btn-outline-primary` = green secondary. `btn-outline-secondary`/`btn-secondary` = neutral. Cancel is always neutral, **never** filled red. `btn-danger` only for genuinely destructive actions. `btn-success` is banned (use `btn-primary`).

**Icons:** Font Awesome only (`fas`/`far`). Bootstrap Icons (`bi-`) are banned/removed.

**Modals:** Bootstrap modals for forms; `Swal` for confirm/success/error. Both inherit the shared skins — don't add a third.

## Dark mode

Tokens carry dark values (`[data-theme-mode="dark"]` in design-tokens.css); the
sidebar toggle is live. Because modules use tokens, dark "just works" — so in
module CSS use tokens (esp. `var(--mac-bg-secondary)` for surface backgrounds,
never a hardcoded `#fff` background) and it will flip automatically.

## Enforcement

`npm run ui:verify` fails on: raw hex (outside tokens; white/black ok),
`rgba()` Bootstrap-blue / near-black, `var(--phoenix-*)`/legacy names, `.swal2-*`
outside swal-theme.css, `bi-` icons / the bootstrap-icons stylesheet, gradients,
bare `td/th` padding in module CSS, `.badge` min-width, and `btn-success`. Run it
before promoting (it's in the DEV→PROD checklist).
