import type { PostJson } from "../scoring/client";
import type { Draft, Fact, OfferToScore } from "../types";
import { composeDraftText, validateSentences, type RawSentence } from "./validate";

/** A draft writes several fact-checked sentences; replies took up to 81 s in smoke, past scoring's 60 s. */
export const DRAFT_TIMEOUT_MS = 180_000;

/** Same request as scoring's `defaultPostJson`, with the draft's own time limit. */
const draftPostJson: PostJson = async (url, body, apiKey, sessionId) => {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "User-Agent": "job-agent-score/1.0",
      "x-opencode-session": sessionId,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(DRAFT_TIMEOUT_MS),
  });
  return { status: res.status, body: await res.text() };
};

const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    language: { type: "string", enum: ["cs", "en"] },
    sentences: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          kind: { type: "string", enum: ["greeting", "claim", "question", "closing"] },
          facts: { type: "array", items: { type: "string" } },
        },
        required: ["text", "kind", "facts"],
        additionalProperties: false,
      },
    },
  },
  required: ["language", "sentences"],
  additionalProperties: false,
};

const KNOWN_KINDS = ["greeting", "claim", "question", "closing"];

/** The offer, the numbered facts, and the rules that keep every claim inside them. */
export function buildDraftPrompt(offer: OfferToScore, facts: Fact[], maxDescriptionChars: number): string {
  return [
    "Jsi asistent kandidáta na pracovní nabídky. Napiš odpověď na nabídku níže, kterou kandidát zkopíruje a odešle sám.",
    "",
    "## Nabídka",
    `Název: ${offer.title}`,
    `Firma: ${offer.company ?? "neuvedena"}`,
    `Lokalita: ${offer.locationText ?? offer.city ?? "neuvedena"}`,
    `Pracoviště: ${offer.workplace}`,
    `Štítky: ${offer.labels.length > 0 ? offer.labels.join(", ") : "žádné"}`,
    `Popis: ${offer.description.slice(0, maxDescriptionChars)}`,
    "",
    "## Ověřená fakta kandidáta (jediný povolený zdroj tvrzení)",
    ...(facts.length > 0 ? facts.map((f) => `${f.id}: ${f.text}`) : ["(žádná fakta)"]),
    "",
    "## Pravidla",
    "- Odpověz v jazyce nabídky: \"cs\", pokud je popis převážně český, jinak \"en\".",
    "- Napiš 5–9 vět: pozdrav, tvrzení, otázky, závěr.",
    "- Adresuj konkrétní požadavky role z popisu, ne obecné fráze.",
    "- Každé tvrzení (kind \"claim\") uveď ve \"facts\" jako seznam id faktů, o které se opírá, a nic jiného netvrď.",
    "- Čísla (roky praxe, sazby, počty, procenta) smí být jen ta, která jsou doslova v citovaných faktech.",
    "- Otázky (kind \"question\") se ptej jen na sazbu, formu spolupráce nebo rozsah; bez čísel.",
    "- greeting, question ani closing nesmí obsahovat číslo ani technologii, kterou žádný fakt nezmiňuje.",
    "- Žádné lichotky, žádná vymyšlená praxe, žádné technologie nad rámec faktů.",
    "",
    "Odpověz pouze JSON objektem " +
      `{"language": "cs"|"en", "sentences": [{"text": string, "kind": ${JSON.stringify(KNOWN_KINDS)}, "facts": string[]}]}.`,
  ].join("\n");
}

/** Reads the message text out of a Responses API body. */
function extractReplyText(body: string): string {
  const res = JSON.parse(body) as { output?: Array<{ type?: unknown; content?: Array<{ text?: unknown }> }> };
  const text = res.output?.find((item) => item.type === "message")?.content?.[0]?.text;
  if (typeof text !== "string" || text.length === 0) throw new Error("API reply has no message content");
  return text;
}

/** Hand-validates the model's JSON; wrong shape throws, unsupported sentences are dropped later. */
export function parseDraftReply(text: string): { language: "cs" | "en"; sentences: RawSentence[] } {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  if (parsed.language !== "cs" && parsed.language !== "en") {
    throw new Error(`invalid draft language: ${JSON.stringify(parsed.language)}`);
  }
  if (!Array.isArray(parsed.sentences)) throw new Error("draft has no sentences");
  const sentences = parsed.sentences.map((item) => {
    const s = item as Record<string, unknown>;
    if (typeof s.text !== "string") throw new Error("sentence text must be a string");
    if (typeof s.kind !== "string" || !KNOWN_KINDS.includes(s.kind)) throw new Error(`invalid sentence kind: ${JSON.stringify(s.kind)}`);
    if (!Array.isArray(s.facts) || s.facts.some((f) => typeof f !== "string")) {
      throw new Error("sentence facts must be string ids");
    }
    return { text: s.text, kind: s.kind as RawSentence["kind"], facts: s.facts as string[] };
  });
  return { language: parsed.language, sentences };
}

export interface DraftOptions {
  offer: OfferToScore;
  facts: Fact[];
  model: string;
  endpoint: string;
  maxDescriptionChars: number;
  apiKey: string;
  sessionId: string;
  postJson?: PostJson;
  /** Defaults to `DRAFT_TIMEOUT_MS`; tests shorten it. */
  timeoutMs?: number;
  now?: Date;
}

/** Asks the model for a reply and keeps only sentences the facts support. Nothing is sent. */
export async function generateDraft(opts: DraftOptions): Promise<Draft> {
  const postJson = opts.postJson ?? draftPostJson;
  const timeoutMs = opts.timeoutMs ?? DRAFT_TIMEOUT_MS;
  const request = {
    model: opts.model,
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: buildDraftPrompt(opts.offer, opts.facts, opts.maxDescriptionChars) }],
      },
    ],
    text: { format: { type: "json_schema", name: "reply_draft", schema: DRAFT_SCHEMA } },
  };
  // The deadline holds for any `postJson`; the fetch's own abort maps to the same message.
  const timedOut = new Error(`draft timed out: the model did not answer within ${timeoutMs / 1000} s; nothing was saved, try again`);
  const deadline = Promise.withResolvers<never>();
  const timer = setTimeout(() => deadline.reject(timedOut), timeoutMs);
  let res: { status: number; body: string };
  try {
    res = await Promise.race([postJson(opts.endpoint, request, opts.apiKey, opts.sessionId), deadline.promise]);
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") throw timedOut;
    throw error;
  } finally {
    clearTimeout(timer);
  }
  if (res.status !== 200) throw new Error(`API error ${res.status}: ${res.body.slice(0, 200)}`);
  const reply = parseDraftReply(extractReplyText(res.body));
  const { sentences, dropped } = validateSentences(opts.facts, reply.sentences);
  return {
    offerId: opts.offer.id,
    createdAt: (opts.now ?? new Date()).toISOString(),
    model: opts.model,
    language: reply.language,
    sentences,
    dropped,
    text: composeDraftText(sentences),
  };
}
