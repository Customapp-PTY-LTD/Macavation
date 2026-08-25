/**
 * Shared WhatsApp send plumbing: pure message-body builders plus the one live sender
 * (`sendText`) that posts to Control Room's `meta-proxy`.
 *
 * Env read once at module scope:
 *   CONTROL_ROOM_BASE_URL       (optional) — overrides the meta-proxy base URL.
 *   CONTROL_ROOM_FORWARD_SECRET (required) — HMAC secret used to sign every outbound POST.
 *   CONTROL_ROOM_CHANNEL_SLUG   (required) — the channel this repo sends through.
 *
 * VERIFIED (read this repo's own senders yourself before trusting this list — do not take it
 * on faith):
 *   - The outbound request body is `{ action:'send_message', channelSlug, to, type:'text',
 *     content:{ text } }` — the key is `text`, not `body`. Confirmed at all four existing call
 *     sites: send-whatsapp-message/index.ts:128, send-daily-digest-whatsapp/index.ts:105,
 *     send-report-whatsapp/index.ts:439, whatsapp-inbound/index.ts:211.
 *   - The signature header is `X-Control-Room-Signature: sha256=<lowercase hex HMAC-SHA256 of
 *     the exact posted body string>` — send-report-whatsapp/index.ts:155-166,:446;
 *     whatsapp-inbound/index.ts:88-98,:219.
 *   - The gateway response is read as `{ ok, wamid, error }` — send-report-whatsapp/index.ts:451-462.
 *
 * UNCONFIRMED — OPEN QUESTION (do not treat any of this as settled):
 *   The `content` shapes below for `type:'interactive'` (buttons, lists) and `type:'template'`
 *   have NOT been verified against `meta-proxy`. Nothing in this repo currently sends them, and
 *   the `meta-proxy` source, a database, and the network are all unreachable from this checkout.
 *   They are this repo's current PROPOSAL for those shapes, not a confirmed contract. See the
 *   standing decision at whatsapp-inbound/index.ts:182-185 ("do not add an interactive/button
 *   send here (unconfirmed external contract)"). Before any caller sends a non-text type, someone
 *   with Control Room access must confirm the real shape. Until then this file exports builders
 *   for them (safe — nothing is sent) but no sender.
 *
 * The fallback base URL below is byte-identical to the literal already hardcoded at
 * send-report-whatsapp/index.ts:33 and whatsapp-inbound/index.ts:188. If any of the three
 * changes, all three must change together. This checkout contains no evidence about which
 * Control Room project is correct — do not change this value on the basis of anything other than
 * a confirmed instruction from someone with Control Room access. The env override exists so the
 * value can be rotated by configuration rather than by a code change.
 */
import {
  MAX_BUTTON_CTA,
  MAX_BUTTONS,
  MAX_LIST_ROWS,
  MAX_LIST_SECTION,
  MAX_LIST_TITLE,
  MAX_REPLY_ID,
} from './wa-limits.ts';

const CONTROL_ROOM_BASE_URL =
  Deno.env.get('CONTROL_ROOM_BASE_URL') ?? 'https://ejnncypummmvyojhovme.supabase.co/functions/v1';
const CONTROL_ROOM_URL = `${CONTROL_ROOM_BASE_URL}/meta-proxy`;
const FORWARD_SECRET = Deno.env.get('CONTROL_ROOM_FORWARD_SECRET') ?? '';
const CHANNEL_SLUG = Deno.env.get('CONTROL_ROOM_CHANNEL_SLUG') ?? '';

export class WaSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WaSendError';
  }
}

export type WaMessageBody = { to: string; type: string; content: unknown };

export type WaButton = { id: string; title: string };
export type WaListRow = { id: string; title: string };
export type WaListSection = { title: string; rows: WaListRow[] };
export type WaTemplateComponent = {
  type: 'header' | 'body' | 'button';
  sub_type?: 'url' | 'quick_reply';
  index?: number;
  parameters: { type: 'text'; text: string }[];
};

// ----------------------------------------------------------------------------------------------
// Pure body builders — no module-scope value, no env, no network. Each returns a WaMessageBody.
// ----------------------------------------------------------------------------------------------

/** The one VERIFIED content shape in this file — `{ text }`, not `{ body }`. Do not "improve" it. */
export function buildTextBody(to: string, text: string): WaMessageBody {
  if (!text || !text.trim()) {
    throw new WaSendError('buildTextBody: text must not be empty.');
  }
  return { to, type: 'text', content: { text } };
}

// UNCONFIRMED external contract
export function buildButtonsBody(to: string, bodyText: string, buttons: WaButton[]): WaMessageBody {
  if (!buttons || buttons.length === 0) {
    throw new WaSendError('buildButtonsBody: buttons must not be empty.');
  }
  if (buttons.length > MAX_BUTTONS) {
    throw new WaSendError(`buildButtonsBody: at most ${MAX_BUTTONS} buttons are allowed, got ${buttons.length}.`);
  }
  for (const b of buttons) {
    if (b.title.length > MAX_BUTTON_CTA) {
      throw new WaSendError(
        `buildButtonsBody: button title exceeds ${MAX_BUTTON_CTA} characters: ${JSON.stringify(b.title)}`
      );
    }
  }
  return {
    to,
    type: 'interactive',
    content: {
      type: 'button',
      body: { text: bodyText },
      action: {
        buttons: buttons.map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title } })),
      },
    },
  };
}

// UNCONFIRMED external contract
export function buildListBody(
  to: string,
  bodyText: string,
  buttonLabel: string,
  sections: WaListSection[]
): WaMessageBody {
  if (!sections || sections.length === 0) {
    throw new WaSendError('buildListBody: sections must not be empty.');
  }
  let totalRows = 0;
  for (const section of sections) {
    if (section.title.length > MAX_LIST_SECTION) {
      throw new WaSendError(
        `buildListBody: section title exceeds ${MAX_LIST_SECTION} characters: ${JSON.stringify(section.title)}`
      );
    }
    for (const row of section.rows) {
      if (row.title.length > MAX_LIST_TITLE) {
        throw new WaSendError(
          `buildListBody: row title exceeds ${MAX_LIST_TITLE} characters: ${JSON.stringify(row.title)}`
        );
      }
      totalRows++;
    }
  }
  if (totalRows > MAX_LIST_ROWS) {
    throw new WaSendError(`buildListBody: at most ${MAX_LIST_ROWS} rows total are allowed, got ${totalRows}.`);
  }
  return {
    to,
    type: 'interactive',
    content: {
      type: 'list',
      body: { text: bodyText },
      action: { button: buttonLabel, sections },
    },
  };
}

const URL_PARAM_RE = /^https?:\/\//i;

// UNCONFIRMED external contract
export function buildTemplateBody(
  to: string,
  templateName: string,
  languageCode: string,
  components?: WaTemplateComponent[]
): WaMessageBody {
  if (components && components.length > 0) {
    for (const c of components) {
      if (c.type === 'button' && c.sub_type === 'url') {
        for (const p of c.parameters) {
          if (URL_PARAM_RE.test(p.text)) {
            throw new WaSendError(
              'buildTemplateBody: a url-button parameter must be only the suffix that replaces {{1}} ' +
                `in the template's base URL, never a full URL. Got: ${JSON.stringify(p.text)}`
            );
          }
        }
      }
    }
  }

  const content: Record<string, unknown> = {
    name: templateName,
    language: { code: languageCode },
  };
  if (components && components.length > 0) {
    content.components = components;
  }
  return { to, type: 'template', content };
}

// ----------------------------------------------------------------------------------------------
// Reply-id convention — defined here ONLY, so the next four plans do not each invent their own.
// ----------------------------------------------------------------------------------------------

const REPLY_SEGMENT_RE = /^[a-z0-9][a-z0-9_-]{0,23}$/;

/** Joins segments with ':'. Each segment must match REPLY_SEGMENT_RE or this throws. */
export function buildReplyId(ns: string, action: string, arg?: string): string {
  const segments = arg === undefined ? [ns, action] : [ns, action, arg];
  for (const seg of segments) {
    if (!REPLY_SEGMENT_RE.test(seg)) {
      throw new WaSendError(`buildReplyId: invalid segment ${JSON.stringify(seg)}.`);
    }
  }
  const id = segments.join(':');
  if (id.length > MAX_REPLY_ID) {
    throw new WaSendError(`buildReplyId: id exceeds ${MAX_REPLY_ID} characters: ${JSON.stringify(id)}`);
  }
  return id;
}

/** Never throws. Returns null for anything that is not 2 or 3 valid segments joined by ':'. */
export function parseReplyId(id: string): { ns: string; action: string; arg?: string } | null {
  if (typeof id !== 'string') return null;
  const segments = id.split(':');
  if (segments.length !== 2 && segments.length !== 3) return null;
  for (const seg of segments) {
    if (!REPLY_SEGMENT_RE.test(seg)) return null;
  }
  const [ns, action, arg] = segments;
  return arg === undefined ? { ns, action } : { ns, action, arg };
}

// ----------------------------------------------------------------------------------------------
// Phone handling.
//
// This file is deliberately a sweep candidate for scripts/verify-report-whatsapp-parity.mjs:
// it contains `replace(/\D/g` and the substring `27`, and is listed in that script's
// SWEEP_ALLOWLIST. If either substring is ever removed from this file, that gate fails on the
// allowlist/deepEqual mismatch. Change both together or not at all.
// ----------------------------------------------------------------------------------------------

/**
 * Converts an ALREADY-INTERNATIONAL phone number to E.164 by stripping non-digits and prefixing
 * '+'. For inbound Meta `from` values (bare international digits, e.g. "27821234567") and for
 * numbers already stored in "+27…" form.
 *
 * ⚠ This is NOT a South African normaliser and must never be used as one. A local number like
 * "0821234567" would become "+0821234567", which is not a phone number. Local-format numbers are
 * canonicalised to "+27…" by the database (report_normalize_wa_phone,
 * migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql:46) before they ever
 * reach this module, and every recipient list is keyed on that canonical form. Do not
 * re-implement SA normalisation here.
 *
 * ⚠ Unlike the three existing `normalizePhone` copies (documented in
 * verify-report-whatsapp-parity.mjs:39-47 as having a known, NOT-fixed-here defect where an
 * empty/digit-free input silently becomes the plausible-looking but wrong address "+27"), this is
 * a NEW call site with no such history: it THROWS WaSendError when the stripped digit string is
 * empty, rather than returning "+" or "+27". This is not a fix to the existing three copies —
 * they are untouched — it is a new function simply declining to inherit their defect.
 */
export function toWaPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (!digits) {
    throw new WaSendError('toWaPhone: input contains no digits.');
  }
  return `+${digits}`;
}

// ----------------------------------------------------------------------------------------------
// Signing and posting.
// ----------------------------------------------------------------------------------------------

/** Bare lowercase hex HMAC-SHA256, matching whatsapp-inbound/index.ts:88-98. Exported for tests. */
export async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type WaSendResult = { ok: boolean; wamid: string | null; error: string | null };

/**
 * Composes the Control Room envelope, signs the EXACT posted string once, and POSTs it.
 * Private: the only exported sender in this file is `sendText`, below.
 *
 * Never logs, echoes, or includes FORWARD_SECRET, the computed signature, or the request body in
 * any console call or in the returned error string.
 */
async function sendViaControlRoom(body: WaMessageBody): Promise<WaSendResult> {
  if (!FORWARD_SECRET || !CHANNEL_SLUG) {
    return { ok: false, wamid: null, error: 'Control Room is not configured' };
  }

  const requestBody = JSON.stringify({
    action: 'send_message',
    channelSlug: CHANNEL_SLUG,
    to: body.to,
    type: body.type,
    content: body.content,
  });

  try {
    const signature = await hmacSha256Hex(FORWARD_SECRET, requestBody);
    const res = await fetch(CONTROL_ROOM_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Control-Room-Signature': `sha256=${signature}`,
      },
      body: requestBody,
    });

    const gatewayResult = await res.json().catch(() => ({} as Record<string, unknown>));
    if (!res.ok || !(gatewayResult as Record<string, unknown>).ok) {
      const err = String((gatewayResult as Record<string, unknown>).error || res.statusText || 'Send failed.');
      return { ok: false, wamid: null, error: err };
    }
    return { ok: true, wamid: ((gatewayResult as Record<string, unknown>).wamid as string) || null, error: null };
  } catch (e) {
    return { ok: false, wamid: null, error: String((e as Error)?.message || e) };
  }
}

/** The only exported sender in this plan. buildTextBody + sendViaControlRoom. */
export async function sendText(to: string, text: string): Promise<WaSendResult> {
  const body = buildTextBody(to, text);
  return sendViaControlRoom(body);
}

// No sendButtons / sendList / sendTemplate sender is exported by this file. The `interactive`
// and `template` content shapes above are UNCONFIRMED (see the header). Before any of those
// senders is added, someone with Control Room access must confirm the real shapes.
