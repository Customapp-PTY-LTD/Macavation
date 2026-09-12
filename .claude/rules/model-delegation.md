# Model delegation - ring-fencing top-tier tokens

Cursor: `.cursor/rules/model-delegation.mdc`

Proven split (claim-report pipeline, 12 Jul 2026): four Sonnet agents did ~810k tokens of
implementation; the architect session spent roughly a tenth of that on specs, seam review, one
security fix, and verification. The ratio comes from discipline, not a switch.

**Read that as a TOKEN ratio, not a cost ratio.** Sonnet 5 is $2/$10 against Opus 5's $5/$25 -
2.5x, not 10x - and Sonnet 5 emits roughly 30% more tokens than Sonnet 4.5 for the same text, so a
per-token price cut does not translate 1:1 into a cheaper delegation. Judge **cost per completed
task**, not per token: a cheaper agent that needs three rounds to land the work is not cheaper.
The bigger saving is not the rate at all - it is that a file read inside a throwaway subagent is
paid for once, where the same file read into the architect's own window is re-paid on every
subsequent turn for the rest of the session. Context isolation IS the cost mechanism; the cheaper
rate is a bonus on top of it.

## The split

| Tier | Does | Does NOT |
|---|---|---|
| **Opus 5** (architect - the default top tier) | Exploration synthesis, architecture decisions, writing briefs, seam + security review, debugging weird failures, deploy go/no-go, user-facing narrative | Type implementations, re-read agent output wholesale, mechanical edits |
| **Fable 5.1** (`claude-fable-5-1`, named exception only) | Genuinely frontier reasoning: multi-hour autonomous runs, debugging that already defeated Opus 5, work where correctness beats cost outright | Routine architecture, review passes, anything Opus 5 has not visibly failed at |
| **Sonnet 5** (`builder`, `recon` in `.claude/agents/`) | Implementation from a brief, fan-out recon, docs from a spec, self-verification | Renegotiate contracts, explore beyond the read-first list, commit/deploy |
| **Haiku 4.5** | Genuinely mechanical transforms only | Anything touching this repo's conventions. It also **rejects `output_config.effort`** (400) and holds **200K context**, not the 1M the others have - so "tune effort before tier" below does not apply to it |

**Default an architect session to Opus 5 and tune `effort`; default delegated work to Sonnet.**
This reverses the rule's original advice ("default to Sonnet, escalate with `/model`"), which
fought the caching section below: escalating for stuck debugging is by definition something you
discover mid-session, and `/model` mid-session discards the prefix you already paid to write.
Choosing the tier when you OPEN a session costs nothing, because no cache exists yet.

**The repo still pins `"sonnet"` in `.claude/settings.json`, and that is not a contradiction.** A
pin is a DEFAULT, not a lock: `/model` at session start overrides it for free. So the pin governs
the sessions nobody thought about, and this rule governs the ones you did. Unchosen work skews
trivial, which is why the cheap tier belongs on that path - pinning the dear tier would put it
exactly where no one is paying attention. Open an architect session on Opus deliberately; let
everything else start cheap.

When you do discover mid-session that you need more, in this order:

1. **Raise `effort`.** On Opus 5 a per-message effort change does not reset the cache
   (`mid-conversation-output-config-2026-07-01`); a top-level one does. Not available on Sonnet 5.
2. **Spawn a subagent** on the tier you need. Its context is separate, so your prefix survives.
3. **`/model`** only when the problem warrants paying for a fresh prefix. Say so out loud when you
   do - escalation is sticky, and a session escalated for one hard problem stays escalated for the
   next twenty easy ones.

On an architect session, delegate all legwork - including recon (use the `recon` agent; plain
exploration inherits the session model and burns top-tier tokens on reading).

**Fable is not the default architect tier, and "Fable / Opus" is not one tier.** Prices are per
MTok, checked 2026-09-12 - re-check before quoting them, they move. Fable 5.1 is $10/$50 against
Opus 5's $5/$25: 2x on output and on cache writes, the line item that dominates fan-out work. **But
not on every line item** - Fable 5.1 cache reads are $0.25/MTok against Opus 5's $0.50, so on a
long cache-read-heavy session Fable's input is the cheaper of the two. Quote the line item, not
"twice the price". Reach for Fable by naming the reason in the session, not by habit - and if the
reason is "this is hard", try `effort: xhigh` on Opus 5 first.

## Effort before tier

`output_config.effort` (`low` / `medium` / `high` / `xhigh` / `max`, **default `high`**) did not
meaningfully exist when this rule was first written. It is now the first lever to reach for - it is
cheaper than a tier switch, and it is the only one of the two that has a cache-free form.

- **Tune effort before switching models.** Opus 5 at `low`/`medium` covers much of what used to
  justify dropping to Sonnet; `xhigh` covers much of what used to justify escalating past Opus.
  You are starting from `high` unless you set it, so "raise the effort" is often really "lower it".
- **Changing effort mid-session is not automatically free.** A top-level effort change invalidates
  the messages cache. The per-message form does not, and exists on Opus 5 and Fable 5.1
  (`mid-conversation-output-config-2026-07-01`) - **but not on Sonnet 5**, which is one more reason
  an architect session defaults to Opus rather than Sonnet.
- Recon, fan-out, and mechanical subagents: **`low`**.
- Coding and agentic work: **`high` or `xhigh`** (`xhigh` is the sweet spot for most of it).
- **`max`** only when correctness genuinely beats cost.
- Effort cannot fix a price tier, and does not exist at all on Haiku 4.5. A $10/$50 base rate is
  not effort-tunable - that stays a tier decision.

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
  you already paid to write. Spawn a subagent on the cheaper model instead - a subagent carries its
  own context, so your prefix is untouched. (Do not confuse this with the "a multi-model cascade
  forfeits cache reuse" warning: that is about routing ONE conversation through several models.
  Delegating to a subagent is not that, and costs your session's cache nothing.)
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
anyone's intuition - only in the bill. **`amount` in that report is in CENTS** - summing it as
dollars once produced a figure 100x too high and three PRs were built on it before anyone
sanity-checked the magnitude.

**Two places an automated model choice actually hides in a repo like this**, both outside the tier
table above and neither visible in a session:

- **`.claude/settings.json` hooks.** A hook entry can carry its own `"model"`, firing on an event
  (a `PreToolUse` on `ExitPlanMode`, say) on every developer's machine, forever. Grep your own
  settings for `"model"` and count what you find.
- **The `"model"` pin at the top of `.claude/settings.json`** is your interactive default and
  nothing else, as of `agent-fleet` #321 (2026-09-12). It used to be read by Agent Fleet as the
  **engine model for every run in this repo** - one knob serving both humans and every unattended
  run, so retuning it for yourself silently retuned fleet spend. `resolveModel()` no longer reads
  it. If you find a doc still claiming that coupling, it predates #321.

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
- unicode-dash scan on every touched file comes back clean (ASCII hyphens rule). Use this
  repo's own dash-lint script if it defines one - CHECK `package.json` rather than assuming,
  most repos here do not have one. Otherwise run, and expect no output:
  `perl -ne 'print "$ARGV:$.: $_" if /[\x{2010}-\x{2015}]/' <touched files>

Return: files created, verification output, key decisions, deviations with reasons. Under 30 lines.
```
