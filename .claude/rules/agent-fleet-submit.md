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
below); sequence dependent sub-plans with `depends_on:` frontmatter instead of one mega-plan
(Step 0.6 has the exact syntax).

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
  deliverable boundaries** (name the cut points), each sub-plan chained with `depends_on:`
  (Step 0.6) and all pushed together. Do **not** block - if they say push anyway, push it.
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

## Step 0.6 - chain dependent plans with `depends_on:`

When work splits into plans where ORDER matters - the migration file first, then the screen that
uses it - **push them all in one commit** and let the fleet order them. Do not push one, wait for
the email, then push the next. `depends_on:` goes in the frontmatter of the plan that must WAIT:

```markdown
---
depends_on: add-policy-status-column.md
---
# Show policy status on the Policies list
...
```

- **Only the waiting plan carries the line.** The plan it waits for is an ordinary plan and needs
  no frontmatter at all. Putting `depends_on:` on the prerequisite reverses the order, and nothing
  warns you - so always ask "which plan must wait?" and put it on that one.
- **The `---` block must be the FIRST thing in the file**, above the title. Below the title it is
  not read at all: no error, no dependency, both plans simply run at once.
- **A bare filename is the normal form** - it is resolved against the plans the fleet knows about
  (this push plus anything already queued). Comma-separate to wait on more than one:
  `depends_on: phase-1-database.md, phase-2-api.md`. Use a full repo-relative path
  (`depends_on: plans/add-policy-status-column.md`) ONLY to break a filename collision - if two
  queued plans share a basename the fleet blocks the dependent rather than guessing.
- **Same repo only.** There is no cross-repo dependency; the fleet cannot order plans across repos.
- **What actually happens**: prerequisite merged -> the dependent runs; queued/running/not-yet-pushed
  -> it WAITS and releases on its own when the prerequisite merges; **failed, stopped, paused, or
  blocked** with no live retry offer -> it is BLOCKED and never runs (a still-live "Approve &
  resubmit" offer keeps it waiting instead, and a merged `*.retry-1.md` retry satisfies the
  dependency). Note `paused` is terminal for a dependent: resume is unwired, so a paused
  prerequisite never self-completes.
- **A plan waiting on a prerequisite that is never pushed waits indefinitely** - there is no grace
  timeout. Its `Waiting` row on the portal's queue page is the only signal. So never name a plan in
  `depends_on:` that you are not actually going to submit, and do not typo the filename.
- **Chains**: each plan names only the one before it (`phase-2-api.md` -> `phase-1-database.md`,
  `phase-3-screen.md` -> `phase-2-api.md`), all pushed together. A plan with no `depends_on:` - the
  normal case - is unaffected by any of this.

**A second, distinct reason to chain: two sibling plans that touch the same shared file, even
when order doesn't otherwise matter.** The fleet may run several plans for the same repo at once
(up to `max_in_flight` concurrently, default 3) - each starts from its own snapshot of the repo and
only merges into `dev` at the very end. If two of those plans both edit the same shared/coordination
file - a seed/index file every phase appends rows to, a shared router (`js/app.js`, an
edge-function's route table), a shared migration README index - whichever merges first wins, and
the second gets a **real, human-must-resolve merge conflict** instead of a clean merge (this is not
a bug: the fleet never auto-resolves a conflict). This happened for real: eDamagePortal's
`07c-app-users-frontend-ui.md` conflicted on `js/app.js`, and its `08b-transactions-db-functions.md`
sibling conflicted on a shared seed SQL file, a migration README, and a shared edge-function router
- three separate plans in the same feature batch, none order-dependent on the others, all racing to
land in the same shared files. If you know two plans in this batch will touch the same file, put
`depends_on:` on the later one exactly as you would for an order dependency - even though nothing
about the *data* requires it to wait.

## Step 0.7 - the plan-safety checklist (do this BEFORE you push)

A plan can be detailed and well-researched and still get blocked, not because the work is wrong,
but because it asks the agent to do something the review gates can't wave through unseen. Re-read
the plan against these seven before pushing:

1. **External contracts are backed by a file:line citation, not memory.** If the plan states how
   an external API/service/gateway behaves, name the file where that call is actually made in this
   repo. If nothing in the checkout calls it yet, mark the contract unconfirmed rather than stating
   it as fact.
2. **No open-ended third-party dependency, no unexecutable verify step.** Name the exact package +
   version + source for any new library, or defer it to a separate human-reviewed plan - never
   "vendor a suitable X." Every "verify before finishing" step must be something the agent can run
   itself (a script, a fixture assertion, a grep) - never a physical device or a human's eyes with
   no automated fallback.
3. **State this repo's security invariants explicitly**, next to the screen/function they apply to
   (e.g. "render with `.text()`, never `.html()`/`innerHTML`," "re-check the session token,"
   "validate the upload path before writing") - don't rely on the agent inferring them from
   surrounding code.
4. **Don't assert a claim as settled fact in a permanent artifact if the agent can't verify it from
   inside this repo.** No DB/network access means no way to check a production figure or a
   "resolved" status against reality - if the plan bakes one into a doc or code comment anyway,
   mark it unresolved/unverified instead. Also re-check any table or "proof" the plan itself
   supplies: numbers that don't balance, or a term defined two different ways, mean the plan's
   own premise needs fixing before an agent is asked to act on it.
5. **Verify claims about THIS repo's own existing behavior against code, not memory** - the same
   discipline as item 1, extended inward. Before stating how an existing flow, error path, or
   shared function behaves, name the file and describe what the code does - don't assume a
   generic error UI fires for a case you haven't traced. (This is what blocked four sibling plans
   on one real repo: each claimed a failed submit already showed a normal error, and the actual
   code swallowed it and showed a false success screen instead.) **This extends to any test
   assertion or "verify before finishing" outcome the plan mandates** - a mandated assertion IS a
   claim about the code's current behavior and needs the same file:line grounding. If you haven't
   traced the exact path the assertion depends on, say so and mark it unconfirmed rather than
   writing the expected outcome as given.
6. **Before building something new, check whether this repo already has a near-duplicate to model
   after or reuse.** A new module, screen, or flow that closely resembles something already in the
   codebase should be built FROM that existing implementation, not from scratch - grep for the
   obvious sibling first. (This is what blocked a HybridRisk plan's own auto-amended retry: the
   amendment still didn't know about a near-identical claim form already in the repo it should
   have been modeled on.) This also covers the narrower case of a UI input type (radio/checkbox/
   multi-select) not already used elsewhere in this codebase: zero grepped results means the plan
   must state explicitly how it'll be captured/serialized - don't assume a text/textarea-only
   template already handles it.
7. **Check the blast radius on EXISTING tests, not just the new one.** If "verify before
   finishing" means the existing suite must pass, state whether the change could break an
   assertion that already exists - name and update that test explicitly as an in-scope
   deliverable, rather than leaving the agent to guess between three bad options.

**Never block on this** - same as the size check, it's advisory. Full checklist and rationale live
in the fleet toolkit's `templates/plan-safety-checklist.md`.

## Step 0.8 - run the real gate locally before pushing (optional, but the cheapest check there is)

If the fleet toolkit's own checkout is available on this machine, `scripts/preflight-review.sh`
runs the EXACT same review the fleet's plan-review gate runs - same model, same prompt, same
checks - against this repo's own checkout, in about 1-2 minutes, with zero fleet dispatch and
zero blocked-run bookkeeping. It costs one real model call (needs an `ANTHROPIC_API_KEY` in this
environment) but nothing else - no run is recorded, nothing is dispatched.

```bash
/path/to/agent-fleet/scripts/preflight-review.sh <plan-file> <this-repo-checkout-path>
```

If it reports BLOCK, fix what it found before pushing - that is exactly what the live gate would
say, just without the round trip. If the fleet toolkit is not checked out locally, skip this step;
it is a convenience, never a requirement, and the live gate still runs regardless.

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

## Further reading

Read these (or point the developer at them) when a question goes beyond this rule - do not guess
at fleet behaviour that is already written down:

- **The developer guide - the only submitter-facing how-to, and the source of truth** for plan
  format, frontmatter, dependencies, blocks and costs:
  <https://github.com/Customapp-PTY-LTD/agent-fleet/blob/dev/docs/fleet-user-guide.md>
  Dependencies, with a worked two-plan example and a diagram of the three outcomes:
  <https://github.com/Customapp-PTY-LTD/agent-fleet/blob/dev/docs/fleet-user-guide.md#dependencies-between-plans>
- **The queue page** - which plans are Waiting, Blocked or Running right now, and why:
  <https://dev.d2zheavn62lwu9.amplifyapp.com/queue.html>. If two plans that should have been
  ordered are both Running, the `---` block was not the first thing in the file.
