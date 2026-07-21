export const LIVE_REFRESH_INTERVAL_MS = 3 * 60 * 1000;

export interface RealtimePollingOptions {
  /**
   * 页面隐藏（document.hidden）时暂停周期轮询；
   * 恢复可见时立即拉取一次并重新开始周期轮询。
   */
  pauseWhenHidden?: boolean;
}

export function startRealtimePolling(
  load: () => void,
  intervalMs = LIVE_REFRESH_INTERVAL_MS,
  options: RealtimePollingOptions = {}
) {
  const { pauseWhenHidden = false } = options;
  load();
  if (typeof window === "undefined") {
    return () => {};
  }

  let timer: number | null = null;
  const startTimer = () => {
    if (timer === null) {
      timer = window.setInterval(load, intervalMs);
    }
  };
  const stopTimer = () => {
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  };

  if (!pauseWhenHidden || typeof document === "undefined") {
    startTimer();
    return () => stopTimer();
  }

  const handleVisibilityChange = () => {
    if (document.hidden) {
      stopTimer();
    } else {
      load();
      startTimer();
    }
  };

  if (!document.hidden) {
    startTimer();
  }
  document.addEventListener("visibilitychange", handleVisibilityChange);

  return () => {
    stopTimer();
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  };
}
