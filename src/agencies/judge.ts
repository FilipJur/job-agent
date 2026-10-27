/**
 * LLM judgment for one agency: sends the candidate pages' text to the scoring
 * endpoint/model (config/scoring.json, Responses API client) under the agency
 * rubric (config/agency-rubric.md). Reuses the client's HTTP layer.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultPostJson, type PostJson } from "../scoring/client";
import type { AgencyForm } from "../types";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface AgencyPage {
  url: string;
  text: string;
}

export interface AgencyJudgment {
  devPositionOpen: boolean;
  positionTitle: string | null;
  positionUrl: string | null;
  evidenceQuote: string | null;
  form: AgencyForm | null;
  devRate: string | null;
  remoteOrOlomouc: boolean;
  fit: number | null;
  reason: string | null;
}

export interface JudgeOptions {
  endpoint: string;
  model: string;
  apiKey: string;
  sessionId: string;
  postJson?: PostJson;
  now?: () => string;
}

export const MAX_JUDGE_CHARS_PER_PAGE = 6000;

const AGENCY_SCHEMA = {
  type: "object",
  properties: {
    devPositionOpen: { type: "boolean" },
    positionTitle: { type: ["string", "null"] },
    positionUrl: { type: ["string", "null"] },
    evidenceQuote: { type: "string" },
    form: { type: "string", enum: ["ico", "hpp", "both", "unknown"] },
    devRate: { type: ["string", "null"] },
    remoteOrOlomouc: { type: "boolean" },
    fit: { type: "number", minimum: 0, maximum: 10 },
    reason: { type: "string" },
  },
  required: ["devPositionOpen", "positionTitle", "positionUrl", "evidenceQuote", "form", "devRate", "remoteOrOlomouc", "fit", "reason"],
  additionalProperties: false,
};

const JSON_SCHEMA_FORMAT = { type: "json_schema", name: "agency_judgment", schema: AGENCY_SCHEMA };

function readRubric(): string {
  return readFileSync(join(root, "config", "agency-rubric.md"), "utf8");
}

/** Builds the model input: rubric + fetched pages (url + truncated text each). */
export function buildAgencyInput(pages: AgencyPage[]): string {
  const rubric = readRubric();
  const body = pages.map((p) => `URL: ${p.url}\nTEXT:\n${p.text.slice(0, MAX_JUDGE_CHARS_PER_PAGE)}`).join("\n\n---\n\n");
  return `${rubric}\n\nFetched pages:\n\n${body}\n\nReply with ONLY the JSON object, no other text.`;
}

interface RawJudgment {
  devPositionOpen: unknown;
  positionTitle: unknown;
  positionUrl: unknown;
  evidenceQuote: unknown;
  form: unknown;
  devRate: unknown;
  remoteOrOlomouc: unknown;
  fit: unknown;
  reason: unknown;
}

function parseReply(text: string): RawJudgment {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error("agency reply is not JSON");
  }
  if (typeof obj !== "object" || obj === null) throw new Error("agency reply is not an object");
  return obj as RawJudgment;
}

interface ResponsesResponse {
  output?: Array<{ type?: unknown; content?: Array<{ text?: unknown }> }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

function extractContent(body: string): { text: string; promptTokens: number; completionTokens: number } {
  let res: ResponsesResponse;
  try {
    res = JSON.parse(body) as ResponsesResponse;
  } catch {
    throw new Error("API reply is not JSON");
  }
  const message = res.output?.find((item) => item.type === "message");
  const text = message?.content?.[0]?.text;
  if (typeof text !== "string" || text.length === 0) throw new Error("API reply has no message content");
  return {
    text,
    promptTokens: res.usage?.input_tokens ?? 0,
    completionTokens: res.usage?.output_tokens ?? 0,
  };
}

const FORMS: AgencyForm[] = ["ico", "hpp", "both", "unknown"];

function cleanString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}

/** First word of the role title, lowercase without diacritics: matches URL slugs like `react-developer`. */
function slug(title: string): string {
  const head = (title.split("(")[0] ?? title).trim();
  return head
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)[0] ?? "";
}

/**
 * Validates the model reply deterministically. `evidenceQuote` and `devRate`
 * must be verbatim substrings of the fetched page text, `positionUrl` must be
 * one of the fetched URLs; a failing field is dropped (quote failure also
 * closes the position). Closed/filled markers ("obsazen") in the quote close it too.
 */
export function validateJudgment(raw: RawJudgment, pages: AgencyPage[]): AgencyJudgment {
  const corpus = pages.map((p) => p.text).join("\n");
  const urls = new Set(pages.map((p) => p.url));
  const form = typeof raw.form === "string" && (FORMS as string[]).includes(raw.form) ? (raw.form as AgencyForm) : null;

  let quote = typeof raw.evidenceQuote === "string" && raw.evidenceQuote.length > 0 && corpus.includes(raw.evidenceQuote) ? raw.evidenceQuote : null;
  // Closed/filled positions are not open, even with a verbatim hiring sentence.
  if (quote !== null && /obsazen/i.test(quote)) quote = null;

  let positionUrl = typeof raw.positionUrl === "string" && urls.has(raw.positionUrl) ? raw.positionUrl : null;
  let positionTitle = cleanString(raw.positionTitle);
  // The quote must support the picked role: it names the title (or its head word stem — Czech
  // inflection changes endings, e.g. "vývojář" → "vývojáře"), or it sits on a page whose text
  // names the title and whose URL carries the slug.
  if (quote !== null && positionTitle !== null && positionUrl !== null) {
    const head = (positionTitle.split("(")[0] ?? positionTitle).trim();
    const stem = (s: string): string => s.toLowerCase().slice(0, Math.max(1, s.length - 2));
    const headWord = head.split(/\s+/)[0] ?? "";
    const page = pages.find((p) => p.url === positionUrl);
    const text = page?.text ?? "";
    const inQuote =
      quote.toLowerCase().includes(head.toLowerCase()) ||
      (headWord.length > 3 && quote.toLowerCase().includes(stem(headWord)));
    const s = slug(positionTitle);
    const onPage = s !== "" && positionUrl.toLowerCase().includes(s) && text.toLowerCase().includes(head.toLowerCase());
    if (!inQuote && !onPage) quote = null;
  }
  const devRate = typeof raw.devRate === "string" && raw.devRate.trim().length > 0 ? (corpus.includes(raw.devRate) ? raw.devRate : null) : null;
  const remoteOrOlomouc = raw.remoteOrOlomouc === true;
  const fit = typeof raw.fit === "number" && Number.isFinite(raw.fit) && raw.fit >= 0 && raw.fit <= 10 ? raw.fit : null;
  const reason = cleanString(raw.reason);

  let open = raw.devPositionOpen === true;
  if (quote === null) {
    open = false;
    positionUrl = null;
    positionTitle = null;
  }
  return {
    devPositionOpen: open,
    positionTitle: open ? positionTitle : null,
    positionUrl: open ? positionUrl : null,
    evidenceQuote: quote,
    form,
    devRate,
    remoteOrOlomouc,
    fit,
    reason,
  };
}

/** Judge one agency from its fetched pages; throws on API/parse errors (caller records them). */
export async function judgeAgency(pages: AgencyPage[], opts: JudgeOptions): Promise<{ judgment: AgencyJudgment; promptTokens: number; completionTokens: number }> {
  const { endpoint, model, apiKey, sessionId, postJson = defaultPostJson } = opts;
  const input = buildAgencyInput(pages);
  const base = {
    model,
    input: [{ role: "user", content: [{ type: "input_text", text: input }] }],
  };
  let res = await postJson(endpoint, { ...base, text: { format: JSON_SCHEMA_FORMAT } }, apiKey, sessionId);
  if (res.status !== 200 && res.body.includes("text.format")) {
    res = await postJson(endpoint, base, apiKey, sessionId);
  }
  if (res.status !== 200) throw new Error(`API error ${res.status}: ${res.body.slice(0, 200)}`);
  const { text, promptTokens, completionTokens } = extractContent(res.body);
  const judgment = validateJudgment(parseReply(text), pages);
  return { judgment, promptTokens, completionTokens };
}
