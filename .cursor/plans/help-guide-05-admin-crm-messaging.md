---
depends_on: help-guide-04-oil.md
preview_path: "/help/index.html#crm-whatsapp-grid"
---
# Help guide rewrite 5 of 5: admin, CRM, WhatsApp and messaging

## Why

`WebPortal/help/index.html` is the Macavation user guide. It is also the ONLY source the
Portal Guide chat answers from: `scripts/ingest-macavation-assistant-kb.mjs` loads each
`<section class="guide-section">` into the knowledge base (`extractSections`, line 171). Most
sections still hold text a generator wrote in July 2026: either the stock phrase "Dialog opened
from the related module. Complete required fields (marked), then save" or a paragraph a few
lines long that predates months of changes. So the chat cannot answer real how-to questions.

This plan rewrites the sections for one area of the portal from the code as it is today. It is
plan 5 of 5 (`help-guide-01` to `-05`); they run one after another because they all edit the
same file, so earlier plans' sections will already be rewritten when this one starts. Use them as
further examples of the standard, and do not edit them.

## What to model it on

`<section id="silo-allocation-grid">` at `WebPortal/help/index.html:1044` was written by hand
on 13 Nov 2026 from `WebPortal/modules/silo-allocation/js/silo_allocation_grid.js`. Use it as
the template for tone, depth and markup. Every button name in it is copied from the code, and
its "Fix a mistake" part lists each undo option with the limits the database enforces. Write
every section in this plan to that standard.

## Sections in this plan

Rewrite (keep the existing `id`, `class`, `data-guide-id` and any `data-exclude-from-full-guide`
attribute exactly as they are):

| Section id | Read this code |
|---|---|
| `modal-admin-add-role` | `WebPortal/modules/modals/modal-admin-add-role/` (opened from `WebPortal/modules/admin/`) |
| `modal-admin-add-user` | `WebPortal/modules/modals/modal-admin-add-user/` (opened from `WebPortal/modules/admin/`) |
| `modal-user` | `WebPortal/modules/modals/modal-user/` |
| `modal-role` | `WebPortal/modules/modals/modal-role/` |
| `modal-role-feature` | `WebPortal/modules/modals/modal-role-feature/` |
| `modal-role-permission` | `WebPortal/modules/modals/modal-role-permission/` |
| `modal-feature` | `WebPortal/modules/modals/modal-feature/` |
| `modal-crm-contact` | `WebPortal/modules/modals/modal-crm-contact/` (opened from `WebPortal/modules/crm/`) |
| `messaging-compose-grid` | `WebPortal/modules/messaging-compose/` |

Add as NEW sections (section `id` = the route or dialog name; insert them next to the related sections):

| New section id | Sidebar label (`WebPortal/js/role-menu-config.js`) | Read this code |
|---|---|---|
| `crm-whatsapp-grid` | "WhatsApp & Chat" (line 366) | `WebPortal/modules/crm-whatsapp/` (`js/crm_whatsapp_grid.js`, `js/crm_whatsapp_contacts_tab.js`, `js/crm_whatsapp_internal_tab.js`) |
| `amanda-dashboard` | "Pallandium Integrator Dashboard" (line 312) | `WebPortal/modules/dashboard/js/amanda_dashboard.js` + its html |

New sections use the same markup as the template:
`<section id="X" class="guide-section" data-guide-id="X">`, an `<h2>`, a
`<p class="guide-lead">`, then `<h3 class="guide-subhead">` parts with
`<ol class="guide-page-steps">` / `<ul class="guide-page-steps">` lists. The page's contents list
is built at load time from these sections (`WebPortal/help/help-shell.js:32`), so there is no
separate contents to edit.

## How to write each section

1. **Read the code first, then write.** Every button, tab, field and message you name must be
   copied exactly from the module's HTML or the strings in its JS (for example
   `'Allocate selected'`, `'Opened by mistake'`). If you cannot find where a behaviour happens in
   the code, leave it out. Do not describe what a screen "probably" does. When a rule is
   enforced in the database (an error such as "Only the latest run ... can be undone"), find the
   function in `migrations/` and state the rule as the database enforces it.
2. **Answer the questions a user would ask.** For each screen cover: what it is for; how to do
   the main jobs, step by step; how to fix a mistake (edit, undo, cancel, remove — and when each
   is NOT allowed); and what the statuses or colours mean. Dialog sections say which screen and
   button opens them.
3. **The first ~200 characters matter most.** `<p class="guide-lead">` comes first and is used as
   the section's search summary (`buildChunks`, line 203 of the ingest script). Make it say what
   the screen does and name its main tasks.
4. **Plain English** for factory staff: short sentences, "press", not "click on"; no internal
   names (no table names, route ids or function names in the visible text).
5. **Size:** each section's visible text must stay under 5,800 characters
   (`MAX_SECTION_CHARS`, `scripts/verify-help-guide.mjs:33`) so the chat sees all of it. If a
   screen needs more, split it into a second section (for example `grower-intake-grid` +
   `grower-intake-bags`) and give that section keywords too.
6. **A dialog that nothing opens any more:** if you can show from the code that no screen opens
   it (grep for its open function / modal id across `WebPortal/`), keep the section but write
   2-3 sentences saying it is no longer used and what replaced it, citing what you found.
7. **Keep any existing `<figure class="guide-shot">` or `<figure class="guide-flow">`** in a
   section you rewrite. Do not add new image files.

## Security invariants for this file

- Static HTML only: no `<script>`, no `on*=` attributes, no `style=` attributes, no external
  URLs, no `<iframe>`/`<object>` additions.
- Escape text properly: `&amp;` for `&`, and use only these entities: `&amp;` `&mdash;`
  `&ndash;` `&rsaquo;` `&rarr;` (the ingest script's `stripTags`, line 150, decodes exactly
  these plus numeric entities; anything else would show raw in the chat).
- Do not edit any section that is not listed in this plan.

## Also in scope

1. **Keywords:** for every section in this plan, add or update its entry in
   `SECTION_KEYWORDS` (`scripts/ingest-macavation-assistant-kb.mjs:43`): 5-12 comma-separated
   phrases the way a user would ask ("undo a delivery", "wrong bag weight", "release to
   production"), including the sidebar label. Follow the existing entries' format.
2. **Progress lists in the verifier** (`scripts/verify-help-guide.mjs`): delete from
   `PENDING_PLACEHOLDER` (line 42) the ids rewritten here (`modal-admin-add-role`, `modal-admin-add-user`, `modal-crm-contact`, `modal-feature`, `messaging-compose-grid`, `modal-role`, `modal-role-feature`, `modal-role-permission`, `modal-user`), and delete `crm-whatsapp-grid` and `amanda-dashboard` from `PENDING_ROUTES` (line 75). Earlier plans in this series may already have removed other ids, so line numbers can have moved: find the lists by name. Change nothing else in the verifier. In particular, do not add anything to the pending lists, and do not loosen any check. After this plan both lists should be empty; leave the two empty `new Set([])` declarations in place.

## Out of scope — do not do these

- Do not run `scripts/apply_user_guide_help_links.mjs`. It is retired for the guide
  (`--overwrite-guide` gate at line 1028) and would only patch module HTML.
- Do not touch `supabase/functions/portal-assistant/`, any migration, or any module JS/HTML.
  Only `WebPortal/help/index.html`, `scripts/ingest-macavation-assistant-kb.mjs` and
  `scripts/verify-help-guide.mjs` change.
- Loading the new text into the databases is a human step after merge (the fleet has no DB
  access). Do not try to run the ingest without `--dry-run`.

## If the code contradicts this plan

Report the contradiction in your summary and write what the code shows. Do not shrink the scope
silently, and do not add any check that asserts something must NOT exist.

## Verify before finishing

All must pass:

```bash
npm run help-guide:verify          # pending lists updated, sizes, keywords, no placeholders left in your sections
node scripts/ingest-macavation-assistant-kb.mjs --dry-run   # parses; must print no "No SECTION_KEYWORDS entry" line
npm run test:fleet                 # the full merge gate
```

No existing test reads `WebPortal/help/index.html` except `help-guide:verify`, so no other
assertion should be affected.
