export interface RealtimePollingOptions {
  /**
   * 页面隐藏（document.hidden）时暂停周期轮询；
   * 恢复可见时立即拉取一次并重新开始周期轮询。
   */
  pauseWhenHidden?: boolean;
  jitterMs?: number;
  retryDelaysMs?: number[];
}

export function startRealtimePolling(
  load: () => void | Promise<void>,
  intervalMs: number,
  options: RealtimePollingOptions = {}
) {
  const {
    pauseWhenHidden = false,
    jitterMs = 0,
    retryDelaysMs = [intervalMs],
  } = options;
  if (typeof window === "undefined") {
    return () => {};
  }

  let timer: number | null = null;
  let stopped = false;
  let running = false;
  let consecutiveFailures = 0;
  const stopTimer = () => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };
  const schedule = (delayMs: number) => {
    if (stopped || (pauseWhenHidden && typeof document !== "undefined" && document.hidden)) {
      return;
    }
    stopTimer();
    const jitter = jitterMs > 0 ? Math.floor(Math.random() * (jitterMs + 1)) : 0;
    timer = window.setTimeout(() => {
      timer = null;
      void run();
    }, delayMs + jitter);
  };
  const run = async () => {
    if (stopped || running || (pauseWhenHidden && typeof document !== "undefined" && document.hidden)) {
      return;
    }
    running = true;
    try {
      await load();
      consecutiveFailures = 0;
      schedule(intervalMs);
    } catch {
      consecutiveFailures += 1;
      const retryIndex = Math.min(consecutiveFailures - 1, retryDelaysMs.length - 1);
      schedule(retryDelaysMs[retryIndex] ?? intervalMs);
    } finally {
      running = false;
    }
  };

  if (!pauseWhenHidden || typeof document === "undefined") {
    void run();
    return () => {
      stopped = true;
      stopTimer();
    };
  }

  const handleVisibilityChange = () => {
    if (document.hidden) {
      stopTimer();
    } else {
      stopTimer();
      void run();
    }
  };

  void run();
  document.addEventListener("visibilitychange", handleVisibilityChange);

  return () => {
    stopped = true;
    stopTimer();
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  };
}
