// Supabase Edge Function: Google sign-in for the Macavation portal.
//
// Replaces the AWS Lambda /auth/login (provider: google) endpoint. The
// browser cannot safely verify a Google id_token signature, so this is the
// one auth step that needs a server — done here, inside Supabase.
//
// Flow: verify id_token via Google's tokeninfo endpoint (signature + expiry
// checked by Google), assert audience matches our OAuth client, look up the
// user by email in public.users (service role), return the same
// { success, token, user } shape as the auth_login_email RPC.
import { createClient } from "npm:@supabase/supabase-js@2";

const GOOGLE_CLIENT_ID =
  "753420461338-f17hesq624p8ubcs67s1rp8hmnbp97ff.apps.googleusercontent.com";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-user-id",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { id_token } = await req.json().catch(() => ({} as Record<string, unknown>));
    if (!id_token || typeof id_token !== "string") {
      return json({ success: false, message: "id_token is required." }, 400);
    }

    const verify = await fetch(
      "https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(id_token),
    );
    if (!verify.ok) {
      return json({ success: false, message: "Invalid Google token." }, 401);
    }
    const info = await verify.json();

    if (info.aud !== GOOGLE_CLIENT_ID) {
      return json({ success: false, message: "Google token audience mismatch." }, 401);
    }
    if (String(info.email_verified) !== "true" || !info.email) {
      return json({ success: false, message: "Google account email is not verified." }, 401);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: users, error } = await admin
      .from("users")
      .select("id, email, username, role, role_id, is_active, roles(role_name)")
      .ilike("email", info.email)
      .limit(1);
    if (error) {
      console.error("user lookup failed:", error.message);
      return json({ success: false, message: "User lookup failed." }, 500);
    }

    const u = users?.[0];
    if (!u) {
      return json(
        { success: false, message: `No account exists for ${info.email}. Ask an administrator to create one.` },
        403,
      );
    }
    if (u.is_active !== true) {
      return json({ success: false, message: "This account is inactive." }, 403);
    }

    // Client-side session marker only — PostgREST authorization rides on the
    // anon key, same as email sign-in (see auth_login_email).
    const token =
      crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");

    return json({
      success: true,
      token,
      user: {
        id: u.id,
        email: u.email,
        username: u.username,
        role: u.role,
        role_id: u.role_id,
        role_name: (u as { roles?: { role_name?: string } }).roles?.role_name ?? null,
        is_active: u.is_active,
      },
    });
  } catch (e) {
    console.error("auth-google error:", e);
    return json({ success: false, message: "Google sign-in failed." }, 500);
  }
});
