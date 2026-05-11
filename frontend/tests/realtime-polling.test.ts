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
    const setInterval = vi.fn(() => 101);
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
});
