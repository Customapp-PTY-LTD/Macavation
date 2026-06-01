/**
 * Canonical Macavation Supabase settings for Node scripts and CLI apply tools.
 */
import fs from 'fs';
import path from 'path';

export const REQUIRED_PROJECT_REF = 'sofanhfpxifgdtooefzq';
export const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || REQUIRED_PROJECT_REF;
export const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;
export const MCP_URL = `https://mcp.supabase.com/mcp?project_ref=${PROJECT_REF}`;

export const BLOCKED_PROJECT_REFS = ['iwxmuemrfopajwvqdiae'];

const BLOCKED_URL_PATTERNS = [
  /iwxmuemrfopajwvqdiae/i,
  /fruitlive/i,
];

export function assertMacavationProject(ref = PROJECT_REF) {
  if (ref !== REQUIRED_PROJECT_REF) {
    throw new Error(
      `Refusing non-Macavation Supabase project: ${ref}. Expected ${REQUIRED_PROJECT_REF}.`
    );
  }
  if (BLOCKED_PROJECT_REFS.includes(ref)) {
    throw new Error(`Refusing blocked FruitLive project ref: ${ref}`);
  }
}

export function assertMacavationSupabaseUrl(url) {
  const u = String(url || '');
  if (!u) return;
  if (!u.includes(REQUIRED_PROJECT_REF)) {
    throw new Error(
      `Supabase URL must target Macavation (${REQUIRED_PROJECT_REF}), not: ${u}`
    );
  }
  for (const pattern of BLOCKED_URL_PATTERNS) {
    if (pattern.test(u)) {
      throw new Error(`Supabase URL matches blocked pattern: ${u}`);
    }
  }
}

export function readExpectedRemoteRef(repoRoot = process.cwd()) {
  const remoteToml = path.join(repoRoot, 'supabase', 'remote.toml');
  if (!fs.existsSync(remoteToml)) {
    throw new Error(`Missing ${path.relative(repoRoot, remoteToml)}`);
  }
  const content = fs.readFileSync(remoteToml, 'utf8');
  const match = content.match(/project_ref\s*=\s*"([^"]+)"/);
  if (!match) {
    throw new Error('supabase/remote.toml must define project_ref = "sofanhfpxifgdtooefzq"');
  }
  assertMacavationProject(match[1]);
  return match[1];
}

export function verifyCliLinkedProject(repoRoot = process.cwd(), expectedRef = REQUIRED_PROJECT_REF) {
  assertMacavationProject(expectedRef);
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
  assertMacavationProject();
  return `https://api.supabase.com/v1/projects/${PROJECT_REF}${pathSuffix}`;
}

assertMacavationProject();
