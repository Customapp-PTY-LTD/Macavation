/**
 * A proof of delivery sent to the Macavation WhatsApp number (Henry, 18 Nov 2026).
 *
 * Who: an enrolled staff member whose role holds grower.intake.create. Anyone else's photo is
 * stored as before (placeholder body) and gets no reply - the same silence rule as every other
 * unrecognised message in this function.
 *
 * What happens:
 *   1. "Reading your proof of delivery..." is sent straight away.
 *   2. The photo / PDF is downloaded from Control Room (get_media - the Meta token stays there).
 *   3. ../_shared/pod-reader.ts reads it (the same reader as the portal's "Read the proof of
 *      delivery" button), given our supplier / transporter / transport type names.
 *   4. The file goes to the same file store the portal's Supporting Documents use.
 *   5. One row in intake_pod_inbox (migrations/20261118130000_intake_pod_inbox.sql), which Grower
 *      Intake lists as "POD received on WhatsApp" with a Book in button.
 *   6. A reply with what was read.
 * Nothing creates a batch: a person books it in from the portal and checks it there.
 *
 * Every step degrades: a missing migration, a failed download or upload, or the AI failing gets a
 * plain reply telling the person to book it in by hand. Never throws.
 */
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { podClient, readPod } from '../_shared/pod-reader.ts';

// deno-lint-ignore no-explicit-any
type Any = any;

export const POD_ACTION_KEY = 'grower.intake.create';
const MAX_BYTES = 8 * 1024 * 1024;
const FILE_UPLOAD_URL = 'https://yzz5sh6s74.execute-api.af-south-1.amazonaws.com/v1/fileupload';
const DOC_FOLDER = 'Macavation/Deliveries';
const POD_MIME = new Set(['image/jpeg', 'image/png', 'application/pdf']);

export interface PodDeps {
  sb: SupabaseClient;
  phone: string;
  wamid: string;
  userId: string;
  displayName: string;
  /** Control Room meta-proxy URL and signing (the same ones every reply uses). */
  metaProxyUrl: string;
  hmacHex: (secret: string, body: string) => Promise<string>;
  sendText: (to: string, text: string) => Promise<boolean>;
}

/** The media part of an inbound image / document message, or null when it is not one we read. */
export function podMediaOf(msg: Any): { mediaId: string; mimeType: string; fileName: string } | null {
  const type = String(msg?.type ?? '');
  if (type !== 'image' && type !== 'document') return null;
  const m = msg?.[type] || {};
  const mediaId = String(m?.id ?? '').trim();
  const mimeType = String(m?.mime_type ?? (type === 'image' ? 'image/jpeg' : '')).split(';')[0].trim().toLowerCase();
  if (!mediaId || !POD_MIME.has(mimeType)) return null;
  const ext = mimeType === 'application/pdf' ? 'pdf' : mimeType === 'image/png' ? 'png' : 'jpg';
  const fileName = String(m?.filename ?? '').trim() || `pod-whatsapp.${ext}`;
  return { mediaId, mimeType, fileName };
}

async function fetchMedia(deps: PodDeps, mediaId: string): Promise<{ ok: true; bytes: Uint8Array; mimeType: string } | { ok: false; error: string }> {
  const secret = Deno.env.get('CONTROL_ROOM_FORWARD_SECRET') ?? '';
  const channelSlug = Deno.env.get('CONTROL_ROOM_CHANNEL_SLUG') ?? '';
  if (!secret || !channelSlug) return { ok: false, error: 'Control Room secrets not set' };
  const body = JSON.stringify({ action: 'get_media', channelSlug, messageId: deps.wamid, mediaId });
  const signature = 'sha256=' + await deps.hmacHex(secret, body);
  let last = '';
  // Control Room logs the inbound message without awaiting before it forwards it, so a lookup can
  // briefly miss it: retry unknown_message a few times (same as FruitLive's wa-bot).
  for (const delay of [0, 1500, 3000, 5000]) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    try {
      const res = await fetch(deps.metaProxyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Control-Room-Signature': signature },
        body,
      });
      const cr: Any = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
      if (cr?.ok && cr?.dataBase64) {
        const bytes = Uint8Array.from(atob(String(cr.dataBase64)), (c) => c.charCodeAt(0));
        return { ok: true, bytes, mimeType: String(cr.mimeType || '') };
      }
      last = String(cr?.error ?? `HTTP ${res.status}`);
      if (last !== 'unknown_message') break;
    } catch (e) {
      last = String((e as Error)?.message ?? e);
    }
  }
  return { ok: false, error: last };
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Same public file store as the portal's Supporting Documents (WebPortal/js/common.js uploadFile). */
async function uploadFile(bytes: Uint8Array, mimeType: string, fileName: string): Promise<{ file_id: string; file_link: string | null } | null> {
  try {
    const safe = fileName.replace(/[^\w.-]/g, '_');
    const fileId = `del_wa_${Date.now()}_${crypto.randomUUID().slice(0, 4)}_${safe}`;
    const form = new FormData();
    form.append('files', new Blob([bytes], { type: mimeType }), safe);
    form.append('resourceFolder', DOC_FOLDER);
    form.append('fileId', fileId);
    form.append('fileSize', String(bytes.length));
    form.append('chunkCount', '1');
    form.append('chunkIndex', '0');
    const res = await fetch(FILE_UPLOAD_URL, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const out: Any = await res.json();
    if (out?.error) throw new Error(String(out.error));
    const link = String(out?.fileLink ?? out?.[0]?.fileLink ?? '') || null;
    return { file_id: String(out?.fileId ?? out?.[0]?.fileId ?? fileId), file_link: link };
  } catch (e) {
    console.error('[whatsapp-inbound] POD upload failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

/** Supplier names exactly as the portal's dropdown shows them ("Name (code)"), with their ids. */
async function loadLists(sb: SupabaseClient): Promise<{ suppliers: { id: string; name: string }[]; transporters: string[]; types: string[] }> {
  const out = { suppliers: [] as { id: string; name: string }[], transporters: [] as string[], types: [] as string[] };
  try {
    const { data } = await sb.from('contacts')
      .select('id, company_name, trading_name, primary_contact_name, supplier_number, contact_type')
      .in('contact_type', ['nis_supplier', 'supplier', 'both'])
      .limit(600);
    out.suppliers = (data ?? []).map((c: Any) => ({
      id: String(c.id),
      name: String(c.company_name || c.trading_name || c.primary_contact_name || 'Unknown') +
        (c.supplier_number != null ? ` (${c.supplier_number})` : ''),
    }));
  } catch (e) {
    console.error('[whatsapp-inbound] POD supplier list failed:', e);
  }
  try {
    const { data } = await sb.rpc('get_kernel_pipeline_config');
    const cfg: Any = Array.isArray(data) ? data[0] : data;
    const active = (rows: Any) => (Array.isArray(rows) ? rows : []).filter((t: Any) => t && t.is_active !== false).map((t: Any) => String(t.name));
    out.transporters = active(cfg?.transporters);
    out.types = active(cfg?.transport_types);
  } catch (e) {
    console.error('[whatsapp-inbound] POD pipeline config failed:', e);
  }
  return out;
}

function v(reading: Any, key: string): string {
  const f = reading?.[key];
  return f && f.value != null ? String(f.value).trim() : '';
}

function kgText(raw: string): string {
  const n = Number(String(raw).replace(/[\s,]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return '';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kg';
}

export function podReplyText(reading: Any, supplierLabel: string | null, saved: boolean): string {
  const lines: string[] = [];
  const doc = v(reading, 'document_number');
  const tr = v(reading, 'transporter_match') || v(reading, 'transporter_name');
  lines.push('Proof of delivery read' + (doc ? ` - No. ${doc}` : '') + (tr ? ` (${tr})` : '') + '.');
  lines.push('Supplier: ' + (supplierLabel || (v(reading, 'sender_name') ? `${v(reading, 'sender_name')} - not matched, pick it in the portal` : 'not found')));
  const kg = kgText(v(reading, 'declared_kg'));
  if (kg) lines.push('Weight: ' + kg);
  const bags = v(reading, 'bag_count');
  if (bags) lines.push('Bags: ' + bags + (v(reading, 'product') ? ' ' + v(reading, 'product') : ''));
  lines.push('');
  lines.push(saved
    ? 'It is waiting on Receiving under "POD received on WhatsApp". Press Book in there, check the yellow boxes, then Save.'
    : 'It could not be saved to the portal. Book it in by hand on Receiving.');
  return lines.join('\n');
}

/**
 * The whole POD flow for one message. Returns a short outcome for the audit log. The caller has
 * already checked enrolment, the role's grower.intake.create and podMediaOf(msg).
 */
export async function handlePodMessage(
  deps: PodDeps,
  media: { mediaId: string; mimeType: string; fileName: string },
): Promise<{ outcome: 'ok' | 'error'; detail: string }> {
  const { sb, phone } = deps;
  await deps.sendText(phone, 'Reading your proof of delivery. This takes about 20 seconds...');

  const got = await fetchMedia(deps, media.mediaId);
  if (!got.ok) {
    await deps.sendText(phone, 'Sorry, the photo could not be downloaded. Please send it again, or book the truck in by hand on Receiving.');
    return { outcome: 'error', detail: `get_media: ${got.error}` };
  }
  if (got.bytes.length > MAX_BYTES) {
    await deps.sendText(phone, 'That file is too big to read. Please send a photo of the proof of delivery instead.');
    return { outcome: 'error', detail: `too big: ${got.bytes.length}` };
  }
  const mimeType = POD_MIME.has(got.mimeType.split(';')[0].trim().toLowerCase())
    ? got.mimeType.split(';')[0].trim().toLowerCase() : media.mimeType;

  const anthropic = podClient();
  if (!anthropic) {
    await deps.sendText(phone, 'Reading photos is not set up on this server yet. Please book the truck in by hand on Receiving.');
    return { outcome: 'error', detail: 'no AI key' };
  }
  const lists = await loadLists(sb);
  const read = await readPod(anthropic, {
    mediaType: mimeType,
    dataBase64: toBase64(got.bytes),
    suppliers: lists.suppliers.map((s) => s.name),
    transporters: lists.transporters,
    transportTypes: lists.types,
  }, 'whatsapp-inbound', deps.userId);
  if (!read.ok) {
    await deps.sendText(phone, `${read.error} You can also book the truck in by hand on Receiving.`);
    return { outcome: 'error', detail: `read_pod: ${read.error}` };
  }
  const reading = read.data;
  if (reading?.is_proof_of_delivery === false) {
    await deps.sendText(phone, 'That does not look like a proof of delivery, so nothing was saved. To book in a truck, send a clear photo of its proof of delivery.');
    return { outcome: 'ok', detail: 'not a POD' };
  }

  const matchName = v(reading, 'supplier_match');
  const supplier = matchName ? lists.suppliers.find((s) => s.name === matchName) ?? null : null;
  const stored = await uploadFile(got.bytes, mimeType, media.fileName);

  let saved = false;
  try {
    const { data, error } = await sb.rpc('intake_pod_inbox_add', {
      p_wamid: deps.wamid,
      p_from_phone: phone,
      p_sent_by: deps.userId,
      p_file_id: stored?.file_id ?? null,
      p_file_link: stored?.file_link ?? null,
      p_file_name: media.fileName,
      p_reading: reading,
      p_supplier_id: supplier?.id ?? null,
    });
    if (error) throw error;
    const row: Any = Array.isArray(data) ? data[0] : data;
    saved = !!row?.success;
  } catch (e) {
    console.error('[whatsapp-inbound] intake_pod_inbox_add failed (migration 20261118130000 applied?):', (e as Any)?.message ?? e);
  }

  await deps.sendText(phone, podReplyText(reading, supplier?.name ?? null, saved));
  return { outcome: saved ? 'ok' : 'error', detail: saved ? `pod ${v(reading, 'document_number') || '-'}` : 'inbox insert failed' };
}
