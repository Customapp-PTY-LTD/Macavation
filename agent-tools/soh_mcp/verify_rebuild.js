const fs = require('fs');
const raw = fs.readFileSync(
  'c:/Users/walte/OneDrive/Documents/GitHub/Macavation/scripts/_soh_batches/mcp_chunks/chunk_0001.sql',
  'utf8'
);
const lines = raw.split(/\r?\n/);
const rebuilt = lines.join('\r\n') + (raw.endsWith('\n') || raw.endsWith('\r\n') ? '' : '');
console.log('eq', raw === rebuilt);
console.log('len', raw.length, rebuilt.length);
