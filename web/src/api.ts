import type { AgencyPatch, AgencyRow, OfferRow, Tab, Verdict } from "./types";

export interface OfferFilters {
  onlyNew: boolean;
  remote: boolean;
  olomouc: boolean;
  hidden: boolean;
}

export interface AspirationRow {
  id: number;
  title: string;
  company: string | null;
  url: string;
  city: string | null;
  workplace: OfferRow["workplace"];
  locationText: string | null;
  score: number;
  reason: string;
  direction: string;
  gaps: string;
  labels: string[];
  model: string;
  scoredAt: string;
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

export async function saveFeedback(offerId: number, verdict: Verdict): Promise<void> {
  await request<unknown>(`/api/offers/${offerId}/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ verdict }),
  });
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
