import type { AgencyPatch, AgencyRow, Application, AppStage, AspirationRow, Draft, EvalSummary, FactsStatus, MarketReport, OfferRow, Proposal, Tab, TriageQueue, Verdict } from "./types";

export interface OfferFilters {
  onlyNew: boolean;
  remote: boolean;
  olomouc: boolean;
  hidden: boolean;
}

export async function fetchAspirations(signal: AbortSignal): Promise<AspirationRow[]> {
  return request<AspirationRow[]>("/api/aspirations", { signal });
}

/** Error carrying the HTTP status, so callers can branch on 409/503 instead of message text. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Extracts the `{ error }` message the API returns for 4xx/5xx responses. */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) throw await apiError(response);
  const text = await response.text();
  return (text.length > 0 ? JSON.parse(text) : null) as T;
}

export async function fetchOffers(
  tab: Tab,
  filters: OfferFilters,
  signal: AbortSignal,
): Promise<OfferRow[]> {
  const params = new URLSearchParams({ tab });
  if (filters.onlyNew) params.set("new", "1");
  if (filters.remote) params.set("remote", "1");
  if (filters.olomouc) params.set("olomouc", "1");
  if (filters.hidden) params.set("hidden", "1");
  return request<OfferRow[]>(`/api/offers?${params.toString()}`, { signal });
}

/** Clicking the active verdict clears it (DELETE); otherwise appends the new verdict. Returns the verdict to show as active, if any. */
export async function toggleFeedback(offerId: number, verdict: Verdict, active: boolean): Promise<Verdict | null> {
  if (active) {
    await request<unknown>(`/api/offers/${offerId}/feedback`, { method: "DELETE" });
    return null;
  }
  await request<unknown>(`/api/offers/${offerId}/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ verdict }),
  });
  return verdict;
}

export async function sendVerdict(offerId: number, verdict: Verdict, reason?: string): Promise<void> {
  await request<unknown>(`/api/offers/${offerId}/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(reason === undefined ? { verdict } : { verdict, reason }),
  });
}

export async function clearVerdict(offerId: number): Promise<void> {
  await request<unknown>(`/api/offers/${offerId}/feedback`, { method: "DELETE" });
}

export async function fetchTriage(limit: number, signal: AbortSignal): Promise<TriageQueue> {
  return request<TriageQueue>(`/api/triage?limit=${limit}`, { signal });
}

export async function fetchAgencies(signal: AbortSignal): Promise<AgencyRow[]> {
  return request<AgencyRow[]>("/api/agencies", { signal });
}

/**
 * Market report for the Trh tab. Returns `null` when the backend worker is
 * not merged yet (404): the view renders the "not available" message then.
 */
export async function fetchMarket(signal: AbortSignal): Promise<MarketReport | null> {
  const response = await fetch("/api/market", { signal });
  if (response.status === 404) return null;
  if (!response.ok) throw await apiError(response);
  return (await response.json()) as MarketReport;
}

export async function patchAgency(agencyId: number, patch: AgencyPatch): Promise<AgencyRow> {
  return request<AgencyRow>(`/api/agencies/${agencyId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export interface ProfileStatus {
  text: string;
  pending: number;
}

export async function fetchProfile(signal: AbortSignal): Promise<ProfileStatus> {
  return request<ProfileStatus>("/api/profile", { signal });
}

export async function saveProfile(text: string): Promise<ProfileStatus> {
  return request<ProfileStatus>("/api/profile", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

export async function fetchFacts(signal: AbortSignal): Promise<FactsStatus | null> {
  const response = await fetch("/api/facts", { signal });
  if (response.status === 404) return null;
  if (!response.ok) throw await apiError(response);
  return (await response.json()) as FactsStatus;
}

export async function saveFacts(text: string): Promise<FactsStatus> {
  return request<FactsStatus>("/api/facts", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

export async function fetchApplications(signal: AbortSignal): Promise<Application[] | null> {
  const response = await fetch("/api/applications", { signal });
  if (response.status === 404) return null;
  if (!response.ok) throw await apiError(response);
  const parsed: unknown = await response.json();
  return Array.isArray(parsed) ? (parsed as Application[]) : [];
}

export async function saveApplication(
  offerId: number,
  patch: { stage: AppStage; nextActionAt?: string | null; notes?: string | null },
): Promise<Application> {
  return request<Application>(`/api/offers/${offerId}/application`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function removeApplication(offerId: number): Promise<void> {
  await request<unknown>(`/api/offers/${offerId}/application`, { method: "DELETE" });
}

export async function fetchDraft(offerId: number, signal: AbortSignal): Promise<Draft | null> {
  const response = await fetch(`/api/offers/${offerId}/draft`, { signal });
  if (response.status === 404) return null;
  if (!response.ok) throw await apiError(response);
  return (await response.json()) as Draft;
}

export async function generateDraft(offerId: number, signal: AbortSignal): Promise<Draft> {
  const response = await fetch(`/api/offers/${offerId}/draft`, { method: "POST", signal });
  if (!response.ok) throw await apiError(response);
  return (await response.json()) as Draft;
}

/**
 * Pending proposal list for the Profil tab. Returns `null` when the backend
 * worker is not merged yet (404): the panel renders nothing in that case.
 */
export async function fetchProposals(signal: AbortSignal): Promise<Proposal[] | null> {
  const response = await fetch("/api/proposals", { signal });
  if (response.status === 404) return null;
  if (!response.ok) throw await apiError(response);
  return (await response.json()) as Proposal[];
}

export async function applyProposal(id: string): Promise<void> {
  await proposalAction(id, "apply");
}

export async function rejectProposal(id: string): Promise<void> {
  await proposalAction(id, "reject");
}

async function proposalAction(id: string, action: "apply" | "reject"): Promise<void> {
  const response = await fetch(`/api/proposals/${encodeURIComponent(id)}/${action}`, { method: "POST" });
  if (response.ok) return;
  throw await apiError(response);
}

async function apiError(response: Response): Promise<ApiError> {
  const text = await response.text();
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed !== null && typeof parsed === "object" && "error" in parsed && typeof parsed.error === "string") {
      return new ApiError(response.status, parsed.error);
    }
  } catch {
    // Keep the status-based message for non-JSON error bodies.
  }
  return new ApiError(response.status, `HTTP ${response.status}`);
}
