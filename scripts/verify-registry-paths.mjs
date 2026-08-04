#!/usr/bin/env node
/**
 * Verify every asset path named in WebPortal/js/appRouteConfig.json actually exists on disk.
 *
 * Nothing else in this repo checks this: routing:verify proves the database routing guarantee,
 * ui:verify scans CSS/HTML for design violations, verify-phase2-migrations.mjs checks migration
 * filenames. A registry entry naming a file that does not exist fails silently at runtime (a
 * blank panel, a missing modal) — this script is the gate that catches it before merge.
 *
 * Resolution rule (derived from the loader, not guessed — see WebPortal/js/appRouter.js):
 *   - appRouteConfig.json's top-level "basePath" (assigned at WebPortal/js/appRouter.js:891, into
 *     `_appRouter.basePath`) is joined with each route's own "path" to form the route's resource
 *     directory: `${basePath}/${path}` (built at WebPortal/js/appRouter.js:204 as
 *     `resoucePath`).
 *   - The route's "html" value (a single string) is loaded at `${resoucePath}/${html}`
 *     (WebPortal/js/appRouter.js:213, the html-loading call built from `resoucePath` and `html`).
 *   - Each entry in the route's "js" array is loaded at `${resourcePath}/${jsFile}`
 *     (WebPortal/js/appRouter.js:797, `script.src` assignment).
 *   - Each entry in the route's "css" array is loaded at `${resourcePath}/${cssFile}`
 *     (WebPortal/js/appRouter.js:842, `link.href` assignment).
 *   - The registry path itself is './js/appRouteConfig.json' (WebPortal/js/appRouter.js:4),
 *     resolved relative to WebPortal/index.html — so every path above is relative to the
 *     WebPortal/ root on disk, i.e. WebPortal/<basePath>/<route.path>/<asset>.
 *
 * Every route entry in the current registry uses "html" as a bare string and "js"/"css" as
 * arrays of bare strings (each already prefixed "html/", "js/" or "css/" by convention — that
 * prefix is just part of the string, not a separate shape). If a future entry uses some other
 * shape (an object, a nested array, a non-string), that shape cannot be resolved from the loader
 * as written today — such an entry is skipped and reported as unverified rather than guessing a
 * rule for it.
 *
 * Also lists (informational only — never fails the run) files under WebPortal/modules/** that no
 * registry entry names. Three files are loaded directly from WebPortal/index.html's <script src>
 * rather than through the registry and are excluded from that list accordingly; a fourth path,
 * WebPortal/modules/supply-chain-flow/, is a known-unreachable module kept in place pending a
 * product decision and is EXPECTED to appear as unreferenced.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const WEB_PORTAL = join(ROOT, 'WebPortal');
const REGISTRY_PATH = join(WEB_PORTAL, 'js', 'appRouteConfig.json');
const INDEX_HTML_PATH = join(WEB_PORTAL, 'index.html');

// Files loaded straight from WebPortal/index.html's <script src>, never through the route
// registry — real, deliberately not "unreferenced". (See guardrail list in the plan; confirmed
// present in WebPortal/index.html's <script src="modules/...."> lines.)
const KNOWN_NON_REGISTRY_ENTRYPOINTS = new Set([
  'modules/assistant/mac-assistant-api.js',
  'modules/assistant/mac-assistant-shell.js',
  'modules/mascot/mac-mascot.js',
]);

function readIndexHtmlScriptSrcs() {
  const html = readFileSync(INDEX_HTML_PATH, 'utf8');
  const srcs = new Set();
  const re = /<script[^>]+src=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    const src = m[1];
    // Only local, registry-relevant paths (under modules/) matter here; skip absolute URLs and
    // WebPortal/js/*.js entrypoints (those aren't under the modules/ tree this check scans).
    if (src.startsWith('modules/')) {
      srcs.add(src);
    }
  }
  return srcs;
}

function walkFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function run() {
  const registryRaw = readFileSync(REGISTRY_PATH, 'utf8');
  const registry = JSON.parse(registryRaw);
  const basePath = registry.basePath;
  const routes = registry.appRoutes || {};

  const missing = []; // { routeKey, kind, value, resolvedRelPath }
  const unverified = []; // { routeKey, kind, reason }
  const referenced = new Set(); // WebPortal-relative posix paths named by the registry

  let assetCount = 0;

  for (const [routeKey, route] of Object.entries(routes)) {
    const routePath = route.path;
    if (typeof routePath !== 'string') {
      unverified.push({ routeKey, kind: 'path', reason: `route "path" is not a string: ${JSON.stringify(routePath)}` });
      continue;
    }
    const resourceRelDir = `${basePath}/${routePath}`;

    const checkOne = (kind, value) => {
      if (typeof value !== 'string') {
        unverified.push({ routeKey, kind, reason: `"${kind}" entry is not a string: ${JSON.stringify(value)}` });
        return;
      }
      assetCount++;
      const relPath = `${resourceRelDir}/${value}`;
      referenced.add(relPath);
      const absPath = join(WEB_PORTAL, ...relPath.split('/'));
      if (!existsSync(absPath) || !statSync(absPath).isFile()) {
        missing.push({ routeKey, kind, value, relPath });
      }
    };

    // html: single string per the loader's html-loading call (appRouter.js:213).
    if (route.html !== undefined) {
      if (typeof route.html === 'string') {
        checkOne('html', route.html);
      } else {
        unverified.push({ routeKey, kind: 'html', reason: `"html" is not a string: ${JSON.stringify(route.html)}` });
      }
    }

    // js / css: arrays of strings per loadJSCode/loadCSS.
    for (const kind of ['js', 'css']) {
      const list = route[kind];
      if (list === undefined) continue;
      if (!Array.isArray(list)) {
        unverified.push({ routeKey, kind, reason: `"${kind}" is not an array: ${JSON.stringify(list)}` });
        continue;
      }
      for (const value of list) {
        checkOne(kind, value);
      }
    }
  }

  // Unreferenced files under WebPortal/modules/** — informational only.
  const modulesDir = join(WEB_PORTAL, 'modules');
  const allModuleFiles = existsSync(modulesDir) ? walkFiles(modulesDir) : [];
  const indexHtmlSrcs = readIndexHtmlScriptSrcs();

  const unreferenced = [];
  for (const absPath of allModuleFiles) {
    // Normalise to a WebPortal-relative posix path, defensive against a Windows-style host path.
    const posixRel = absPath.slice(WEB_PORTAL.length + 1).split('\\').join('/');
    if (referenced.has(posixRel)) continue;
    if (KNOWN_NON_REGISTRY_ENTRYPOINTS.has(posixRel)) continue;
    if (indexHtmlSrcs.has(posixRel)) continue;
    unreferenced.push(posixRel);
  }
  unreferenced.sort();

  // Report.
  if (unverified.length) {
    console.warn(`\nUNVERIFIED ENTRIES (${unverified.length}) — shape not covered by the loader's resolution rule, skipped:`);
    for (const u of unverified) {
      console.warn(`  ${u.routeKey}: ${u.reason}`);
    }
  }

  if (missing.length) {
    console.error(`\nMISSING REGISTRY-NAMED FILES (${missing.length}):`);
    for (const m of missing) {
      console.error(`  ${m.routeKey}:${m.kind} -> "${m.value}" (resolved: WebPortal/${m.relPath}) — file not found`);
    }
  }

  if (unreferenced.length) {
    console.log(`\nUNREFERENCED FILES (${unreferenced.length}) — present on disk under WebPortal/modules/ but named by no registry entry (informational only, does not fail the run):`);
    for (const f of unreferenced) {
      console.log(`  ${f}`);
    }
  }

  const routeCount = Object.keys(routes).length;
  console.log(
    `\nREGISTRY PATHS ${missing.length ? 'FAILED' : 'OK'} (${routeCount} routes, ${assetCount} assets, ${unreferenced.length} unreferenced).`
  );

  if (missing.length) {
    process.exit(1);
  }
}

run();
