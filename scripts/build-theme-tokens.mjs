#!/usr/bin/env node
/**
 * Writes the MacView colour themes into WebPortal/css/design-tokens.css as CSS token blocks.
 *
 * Source of truth: WebPortal/js/mac-theme-palettes.js (12 palettes copied from Mike's MacView
 * prototype). CSS may not hold raw hex outside design-tokens.css (ui:verify), so each
 * theme x mode becomes one `:root[data-mac-theme=".."][data-mac-mode=".."]` block between the
 * GENERATED markers. js/themes.js sets those two attributes on <html>.
 *
 *   node scripts/build-theme-tokens.mjs           rewrite the generated section
 *   node scripts/build-theme-tokens.mjs --check   exit 1 if the file is out of date (test:fleet)
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORTAL = path.join(__dirname, '..', 'WebPortal');
const PALETTES = path.join(PORTAL, 'js', 'mac-theme-palettes.js');
const TOKENS = path.join(PORTAL, 'css', 'design-tokens.css');
const START = '/* ===== GENERATED THEME TOKENS: START (scripts/build-theme-tokens.mjs — do not edit by hand) ===== */';
const END = '/* ===== GENERATED THEME TOKENS: END ===== */';

const sandbox = { globalThis: {} };
sandbox.window = sandbox.globalThis;
vm.runInNewContext(fs.readFileSync(PALETTES, 'utf8'), sandbox, { filename: PALETTES });
const P = sandbox.globalThis.MacThemePalettes;
if (!P) throw new Error('mac-theme-palettes.js did not define MacThemePalettes');

const blocks = [];
for (const key of Object.keys(P.THEMES)) {
  for (const dark of [true, false]) {
    const mode = dark ? 'dark' : 'light';
    const t = P.tokens(P.palette(key, dark, ''));
    const body = Object.entries(t).map(([k, v]) => `    ${k}: ${v};`).join('\n');
    blocks.push(`/* ${P.THEMES[key].name} — ${mode} */\n:root[data-mac-theme="${key}"][data-mac-mode="${mode}"] {\n${body}\n}`);
  }
}
const src = fs.readFileSync(TOKENS, 'utf8');
const EOL = src.includes('\r\n') ? '\r\n' : '\n'; // keep whatever line endings the checkout uses
const generated = `${START}\n${blocks.join('\n\n')}\n${END}`.replace(/\n/g, EOL);
const a = src.indexOf(START);
const b = src.indexOf(END);
if (a === -1 || b === -1) throw new Error(`design-tokens.css is missing the GENERATED markers`);
const next = src.slice(0, a) + generated + src.slice(b + END.length);

if (process.argv.includes('--check')) {
  if (next !== src) {
    console.error('design-tokens.css theme blocks are out of date. Run: node scripts/build-theme-tokens.mjs');
    process.exit(1);
  }
  console.log(`THEME TOKENS IN STEP (${blocks.length} blocks from js/mac-theme-palettes.js).`);
} else {
  fs.writeFileSync(TOKENS, next);
  console.log(`Wrote ${blocks.length} theme blocks into css/design-tokens.css`);
}
