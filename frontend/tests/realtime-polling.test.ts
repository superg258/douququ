import { afterEach, describe, expect, it, vi } from "vitest";

import { startRealtimePolling } from "@/lib/realtime-polling";

const TEST_INTERVAL_MS = 30_000;

describe("realtime polling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads immediately and schedules the next check only after settle", async () => {
    const load = vi.fn();
    const setTimeout = vi.fn<(callback: () => void, timeout: number) => number>(() => 101);
    const clearTimeout = vi.fn();
    vi.stubGlobal("window", { setTimeout, clearTimeout });

    const stop = startRealtimePolling(load, TEST_INTERVAL_MS);
    await Promise.resolve();

    expect(load).toHaveBeenCalledTimes(1);
    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), TEST_INTERVAL_MS);

    const tick = setTimeout.mock.calls[0][0] as () => void;
    tick();
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(2);

    stop();
    expect(clearTimeout).toHaveBeenCalledWith(101);
  });

  it("does not schedule an overlapping request while the current load is pending", async () => {
    let resolveLoad!: () => void;
    const load = vi.fn(() => new Promise<void>((resolve) => {
      resolveLoad = resolve;
    }));
    const setTimeout = vi.fn<(callback: () => void, timeout: number) => number>(() => 101);
    const clearTimeout = vi.fn();
    vi.stubGlobal("window", { setTimeout, clearTimeout });

    const stop = startRealtimePolling(load, TEST_INTERVAL_MS);

    expect(load).toHaveBeenCalledTimes(1);
    expect(setTimeout).not.toHaveBeenCalled();

    resolveLoad();
    await Promise.resolve();
    await Promise.resolve();
    expect(setTimeout).toHaveBeenCalledTimes(1);

    stop();
  });

  it("uses bounded retry delays after failures", async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("still offline"))
      .mockResolvedValue(undefined);
    const setTimeout = vi.fn<(callback: () => void, timeout: number) => number>(() => 101);
    const clearTimeout = vi.fn();
    vi.stubGlobal("window", { setTimeout, clearTimeout });

    const stop = startRealtimePolling(load, 30_000, {
      retryDelaysMs: [30_000, 60_000, 120_000],
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(setTimeout.mock.calls[0][1]).toBe(30_000);

    setTimeout.mock.calls[0][0]();
    await Promise.resolve();
    await Promise.resolve();
    expect(setTimeout.mock.calls[1][1]).toBe(60_000);

    stop();
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

    const stop = startRealtimePolling(load, TEST_INTERVAL_MS, { pauseWhenHidden: true });
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

    const stop = startRealtimePolling(load, TEST_INTERVAL_MS, { pauseWhenHidden: true });

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
