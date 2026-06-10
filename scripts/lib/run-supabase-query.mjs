/**
 * Run SQL on the linked Supabase project via CLI (Windows-safe: uses --file).
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

export function runLinkedQuery(sql, repoRoot = process.cwd()) {
  const tmp = path.join(os.tmpdir(), `macavation-query-${Date.now()}.sql`);
  fs.writeFileSync(tmp, sql.trim() + '\n', 'utf8');
  try {
    const result = spawnSync(
      'npx',
      ['--yes', 'supabase@latest', 'db', 'query', '--linked', '-o', 'json', '--file', tmp],
      { cwd: repoRoot, encoding: 'utf8', shell: process.platform === 'win32' }
    );
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || 'Supabase query failed');
    }
    const text = (result.stdout || '').replace(/^\uFEFF/, '').trim();
    if (!text) return { rows: [] };
    return JSON.parse(text);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}
