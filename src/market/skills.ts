import type { SkillDef } from "./config";

export interface SkillStat {
  skill: string;
  offers: number;
  fitOffers: number;
  gapMentions: number;
  leverage: number;
  /** True when a match term appears in the profile's strengths section: his skill, not a gap to learn. */
  owned: boolean;
}

/** One offer with its latest score row (null when unscored). */
export interface SkillOffer {
  text: string;
  score: number | null;
  verdict: string | null;
  gaps: string | null;
}

/** Lowercase without Czech diacritics, so "Testování" and "testovani" match alike. */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Any term of the skill, bounded by non-alphanumerics (so "java" does not match "javascript"). */
function skillPattern(skill: SkillDef): RegExp {
  const terms = skill.match.map((t) => {
    const folded = fold(t);
    const term = folded.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    return folded.length >= 4 ? `${term}(?:${INFLECT.join("|")})?` : term;
  });
  return new RegExp(`(?<![a-z0-9])(?:${terms.join("|")})(?![a-z0-9])`);
}

/** Czech case endings (folded), so "Pythonu" or "Reactu" still name the skill. */
const INFLECT = ["ovi", "ech", "ami", "em", "um", "u", "a", "y", "e"];

/**
 * The live profile's strengths section (heading containing "Silné stránky"),
 * up to the next heading. The whole profile when the heading is missing.
 */
export function strengthsSection(profile: string): string {
  const lines = profile.split("\n");
  const heading = (l: string): boolean => /^#{1,6}\s/.test(l.trim());
  const start = lines.findIndex((l) => heading(l) && fold(l).includes("silne stranky"));
  if (start === -1) return profile;
  const end = lines.findIndex((l, i) => i > start && heading(l));
  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n");
}

/**
 * Demand per skill: offers mentioning it, those of them the model rates fit with score >= 6,
 * gap mentions in the latest score, and leverage = near-miss offers (fit, 3 <= score < 7) whose gaps name it.
 * `profile` is the raw live profile: a skill naming anything in its strengths section is
 * marked `owned` (his already), so callers can keep it out of leverage. Sorted by offers desc, then name.
 */
export function skillStats(offers: readonly SkillOffer[], skills: readonly SkillDef[], profile = ""): SkillStat[] {
  const folded = offers.map((o) => ({ ...o, text: fold(o.text), gaps: o.gaps === null ? null : fold(o.gaps) }));
  const strengths = fold(strengthsSection(profile));
  return skills
    .map((skill) => {
      const re = skillPattern(skill);
      const stat: SkillStat = { skill: skill.name, offers: 0, fitOffers: 0, gapMentions: 0, leverage: 0, owned: re.test(strengths) };
      for (const o of folded) {
        const fitScore = o.verdict === "fit" ? o.score : null;
        if (re.test(o.text)) {
          stat.offers += 1;
          if (fitScore !== null && fitScore >= 6) stat.fitOffers += 1;
        }
        if (o.gaps !== null && re.test(o.gaps)) {
          stat.gapMentions += 1;
          if (fitScore !== null && fitScore >= 3 && fitScore < 7) stat.leverage += 1;
        }
      }
      return stat;
    })
    .sort((a, b) => b.offers - a.offers || a.skill.localeCompare(b.skill));
}
