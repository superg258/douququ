import type {
  CommandCenterResponse,
  FinalEventsSnapshotResponse,
  LiveRevisionsResponse,
  LiveStateResponse,
  OverviewResponse,
  PredictionRecapResponse,
  PrematchCenterResponse,
  RegionSlug,
  SimulationResponse,
  TeamProfileResponse,
} from "@/lib/types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8001";
interface SharedRequest {
  controller: AbortController;
  promise: Promise<unknown>;
  subscribers: number;
  settled: boolean;
}

const inFlightRequests = new Map<string, SharedRequest>();

function subscribeToRequest<T>(entry: SharedRequest, signal?: AbortSignal): Promise<T> {
  entry.subscribers += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    entry.subscribers -= 1;
    if (entry.subscribers === 0 && !entry.settled) {
      entry.controller.abort();
    }
  };
  if (signal?.aborted) {
    release();
    return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
  }
  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => {
      release();
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };
    signal?.addEventListener("abort", handleAbort, { once: true });
    entry.promise.then(
      (value) => {
        signal?.removeEventListener("abort", handleAbort);
        if (!released) {
          release();
          resolve(value as T);
        }
      },
      (error) => {
        signal?.removeEventListener("abort", handleAbort);
        if (!released) {
          release();
          reject(error);
        }
      },
    );
  });
}

async function requestJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const key = `GET ${path} accept:application/json`;
  let entry = inFlightRequests.get(key);
  if (!entry) {
    const controller = new AbortController();
    entry = {
      controller,
      subscribers: 0,
      settled: false,
      promise: Promise.resolve(),
    };
    entry.promise = fetch(`${API_BASE_URL}${path}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Request failed: ${response.status}`);
      return (await response.json()) as T;
    })
      .finally(() => {
        entry!.settled = true;
        inFlightRequests.delete(key);
      });
    inFlightRequests.set(key, entry);
  }
  return subscribeToRequest<T>(entry, signal);
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

export async function getLiveRevisions(
  previousEtag?: string,
  signal?: AbortSignal,
): Promise<{ changed: boolean; etag: string; payload: LiveRevisionsResponse | null }> {
  const key = `GET /api/live-revisions if-none-match:${previousEtag ?? ""}`;
  let entry = inFlightRequests.get(key);
  if (!entry) {
    const controller = new AbortController();
    entry = {
      controller,
      subscribers: 0,
      settled: false,
      promise: Promise.resolve(),
    };
    entry.promise = fetch(`${API_BASE_URL}/api/live-revisions`, {
      cache: "no-cache",
      headers: previousEtag
        ? { Accept: "application/json", "If-None-Match": `"${previousEtag}"` }
        : { Accept: "application/json" },
      signal: controller.signal,
    }).then(async (response) => {
      const etag = (response.headers.get("etag") ?? "").replace(/^"|"$/g, "");
      if (response.status === 304) {
        return { changed: false, etag: previousEtag ?? etag, payload: null };
      }
      if (!response.ok) throw new Error(`Request failed: ${response.status}`);
      return {
        changed: true,
        etag,
        payload: (await response.json()) as LiveRevisionsResponse,
      };
    }).finally(() => {
      entry!.settled = true;
      inFlightRequests.delete(key);
    });
    inFlightRequests.set(key, entry);
  }
  return subscribeToRequest(entry, signal);
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
