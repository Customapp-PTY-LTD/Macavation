#!/usr/bin/env node
/**
 * ui:verify — proves the design standard for the working tree (docs/design/DESIGN_SYSTEM.md).
 *
 * The portal is edited by several people and AI agents in parallel; the visual
 * standard only survives as an executable check (same philosophy as
 * routing:verify / rbac:verify). Fails with file:line violations when:
 *   1. CSS uses banned raw hex (Bootstrap defaults / retired greens / blues)
 *      outside design-tokens.css
 *   2. Anything consumes var(--phoenix-*) or the legacy macadamia/forest/gold
 *      names outside the bridge in design-tokens.css
 *   3. .swal2-* is styled outside css/swal-theme.css
 *   4. Bootstrap Icons are used (Font Awesome is the one icon set)
 *   5. CSS declares a linear-gradient (flat design)
 *   6. Module CSS re-declares td/th padding (table standard owns row height)
 *   7. .badge gets a min-width (stretched-block regression)
 *   8. btn-success is used (button grammar: btn-primary is the one filled green)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', 'WebPortal');

const BANNED_HEX = [
  // Bootstrap blue family (primary must be brand green)
  '#0d6efd', '#0b5ed7', '#0a58ca', '#9ec5fe', '#cfe2ff', '#e7f1ff', '#dbeafe',
  // retired greens (brand green is #198754, success token #2DA44E)
  '#008950', '#2c5530', '#28a745',
  // Bootstrap semantic reds/ambers/teals (semantic tokens exist)
  '#dc3545', '#c82333', '#bb2d3b', '#b02a37', '#ffc107', '#fd7e14', '#17a2b8', '#0dcaf0',
  // Bootstrap grays (neutral tokens exist)
  '#212529', '#495057', '#6c757d', '#adb5bd', '#dee2e6', '#e9ecef', '#f8f9fa',
  // Material status palette (retired — use semantic token tints / MacStatus)
  '#fff8e1', '#b8860b', '#f3e5f5', '#6a1b9a', '#ffebee', '#c62828',
  '#e3f2fd', '#1565c0', '#e8f5e9', '#2e7d32',
];

const LEGACY_VARS = /var\(--(phoenix|macadamia|forest|gold|earth|shadow-warm|primary-wedgewood|secondary-wedgewood|tertiary-wedgewood|accent-wedgewood)/i;

const SKIP_DIRS = new Set(['node_modules', 'assets', 'help']); // help = standalone doc theme (own lineage)

function walk(dir, exts, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), exts, out);
    } else if (exts.includes(path.extname(entry.name))) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

const violations = [];
function violate(file, lineNo, rule, detail) {
  violations.push(`${path.relative(ROOT, file)}:${lineNo}  [${rule}]  ${detail}`);
}

const cssFiles = walk(ROOT, ['.css']);
const codeFiles = walk(ROOT, ['.html', '.js']);

for (const file of cssFiles) {
  const isTokens = file.endsWith('design-tokens.css');
  const isSwalTheme = file.endsWith('swal-theme.css');
  const isModuleCss = file.includes(`${path.sep}modules${path.sep}`);
  const lines = fs.readFileSync(file, 'utf8').split('\n');

  lines.forEach((line, i) => {
    const n = i + 1;
    const lower = line.toLowerCase();
    if (!isTokens) {
      // General raw-hex ban: any hex literal except white/black must be a token.
      const hexes = line.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
      for (const h of hexes) {
        const v = h.toLowerCase();
        if (['#fff', '#ffffff', '#000', '#000000'].includes(v)) continue;
        violate(file, n, 'raw-hex', `${h} — use a --mac-* token`);
      }
      if (LEGACY_VARS.test(line)) violate(file, n, 'legacy-var', line.trim().slice(0, 90));
      // rgba() forms of banned colours the hex map can't catch (Bootstrap blue / near-black)
      if (/rgba\(\s*13\s*,\s*110\s*,\s*253/.test(lower)) violate(file, n, 'banned-rgba', 'rgba Bootstrap-blue — use rgba(var(--mac-green-rgb), …)');
      if (/rgba\(\s*33\s*,\s*37\s*,\s*41/.test(lower)) violate(file, n, 'banned-rgba', 'rgba near-black — use a --mac text token');
    }
    if (!isSwalTheme && /^\s*[^\/*]*\.swal2-/.test(line) && !line.includes('swal-theme.css')) {
      violate(file, n, 'swal-skin', 'style .swal2-* only in css/swal-theme.css');
    }
    if (lower.includes('linear-gradient(')) {
      violate(file, n, 'gradient', 'flat design — no gradients');
    }
    if (isModuleCss && /\b(td|th)\b[^{}]*\{/.test(line) === false && /^\s*(padding)\s*:/.test(line)) {
      // handled by block scan below
    }
    if (/\.badge[^{]*\{/.test(line) || /^\s*min-width/.test(line)) {
      // handled by block scan below
    }
  });

  // Rule-level scans: match each `selector { body }` (CSS here is un-nested;
  // @media wrappers are skipped and their inner rules matched individually).
  const src = fs.readFileSync(file, 'utf8');
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = ruleRe.exec(src)) !== null) {
    const selector = m[1];
    const body = m[2];
    const lineNo = src.slice(0, m.index).split('\n').length;
    // row-height: flag only a BARE td/th target (blanket cell override), not
    // td as an ancestor (`td code`) nor a specifically-classed cell (`td.x`).
    const bareCellTarget = selector.split(',').some((sel) => {
      const last = sel.trim().split(/[\s>+~]+/).pop() || '';
      return /^(td|th)(:[a-z-]+(\(.*\))?)?$/i.test(last);
    });
    if (isModuleCss && bareCellTarget && /padding\s*:/.test(body)) {
      violate(file, lineNo, 'row-height', 'module CSS must not set bare td/th padding (table standard owns row height)');
    }
    if (/\.badge(\b|:|\.|,|\s)/.test(selector) && /min-width\s*:/.test(body)) {
      violate(file, lineNo, 'badge-stretch', '.badge must size to content (no min-width)');
    }
  }
}

for (const file of codeFiles) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const n = i + 1;
    if (/class="[^"]*\bbi bi-/.test(line) || /['"`][^'"`]*\bbi bi-/.test(line)) {
      violate(file, n, 'icon-set', 'Bootstrap Icons banned — use Font Awesome (fas/far)');
    }
    if (line.includes('bootstrap-icons')) {
      violate(file, n, 'icon-set', 'bootstrap-icons stylesheet must not be loaded');
    }
    if (/btn-success\b/.test(line)) {
      violate(file, n, 'button-grammar', 'btn-success banned — btn-primary is the one filled green');
    }
    if (LEGACY_VARS.test(line)) {
      violate(file, n, 'legacy-var', line.trim().slice(0, 90));
    }
  });
}

if (violations.length) {
  console.error(`UI STANDARD VIOLATIONS (${violations.length}):\n`);
  for (const v of violations.slice(0, 200)) console.error('  ' + v);
  if (violations.length > 200) console.error(`  … and ${violations.length - 200} more`);
  console.error('\nSee docs/design/DESIGN_SYSTEM.md for the standard.');
  process.exit(1);
}
console.log('UI STANDARD HOLDS for this tree (css tokens, one icon set, one dialog skin, button grammar).');
