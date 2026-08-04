# Customapp-PTY-LTD/Macavation

## Architecture map — read before editing the portal

Recorded 2026-07-28 after each of these cost real discovery time. A plan that named the wrong
dashboard file would have merged and auto-deployed a change that renders nowhere.

**The app is `WebPortal/`.** Amplify app `d18pzj0vk19ewp` builds with `appRoot: WebPortal`, so the
deployed site root IS `WebPortal/index.html`. `dev` **auto-deploys on merge** to
`https://dev-macavation.customapp.co.za` (canonical; `dev-macavation.customapp.org` serves the same
branch — same app, both live).

**There is a second, parallel top-level tree** (`modules/`, `css/`, `js/`) holding 3 modules against
`WebPortal/modules/`'s 31. It is **not deployed** by the app above and **not scanned** by
`ui:verify`. Check which tree you are in before editing — a fix applied there never reaches the dev
site.

**Dashboard markup.** The live markup is `WebPortal/modules/dashboard/html/dashboard_unified.html`
(~691 lines), which serves **three** dashboards partitioned by `data-access` wrappers (`default`,
`pallandium-integrator`, `executive`) that `dashboard.js` shows and hides by role. Markup placed in
the wrong block appears on the wrong dashboard. Two dead stubs that used to sit beside it
(`executive_dashboard.html`, a 37-line stub still reading "Chart will be displayed here") plus a
stale 387-line `dashboard.html` generation of the same file — neither named by any route, nothing
rendered either — were removed 2026-07-28.

**`data-dashboard-widget` hides new elements permanently.** Anything carrying it is hidden unless
its id is in the user's visible-widget list. New ids are in nobody's list, role defaults are
hardcoded, and the Customize modal only offers ids present in `DASHBOARD_WIDGET_LABELS`. Do not put
it on anything new unless you also add it to all three.

**`data-action-perm` is swept once, over static markup only.** The router runs `actionAccess.apply`
a single time shortly after module load, over `#content-area`. Markup injected later is never
swept, so the attribute is **inert** on dynamically rendered rows. For dynamic content, call
`hasAction()` inline at render time — that is what the existing dashboard code does.

**Permissions are two layers that must move together.** `actions`/`role_actions` gate the *buttons*
(default-**deny** in `WebPortal/js/action-access.js`; `super_user` and `admin` are always allowed in
code). `role_permissions` gates what the *API* will execute. They are badly out of step as of
2026-07-28: 6 of 8 roles hold 2 of 25 action keys but 186+ API grants each, so hidden buttons do not
prevent the operation. See `docs/phase2/role-permissions-workshop.pdf`. Note the pattern in
`docs/RBAC_GUIDE.md` grants a new function to **every** role — that is how this drifted.

**No screen is deep-linkable.** The router never reads the URL — no hash route, no query route, every
nav link is `href="#"`. Links can only land on the app root. This is why the fleet's `preview_path`
is deliberately unset.

**`npm ci` fails here** — there is no `package-lock.json` and zero dependencies. Use `npm run <script>`
directly. `ui:verify` scans `WebPortal/` only (paths it prints are relative to that), skips `help/`,
and **fails on `dev` today** with 65 pre-existing violations, mostly raw hex and Bootstrap Icons in
the Mac assistant/mascot CSS. Do not "fix" those as a side effect of unrelated work.

**`docs/phase2/PHASE2_IMPLEMENTATION_PLAN.md` is stale below its status table.** The table at the top
is accurate; the per-epic "Remaining work" tables describe the pre-2026-07-06 state and list work
that is already built. Do not cost or schedule from them.

## Agent Fleet

To run, submit, or hand off a plan to the dev agents, follow the rule in
`.claude/rules/agent-fleet-submit.md` - it covers the 330-minute plan-size check and the push-to-dev-agent flow.

## Git hygiene (multi-actor)

Fleet runs, Cursor, and Claude Code sessions all land commits on this repo. Before ANY git
operation here, follow `.claude/rules/git-hygiene.md` - fetch-first branching, one actor per
worktree, no direct commits on the base branch, and the stuck-local-dev rescue.

## Fleet test gate

How this repo's tests gate a fleet merge - and where the gate is set (a PR to the
`agent-fleet` repo's `config/repos.json`, not here) - is in `.claude/rules/fleet-test-gate.md`. Follow it when
asked to gate tests, turn the gate on/off, or explain why a change merged untested.