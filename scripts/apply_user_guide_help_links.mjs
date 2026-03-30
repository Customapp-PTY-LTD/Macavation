/**
 * Generate WebPortal/help/index.html and insert Help links (open guide in new tab) in WebPortal modules.
 * Run from repo root: node scripts/apply_user_guide_help_links.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const PORTAL_HELP = path.join(REPO, "WebPortal", "help", "index.html");
const WEBPORTAL_HELP_DIR = path.join(REPO, "WebPortal", "help");
const WEBPORTAL_MODULES = path.join(REPO, "WebPortal", "modules");
const PROCESS_SVG_SRC = path.join(REPO, "docs", "user-guide", "assets", "process-overview.svg");

function readUtf8(file) {
  return fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
}

function writeUtf8(file, text) {
  fs.writeFileSync(file, text, "utf8");
}

const HELP_BTN_TOOLBAR = (anchor) =>
  `<a href="help/index.html#${anchor}" class="btn btn-sm btn-outline-secondary me-2 macavation-help-link" title="User guide"><i class="fas fa-circle-question me-1"></i>Help</a>`;
const HELP_BTN_MODAL = (anchor) =>
  `<a href="help/index.html#${anchor}" class="btn btn-sm btn-outline-secondary ms-auto me-2 macavation-help-link" title="User guide"><i class="fas fa-circle-question me-1"></i>Help</a>`;
const HELP_BTN_LIGHT = (anchor) =>
  `<a href="help/index.html#${anchor}" class="btn btn-sm btn-outline-light ms-auto me-2 macavation-help-link" title="User guide"><i class="fas fa-circle-question me-1"></i>Help</a>`;

function walkDir(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walkDir(p, acc);
    else acc.push(p);
  }
  return acc;
}

function modalAnchor(stem) {
  if (stem.startsWith("modal_")) return "modal-" + stem.slice(6).replaceAll("_", "-");
  return stem.replaceAll("_", "-");
}

function gridAnchor(stem) {
  return stem.replaceAll("_", "-");
}

function humanTitle(aid) {
  return aid
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function patchModal(file) {
  let text = readUtf8(file);
  if (text.includes("help/index.html")) return { ok: true, skipped: true };
  const anchor = modalAnchor(path.basename(file, ".html"));
  const useLight = text.includes("btn-close-white");
  const link = useLight ? HELP_BTN_LIGHT(anchor) : HELP_BTN_MODAL(anchor);
  const re = /(<h5 class="modal-title"[^>]*>[\s\S]*?<\/h5>)(\s*)(<button[^>]*class="btn-close)/;
  if (!re.test(text)) return { ok: false };
  const newText = text.replace(re, (_, h5, ws, btn) => `${h5}${ws}${link}${ws}${btn}`);
  writeUtf8(file, newText);
  return { ok: true, skipped: false };
}

function prependFirstToolbar(text, linkLine) {
  const m = text.match(/(<div class="btn-toolbar[^"]*"[^>]*>\s*)/);
  if (!m) return null;
  const i = m.index + m[1].length;
  return text.slice(0, i) + linkLine + text.slice(i);
}

function patchDashboardUnified(file) {
  let text = readUtf8(file);
  if (text.includes("help/index.html#dashboard-overview")) return { ok: true, skipped: true };
  const old1 = `            <h1 class="h2 mb-0">Dashboard Overview</h1>
        </div>`;
  const new1 = `            <h1 class="h2 mb-0">Dashboard Overview</h1>
            <div class="btn-toolbar mb-2 mb-md-0">
                ${HELP_BTN_TOOLBAR("dashboard-overview")}
            </div>
        </div>`;
  if (!text.includes(old1)) return { ok: false };
  text = text.replace(old1, new1);
  text = text.replace(
    `            <div class="btn-toolbar mb-2 mb-md-0">
                <button type="button" class="btn btn-secondary" id="refreshBtn">`,
    `            <div class="btn-toolbar mb-2 mb-md-0">
                ${HELP_BTN_TOOLBAR("material-journey-dashboard")}
                <button type="button" class="btn btn-secondary" id="refreshBtn">`
  );
  text = text.replace(
    `            <div class="btn-toolbar mb-2 mb-md-0">
                <button type="button" class="btn btn-outline-secondary me-2" id="customizeDashboardBtn" `,
    `            <div class="btn-toolbar mb-2 mb-md-0">
                ${HELP_BTN_TOOLBAR("executive-dashboard")}
                <button type="button" class="btn btn-outline-secondary me-2" id="customizeDashboardBtn" `
  );
  writeUtf8(file, text);
  return { ok: true, skipped: false };
}

function patchRoleGridsUnified(file) {
  let text = readUtf8(file);
  if (text.includes("help/index.html#roles-grid")) return { ok: true, skipped: true };
  const r1 = [
    `            <div class="btn-toolbar mb-2 mb-md-0 ms-auto">
                <button type="button" class="btn btn-outline-secondary" id="rolesExportBtn">`,
    `            <div class="btn-toolbar mb-2 mb-md-0 ms-auto">
                ${HELP_BTN_TOOLBAR("roles-grid")}
                <button type="button" class="btn btn-outline-secondary" id="rolesExportBtn">`,
  ];
  const r2 = [
    `            <div class="btn-toolbar mb-2 mb-md-0 ms-auto">
                <button type="button" class="btn btn-outline-secondary" id="exportPermissionsBtn">`,
    `            <div class="btn-toolbar mb-2 mb-md-0 ms-auto">
                ${HELP_BTN_TOOLBAR("role-permissions-grid")}
                <button type="button" class="btn btn-outline-secondary" id="exportPermissionsBtn">`,
  ];
  const r3refreshOnly = [
    `            <div class="btn-toolbar mb-2 mb-md-0 ms-auto">
                <button type="button" class="btn btn-outline-secondary" id="refreshFeaturesBtn">`,
    `            <div class="btn-toolbar mb-2 mb-md-0 ms-auto">
                ${HELP_BTN_TOOLBAR("role-features-grid")}
                <button type="button" class="btn btn-outline-secondary" id="refreshFeaturesBtn">`,
  ];
  const r3exportFirst = [
    `            <div class="btn-toolbar mb-2 mb-md-0 ms-auto">
                <button type="button" class="btn btn-outline-secondary" id="exportFeaturesBtn"><i class="fas fa-download me-1"></i>Export</button>
                <button type="button" class="btn btn-outline-secondary" id="refreshFeaturesBtn">`,
    `            <div class="btn-toolbar mb-2 mb-md-0 ms-auto">
                ${HELP_BTN_TOOLBAR("role-features-grid")}
                <button type="button" class="btn btn-outline-secondary" id="exportFeaturesBtn"><i class="fas fa-download me-1"></i>Export</button>
                <button type="button" class="btn btn-outline-secondary" id="refreshFeaturesBtn">`,
  ];
  if (!text.includes(r1[0]) || !text.includes(r2[0])) return { ok: false };
  text = text.replace(r1[0], r1[1]).replace(r2[0], r2[1]);
  if (text.includes(r3refreshOnly[0])) text = text.replace(r3refreshOnly[0], r3refreshOnly[1]);
  else if (text.includes(r3exportFirst[0])) text = text.replace(r3exportFirst[0], r3exportFirst[1]);
  else return { ok: false };
  writeUtf8(file, text);
  return { ok: true, skipped: false };
}

function patchSupplyChain(file) {
  let text = readUtf8(file);
  if (text.includes("help/index.html")) return { ok: true, skipped: true };
  const old = `        <div class="btn-toolbar mb-2 mb-md-0">
            <a href="#" route="grower-intake-grid" `;
  const neu = `        <div class="btn-toolbar mb-2 mb-md-0">
            ${HELP_BTN_TOOLBAR("supply-chain-flow")}
            <a href="#" route="grower-intake-grid" `;
  if (!text.includes(old)) return { ok: false };
  writeUtf8(file, text.replace(old, neu));
  return { ok: true, skipped: false };
}

function patchDispatch(file, anchor) {
  let text = readUtf8(file);
  if (text.includes("help/index.html")) return { ok: true, skipped: true };
  const old = `        <div class="d-flex align-items-center gap-2">
            <div class="view-toggle">`;
  const neu = `        <div class="d-flex align-items-center gap-2">
            ${HELP_BTN_TOOLBAR(anchor)}
            <div class="view-toggle">`;
  if (!text.includes(old)) return { ok: false };
  writeUtf8(file, text.replace(old, neu));
  return { ok: true, skipped: false };
}

function patchMyDay(file) {
  let text = readUtf8(file);
  if (text.includes("help/index.html")) return { ok: true, skipped: true };
  const old = `<div class="my-day-container">
    <div id="my-day-container">`;
  const neu = `<div class="my-day-container">
    <div class="d-flex justify-content-end px-3 pt-3 pb-0">
        ${HELP_BTN_TOOLBAR("my-day")}
    </div>
    <div id="my-day-container">`;
  if (!text.includes(old)) return { ok: false };
  writeUtf8(file, text.replace(old, neu));
  return { ok: true, skipped: false };
}

function patchBatchJourney(file) {
  let text = readUtf8(file);
  if (text.includes("help/index.html")) return { ok: true, skipped: true };
  const old = `    <div class="d-flex justify-content-between align-items-center mb-3">
        <h1 class="h3 mb-0">Batch Journey</h1>
    </div>`;
  const neu = `    <div class="d-flex justify-content-between align-items-center mb-3">
        <h1 class="h3 mb-0">Batch Journey</h1>
        <div class="btn-toolbar mb-0">
            ${HELP_BTN_TOOLBAR("batch-journey-grid")}
        </div>
    </div>`;
  if (!text.includes(old)) return { ok: false };
  writeUtf8(file, text.replace(old, neu));
  return { ok: true, skipped: false };
}

function patchDataImport(file) {
  let text = readUtf8(file);
  if (text.includes("help/index.html")) return { ok: true, skipped: true };
  const old = `        <div>
            <button class="btn btn-outline-secondary btn-sm" id="downloadTemplateBtn">`;
  const neu = `        <div class="btn-toolbar mb-0">
            ${HELP_BTN_TOOLBAR("data-import-grid")}
            <button class="btn btn-outline-secondary btn-sm" id="downloadTemplateBtn">`;
  if (!text.includes(old)) return { ok: false };
  writeUtf8(file, text.replace(old, neu));
  return { ok: true, skipped: false };
}

function patchGenericGrid(file) {
  let text = readUtf8(file);
  if (text.includes("help/index.html")) return { ok: true, skipped: true };
  const stem = path.basename(file, ".html");
  const anchor = gridAnchor(stem);
  const linkLine = HELP_BTN_TOOLBAR(anchor) + "\n            ";
  const neu = prependFirstToolbar(text, linkLine);
  if (!neu) return { ok: false };
  writeUtf8(file, neu);
  return { ok: true, skipped: false };
}

/** Richer copy for selected anchors (HTML allowed). */
const SECTION_BLURBS = {
  "dashboard-overview":
    "Default operations dashboard: kernel production stats, packing, and task lists. Use the sidebar to open other modules.",
  "material-journey-dashboard":
    "Tracks material movement and alerts for integrator-style roles. Use <strong>Refresh</strong> to reload cards.",
  "executive-dashboard":
    "KPIs and reporting for leadership. Use <strong>Customize</strong> to choose visible widgets and <strong>Generate Report</strong> for PDF output.",
  "my-day":
    "Role-based landing view: your assigned workflows and shortcuts. Content loads after sign-in.",
  "crm-nis-suppliers":
    "<strong>NIS suppliers</strong> — numbered grower/supplier list used with kernel intake and reporting. Import from Excel or add contacts; used across grower intake and dispatch.",
  "crm-oil-processors":
    "<strong>Oil processors</strong> — organisations classified as oil processors. Filter the grid, export, and add or edit contacts for the oil stream.",
  "crm-oil-ingredient-suppliers":
    "<strong>Oil ingredient suppliers</strong> — raw material and ingredient suppliers for oil &amp; protein operations. Same tools as other CRM tabs: filters, import, add contact.",
  "crm-oil-protein-customers":
    "<strong>Oil &amp; protein customers</strong> — buyers for oil/protein products. Maintain names, contacts, and status for sales and dispatch.",
  "crm-kernel-customers":
    "<strong>Kernel customers</strong> — kernel-side customers. Use filters and <strong>Add Contact</strong> to keep the list current for kernel dispatch and CRM.",
  "grower-intake-grid":
    "Kernel-side intake: receiving checklists, batch testing, and creating kernel batches before production.",
  "supplier-intake-grid":
    "Oil &amp; protein intake: supplier oil batches and receiver checklists tied to CRM suppliers.",
  "kernel-production-grid":
    "Production workflow: job cards, production stages, batch summaries, and QA hand-offs.",
  "oil-production-grid":
    "Oil production sheets and related processing steps for the oil/protein stream.",
  "stock-management-grid":
    "Warehouse views for kernel and oil/protein stock; filters, export, send to dispatch, and oil lot management.",
  "kernel-dispatch-grid":
    "Kernel finished goods: board/table views, dispatch basket, and inspection forms before despatch.",
  "oil-dispatch-grid":
    "Oil &amp; protein dispatch: mirror of kernel dispatch for the finished oil/protein warehouse location.",
  "quality-assurance-grid":
    "Quality tests, thresholds, and food-safety related records.",
  "batch-journey-grid":
    "Cross-batch search and status across intake, production, QA, and dispatch.",
  "document-management-grid":
    "Store and organise operational documents linked to the business.",
  "palladium-integration-grid":
    "ERP integration settings and sync status with Palladium.",
  "sales-forecasting-grid":
    "Demand and forecasting inputs for planning.",
  "financial-management-grid":
    "Financial views and calculations supporting operations (where enabled).",
  "users-grid": "Create and maintain portal users, passwords, and assignments.",
  "roles-grid": "Define named roles used for menu and permission assignment.",
  "role-permissions-grid": "Map roles to database permissions (functions, tables).",
  "role-features-grid": "Toggle feature flags per role for progressive rollout.",
  "features-grid": "Catalogue of application features for assignment to roles.",
  "admin-users-permissions":
    "<strong>Users &amp; permissions</strong> — system users table, role filter, and add user. Summary cards above show counts for the whole admin module.",
  "admin-roles-management":
    "<strong>Roles management</strong> — define and maintain roles used for menu and permission assignment.",
  "admin-system-configuration":
    "<strong>System configuration</strong> — environment and system settings (as exposed for your deployment).",
  "data-import-grid": "Upload Excel templates into selected tables (contacts, stock, oil sheets, etc.).",
  "test-scenarios-grid": "QA automation scenarios (test environments).",
  "test-data-sets":
    "<strong>Data sets</strong> — create and manage synthetic data sets for test scenarios. Use filters, search, and export.",
  "test-data-records":
    "<strong>Records</strong> — individual test data records within sets. Add records after selecting or creating a data set.",
  "supply-chain-flow":
    "Read-only process diagram and quick links into Grower Intake, Stock, and Oil Production. (Not all deployments expose this as a route.)",
};

/** Practical “how to work here” (plain text). Modals omit this (lead already covers behaviour). */
const GENERIC_GRID_HOW =
  "Typical use: open the screen from the menu when your role allows it, narrow the list with filters, then use toolbar buttons or row actions to add, edit, export, or move work forward. The screenshot shows the usual layout.";

const SECTION_HOW_IT_WORKS = {
  "dashboard-overview":
    "Use cards and lists as a daily snapshot; follow links or the sidebar to open the full grids behind each metric. Refresh the page if numbers look stale.",
  "material-journey-dashboard":
    "Reload with Refresh, then open linked modules from each card to clear alerts or continue a batch. Suited to roles watching movement across sites or stages.",
  "executive-dashboard":
    "Choose widgets with Customize, export PDFs with Generate Report, and treat figures as summaries—drill into Kernel / Oil &amp; protein modules for detail.",
  "my-day":
    "Work the list top-down: each item should route you to the right module. Completing work there updates what others see on dashboards and queues.",
  "crm-nis-suppliers":
    "Keep the numbered list aligned with operations: import from Excel when bulk-updating, or Add Contact for one-offs. These names appear in grower intake and kernel reporting.",
  "crm-oil-processors":
    "Maintain processor details for the oil stream; filters and export help audits. Edits apply wherever that contact is picked (intake, production, dispatch).",
  "crm-oil-ingredient-suppliers":
    "Used for raw-material suppliers feeding oil &amp; protein. After changes, notify planners so stock and intake expectations stay aligned.",
  "crm-oil-protein-customers":
    "Keep commercial contacts current for sales and dispatch paperwork. Status and emails should match what dispatch and account teams use offline.",
  "crm-kernel-customers":
    "Supports kernel sales and dispatch: accurate delivery contacts reduce errors on despatch documents.",
  "grower-intake-grid":
    "Work delivery-by-delivery: complete receiving checklists, capture samples if required, then create or link kernel batches so production can start.",
  "supplier-intake-grid":
    "Register supplier oil batches and receiver checklists; they must tie to CRM suppliers. Downstream stock and production consume these records.",
  "kernel-production-grid":
    "Drive job cards through stages; use board or list views as your site prefers. QA and stock hand-offs depend on accurate stage completion.",
  "oil-production-grid":
    "Record production sheets and relate them to lots or batches as the UI prompts. This closes the loop between intake stock and finished oil/protein.",
  "stock-management-grid":
    "Confirm location and product filters before transactions. Send-to-dispatch and oil-lot actions should only run when physical stock matches the system.",
  "kernel-dispatch-grid":
    "Build the dispatch basket from approved stock, complete inspections, then finalise documents. Fixes to stock usually happen in Stock Management, not here.",
  "oil-dispatch-grid":
    "Same pattern as kernel dispatch for the oil/protein warehouse: basket, checks, then shipment. Ensure oil lots are released before loading.",
  "quality-assurance-grid":
    "Log tests against the referenced batch or item; failed or out-of-spec results may block the next step depending on configuration—follow local QA rules.",
  "batch-journey-grid":
    "Search by batch or filters, open a row’s detail, then jump to owning module for the next action. Ideal when you know the batch ID but not where it sits.",
  "document-management-grid":
    "Upload with clear titles and categories; link to entities when offered so colleagues find files from batches or contacts later.",
  "palladium-integration-grid":
    "Check sync health and mapping; day-to-day posting still happens from operational modules according to your integration design.",
  "sales-forecasting-grid":
    "Maintain forecast versions planners compare to production capacity and stock. Coordinate with finance or supply if numbers feed external systems.",
  "financial-management-grid":
    "Use for enabled financial snapshots; always reconcile with your authoritative ledger—this view supports operations, not statutory reporting.",
  "users-grid":
    "Create users with correct roles from the start; password resets and deactivation are safer than sharing accounts. Changes apply on next login.",
  "roles-grid":
    "Name roles clearly for admins; after saving, assign permissions and features in their dedicated screens.",
  "role-permissions-grid":
    "Grant least privilege: add permissions incrementally and test with a non-admin login before rolling out broadly.",
  "role-features-grid":
    "Toggle features per role for phased rollouts; document what each flag unlocks so support can answer user questions.",
  "features-grid":
    "Treat as the catalogue of toggles—actual access still requires role assignment and menu configuration.",
  "admin-users-permissions":
    "Start from summary cards, then filter the users grid. Add User follows the same validation as other admin entry points.",
  "admin-roles-management":
    "Edit roles here; deep permission matrices may live in User Management modules depending on deployment.",
  "admin-system-configuration":
    "Record values before changing system settings; some options need vendor support to roll back safely.",
  "data-import-grid":
    "Download the right template, fill without altering column headers, upload, and read the import log. Fix the spreadsheet rather than re-importing the same errors.",
  "test-scenarios-grid":
    "For non-production environments: scenarios wrap automated tests—keep naming consistent with CI or Playwright jobs.",
  "test-data-sets":
    "Define a set per scenario or feature area, then seed records. Export sets to share fixtures across testers.",
  "test-data-records":
    "Add records after choosing a parent set; bulk tools (if shown) should stay within test data only.",
  "supply-chain-flow":
    "Use this page to orient new users: follow <strong>Open</strong> links into live modules. This screen does not edit operational data — use intake, production, stock, and dispatch modules for that.",
};

function blurbFor(id, title) {
  let leadBlock;
  if (SECTION_BLURBS[id]) {
    leadBlock = `<p class="guide-lead">${SECTION_BLURBS[id]}</p>`;
  } else if (id.startsWith("modal-")) {
    leadBlock = `<p class="guide-lead">Dialog opened from the related module. Complete required fields (marked), then save. Use <strong>Cancel</strong> or the close button to dismiss without saving.</p>`;
  } else {
    leadBlock = `<p class="guide-lead">Module <strong>${title}</strong>. Available from the navigation menu when your role includes access. The screenshot below shows the live screen layout.</p>`;
  }
  if (id.startsWith("modal-")) return leadBlock;
  const howText = SECTION_HOW_IT_WORKS[id] || GENERIC_GRID_HOW;
  return `${leadBlock}
    <p class="guide-how">${howText}</p>`;
}

/** Tab-specific help topics may reuse the parent module screenshot file. */
const HELP_SCREENSHOT_ALIAS = {
  "crm-nis-suppliers": "crm-grid",
  "crm-oil-processors": "crm-grid",
  "crm-oil-ingredient-suppliers": "crm-grid",
  "crm-oil-protein-customers": "crm-grid",
  "crm-kernel-customers": "crm-grid",
  "test-data-sets": "test-data-grid",
  "test-data-records": "test-data-grid",
  "admin-users-permissions": "admin-grid",
  "admin-roles-management": "admin-grid",
  "admin-system-configuration": "admin-grid",
};

function shotFigure(id) {
  const shotId = HELP_SCREENSHOT_ALIAS[id] || id;
  return `    <figure class="guide-shot">
      <img src="./assets/screenshots/${shotId}.png" width="1200" height="675" alt="Screen capture of this module" loading="lazy" />
    </figure>`;
}

/** Numbered steps for operational topics (replaces former SVG “where this fits” map). */
const PAGE_STEPS = {
  "dashboard-overview": [
    "Open <strong>Dashboard overview</strong> from the sidebar, or land here by default after sign-in if your site is configured that way.",
    "Read the summary cards (users, roles, production, packing, tasks—depending on what your build shows) for a snapshot of the day.",
    "Click any card or embedded link that opens a drill-down grid or module; use the sidebar for everything else.",
    "If figures look stale compared to the shop floor, refresh the browser page once before raising a support issue.",
  ],
  "material-journey-dashboard": [
    "Open <strong>Material journey</strong> from the menu (typically used by integrator-style roles watching movement and risk).",
    "Click <strong>Refresh</strong> to reload cards and alerts so you are not acting on cached data.",
    "Scan each card for status, exceptions, or batches needing attention.",
    "Use links or actions on a card to jump into the owning module (intake, production, stock, dispatch) and complete the work there.",
  ],
  "executive-dashboard": [
    "Open <strong>Executive dashboard</strong> from the menu.",
    "Click <strong>Customize</strong> (or equivalent) to choose which KPI widgets and charts appear.",
    "Use <strong>Generate report</strong> or export controls when you need a PDF or file for meetings.",
    "Treat numbers as summaries—open Kernel or Oil &amp; protein modules for line-level detail when something needs investigation.",
  ],
  "my-day": [
    "Open <strong>My Day</strong> after sign-in (or from the sidebar) to see tasks and shortcuts assigned to your role.",
    "Work items in priority order, or pick the highest-impact line first if your team agrees that rule.",
    "Click each task or shortcut; the app should route you to the module that owns that step.",
    "Completing work in those modules updates dashboards and queues for everyone else.",
  ],
  "grower-intake-grid": [
    "Open <strong>Grower intake</strong> from the sidebar.",
    "Use <strong>Search</strong>, <strong>Status</strong>, and <strong>Clear</strong> to find the batch; switch <strong>Board</strong> vs <strong>Table</strong> to match how you like to work.",
    "For each delivery: complete the <strong>Receiving checklist</strong> (Stage 1) from the batch card or row actions—both batch test and batch sample unlock only after the checklist is done.",
    "Use <strong>Create kernel batch</strong> when you need a new intake record; use <strong>Export</strong> for a spreadsheet snapshot when auditing.",
    "When quality steps are satisfied, use <strong>Release to production</strong> (and silo selection if prompted) so Kernel Production can receive the batch.",
  ],
  "supplier-intake-grid": [
    "Open <strong>Supplier intake</strong> from the menu.",
    "Use search, status filter, and <strong>Clear</strong>; choose <strong>Board</strong>, <strong>Table</strong>, <strong>Weekly</strong>, or <strong>Overview</strong> from the view toggle.",
    "Start new oil-side deliveries with <strong>Receiver checklist</strong>; that creates the batch you will track through sample tests.",
    "Complete sample tests from the card/table when the UI enables them; status moves toward ready for oil production.",
    "Use <strong>Export</strong> when you need to share the current intake list outside the app.",
  ],
  "kernel-production-grid": [
    "Open <strong>Kernel production</strong> from the menu.",
    "Review the <strong>Silos</strong> panel: click an occupied (red) silo to mark empty, or an empty (white) silo to mark full and pick a production batch from the list modal.",
    "Search and filter batches; use <strong>Clear</strong> to reset. Toggle <strong>Board</strong>, <strong>Table</strong>, or <strong>Approved jobcards</strong> as needed.",
    "Open a batch card or row to manage job cards, production stages, and QA hand-offs—complete stages in order so stock and release status stay truthful.",
    "Use <strong>Export</strong> for reporting; when release-ready, follow the in-app actions to send finished product toward stock and dispatch per your process.",
  ],
  "oil-production-grid": [
    "Open <strong>Oil production</strong> from the menu.",
    "Review <strong>Raw ingredients in production</strong> (batches released from Supplier Intake); open a batch to run extraction steps or mark a bag <strong>Empty</strong> when the press run is finished.",
    "Expand <strong>Finished (emptied) raw batches</strong> if you need to audit what already left the active list.",
    "Open or create a <strong>Production sheet</strong> (Food Grade Oil / Protein Powder / Cosmetic Oil) from the UI—choose form entry vs file upload if both are offered.",
    "Use <strong>View data</strong> and <strong>Refresh</strong> on the toolbar for analytics and to reload lists after others have changed data.",
  ],
  "stock-management-grid": [
    "Open <strong>Stock management</strong>; note whether you are on the <strong>Kernel</strong> or <strong>Oil &amp; protein</strong> stream (subtitle and filters adapt).",
    "For the main stock table: use <strong>Search</strong>, <strong>Status</strong>, <strong>Product type</strong>, and <strong>Location</strong> (warehouse section); click <strong>Clear</strong> to reset.",
    "On <strong>Kernel batch journey</strong>: use <strong>By style</strong> / <strong>Weekly</strong> / <strong>Overview</strong>; select lines and use <strong>Send to Dispatch</strong> only when physical stock matches the system.",
    "For oil: add or import oil lots (e.g. from Excel) and monitor days-remaining from best-before where shown; use export when you need a file copy.",
    "Use <strong>Import historical</strong> only for the controlled kernel historical load your admin approved—never as a substitute for normal intake and production postings.",
  ],
  "kernel-dispatch-grid": [
    "Open <strong>Kernel dispatch</strong>; use <strong>Board</strong> vs <strong>Table</strong> and <strong>Refresh</strong> to align with how your despatch team works.",
    "Remember the flow: inventory from finished warehouse <strong>KERNEL R YES</strong> moves to <strong>Kernel customers</strong> and debtors—baskets are built from stock sends.",
    "In table view, open <strong>View basket</strong> to check styles and quantities before loading; use <strong>Dispatch</strong> to complete inspection and dispatch forms.",
    "Review the <strong>Baskets marked as dispatched</strong> section for completed paperwork and proof of shipment.",
    "If quantities are wrong, fix stock or the basket in <strong>Stock management</strong> rather than forcing a dispatch through.",
  ],
  "oil-dispatch-grid": [
    "Open <strong>Oil &amp; protein dispatch</strong> from the menu (mirror of kernel dispatch for the finished oil/protein warehouse).",
    "Use the same board/table pattern and refresh habit as kernel dispatch.",
    "Build or review baskets from released oil lots; complete inspection and dispatch forms before the truck leaves.",
    "Ensure oil lots are released and available in stock before you add them to a load.",
  ],
  "batch-journey-grid": [
    "Open <strong>Batch journey</strong> when you know a batch id or grower but not which module currently owns the work.",
    "Type in the search field (batch, grower, etc.); set <strong>Status</strong> and <strong>Sort</strong> (newest, by status, by grower, weight, moisture) to shorten the list.",
    "Read the <strong>Status</strong> column for Intake, Receiving, Production, QA, Dispatch, or Complete.",
    "Click the <strong>batch number</strong> link to open detail or the next workflow screen.",
    "Use row actions or links from detail to jump straight into intake, production, QA, or dispatch—complete the action there, then return to Batch journey if you need another batch.",
  ],
  "quality-assurance-grid": [
    "Open <strong>Quality assurance</strong> from the menu.",
    "Use <strong>Search</strong>, <strong>Test type</strong>, <strong>Result</strong>, and <strong>Clear</strong> to find the right record.",
    "Click <strong>New quality test</strong> to log a new sample, batch, or final-product test as your process requires.",
    "Open a row to enter results, attachments, or sign-off; failed or conditional results may block release depending on configuration—follow your local QA playbook.",
    "Use <strong>Export</strong> when auditors or customers need evidence outside the app.",
  ],
  "supply-chain-flow": [
    "Open <strong>Supply chain &amp; process flow</strong> when you need the big picture (Mermaid diagram: intake → warehouse raws → production → finished → customers / debtors).",
    "Read the document-type hints (<strong>GRV</strong>, <strong>IBT</strong>, <strong>INV</strong>) so paperwork in dispatch matches what finance expects.",
    "Use the toolbar shortcuts to jump to <strong>Grower intake</strong>, <strong>Stock</strong>, or <strong>Oil production</strong> in one click.",
    "This page is read-only for orientation—create and edit batches only inside the operational modules.",
  ],
  "crm-nis-suppliers": [
    "Open <strong>CRM</strong> — Contact Database Management from the menu.",
    "Click the <strong>NIS Suppliers</strong> tab so the grid shows the numbered grower / supplier list.",
    "Expand <strong>Filters</strong> when you need to narrow by province, status, or other fields on that tab.",
    "Use <strong>Add Contact</strong> for a single record, or <strong>Import from Excel</strong> for bulk updates — keep the template column headers unchanged.",
    "Open a row to edit; saved details are used in grower intake, kernel reporting, and kernel dispatch wherever that supplier appears.",
  ],
  "crm-oil-processors": [
    "Open <strong>CRM</strong> — Contact Database Management from the menu.",
    "Click the <strong>Oil Processors</strong> tab.",
    "Expand <strong>Filters</strong> to narrow the list before you add or edit records.",
    "Use <strong>Add Contact</strong> or <strong>Import from Excel</strong> as appropriate; do not alter import template headers.",
    "Open a row to edit processor details; changes apply anywhere oil processors are selected in the oil &amp; protein stream.",
  ],
  "crm-oil-ingredient-suppliers": [
    "Open <strong>CRM</strong> — Contact Database Management from the menu.",
    "Click the <strong>Oil Ingredient Suppliers</strong> tab.",
    "Expand <strong>Filters</strong> to find raw-material or ingredient suppliers quickly.",
    "Use <strong>Add Contact</strong> or <strong>Import from Excel</strong> to maintain the list.",
    "Edit a row to update supplier data used by oil &amp; protein intake, stock, and production screens that reference these contacts.",
  ],
  "crm-oil-protein-customers": [
    "Open <strong>CRM</strong> — Contact Database Management from the menu.",
    "Click the <strong>Oil &amp; Protein Customers</strong> tab.",
    "Expand <strong>Filters</strong> to narrow buyers or commercial contacts.",
    "Use <strong>Add Contact</strong> or <strong>Import from Excel</strong> to add or refresh customer records.",
    "Open a row to edit; accurate names and contacts reduce errors on oil &amp; protein sales and dispatch paperwork.",
  ],
  "crm-kernel-customers": [
    "Open <strong>CRM</strong> — Contact Database Management from the menu.",
    "Click the <strong>Kernel Customers</strong> tab.",
    "Expand <strong>Filters</strong> to locate a customer before editing.",
    "Use <strong>Add Contact</strong> or <strong>Import from Excel</strong> to keep delivery and commercial details current.",
    "Edit from the grid as needed; updates feed through to kernel dispatch and CRM views that use these customers.",
  ],
  "admin-users-permissions": [
    "Open <strong>Admin</strong> from the menu.",
    "Stay on the <strong>Users &amp; Permissions</strong> tab (first tab).",
    "Read the summary cards (totals for users, roles, permissions, sessions) for a quick health check.",
    "Use the users grid filters and search; click <strong>Add User</strong> to open the add-user dialog with the right role from the start.",
    "Use row actions to edit or deactivate users; changes typically apply on next login.",
  ],
  "admin-roles-management": [
    "Open <strong>Admin</strong> → <strong>Roles management</strong> tab.",
    "Review existing roles in the grid; use search, status filter, and <strong>Clear</strong> as needed.",
    "Click <strong>Add Role</strong> on the toolbar (or the equivalent in your build) to define a new role name and description.",
    "After saving roles, assign <strong>Role permissions</strong> and <strong>Role features</strong> in User Management so menus match responsibility.",
  ],
  "admin-system-configuration": [
    "Open <strong>Admin</strong> → <strong>System configuration</strong> tab.",
    "Record current values (screenshot or export) before changing environment or integration settings.",
    "Edit only fields you understand; some options may require vendor support to reverse.",
    "Save and verify behaviour in a non-critical module before announcing the change to all users.",
  ],
  "data-import-grid": [
    "Open <strong>Data import (Excel)</strong> from the menu.",
    "Click <strong>Download template</strong> when you need the correct column layout for your target table.",
    "Choose the Excel file, pick the <strong>target table</strong> (contacts, stock_items, oil_production_sheets, etc.), then click <strong>Preview</strong>.",
    "In <strong>Map columns</strong>, match each spreadsheet column to the database field; fix the file if a column cannot map cleanly.",
    "Review the preview row count, then click <strong>Import</strong>; read any log or error output and correct the sheet rather than re-uploading the same mistakes.",
  ],
  "document-management-grid": [
    "Open <strong>Document management</strong> from the menu.",
    "Maintain <strong>Categories</strong> first if your process needs new filing buckets—deleting a category hides it from pickers but keeps existing file links.",
    "Click <strong>Upload document</strong>, pick a file, set title/category, and link to an entity if the form offers it.",
    "Use the search box to find documents by name or category; clear the search to see the full list.",
    "Use row actions to download, replace metadata, or remove files according to your retention rules.",
  ],
  "features-grid": [
    "Open <strong>Features</strong> from User Management (or your menu path).",
    "Search by name, key, or description; filter by active/inactive; click <strong>Clear</strong> to reset.",
    "Use <strong>Add feature</strong> to register a new application feature key for role assignment.",
    "Use <strong>Refresh</strong> and <strong>Export</strong> when auditing which flags exist before a rollout.",
    "Actual user access still requires that feature to be turned on for a role in <strong>Role features</strong>.",
  ],
  "financial-management-grid": [
    "Open <strong>Financial management</strong> when your deployment enables it.",
    "Click <strong>New invoice</strong> or <strong>Record payment</strong> from the toolbar to add transactions.",
    "Review the grid columns (document number, type, contact, amount, date, status) before posting.",
    "Use row <strong>Actions</strong> to open, edit, or void per your business rules.",
    "Use <strong>Export</strong> for finance hand-off; reconcile against your ledger—this screen supports operations, not statutory reporting on its own.",
  ],
  "palladium-integration-grid": [
    "Open <strong>Palladium ERP integration</strong> from the menu.",
    "Review the <strong>Sync status</strong> table: entity type, last sync, status, records synced.",
    "Click <strong>Sync now</strong> only when your runbook allows (avoid double-runs during month-end unless approved).",
    "Use row actions to inspect errors or retry failed entities as the UI permits.",
    "Day-to-day operational posting still happens in Macavation modules; this screen is health and mapping for ERP bridge.",
  ],
  "sales-forecasting-grid": [
    "Open <strong>Sales forecasting</strong> from the menu.",
    "Click <strong>New forecast</strong> to add a period, product type, quantity, confidence, and status.",
    "Review existing rows in the table; use actions to revise or close versions planners no longer use.",
    "Click <strong>Export</strong> when supply or finance needs the numbers in Excel.",
    "Align forecast versions with production capacity meetings—do not treat this as the only source of truth if finance maintains a master file.",
  ],
  "roles-grid": [
    "Open <strong>Roles</strong> from User Management.",
    "Search and filter by active/inactive; click <strong>Clear</strong> to reset the grid.",
    "Click <strong>Add role</strong> for a new named role, or open a row to edit description and status.",
    "Use <strong>Refresh</strong> after others change data; <strong>Export</strong> before audits.",
    "Pair each role with entries in <strong>Role permissions</strong> and <strong>Role features</strong> so menus and APIs stay aligned.",
  ],
  "role-permissions-grid": [
    "Open <strong>Role permissions</strong> from User Management.",
    "Filter by role, object type (function/table), and operation (EXECUTE, Read, Create, Update, Delete); use <strong>Clear</strong> when needed.",
    "Click <strong>Add permission</strong> to grant a role access to a specific object—add the minimum set first.",
    "Use <strong>Refresh</strong> and <strong>Export</strong> when documenting access reviews.",
    "Test with a non-admin login after changes; verify the user can do their job but cannot see restricted modules.",
  ],
  "role-features-grid": [
    "Open <strong>Role features</strong> from User Management.",
    "Locate the role and feature combination; toggle flags for phased rollouts of new UI or APIs.",
    "Use export/refresh controls like other admin grids.",
    "Document what each feature flag unlocks so support can answer “why don’t I see X?”.",
    "Remember: users must still have the underlying role assignment and menu access—features are not a substitute for permissions.",
  ],
  "test-data-sets": [
    "Open <strong>Test data management</strong> (non-production / QA environments).",
    "Select the <strong>Data sets</strong> tab; expand <strong>Filters</strong> (module, entity type, purpose) and click <strong>Apply filters</strong> / <strong>Clear</strong> as needed.",
    "Click <strong>Add data set</strong>; name it for the scenario or feature you are testing.",
    "Open a set from the grid to review or edit metadata; export sets to share fixtures with other testers.",
    "Never use test data tools on production databases.",
  ],
  "test-data-records": [
    "Open <strong>Test data management</strong> → <strong>Records</strong> tab.",
    "Select or create a parent <strong>data set</strong> first—the add-record button is enabled in context.",
    "Click <strong>Add record</strong> and fill entity fields that mirror production shape but with synthetic values.",
    "Use filters to find records; bulk actions (if shown) must stay within test data tables only.",
    "Export or duplicate sets when multiple testers need the same baseline.",
  ],
  "test-scenarios-grid": [
    "Open <strong>Test scenarios</strong> in QA environments.",
    "Create or edit scenarios that wrap automated tests; keep names aligned with CI or Playwright job names.",
    "Link scenarios to data sets where your workflow requires seeded data.",
    "Run or trigger tests only through approved automation paths—do not run destructive scripts against shared environments without notice.",
  ],
  "users-grid": [
    "Open <strong>Users</strong> from User Management.",
    "Search and filter the grid; click <strong>Add user</strong> (or equivalent) for a new login.",
    "Assign the correct <strong>role</strong> immediately; fixing role mistakes later is harder than setting them at creation.",
    "Use password reset flows instead of sharing credentials between people.",
    "Deactivate leavers; permission changes apply on next login in most configurations.",
  ],
  "modal-crm-contact": [
    "Open from CRM: <strong>Add contact</strong> or when editing an existing row.",
    "Pick or confirm the contact type tab context (NIS supplier, oil customer, etc.) so the record lands in the right list.",
    "Complete identity fields, phones, emails, and addresses as your dispatch and finance teams expect.",
    "Save; the grid refreshes and downstream modules (intake, dispatch) can pick up the contact immediately.",
  ],
  "modal-admin-add-user": [
    "Open from <strong>Admin</strong> → <strong>Add user</strong>.",
    "Enter name, email/username, and temporary password policy per your organisation.",
    "Assign the primary <strong>role</strong> before saving—this controls the menu tree on first login.",
    "Send the user your standard onboarding steps (password change, MFA if enabled).",
  ],
  "modal-admin-add-role": [
    "Open from <strong>Admin</strong> → <strong>Add role</strong>.",
    "Enter a clear role name and description other admins will recognise.",
    "Save, then open <strong>Role permissions</strong> and <strong>Role features</strong> to wire the role to real access.",
  ],
  "modal-grower-receiving-checklist": [
    "Open from a grower intake batch card or row when Stage 1 (receiving) is due.",
    "Work through each checklist line (weights, dockets, quality flags) exactly as operations defined.",
    "Save; the batch card should show the checklist as complete so batch test and sample actions unlock.",
    "If something is wrong with the delivery, record it here and escalate per QA before releasing forward.",
  ],
  "modal-grower-create-kernel-batch": [
    "Open from grower intake via <strong>Create kernel batch</strong>.",
    "Enter grower, delivery metadata, and wet NIS details as prompted—tie to CRM NIS suppliers where pickers exist.",
    "Save to create the intake batch; you will return to the board/table to run checklist and tests.",
  ],
  "modal-grower-link-sample-to-batch": [
    "Open when linking a lab sample result to an intake batch.",
    "Select the correct batch and sample identifiers; do not guess batch numbers.",
    "Save so quality status can move to approved/pending per your rules.",
  ],
  "modal-supplier-receiver-checklist": [
    "Open from supplier intake via <strong>Receiver checklist</strong> to start a new supplier oil delivery.",
    "Capture delivery note, supplier from CRM, quantities, and product type.",
    "Submit to create the batch that will appear on the board for sample testing and release to oil production.",
  ],
  "modal-supplier-oil-batch": [
    "Open from supplier intake row actions when editing batch header details.",
    "Adjust only fields your role is allowed to change after receiving; some values may be locked post-test.",
    "Save and confirm status still matches physical stock before releasing to production.",
  ],
  "modal-receiving-checklist": [
    "Open from stock or supplier flows when a receiving checklist is required for a movement.",
    "Complete quantities, condition checks, and sign-off fields.",
    "Save so stock and intake statuses can advance.",
  ],
  "modal-kernel-job-card": [
    "Open from kernel production for a batch entering or progressing production.",
    "Fill job card fields (styles, yields, equipment) per your factory standard.",
    "Save; downstream release-to-stock steps depend on accurate job card data.",
  ],
  "modal-job-card-view": [
    "Open from production or dispatch when viewing a read-only job card summary.",
    "Use it to verify styles and quantities before authorising dispatch or QA.",
    "Close when finished—no edits here if the dialog is view-only in your build.",
  ],
  "modal-production-stages": [
    "Open from kernel production to advance or edit production stages for a batch.",
    "Move stages in order; do not skip mandatory QA stages if the UI enforces them.",
    "Save after each meaningful change so the board reflects true floor status.",
  ],
  "modal-production-stages-view": [
    "Open to review stage history and timestamps without changing current state (if configured as read-only).",
    "Use it during investigations when dispatch or QA questions where a batch stalled.",
  ],
  "modal-kernel-dispatch": [
    "Open from kernel dispatch when creating or editing a dispatch basket header (buyer, delivery date).",
    "Pick kernel customers from CRM; lines usually come from stock send-to-dispatch.",
    "Save before opening line-level or inspection forms.",
  ],
  "modal-kernel-dispatch-form": [
    "Open when completing inspection and dispatch paperwork for a kernel order.",
    "Fill vehicle, seal, weight checks, and sign-offs as your logistics SOP requires.",
    "Submit only after physical load matches the basket; fixes go back to stock or the basket, not forged paperwork.",
  ],
  "modal-send-to-dispatch": [
    "Open from <strong>Stock management</strong> (kernel) after selecting finished kernel lines to move toward dispatch.",
    "Confirm customer, delivery date, and quantities match what sales agreed.",
    "Submit; the basket should appear in <strong>Kernel dispatch</strong> for final inspection.",
  ],
  "modal-send-to-dispatch-oil": [
    "Open from oil stock when sending finished oil/protein lots toward oil dispatch.",
    "Verify lot numbers, best-before, and quantities against the warehouse.",
    "Submit; complete oil dispatch forms from the dispatch module.",
  ],
  "modal-oil-production-sheet": [
    "Open from oil production when starting or editing a production sheet.",
    "Choose <strong>Fill out the form</strong> vs <strong>Upload a file</strong> if both modes exist.",
    "Enter yields, losses, and product splits; attach files if the run used external lab results.",
    "Save so finished goods and stock can reflect the run.",
  ],
  "modal-oil-dispatch": [
    "Open from <strong>Oil dispatch</strong> when creating or editing a dispatch basket header (customer, delivery window, references).",
    "Pick oil &amp; protein customers from CRM where the form offers a lookup—match the sold-to party on the order.",
    "Confirm only <strong>released</strong> oil lots and finished stock lines are referenced; if something is missing, fix it in <strong>Stock management</strong> first.",
    "Save the header before opening line inspection or dispatch forms tied to this basket.",
    "If validation fails, read the message—usually a missing customer, date, or line mismatch.",
  ],
  "modal-oil-dispatch-form": [
    "Open for oil/protein inspection and despatch paperwork.",
    "Complete checks, signatures, and transport details; submit when the load is true.",
  ],
  "modal-oil-lot": [
    "Open when creating or editing an oil lot record tied to stock.",
    "Enter best-before, quantity, and location; align with physical labels on drums or tanks.",
    "Save before sending the lot to dispatch.",
  ],
  "modal-import-oil-lots": [
    "Open from stock when importing oil lots from Excel.",
    "Use the template your admin provided; do not rename columns.",
    "Preview and confirm row counts before committing.",
  ],
  "modal-stock-take": [
    "Open from stock management when running a stock-take or adjustment workflow.",
    "Count physically first, then enter counted quantities; explain variances in notes if required.",
    "Submit for approval if your workflow includes a reviewer.",
  ],
  "modal-raw-material-issued": [
    "Open when recording raw material issued to production from stock.",
    "Link to the correct batch or job; quantities reduce raw stock when saved.",
  ],
  "modal-quality-test": [
    "Open from QA grid when logging or editing a specific test result.",
    "Choose pass/fail/conditional and attach evidence files if required.",
    "Save; failed tests may block release depending on configuration.",
  ],
  "modal-batch-summary": [
    "Open from batch cards or journey views to see consolidated batch metadata.",
    "Use it to confirm grower, weights, moisture, and status before answering customer queries.",
  ],
  "modal-batch-history": [
    "Open to read the audit-style history of status changes and user actions on a batch.",
    "Use during investigations; do not edit history entries.",
  ],
  "modal-end-sample": [
    "Open from grower or QA flows when closing out a sample workflow.",
    "Record final disposition and any retest requirement.",
  ],
  "modal-end-sample-view": [
    "Open for read-only review of how a sample was closed.",
  ],
  "modal-role": [
    "Open from <strong>Roles</strong> grid when adding or editing a role inline.",
    "Match naming conventions your organisation uses for SSO or audits.",
  ],
  "modal-role-permission": [
    "Open from <strong>Role permissions</strong> when mapping a role to a database object.",
    "Pick object type, object name, and allowed operations—grant least privilege.",
  ],
  "modal-role-feature": [
    "Open from <strong>Role features</strong> to tie a feature flag to a role.",
    "Toggle once per combination; document the change.",
  ],
  "modal-feature": [
    "Open from <strong>Features</strong> grid to define or edit a feature key and description.",
    "Use stable keys—changing keys later breaks role assignments.",
  ],
  "modal-user": [
    "Open from <strong>Users</strong> when editing profile, role, or activation state.",
    "Avoid shared accounts; use reset-password instead of telling another person the password.",
  ],
  "modal-test-data-set": [
    "Open from test data to define or edit a synthetic data set name, module, and purpose.",
    "Save before adding child records.",
  ],
  "modal-test-data-record": [
    "Open to edit one synthetic record’s JSON/fields for a scenario.",
    "Keep values obviously non-production.",
  ],
  "modal-test-scenario": [
    "Open to name and describe an automation scenario; link data sets if required.",
  ],
};

/** Fallback for dialogs: override per id in PAGE_STEPS when the flow is distinctive. */
const DEFAULT_MODAL_PAGE_STEPS = [
  "Open this dialog from the parent screen (toolbar, card, or row action)—not from the sidebar on its own.",
  "Read the title and any short instructions; required fields are usually marked (e.g. with <strong>*</strong>).",
  "Fill the form using dropdowns, dates, and lookups where offered so values match what the database expects.",
  "Click the primary <strong>Save</strong> / <strong>Submit</strong> button to apply changes, or <strong>Cancel</strong> / close (×) to discard.",
  "If validation errors appear, fix the highlighted fields and submit again before leaving the dialog.",
];

/** Fallback when a new grid is added to the app before PAGE_STEPS is updated. */
const GENERIC_GRID_PAGE_STEPS = [
  "Open this module from the sidebar when your role includes access.",
  "Use search, filters, and <strong>Clear</strong> (if shown) to find the rows you need.",
  "Use toolbar buttons (add, export, refresh) for actions that create new records or refresh the whole list.",
  "Use row actions or links inside each row to open detail, edit, or the next step in the workflow.",
];

function pageStepsHtml(id) {
  let steps = PAGE_STEPS[id];
  if (!steps || !steps.length) {
    if (id.startsWith("modal-")) steps = DEFAULT_MODAL_PAGE_STEPS;
    else steps = GENERIC_GRID_PAGE_STEPS;
  }
  if (!steps || !steps.length) return "";
  const lis = steps.map((s) => `      <li>${s}</li>`).join("\n");
  return `    <h3 class="guide-subhead">How to use this screen</h3>
    <ol class="guide-page-steps">
${lis}
    </ol>`;
}

/** Shown only via Help deep-link (#id); hidden from ?full=1 TOC and scroll. */
const EXCLUDE_FROM_FULL_GUIDE = new Set([
  "test-data-sets",
  "test-data-records",
  "modal-test-data-record",
  "modal-test-data-set",
  "modal-test-scenario",
  "test-scenarios-grid",
  "modal-user",
  "users-grid",
]);

function fullGuideAttr(id) {
  return EXCLUDE_FROM_FULL_GUIDE.has(id) ? ` data-exclude-from-full-guide="1"` : "";
}

function collectAnchors() {
  const m = new Map();
  const add = (id, title) => m.set(id, title);

  const allFiles = walkDir(WEBPORTAL_MODULES);
  for (const file of allFiles) {
    if (!file.endsWith(".html")) continue;
    const base = path.basename(file);
    if (/_grid\.html$/.test(base) && file.includes(`${path.sep}html${path.sep}`)) {
      const stem = path.basename(file, ".html");
      if (stem === "crm_grid" || stem === "test_data_grid" || stem === "admin_grid") continue;
      const aid = gridAnchor(stem);
      add(aid, `${humanTitle(aid).replace(/ Grid$/, "")} (module)`);
    }
  }

  add("crm-nis-suppliers", "CRM — NIS suppliers");
  add("crm-oil-processors", "CRM — Oil processors");
  add("crm-oil-ingredient-suppliers", "CRM — Oil ingredient suppliers");
  add("crm-oil-protein-customers", "CRM — Oil &amp; protein customers");
  add("crm-kernel-customers", "CRM — Kernel customers");
  add("test-data-sets", "Test data — Data sets");
  add("test-data-records", "Test data — Records");
  add("admin-users-permissions", "Admin — Users &amp; permissions");
  add("admin-roles-management", "Admin — Roles management");
  add("admin-system-configuration", "Admin — System configuration");

  add("supply-chain-flow", "Supply chain &amp; process flow");
  add("my-day", "My day (module)");
  add("dashboard-overview", "Dashboard overview");
  add("material-journey-dashboard", "Material journey dashboard");
  add("executive-dashboard", "Executive dashboard &amp; reporting");
  add("roles-grid", "Roles (module)");
  add("role-permissions-grid", "Role permissions (module)");
  add("role-features-grid", "Role features (module)");

  for (const file of allFiles) {
    if (!/\/modals\/[^/]+\/html\/modal_[^/]+\.html$/.test(file.replaceAll("\\", "/"))) continue;
    const stem = path.basename(file, ".html");
    const aid = modalAnchor(stem);
    add(aid, `${humanTitle(aid.replace(/^modal-/, ""))} (dialog)`);
  }

  return m;
}

function buildUserGuide(anchors) {
  const sections = [...anchors.entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([id, title]) => {
      return `  <section id="${id}" class="guide-section" data-guide-id="${id}"${fullGuideAttr(id)}>
    <h2>${title}</h2>
${blurbFor(id, title)}
${pageStepsHtml(id)}
${shotFigure(id)}
  </section>`;
    })
    .join("\n\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Macavation User Guide</title>
  <link rel="stylesheet" href="help-shell.css" />
</head>
<body>
  <div id="guide-single-bar">
    <div class="single-bar-top">
      <span class="single-title"></span>
      <a href="index.html?full=1" class="btn-link secondary" data-action="full-guide">Full user guide</a>
    </div>
  </div>

  <h1 id="guide-main-title">Macavation User Guide</h1>
  <p id="guide-intro">Use <strong>Help</strong> for this topic: what it is for, how to work through it, and—where relevant—<strong>numbered steps</strong> for that screen. Open the <strong>full user guide</strong> for every section and the table of contents.</p>

  <div id="guide-toc">
    <h2>Contents</h2>
  </div>

  <div id="guide-process">
    <h2>Supply chain at a glance</h2>
    <p class="guide-lead">Macavation follows two product streams plus shared support. Each topic below describes a specific screen.</p>
    <ol class="guide-page-steps">
      <li><strong>Kernel stream:</strong> Grower intake → Kernel production → Stock (kernel) → Kernel dispatch.</li>
      <li><strong>Oil &amp; protein stream:</strong> Supplier intake → Oil production → Stock (oil/protein) → Oil &amp; protein dispatch.</li>
      <li><strong>Shared &amp; admin:</strong> CRM, Quality, Documents, integrations, Users, Admin, and My Day support both streams.</li>
    </ol>
  </div>

${sections}

  <script src="help-shell.js" defer></script>
</body>
</html>
`;
}

function syncHelpAssets() {
  fs.mkdirSync(path.join(WEBPORTAL_HELP_DIR, "assets", "screenshots"), { recursive: true });
  const destSvg = path.join(WEBPORTAL_HELP_DIR, "assets", "process-overview.svg");
  if (fs.existsSync(PROCESS_SVG_SRC)) {
    fs.copyFileSync(PROCESS_SVG_SRC, destSvg);
  }
  const docsShots = path.join(REPO, "docs", "user-guide", "assets", "screenshots");
  const outShots = path.join(WEBPORTAL_HELP_DIR, "assets", "screenshots");
  if (fs.existsSync(docsShots)) {
    for (const name of fs.readdirSync(docsShots)) {
      if (name.endsWith(".png")) {
        fs.copyFileSync(path.join(docsShots, name), path.join(outShots, name));
      }
    }
  }
}

function upgradeLegacyHelpLinks() {
  for (const file of walkDir(WEBPORTAL_MODULES)) {
    if (!file.endsWith(".html")) continue;
    let t = readUtf8(file);
    if (!t.includes("../docs/user-guide.html") && !t.includes("help/index.html#")) continue;
    let n = t.replaceAll("../docs/user-guide.html", "help/index.html");
    n = n.replace(/\s*target="_blank"\s*/g, " ");
    n = n.replace(/\s*rel="noopener noreferrer"\s*/g, " ");
    n = n.replace(/<a href="(help\/index\.html#[^"]+)"([^>]*class=")([^"]*)"/g, (match, href, mid, clsVal) => {
      if (clsVal.includes("macavation-help-link")) return match;
      return `<a href="${href}"${mid}${clsVal} macavation-help-link"`;
    });
    if (n !== t) writeUtf8(file, n);
  }
}

let patched = 0;
const failedModals = [];

const anchors = collectAnchors();
fs.mkdirSync(WEBPORTAL_HELP_DIR, { recursive: true });
syncHelpAssets();
writeUtf8(PORTAL_HELP, buildUserGuide(anchors));
upgradeLegacyHelpLinks();

const du = path.join(WEBPORTAL_MODULES, "dashboard", "html", "dashboard_unified.html");
if (fs.existsSync(du)) {
  const r = patchDashboardUnified(du);
  if (r.ok && !r.skipped) patched++;
}

for (const folder of ["roles", "role-permissions", "role-features"]) {
  const rp = path.join(WEBPORTAL_MODULES, folder, "html", "role_grids_unified.html");
  if (fs.existsSync(rp)) {
    const r = patchRoleGridsUnified(rp);
    if (r.ok && !r.skipped) patched++;
  }
}

const sc = path.join(WEBPORTAL_MODULES, "supply-chain-flow", "html", "supply_chain_flow.html");
if (fs.existsSync(sc)) {
  const r = patchSupplyChain(sc);
  if (r.ok && !r.skipped) patched++;
}

const kd = path.join(WEBPORTAL_MODULES, "kernel-dispatch", "html", "kernel_dispatch_grid.html");
if (fs.existsSync(kd)) {
  const r = patchDispatch(kd, "kernel-dispatch-grid");
  if (r.ok && !r.skipped) patched++;
}

const od = path.join(WEBPORTAL_MODULES, "oil-dispatch", "html", "oil_dispatch_grid.html");
if (fs.existsSync(od)) {
  const r = patchDispatch(od, "oil-dispatch-grid");
  if (r.ok && !r.skipped) patched++;
}

const myDay = path.join(WEBPORTAL_MODULES, "my-day", "html", "my_day.html");
if (fs.existsSync(myDay)) {
  const r = patchMyDay(myDay);
  if (r.ok && !r.skipped) patched++;
}

const bj = path.join(WEBPORTAL_MODULES, "batch-journey", "html", "batch_journey_grid.html");
if (fs.existsSync(bj)) {
  const r = patchBatchJourney(bj);
  if (r.ok && !r.skipped) patched++;
}

const dispatchStems = new Set(["kernel_dispatch_grid", "oil_dispatch_grid"]);
for (const file of walkDir(WEBPORTAL_MODULES)) {
  if (!/_grid\.html$/.test(file)) continue;
  if (!file.includes(`${path.sep}html${path.sep}`)) continue;
  const stem = path.basename(file, ".html");
  if (dispatchStems.has(stem)) continue;
  const r = patchGenericGrid(file);
  if (r.ok && !r.skipped) patched++;
}

const di = path.join(WEBPORTAL_MODULES, "data-import", "html", "data_import_grid.html");
if (fs.existsSync(di)) {
  const r = patchDataImport(di);
  if (r.ok && !r.skipped) patched++;
}

for (const file of walkDir(WEBPORTAL_MODULES)) {
  if (!/\/modals\/[^/]+\/html\/modal_[^/]+\.html$/.test(file.replaceAll("\\", "/"))) continue;
  const r = patchModal(file);
  if (r.ok && !r.skipped) patched++;
  else if (!r.ok && !readUtf8(file).includes("help/index.html")) {
    failedModals.push(path.relative(REPO, file));
  }
}

console.log("Wrote WebPortal/help/index.html");
console.log(`Patched ${patched} files (new inserts only).`);
if (failedModals.length) {
  console.log("Modals not patched:");
  failedModals.forEach((f) => console.log(" ", f));
}
