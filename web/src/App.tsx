import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchAgenciesCached, fetchApplicationsCached, fetchAspirations, fetchOffersCached, fetchTriageCached, patchAgency, toggleFeedback } from "./api";
import type { OfferFilters } from "./api";
import { needsFollowUp, PipelineView } from "./PipelineView";
import { AgenciesView } from "./AgenciesView";
import { AspirationsView } from "./AspirationsView";
import { applyFilters, MIN_SCORES, NO_CLIENT_FILTERS } from "./filters";
import type { ClientFilters } from "./filters";
import { agencyCount, offerRatio } from "./format";
import { linkButton } from "./ui";
import { OfflineLine } from "./OfflineLine";
import { HelpOverlay } from "./HelpOverlay";
import { useKeys, useLeaderKeys } from "./keys";
import { OfferFilterBar } from "./OfferFilterBar";
import { OffersView } from "./OffersView";
import { MarketView } from "./MarketView";
import { ProfileView } from "./ProfileView";
import { TriageView } from "./TriageView";
import type { AgencyPatch, AgencyRow, AspirationRow, OfferRow, Tab, Verdict } from "./types";

const GO_KEYS: Record<string, View> = {
  h: "hpp",
  k: "kontrakty",
  t: "triage",
  p: "pipeline",
  a: "agencies",
  m: "market",
  f: "profile",
  s: "aspirace",
};

type View = Tab | "triage" | "pipeline" | "aspirace" | "agencies" | "profile" | "market";

const TABS: { key: View; label: string; aside?: boolean }[] = [
  { key: "hpp", label: "HPP" },
  { key: "kontrakty", label: "Kontrakty" },
  { key: "triage", label: "Triáž" },
  { key: "pipeline", label: "Pipeline" },
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
  const [offlineAt, setOfflineAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingOffer, setPendingOffer] = useState<number | null>(null);
  const [triageRemaining, setTriageRemaining] = useState<number | null>(null);
  const [overdue, setOverdue] = useState<number | null>(null);
  const [savingAgency, setSavingAgency] = useState<number | null>(null);
  const [reload, setReload] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const showError = useCallback((message: string) => setError(message), []);
  const closeHelp = useCallback(() => setHelpOpen(false), []);
  const goProfile = useCallback(() => {
    window.location.hash = "profile";
  }, []);

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
    if (view === "profile" || view === "triage" || view === "market" || view === "pipeline") {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setOfflineAt(null);
    const load =
      view === "aspirace"
        ? fetchAspirations(controller.signal).then(setAspirations)
        : view === "agencies"
          ? fetchAgenciesCached(controller.signal).then(({ data, cachedAt }) => {
            setAgencies(data);
            setOfflineAt(cachedAt);
          })
          : fetchOffersCached(view, serverFilters, controller.signal).then(({ data, cachedAt }) => {
            setLoaded({ tab: view, rows: data });
            setOfflineAt(cachedAt);
          });
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
    fetchTriageCached(1, controller.signal)
      .then(({ data }) => {
        if (!controller.signal.aborted) setTriageRemaining(data.remaining);
      })
      .catch(() => {
        // The tab stays usable without a count; TriageView reports its own errors.
      });
    fetchApplicationsCached(controller.signal)
      .then(({ data }) => {
        if (!controller.signal.aborted) setOverdue((data ?? []).filter((row) => needsFollowUp(row)).length);
      })
      .catch(() => {
        // 404 until the backend worker lands: no badge.
        if (!controller.signal.aborted) setOverdue(null);
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

  useEffect(() => {
    navRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [view]);

  useLeaderKeys((key) => {
    const next = GO_KEYS[key];
    if (next === undefined) return false;
    window.location.hash = next;
    return true;
  });

  useKeys((event) => {
    if (event.key === "?") {
      event.preventDefault();
      setHelpOpen(true);
    }
  });

  const isOffers = view !== "agencies" && view !== "profile" && view !== "aspirace" && view !== "triage" && view !== "market" && view !== "pipeline";

  return (
    <MotionConfig reducedMotion="user">
      <header className="sticky top-0 z-10 border-b border-line bg-bg pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex max-w-[108ch] items-center justify-between gap-4 pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))]">
          <h1 className="hidden text-[0.75rem] font-semibold tracking-[0.3em] text-faint uppercase sm:block">
            <span className="mr-[1ch] text-signal">$</span>job-agent
          </h1>
          <nav ref={navRef} className="no-scrollbar -mx-4 flex min-w-0 flex-nowrap overflow-x-auto px-4 sm:mx-0 sm:px-0" role="tablist" aria-label="Sekce">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={view === tab.key}
                className={`relative shrink-0 px-3 py-2 text-xs font-medium tracking-[0.14em] whitespace-nowrap uppercase transition-colors hover:text-fg aria-selected:text-bg aria-selected:font-semibold${tab.aside ? " ml-[2ch] border-l border-line pl-[calc(0.75rem+2ch)]" : " text-muted"}`}
                onClick={() => selectView(tab.key)}
              >
                {view === tab.key && (
                  <motion.span
                    layoutId="tab-block"
                    className="absolute inset-y-1 inset-x-0 bg-signal"
                    transition={{ duration: 0.12, ease: "linear" }}
                  />
                )}
                <span className="relative">{tab.label}{tab.key === "triage" && triageRemaining !== null ? ` ${triageRemaining}` : ""}{tab.key === "pipeline" && overdue !== null && overdue > 0 ? ` ${overdue}` : ""}</span>
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="relative mx-auto max-w-[108ch] pt-5 pr-[max(1rem,env(safe-area-inset-right))] pb-[calc(4rem+env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] sm:pt-6">
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
        {(isOffers || view === "agencies") && <OfflineLine cachedAt={offlineAt} />}

        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={view}
            className={loading && isOffers && rows !== null ? "opacity-70 transition-opacity" : "transition-opacity"}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
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
                      onError={showError}
                      onMissingFacts={goProfile}
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
            {view === "triage" && (
              <TriageView
                onError={showError}
                onMissingFacts={goProfile}
                onCounts={({ remaining }) => setTriageRemaining(remaining)}
                reloadKey={reload}
              />
            )}
            {view === "pipeline" && <PipelineView onError={showError} />}
            {view === "market" && <MarketView onError={showError} />}
            {view === "profile" && <ProfileView onError={showError} />}
          </motion.div>
        </AnimatePresence>
      </main>
      <footer className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-bg pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-[108ch] items-center justify-between gap-4 pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))]">
          <span className="bg-signal px-2 text-[0.75rem] font-semibold tracking-[0.2em] text-bg">{view.toUpperCase()}</span>
          <span className="hidden text-[0.75rem] tracking-[0.06em] text-faint sm:block">
            {isOffers
              ? "j/k pohyb · 1 2 3 r h verdikt · d návrh · o otevřít · / hledat · g+písmeno jít · ? nápověda"
              : view === "triage"
                ? "1 hodí se · 2 nehodí se · 3 aspirace · h skrýt · d návrh · s přeskočit · o otevřít · z vrátit · ? nápověda"
                : view === "pipeline"
                  ? "fáze a poznámky se ukládají hned · další krok hlídá termín · ? nápověda"
                : view === "aspirace"
                ? "klik na aktivní verdikt ho zruší · jiný verdikt vrátí nabídku do práce · ? nápověda"
                : view === "agencies"
                  ? "stav a poznámky se ukládají hned · ? nápověda"
                  : view === "market"
                    ? "sazby z inzerátů · klik na vzorky je rozbalí · ? nápověda"
                    : "uložit tlačítkem, přehodnocení při dalším scoringu · ? nápověda"}
          </span>
        </div>
      </footer>
      {helpOpen && <HelpOverlay view={view} onClose={closeHelp} />}
    </MotionConfig>
  );
}
