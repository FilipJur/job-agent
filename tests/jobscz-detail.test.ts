import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDetail } from "../src/collectors/jobscz/detail";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures/jobscz", name), "utf8");

describe("parseDetail: JSON-LD shape", () => {
  const d = parseDetail(fixture("detail-jsonld.html"));

  test("shape and core fields", () => {
    expect(d.shape).toBe("jsonld");
    expect(d.partial).toBe(false);
    expect(d.title).toBe("REACT Developer");
    expect(d.company).toBe("CENDIS, s.p.");
    expect(d.city).toBe("Praha");
    expect(d.locationText).toBe("U Pergamenky, Praha");
  });

  test("monthly salary from baseSalary", () => {
    expect(d.salaryMin).toBe(75000);
    expect(d.salaryMax).toBe(100000);
    expect(d.currency).toBe("CZK");
  });

  test("publishedAt is a real ISO date", () => {
    expect(d.publishedAt).toMatch(/^2026-10-13T/);
    expect(Number.isNaN(Date.parse(d.publishedAt ?? ""))).toBe(false);
  });

  test("tags include employment tokens and labelled rows", () => {
    expect(d.tags).toContain("FULL_TIME");
    expect(d.tags).toContain("pracovní smlouva");
  });

  test("description is plain text with line breaks", () => {
    expect(d.description.length).toBeGreaterThan(0);
    expect(d.description).not.toContain("<p>");
    expect(d.description).not.toContain("<li>");
    expect(d.description).not.toContain("&amp;");
    expect(d.description).toContain("\n");
  });
});

describe("parseDetail: 'Plat neuveden' trap", () => {
  test("bogus JSON-LD baseSalary is ignored when the page says Plat neuveden", () => {
    const d = parseDetail(fixture("detail-jsonld-no-salary.html"));
    expect(d.shape).toBe("jsonld");
    expect(d.salaryMin).toBeNull();
    expect(d.salaryMax).toBeNull();
    expect(d.currency).toBeNull();
  });
});

describe("parseDetail: og widget shape", () => {
  const d = parseDetail(fixture("detail-widget.html"));

  test("shape, title and company from og metadata", () => {
    expect(d.shape).toBe("og");
    expect(d.partial).toBe(true);
    expect(d.title).toBe("Senior Machine Learning Engineer – Conversational AI");
    expect(d.company).toBe("Agnostix, s.r.o.");
    expect(d.tags).toEqual([]);
  });

  test("double-encoded description is decoded once fully", () => {
    expect(d.description.length).toBeGreaterThan(0);
    expect(d.description).not.toContain("&amp;#");
    expect(d.description).not.toContain("&#");
    expect(d.description.startsWith("🧠 Hledáme")).toBe(true);
  });
});

describe("parseDetail: classic page with remote benefit and IČO contract", () => {
  const d = parseDetail(fixture("detail-remote-ico.html"));

  test("shape and info-row fields", () => {
    expect(d.shape).toBe("html");
    expect(d.partial).toBe(false);
    expect(d.title).toBe("AI Automation - Agent Specialist");
    expect(d.company).toBe("Westlogic s.r.o.");
    expect(d.publishedAt).toBeNull();
    expect(d.city).toBeNull();
  });

  test("salary row parsed from header", () => {
    expect(d.salaryMin).toBe(40000);
    expect(d.salaryMax).toBe(60000);
    expect(d.currency).toBe("CZK");
  });

  test("location link text lands in locationText", () => {
    expect(d.locationText).toBe("Hornopolní 3314/38, Ostrava – Moravská Ostrava");
  });

  test("benefit becomes a tag and the contract row carries IČO", () => {
    expect(d.tags).toContain("Práce převážně z domova");
    expect(d.tags).toContain("pracovní smlouva, práce na živnostenský list (IČO), dohoda o pracovní činnosti (DPČ)");
  });

  test("description is the body only, without the benefits list", () => {
    expect(d.description).toContain("Práce z domu");
    expect(d.description).not.toContain("Práce převážně z domova");
    expect(d.description).not.toContain("Benefity");
    expect(d.description).not.toContain("<");
  });
});

describe("parseDetail: unknown page", () => {
  test("throws on unrecognized markup", () => {
    expect(() => parseDetail("<html><body>nothing</body></html>")).toThrow("unrecognized jobs.cz detail page");
  });
});
