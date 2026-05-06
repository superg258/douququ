import type {
  CommandCenterResponse,
  LiveStateResponse,
  OverviewResponse,
  PredictionRecapResponse,
  PrematchCenterResponse,
  RegionSlug,
  SimulationResponse,
  TeamProfileResponse,
} from "@/lib/types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8001";

async function requestJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

export function getOverview(): Promise<OverviewResponse> {
  return requestJson<OverviewResponse>("/api/overview");
}

export function getSimulation(regionSlug: RegionSlug, seed: number, mode: "sim" | "live" = "sim"): Promise<SimulationResponse> {
  return requestJson<SimulationResponse>(`/api/regions/${regionSlug}/simulation?seed=${seed}&mode=${mode}`);
}

export function getLiveState(regionSlug: RegionSlug): Promise<LiveStateResponse> {
  return requestJson<LiveStateResponse>(`/api/regions/${regionSlug}/live-state`);
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

export function getTeamProfile(teamKey: string, seed = 20260414, mode: "live" | "sim" = "live") {
  const params = new URLSearchParams({ seed: String(seed), mode });
  return requestJson<TeamProfileResponse>(`/api/teams/${encodeURIComponent(teamKey)}?${params}`);
}
