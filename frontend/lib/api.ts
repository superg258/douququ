import type {
  CommandCenterResponse,
  FinalEventsSnapshotResponse,
  LiveStateResponse,
  OverviewResponse,
  PredictionRecapResponse,
  PrematchCenterResponse,
  RegionSlug,
  SimulationResponse,
  TeamProfileResponse,
} from "@/lib/types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8001";
const inFlightRequests = new Map<string, Promise<unknown>>();

async function requestJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const active = inFlightRequests.get(path);
  if (active) return active as Promise<T>;

  const request = fetch(`${API_BASE_URL}${path}`, { cache: "no-store", signal })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Request failed: ${response.status}`);
      return (await response.json()) as T;
    })
    .finally(() => inFlightRequests.delete(path));

  inFlightRequests.set(path, request);
  return request;
}

export function getOverview(signal?: AbortSignal): Promise<OverviewResponse> {
  return requestJson<OverviewResponse>("/api/overview", signal);
}

export function getFinalEvents(mode: "sim" | "live" = "live", signal?: AbortSignal): Promise<FinalEventsSnapshotResponse> {
  return requestJson<FinalEventsSnapshotResponse>(`/api/finals?mode=${mode}`, signal);
}

export function getSimulation(regionSlug: RegionSlug, seed: number, mode: "sim" | "live" = "sim"): Promise<SimulationResponse> {
  return requestJson<SimulationResponse>(`/api/regions/${regionSlug}/simulation?seed=${seed}&mode=${mode}`);
}

export function getLiveState(regionSlug: RegionSlug, signal?: AbortSignal): Promise<LiveStateResponse> {
  return requestJson<LiveStateResponse>(`/api/regions/${regionSlug}/live-state`, signal);
}

export function getPrematchCenter(seed = 20260414, mode: "live" | "sim" = "live") {
  const params = new URLSearchParams({ seed: String(seed), mode });
  return requestJson<PrematchCenterResponse>(`/api/prematch-center?${params}`);
}

export function getCommandCenter(seed = 20260414, mode: "live" | "sim" = "live", date?: string) {
  const params = new URLSearchParams({ seed: String(seed), mode });
  if (date) params.set("date", date);
  return requestJson<CommandCenterResponse>(`/api/command-center?${params}`);
}

export function getPredictionRecap(seed = 20260414, mode: "live" | "sim" = "live") {
  const params = new URLSearchParams({ seed: String(seed), mode });
  return requestJson<PredictionRecapResponse>(`/api/prediction-recap?${params}`);
}

export function getTeamProfile(teamKey: string, seed = 20260414, mode: "live" | "sim" = "live", signal?: AbortSignal) {
  const params = new URLSearchParams({ seed: String(seed), mode });
  return requestJson<TeamProfileResponse>(`/api/teams/${encodeURIComponent(teamKey)}?${params}`, signal);
}
