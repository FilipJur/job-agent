import type { AgencyPatch, AgencyRow, AspirationRow, OfferRow, Tab, TriageQueue, Verdict } from "./types";

export interface OfferFilters {
  onlyNew: boolean;
  remote: boolean;
  olomouc: boolean;
  hidden: boolean;
}

export async function fetchAspirations(signal: AbortSignal): Promise<AspirationRow[]> {
  return request<AspirationRow[]>("/api/aspirations", { signal });
}

/** Extracts the `{ error }` message the API returns for 4xx/5xx responses. */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const text = await response.text();
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed !== null && typeof parsed === "object" && "error" in parsed && typeof parsed.error === "string") {
        message = parsed.error;
      }
    } catch {
      // Keep the status-based message for non-JSON error bodies.
    }
    throw new Error(message);
  }
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
