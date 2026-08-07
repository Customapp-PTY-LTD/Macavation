# Model delegation - ring-fencing top-tier tokens

Cursor: `.cursor/rules/model-delegation.mdc`

Proven split (claim-report pipeline, 12 Jul 2026): four Sonnet agents did ~810k tokens of
implementation; the architect session spent roughly a tenth of that on specs, seam review, one
security fix, and verification. The ratio comes from discipline, not a switch.

## The split

| Tier | Does | Does NOT |
|---|---|---|
| **Opus 5** (architect - the default top tier) | Exploration synthesis, architecture decisions, writing briefs, seam + security review, debugging weird failures, deploy go/no-go, user-facing narrative | Type implementations, re-read agent output wholesale, mechanical edits |
| **Fable 5** (named exception only) | Genuinely frontier reasoning: multi-hour autonomous runs, debugging that already defeated Opus 5, work where correctness beats cost outright | Routine architecture, review passes, anything Opus 5 has not visibly failed at |
| **Sonnet 5** (`builder`, `recon` in `.claude/agents/`) | Implementation from a brief, fan-out recon, docs from a spec, self-verification | Renegotiate contracts, explore beyond the read-first list, commit/deploy |
| **Haiku** | Genuinely mechanical transforms only | Anything touching this repo's conventions |

Default the session to Sonnet; escalate deliberately (`/model`) for design, security,
cross-component work, and stuck debugging. On an architect session, delegate all legwork -
including recon (pass `model: sonnet` or use the `recon` agent; exploration inherits the session
model otherwise and burns top-tier tokens on reading).

**Fable is not the default architect tier, and "Fable / Opus" is not one tier.** Fable is roughly
twice Opus 5's price ($10/$50 per MTok against $5/$25), and Opus 5 is the documented default top
tier. Treating the two as interchangeable is how a shop ends up with most of its bill on the
dearest model without anyone having decided to. Reach for Fable by naming the reason in the
session, not by habit - and if the reason is "this is hard", try `effort: xhigh` on Opus 5 first.

**Say which tier you are on when it matters.** Escalation is one keystroke and it is sticky: a
session escalated for one hard problem stays escalated for the next twenty easy ones. That drift
is invisible unless someone says it out loud.

## Effort before tier

`output_config.effort` (`low` / `medium` / `high` / `xhigh` / `max`) did not meaningfully exist
when this rule was first written. It is now the first lever to reach for - it is cheaper than a
tier switch and, unlike one, it does not throw away the prompt cache.

- **Tune effort before switching models.** Opus 5 at `low`/`medium` covers much of what used to
  justify dropping to Sonnet; `xhigh` covers much of what used to justify escalating past Opus.
- Recon, fan-out, and mechanical subagents: **`low`**.
- Coding and agentic work: **`high` or `xhigh`** (`xhigh` is the sweet spot for most of it).
- **`max`** only when correctness genuinely beats cost.
- Effort cannot fix a price tier. A $10/$50 base rate is not effort-tunable - that stays a tier
  decision.

## Caching - often the biggest line item, and the easiest to waste

Cache reads cost ~0.1x base input; cache **writes** cost 1.25x (5-minute TTL) or 2x (1-hour). On a
long session the prefix is re-read every call and only the delta is written, so a healthy
read:write **token** ratio is roughly 15-30:1. Ratios near 1:1 mean prefixes are being rewritten
instead of reused - and on a top-tier model that is frequently the single largest thing on the
bill, dwarfing anything the brief-writing discipline below can save.

- **Continue sessions; do not restart them.** A fresh session rewrites the whole prefix. Any
  workload that spawns a new session per unit of work pays a cache write every time and never
  gets a read.
- **Do not switch models mid-session.** Caches are model-scoped, so `/model` discards the cache
  you already paid to write. Spawn a subagent on the cheaper model instead.
- **Keep the prefix frozen.** Any byte change invalidates everything after it - including editing
  `CLAUDE.md` or a rules file mid-session. Put volatile context late, never early.
- **Think-time between turns expires a 5-minute cache.** For long-running work prefer the 1-hour
  TTL where the harness exposes it.
- Check `usage.cache_read_input_tokens` against `cache_creation_input_tokens` before theorising.
  If reads are not far ahead of writes, one of the above is happening.

## Brief anatomy (every delegation includes all six)

1. **Context** - what/why in 3-5 sentences, including what other agents are building in
   parallel.
2. **Read-first list** - exact files AND line ranges ("0352 lines 1270-1560"), nothing
   open-ended. This is the single biggest token lever: a vague brief makes the cheap model
   re-derive context, badly.
3. **FIXED contracts** - interfaces between parallel agents, marked "do not renegotiate"
   (request/response shapes, header names, column lists, status values). Parallel agents code
   against contracts before the counterpart files exist.
4. **Deliverables with acceptance criteria** - enumerated files, each with what "done" means.
5. **Verify before finishing** - the exact commands (tests, `deno check`, dash grep) the agent
   must run and pass before reporting.
6. **Report cap + explicit don'ts** - "under 30 lines, deviations with reasons"; no commit, no
   deploy, no DB writes unless stated.

## Review discipline (architect side)

- **Review seams, not surfaces.** Grep the contract joints (header names, param shapes,
  grants); do not re-read whole files. The defects live where work joins - including in your
  own briefs (the one real security hole found in the pipeline build was in the architect's
  spec, flagged by the builder, caught in seam review).
- **Deviations sections are the escalation channel.** Read them first; they carry the
  real-world facts the brief got wrong (deprecated runtimes, version pins, name collisions).
- Keep parallel agents in **disjoint directories**; sequence anything that shares files.

## Never economize on

Security-adjacent changes, anything crossing more than two components, deploy decisions, and
debugging where the symptom lies. These are cheap in tokens and are exactly where top-tier
judgment pays (example: a PDF that "looked corrupted" was actually puppeteer >=22 returning
Uint8Array where Playwright returns Buffer - a driver-API difference, not data corruption).

## Measure, or this rule is decoration

This rule has no enforcement surface. The model pin is only a default, `/model` overrides it
silently, and nothing bills a session back to the decision that made it expensive. The only thing
that keeps it honest is looking at the spend.

Read the Anthropic Admin cost report periodically (`/v1/organizations/cost_report`, grouped by
description) and ask three questions: what share is on the top tier, are cache writes running
ahead of cache reads, and does any **automated** workload run a dearer model than anyone
remembers choosing. That last one matters most: an unattended job that invokes a frontier model on
every trigger will quietly outspend every human in the company, and it will not show up in
anyone's intuition - only in the bill.

## Skeleton brief

```
You are implementing <X> in repo <path> (branch <b> checked out - work in place, do NOT commit).

## Context
<3-5 sentences. What, why, what the parallel agents build, whose contracts are fixed.>

## Read first (these exact files/ranges, nothing more)
- <file> lines <a-b>  (<why>)

## FIXED contracts (do not renegotiate)
- <interface>: <exact shape>

## Deliverables
1. <file> - <what it must do; acceptance criteria>

## Verify before finishing
- <command> passes
- unicode-dash scan on every touched file comes back clean (ASCII hyphens rule - use the
  same grep as `npm run lint:dashes`; do not write the two dash characters into this brief)

Return: files created, verification output, key decisions, deviations with reasons. Under 30 lines.
```
