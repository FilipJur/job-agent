import { useEffect, useMemo, useState } from "react";
import { applyProposal, fetchProposals, rejectProposal } from "./api";
import { collapseDiff, gapText, lineDiff } from "./diff";
import { formatDateTime } from "./format";
import { fieldLabel, linkButton, primaryButton, tag } from "./ui";
import type { EvalSummary, Proposal } from "./types";

const HISTORY_LABELS: Partial<Record<Proposal["status"], string>> = { applied: "použit", rejected: "zamítnut", discarded: "zahozen" };

interface MetricDef {
  label: string;
  get: (summary: EvalSummary) => number | null;
  decimals: number;
  lowerBetter?: boolean;
  neutral?: boolean;
}

const METRICS: MetricDef[] = [
  { label: "n", get: (summary) => summary.n, decimals: 0, neutral: true },
  { label: "AUC", get: (summary) => summary.auc, decimals: 2 },
  { label: "P@5", get: (summary) => summary.precisionAt5, decimals: 2 },
  { label: "P@10", get: (summary) => summary.precisionAt10, decimals: 2 },
  { label: "průměr 👍", get: (summary) => summary.meanPositive, decimals: 2 },
  { label: "průměr 👎", get: (summary) => summary.meanNegative, decimals: 2, lowerBetter: true },
];

function MetricTable({ proposal }: { proposal: Proposal }) {
  return (
    <table className="w-full border-collapse text-sm tabular-nums">
      <thead>
        <tr className={fieldLabel}>
          <th scope="col" className="py-1 pr-3 text-left font-medium">metrika</th>
          <th scope="col" className="px-3 py-1 text-right font-medium">nyní</th>
          <th scope="col" className="px-3 py-1 text-right font-medium">návrh</th>
          <th scope="col" className="py-1 pl-3 text-right font-medium">rozdíl</th>
        </tr>
      </thead>
      <tbody>
        {METRICS.map((metric) => (
          <MetricRow key={metric.label} metric={metric} proposal={proposal} />
        ))}
      </tbody>
    </table>
  );
}

function MetricRow({ metric, proposal }: { metric: MetricDef; proposal: Proposal }) {
  const current = metric.get(proposal.metrics.current);
  const proposed = metric.get(proposal.metrics.proposed);
  const text = (value: number): string => (metric.decimals === 0 ? String(value) : value.toFixed(metric.decimals));
  let delta: string | null = null;
  let deltaClass = "text-muted";
  if (current !== null && proposed !== null) {
    const diff = proposed - current;
    delta = diff === 0 ? text(0) : `${diff > 0 ? "+" : "−"}${text(Math.abs(diff))}`;
    if (diff !== 0 && !metric.neutral) {
      deltaClass = (metric.lowerBetter ? diff < 0 : diff > 0) ? "text-ok" : "text-bad";
    }
  }
  return (
    <tr className="border-t border-line">
      <th scope="row" className="py-1 pr-3 text-left font-normal text-muted">{metric.label}</th>
      <td className="px-3 py-1 text-right">{current === null ? "—" : text(current)}</td>
      <td className="px-3 py-1 text-right">{proposed === null ? "—" : text(proposed)}</td>
      <td className={`py-1 pl-3 text-right ${deltaClass}`}>{delta ?? "—"}</td>
    </tr>
  );
}

function ProposalDiff({ base, next }: { base: string; next: string }) {
  const lines = useMemo(() => collapseDiff(lineDiff(base, next)), [base, next]);
  return (
    <pre className="overflow-x-auto border border-line p-3 font-mono text-xs leading-relaxed" aria-label="Rozdíl profilu">
      {lines.map((line, index) => {
        if (line.kind === "gap") {
          return (
            <div key={index} className="text-faint italic">{gapText(line.count)}</div>
          );
        }
        return (
          <div key={index} className={line.kind === "add" ? "text-ok" : line.kind === "del" ? "text-bad" : "text-muted"}>
            {line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "} {line.text}
          </div>
        );
      })}
    </pre>
  );
}

export function ProposalPanel({ onApplied, onError, refreshKey = 0 }: { onApplied: () => void; onError: (message: string) => void; refreshKey?: number }) {
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchProposals(controller.signal)
      .then(setProposals)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) onError(cause instanceof Error ? cause.message : "Návrhy se nepodařilo načíst");
      });
    return () => controller.abort();
  }, [onError, refreshKey]);
  const stale = proposals?.some((proposal) => proposal.status === "pending" && proposal.stale) ?? false;
  // A refetch that marks the pending proposal stale must close an open confirm row: the apply is impossible now.
  useEffect(() => {
    if (stale) setConfirming(false);
  }, [stale]);

  if (proposals === null || proposals.length === 0) return null;

  const pending = proposals.find((proposal) => proposal.status === "pending") ?? null;
  const history = proposals.filter((proposal) => proposal.status !== "pending");

  const runAction = async (action: (id: string) => Promise<void>, id: string, applied: boolean) => {
    setBusy(true);
    setActionError(null);
    try {
      await action(id);
      setProposals(await fetchProposals(new AbortController().signal));
      if (applied) {
        onApplied();
        setConfirming(false);
      }
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Akce se nezdařila");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mb-6 grid gap-3" aria-label="Návrhy úpravy profilu">
      {pending !== null && (
        <fieldset className="border border-signal/60 px-3 pb-3 sm:px-4">
          <legend className="text-[0.75rem] font-medium tracking-[0.2em] text-faint uppercase">Návrh úpravy profilu</legend>
          <p className="pb-2 text-sm text-muted">
            <span className="text-fg">{formatDateTime(pending.createdAt)}</span>
            <span className={`${tag} ml-3 text-faint`}>{pending.model}</span>
          </p>
          {pending.stale && (
            <p className="mb-2 border border-bad px-3 py-1.5 text-sm" role="note">
              <span className="mr-[1ch] text-[0.75rem] font-semibold tracking-[0.16em] text-bad uppercase">stale</span>
              Profil se mezitím změnil — návrh nelze použít.
            </p>
          )}
          <MetricTable proposal={pending} />
          {pending.evaluation?.kind === "holdout" ? (
            <p className="pt-2 text-sm text-muted">měřeno na odložených {pending.evaluation.n} štítcích</p>
          ) : (
            <p className="pt-2 text-sm text-bad">měřeno na stejných štítcích (málo dat, odhad je optimistický)</p>
          )}
          {pending.rationale.length > 0 && (
            <div className="pt-3">
              <p className={fieldLabel}>zdůvodnění</p>
              <ul className="grid gap-1 pt-1 text-sm text-pretty">
                {pending.rationale.map((line, index) => (
                  <li key={index}>- {line}</li>
                ))}
              </ul>
            </div>
          )}
          {pending.changes.length > 0 && (
            <div className="pt-3">
              <p className={fieldLabel}>změny</p>
              <ul className="grid gap-1 pt-1 text-sm text-pretty">
                {pending.changes.map((line, index) => (
                  <li key={index}>- {line}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="pt-3">
            <ProposalDiff base={pending.baseProfile} next={pending.profile} />
          </div>
          {actionError !== null && (
            <p className="mt-3 border border-bad px-3 py-1.5 text-sm" role="alert">
              <span className="mr-[1ch] text-[0.75rem] font-semibold tracking-[0.16em] text-bad uppercase">err</span>{actionError}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-3">
            {confirming ? (
              <>
                <span className="text-sm">Přepíše data/profile.md; další běh přeskóruje vše.</span>
                <button type="button" className={primaryButton} disabled={busy || pending.stale} onClick={() => void runAction(applyProposal, pending.id, true)}>
                  ano, použít
                </button>
                <button type="button" className={linkButton} disabled={busy} onClick={() => setConfirming(false)}>
                  [zrušit]
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className={primaryButton}
                  disabled={busy || pending.stale}
                  title={pending.stale ? "Profil se mezitím změnil" : undefined}
                  onClick={() => { setActionError(null); setConfirming(true); }}
                >
                  Použít návrh
                </button>
                <button type="button" className={linkButton} disabled={busy} onClick={() => void runAction(rejectProposal, pending.id, false)}>
                  [Zamítnout]
                </button>
              </>
            )}
          </div>
        </fieldset>
      )}
      {history.length > 0 && (
        <details className="border border-line px-3 py-2 sm:px-4">
          <summary className="cursor-pointer text-[0.75rem] font-medium tracking-[0.16em] text-faint uppercase">
            Historie návrhů ({history.length})
          </summary>
          <ul className="grid gap-1 pt-2 pb-1 text-sm tabular-nums">
            {history.map((proposal) => {
              const { current, proposed } = proposal.metrics;
              const delta = current.auc === null || proposed.auc === null ? null : proposed.auc - current.auc;
              return (
                <li key={proposal.id} className="flex flex-wrap gap-x-[2ch]">
                  <span className="text-muted">{formatDateTime(proposal.createdAt)}</span>
                  <span>{HISTORY_LABELS[proposal.status]}</span>
                  <span className="text-muted">AUC {delta === null ? "—" : `${delta > 0 ? "+" : "−"}${Math.abs(delta).toFixed(2)}`}</span>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </section>
  );
}
