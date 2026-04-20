const fs = require('fs');
const raw = fs.readFileSync(
  'c:/Users/walte/OneDrive/Documents/GitHub/Macavation/scripts/_soh_batches/mcp_chunks/chunk_0001.sql',
  'utf8'
);
// Split like "lines of content" without line endings
const parts = raw.split(/\r?\n/);
// If file ends with newline, split gives trailing ''
const rebuilt = parts.join('\r\n');
const ok = raw === rebuilt || raw === rebuilt + '\r\n' || raw === rebuilt + '\n' || raw === rebuilt + '\r\n\n';
console.log({ ok, rawLen: raw.length, rebuiltLen: rebuilt.length, lastRaw: JSON.stringify(raw.slice(-5)) });
