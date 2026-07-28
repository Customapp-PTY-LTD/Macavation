# Multi-actor git hygiene (firm rules)

Apply these to every git operation in this repo. Agent Fleet runs, Cursor sessions, and other
Claude Code sessions can all merge to `dev` while you work — a stale local `dev` has already
caused a near-regression (2026-07-21). These rules are non-negotiable:

1. **Always `git fetch` first and branch from `origin/dev`, never local `dev`.** Rebase onto
   `origin/dev` immediately before opening a PR.
2. **One actor per working tree.** If another session or tool may be working in this clone,
   do your implementation work in a dedicated git worktree instead of the shared directory.
3. **Never commit directly on `dev`.** This repo is fleet-enabled (it has a `dev-agent`
   branch) and its `dev` is protected: direct pushes are rejected (`GH013`) — that is the
   guardrail working, not an error to retry or force. Branch → PR → merge (no review
   approvals required; the PR itself is the record).
4. **Never push to an existing remote branch name you didn't create this session.** Check
   `git ls-remote origin <name>` when unsure.

**If commits are stuck on local `dev`** (made before these rules, now rejected on push):

```bash
git branch rescue/dev-work        # save the commits onto a branch (nothing is lost)
git fetch origin
git checkout dev && git reset --hard origin/dev   # local dev matches GitHub again
```

Then open a PR from `rescue/dev-work` (or cherry-pick onto a fresh branch). NOTE:
`reset --hard` discards UNCOMMITTED changes — commit or stash before running it.

## Wrong-identity guard (gh / git tokens)

Before any repo-mutating `gh` or git operation, know WHO you are: `gh auth status` (or
`gh api user --jq .login`). If a `GH_TOKEN`/`GITHUB_TOKEN` env var is set, it OVERRIDES
keyring login - a limited machine token (e.g. a CI account) will 404 on repos a human can
plainly see in the browser, producing misleading "not found"/"branch missing" errors.
When that happens, do not chase the phantom error; retry as the human identity:
`env -u GH_TOKEN -u GITHUB_TOKEN <command>`. Never push/commit as a machine identity when
the work should be attributed to the developer (fleet notifications key off the author).
