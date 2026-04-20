import type { OverviewResponse, RegionSlug, SimulationResponse } from "@/lib/types";

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
