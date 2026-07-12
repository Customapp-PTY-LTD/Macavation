# Macavation

Instructions for Claude Code in this repo.

## Model delegation (token ring-fencing)

On Fable/Opus sessions, delegate implementation legwork to the `builder` subagent and exploration to `recon` (both pinned to Sonnet in `.claude/agents/`). The top-tier model writes briefs (read-first list, FIXED contracts, self-verification, report cap), reviews seams and security, and debugs live failures - it does not type implementations. Protocol + skeleton brief: `.claude/rules/model-delegation.md` (Cursor: `.cursor/rules/model-delegation.mdc`).
