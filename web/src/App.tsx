import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchAgencies, fetchOffers, patchAgency, saveFeedback } from "./api";
import type { OfferFilters } from "./api";
import { AgenciesView } from "./AgenciesView";
import { applyFilters, NO_CLIENT_FILTERS } from "./filters";
import type { ClientFilters } from "./filters";
import { agencyCount } from "./format";
import { OfferFilterBar } from "./OfferFilterBar";
import { OffersView } from "./OffersView";
import { ProfileView } from "./ProfileView";
import type { AgencyPatch, AgencyRow, OfferRow, Tab, Verdict } from "./types";

type View = Tab | "agencies" | "profile";

const TABS: { key: View; label: string }[] = [
  { key: "hpp", label: "HPP" },
  { key: "kontrakty", label: "Kontrakty" },
  { key: "agencies", label: "Agentury" },
  { key: "profile", label: "Profil" },
];

const NO_SERVER_FILTERS: OfferFilters = { onlyNew: false, remote: false, olomouc: false, hidden: false };

const viewFromHash = (): View => {
  const hash = window.location.hash.slice(1);
  return TABS.find((tab) => tab.key === hash)?.key ?? "hpp";
};

const errorText = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

export function App() {
  const [view, setView] = useState<View>(viewFromHash);
  const [serverFilters, setServerFilters] = useState<OfferFilters>(NO_SERVER_FILTERS);
  const [clientFilters, setClientFilters] = useState<ClientFilters>(NO_CLIENT_FILTERS);
  // Rows remember their tab so a slow response never shows the other tab's offers.
  const [loaded, setLoaded] = useState<{ tab: Tab; rows: OfferRow[] } | null>(null);
  const [agencies, setAgencies] = useState<AgencyRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingOffer, setPendingOffer] = useState<number | null>(null);
  const [savingAgency, setSavingAgency] = useState<number | null>(null);
  const [reload, setReload] = useState(0);
  const showError = useCallback((message: string) => setError(message), []);

  useEffect(() => {
    const onHashChange = () => setView(viewFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (view === "profile") {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const load =
      view === "agencies"
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

  const sendFeedback = async (offer: OfferRow, verdict: Verdict) => {
    setPendingOffer(offer.id);
    setError(null);
    try {
      await saveFeedback(offer.id, verdict);
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

  const isOffers = view !== "agencies" && view !== "profile";

  return (
    <MotionConfig reducedMotion="user">
      <header className="sticky top-0 z-10 border-b border-line bg-bg/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl flex-col gap-1 px-4 pt-3 sm:flex-row sm:items-end sm:justify-between">
          <h1 className="flex items-center gap-2.5 pb-1 font-display text-xl font-medium tracking-tight sm:pb-2.5">
            <span className="size-2.5 rotate-45 bg-accent" aria-hidden="true" />
            Pracovní nabídky
          </h1>
          <nav className="-mx-4 flex overflow-x-auto px-2 sm:mx-0 sm:px-0" role="tablist" aria-label="Sekce">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={view === tab.key}
                className="relative px-3.5 py-2.5 text-sm font-medium whitespace-nowrap text-muted transition-colors hover:text-fg aria-selected:text-fg"
                onClick={() => selectView(tab.key)}
              >
                {view === tab.key && (
                  <motion.span
                    layoutId="tab-underline"
                    className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-accent"
                    transition={{ type: "spring", duration: 0.35, bounce: 0.12 }}
                  />
                )}
                <span className="relative">{tab.label}</span>
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-5 sm:py-8">
        {error !== null && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-low/50 bg-low/10 px-3 py-2 text-sm text-low" role="alert">
            <span>{error}</span>
            <button type="button" className="text-lg leading-none" aria-label="Zavřít chybu" onClick={() => setError(null)}>
              ×
            </button>
          </div>
        )}

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={view}
            className={loading && isOffers && rows !== null ? "opacity-70 transition-opacity" : "transition-opacity"}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
          >
            {isOffers && (
              <>
                {rows === null ? (
                  <p className="py-16 text-center text-muted">{loading ? "Načítám nabídky…" : ""}</p>
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
                      onFeedback={(offer, verdict) => void sendFeedback(offer, verdict)}
                      onReset={resetFilters}
                    />
                  </>
                )}
              </>
            )}
            {view === "agencies" && (
              <>
                <p className="mb-4 font-mono text-sm text-muted" aria-live="polite">
                  {loading ? "Načítám…" : agencies === null ? "" : agencyCount(agencies.length)}
                </p>
                <AgenciesView agencies={agencies} savingId={savingAgency} onSave={saveAgency} />
              </>
            )}
            {view === "profile" && <ProfileView onError={showError} />}
          </motion.div>
        </AnimatePresence>
      </main>
    </MotionConfig>
  );
}
