import { describe, expect, test } from "bun:test";
import { canonicalCity, deriveCity, dedupKey, normalize, normalizeUrl } from "../src/normalize";
import type { RawOffer } from "../src/types";

describe("normalizeUrl", () => {
  test("strips every known tracking key, matching utm_* by prefix and keys case-insensitively", () => {
    expect(
      normalizeUrl(
        "https://example.com/job/1?searchId=b758&rps=233&utm_medium=email&utm_campaign=c&gclid=abc&_gl=1*xyz&impressionId=7&originJobAdUuid=u&UTM_Source=a",
      ),
    ).toBe("https://example.com/job/1");
  });

  test("keeps non-tracking params in order and drops only tracking ones", () => {
    expect(normalizeUrl("https://www.jobs.cz/prace/?q=AI+engineer&utm_medium=email&page=2")).toBe(
      "https://www.jobs.cz/prace/?q=AI+engineer&page=2",
    );
  });

  test("drops the fragment and a dangling '?'", () => {
    expect(normalizeUrl("https://www.jobs.cz/rpd/1/?utm_source=a#apply")).toBe("https://www.jobs.cz/rpd/1/");
    expect(normalizeUrl("https://www.jobs.cz/rpd/1/#apply")).toBe("https://www.jobs.cz/rpd/1/");
    expect(normalizeUrl("https://www.jobs.cz/rpd/1/?")).toBe("https://www.jobs.cz/rpd/1/");
  });
});

describe("dedupKey", () => {
  test("is equal for differing case, diacritics, punctuation and legal suffix", () => {
    const a = dedupKey("Senior AI Engineer", "ACME s.r.o.", "Praha");
    const b = dedupKey("senior ai engineer", "Acme, s. r. o.", "Praha");
    expect(a).toBe(b);
    expect(dedupKey("Vedoucí AI inženýr", "ACME s.r.o.", "Praha")).toBe(
      dedupKey("vedouci ai inzenyr", "Acme, s. r. o.", "praha"),
    );
  });

  test("differs for a different city", () => {
    expect(dedupKey("Senior AI Engineer", "ACME s.r.o.", "Praha")).not.toBe(
      dedupKey("Senior AI Engineer", "ACME s.r.o.", "Brno"),
    );
  });

  test("tolerates missing company and city", () => {
    expect(dedupKey("Senior AI Engineer", null, null)).toBe("senior ai engineer||");
  });
});

describe("deriveCity", () => {
  test.each([
    ["Praha – Michle", "Praha"],
    ["Praha 4 - Chodov", "Praha"],
    ["Nové sady 996/25, Brno – Staré Brno", "Brno"],
    ["Malé náměstí 459/11, Praha - Staré Město", "Praha"],
    ["Olomouc", "Olomouc"],
    ["Přerov", "Přerov"],
  ])("%p -> %p", (locationText, city) => {
    expect(deriveCity(locationText)).toBe(city);
  });

  test("region-only location yields null", () => {
    expect(deriveCity("Královéhradecký kraj")).toBeNull();
  });
});

describe("canonicalCity", () => {
  test.each([
    ["Prague", "Praha"],
    ["Praha 4", "Praha"],
    ["Pilsen", "Plzeň"],
    ["Brno", "Brno"],
    ["Opatovice nad Labem", "Opatovice nad Labem"],
    ["Berlin", "Berlin"],
    ["Czechia", null],
    ["Česko", null],
    ["Czech Republic", null],
    ["Europe", null],
    ["Remote", null],
    ["REMOTE (Europe)", null],
    ["NYC or REMOTE (US", null],
    ["REMOTE (European time zones) or ONSITE", null],
    ["REMOTE [Europe / (GMT+2)]", null],
    ["Remote (UTC-3 to UTC+3)", null],
    ["Multiple roles", null],
  ])("%p -> %p", (input, city) => {
    expect(canonicalCity(input)).toBe(city);
  });
});

describe("normalize", () => {
  const base: RawOffer = {
    source: "jobscz",
    sourceId: "2001265820",
    url: "https://www.jobs.cz/rpd/2001265820/?searchId=b758&rps=233&utm_source=x",
    title: "  Senior AI Engineer  ",
    company: " ACME s.r.o. ",
    locationText: "Nové sady 996/25, Brno – Staré Brno",
    salaryMin: 120000,
    salaryMax: 160000,
    currency: "CZK",
    publishedAt: "2026-10-05",
    description: "Stavíme LLM agenty.",
    tags: [],
    partial: false,
    raw: { id: 1 },
  };

  test("maps a hand-built RawOffer into an Offer", () => {
    const offer = normalize(base);
    expect(offer).toEqual({
      source: "jobscz",
      sourceId: "2001265820",
      url: "https://www.jobs.cz/rpd/2001265820/",
      title: "Senior AI Engineer",
      company: "ACME s.r.o.",
      locationText: "Nové sady 996/25, Brno – Staré Brno",
      city: "Brno",
      workplace: "unknown",
      salaryMin: 120000,
      salaryMax: 160000,
      currency: "CZK",
      publishedAt: "2026-10-05",
      description: "Stavíme LLM agenty.",
      dedupKey: "senior ai engineer|acme|brno",
      tags: [],
      labels: ["ai-first"],
      rawJson: '{"id":1}',
      partial: false,
    });
  });

  test("explicit raw.city overrides the city derived from locationText", () => {
    expect(normalize({ ...base, city: "Olomouc" }).city).toBe("Olomouc");
  });

  test("workplace is unknown when no work-mode signal exists", () => {
    expect(normalize(base).workplace).toBe("unknown");
  });

  test("labels come from rules over tags (contract type)", () => {
    expect(normalize({ ...base, tags: ["pracovní smlouva"] }).labels).toEqual(["hpp", "ai-first"]);
  });

  test("a country in raw.city falls back to the city in locationText and gets the praha label", () => {
    const offer = normalize({ ...base, city: "Czechia", locationText: "Prague, Czechia" });
    expect(offer.city).toBe("Praha");
    expect(offer.labels).toContain("praha");
  });

  test("missing company and location produce null fields and a null city", () => {
    const offer = normalize({ ...base, company: null, locationText: null, city: null });
    expect(offer.company).toBeNull();
    expect(offer.locationText).toBeNull();
    expect(offer.city).toBeNull();
    expect(offer.dedupKey).toBe("senior ai engineer||");
  });
});
