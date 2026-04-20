const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'all_82_chunks.sql'), 'utf8');
const maxBytes = 25000;
const outDir = path.join(__dirname, 'exec_segments');
fs.mkdirSync(outDir, { recursive: true });

const parts = src.split(/(?<=;\r\n)(?=INSERT INTO)/).filter(Boolean);
let buf = '';
let idx = 0;
for (const p of parts) {
  const next = buf + p;
  if (next.length > maxBytes && buf.length > 0) {
    idx++;
    fs.writeFileSync(path.join(outDir, `seg_${String(idx).padStart(3, '0')}.sql`), buf, 'utf8');
    buf = p;
  } else {
    buf = next;
  }
}
if (buf.length) {
  idx++;
  fs.writeFileSync(path.join(outDir, `seg_${String(idx).padStart(3, '0')}.sql`), buf, 'utf8');
}
console.log('segments', idx);
