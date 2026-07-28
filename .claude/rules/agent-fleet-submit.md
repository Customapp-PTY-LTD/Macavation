# Submitting a plan to Agent Fleet (Claude Code)

Apply this when the user asks to **run, submit, or hand off a plan** to Agent Fleet / the dev
agents - do not just leave the plan sitting in `~/.claude/plans/` - AND whenever the user asks
for **substantial work in this repo without naming a delivery route** (see "Fleet or direct?"
below: substantial work defaults to the fleet).

The fleet runs a plan pushed to this repo's `dev-agent` branch: within ~5 minutes it reviews the
plan (Fable gate), runs it inside this repo's own guardrails, and **merges the result straight
into `dev`** (no PR, no approval). Whoever commits the plan is auto-emailed the outcome and cost.

## Fleet or direct? - the routing decision for substantial work

When the user describes a substantial feature/fix but does not say HOW to deliver it, decide
deliberately rather than defaulting to hand-implementation:

**Default to the fleet** when ALL of these hold:
- The change is self-contained in THIS repo. The fleet engine cannot reach other repos, cloud
  infrastructure, or secrets.
- Success is specifiable in a written plan - a code reviewer could verify it from the diff and
  tests without needing to see pixels or judge taste.
- It is not time-critical (a fleet round is typically 15-60 minutes, plus possible remediation
  rounds if a gate blocks).

**Implement directly instead** when ANY of these hold:
- Trivial or tiny - faster to do than to specify.
- Design-heavy - success needs a human eye per iteration ("make it feel right", visual polish).
  The diff reviewer verifies behaviour; it cannot see the page.
- It touches secrets, CI/CD, infra, cross-repo assets, or a DB migration that must be sequenced
  with human operations.
- It is an urgent hotfix.

**Hybrid is often the best split**: do the parts the fleet cannot (vendor assets from another
repo, provision a secret, apply a migration) directly FIRST and commit them to `dev`, then
submit a plan for the rest that references what is now in place.

**Database migrations specifically**: the fleet engine has NO database credentials and no network
path to any database - it only ever runs inside this repo's checkout. So a plan can *author* a
migration FILE (commit `sql/…`), but it can NEVER apply one. Applying is always an out-of-band
human step (Supabase Studio, or a DB tunnel, by someone who holds the credential). Structure work
that way: a plan may write the migration file + the code that assumes it, but keep "apply the
migration" as a human action you sequence yourself - and make any code that depends on the new
schema **degrade gracefully until it is applied**, because the plan merges (and `dev` may deploy)
the moment its gates pass, which is BEFORE a human runs the migration.

**Splitting & sequencing**: large work splits along deliverable boundaries (see the size check
below); sequence dependent sub-plans with `depends_on:` frontmatter instead of one mega-plan.

**Ask once, then stop asking**: the first substantial task in a session, ask the user
fleet-vs-direct (one short question). Once they have chosen, treat that as the session default
and just say which route you are taking - do not re-litigate it per task.

## Step 0 - ~60-minute size check (do this BEFORE you push)

The engine (the part that does your plan's work) is capped at `timeout-minutes: 60`; past that it
reports the run unfinished, nothing merges, and no half-finished branch is pushed. So the budget to
size against is **~60 minutes of AGENT work**, not the 330-minute whole-job ceiling (that extra time
is checkouts/reviews/tests/merge, and every step is now individually capped). Before pushing, judge
whether the plan can realistically finish in one ~60-minute run. Advisory is cheap, so **err
toward flagging.**

**Strong signals - flag on ANY one:** open-ended / investigative scope ("find and fix whatever is
wrong", "audit X"); a full or slow test-suite / E2E run is part of the work; a large data
migration / backfill / bulk transform; multiple *dependent* build-then-verify cycles (A, then B
needing A, then C needing B).

**Scope-proxy signals - flag only when SEVERAL co-occur:** more than one distinct deliverable;
touches many files across unrelated areas; bundles DB migration AND code AND tests AND docs;
vague acceptance criteria.

- **If it flags:** tell the user it looks large for one 330-minute job and **propose a split along
  deliverable boundaries** (name the cut points), each sub-plan pushed in sequence. Do **not**
  block - if they say push anyway, push it.
- **If nothing flags:** proceed to submission. Do not over-warn a well-scoped plan.

Full checklist and rationale live in the fleet toolkit's `templates/plan-sizing-blueprint.md`.

## Step 0.5 - set `preview_path` so the merged link deep-links the right page

A merged run's "View it live" link points at the repo's deployed dev site. By default it lands on
the site root; an optional `preview_path` in the plan's frontmatter deep-links it to the exact page
this plan changes. **You** (the plan author's AI) set this - the fleet run is autonomous, so there
is no one to ask at run time. Do it now, while the developer is here to confirm.

- **Only if this repo has a `preview_url`** in the fleet's `config/repos.json`. If it does not, a
  `preview_path` does nothing (dead config) - skip it entirely.
- **Derive the path from THIS repo's own URL convention** - do not assume a universal one. Inspect
  the repo to see which it is:
  - **Flat multi-page site** (pages served at the root, e.g. `reports.html`): use `/<page>.html`,
    e.g. `preview_path: "/reports.html"`.
  - **Hash-routed SPA** (a router mapping a route name to `#<route>`): use the hash path, and it
    **MUST be quoted** - an unquoted `#` is stripped as a YAML comment and the key silently
    no-ops: `preview_path: "/#users-grid"`.
  - **Query-param-routed** (deep links look like `?someRoute=<name>`): **skip for now.** Composing
    a `?query` path onto a base that itself carries a query (e.g. a multi-tenant `?bg=<guid>`)
    drops the base query and breaks the link. Leave `preview_path` unset (root link) until the
    toolkit's `composePreviewUrl` learns to merge queries.
- **Pick the page that best demonstrates the outcome** if the plan touches several. If the change
  has no user-visible page (pure lib/test/infra), leave it unset.
- **Not sure which page or convention? Ask the developer now** - do not guess a path that would
  point somewhere the change didn't touch. A wrong-but-valid deep link is worse than the root.

## Submit (the Claude Code path differs from Cursor)

Claude Code plans live in `~/.claude/plans/` - a **global** location outside this repo, so
`git add` cannot reach them directly. Copy the plan into the repo first, into the git-ignored
`.cursor/plans/` scratch dir (the same place Cursor plans live), then force-add it. Keeping plans
under `.cursor/plans/` means they never land on `dev`, so every push to `dev-agent` is a genuine
new commit that runs.

```bash
# 1. Copy the plan from the global Claude plans dir into this repo's ignored scratch dir.
mkdir -p .cursor/plans
cp ~/.claude/plans/<PLAN_FILE>.md .cursor/plans/<PLAN_FILE>.md

# 2. Check out dev-agent, CREATING it off dev if it does not exist yet.
git fetch origin
git rev-parse --verify origin/dev-agent >/dev/null 2>&1 \
  && git checkout dev-agent && git pull origin dev-agent \
  || git checkout -b dev-agent origin/dev

# 3. Force-add (.cursor/plans/ is git-ignored - that is deliberate), commit as the user, push.
git add -f .cursor/plans/<PLAN_FILE>.md
git commit -m "Plan: <one line on what it does>"
git push -u origin dev-agent
```

- **Create `dev-agent` if it does not exist** - the `|| git checkout -b dev-agent origin/dev`
  above does this. Never fail just because the branch is missing.
- **Commit as the user** (their `@customapp.co.za` git identity) so the auto-notification email
  reaches them. To copy others in, add a `notify: name@customapp.co.za` line to the plan's
  frontmatter (comma-separate for several; `@customapp.co.za` only).
- After pushing, tell the user: it runs within ~5 minutes, they get an email with a link, and
  they can watch it at the fleet portal.

## Do not

- Do not commit the plan to `dev` and expect it to run - the trigger is a NEW commit on
  `dev-agent`. A plan already on `dev` runs nothing (silently). If `git commit` says "nothing to
  commit", the file is unchanged/already committed - make an edit and retry.
- Do not reformat the plan or add frontmatter it does not need - a plan runs as-is.
- Do not open a pull request - there is no PR step; the fleet merges to `dev` itself.
