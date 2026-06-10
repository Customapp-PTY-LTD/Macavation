/**
 * Supabase settings for Node scripts and CLI apply tools (dev branch → UAT).
 */
import fs from 'fs';
import path from 'path';
import {
  PRODUCTION,
  getDevelopmentProject,
  assertAllowedProjectRef,
  assertAllowedSupabaseUrl,
  isBlockedProjectRef,
} from './supabase-projects.mjs';

export { PRODUCTION, assertAllowedProjectRef, assertAllowedSupabaseUrl, isBlockedProjectRef };
export { getDevelopmentProject, getAllowedProjectRefs } from './supabase-projects.mjs';

const devProject = getDevelopmentProject();

export const REQUIRED_PROJECT_REF = devProject.ref;
export const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || REQUIRED_PROJECT_REF;
export const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;
export const MCP_URL = `https://mcp.supabase.com/mcp?project_ref=${PROJECT_REF}`;

/** @deprecated use REQUIRED_PROJECT_REF — kept for scripts that still import the name */
export const MACAVATION_PRODUCTION_REF = PRODUCTION.ref;

export function readExpectedRemoteRef(repoRoot = process.cwd()) {
  const remoteToml = path.join(repoRoot, 'supabase', 'remote.toml');
  if (!fs.existsSync(remoteToml)) {
    throw new Error(`Missing ${path.relative(repoRoot, remoteToml)}`);
  }
  const content = fs.readFileSync(remoteToml, 'utf8');
  const match = content.match(/project_ref\s*=\s*"([^"]+)"/);
  if (!match) {
    throw new Error('supabase/remote.toml must define project_ref');
  }
  assertAllowedProjectRef(match[1]);
  return match[1];
}

export function verifyCliLinkedProject(repoRoot = process.cwd(), expectedRef = REQUIRED_PROJECT_REF) {
  assertAllowedProjectRef(expectedRef);
  const linkedPath = path.join(repoRoot, 'supabase', '.temp', 'linked-project.json');
  if (!fs.existsSync(linkedPath)) {
    console.warn(
      `WARN: Supabase CLI is not linked in this repo. Run: supabase link --project-ref ${expectedRef}`
    );
    return false;
  }
  const linked = JSON.parse(fs.readFileSync(linkedPath, 'utf8'));
  if (linked.ref !== expectedRef) {
    throw new Error(
      `CLI linked to ${linked.ref}, expected ${expectedRef}. Run: supabase link --project-ref ${expectedRef}`
    );
  }
  return true;
}

export function supabaseApiUrl(pathSuffix) {
  assertAllowedProjectRef(PROJECT_REF);
  return `https://api.supabase.com/v1/projects/${PROJECT_REF}${pathSuffix}`;
}

assertAllowedProjectRef(PROJECT_REF);
