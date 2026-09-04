/**
 * Supabase Edge Function: mint a staff WhatsApp enrolment code and text it to the handset.
 *
 * Deploy: supabase functions deploy whatsapp-enrol-staff
 *
 * THE MISSING HALF OF migration 20260815100000_staff_whatsapp_identity.sql. That migration
 * built whatsapp_start_enrolment / whatsapp_confirm_enrolment / whatsapp_resolve_staff_user and
 * said so explicitly in its own header, clause (c):
 *
 *     "NOTHING IN THIS MIGRATION DELIVERS THE CODE TO A HANDSET … the 'we texted your own
 *      handset, so possession is proven' property depends entirely on the later plan that adds
 *      the delivery path, and is NOT established by this migration alone."
 *
 * This function IS that delivery path. Until it existed, nothing in the repo called
 * whatsapp_start_enrolment at all, so no staff number could ever become enrolled and
 * whatsapp-inbound's command dispatch was unreachable for every caller.
 *
 * WHY A CODE AT ALL, RATHER THAN TRUSTING users.mobile_number:
 * mobile_number is free text an admin typed into the Add/Edit User modal. It carries no unique
 * index and nobody proved they hold that handset — 20260828120000_users_mobile_number.sql says
 * in its own header that writing identity from it "would fake enrolment". Authorising WhatsApp
 * commands off it would mean anyone who knows a staff member's number could text this line and
 * inherit that person's role. So mobile_number is only ever the number we OFFER to enrol; the
 * code proves possession, and whatsapp_confirm_enrolment is the only writer of whatsapp_phone.
 *
 * Auth: X-Portal-Session carries the raw token minted at login, validated via the service-role
 * RPC assistant_validate_session — the same convention and the same fail-closed handling as
 * send-whatsapp-message/index.ts:46-64, which this function's session handling is modelled on.
 * The anon key that reaches this function ships in the browser and proves nothing.
 *
 * AUTHORISATION IS ENFORCED HERE, not in the database. whatsapp_start_enrolment does call
 * whatsapp_user_manages_users(p_requesting_user_id), but its own header calls that
 * "defence-in-depth only … it cannot authenticate p_requesting_user_id (it is a value the caller
 * supplies, not a verified session)". This function is the server-side caller that check assumes:
 * it passes the user id it got from the validated SESSION, never one from the request body, and
 * refuses with 403 before minting anything if that user does not hold admin.users.manage.
 *
 * THE CODE IS NEVER RETURNED TO THE BROWSER AND NEVER LOGGED. whatsapp_start_enrolment returns
 * it to us; it goes straight into the WhatsApp message and nowhere else. Echoing it in the HTTP
 * response would defeat the whole point — an admin could then enrol a number they do not hold.
 *
 * Secrets: CONTROL_ROOM_FORWARD_SECRET, CONTROL_ROOM_CHANNEL_SLUG (both read inside
 * ../_shared/wa-send.ts, not here).
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-provided by the runtime).
 */
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendText, toWaPhone } from '../_shared/wa-send.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-portal-session, X-Portal-Session',
};

// deno-lint-ignore no-explicit-any
type AnyRow = Record<string, any>;

/** Meta's customer-service window. A free-form send outside it is dropped — see canSendFreeform. */
const WINDOW_HOURS = 24;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function makeServiceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );
}

async function rpc(sb: SupabaseClient, fn: string, params: Record<string, unknown> = {}): Promise<AnyRow[]> {
  const { data, error } = await sb.rpc(fn, params);
  if (error) throw new Error(`[rpc:${fn}] ${error.message}`);
  if (Array.isArray(data)) return data as AnyRow[];
  if (data && typeof data === 'object') return [data as AnyRow];
  return [];
}

/** Modelled on send-whatsapp-message/index.ts:46-64. Fail closed: no row means no session. */
async function validateSession(
  sb: SupabaseClient,
  token: string
): Promise<{ userId: string } | { error: string; status: number }> {
  if (!token) return { error: 'Authentication required.', status: 401 };

  let rows: AnyRow[];
  try {
    rows = await rpc(sb, 'assistant_validate_session', { p_token: token });
  } catch (e) {
    console.error('[whatsapp-enrol-staff] session validation RPC failed:', e);
    return { error: 'Authentication unavailable. Please try again.', status: 503 };
  }

  const row = rows?.[0] ?? null;
  if (!row || !row.user_id) {
    return { error: 'Invalid or expired session. Please sign in again.', status: 401 };
  }
  return { userId: String(row.user_id) };
}

/**
 * Canonicalises to this repo's bare-digit form ('27725755158') by calling the DATABASE's
 * chat_normalize_phone — the same helper whatsapp_start_enrolment and whatsapp_resolve_staff_user
 * use internally, so the number we send to and the number that later resolves are identical by
 * construction rather than by two implementations agreeing.
 *
 * Deliberately NOT a local normaliser. ../_shared/wa-send.ts states that South African
 * local-format numbers "are canonicalised to '+27…' by the database … before they ever reach this
 * module. Do not re-implement SA normalisation here." An admin typing '072…' into the Mobile
 * Number box is exactly that case, and toWaPhone would turn it into the plausible-looking but
 * meaningless '+072…'. So the DB canonicalises first, toWaPhone only adds the '+'.
 */
async function canonicalisePhone(sb: SupabaseClient, phone: string): Promise<string | null> {
  const { data, error } = await sb.rpc('chat_normalize_phone', { p_phone: phone });
  if (error) throw new Error(`[rpc:chat_normalize_phone] ${error.message}`);
  const value = Array.isArray(data) ? data[0] : data;
  const digits = value == null ? '' : String(value).trim();
  return digits ? digits : null;
}

/**
 * Whether a free-form (non-template) message to this number would actually be delivered.
 *
 * Meta only accepts a free-form send inside the 24 hours following the recipient's own last
 * message; outside it, the send must be an APPROVED TEMPLATE. As of this function being written
 * this channel has exactly one template, `macavation_staff_welcome_template`, and Control Room
 * reports its status as `draft` with no Meta template id — it has never been submitted for
 * review, so there is no approved template to fall back on and sendTemplate has nothing to send.
 *
 * ../_shared/wa-send.ts is explicit about the failure mode this check exists to prevent: a
 * free-form send outside the window "is accepted by the gateway and then dropped by Meta". The
 * gateway returns ok, we would report success, and the staff member's handset would never ring —
 * the worst possible outcome for an admin trying to work out whether enrolment is working. So we
 * check first, and refuse BEFORE minting a code rather than burning one on an undeliverable
 * message.
 *
 * Read directly with the service-role client rather than through an RPC: no existing RPC answers
 * this question, and this needs no new database object.
 */
async function canSendFreeform(sb: SupabaseClient, phone: string): Promise<boolean> {
  const since = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000).toISOString();

  const { data: convs, error: convErr } = await sb
    .from('chat_conversations')
    .select('conversation_id')
    .eq('external_phone', phone);
  if (convErr) throw new Error(`[chat_conversations] ${convErr.message}`);

  const ids = (convs ?? []).map((c: AnyRow) => c.conversation_id).filter(Boolean);
  if (ids.length === 0) return false;

  const { data: msgs, error: msgErr } = await sb
    .from('chat_messages')
    .select('message_id')
    .in('conversation_id', ids)
    .eq('direction', 'inbound_whatsapp')
    .gte('created_at', since)
    .limit(1);
  if (msgErr) throw new Error(`[chat_messages] ${msgErr.message}`);

  return (msgs ?? []).length > 0;
}

/** '27725755158' -> '…5158'. For telling an admin WHICH number was texted without printing it. */
function maskPhone(phone: string): string {
  return phone.length <= 4 ? phone : `…${phone.slice(-4)}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ success: false, error: 'Method not allowed.' }, 405);
  }

  const sb = makeServiceClient();

  const sessionOrErr = await validateSession(sb, (req.headers.get('x-portal-session') || '').trim());
  if ('error' in sessionOrErr) {
    return json({ success: false, error: sessionOrErr.error }, sessionOrErr.status);
  }
  const requestingUserId = sessionOrErr.userId;

  // The real authorisation gate. Runs on the SESSION's user id, before anything is minted.
  //
  // CALLED DIRECTLY, NOT THROUGH THE rpc() HELPER ABOVE — and that is not a style choice.
  // whatsapp_user_manages_users is declared RETURNS boolean, so supabase-js hands back the bare
  // scalar `true`. rpc() returns [] for anything that is neither an array nor an object, so a
  // scalar `true` arrives as an empty array, `rows[0]` is undefined, and the check evaluates
  // false — refusing EVERY caller, including a super_user who genuinely holds
  // admin.users.manage. That is exactly what happened on the first deployment of this function.
  // rpc() is for the row-returning RPCs (assistant_validate_session, whatsapp_start_enrolment);
  // scalar-returning RPCs are read directly, the same way canonicalisePhone reads
  // chat_normalize_phone's text return.
  let manages = false;
  try {
    const { data, error } = await sb.rpc('whatsapp_user_manages_users', {
      p_user_id: requestingUserId,
    });
    if (error) throw new Error(error.message);
    manages = data === true || (Array.isArray(data) && data[0] === true);
  } catch (e) {
    console.error('[whatsapp-enrol-staff] permission check failed:', e);
    return json({ success: false, error: 'Permission check unavailable. Please try again.' }, 503);
  }
  if (!manages) {
    return json({ success: false, error: 'You do not have permission to enrol staff WhatsApp numbers.' }, 403);
  }

  let body: AnyRow;
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: 'Request body must be JSON.' }, 400);
  }

  const targetUserId = String(body?.user_id ?? '').trim();
  const rawPhone = String(body?.phone ?? '').trim();
  if (!targetUserId) return json({ success: false, error: 'user_id is required.' }, 400);
  if (!rawPhone) return json({ success: false, error: 'phone is required.' }, 400);

  let phone: string | null;
  try {
    phone = await canonicalisePhone(sb, rawPhone);
  } catch (e) {
    console.error('[whatsapp-enrol-staff] phone canonicalisation failed:', e);
    return json({ success: false, error: 'Could not read that phone number.' }, 503);
  }
  if (!phone) {
    return json({ success: false, error: 'That does not look like a valid mobile number.' }, 400);
  }

  // Refuse before minting, not after — see canSendFreeform.
  let windowOpen: boolean;
  try {
    windowOpen = await canSendFreeform(sb, phone);
  } catch (e) {
    console.error('[whatsapp-enrol-staff] window check failed:', e);
    return json({ success: false, error: 'Could not check the WhatsApp window. Please try again.' }, 503);
  }
  if (!windowOpen) {
    return json(
      {
        success: false,
        code_sent: false,
        window_closed: true,
        error:
          'WhatsApp will not let us message this number first. Ask them to send any message ' +
          'to the Macavation WhatsApp number, then press this again within 24 hours.',
      },
      409
    );
  }

  // Mints the code AND enforces its own preconditions: target user exists and is active, the
  // number is not already verified on a DIFFERENT user, and (defence in depth) the requesting
  // user manages users. Its {success:0,error} is a refusal, not a crash — surface it as 400.
  let started: AnyRow | null;
  try {
    const rows = await rpc(sb, 'whatsapp_start_enrolment', {
      p_requesting_user_id: requestingUserId,
      p_user_id: targetUserId,
      p_phone: phone,
    });
    started = rows?.[0] ?? null;
  } catch (e) {
    console.error('[whatsapp-enrol-staff] whatsapp_start_enrolment failed:', e);
    return json({ success: false, error: 'Could not start enrolment. Please try again.' }, 503);
  }

  if (!started || Number(started.success) !== 1 || !started.code) {
    // started.error is authored by the RPC and safe to show — it names a precondition the admin
    // can act on ("already verified on a different user", "target user not found or inactive").
    return json({ success: false, error: String(started?.error || 'Could not start enrolment.') }, 400);
  }

  const code = String(started.code);

  const message =
    `Macavation: your WhatsApp enrolment code is ${code}\n\n` +
    `Reply to this chat with just those 6 digits to finish linking this number to your ` +
    `Macavation account. The code expires in 15 minutes.\n\n` +
    `If you did not expect this, ignore it — nothing changes until the code is sent back.`;

  // toWaPhone only prefixes '+': `phone` is already the DB's canonical bare-digit international
  // form by this point, which is exactly the input that function documents.
  const result = await sendText(toWaPhone(phone), message);

  if (!result.ok) {
    // NEVER include `code` or `message` in a log line or an error string.
    console.error(`[whatsapp-enrol-staff] send failed for ${maskPhone(phone)}: ${result.error}`);
    return json(
      {
        success: false,
        code_sent: false,
        error: `The code was created but WhatsApp did not accept the message: ${result.error}`,
      },
      502
    );
  }

  console.log(
    `[whatsapp-enrol-staff] enrolment code sent to ${maskPhone(phone)} for user ${targetUserId}`
  );

  return json({
    success: true,
    code_sent: true,
    phone_masked: maskPhone(phone),
    expires_in_minutes: 15,
  });
});
