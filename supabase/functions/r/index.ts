/**
 * Supabase Edge Function: public, UNAUTHENTICATED redirector for WhatsApp report short-link
 * codes. A published Sales & Production report's WhatsApp message/template button carries a
 * short code (`/r/<code>`, or `?c=<code>`) instead of a long-lived signed Storage URL. Tapping
 * it resolves the code, mints a brand-new SHORT-LIVED signed URL, and 302s straight to it — the
 * confidential link is never pasted into the chat itself and never sits anywhere longer than it
 * takes to redirect.
 *
 * Deploy: supabase functions deploy r --project-ref nmdmddugxclpqrwylyfa --no-verify-jwt
 * --no-verify-jwt is REQUIRED: this is opened from a phone's browser with no Supabase auth JWT,
 * no portal session, no credential of any kind — a JWT check would 401 every real tap. (See
 * config.toml beside this file, which disables verify_jwt at the project-config level too.)
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-provided by the runtime)
 * RPC: resolve_report_link_code(p_code text) -> jsonb
 *   success: { ok: true, bucket, path, filename }
 *   failure: { ok: false, reason: 'not_found' | 'expired' | 'revoked' }
 *   The RPC records the hit itself — this function does not write anything.
 * NOTE: as of this file's authorship, resolve_report_link_code does not exist yet and no
 * WhatsApp message contains a code yet — this function is deployed ahead of both, and nothing
 * reaches it in practice until the migration is applied and a caller starts issuing codes.
 *
 * SECURITY — this function holds the service-role key and is the ONLY way a browser reaches the
 * private `report-pdfs` bucket (migrations/20260822090100_report_pdf_storage_bucket.sql:8-27 —
 * no RLS policy at all on that bucket, service_role only). Every input here is from an anonymous
 * phone with no credential. Rules a future edit MUST preserve:
 *   - The code is the only secret. Never echo it back in a response body or error message, and
 *     never log more than its first 4 characters.
 *   - Never put the storage path, bucket name, or signed URL in a response BODY. The only
 *     success response is a 302 whose Location header carries the signed URL.
 *   - Reject anything not matching CODE_RE before ANY database or storage call — this is also
 *     what stops path traversal from ever reaching the storage call.
 *   - not_found / expired / revoked all produce the exact SAME generic 404 page. Never let the
 *     response distinguish them — a distinguishable "expired" confirms a code was once real.
 *   - No CORS headers anywhere. This is a top-level browser navigation, not an XHR; adding
 *     Access-Control-Allow-Origin would let any site probe codes from a victim's browser.
 *   - Signed URL TTL is 300 seconds — long enough to start a download on a slow phone, short
 *     enough that a shoulder-surfed URL is worthless soon after. Do not reuse the unrelated
 *     30-day LINK_TTL_SECONDS constant from send-report-whatsapp/index.ts — that is a different
 *     lifetime for a different purpose (how long the *code* can be used to mint a new link).
 */
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

// deno-lint-ignore no-explicit-any
type AnyRow = Record<string, any>;

const CODE_RE = /^[A-Za-z0-9_-]{8,64}$/;
const SIGNED_URL_TTL_SECONDS = 300;

function makeServiceClient(): SupabaseClient | null {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return null;
  return createClient(url, key);
}

/**
 * A tiny, self-contained HTML page for every non-redirect outcome. No stack trace, no code, no
 * mention of storage/buckets/Supabase — written for the person who tapped the link, not a
 * developer. `emptyBody` is set for HEAD requests, which must not carry a body.
 */
function htmlPage(status: number, heading: string, message: string, emptyBody: boolean): Response {
  const body = emptyBody
    ? null
    : `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Macavation</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 72px auto; padding: 0 24px; color: #1a1a1a; text-align: center;">
  <h1 style="font-size: 20px; margin-bottom: 12px;">${heading}</h1>
  <p style="font-size: 16px; line-height: 1.5; color: #444;">${message}</p>
</body>
</html>`;
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}

/** Used for unknown, expired AND revoked codes alike — see the security note above. */
function notFoundPage(emptyBody: boolean): Response {
  return htmlPage(
    404,
    'This report link is no longer available.',
    'Links expire for security. Ask whoever sent it to share the report again.',
    emptyBody
  );
}

/** Used for our own transient failures (missing config, RPC error, storage error). */
function tryAgainPage(status: number, emptyBody: boolean): Response {
  return htmlPage(
    status,
    'This report link is no longer available.',
    'Something went wrong opening this report. Please try again shortly, or ask whoever sent it to share it again.',
    emptyBody
  );
}

/**
 * The code comes from the path (`/r/<code>` via a rewrite, or the last path segment of the
 * unrewritten `/functions/v1/r/<code>`), falling back to `?c=<code>`. A path that ends in `r`
 * with nothing after it — a bare hit on the function's own route — is treated as "no code in
 * the path" so the query fallback still gets a chance.
 */
function extractCode(url: URL): string {
  const segments = url.pathname.split('/').filter(Boolean);
  const last = segments.length ? segments[segments.length - 1] : '';
  if (last && last.toLowerCase() !== 'r') return last;
  return (url.searchParams.get('c') || '').trim();
}

Deno.serve(async (req) => {
  const method = req.method.toUpperCase();

  // No CORS headers are ever set in this function — see the security note above.
  if (method === 'OPTIONS') {
    return new Response(null, { status: 405 });
  }
  if (method !== 'GET' && method !== 'HEAD') {
    return new Response(null, { status: 405 });
  }
  const emptyBody = method === 'HEAD';

  const url = new URL(req.url);
  const code = extractCode(url);

  // ---- 1/2. Extract + validate — reject before touching the database or storage ------------
  if (!code) {
    return notFoundPage(emptyBody);
  }
  if (!CODE_RE.test(code)) {
    // Length only, never the value — a rejected code may still be someone's real secret typed
    // wrong, and this is also what keeps a path-traversal attempt (e.g. "../../secrets") out of
    // the log verbatim.
    console.warn('[r] rejected code failing format check, length =', code.length);
    return notFoundPage(emptyBody);
  }

  // ---- 3. Service client ---------------------------------------------------------------------
  const sb = makeServiceClient();
  if (!sb) {
    // Missing env is OUR failure, not a bad code — 503, not 404, so nobody chases the wrong
    // thing ("my link is dead") when the real problem is a misconfigured deploy.
    console.error('[r] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured');
    return tryAgainPage(503, emptyBody);
  }

  // ---- 4. Resolve the code --------------------------------------------------------------------
  // resolve_report_link_code returns jsonb directly (a single object, never an array) — like
  // get_report_instance in send-report-whatsapp/index.ts, this is NOT a TABLE-returning RPC, so
  // it is called directly rather than through an array-normalising helper.
  let resolved: AnyRow | null = null;
  try {
    const { data, error } = await sb.rpc('resolve_report_link_code', { p_code: code });
    if (error) throw new Error(error.message);
    resolved = (data as AnyRow) ?? null;
  } catch (e) {
    console.error('[r] resolve_report_link_code RPC failed:', e);
    return tryAgainPage(503, emptyBody);
  }

  if (!resolved || resolved.ok !== true) {
    // not_found / expired / revoked all produce the exact same response to the caller. The true
    // reason is logged server-side only, alongside just the code's first 4 characters — never
    // the whole code, which is a working credential.
    console.warn('[r] code not usable, reason =', resolved?.reason ?? 'unknown', ', prefix =', code.slice(0, 4));
    return notFoundPage(emptyBody);
  }

  const bucket = typeof resolved.bucket === 'string' ? resolved.bucket : '';
  const path = typeof resolved.path === 'string' ? resolved.path : '';
  const filename = typeof resolved.filename === 'string' && resolved.filename ? resolved.filename : undefined;

  if (!bucket || !path) {
    console.error('[r] resolve_report_link_code returned ok:true with a missing bucket or path');
    return tryAgainPage(502, emptyBody);
  }

  // ---- 5. Short-lived signed URL ---------------------------------------------------------------
  const signOptions = filename ? { download: filename } : undefined;
  const { data: signedData, error: signedError } = await sb.storage
    .from(bucket)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS, signOptions);

  if (signedError || !signedData?.signedUrl) {
    console.error('[r] createSignedUrl failed:', signedError?.message);
    return tryAgainPage(502, emptyBody);
  }

  // ---- 6. Redirect ----------------------------------------------------------------------------
  // The signed URL is a bearer credential for a confidential document: it goes ONLY into the
  // Location header, never into a log line, never into a response body.
  //   - no-store: a cached redirect would outlive the 300-second URL it points at and break
  //     confusingly well after the fact.
  //   - no-referrer: stops the signed URL leaking to whatever the PDF viewer loads next.
  return new Response(null, {
    status: 302,
    headers: {
      Location: signedData.signedUrl,
      'Cache-Control': 'no-store, max-age=0',
      'Referrer-Policy': 'no-referrer',
    },
  });
});
