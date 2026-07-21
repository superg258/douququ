import { afterEach, describe, expect, it, vi } from "vitest";

import { LIVE_REFRESH_INTERVAL_MS, startRealtimePolling } from "@/lib/realtime-polling";

describe("realtime polling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses a three minute default refresh interval", () => {
    expect(LIVE_REFRESH_INTERVAL_MS).toBe(180_000);
  });

  it("loads immediately and repeats until stopped", () => {
    const load = vi.fn();
    const setInterval = vi.fn<(callback: () => void, timeout: number) => number>(() => 101);
    const clearInterval = vi.fn();
    vi.stubGlobal("window", { setInterval, clearInterval });

    const stop = startRealtimePolling(load);

    expect(load).toHaveBeenCalledTimes(1);
    expect(setInterval).toHaveBeenCalledWith(expect.any(Function), LIVE_REFRESH_INTERVAL_MS);

    const tick = setInterval.mock.calls[0][0] as () => void;
    tick();
    expect(load).toHaveBeenCalledTimes(2);

    stop();
    expect(clearInterval).toHaveBeenCalledWith(101);
  });

  it("pauses while hidden and reloads immediately when visible again", () => {
    const load = vi.fn();
    const setInterval = vi.fn<(callback: () => void, timeout: number) => number>(() => 101);
    const clearInterval = vi.fn();
    vi.stubGlobal("window", { setInterval, clearInterval });

    const listeners = new Map<string, () => void>();
    const doc = {
      hidden: false,
      addEventListener: (name: string, callback: () => void) => listeners.set(name, callback),
      removeEventListener: (name: string) => listeners.delete(name),
    };
    vi.stubGlobal("document", doc);

    const stop = startRealtimePolling(load, LIVE_REFRESH_INTERVAL_MS, { pauseWhenHidden: true });

    expect(load).toHaveBeenCalledTimes(1);
    expect(setInterval).toHaveBeenCalledTimes(1);

    doc.hidden = true;
    listeners.get("visibilitychange")?.();
    expect(clearInterval).toHaveBeenCalledWith(101);
    expect(load).toHaveBeenCalledTimes(1);

    setInterval.mockReturnValueOnce(202);
    doc.hidden = false;
    listeners.get("visibilitychange")?.();
    expect(load).toHaveBeenCalledTimes(2);
    expect(setInterval).toHaveBeenCalledTimes(2);

    stop();
    expect(clearInterval).toHaveBeenCalledWith(202);
    expect(listeners.has("visibilitychange")).toBe(false);
  });

  it("defers the interval until the page becomes visible when started hidden", () => {
    const load = vi.fn();
    const setInterval = vi.fn<(callback: () => void, timeout: number) => number>(() => 101);
    const clearInterval = vi.fn();
    vi.stubGlobal("window", { setInterval, clearInterval });

    const listeners = new Map<string, () => void>();
    const doc = {
      hidden: true,
      addEventListener: (name: string, callback: () => void) => listeners.set(name, callback),
      removeEventListener: (name: string) => listeners.delete(name),
    };
    vi.stubGlobal("document", doc);

    const stop = startRealtimePolling(load, LIVE_REFRESH_INTERVAL_MS, { pauseWhenHidden: true });

    expect(load).toHaveBeenCalledTimes(1);
    expect(setInterval).not.toHaveBeenCalled();

    doc.hidden = false;
    listeners.get("visibilitychange")?.();
    expect(load).toHaveBeenCalledTimes(2);
    expect(setInterval).toHaveBeenCalledTimes(1);

    stop();
    expect(clearInterval).toHaveBeenCalledWith(101);
  });
});
