/**
 * read-import-file - the AI half of "Fill gaps from a file" (Sales & Production Data > Data health).
 *
 * Two actions (POST body { action: ... }):
 *   map_columns   - given a spreadsheet's sheet names, headings and up to 5 sample rows, say which
 *                   sheet holds the transactions and which column goes into which data-page field.
 *                   Only headings and samples are ever sent; every value is read in the browser,
 *                   so no figure is ever produced by the model.
 *   read_document - read a photo (jpeg/png) or PDF of a delivery note / invoice into rows, with a
 *                   confidence per field. The person checks every row before anything is saved.
 *
 * This function never writes to the database. Saving goes through import_data_page_rows
 * (migrations/20261015090000_data_page_import_batches.sql) from the browser, after review.
 *
 * Auth: the X-Portal-Session header, validated through the service-role RPC
 * assistant_validate_session (same as portal-assistant) - fail closed. Because each call costs
 * money, the session's role must also hold reports.data.edit (data_import_role_can_edit), else 403.
 *
 * Env vars:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY - service-role DB access for the two checks above.
 *   ASSISTANT_AI_API_KEY (or ANTHROPIC_API_KEY) - Anthropic API key (shared with portal-assistant).
 *
 * Logs carry the action, the user id, token usage and duration only - never file contents.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, apikey, x-client-info, x-portal-session, X-Portal-Session",
};

const MODEL = "claude-opus-5-5";
const MAX_BODY_BYTES = 12 * 1024 * 1024;
const MAX_SHEETS = 12;
const MAX_COLUMNS = 80;
const MAX_SAMPLE_ROWS = 5;
const MAX_CELL_CHARS = 120;
const DOCUMENT_TYPES = new Set(["image/jpeg", "image/png", "application/pdf"]);

// deno-lint-ignore no-explicit-any
type AnyRow = Record<string, any>;

interface TargetField {
  key: string;
  label: string;
  type: string;
}

function jsonResponse(data: AnyRow, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function makeServiceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function rpcRows(sb: SupabaseClient, fn: string, params: AnyRow): Promise<AnyRow[]> {
  const { data, error } = await sb.rpc(fn, params);
  if (error) throw new Error(`[rpc:${fn}] ${error.message}`);
  if (Array.isArray(data)) return data as AnyRow[];
  if (data && typeof data === "object") return [data as AnyRow];
  return [];
}

// ── Session + permission ──────────────────────────────────────────────────

async function checkCaller(sb: SupabaseClient, token: string): Promise<{ userId: string } | { error: string; status: number }> {
  if (!token) return { error: "Please sign in again.", status: 401 };
  let row: AnyRow | null = null;
  try {
    row = (await rpcRows(sb, "assistant_validate_session", { p_token: token }))[0] ?? null;
  } catch (e) {
    console.error("[read-import-file] session check failed:", e);
    return { error: "Sign-in could not be checked. Please try again.", status: 503 };
  }
  if (!row || !row.user_id) return { error: "Your session has expired. Please sign in again.", status: 401 };

  let allowed = false;
  try {
    const { data, error } = await sb.rpc("data_import_role_can_edit", { p_role_name: row.role_name ?? null });
    if (error) throw new Error(error.message);
    allowed = data === true;
  } catch (e) {
    console.error("[read-import-file] permission check failed:", e);
    return { error: "Permissions could not be checked. Please try again.", status: 503 };
  }
  if (!allowed) return { error: "Your role cannot import data. Ask an admin for the 'Edit Data Page' permission.", status: 403 };
  return { userId: String(row.user_id) };
}

// ── Input clean-up ────────────────────────────────────────────────────────

function cleanFields(raw: unknown): TargetField[] {
  if (!Array.isArray(raw)) return [];
  const out: TargetField[] = [];
  for (const f of raw.slice(0, 40)) {
    const key = String(f?.key ?? "").trim();
    if (!/^[a-z][a-z0-9_]{0,40}$/.test(key)) continue;
    out.push({ key, label: String(f?.label ?? key).slice(0, 60), type: String(f?.type ?? "text").slice(0, 20) });
  }
  return out;
}

function cell(v: unknown): string {
  return String(v ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_CELL_CHARS);
}

// ── Model call ────────────────────────────────────────────────────────────

function client(): Anthropic | null {
  const key = (Deno.env.get("ASSISTANT_AI_API_KEY") || Deno.env.get("ANTHROPIC_API_KEY") || "").trim();
  return key ? new Anthropic({ apiKey: key }) : null;
}

// One structured-output call. Returns the parsed JSON, or an error sentence for the person.
async function askForJson(
  anthropic: Anthropic,
  effort: "low" | "medium",
  system: string,
  content: AnyRow[],
  schema: AnyRow,
  label: string,
  userId: string,
): Promise<{ ok: true; data: AnyRow } | { ok: false; error: string; status: number }> {
  const started = Date.now();
  try {
    // deno-lint-ignore no-explicit-any
    const params: any = {
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort, format: { type: "json_schema", schema } },
      system,
      messages: [{ role: "user", content }],
    };
    // deno-lint-ignore no-explicit-any
    const res: any = await anthropic.beta.messages.create(params);
    console.log(JSON.stringify({
      fn: "read-import-file", action: label, user: userId, model: res.model, ms: Date.now() - started,
      in: res.usage?.input_tokens, out: res.usage?.output_tokens, stop: res.stop_reason,
    }));
    if (res.stop_reason === "refusal") {
      return { ok: false, error: "The AI declined to read this file. Match the columns yourself, or type the rows in.", status: 422 };
    }
    if (res.stop_reason === "max_tokens") {
      return { ok: false, error: "The file has too many rows to read in one go. Split it into smaller files.", status: 422 };
    }
    const text = (res.content || []).filter((b: AnyRow) => b.type === "text").map((b: AnyRow) => b.text).join("");
    return { ok: true, data: JSON.parse(text) };
  } catch (e) {
    const status = e instanceof Anthropic.APIError ? e.status ?? 502 : 502;
    console.error("[read-import-file] model call failed:", label, status, e instanceof Error ? e.message : e);
    if (e instanceof Anthropic.AuthenticationError) {
      return { ok: false, error: "AI reading is not set up on this server (the key was refused).", status: 503 };
    }
    if (e instanceof Anthropic.RateLimitError) {
      return { ok: false, error: "The AI is busy. Wait a minute and try again.", status: 429 };
    }
    if (e instanceof Anthropic.BadRequestError) {
      return { ok: false, error: "The AI could not read this file. Check it opens, or try a clearer photo.", status: 422 };
    }
    return { ok: false, error: "The AI could not be reached. Try again shortly.", status: 502 };
  }
}

// ── map_columns ───────────────────────────────────────────────────────────

async function handleMapColumns(anthropic: Anthropic, body: AnyRow, userId: string): Promise<Response> {
  const fields = cleanFields(body.target_fields);
  if (!fields.length) return jsonResponse({ success: false, error: "No target fields were sent." }, 400);
  const sheets = (Array.isArray(body.sheets) ? body.sheets : []).slice(0, MAX_SHEETS).map((s: AnyRow) => ({
    name: cell(s?.name),
    headers: (Array.isArray(s?.headers) ? s.headers : []).slice(0, MAX_COLUMNS).map(cell),
    sample_rows: (Array.isArray(s?.sample_rows) ? s.sample_rows : []).slice(0, MAX_SAMPLE_ROWS)
      .map((r: unknown) => (Array.isArray(r) ? r : []).slice(0, MAX_COLUMNS).map(cell)),
  })).filter((s: AnyRow) => s.headers.length);
  if (!sheets.length) return jsonResponse({ success: false, error: "The file has no sheet with column headings." }, 400);

  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["sheet", "mapping", "note"],
    properties: {
      sheet: { type: "string", enum: sheets.map((s: AnyRow) => s.name) },
      note: { type: "string" },
      mapping: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["column", "field", "confidence"],
          properties: {
            column: { type: "string" },
            field: { anyOf: [{ type: "string", enum: fields.map((f) => f.key) }, { type: "null" }] },
            confidence: { type: "number" },
          },
        },
      },
    },
  };

  const system =
    "You map spreadsheet columns onto the fields of a data-entry page for a macadamia processor. " +
    "Choose the sheet that holds one row per transaction (a delivery, an invoice line, an export). " +
    "Ignore pivot, summary, chart and lookup sheets. For the chosen sheet, give one mapping entry per " +
    "column heading, in the order the headings appear. Map a column to at most one field and use each " +
    "field at most once; use null for a column that does not belong to any field. Confidence is 0 to 1. " +
    "In 'note', say in one short plain-English sentence which sheet you chose and why.";
  const prompt = JSON.stringify({ page: String(body.dataset_key || ""), fields, sheets });

  const r = await askForJson(anthropic, "low", system, [{ type: "text", text: prompt }], schema, "map_columns", userId);
  if (!r.ok) return jsonResponse({ success: false, error: r.error }, r.status);
  return jsonResponse({ success: true, data: r.data });
}

// ── read_document ─────────────────────────────────────────────────────────

async function handleReadDocument(anthropic: Anthropic, body: AnyRow, userId: string): Promise<Response> {
  const fields = cleanFields(body.target_fields);
  if (!fields.length) return jsonResponse({ success: false, error: "No target fields were sent." }, 400);
  const mediaType = String(body.media_type || "");
  if (!DOCUMENT_TYPES.has(mediaType)) {
    return jsonResponse({ success: false, error: "Only JPG, PNG or PDF files can be read." }, 400);
  }
  const data = String(body.data_base64 || "").replace(/\s+/g, "");
  if (!data || !/^[A-Za-z0-9+/=]+$/.test(data)) {
    return jsonResponse({ success: false, error: "The file could not be read." }, 400);
  }

  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["rows", "note"],
    properties: {
      note: { type: "string" },
      rows: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["fields"],
          properties: {
            fields: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["key", "value", "confidence"],
                properties: {
                  key: { type: "string", enum: fields.map((f) => f.key) },
                  value: { type: "string" },
                  confidence: { type: "number" },
                },
              },
            },
          },
        },
      },
    },
  };

  const system =
    "You transcribe delivery notes, weighbridge slips and invoices for a macadamia processor into rows. " +
    "One row per line item or delivery. Transcribe exactly what is written: keep numbers and dates as " +
    "written (do not convert units, do not add or remove digits). Where a field is not on the page or " +
    "cannot be read, leave its value empty with confidence 0 rather than guessing. Confidence is 0 to 1 " +
    "and should be lower for handwriting or anything smudged. In 'note', say in one short plain-English " +
    "sentence what the document is.";
  const fileBlock = mediaType === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: mediaType, data } }
    : { type: "image", source: { type: "base64", media_type: mediaType, data } };
  const text = "Fields to fill: " + JSON.stringify(fields) + ". Page: " + String(body.dataset_key || "");

  const r = await askForJson(anthropic, "medium", system, [fileBlock, { type: "text", text }], schema, "read_document", userId);
  if (!r.ok) return jsonResponse({ success: false, error: r.error }, r.status);
  return jsonResponse({ success: true, data: r.data });
}

// ── Handler ───────────────────────────────────────────────────────────────

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return jsonResponse({ success: false, error: "Method not allowed" }, 405);

  const length = Number(req.headers.get("content-length") || "0");
  if (length > MAX_BODY_BYTES) return jsonResponse({ success: false, error: "The file is too large." }, 413);

  let body: AnyRow;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return jsonResponse({ success: false, error: "The file is too large." }, 413);
    body = JSON.parse(raw);
  } catch {
    return jsonResponse({ success: false, error: "The request could not be read." }, 400);
  }

  const action = String(body.action || "");
  if (action !== "map_columns" && action !== "read_document") {
    return jsonResponse({ success: false, error: "Unknown action." }, 400);
  }

  const sb = makeServiceClient();
  const caller = await checkCaller(sb, (req.headers.get("x-portal-session") || "").trim());
  if ("error" in caller) return jsonResponse({ success: false, error: caller.error }, caller.status);

  const anthropic = client();
  if (!anthropic) return jsonResponse({ success: false, error: "AI reading is not set up on this server." }, 503);

  try {
    if (action === "map_columns") return await handleMapColumns(anthropic, body, caller.userId);
    return await handleReadDocument(anthropic, body, caller.userId);
  } catch (e) {
    console.error("[read-import-file] action failed:", action, e instanceof Error ? e.message : e);
    return jsonResponse({ success: false, error: "Something went wrong reading the file." }, 500);
  }
}

if (import.meta.main) {
  Deno.serve(handler);
}
