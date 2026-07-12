# Model delegation - ring-fencing top-tier tokens

Cursor: `.cursor/rules/model-delegation.mdc`

Proven split (claim-report pipeline, 12 Jul 2026): four Sonnet agents did ~810k tokens of
implementation; the Fable session spent roughly a tenth of that on specs, seam review, one
security fix, and verification. The ratio comes from discipline, not a switch.

## The split

| Tier | Does | Does NOT |
|---|---|---|
| **Fable / Opus** (architect) | Exploration synthesis, architecture decisions, writing briefs, seam + security review, debugging weird failures, deploy go/no-go, user-facing narrative | Type implementations, re-read agent output wholesale, mechanical edits |
| **Sonnet** (`builder`, `recon` in `.claude/agents/`) | Implementation from a brief, fan-out recon, docs from a spec, self-verification | Renegotiate contracts, explore beyond the read-first list, commit/deploy |
| **Haiku** | Genuinely mechanical transforms only | Anything touching this repo's conventions |

Default the session to Sonnet; escalate to Fable deliberately (`/model`) for design, security,
cross-component work, and stuck debugging. On a Fable session, delegate all legwork - including
recon (pass `model: sonnet` or use the `recon` agent; exploration inherits the session model
otherwise and burns top-tier tokens on reading).

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
