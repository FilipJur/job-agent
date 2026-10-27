import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchAgencies, fetchAspirations, fetchOffers, fetchTriage, patchAgency, toggleFeedback } from "./api";
import type { OfferFilters } from "./api";
import { AgenciesView } from "./AgenciesView";
import { AspirationsView } from "./AspirationsView";
import { applyFilters, MIN_SCORES, NO_CLIENT_FILTERS } from "./filters";
import type { ClientFilters } from "./filters";
import { agencyCount, offerRatio } from "./format";
import { linkButton } from "./ui";
import { OfferFilterBar } from "./OfferFilterBar";
import { OffersView } from "./OffersView";
import { MarketView } from "./MarketView";
import { ProfileView } from "./ProfileView";
import { TriageView } from "./TriageView";
import type { AgencyPatch, AgencyRow, AspirationRow, OfferRow, Tab, Verdict } from "./types";

type View = Tab | "triage" | "aspirace" | "agencies" | "profile" | "market";

const TABS: { key: View; label: string; aside?: boolean }[] = [
  { key: "hpp", label: "HPP" },
  { key: "kontrakty", label: "Kontrakty" },
  { key: "triage", label: "Triáž" },
  { key: "agencies", label: "Agentury" },
  { key: "market", label: "Trh" },
  { key: "profile", label: "Profil" },
  { key: "aspirace", label: "Aspirace", aside: true },
];

const NO_SERVER_FILTERS: OfferFilters = { onlyNew: false, remote: false, olomouc: false, hidden: false };

const CLIENT_FILTER_KEY = "job-agent.client-filters";

const viewFromHash = (): View => {
  const hash = window.location.hash.slice(1);
  return TABS.find((tab) => tab.key === hash)?.key ?? "hpp";
};

const errorText = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

const isSortKey = (value: unknown): value is ClientFilters["sort"] => value === "score" || value === "newest";

const readStoredFilters = (): ClientFilters => {
  try {
    const raw = sessionStorage.getItem(CLIENT_FILTER_KEY);
    if (raw === null) return NO_CLIENT_FILTERS;
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return NO_CLIENT_FILTERS;
    const candidate = parsed as Partial<Record<keyof ClientFilters, unknown>>;
    return {
      labels: Array.isArray(candidate.labels)
        ? candidate.labels.filter((label): label is string => typeof label === "string")
        : NO_CLIENT_FILTERS.labels,
      minScore: typeof candidate.minScore === "number" && (MIN_SCORES as readonly number[]).includes(candidate.minScore)
        ? candidate.minScore
        : NO_CLIENT_FILTERS.minScore,
      source: typeof candidate.source === "string" ? candidate.source : NO_CLIENT_FILTERS.source,
      query: typeof candidate.query === "string" ? candidate.query : NO_CLIENT_FILTERS.query,
      sort: isSortKey(candidate.sort) ? candidate.sort : NO_CLIENT_FILTERS.sort,
    };
  } catch {
    return NO_CLIENT_FILTERS;
  }
};


/** Plain terminal-style progress line; offers keep their rhythm once data lands. */
function OffersSkeleton({ loading }: { loading: boolean }) {
  if (!loading) return null;
  return (
    <p className="py-10 text-muted" aria-busy="true">
      načítám nabídky<span aria-hidden="true">…</span>
    </p>
  );
}

export function App() {
  const [view, setView] = useState<View>(viewFromHash);
  const [serverFilters, setServerFilters] = useState<OfferFilters>(NO_SERVER_FILTERS);
  const [clientFilters, setClientFilters] = useState<ClientFilters>(readStoredFilters);
  const [loaded, setLoaded] = useState<{ tab: Tab; rows: OfferRow[] } | null>(null);
  const [agencies, setAgencies] = useState<AgencyRow[] | null>(null);
  const [aspirations, setAspirations] = useState<AspirationRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingOffer, setPendingOffer] = useState<number | null>(null);
  const [triageRemaining, setTriageRemaining] = useState<number | null>(null);
  const [savingAgency, setSavingAgency] = useState<number | null>(null);
  const [reload, setReload] = useState(0);
  const showError = useCallback((message: string) => setError(message), []);

  useEffect(() => {
    const onHashChange = () => setView(viewFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(CLIENT_FILTER_KEY, JSON.stringify(clientFilters));
    } catch {
      // Private mode or quota: filters still work for the session, only reload persistence is lost.
    }
  }, [clientFilters]);

  useEffect(() => {
    if (view === "profile" || view === "triage" || view === "market") {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const load =
      view === "aspirace"
        ? fetchAspirations(controller.signal).then(setAspirations)
        : view === "agencies"
          ? fetchAgencies(controller.signal).then(setAgencies)
          : fetchOffers(view, serverFilters, controller.signal).then((rows) => setLoaded({ tab: view, rows }));
    load
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(`Načtení selhalo: ${errorText(cause)}`);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [view, serverFilters, reload]);

  useEffect(() => {
    const controller = new AbortController();
    fetchTriage(1, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setTriageRemaining(data.remaining);
      })
      .catch(() => {
        // The tab stays usable without a count; TriageView reports its own errors.
      });
    return () => controller.abort();
  }, [view, reload]);

  const rows = useMemo(() => (loaded !== null && loaded.tab === view ? loaded.rows : null), [loaded, view]);
  const visible = useMemo(() => (rows === null ? [] : applyFilters(rows, clientFilters)), [rows, clientFilters]);

  const selectView = (next: View) => {
    window.location.hash = next;
  };

  const toggleServerFilter = (key: keyof OfferFilters) => {
    setServerFilters((current) => ({ ...current, [key]: !current[key] }));
  };

  const resetFilters = () => {
    setServerFilters(NO_SERVER_FILTERS);
    setClientFilters(NO_CLIENT_FILTERS);
  };

  const sendFeedback = async (id: number, verdict: Verdict, active: boolean) => {
    setPendingOffer(id);
    setError(null);
    try {
      await toggleFeedback(id, verdict, active);
      setReload((value) => value + 1);
    } catch (cause) {
      setError(`Uložení zpětné vazby selhalo: ${errorText(cause)}`);
    } finally {
      setPendingOffer(null);
    }
  };

  const saveAgency = async (agency: AgencyRow, patch: AgencyPatch) => {
    setSavingAgency(agency.id);
    setError(null);
    try {
      const updated = await patchAgency(agency.id, patch);
      // Merge only the sent fields so a second edit does not overwrite a concurrent one with a stale row.
      setAgencies((current) => current?.map((row) => (row.id === updated.id ? { ...row, ...patch } : row)) ?? null);
    } catch (cause) {
      setError(`Uložení agentury selhalo: ${errorText(cause)}`);
    } finally {
      setSavingAgency(null);
    }
  };

  const isOffers = view !== "agencies" && view !== "profile" && view !== "aspirace" && view !== "triage" && view !== "market";

  return (
    <MotionConfig reducedMotion="user">
      <header className="sticky top-0 z-10 border-b border-line bg-bg">
        <div className="mx-auto flex max-w-[108ch] items-center justify-between gap-4 px-4">
          <h1 className="hidden text-[0.75rem] font-semibold tracking-[0.3em] text-faint uppercase sm:block">
            <span className="mr-[1ch] text-signal">$</span>job-agent
          </h1>
          <nav className="-mx-4 flex overflow-x-auto px-4 sm:mx-0 sm:px-0" role="tablist" aria-label="Sekce">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={view === tab.key}
                className={`relative px-3 py-2 text-xs font-medium tracking-[0.14em] whitespace-nowrap uppercase transition-colors hover:text-fg aria-selected:text-bg aria-selected:font-semibold${tab.aside ? " ml-[2ch] border-l border-line pl-[calc(0.75rem+2ch)]" : " text-muted"}`}
                onClick={() => selectView(tab.key)}
              >
                {view === tab.key && (
                  <motion.span
                    layoutId="tab-block"
                    className="absolute inset-y-1 inset-x-0 bg-signal"
                    transition={{ duration: 0.12, ease: "linear" }}
                  />
                )}
                <span className="relative">{tab.label}{tab.key === "triage" && triageRemaining !== null ? ` ${triageRemaining}` : ""}</span>
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[108ch] px-4 pt-5 pb-16 sm:pt-6">
        {error !== null && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border border-bad px-3 py-1.5 text-sm" role="alert">
            <span>
              <span className="mr-[1ch] text-[0.75rem] font-semibold tracking-[0.16em] text-bad uppercase">err</span>{error}
            </span>
            <span className="flex gap-4">
              <button type="button" className={linkButton} onClick={() => setReload((value) => value + 1)}>
                [zkusit znovu]
              </button>
              <button type="button" className={linkButton} onClick={() => setError(null)}>
                [zavřít]
              </button>
            </span>
          </div>
        )}

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={view}
            className={loading && isOffers && rows !== null ? "opacity-70 transition-opacity" : "transition-opacity"}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.1 }}
          >
            {isOffers && (
              <>
                {rows === null ? (
                  <OffersSkeleton loading={loading} />
                ) : (
                  <>
                    <OfferFilterBar
                      offers={rows}
                      shown={visible.length}
                      serverFilters={serverFilters}
                      filters={clientFilters}
                      onServerToggle={toggleServerFilter}
                      onChange={setClientFilters}
                      onReset={resetFilters}
                    />
                    <OffersView
                      offers={visible}
                      totalLoaded={rows.length}
                      pendingId={pendingOffer}
                      onFeedback={(offer, verdict) => void sendFeedback(offer.id, verdict, offer.feedback?.verdict === verdict)}
                      onReset={resetFilters}
                    />
                  </>
                )}
              </>
            )}
            {view === "aspirace" && (
              <>
                {aspirations !== null && (
                  <AspirationsView
                    rows={aspirations}
                    pendingId={pendingOffer}
                    onFeedback={(id, verdict) =>
                      void sendFeedback(
                        id,
                        verdict,
                        verdict === "aspiration" && aspirations.some((row) => row.id === id && row.source === "user"),
                      )}
                  />
                )}
              </>
            )}
            {view === "agencies" && (
              <>
                <p className="mb-4 text-sm text-muted tabular-nums" aria-live="polite">
                  {loading ? "načítám…" : agencies === null ? "" : agencyCount(agencies.length)}
                </p>
                <AgenciesView agencies={agencies} savingId={savingAgency} onSave={saveAgency} />
              </>
            )}
            {view === "triage" && <TriageView onError={showError} />}
            {view === "market" && <MarketView onError={showError} />}
            {view === "profile" && <ProfileView onError={showError} />}
          </motion.div>
        </AnimatePresence>
      </main>
      <footer className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-bg">
        <div className="mx-auto flex max-w-[108ch] items-center justify-between gap-4 px-4">
          <span className="bg-signal px-2 text-[0.75rem] font-semibold tracking-[0.2em] text-bg">{view.toUpperCase()}</span>
          <span className="hidden text-[0.75rem] tracking-[0.06em] text-faint sm:block">
            {isOffers
              ? "j/k pohyb · u d r a h verdikt · o otevřít · / hledat · esc zrušit"
              : view === "triage"
                ? "1 hodí se · 2 nehodí se · 3 aspirace · h skrýt · s přeskočit · o otevřít · z vrátit"
                : view === "aspirace"
                ? "klik na aktivní verdikt ho zruší · jiný verdikt vrátí nabídku do práce"
                : view === "agencies"
                  ? "stav a poznámky se ukládají hned"
                  : view === "market"
                    ? "sazby z inzerátů · klik na vzorky je rozbalí"
                    : "uložit tlačítkem, přehodnocení při dalším scoringu"}
          </span>
        </div>
      </footer>
    </MotionConfig>
  );
}
