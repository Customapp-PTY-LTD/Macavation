# Customapp-PTY-LTD/Macavation

## Agent Fleet

To run, submit, or hand off a plan to the dev agents, follow the rule in
`.claude/rules/agent-fleet-submit.md` - it covers the 330-minute plan-size check and the push-to-dev-agent flow.

## Git hygiene (multi-actor)

Fleet runs, Cursor, and Claude Code sessions all land commits on this repo. Before ANY git
operation here, follow `.claude/rules/git-hygiene.md` - fetch-first branching, one actor per
worktree, no direct commits on the base branch, and the stuck-local-dev rescue.