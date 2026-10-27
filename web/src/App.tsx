import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchAgencies, fetchOffers, patchAgency, saveFeedback } from "./api";
import type { OfferFilters } from "./api";
import { AgenciesView } from "./AgenciesView";
import { applyFilters, NO_CLIENT_FILTERS } from "./filters";
import type { ClientFilters } from "./filters";
import { agencyCount } from "./format";
import { linkButton } from "./ui";
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

/** Static placeholder rows with the same rhythm as real offers, so the page does not jump when data lands. */
function OffersSkeleton({ loading }: { loading: boolean }) {
  if (!loading) return null;
  return (
    <div aria-busy="true" aria-label="Načítám nabídky">
      {[0, 1, 2].map((row) => (
        <div key={row} className="grid grid-cols-[2.5rem_1fr] gap-x-3 border-b border-line py-4 pl-3">
          <div className="h-5 w-6 bg-raised" />
          <div className="grid gap-2">
            <div className="h-4 w-2/3 bg-raised" />
            <div className="h-3.5 w-1/3 bg-raised/70" />
            <div className="h-3.5 w-1/2 bg-raised/50" />
          </div>
        </div>
      ))}
    </div>
  );
}

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
      <header className="scroll-rule sticky top-0 z-10 border-b border-line bg-bg/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-4xl items-end justify-between gap-4 px-4">
          <h1 className="hidden pb-2.5 font-mono text-sm font-medium text-faint sm:block">job-agent</h1>
          <nav className="-mx-4 flex overflow-x-auto px-2 sm:mx-0 sm:px-0" role="tablist" aria-label="Sekce">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={view === tab.key}
                className="relative px-3 py-3 text-sm font-medium whitespace-nowrap text-muted transition-colors hover:text-fg aria-selected:text-fg"
                onClick={() => selectView(tab.key)}
              >
                {view === tab.key && (
                  <motion.span
                    layoutId="tab-underline"
                    className="absolute inset-x-1.5 -bottom-px h-0.5 bg-signal"
                    transition={{ type: "spring", duration: 0.35, bounce: 0.1 }}
                  />
                )}
                <span className="relative">{tab.label}</span>
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-5 sm:py-8">
        {error !== null && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-l-2 border-bad bg-bad/10 py-2 pr-3 pl-3 text-sm" role="alert">
            <span>{error}</span>
            <span className="flex gap-3">
              <button type="button" className={linkButton} onClick={() => setReload((value) => value + 1)}>
                Zkusit znovu
              </button>
              <button type="button" className={linkButton} onClick={() => setError(null)}>
                Zavřít
              </button>
            </span>
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
                      onFeedback={(offer, verdict) => void sendFeedback(offer, verdict)}
                      onReset={resetFilters}
                    />
                  </>
                )}
              </>
            )}
            {view === "agencies" && (
              <>
                <p className="mb-4 font-mono text-sm text-muted tabular-nums" aria-live="polite">
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
