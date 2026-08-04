# scripts/archive/

This directory holds one-off MCP apply artifacts relocated out of the canonical `migrations/`
directory (`_mcp_manual_oil.json` and `_mcp_apply_chunks_soh/`). They are kept for the historical
record only.

Nothing in `package.json` or `.github/` reads anything in this directory. No script was archived
here — this directory contains relocated MCP artifacts only, not archived scripts.

New migration work should use `npm run db:apply -- migrations/<file>.sql`.
