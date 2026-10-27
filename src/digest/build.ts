import type { Database } from "bun:sqlite";
import { listOffers, triageQueue } from "../repo";
import { listProposals } from "../tune/proposals";
import type { OfferRow } from "../types";

/** One actionable offer line in the digest. */
export interface DigestOffer {
  id: number;
  title: string;
  company: string | null;
  score: number;
  reason: string;
  url: string;
  tab: "HPP" | "Kontrakty";
}

export interface DigestAgency {
  id: number;
  name: string;
  positionTitle: string | null;
  positionUrl: string | null;
}

export interface Digest {
  date: string;
  title: string;
  since: string;
  now: string;
  offers: DigestOffer[];
  agencies: DigestAgency[];
  proposalPending: boolean;
  triageRemaining: number;
}

export interface BuildDigestOptions {
  since: string;
  now: string;
}

export interface RenderedDigest {
  title: string;
  markdown: string;
  short: string;
}

/** Same rule as the UI tabs: an `hpp` label (or no form label at all) reads as HPP. */
const FORM_LABELS = ["hpp", "ico", "freelance", "dpp-dpc"];
export function tabOf(labels: string[]): "HPP" | "Kontrakty" {
  if (labels.includes("hpp")) return "HPP";
  return FORM_LABELS.some((l) => labels.includes(l)) ? "Kontrakty" : "HPP";
}

const MAX_OFFERS = 10;

/** `2026-10-27` → `27. 10. 2026`. */
export function czDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${Number(d)}. ${Number(m)}. ${y}`;
}

const fmtScore = (s: number): string => s.toFixed(1).replace(".", ",");

const plural = (n: number, forms: [string, string, string]): string =>
  n === 1 ? forms[0] : n >= 2 && n <= 4 ? forms[1] : forms[2];

interface AgencyDigestRow {
  id: number;
  name: string;
  position_title: string | null;
  position_url: string | null;
}

/**
 * New actionable offers (first seen after `since`, latest score ≥ 6 with model
 * verdict `fit`, no current user verdict), agencies with a freshly crawled open
 * position, a pending profile proposal, and the Triáž backlog count.
 */
export function buildDigest(db: Database, opts: BuildDigestOptions): Digest {
  const byId = new Map<number, OfferRow>();
  for (const tab of ["hpp", "kontrakty"] as const) {
    for (const offer of listOffers(db, { tab })) {
      if (!byId.has(offer.id)) byId.set(offer.id, offer);
    }
  }
  const offers: DigestOffer[] = [...byId.values()]
    .filter(
      (o) =>
        o.firstSeenAt > opts.since &&
        o.score !== null &&
        o.score.score >= 6 &&
        o.score.verdict === "fit" &&
        o.feedback === null,
    )
    .sort(
      (a, b) =>
        b.score!.score - a.score!.score ||
        (a.firstSeenAt < b.firstSeenAt ? 1 : a.firstSeenAt > b.firstSeenAt ? -1 : b.id - a.id),
    )
    .slice(0, MAX_OFFERS)
    .map((o) => ({
      id: o.id,
      title: o.title,
      company: o.company,
      score: o.score!.score,
      reason: o.score!.reason,
      url: o.url,
      tab: tabOf(o.labels),
    }));
  const agencies = db
    .query<AgencyDigestRow, [string]>(
      `SELECT id, name, position_title, position_url FROM agencies
       WHERE dev_position_open = 1 AND crawled_at IS NOT NULL AND crawled_at > ?
       ORDER BY name`,
    )
    .all(opts.since)
    .map((r) => ({ id: r.id, name: r.name, positionTitle: r.position_title, positionUrl: r.position_url }));
  const proposalPending = listProposals().some((p) => p.status === "pending" && !p.stale);
  // Count only; the rows are not needed.
  const triageRemaining = triageQueue(db, { limit: 0 }).remaining;
  const date = opts.now.slice(0, 10);
  return {
    date,
    title: `Ranní přehled – ${czDate(date)}`,
    since: opts.since,
    now: opts.now,
    offers,
    agencies,
    proposalPending,
    triageRemaining,
  };
}

/** Czech markdown plus a ≤ 300-char push line; empty sections are omitted. */
export function renderDigest(d: Digest): RenderedDigest {
  const lines = [`# ${d.title}`, ""];
  if (d.offers.length > 0) {
    lines.push(`## Nové k akci (${d.offers.length})`, "");
    for (const o of d.offers) {
      lines.push(`- **${o.title}** – ${o.company ?? "neznámá firma"} · ${fmtScore(o.score)} · ${o.tab}`);
      if (o.reason !== "") lines.push(`  ${o.reason}`);
      lines.push(`  ${o.url}`, "");
    }
  }
  if (d.agencies.length > 0) {
    lines.push(`## Agentury (${d.agencies.length})`, "");
    for (const a of d.agencies) {
      lines.push(`- **${a.name}**${a.positionTitle !== null ? ` – ${a.positionTitle}` : ""}`);
      if (a.positionUrl !== null) lines.push(`  ${a.positionUrl}`);
      lines.push("");
    }
  }
  if (d.proposalPending || d.triageRemaining > 0) {
    lines.push("## Čeká na tebe", "");
    if (d.proposalPending) lines.push("- Nový návrh profilu ke schválení (záložka Profil).");
    if (d.triageRemaining > 0) {
      lines.push(
        `- V Triáži čeká ${d.triageRemaining} ${plural(d.triageRemaining, ["neoznačená nabídka", "neoznačené nabídky", "neoznačených nabídek"])}.`,
      );
    }
    lines.push("");
  }
  if (d.offers.length === 0 && d.agencies.length === 0 && !d.proposalPending && d.triageRemaining === 0) {
    lines.push(`Nic nového od ${czDate(d.since.slice(0, 10))}.`);
  }
  const parts: string[] = [];
  if (d.offers.length > 0) {
    const best = d.offers[0]!;
    parts.push(
      `${d.offers.length} ${plural(d.offers.length, ["nová", "nové", "nových"])} (nejlepší ${fmtScore(best.score)} ${best.company ?? best.title})`,
    );
  }
  if (d.agencies.length > 0) {
    parts.push(
      `${d.agencies.length} ${plural(d.agencies.length, ["agentura hledá", "agentury hledají", "agentur hledá"])}`,
    );
  }
  if (d.proposalPending) parts.push("návrh profilu čeká");
  if (parts.length === 0 && d.triageRemaining > 0) {
    parts.push(
      `triáž: ${d.triageRemaining} ${plural(d.triageRemaining, ["neoznačená", "neoznačené", "neoznačených"])}`,
    );
  }
  const short = parts.length === 0 ? "Nic nového" : parts.join(", ");
  return {
    title: d.title,
    markdown: `${lines.join("\n").trimEnd()}\n`,
    short: short.length > 300 ? `${short.slice(0, 299)}…` : short,
  };
}
