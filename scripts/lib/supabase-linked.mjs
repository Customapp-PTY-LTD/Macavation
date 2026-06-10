/**
 * Point Supabase CLI at production or UAT via supabase/.temp/linked-project.json.
 */
import fs from 'fs';
import path from 'path';
import { PRODUCTION, UAT } from './supabase-projects.mjs';

const TEMP_DIR_SEGMENTS = ['supabase', '.temp'];

function tempDir(repoRoot = process.cwd()) {
  return path.join(repoRoot, ...TEMP_DIR_SEGMENTS);
}

export function linkedProjectPath(repoRoot = process.cwd()) {
  return path.join(tempDir(repoRoot), 'linked-project.json');
}

export function projectRefPath(repoRoot = process.cwd()) {
  return path.join(tempDir(repoRoot), 'project-ref');
}

export function readLinkedRef(repoRoot = process.cwd()) {
  const p = linkedProjectPath(repoRoot);
  if (!fs.existsSync(p)) return null;
  const linked = JSON.parse(fs.readFileSync(p, 'utf8'));
  return linked.ref || null;
}

export function setLinkedRef(ref, repoRoot = process.cwd()) {
  const project =
    ref === PRODUCTION.ref
      ? { ref: PRODUCTION.ref, name: PRODUCTION.name }
      : ref === UAT.ref
        ? { ref: UAT.ref, name: UAT.name }
        : null;
  if (!project) {
    throw new Error(`Unknown Supabase project ref: ${ref}`);
  }
  const p = linkedProjectPath(repoRoot);
  const existing = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
  fs.writeFileSync(
    p,
    JSON.stringify(
      {
        ...existing,
        ref: project.ref,
        name: project.name,
      },
      null,
      2
    ) + '\n',
    'utf8'
  );
  fs.writeFileSync(projectRefPath(repoRoot), project.ref + '\n', 'utf8');
  // Do not overwrite pooler-url — Supabase CLI sets IPv4 pooler details on `supabase link`.
}

export function setLinkedProduction(repoRoot = process.cwd()) {
  setLinkedRef(PRODUCTION.ref, repoRoot);
}

export function setLinkedUat(repoRoot = process.cwd()) {
  setLinkedRef(UAT.ref, repoRoot);
}
