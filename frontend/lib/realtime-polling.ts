export const LIVE_REFRESH_INTERVAL_MS = 3 * 60 * 1000;

export function startRealtimePolling(
  load: () => void,
  intervalMs = LIVE_REFRESH_INTERVAL_MS
) {
  load();
  if (typeof window === "undefined") {
    return () => {};
  }
  const timer = window.setInterval(load, intervalMs);
  return () => window.clearInterval(timer);
}
