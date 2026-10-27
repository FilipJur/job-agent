import type { OfferToScore } from "../types";
import { SCORING_TIMEOUT_MS } from "./config";

/** Labels the LLM may assign; anything else in the reply is dropped. */
export const LLM_LABELS = ["remote-cz", "remote-eu", "ai-first"] as const;

export interface ScoreResult {
  verdict: "fit" | "blocked" | "aspiration";
  score: number;
  reason: string;
  gaps: string;
  blocker: string;
  direction: string;
  labels: string[];
  promptTokens: number;
  completionTokens: number;
  usedFallback: boolean;
}

/** Injectable HTTP: posts a JSON body, resolves with status + raw text. Tests use a fake. */
export type PostJson = (
  url: string,
  body: unknown,
  apiKey: string,
  sessionId: string,
) => Promise<{ status: number; body: string }>;

export const defaultPostJson: PostJson = async (url, body, apiKey, sessionId) => {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "User-Agent": "job-agent-score/1.0",
      "x-opencode-session": sessionId,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(SCORING_TIMEOUT_MS),
  });
  return { status: res.status, body: await res.text() };
};

export interface ScoringClientOptions {
  endpoint: string;
  model: string;
  profile: string;
  maxDescriptionChars: number;
  apiKey: string;
  sessionId: string;
  postJson: PostJson;
}

const OFFER_SCORE_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["fit", "blocked", "aspiration"] },
    score: { type: "number", minimum: 0, maximum: 10 },
    reason: { type: "string" },
    gaps: { type: "string" },
    blocker: { type: "string" },
    direction: { type: "string" },
    labels: { type: "array", items: { type: "string", enum: [...LLM_LABELS] } },
  },
  required: ["verdict", "score", "reason", "gaps", "blocker", "direction", "labels"],
  additionalProperties: false,
};

const JSON_SCHEMA_FORMAT = { type: "json_schema", name: "offer_score", schema: OFFER_SCORE_SCHEMA };

export function buildUserMessage(offer: OfferToScore, maxDescriptionChars: number): string {
  const lines = [
    `Název: ${offer.title}`,
    `Firma: ${offer.company ?? "neuvedena"}`,
    `Lokalita: ${offer.locationText ?? offer.city ?? "neuvedena"}`,
    `Pracoviště: ${offer.workplace}`,
    `Popis: ${offer.description.slice(0, maxDescriptionChars)}`,
    `Ohodnoť tuto nabídku podle profilu výše. Odpověz pouze JSON objektem ` +
      `{"verdict": "fit"|"blocked"|"aspiration", "score": number 0-10, "reason": string, "gaps": string, "blocker": string, "direction": string, "labels": string[]}. ` +
      `Verdikt: "fit" = akční nabídka; "blocked" = teď nepoužitelná (onsite mimo Olomouc/okolí bez remote, nutná relokace/víza mimo EU, vyloučená oblast) — pak uveď blocker jednou větou česky a direction prázdné; ` +
      `"aspiration" = technicky skvělý fit (7+), ale teď nepoužitelná okolnostmi — pak uveď direction (kam směřovat / co se naučit, česky) a blocker stručně; ` +
      `u "fit" jsou blocker i direction prázdné. ` +
      `reason je jedna věta česky, gaps je stručně česky co kandidátovi chybí ("" pokud nic) ` +
      `a labels obsahuje pouze hodnoty z ${JSON.stringify([...LLM_LABELS])}.`,
  ];
  return lines.join("\n");
}

interface ParsedReply {
  verdict: "fit" | "blocked" | "aspiration";
  score: number;
  reason: string;
  gaps: string;
  blocker: string;
  direction: string;
  labels: string[];
}

/** Validates the model reply by hand; throws on wrong shape or out-of-range score. */
export function parseScoreReply(text: string): ParsedReply {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error("reply is not JSON");
  }
  if (typeof obj !== "object" || obj === null) throw new Error("reply is not an object");
  const r = obj as Record<string, unknown>;
  if (r.verdict !== "fit" && r.verdict !== "blocked" && r.verdict !== "aspiration") {
    throw new Error(`invalid verdict: ${JSON.stringify(r.verdict)}`);
  }
  if (typeof r.score !== "number" || !Number.isFinite(r.score) || r.score < 0 || r.score > 10) {
    throw new Error(`invalid score: ${JSON.stringify(r.score)}`);
  }
  if (typeof r.reason !== "string" || r.reason.trim().length === 0) throw new Error("missing reason");
  if (typeof r.gaps !== "string") throw new Error("missing gaps");
  if (typeof r.blocker !== "string") throw new Error("missing blocker");
  if (typeof r.direction !== "string") throw new Error("missing direction");
  if (!Array.isArray(r.labels)) throw new Error("missing labels");
  const allowed: Record<string, true> = { "remote-cz": true, "remote-eu": true, "ai-first": true };
  return {
    verdict: r.verdict,
    score: r.score,
    reason: r.reason,
    gaps: r.gaps,
    blocker: r.blocker,
    direction: r.direction,
    labels: r.labels.filter((l): l is string => typeof l === "string" && allowed[l] === true),
  };
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

/** Scores one offer; falls back to no text.format when the API rejects the JSON schema. */
export async function scoreOneOffer(opts: ScoringClientOptions, offer: OfferToScore): Promise<ScoreResult> {
  const input = `${opts.profile}\n\n${buildUserMessage(offer, opts.maxDescriptionChars)}`;
  const base = {
    model: opts.model,
    input: [{ role: "user", content: [{ type: "input_text", text: input }] }],
  };
  let res = await opts.postJson(opts.endpoint, { ...base, text: { format: JSON_SCHEMA_FORMAT } }, opts.apiKey, opts.sessionId);
  let usedFallback = false;
  if (res.status !== 200 && res.body.includes("text.format")) {
    res = await opts.postJson(opts.endpoint, base, opts.apiKey, opts.sessionId);
    usedFallback = true;
  }
  if (res.status !== 200) throw new Error(`API error ${res.status}: ${res.body.slice(0, 200)}`);
  const { text, promptTokens, completionTokens } = extractContent(res.body);
  const parsed = parseScoreReply(text);
  return { ...parsed, promptTokens, completionTokens, usedFallback };
}
