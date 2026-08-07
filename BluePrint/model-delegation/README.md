# Model delegation (token ring-fencing)

Baseline files for the Customapp model-delegation standard: implementation legwork runs on
Sonnet 5 from a self-contained brief; Opus 5 - the default top tier - writes briefs, reviews seams
and security, and debugs live failures, and does not type implementations. Fable 5 is a named
exception for genuinely frontier work, not a synonym for Opus.
**Canonical source: this repo (`portal-template`)** - changed 2026-08-01, was `jacana-portal`.
Having "the template new repos are made from" and "the repo the rollout script copies from" be two
different repos is exactly how they drifted apart: the template was fixed while jacana-portal kept
seeding the old files into every existing repo, and the two disagreed for weeks with nothing to
notice. `~/.claude/scripts/rollout-model-delegation.sh` now defaults its `SOURCE_DIR` here.

This folder is for **new projects** (step 10 of the New Project Setup template in the global
`~/.claude/CLAUDE.md`). Existing repos are covered separately - see "Existing repos" below. Do
not run the rollout script against a project you are scaffolding from this baseline; just copy
the files below by hand as part of project setup.

## What goes where

| File here | Copy to | Purpose |
|---|---|---|
| `builder.md` | `.claude/agents/builder.md` | Sonnet-pinned implementation subagent |
| `recon.md` | `.claude/agents/recon.md` | Sonnet-pinned read-only recon subagent |
| `model-delegation.md` | `.claude/rules/model-delegation.md` | Claude Code delegation protocol (canonical) |
| `model-delegation.mdc` | `.cursor/rules/model-delegation.mdc` | Cursor twin of the same protocol |
| `settings-model-pin.json` | merge into `.claude/settings.json` | Pins the session default to Sonnet |
| (this file) | not copied | reference only |

## Agents

Copy `builder.md` and `recon.md` into the new project's `.claude/agents/` directory as-is - both
are project-agnostic and need no per-project edits.

**Keep them that way.** These are infrastructure files, copied byte-identical into every repo, so
a repo-specific fact written here is wrong everywhere else it lands. Anything project-specific
(the live/legacy code split, naming conventions, a typography rule) belongs in that repo's
`CLAUDE.md` or its own `.claude/rules/` - both of which every session already loads. An agent
file may say "check this repo's `CLAUDE.md`"; it must never assert what it will find there.

## Rules (both flavours)

Copy `model-delegation.md` into `.claude/rules/model-delegation.md` and `model-delegation.mdc`
into `.cursor/rules/model-delegation.mdc`. Both are project-agnostic as written - no edits
needed.

## Settings pin

A brand-new project has no `.claude/settings.json` yet, so create it directly from
`settings-model-pin.json`:

```json
{
  "model": "sonnet"
}
```

If the project already has a `.claude/settings.json` (for example, scaffolded from another
template first), merge the `"model": "sonnet"` key into the existing file by hand instead of
overwriting it - preserve every other key. Never clobber an existing `"model"` value; if one is
already set, leave it as-is.

## CLAUDE.md section

Add this section to the project's `.claude/CLAUDE.md` (or root `CLAUDE.md` if the project has no
`.claude/CLAUDE.md` yet - append it, or create the file with a minimal header first):

```markdown
## Model delegation (token ring-fencing)

On architect sessions (Opus 5 is the default top tier; Fable 5 only by named exception), delegate implementation legwork to the `builder` subagent and exploration to `recon` (both pinned to Sonnet in `.claude/agents/`). The top-tier model writes briefs (read-first list, FIXED contracts, self-verification, report cap), reviews seams and security, and debugs live failures - it does not type implementations. Tune `effort` before switching tiers, and protect the prompt cache (continue sessions, do not switch models mid-session). Protocol + skeleton brief: `.claude/rules/model-delegation.md` (Cursor: `.cursor/rules/model-delegation.mdc`).
```

## Existing repos

Do not hand-apply this baseline to a repo that already exists - use
**`~/.claude/scripts/rollout-model-delegation.sh`** instead. There is no hand-written repo list:
scope is derived live from the org, so a repo created today is covered today. Pipe it in:

```bash
~/GitHub/agent-fleet/scripts/list-delegation-repos.sh \
  | ~/.claude/scripts/rollout-model-delegation.sh - --dry-run
```

Every non-archived, non-empty repo in the org is in scope. The only way one leaves is an explicit
line in `agent-fleet`'s `config/delegation-optout.txt` **with a reason next to it** - an exclusion
someone has to write down is one they will notice, and a silent exclusion is the exact failure this
system was built to catch. A weekly CI sweep (`agent-fleet`'s `delegation-drift` workflow) re-reads
every repo's remote tree and reports both drift and any new repo that has never been rolled out to.

It copies the same four files, appends the same
CLAUDE.md section (idempotently - skips repos that already have it), and merges the same
settings pin (never clobbering an existing `"model"` key or an unparseable settings file), then
commits and pushes directly to each repo's default branch, falling back to a
`chore/model-delegation` branch + PR when the push is rejected (branch protection or
permissions). Support `--dry-run` and `--limit N` for a safe preview before a real run.
