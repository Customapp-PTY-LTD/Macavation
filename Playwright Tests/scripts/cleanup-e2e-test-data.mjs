/**
 * Remove disposable data created by Playwright E2E runs (demo / any environment).
 *
 * Usage (from Playwright Tests/):
 *   node scripts/cleanup-e2e-test-data.mjs
 *
 * Env (optional, from .env.e2e):
 *   LAMBDA_PROXY_URL, CLIENT_GUID, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD
 *   SUPABASE_URL + SUPABASE_SERVICE_KEY — also purges auth users e2e.*@test.macavation.co.za
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env.e2e') });

const LAMBDA_BASE =
  (process.env.LAMBDA_PROXY_URL || 'https://rzrx6ntfejvb6lxpmt4ywruvt40mjjuo.lambda-url.af-south-1.on.aws/proxy/function')
    .replace(/\/proxy\/function\/?$/, '');
const PROXY_FUNCTION = `${LAMBDA_BASE}/proxy/function`;
const CLIENT_GUID = process.env.CLIENT_GUID || '9e1d961a-bfc2-469d-8526-8af75f536656';
const ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'kishan@customapp.co.za';
const ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'Testing123$';

function asArray(raw, ...keys) {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return [];
  for (const k of keys) {
    if (Array.isArray(raw[k])) return raw[k];
  }
  if (Array.isArray(raw.data)) return raw.data;
  if (Array.isArray(raw.result)) return raw.result;
  if (Array.isArray(raw.body)) return raw.body;
  return [];
}

async function login() {
  const res = await fetch(`${LAMBDA_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: 'email',
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      client_unique_guid: CLIENT_GUID,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.message || body.error || `Login failed HTTP ${res.status}`);
  }
  if (!body.token) throw new Error('Login response missing token');
  return body.token;
}

async function callFn(token, name, params = {}) {
  const res = await fetch(PROXY_FUNCTION, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ function: name, params }),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${name}: invalid JSON (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new Error(`${name}: ${data.message || data.error || res.status}`);
  }
  return data;
}

function isE2eUser(u) {
  const email = (u.email || '').toLowerCase();
  const username = (u.username || '').toLowerCase();
  return (
    email.includes('@test.macavation.co.za') ||
    email.startsWith('e2e.') ||
    username.startsWith('e2e_') ||
    (u.first_name === 'E2E' && (u.last_name || '').startsWith('Grower'))
  );
}

function isE2eContact(c) {
  const company = (c.company_name || '').trim();
  const email = (c.primary_contact_email || c.email || '').toLowerCase();
  const notes = (c.notes || '').toLowerCase();
  return (
    company.startsWith('E2E') ||
    email.startsWith('e2e.') ||
    notes.includes('e2e test')
  );
}

function isE2eRole(r) {
  const name = (r.role_name || r.name || '').trim();
  const desc = (r.description || '').toLowerCase();
  return name.startsWith('E2E Test Role') || desc.includes('e2e test');
}

function isE2eBatch(b) {
  const num = (b.batch_number || b.batch_code || '').toUpperCase();
  return num.includes('-E2E-') || num.startsWith('KB-E2E') || num.startsWith('OB-E2E') || num.startsWith('SAMP-E2E');
}

function isE2eDispatchOrder(o) {
  const buyer = (o.buyer_name || '').trim();
  return buyer === 'E2E Test Buyer';
}

async function cleanupSupabaseAuthUsers() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.log('  (skip Supabase auth purge — SUPABASE_URL / SUPABASE_SERVICE_KEY not set)');
    return 0;
  }
  const supabase = createClient(url, key);
  const { data: rows, error } = await supabase.from('users').select('id, email').ilike('email', 'e2e.%@test.macavation.co.za');
  if (error) {
    console.warn('  Supabase users query:', error.message);
    return 0;
  }
  let n = 0;
  for (const row of rows || []) {
    const { error: delErr } = await supabase.auth.admin.deleteUser(row.id);
    if (delErr) console.warn('  auth.admin.deleteUser', row.email, delErr.message);
    else n++;
  }
  const { error: pubErr } = await supabase.from('users').delete().ilike('email', 'e2e.%@test.macavation.co.za');
  if (pubErr) console.warn('  public.users delete:', pubErr.message);
  return n;
}

async function main() {
  console.log('E2E cleanup — logging in as', ADMIN_EMAIL);
  const token = await login();
  const stats = { users: 0, contacts: 0, roles: 0, kernelBatches: 0, oilBatches: 0, dispatchOrders: 0, supabaseAuth: 0 };

  const users = asArray(await callFn(token, 'get_users', {}), 'get_users');
  for (const u of users) {
    if (!isE2eUser(u)) continue;
    const id = u.id || u.user_id;
    if (!id) continue;
    try {
      await callFn(token, 'delete_user_hard', { p_user_id: id });
      stats.users++;
      console.log('  deleted user', u.email || id);
    } catch (e) {
      try {
        await callFn(token, 'deactivate_user', { p_user_id: id });
        stats.users++;
        console.log('  deactivated user', u.email || id);
      } catch (e2) {
        console.warn('  user', u.email, e2.message);
      }
    }
  }

  const contacts = asArray(await callFn(token, 'get_contacts', {}), 'get_contacts');
  for (const c of contacts) {
    if (!isE2eContact(c)) continue;
    const id = c.id || c.contact_id;
    if (!id) continue;
    try {
      await callFn(token, 'deactivate_contact', { p_contact_id: id });
      stats.contacts++;
      console.log('  deactivated contact', c.company_name || id);
    } catch (e) {
      console.warn('  contact', c.company_name, e.message);
    }
  }

  const roles = asArray(await callFn(token, 'get_roles', {}), 'get_roles');
  for (const r of roles) {
    if (!isE2eRole(r)) continue;
    const id = r.id || r.role_id;
    if (!id) continue;
    try {
      await callFn(token, 'deactivate_role', { p_id: id });
      stats.roles++;
      console.log('  deactivated role', r.role_name || id);
    } catch (e) {
      console.warn('  role', r.role_name, e.message);
    }
  }

  try {
    const kernels = asArray(await callFn(token, 'get_kernel_batches', {}), 'get_kernel_batches');
    for (const b of kernels) {
      if (!isE2eBatch(b)) continue;
      const id = b.id || b.kernel_id;
      if (!id) continue;
      try {
        await callFn(token, 'deactivate_kernel_batch', { p_kernel_id: id });
        stats.kernelBatches++;
        console.log('  deactivated kernel batch', b.batch_number || id);
      } catch (e) {
        console.warn('  kernel batch', b.batch_number, e.message);
      }
    }
  } catch (e) {
    console.warn('  get_kernel_batches:', e.message);
  }

  try {
    const oils = asArray(await callFn(token, 'get_oil_batches', {}), 'get_oil_batches');
    for (const b of oils) {
      if (!isE2eBatch(b)) continue;
      const id = b.id || b.oil_id;
      if (!id) continue;
      try {
        await callFn(token, 'deactivate_supplier_intake_oil_batch', { p_oil_id: id });
        stats.oilBatches++;
        console.log('  deactivated oil batch', b.batch_number || id);
      } catch (e) {
        console.warn('  oil batch', b.batch_number, e.message);
      }
    }
  } catch (e) {
    console.warn('  get_oil_production_batches:', e.message);
  }

  try {
    const orders = asArray(await callFn(token, 'get_kernel_dispatch_orders', { p_limit: 500, p_offset: 0 }), 'get_kernel_dispatch_orders');
    for (const o of orders) {
      if (!isE2eDispatchOrder(o)) continue;
      console.log('  (dispatch order with E2E buyer — deactivate manually if needed)', o.id, o.buyer_name);
      stats.dispatchOrders++;
    }
  } catch (e) {
    console.warn('  get_kernel_dispatch_orders:', e.message);
  }

  stats.supabaseAuth = await cleanupSupabaseAuthUsers();

  console.log('\nCleanup summary:', stats);
  const total = Object.values(stats).reduce((a, b) => a + b, 0);
  if (total === 0) console.log('No matching E2E records found (or already removed).');
}

main().catch((err) => {
  console.error('Cleanup failed:', err.message);
  process.exit(1);
});
