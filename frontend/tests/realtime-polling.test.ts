import { afterEach, describe, expect, it, vi } from "vitest";

import { LIVE_REFRESH_INTERVAL_MS, startRealtimePolling } from "@/lib/realtime-polling";

describe("realtime polling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses a three minute default refresh interval", () => {
    expect(LIVE_REFRESH_INTERVAL_MS).toBe(180_000);
  });

  it("loads immediately and schedules the next check only after settle", async () => {
    const load = vi.fn();
    const setTimeout = vi.fn<(callback: () => void, timeout: number) => number>(() => 101);
    const clearTimeout = vi.fn();
    vi.stubGlobal("window", { setTimeout, clearTimeout });

    const stop = startRealtimePolling(load);
    await Promise.resolve();

    expect(load).toHaveBeenCalledTimes(1);
    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), LIVE_REFRESH_INTERVAL_MS);

    const tick = setTimeout.mock.calls[0][0] as () => void;
    tick();
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(2);

    stop();
    expect(clearTimeout).toHaveBeenCalledWith(101);
  });

  it("pauses while hidden and reloads immediately when visible again", async () => {
    const load = vi.fn();
    const setTimeout = vi.fn<(callback: () => void, timeout: number) => number>(() => 101);
    const clearTimeout = vi.fn();
    vi.stubGlobal("window", { setTimeout, clearTimeout });

    const listeners = new Map<string, () => void>();
    const doc = {
      hidden: false,
      addEventListener: (name: string, callback: () => void) => listeners.set(name, callback),
      removeEventListener: (name: string) => listeners.delete(name),
    };
    vi.stubGlobal("document", doc);

    const stop = startRealtimePolling(load, LIVE_REFRESH_INTERVAL_MS, { pauseWhenHidden: true });
    await Promise.resolve();

    expect(load).toHaveBeenCalledTimes(1);
    expect(setTimeout).toHaveBeenCalledTimes(1);

    doc.hidden = true;
    listeners.get("visibilitychange")?.();
    expect(clearTimeout).toHaveBeenCalledWith(101);
    expect(load).toHaveBeenCalledTimes(1);

    setTimeout.mockReturnValueOnce(202);
    doc.hidden = false;
    listeners.get("visibilitychange")?.();
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(2);
    expect(setTimeout).toHaveBeenCalledTimes(2);

    stop();
    expect(clearTimeout).toHaveBeenCalledWith(202);
    expect(listeners.has("visibilitychange")).toBe(false);
  });

  it("defers loading until the page becomes visible when started hidden", async () => {
    const load = vi.fn();
    const setTimeout = vi.fn<(callback: () => void, timeout: number) => number>(() => 101);
    const clearTimeout = vi.fn();
    vi.stubGlobal("window", { setTimeout, clearTimeout });

    const listeners = new Map<string, () => void>();
    const doc = {
      hidden: true,
      addEventListener: (name: string, callback: () => void) => listeners.set(name, callback),
      removeEventListener: (name: string) => listeners.delete(name),
    };
    vi.stubGlobal("document", doc);

    const stop = startRealtimePolling(load, LIVE_REFRESH_INTERVAL_MS, { pauseWhenHidden: true });

    expect(load).not.toHaveBeenCalled();
    expect(setTimeout).not.toHaveBeenCalled();

    doc.hidden = false;
    listeners.get("visibilitychange")?.();
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);
    expect(setTimeout).toHaveBeenCalledTimes(1);

    stop();
    expect(clearTimeout).toHaveBeenCalledWith(101);
  });
});
