import { useEffect, useState } from "react";
import { fetchAgencies, fetchOffers, patchAgency, saveFeedback } from "./api";
import type { OfferFilters } from "./api";
import { AgenciesView } from "./AgenciesView";
import { agencyCount, offerCount } from "./format";
import { OffersView } from "./OffersView";
import type { AgencyPatch, AgencyRow, OfferRow, Tab, Verdict } from "./types";

type View = Tab | "agencies";

const TABS: { key: View; label: string }[] = [
  { key: "hpp", label: "HPP" },
  { key: "kontrakty", label: "Kontrakty" },
  { key: "agencies", label: "Agentury" },
];

const NO_FILTERS: OfferFilters = { onlyNew: false, remote: false, olomouc: false, hidden: false };

export function App() {
  const [view, setView] = useState<View>("hpp");
  const [filters, setFilters] = useState<OfferFilters>(NO_FILTERS);
  const [offers, setOffers] = useState<OfferRow[] | null>(null);
  const [agencies, setAgencies] = useState<AgencyRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingOffer, setPendingOffer] = useState<number | null>(null);
  const [savingAgency, setSavingAgency] = useState<number | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const load =
      view === "agencies"
        ? fetchAgencies(controller.signal).then(setAgencies)
        : fetchOffers(view, filters, controller.signal).then(setOffers);
    load
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(`Načtení selhalo: ${cause instanceof Error ? cause.message : String(cause)}`);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [view, filters, reload]);

  const toggleFilter = (key: keyof OfferFilters) => {
    setFilters((current) => ({ ...current, [key]: !current[key] }));
  };

  const filtersActive = Object.values(filters).some(Boolean);

  const sendFeedback = async (offer: OfferRow, verdict: Verdict) => {
    setPendingOffer(offer.id);
    setError(null);
    try {
      await saveFeedback(offer.id, verdict);
      setReload((value) => value + 1);
    } catch (cause) {
      setError(`Uložení zpětné vazby selhalo: ${cause instanceof Error ? cause.message : String(cause)}`);
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
      setError(`Uložení agentury selhalo: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setSavingAgency(null);
    }
  };

  return (
    <>
      <header className="app-header">
        <div className="header-inner">
          <h1>Pracovní nabídky</h1>
          <nav className="tabs" role="tablist" aria-label="Sekce">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={view === tab.key}
                className={view === tab.key ? "tab tab-active" : "tab"}
                onClick={() => setView(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="app-main">
        {view !== "agencies" && (
          <div className="filters" role="group" aria-label="Filtry nabídek">
            <button
              type="button"
              className={filters.onlyNew ? "filter filter-active" : "filter"}
              aria-pressed={filters.onlyNew}
              onClick={() => toggleFilter("onlyNew")}
            >
              Nové (24h)
            </button>
            <button
              type="button"
              className={filters.remote ? "filter filter-active" : "filter"}
              aria-pressed={filters.remote}
              onClick={() => toggleFilter("remote")}
            >
              Remote
            </button>
            <button
              type="button"
              className={filters.olomouc ? "filter filter-active" : "filter"}
              aria-pressed={filters.olomouc}
              onClick={() => toggleFilter("olomouc")}
            >
              Olomouc
            </button>
            <button
              type="button"
              className={filters.hidden ? "filter filter-active" : "filter"}
              aria-pressed={filters.hidden}
              onClick={() => toggleFilter("hidden")}
            >
              Skryté
            </button>
            {filtersActive && (
              <button type="button" className="filter-reset" onClick={() => setFilters(NO_FILTERS)}>
                Zrušit filtry
              </button>
            )}
          </div>
        )}

        {error !== null && (
          <div className="error" role="alert">
            <span>{error}</span>
            <button type="button" className="error-close" aria-label="Zavřít chybu" onClick={() => setError(null)}>
              ×
            </button>
          </div>
        )}

        <p className="status" aria-live="polite">
          {loading
            ? "Načítám…"
            : view === "agencies"
              ? agencies === null
                ? ""
                : agencyCount(agencies.length)
              : offers === null
                ? ""
                : offerCount(offers.length)}
        </p>

        {view === "agencies" ? (
          <AgenciesView
            agencies={agencies}
            savingId={savingAgency}
            onSave={saveAgency}
          />
        ) : (
          <OffersView
            offers={offers}
            loading={loading}
            pendingId={pendingOffer}
            filtersActive={filtersActive}
            onResetFilters={() => setFilters(NO_FILTERS)}
            onFeedback={(offer, verdict) => void sendFeedback(offer, verdict)}
          />
        )}
      </main>
    </>
  );
}
