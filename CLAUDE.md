# Macavation

Instructions for Claude Code in this repo.

## Model delegation (token ring-fencing)

On architect sessions (Opus 5.5 is the default top tier; Fable 5.2 only by named exception, at roughly twice the price), delegate implementation legwork to the `builder` subagent and exploration to `recon` (both pinned to Sonnet in `.claude/agents/`). The top-tier model writes briefs (read-first list, FIXED contracts, self-verification, report cap), reviews seams and security, and debugs live failures — it does not type implementations. Tune `effort` before switching tiers, and protect the prompt cache: continue sessions rather than restarting them, and never switch models mid-session (caches are model-scoped). Protocol + skeleton brief: `.claude/rules/model-delegation.md` (Cursor: `.cursor/rules/model-delegation.mdc`).
