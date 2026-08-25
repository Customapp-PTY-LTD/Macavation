/**
 * Shared WhatsApp inbound plumbing: signature verification plus classification of Control
 * Room's forwarded raw Meta webhook envelope into a small, typed shape.
 *
 * Structured as small PURE helpers plus one thin async wrapper (verifyControlRoomSignature),
 * so a Node verifier script can re-declare the pure parts as plain JS and run behavioural tests
 * against them without loading this .ts file (see scripts/verify-wa-plumbing.mjs).
 *
 * `wa-inbound.ts` does NOT import buildReplyId/parseReplyId from wa-send.ts — it returns the
 * raw `replyId` string on button_reply/list_reply and leaves parsing to the caller. Keep the
 * dependency one-way.
 */

/**
 * Extracts the lowercase hex digest from a `sha256=<hex>` header. Pure, never throws — returns
 * null for a missing, non-string, wrong-prefix, empty or non-hex value.
 */
export function parseSignatureHeader(header: unknown): string | null {
  if (typeof header !== 'string') return null;
  const trimmed = header.trim();
  if (!trimmed.startsWith('sha256=')) return null;
  const hex = trimmed.slice('sha256='.length);
  if (!hex) return null;
  if (!/^[0-9a-f]+$/i.test(hex)) return null;
  return hex.toLowerCase();
}

/**
 * Length-independent, no early exit on the first differing byte. Modelled on
 * whatsapp-inbound/index.ts:101-111.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

async function hmacHex(secret: string, body: string): Promise<string> {
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

/**
 * Verifies the Control Room HMAC signature over the raw body. Returns false (never throws) for
 * a missing/malformed header, an empty secret, or a mismatch.
 *
 * Callers verify before parsing the body at all — the signature check must run over the raw
 * body string, before JSON.parse, exactly as whatsapp-inbound/index.ts:693-714 does.
 */
export async function verifyControlRoomSignature(
  rawBody: string,
  signatureHeader: unknown,
  secret: string
): Promise<boolean> {
  if (!secret) return false;
  const provided = parseSignatureHeader(signatureHeader);
  if (!provided) return false;
  const expected = await hmacHex(secret, rawBody);
  return timingSafeEqual(provided, expected);
}

// ------------------------------------------------------------------------------------------
// Message classification.
// ------------------------------------------------------------------------------------------

export type ExtractedMessage =
  | { kind: 'text'; from: string; id: string; text: string; senderName?: string }
  | { kind: 'button_reply'; from: string; id: string; replyId: string; replyTitle: string; senderName?: string }
  | { kind: 'list_reply'; from: string; id: string; replyId: string; replyTitle: string; senderName?: string }
  | { kind: 'status' } // delivery/read receipts — classify and ignore
  | { kind: 'unsupported' }; // images, unknown types, unparseable

/**
 * Takes value.contacts[0].profile.name. Returns the first whitespace-delimited word, newlines
 * stripped, capped at 20 characters, and undefined unless the result contains at least one
 * letter (a display name is free text the user chose and can be emoji-only). Returns undefined
 * for a non-string, empty, or whitespace-only input.
 */
export function sanitizeSenderName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const noNewlines = raw.replace(/[\r\n]+/g, ' ');
  const trimmed = noNewlines.trim();
  if (!trimmed) return undefined;
  const firstWord = trimmed.split(/\s+/)[0] ?? '';
  const capped = firstWord.slice(0, 20);
  if (!/\p{L}/u.test(capped)) return undefined;
  return capped;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/**
 * Pure classifier. Requires `from`, `id` and `type` to all be non-empty strings, else returns
 * `{ kind: 'unsupported' }`.
 *
 * The `type:'button'` branch below is load-bearing and easy to mistake for dead code: tapping a
 * quick-reply button on an APPROVED TEMPLATE does not arrive as `interactive` at all — it
 * arrives as `type: 'button'`. This repo already handles that variant at
 * whatsapp-inbound/index.ts:124-125, reading msg.button.text. It is mapped here to the SAME
 * kind:'button_reply' as a real interactive button reply, with replyTitle = msg.button.text and
 * replyId = msg.button.payload when payload is a non-empty string, otherwise falling back to
 * msg.button.text — this checkout only ever reads `.text`, so `.payload` must not be treated as
 * guaranteed to exist.
 */
export function classifyMessage(msg: unknown, senderName: string | undefined): ExtractedMessage {
  if (!msg || typeof msg !== 'object') return { kind: 'unsupported' };
  const m = msg as Record<string, unknown>;

  const from = m.from;
  const id = m.id;
  const type = m.type;
  if (!isNonEmptyString(from) || !isNonEmptyString(id) || !isNonEmptyString(type)) {
    return { kind: 'unsupported' };
  }

  if (type === 'text') {
    const text = (m.text as Record<string, unknown> | undefined)?.body;
    if (isNonEmptyString(text)) {
      return { kind: 'text', from, id, text, senderName };
    }
    return { kind: 'unsupported' };
  }

  if (type === 'interactive') {
    const interactive = (m.interactive as Record<string, unknown> | undefined) ?? {};
    const interactiveType = interactive.type;
    if (interactiveType === 'button_reply') {
      const br = (interactive.button_reply as Record<string, unknown> | undefined) ?? {};
      if (isNonEmptyString(br.id) && isNonEmptyString(br.title)) {
        return { kind: 'button_reply', from, id, replyId: br.id, replyTitle: br.title, senderName };
      }
      return { kind: 'unsupported' };
    }
    if (interactiveType === 'list_reply') {
      const lr = (interactive.list_reply as Record<string, unknown> | undefined) ?? {};
      if (isNonEmptyString(lr.id) && isNonEmptyString(lr.title)) {
        return { kind: 'list_reply', from, id, replyId: lr.id, replyTitle: lr.title, senderName };
      }
      return { kind: 'unsupported' };
    }
    return { kind: 'unsupported' };
  }

  // A tap on a quick-reply button attached to an APPROVED TEMPLATE arrives as type:'button', not
  // 'interactive'. See the function comment above for why this branch is not dead code.
  if (type === 'button') {
    const btn = (m.button as Record<string, unknown> | undefined) ?? {};
    const text = btn.text;
    const payload = btn.payload;
    if (!isNonEmptyString(text) && !isNonEmptyString(payload)) {
      return { kind: 'unsupported' };
    }
    const replyTitle = isNonEmptyString(text) ? text : (payload as string);
    const replyId = isNonEmptyString(payload) ? payload : (text as string);
    return { kind: 'button_reply', from, id, replyId, replyTitle, senderName };
  }

  return { kind: 'unsupported' };
}

/**
 * Reads entry[0].changes[0].value from Control Room's forwarded raw Meta webhook. The message,
 * if any, is value.messages[0]. Never throws — anything unrecognised classifies as 'unsupported'
 * rather than erroring, because the webhook must always return 2xx once the signature checks
 * out.
 */
export function extractMessage(payload: unknown): ExtractedMessage {
  try {
    const p = payload as Record<string, unknown> | null | undefined;
    const entry = Array.isArray(p?.entry) ? (p!.entry as unknown[]) : [];
    const change0 = (entry[0] as Record<string, unknown> | undefined)?.changes;
    const changes = Array.isArray(change0) ? (change0 as unknown[]) : [];
    const value = (changes[0] as Record<string, unknown> | undefined)?.value as
      | Record<string, unknown>
      | undefined;

    const contacts = Array.isArray(value?.contacts) ? (value!.contacts as unknown[]) : [];
    const profileName = (contacts[0] as Record<string, unknown> | undefined)?.profile as
      | Record<string, unknown>
      | undefined;
    const senderName = sanitizeSenderName(profileName?.name);

    const messages = Array.isArray(value?.messages) ? (value!.messages as unknown[]) : [];
    if (messages.length > 0) {
      return classifyMessage(messages[0], senderName);
    }

    const statuses = Array.isArray(value?.statuses) ? (value!.statuses as unknown[]) : [];
    if (statuses.length > 0) {
      return { kind: 'status' };
    }

    return { kind: 'unsupported' };
  } catch (e) {
    console.error('[wa-inbound] extractMessage failed:', (e as Error)?.message || e);
    return { kind: 'unsupported' };
  }
}
