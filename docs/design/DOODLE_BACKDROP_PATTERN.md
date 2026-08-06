# Doodle backdrop pattern

A portable guide for reimplementing Macavation’s faint “doodle scatter” aesthetic in another product — same art system, different thematic motifs.

This document is self-contained. You do not need the Macavation repo to follow it. Macavation paths appear only in the appendix as a reference implementation.

---

## 1. Purpose and aesthetic goal

The doodles are a quiet **easter egg**: line-art motifs scattered toward the edges of the viewport, visible in the dimmed area **around** a modal or auth card. They should be noticed on a second look, not as loud branding.

**Important mental model:** the art is **not** drawn on the modal chrome (no decorative border frame on the dialog itself). It is a **full-viewport backdrop layer** behind the dialog. Motifs sit in corners and side margins so they read as “around” the card while the center stays clear for UI.

```
page content
  → backdrop tint + light blur
      → scatter line-art (~18% opacity)
          → modal / dialog (opaque, above)
```

### Opacity ranges (reference)

| Surface | Opacity |
|---------|---------|
| Live collage, light mode | ~0.18–0.22 by motif type |
| Modal / alert composite (`::after`) | **0.18** |
| Live collage, dark mode | ~0.26–0.28 + `filter: brightness(1.5)` |
| Live collage, mobile survivors (≤768px) | **0.65** |

---

## 2. Art style rules (keep when re-theming)

These rules define the look. Change the **subjects** (what you draw); keep the **language** (how you draw).

### Line language

- Hand-drawn **line art**: `fill: none`, `stroke-linecap: round`, `stroke-linejoin: round`
- No flat fills, gradients, or photo textures
- Two-tone palette: one colour for “object” motifs, one for “botanical / accent” motifs
- Bake **hex colours into the SVG** — image-context SVGs (used as `<img>` or CSS `background-image`) cannot see page CSS variables or `currentColor`

### Motif SVG anatomy (live / detailed assets)

- Canvas: **`viewBox="0 0 120 120"`**
- Embedded `<style>` with a small class system:

```css
.ln { fill: none; stroke-linecap: round; stroke-linejoin: round; }
.object { stroke: #YOUR_PRIMARY; }   /* e.g. warm brown */
.accent { stroke: #YOUR_ACCENT; }    /* e.g. green */
.main  { stroke-width: 2.4; }
.mid   { stroke-width: 1.8; }
.fine  { stroke-width: 1.2; }
.vfine { stroke-width: 0.9; }
.dot   { fill: #YOUR_PRIMARY; stroke: none; }
```

### Detail vocabulary (live motifs only)

Use sparingly so pieces still read at low opacity:

- Seam / groove double-lines for depth
- Stipple dots for texture
- Short hatch ticks for form shading
- Soft highlight arcs (implied upper-left light)
- One signature internal feature (midrib, crack outline, label box, etc.)

### Composite simplification rule (critical)

The modal backdrop uses a **baked composite SVG**, not the detailed motif files. At ~18% opacity, full detail muddies into noise.

For each motif in the composite:

1. Keep the **silhouette** outline
2. Keep **1–2 signature internal lines** only
3. Use a uniform **stroke-width of 3**
4. **Drop** stipple, ticks, hatch, tertiary veins, and micro-details

Live detailed SVG → composite silhouette. Never paste the full-detail paths into the backdrop composite.

### Layout language

- **Edge ring:** motifs toward corners and side margins
- **Center clear:** reserve the middle for the card / dialog
- Slight rotations (±6° to ±20°) so the scatter feels casual, not a grid
- Mix sizes (small accents + larger hero motifs)

---

## 3. Architecture: two surfaces, one layout

| Surface | Mechanism | Assets |
|---------|-----------|--------|
| Auth / landing collage | Fixed full-viewport host + live `<img>` motifs | Individual motif SVGs (full detail) |
| Modal / alert backdrop | CSS pseudo-element + one composite SVG as `background-image` | Baked composite (simplified silhouettes) |

Both surfaces should share the **same slot map** (positions, rotations, relative sizes) so the product feels consistent.

### Why the composite inlines paths

CSS `background-image` SVGs run in a restricted context:

- **External** references (`<use href="other-file.svg#id">`) do not work
- Same-document `<defs>` / `<use>` is historically flaky across browsers in that context

**Portable choice:** inline every path in the composite. Do not rely on `<use>`.

### Distortion trade-off (intentional)

The composite uses:

- `viewBox="0 0 1600 900"`
- `preserveAspectRatio="none"`
- CSS `background-size: 100% 100%`

Motifs stretch on tall or narrow viewports. That is accepted so the edge ring always covers the viewport; it is not a bug.

### Dark mode gap (modal composite)

The live collage can lift opacity and apply `brightness(1.5)` in dark mode. The reference modal/alert composite has **no dark-mode variant** — the same 0.18 SVG is used. Adopters should decide whether to:

- Leave it (fainter on dark UIs), or
- Add a dark-mode rule (higher opacity and/or a lighter-stroke composite)

---

## 4. Layout recipe and slot map

Use ~10–13 slots. The table below is a **placement template** from the Macavation reference. Replace motif *subjects*; keep the *geometry* unless you deliberately redesign the ring.

| Slot | Role (example) | top% | left% | width (px) | rot | float? | duration | delay |
|------|----------------|------|-------|------------|-----|--------|----------|-------|
| s1 | primary large | 6 | 5 | 132 | −14° | yes | 15s | — |
| s2 | accent small | 4 | 27 | 66 | 9° | yes | 12s | −3s |
| s3 | secondary mid | 10 | 62 | 98 | 20° | no | — | — |
| s4 | primary large | 6 | 84 | 120 | 12° | yes | 17s | −6s |
| s5 | accent mid | 25 | 90 | 82 | −6° | no | — | — |
| s6 | accent small | 59 | 89 | 58 | 14° | yes | 13s | −2s |
| s7 | primary large | 80 | 83 | 122 | −18° | yes | 16s | −8s |
| s8 | secondary mid | 87 | 57 | 92 | −10° | no | — | — |
| s9 | accent small | 89 | 33 | 64 | 10° | yes | 14s | −5s |
| s10 | primary large | 79 | 5 | 120 | 16° | yes | 18s | −4s |
| s11 | accent mid | 53 | 3 | 80 | 8° | no | — | — |
| s12 | primary mid | 29 | 7 | 92 | −10° | yes | 15s | −7s |
| s13 | accent tiny | 41 | 16 | 46 | −6° | yes | 11s | −1s |

**Drift:** only some slots use a gentle vertical float (11–18s, negative delays to desync). Others stay static so the field does not feel like everything is bobbing.

**Mobile (live collage only):** hide center-ish slots (in the reference: s2, s3, s8, s9, s13) so motifs do not sit behind the card; raise remaining opacity to ~0.65. Modal composites typically keep the full bake with no mobile cull.

### Percent → composite conversion

On a **1600 × 900** canvas, each live slot becomes a `<g>`:

```
translate(left% × 1600, top% × 900)
  scale(widthPx ÷ 120)
  rotate(θ 60 60)
```

Example for s1 (`top: 6%`, `left: 5%`, `width: 132`, `rot: -14`):

```xml
<g transform="translate(80,54) scale(1.10) rotate(-14 60 60)"
   fill="none" stroke="#YOUR_PRIMARY" stroke-width="3"
   stroke-linecap="round" stroke-linejoin="round">
  <!-- silhouette + signature lines only -->
</g>
```

`rotate(... 60 60)` assumes the motif was authored in a 120×120 box with its visual center near (60, 60).

---

## 5. CSS recipes

Tokenize colours for your brand (examples use `--brand-*`).

### 5.1 Bootstrap-style modal backdrop

Bootstrap’s default `--bs-backdrop-opacity: 0.5` multiplies the whole backdrop. Force **opacity: 1** and put alpha only in the tint, so the scatter art is not crushed.

```css
.modal-backdrop,
.modal-backdrop.show {
  opacity: 1; /* alpha lives in the tint below */
  background-color: rgba(var(--brand-primary-rgb), 0.05);
  -webkit-backdrop-filter: blur(2px);
  backdrop-filter: blur(2px);
}

.modal-backdrop.show::after {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  opacity: 0.18;
  background-image: url("../assets/decor/backdrop-scatter.svg");
  background-size: 100% 100%;
  background-position: center;
  background-repeat: no-repeat;
}
```

### 5.2 SweetAlert2 / nested-container dialogs

When the same element owns both backdrop and popup, put tint and art on pseudo-elements **behind** the dialog:

```css
.swal2-container.swal2-backdrop-show {
  background: transparent !important;
}

.swal2-container.swal2-backdrop-show::before,
.swal2-container.swal2-backdrop-show::after {
  content: "";
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
}

.swal2-container.swal2-backdrop-show::before {
  background-color: rgba(var(--brand-primary-rgb), 0.05);
  -webkit-backdrop-filter: blur(2px);
  backdrop-filter: blur(2px);
}

.swal2-container.swal2-backdrop-show::after {
  opacity: 0.18;
  background-image: url("../assets/decor/backdrop-scatter.svg");
  background-size: 100% 100%;
  background-position: center;
  background-repeat: no-repeat;
}
```

Adapt selectors to your dialog library; keep the **transparent container + `z-index: -1` pseudos** pattern.

### 5.3 Optional auth / landing live scatter

**HTML sketch:**

```html
<div class="auth-scatter" aria-hidden="true">
  <img class="scatter-item scatter-primary float s1"
       src="assets/decor/motif-a.svg" alt=""
       style="--rot:-14deg; top:6%; left:5%; width:132px; animation-duration:15s;">
  <!-- …more slots… -->
</div>
```

**CSS sketch:**

```css
.auth-scatter {
  position: fixed;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
}

.scatter-item {
  position: absolute;
  display: block;
  height: auto;
  transform: rotate(var(--rot, 0deg));
}

.scatter-primary { opacity: 0.20; }
.scatter-accent  { opacity: 0.22; }
.scatter-secondary { opacity: 0.18; }

@media (prefers-reduced-motion: no-preference) {
  .scatter-item.float {
    animation: decorDrift 15s ease-in-out infinite;
  }
}

@keyframes decorDrift {
  0%, 100% { transform: rotate(var(--rot, 0deg)) translateY(0); }
  50%      { transform: rotate(var(--rot, 0deg)) translateY(-16px); }
}

[data-theme-mode="dark"] .scatter-item { filter: brightness(1.5); }
[data-theme-mode="dark"] .scatter-primary { opacity: 0.26; }
[data-theme-mode="dark"] .scatter-accent  { opacity: 0.28; }
[data-theme-mode="dark"] .scatter-secondary { opacity: 0.24; }

@media (max-width: 768px) {
  .auth-scatter .s2,
  .auth-scatter .s3,
  .auth-scatter .s8,
  .auth-scatter .s9,
  .auth-scatter .s13 { display: none; }
  .scatter-item { opacity: 0.65; }
}

/* Content above scatter */
.auth-container { position: relative; z-index: 1; }
```

### Accessibility / inertness contract

- Scatter host: `aria-hidden="true"`
- Motif images: `alt=""`
- All scatter layers: `pointer-events: none`
- Z-index: scatter `0`, content `1`; for nested dialogs, art/tint pseudos at `-1`

Decor must never capture clicks or appear in the accessibility tree.

---

## 6. How to re-theme for another product

1. **Keep the system:** layering, opacity band, edge ring, stroke hierarchy, composite simplification, Bootstrap opacity override.
2. **Pick 4–6 new subjects** that match your domain (tools, animals, symbols, product shapes — not Macavation nuts/oil/leaves).
3. **Author detailed motif SVGs** on 120×120 with the class-based stroke system and baked brand hexes.
4. **Lay out the live collage** using the slot table (or your own edge ring).
5. **Bake the composite:** convert each slot with the formula in §4; use **simplified** silhouettes only; inline all paths; set `preserveAspectRatio="none"`.
6. **Wire CSS** for modals (and optionally auth + alert library) per §5.
7. **Verify:** open the composite SVG directly in a browser at **full opacity** and confirm motifs form an edge ring with a clear center before applying CSS opacity `0.18`.

Do **not** copy Macavation motif artwork verbatim. Copy the pattern, not the icons.

---

## 7. Implementation checklist

- [ ] 4–6 thematic motif SVGs (120×120, baked hexes, stroke hierarchy)
- [ ] Live collage (optional) with edge-ring slots, inertness attrs, reduced-motion drift
- [ ] Composite SVG: 1600×900, inlined simplified paths, `preserveAspectRatio="none"`
- [ ] Modal backdrop: `opacity: 1` + tint alpha + blur + `::after` scatter at 0.18
- [ ] Alert library (if any): transparent container + `::before`/`::after` at `z-index: -1`
- [ ] Mobile cull + opacity bump for live collage
- [ ] Dark-mode decision for live collage and (optionally) modal composite
- [ ] Full-opacity visual check of the composite edge ring

### Common pitfalls

| Pitfall | Fix |
|---------|-----|
| Art sits on top of the dialog | For nested containers, put tint/art on `::before`/`::after` with `z-index: -1` |
| Scatter looks too dark / crushed | Bootstrap: set backdrop `opacity: 1`; put alpha only in the tint colour |
| Expecting CSS variables inside SVGs | Bake hexes; handle dark mode with CSS filters on the host |
| Full-detail paths in the composite | Simplify to silhouette + signature lines at stroke 3 |
| External `<use>` in background SVG | Inline paths |
| Motifs behind the card on mobile | Cull center-ish slots; raise surviving opacity |
| Forgetting `preserveAspectRatio="none"` | Required for full-viewport stretch with `background-size: 100% 100%` |

---

## 8. Appendix — Macavation reference paths

For humans who still have this repo:

| Piece | Path |
|-------|------|
| Bootstrap modal backdrop | `WebPortal/css/modal-theme.css` |
| SweetAlert mirror | `WebPortal/css/swal-theme.css` |
| Live scatter CSS | `WebPortal/css/signin.css` (`.auth-scatter`, `.scatter-item`, drift, mobile) |
| Live scatter markup | `WebPortal/signin.html` |
| Motif SVGs + composite | `WebPortal/assets/decor/` (`mac-*.svg`, `backdrop-scatter.svg`) |
| Brand colour tokens | `WebPortal/css/design-tokens.css` (`--mac-brown`, `--mac-green`, RGB companions) |

Reference brand hexes (do not reuse unless your product shares the brand):

- Primary / object: `#6d5822` (mac-brown)
- Accent: `#198754` (mac-green)

Note: `modal-theme.css` also sets a `max-width: 960px` on `.modal-dialog`. That is product chrome sizing, **not** part of the doodle pattern.
