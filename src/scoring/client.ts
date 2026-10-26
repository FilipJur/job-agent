import type { OfferToScore } from "../types";
import { SCORING_TIMEOUT_MS } from "./config";

/** Labels the LLM may assign; anything else in the reply is dropped. */
export const LLM_LABELS = ["remote-cz", "remote-eu", "ai-first"] as const;

export interface ScoreResult {
  score: number;
  reason: string;
  gaps: string;
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

const JSON_SCHEMA_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "offer_score",
    strict: true,
    schema: {
      type: "object",
      properties: {
        score: { type: "number", minimum: 0, maximum: 10 },
        reason: { type: "string" },
        gaps: { type: "string" },
        labels: { type: "array", items: { type: "string", enum: [...LLM_LABELS] } },
      },
      required: ["score", "reason", "gaps", "labels"],
      additionalProperties: false,
    },
  },
};

const JSON_OBJECT_FORMAT = { type: "json_object" };

export function buildUserMessage(offer: OfferToScore, maxDescriptionChars: number): string {
  const lines = [
    `Název: ${offer.title}`,
    `Firma: ${offer.company ?? "neuvedena"}`,
    `Lokalita: ${offer.locationText ?? offer.city ?? "neuvedena"}`,
    `Pracoviště: ${offer.workplace}`,
    `Štítky: ${offer.labels.length > 0 ? offer.labels.join(", ") : "žádné"}`,
    `Popis: ${offer.description.slice(0, maxDescriptionChars)}`,
    `Ohodnoť tuto nabídku podle profilu v systémové zprávě. Odpověz pouze JSON objektem ` +
      `{"score": number 0-10, "reason": string, "gaps": string, "labels": string[]}, ` +
      `kde reason je jedna věta česky, gaps je stručně česky co kandidátovi chybí ("" pokud nic) ` +
      `a labels obsahuje pouze hodnoty z ${JSON.stringify([...LLM_LABELS])}.`,
  ];
  return lines.join("\n");
}

interface ParsedReply {
  score: number;
  reason: string;
  gaps: string;
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
  if (typeof r.score !== "number" || !Number.isFinite(r.score) || r.score < 0 || r.score > 10) {
    throw new Error(`invalid score: ${JSON.stringify(r.score)}`);
  }
  if (typeof r.reason !== "string" || r.reason.trim().length === 0) throw new Error("missing reason");
  if (typeof r.gaps !== "string") throw new Error("missing gaps");
  if (!Array.isArray(r.labels)) throw new Error("missing labels");
  const allowed = new Set<string>(LLM_LABELS);
  return {
    score: r.score,
    reason: r.reason,
    gaps: r.gaps,
    labels: r.labels.filter((l): l is string => typeof l === "string" && allowed.has(l)),
  };
}

interface ChatResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function extractContent(body: string): { text: string; promptTokens: number; completionTokens: number } {
  let res: ChatResponse;
  try {
    res = JSON.parse(body) as ChatResponse;
  } catch {
    throw new Error("API reply is not JSON");
  }
  const content = res.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length === 0) throw new Error("API reply has no message content");
  return {
    text: content,
    promptTokens: res.usage?.prompt_tokens ?? 0,
    completionTokens: res.usage?.completion_tokens ?? 0,
  };
}

/** Scores one offer; falls back to json_object when the API rejects the JSON schema. */
export async function scoreOneOffer(opts: ScoringClientOptions, offer: OfferToScore): Promise<ScoreResult> {
  const base = {
    model: opts.model,
    messages: [
      { role: "system", content: opts.profile },
      { role: "user", content: buildUserMessage(offer, opts.maxDescriptionChars) },
    ],
  };
  let res = await opts.postJson(opts.endpoint, { ...base, response_format: JSON_SCHEMA_FORMAT }, opts.apiKey, opts.sessionId);
  let usedFallback = false;
  if (res.status !== 200 && res.body.includes("response_format")) {
    res = await opts.postJson(opts.endpoint, { ...base, response_format: JSON_OBJECT_FORMAT }, opts.apiKey, opts.sessionId);
    usedFallback = true;
  }
  if (res.status !== 200) throw new Error(`API error ${res.status}: ${res.body.slice(0, 200)}`);
  const { text, promptTokens, completionTokens } = extractContent(res.body);
  const parsed = parseScoreReply(text);
  return { ...parsed, promptTokens, completionTokens, usedFallback };
}
