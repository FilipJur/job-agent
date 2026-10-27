import type { Database } from "bun:sqlite";
import { labeledOffers, type EvalLabel, type LabeledOffer } from "../eval/labels";
import { replayLabeled, type ReplayOptions, type ReplayResult } from "../eval/replay";
import { defaultPostJson, type PostJson } from "../scoring/client";
import { proposalIdOf, saveProposal, summarize, type EvalSummary, type StoredProposal } from "./proposals";

export const MIN_LABELS = 10;
export const MIN_PER_CLASS = 3;

export interface GenerateOptions {
  /** The live profile the proposal starts from. */
  profile: string;
  /** Writes the proposal and scores the replays. */
  model: string;
  endpoint: string;
  maxDescriptionChars: number;
  apiKey: string;
  sessionId: string;
  postJson?: PostJson;
  minLabels?: number;
  now?: () => Date;
}

export type GenerateResult =
  | { kind: "not-enough-labels"; message: string }
  | { kind: "unchanged"; message: string; current: EvalSummary }
  | { kind: "created"; proposal: StoredProposal; path: string };

const PROPOSAL_SCHEMA = {
  type: "object",
  properties: {
    profile: { type: "string" },
    rationale: { type: "array", items: { type: "string" } },
    changes: { type: "array", items: { type: "string" } },
  },
  required: ["profile", "rationale", "changes"],
  additionalProperties: false,
};

const LABEL_CS: Record<EvalLabel, string> = { positive: "hodí se", negative: "nehodí se", aspiration: "aspirace" };

function buildPrompt(profile: string, offers: LabeledOffer[], replay: ReplayResult): string {
  const scored = new Map(replay.items.map((i) => [i.offerId, i]));
  const line = (o: LabeledOffer): string => {
    const s = scored.get(o.offerId);
    return (
      `#${o.offerId} ${o.title}${o.company ? ` — ${o.company}` : ""}\n` +
      `  verdikt uživatele: ${LABEL_CS[o.label]}; důvod uživatele: ${o.reason?.trim() || "neuveden"}\n` +
      (s ? `  model: skóre ${s.score}, verdikt ${s.verdict}; důvod: ${s.reason}; mezery: ${s.gaps || "žádné"}` : "  model: neohodnoceno")
    );
  };
  const byId = new Map(offers.map((o) => [o.offerId, o]));
  const worst = replay.metrics.disagreements.map(
    (d) => `#${d.offerId} ${byId.get(d.offerId)?.title ?? ""}: uživatel „${LABEL_CS[d.label]}“, model skóre ${d.score}`,
  );
  return [
    "Jsi asistent, který ladí bodovací profil kandidáta. Profil (níže) čte jiný model a podle něj hodnotí pracovní nabídky 0–10.",
    "Uživatel ohodnotil nabídky vlastním verdiktem. Navrhni upravený celý profil tak, aby skóre lépe odpovídalo jeho verdiktům.",
    "Pravidla:",
    "- Zachovej strukturu profilu (nadpisy, pořadí sekcí, formát) a jazyk (čeština).",
    "- Měň jen to, co verdikty a důvody uživatele skutečně podporují; ostatní text ponech doslova.",
    "- Nikdy si nevymýšlej fakta o kandidátovi (praxe, dovednosti, projekty, sazby); přidávej jen pravidla hodnocení odvozená z verdiktů.",
    "- Nepřizpůsobuj profil jednotlivým nabídkám jménem; formuluj obecná pravidla.",
    "- rationale: proč, česky, každá položka cituje konkrétní verdikty/důvody uživatele (#id).",
    "- changes: krátký seznam změn, česky.",
    "- profile: celý nový text profilu.",
    "",
    "=== AKTUÁLNÍ PROFIL ===",
    profile,
    "=== OHODNOCENÉ NABÍDKY (verdikt uživatele vs. skóre modelu s aktuálním profilem) ===",
    offers.map(line).join("\n"),
    "=== NEJHORŠÍ NESHODY ===",
    worst.length > 0 ? worst.join("\n") : "žádné",
    "",
    'Odpověz pouze JSON objektem {"profile": string, "rationale": string[], "changes": string[]}.',
  ].join("\n");
}

interface ProposalReply {
  profile: string;
  rationale: string[];
  changes: string[];
}

const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string" && s.trim() !== "");

function parseReply(body: string): ProposalReply {
  const res = JSON.parse(body) as { output?: Array<{ type?: unknown; content?: Array<{ text?: unknown }> }> };
  const text = res.output?.find((item) => item.type === "message")?.content?.[0]?.text;
  if (typeof text !== "string") throw new Error("API reply has no message content");
  const r = JSON.parse(text) as Record<string, unknown>;
  if (typeof r.profile !== "string" || r.profile.trim() === "") throw new Error("proposal has no profile");
  if (!isStringList(r.rationale) || !isStringList(r.changes)) throw new Error("proposal rationale/changes must be string lists");
  return { profile: r.profile, rationale: r.rationale, changes: r.changes };
}

async function replayAll(db: Database, opts: ReplayOptions): Promise<ReplayResult> {
  const replay = await replayLabeled(db, opts);
  // A partial replay compares different offer sets; no proposal is better than a wrongly measured one.
  if (replay.failed.length > 0) {
    throw new Error(`replay failed for ${replay.failed.length} offers: ${replay.failed[0]!.error}`);
  }
  return replay;
}

/** Proposed metric strictly below the current one; null proposed counts as worse. */
const worse = (current: number | null, proposed: number | null): boolean =>
  current !== null && (proposed === null || proposed < current);

/** Proposes a revised profile from the user's labels and measures it; writes a proposal file unless it changes nothing. */
export async function generateProposal(db: Database, opts: GenerateOptions): Promise<GenerateResult> {
  const offers = labeledOffers(db);
  const positives = offers.filter((o) => o.label === "positive").length;
  const negatives = offers.filter((o) => o.label === "negative").length;
  const minLabels = opts.minLabels ?? MIN_LABELS;
  if (offers.length < minLabels || positives < MIN_PER_CLASS || negatives < MIN_PER_CLASS) {
    return {
      kind: "not-enough-labels",
      message:
        `not enough labels: ${offers.length} labelled (${positives} positive, ${negatives} negative); ` +
        `need ${minLabels} with at least ${MIN_PER_CLASS} of each`,
    };
  }

  const postJson = opts.postJson ?? defaultPostJson;
  const replayOpts = (profile: string): ReplayOptions => ({
    profile,
    model: opts.model,
    endpoint: opts.endpoint,
    maxDescriptionChars: opts.maxDescriptionChars,
    apiKey: opts.apiKey,
    sessionId: opts.sessionId,
    postJson,
  });
  const current = await replayAll(db, replayOpts(opts.profile));

  const request = {
    model: opts.model,
    input: [{ role: "user", content: [{ type: "input_text", text: buildPrompt(opts.profile, offers, current) }] }],
    text: { format: { type: "json_schema", name: "profile_proposal", schema: PROPOSAL_SCHEMA } },
  };
  const res = await postJson(opts.endpoint, request, opts.apiKey, opts.sessionId);
  if (res.status !== 200) throw new Error(`API error ${res.status}: ${res.body.slice(0, 200)}`);
  const reply = parseReply(res.body);
  if (reply.profile.trim() === opts.profile.trim()) {
    return { kind: "unchanged", message: "the model proposed no change to the profile", current: summarize(current.metrics) };
  }

  const proposed = await replayAll(db, replayOpts(reply.profile));
  const metrics = { current: summarize(current.metrics), proposed: summarize(proposed.metrics) };
  const discarded =
    worse(metrics.current.auc, metrics.proposed.auc) || worse(metrics.current.precisionAt5, metrics.proposed.precisionAt5);
  const createdAt = (opts.now ?? (() => new Date()))().toISOString();
  const proposal: StoredProposal = {
    id: proposalIdOf(createdAt),
    createdAt,
    status: discarded ? "discarded" : "pending",
    model: opts.model,
    rationale: reply.rationale,
    changes: reply.changes,
    baseProfile: opts.profile,
    profile: reply.profile,
    metrics,
  };
  return { kind: "created", proposal, path: saveProposal(proposal) };
}
