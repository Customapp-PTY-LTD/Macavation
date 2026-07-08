/**
 * Supabase Edge Function: forgot-password.
 * Creates a single-use reset token (server-side) and emails the reset link.
 * Always returns a generic success so it never reveals whether an account exists.
 *
 * Deploy: supabase functions deploy send-password-reset
 * Requires secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY,
 *   RESET_FROM_EMAIL (optional), RESET_REDIRECT_BASE (optional fallback).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function ok() {
  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const email = (body.email || '').toString().trim().toLowerCase();
    const redirectBase = (body.redirect_base || '').toString().replace(/\/+$/, '');
    if (!email) return ok();

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Server-side token creation; returns null for unknown/inactive accounts.
    const { data: token, error } = await supabase.rpc('create_password_reset_token', { p_email: email });
    if (error) { console.error('create_password_reset_token error', error); return ok(); }
    if (!token) return ok();

    const base = redirectBase || (Deno.env.get('RESET_REDIRECT_BASE') ?? '');
    const link = `${base}/reset-password.html?token=${token}`;

    const resendKey = Deno.env.get('RESEND_API_KEY');
    const fromEmail = Deno.env.get('RESET_FROM_EMAIL') ?? Deno.env.get('DIGEST_FROM_EMAIL') ?? 'no-reply@macavation.co.za';

    if (resendKey) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: fromEmail,
          to: [email],
          subject: 'Reset your Macavation password',
          html: `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#1F1F1F">
<h2>Reset your password</h2>
<p>We received a request to reset your Macavation portal password.</p>
<p><a href="${link}" style="background:#198754;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Reset password</a></p>
<p>Or paste this link into your browser:<br><a href="${link}">${link}</a></p>
<p style="color:#666;font-size:12px">This link expires in 1 hour. If you didn't request it, you can safely ignore this email.</p>
</body></html>`,
        }),
      });
      if (!res.ok) console.error('Resend failed', await res.text());
    } else {
      // No email provider configured (e.g. dev) — log the link for manual testing.
      console.log('[password-reset] no RESEND_API_KEY; link for', email, link);
    }

    return ok();
  } catch (e) {
    console.error('send-password-reset error', e);
    return ok();
  }
});
