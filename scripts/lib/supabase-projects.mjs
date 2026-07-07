/**
 * Canonical Supabase project definitions (production + dev).
 * There are exactly two environments: production (prod site only) and dev
 * (localhost, dev site, everything else). See supabase/remote.toml.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', '..');
const projectsPath = path.join(root, 'supabase', 'projects.json');

const raw = JSON.parse(fs.readFileSync(projectsPath, 'utf8'));

export const PRODUCTION = raw.production;
export const DEV = raw.dev || raw.uat;
/** @deprecated use DEV — kept for scripts that still import UAT */
export const UAT = DEV;
export const DEVELOPMENT_TARGET = raw.developmentTarget || 'dev';
export const BLOCKED_PROJECT_REFS = raw.blockedRefs || ['iwxmuemrfopajwvqdiae'];

const TARGET_BY_NAME = {
  production: PRODUCTION,
  dev: DEV,
  uat: DEV,
};

export function getProjectByName(name) {
  const project = TARGET_BY_NAME[name];
  if (!project) {
    throw new Error(`Unknown Supabase project name: ${name}`);
  }
  return project;
}

export function getDevelopmentProject() {
  return getProjectByName(DEVELOPMENT_TARGET);
}

export function getAllowedProjectRefs() {
  return [PRODUCTION.ref, DEV.ref];
}

export function isBlockedProjectRef(ref) {
  return BLOCKED_PROJECT_REFS.includes(ref);
}

export function assertAllowedProjectRef(ref) {
  if (isBlockedProjectRef(ref)) {
    throw new Error(`Refusing blocked Supabase project ref: ${ref}`);
  }
  if (!getAllowedProjectRefs().includes(ref)) {
    throw new Error(
      `Refusing unknown Supabase project ref: ${ref}. Allowed: ${getAllowedProjectRefs().join(', ')}`
    );
  }
}

export function assertAllowedSupabaseUrl(url) {
  const u = String(url || '');
  if (!u) return;
  for (const blocked of BLOCKED_PROJECT_REFS) {
    if (u.includes(blocked)) {
      throw new Error(`Supabase URL points at blocked project (${blocked}): ${u}`);
    }
  }
  const allowed = getAllowedProjectRefs().some((ref) => u.includes(ref));
  if (!allowed) {
    throw new Error(
      `Supabase URL must target Macavation production or UAT (${getAllowedProjectRefs().join(', ')}), not: ${u}`
    );
  }
}

export function anonKeyMatchesProject(anonKey, projectRef) {
  if (!anonKey || !projectRef) return false;
  const parts = String(anonKey).split('.');
  if (parts.length < 2) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload.ref === projectRef;
  } catch {
    return String(anonKey).includes(projectRef);
  }
}
