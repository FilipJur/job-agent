import { describe, expect, test } from "bun:test";
import { parseSerp, parseStatus } from "../src/collectors/jobscz/serp";
import { parseSalaryText } from "../src/collectors/jobscz/salary";

const fixture = await Bun.file(`${import.meta.dir}/fixtures/jobscz/serp-ai-engineer.html`).text();
const now = new Date("2026-10-26T12:00:00+01:00");
const cards = parseSerp(fixture, now);
const byId = (id: string) => {
  const card = cards.find((c) => c.sourceId === id);
  if (!card) throw new Error(`card ${id} missing`);
  return card;
};

describe("parseSerp on real AI engineer SERP", () => {
  test("returns all 30 cards in page order, ignoring non-card articles", () => {
    expect(cards.length).toBe(30);
    expect(cards[0]!.sourceId).toBe("2000557655");
    expect(cards[29]!.sourceId).toBe("2001494012");
  });

  test("first card fields", () => {
    expect(cards[0]).toEqual({
      sourceId: "2000557655",
      url: "https://www.jobs.cz/rpd/2000557655/",
      title: "Senior AI Engineer for Dataclair AI Centre (m/f)",
      company: "O2 Czech Republic a.s.",
      locationText: "Praha – Michle",
      tags: ["Odpověď do 2 týdnů"],
      salaryMin: null,
      salaryMax: null,
      currency: null,
      publishedAt: "2026-10-08",
    });
  });

  test("card with remote badge and no salary", () => {
    const card = byId("2001265820");
    expect(card.title).toBe("Senior AI Engineer");
    expect(card.company).toBe("NN");
    expect(card.locationText).toBe("Praha – Smíchov");
    expect(card.tags).toContain("Práce převážně z domova");
    expect(card.publishedAt).toBe("2026-10-05");
  });

  test("salary badge becomes min/max/currency and is not kept as a tag", () => {
    const card = byId("2001480077");
    expect(card.salaryMin).toBe(120000);
    expect(card.salaryMax).toBe(160000);
    expect(card.currency).toBe("CZK");
    expect(card.tags).toEqual(["Možnost občasné práce z domova"]);
    expect(card.company).toBe("Agnostix, s.r.o.");
    expect(card.locationText).toBe("Praha – Nové Město");
  });

  test("no card carries a salary badge or a pure-number badge in tags", () => {
    for (const card of cards) {
      expect(card.tags.some((t) => /Kč|€|^\d[\d\s]*$/.test(t))).toBe(false);
    }
  });

  test("hybrid badge is kept as a tag", () => {
    expect(byId("2001306870").tags).toContain("Možnost občasné práce z domova");
  });

  test("absolute date '21. října' resolves to 2026-10-21", () => {
    expect(byId("2001480077").publishedAt).toBe("2026-10-21");
  });

  test("relative 'Přidáno před hodinou' and 'Přidáno dnes' resolve to today", () => {
    expect(byId("2001499500").publishedAt).toBe("2026-10-26");
    expect(byId("2001495408").publishedAt).toBe("2026-10-26");
  });

  test("'Aktualizováno dnes' is an update, not a publication date", () => {
    expect(byId("2001487748").publishedAt).toBeNull();
  });

  test("decodes entities in company names", () => {
    expect(byId("2001424650").company).toBe("J&T BANKA");
  });

  test("card without badges has empty tags and no salary", () => {
    const card = byId("2001472936");
    expect(card.tags).toEqual([]);
    expect(card.salaryMin).toBeNull();
  });

  test("elite-company counters outside cards do not leak into tags", () => {
    expect(byId("2001480077").tags).not.toContain("69");
  });
});

const CARD = `
<article
    class="SearchResultCard"

>
  <h2 data-test-ad-title="X"
    class="SearchResultCard__title"
  ><a
     data-jobad-id="42" data-link="jd-detail"
    href="https://www.jobs.cz/rpd/42/?searchId=x&amp;rps=233"
    class="link-primary"
  >Backend &amp; Dev</a></h2>
  <div data-test-ad-status="default"
    class="SearchResultCard__status"
  >
    Aktualizováno včera
  </div>
  <div class="SearchResultCard__body">
    <span class="Tag Tag--success Tag--small"
    >50&nbsp;000 &zwj;–&zwj; 60&nbsp;000 Kč</span>
    <span class="Tag Tag--neutral">Práce převážně z domova</span>
  </div>
  <footer><ul>
    <li class="SearchResultCard__footerItem"><span translate="no">A &amp; B s.r.o.</span></li>
    <li data-test="serp-locality" class="SearchResultCard__footerItem">
      <svg><path d="M0 0"/></svg>
      Brno – Střed
    </li>
  </ul></footer>
</article>
<article class="py-900"><span class="Tag">999</span></article>`;

describe("parseSerp on inline snippet", () => {
  test("parses a minimal card with raw whitespace, entities and svg", () => {
    const [card, ...rest] = parseSerp(CARD, now);
    expect(rest.length).toBe(0);
    expect(card).toEqual({
      sourceId: "42",
      url: "https://www.jobs.cz/rpd/42/",
      title: "Backend & Dev",
      company: "A & B s.r.o.",
      locationText: "Brno – Střed",
      tags: ["Práce převážně z domova"],
      salaryMin: 50000,
      salaryMax: 60000,
      currency: "CZK",
      publishedAt: null,
    });
  });

  test("'Přidáno dnes' status resolves to today", () => {
    const [card] = parseSerp(CARD.replace("Aktualizováno včera", "Přidáno dnes"), now);
    expect(card!.publishedAt).toBe("2026-10-26");
  });
});

describe("parseStatus", () => {
  test("relative and absolute statuses", () => {
    expect(parseStatus("Přidáno dnes", now)).toBe("2026-10-26");
    expect(parseStatus("Přidáno včera", now)).toBe("2026-10-25");
    expect(parseStatus("Přidáno před 2 hodinami", now)).toBe("2026-10-26");
    expect(parseStatus("Přidáno před 3 dny", now)).toBe("2026-10-23");
    expect(parseStatus("21. října", now)).toBe("2026-10-21");
    expect(parseStatus("29. září", now)).toBe("2026-09-29");
  });

  test("absolute date after now is inferred as previous year", () => {
    expect(parseStatus("31. prosince", now)).toBe("2025-12-31");
  });

  test("invalid day/month and update statuses are null", () => {
    expect(parseStatus("31. září", now)).toBeNull();
    expect(parseStatus("Aktualizováno včera", now)).toBeNull();
    expect(parseStatus("Přidáno dnes ve tři", now)).toBeNull();
  });
});

describe("parseSalaryText", () => {
  test("range with NBSP and zero-width joiner (raw entities)", () => {
    expect(parseSalaryText("120&nbsp;000 &zwj;–&zwj; 160 000 Kč")).toEqual({ min: 120000, max: 160000, currency: "CZK" });
  });

  test("range with decoded NBSP and ZWJ characters", () => {
    expect(parseSalaryText("120\u00a0000 \u200d–\u200d 160\u00a0000 Kč")).toEqual({ min: 120000, max: 160000, currency: "CZK" });
  });

  test("single value gives min === max", () => {
    expect(parseSalaryText("50 000 Kč")).toEqual({ min: 50000, max: 50000, currency: "CZK" });
  });

  test("monthly suffix is accepted", () => {
    expect(parseSalaryText("75 000 – 100 000 Kč/měsíc")).toEqual({ min: 75000, max: 100000, currency: "CZK" });
  });

  test("euro currency", () => {
    expect(parseSalaryText("4 000 – 5 000 €")).toEqual({ min: 4000, max: 5000, currency: "EUR" });
  });

  test("hourly and yearly amounts are dropped", () => {
    const nulls = { min: null, max: null, currency: null };
    expect(parseSalaryText("450 Kč/hod")).toEqual(nulls);
    expect(parseSalaryText("600 000 Kč/rok")).toEqual(nulls);
  });

  test("unparsable text gives nulls", () => {
    const nulls = { min: null, max: null, currency: null };
    expect(parseSalaryText("Plat neuveden")).toEqual(nulls);
    expect(parseSalaryText("")).toEqual(nulls);
    expect(parseSalaryText("garbage")).toEqual(nulls);
  });
});
