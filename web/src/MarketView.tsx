import { useEffect, useMemo, useState } from "react";
import { fetchMarketCached } from "./api";
import { formatDate } from "./format";
import { OfflineLine } from "./OfflineLine";
import { fieldLabel, linkButton, meta, tag } from "./ui";
import type { MarketReport, RateBand, RateForm, RatePlace, SkillStat } from "./types";

const FORM_LABELS: Record<RateForm, string> = { hpp: "HPP", contract: "Kontrakt" };
const FORM_ORDER: RateForm[] = ["hpp", "contract"];
const PLACE_LABELS: Record<RatePlace, string> = {
  all: "vše",
  olomouc: "Olomouc",
  remote: "remote",
  praha: "Praha",
  other: "jinde",
};
const PLACE_ORDER: RatePlace[] = ["all", "olomouc", "remote", "praha", "other"];
const BASIS_LABELS = { salary: "z platu", text: "z textu" } as const;

const kcz = new Intl.NumberFormat("cs-CZ");
const ratioFormat = new Intl.NumberFormat("cs-CZ", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const external = { target: "_blank", rel: "noreferrer noopener" } as const;
const bandRank = (band: RateBand): number =>
  FORM_ORDER.indexOf(band.form) * PLACE_ORDER.length + PLACE_ORDER.indexOf(band.place);

function headlineFor(rates: RateBand[], currentRate: number): string {
  const parts = (["contract", "hpp"] as RateForm[]).flatMap((form) => {
    const band = rates.find((candidate) => candidate.form === form && candidate.place === "all");
    if (band?.median == null || currentRate <= 0) return [];
    const name = form === "contract" ? "Medián kontraktů" : "Medián HPP";
    return [`${name}: ${kcz.format(band.median)} Kč/h (${ratioFormat.format(band.median / currentRate)}× tvoje sazba)`];
  });
  return parts.length > 0 ? parts.join(" · ") : "Zatím málo dat pro medián.";
}

function RatesSection({ rates, currentRate }: { rates: RateBand[]; currentRate: number }) {
  const bands = useMemo(() => [...rates].sort((a, b) => bandRank(a) - bandRank(b)), [rates]);
  const max = useMemo(() => {
    const top = Math.max(
      currentRate,
      ...bands.flatMap((band) => [band.p25, band.median, band.p75].filter((value) => value !== null)),
    );
    return Math.max(100, Math.ceil(top / 100) * 100);
  }, [bands, currentRate]);
  const known = currentRate > 0;
  const marker = `${((currentRate / max) * 100).toFixed(2)}%`;

  return (
    <fieldset className="border border-line px-3 pt-1 pb-3 sm:px-4">
      <legend className={`${fieldLabel} px-1.5`}>sazby (Kč/h)</legend>
      <p className="mb-1 text-[1.125rem] leading-snug font-semibold text-pretty">{headlineFor(rates, currentRate)}</p>
      {known && (
        <p className="mb-3 text-sm text-muted">
          <span className="mr-[1ch] text-signal">┆</span>teď {kcz.format(currentRate)} Kč/h
        </p>
      )}
      <div className="relative mb-1 h-4 text-xs text-faint tabular-nums" aria-hidden="true">
        <span className="absolute left-0">0</span>
        {known && (
          <span className="absolute -translate-x-1/2" style={{ left: marker }}>
            {kcz.format(currentRate)}
          </span>
        )}
        <span className="absolute right-0">{kcz.format(max)}</span>
      </div>
      <ul className="grid gap-3">
        {bands.map((band) => {
          const thin = band.n < 3;
          return (
            <li key={`${band.form}-${band.place}`} className={thin ? "opacity-55" : undefined}>
              <div className="flex flex-wrap items-baseline gap-x-[2ch] gap-y-0.5">
                <span className="text-sm font-medium">
                  {FORM_LABELS[band.form]} · {PLACE_LABELS[band.place]}
                </span>
                <span className={`${tag} font-normal text-faint`}>n={band.n}</span>
                {thin && <span className={`${tag} text-bad`}>málo dat</span>}
                <span className="ml-auto text-sm text-muted tabular-nums">
                  {band.p25 !== null && band.median !== null && band.p75 !== null
                    ? `${kcz.format(band.p25)} – ${kcz.format(band.median)} – ${kcz.format(band.p75)}`
                    : "bez čísel"}
                </span>
              </div>
              <svg
                viewBox="0 0 1000 26"
                preserveAspectRatio="none"
                className="block h-[26px] w-full"
                role="img"
                aria-label={`${FORM_LABELS[band.form]} ${PLACE_LABELS[band.place]}: medián ${band.median ?? "—"}`}
              >
                {known && (
                  <line
                    x1={(currentRate / max) * 1000}
                    x2={(currentRate / max) * 1000}
                    y1={0}
                    y2={26}
                    stroke="var(--color-signal)"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                {band.p25 !== null && band.p75 !== null && (
                  <rect
                    x={(band.p25 / max) * 1000}
                    width={Math.max(((band.p75 - band.p25) / max) * 1000, 2)}
                    y={8}
                    height={10}
                    fill="var(--color-line-strong)"
                  />
                )}
                {band.median !== null && (
                  <line
                    x1={(band.median / max) * 1000}
                    x2={(band.median / max) * 1000}
                    y1={2}
                    y2={24}
                    stroke="var(--color-fg)"
                    strokeWidth={3}
                    vectorEffect="non-scaling-stroke"
                  />
                )}
              </svg>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

function LeverageSection({ leverage }: { leverage: SkillStat[] }) {
  if (leverage.length === 0) {
    return (
      <fieldset className="border border-line px-3 pt-1 pb-3 sm:px-4">
        <legend className={`${fieldLabel} px-1.5`}>co se naučit</legend>
        <p className="text-sm text-muted italic">žádné mezery k využití</p>
      </fieldset>
    );
  }
  const top = Math.max(...leverage.map((row) => row.leverage), 1);
  return (
    <fieldset className="border border-line px-3 pt-1 pb-3 sm:px-4">
      <legend className={`${fieldLabel} px-1.5`}>co se naučit</legend>
      <ul className="grid gap-2">
        {leverage.map((row) => (
          <li key={row.skill} className="flex flex-wrap items-center gap-x-[2ch] gap-y-1">
            <span className="w-[14ch] shrink-0 text-sm font-medium">{row.skill}</span>
            <span className="h-[10px] min-w-[2px] flex-1 basis-24">
              <span
                className="block h-full bg-signal/70"
                style={{ width: `${((row.leverage / top) * 100).toFixed(1)}%`, minWidth: "2px" }}
                role="img"
                aria-label={`${row.skill}: leverage ${row.leverage}`}
              />
            </span>
            <span className="text-sm text-muted tabular-nums">
              {row.leverage}× · v mezerách u {row.gapMentions} téměř-vhodných nabídek
            </span>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

type SkillKey = "skill" | "offers" | "fitOffers" | "gapMentions";
const SKILL_COLUMNS: { key: SkillKey; label: string }[] = [
  { key: "skill", label: "dovednost" },
  { key: "offers", label: "nabídky" },
  { key: "fitOffers", label: "vhodné" },
  { key: "gapMentions", label: "zmínky v mezerách" },
];

function DemandSection({ skills }: { skills: SkillStat[] }) {
  const [key, setKey] = useState<SkillKey>("offers");
  const [dir, setDir] = useState<1 | -1>(-1);
  const sorted = useMemo(() => {
    const rows = [...skills];
    rows.sort((a, b) =>
      key === "skill" ? dir * a.skill.localeCompare(b.skill, "cs") : dir * (a[key] - b[key]) || b.offers - a.offers,
    );
    return rows;
  }, [skills, key, dir]);

  const toggle = (next: SkillKey) => {
    if (next === key) {
      setDir((current) => (current === 1 ? -1 : 1));
    } else {
      setKey(next);
      setDir(next === "skill" ? 1 : -1);
    }
  };

  return (
    <fieldset className="border border-line px-3 pt-1 pb-3 sm:px-4">
      <legend className={`${fieldLabel} px-1.5`}>poptávka po dovednostech</legend>
      {skills.length === 0 ? (
        <p className="text-sm text-muted italic">žádná data o dovednostech</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52ch] border-collapse text-sm">
            <thead>
              <tr className={`text-left ${fieldLabel}`}>
                {SKILL_COLUMNS.map((column) => (
                  <th key={column.key} scope="col" aria-sort={key === column.key ? (dir === 1 ? "ascending" : "descending") : "none"} className="border-b border-line px-2 py-1 font-medium">
                    <button
                      type="button"
                      className="tracking-[inherit] uppercase hover:text-fg"
                      onClick={() => toggle(column.key)}
                    >
                      {column.label}
                      {key === column.key ? (dir === 1 ? " ▲" : " ▼") : ""}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {sorted.map((row) => (
                <tr key={row.skill} className="border-b border-line/60 last:border-b-0">
                  <td className="px-2 py-1 font-medium">{row.skill}</td>
                  <td className="px-2 py-1">{row.offers}</td>
                  <td className="px-2 py-1">{row.fitOffers}</td>
                  <td className="px-2 py-1">{row.gapMentions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </fieldset>
  );
}

function SamplesSection({ samples }: { samples: MarketReport["samples"] }) {
  return (
    <details className="border border-line px-3 py-2 sm:px-4">
      <summary className="cursor-pointer text-sm text-muted hover:text-fg">
        vzorky ({samples.length}) — titul, firma, Kč/h, forma, místo
      </summary>
      {samples.length === 0 ? (
        <p className="mt-2 text-sm text-muted italic">žádné vzorky</p>
      ) : (
        <ul className="mt-2 grid gap-1.5">
          {samples.map((sample) => (
            <li key={sample.offerId} className="flex flex-wrap items-baseline gap-x-[2ch] gap-y-0.5 text-sm">
              <a href={sample.url} {...external} className="font-medium">
                {sample.title}
              </a>
              {sample.company !== null && <span className="text-muted">{sample.company}</span>}
              <span className={`${meta} tabular-nums`}>
                <span>{kcz.format(sample.czkPerHour)} Kč/h</span>
                <span>{FORM_LABELS[sample.form]}</span>
                <span>{PLACE_LABELS[sample.place]}</span>
                <span className="text-faint">{BASIS_LABELS[sample.basis]}</span>
                <span className={`${tag} text-faint`}>{sample.source}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

export function MarketView({ onError }: { onError: (message: string) => void }) {
  const [report, setReport] = useState<MarketReport | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchMarketCached(controller.signal)
      .then(({ data, cachedAt: stamp }) => {
        if (!controller.signal.aborted) {
          setReport(data);
          setCachedAt(stamp);
          setFailed(null);
        }
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        const message = cause instanceof Error ? cause.message : "Trh se nepodařilo načíst";
        setFailed(message);
        onError(message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [onError]);

  if (loading) {
    return <p className="py-10 text-muted">načítám trh…</p>;
  }
  if (failed !== null) {
    return (
      <p className="py-10 text-muted" role="alert">
        Načtení trhu selhalo: {failed}{" "}
        <button type="button" className={linkButton} onClick={() => window.location.reload()}>
          [zkusit znovu]
        </button>
      </p>
    );
  }
  if (report === null) {
    return <p className="py-10 text-muted italic">Tržní data zatím nejsou k dispozici</p>;
  }

  return (
    <section className="grid gap-4">
      <OfflineLine cachedAt={cachedAt} />
      <p className="text-sm text-muted tabular-nums" aria-live="polite">
        {report.offers} nabídek · {report.withRate} se sazbou · {formatDate(report.generatedAt)}
      </p>
      <RatesSection rates={report.rates} currentRate={report.currentRate} />
      <LeverageSection leverage={report.leverage} />
      <DemandSection skills={report.skills} />
      <SamplesSection samples={report.samples} />
    </section>
  );
}
