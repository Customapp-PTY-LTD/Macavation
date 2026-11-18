/**
 * Proof of delivery reader - shared by:
 *   read-import-file (action read_pod)   the "Read the proof of delivery" button on Book in a truck
 *   whatsapp-inbound                     a POD photo sent to the Macavation WhatsApp number
 *
 * One Claude call with structured output: a transporter's POD photo / PDF -> the New Delivery
 * fields, each with a 0..1 confidence. Suppliers, transporters and transport types go in as NAMES
 * only so the model can pick the matching one; ids never leave the caller. Nothing is saved here.
 *
 * Never throws: resolves to { ok: true, data } or { ok: false, error, status } with a sentence a
 * farm administrator can read. Logs carry the caller label, user id, tokens and time - never the
 * document or what was read from it.
 */
import Anthropic from "npm:@anthropic-ai/sdk";

// deno-lint-ignore no-explicit-any
type AnyRow = Record<string, any>;

export const POD_MODEL = "claude-opus-5-5";
export const POD_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "application/pdf"]);

export interface PodInput {
  mediaType: string;
  dataBase64: string;
  suppliers?: unknown;
  transporters?: unknown;
  transportTypes?: unknown;
}

export type PodResult =
  | { ok: true; data: AnyRow }
  | { ok: false; error: string; status: number };

function cell(v: unknown): string {
  return String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
}

/** Unique, trimmed names, capped. */
export function podNameList(raw: unknown, max: number): string[] {
  const out: string[] = [];
  for (const v of (Array.isArray(raw) ? raw : []).slice(0, max)) {
    const n = cell(v);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

function podField(valueSchema: AnyRow): AnyRow {
  return {
    type: "object",
    additionalProperties: false,
    required: ["value", "confidence"],
    properties: { value: valueSchema, confidence: { type: "number" } },
  };
}

function pickOne(names: string[]): AnyRow {
  return names.length ? { anyOf: [{ type: "string", enum: names }, { type: "null" }] } : { type: "null" };
}

const FIELD_KEYS = [
  "document_number", "load_number", "offloading_date", "loading_date", "sender_name", "supplier_match",
  "transporter_name", "transporter_match", "transport_type_match", "declared_kg", "bag_count",
  "product", "truck_reg", "trailer_reg", "driver_name",
];

export function podSchema(suppliers: string[], transporters: string[], transportTypes: string[]): AnyRow {
  const text = { type: "string" };
  return {
    type: "object",
    additionalProperties: false,
    required: ["note", "is_proof_of_delivery", ...FIELD_KEYS],
    properties: {
      note: text,
      is_proof_of_delivery: { type: "boolean" },
      document_number: podField(text),
      load_number: podField(text),
      offloading_date: podField(text),
      loading_date: podField(text),
      sender_name: podField(text),
      supplier_match: podField(pickOne(suppliers)),
      transporter_name: podField(text),
      transporter_match: podField(pickOne(transporters)),
      transport_type_match: podField(pickOne(transportTypes)),
      declared_kg: podField(text),
      bag_count: podField(text),
      product: podField({ type: "string", enum: ["NIS", "Kernel", ""] }),
      truck_reg: podField(text),
      trailer_reg: podField(text),
      driver_name: podField(text),
    },
  };
}

export const POD_SYSTEM =
  "You read a transporter's proof of delivery (POD) / delivery note for a macadamia processor that is " +
  "receiving a truck. Forms are often bilingual Afrikaans/English and partly handwritten " +
  "(Afsender = sender, Ontvanger = receiver, Vrag No. = load number, Massa = mass, Laaidatum = loading " +
  "date, Aflaaidatum = offloading date, Voorhaker = truck/horse, Sleepwa = trailer, Drywer = driver). Fill:\n" +
  "- is_proof_of_delivery: true for a POD, delivery note, consignment note or weighbridge slip for a " +
  "delivery; false for anything else (then leave every field empty).\n" +
  "- document_number: the form's own printed number (e.g. 'No.: 50495').\n" +
  "- load_number: a separate load / consignment / 'Vrag No.' number if one is written, else empty.\n" +
  "- offloading_date and loading_date as YYYY-MM-DD, each only if written (empty otherwise). South " +
  "African dates are day/month/year (12/11/2026 is 2026-11-12).\n" +
  "- sender_name: the sender / supplier / farm exactly as written. supplier_match: the one name from the " +
  "supplier list that is clearly the same business (ignore Pty Ltd, CC, 'en Seuns'/'and Sons', spacing, " +
  "punctuation), or null if none clearly matches. Never match on the transporter's name.\n" +
  "- transporter_name: the transport company (usually printed at the top). transporter_match: the same " +
  "company from the transporter list, or null.\n" +
  "- transport_type_match: from the transport type list; a truck with a trailer carrying over about 20 " +
  "tonnes is usually a Link. null if you cannot tell.\n" +
  "- declared_kg: total mass in kg as plain digits with no separators or unit (e.g. '33040'); convert " +
  "tonnes to kg only if the unit is clearly tonnes.\n" +
  "- bag_count: number of bags / bulk bags / pallets as digits.\n" +
  "- product: 'NIS' for nut in shell (macadamia nuts, bulk bags of nuts), 'Kernel' for kernel, else ''.\n" +
  "- truck_reg, trailer_reg, driver_name as written.\n" +
  "Where something is not on the page or cannot be read, give an empty string (or null for a match) with " +
  "confidence 0 rather than guessing. Confidence is 0 to 1; lower it for unclear handwriting. 'note' is " +
  "one short plain-English sentence about what the document is and anything the person should check.";

/** An Anthropic client from ASSISTANT_AI_API_KEY or ANTHROPIC_API_KEY, or null when neither is set. */
export function podClient(): Anthropic | null {
  const key = (Deno.env.get("ASSISTANT_AI_API_KEY") || Deno.env.get("ANTHROPIC_API_KEY") || "").trim();
  return key ? new Anthropic({ apiKey: key }) : null;
}

export async function readPod(anthropic: Anthropic, input: PodInput, label: string, userId: string): Promise<PodResult> {
  const mediaType = String(input.mediaType || "").toLowerCase();
  if (!POD_MEDIA_TYPES.has(mediaType)) {
    return { ok: false, error: "Only a photo (JPG or PNG) or a PDF can be read.", status: 400 };
  }
  const data = String(input.dataBase64 || "").replace(/\s+/g, "");
  if (!data || !/^[A-Za-z0-9+/=]+$/.test(data)) {
    return { ok: false, error: "The photo could not be read.", status: 400 };
  }
  const suppliers = podNameList(input.suppliers, 600);
  const transporters = podNameList(input.transporters, 200);
  const transportTypes = podNameList(input.transportTypes, 40);

  const fileBlock = mediaType === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: mediaType, data } }
    : { type: "image", source: { type: "base64", media_type: mediaType, data } };
  const lists = "Supplier list: " + JSON.stringify(suppliers) +
    "\nTransporter list: " + JSON.stringify(transporters) +
    "\nTransport type list: " + JSON.stringify(transportTypes);

  const started = Date.now();
  try {
    // deno-lint-ignore no-explicit-any
    const params: any = {
      model: POD_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: podSchema(suppliers, transporters, transportTypes) } },
      system: POD_SYSTEM,
      messages: [{ role: "user", content: [fileBlock, { type: "text", text: lists }] }],
    };
    // deno-lint-ignore no-explicit-any
    const res: any = await anthropic.beta.messages.create(params);
    console.log(JSON.stringify({
      fn: label, action: "read_pod", user: userId, model: res.model, ms: Date.now() - started,
      in: res.usage?.input_tokens, out: res.usage?.output_tokens, stop: res.stop_reason,
    }));
    if (res.stop_reason === "refusal") {
      return { ok: false, error: "The AI declined to read this document. Fill the form in by hand.", status: 422 };
    }
    if (res.stop_reason === "max_tokens") {
      return { ok: false, error: "The AI could not finish reading this document. Try a clearer photo.", status: 422 };
    }
    const text = (res.content || []).filter((b: AnyRow) => b.type === "text").map((b: AnyRow) => b.text).join("");
    return { ok: true, data: JSON.parse(text) };
  } catch (e) {
    const status = e instanceof Anthropic.APIError ? e.status ?? 502 : 502;
    console.error(`[${label}] read_pod model call failed:`, status, e instanceof Error ? e.message : e);
    if (e instanceof Anthropic.AuthenticationError) {
      return { ok: false, error: "AI reading is not set up on this server (the key was refused).", status: 503 };
    }
    if (e instanceof Anthropic.RateLimitError) {
      return { ok: false, error: "The AI is busy. Wait a minute and try again.", status: 429 };
    }
    if (e instanceof Anthropic.BadRequestError) {
      return { ok: false, error: "The AI could not read this photo. Try a clearer photo.", status: 422 };
    }
    return { ok: false, error: "The AI could not be reached. Try again shortly.", status: 502 };
  }
}
