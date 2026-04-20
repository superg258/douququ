import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildRegionHref,
  compareRegionOrder,
  createLiveSeed,
  DEFAULT_SEED,
  getOrCreateSessionSeed,
  parseSeed,
  refreshSessionSeed,
} from "@/lib/region-config";

function installSessionStorage(initialValue?: string) {
  const store = new Map<string, string>();
  if (initialValue) {
    store.set("rmuc-live-seed", initialValue);
  }

  const windowStub = {
    sessionStorage: {
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store.set(key, value);
      }),
    },
  };

  vi.stubGlobal("window", windowStub);
  return { store, windowStub };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("region-config", () => {
  it("parses valid seeds and rejects invalid values", () => {
    expect(parseSeed("20260414")).toBe(20260414);
    expect(parseSeed("0")).toBeNull();
    expect(parseSeed(null)).toBeNull();
    expect(parseSeed("abc")).toBeNull();
  });

  it("orders regions in the published south-east-north sequence", () => {
    expect(compareRegionOrder("south_region", "east_region")).toBeLessThan(0);
    expect(compareRegionOrder("east_region", "north_region")).toBeLessThan(0);
  });

  it("preserves seed, highlight, and mode in workspace deep links", () => {
    const href = buildRegionHref("south_region", "swiss-a", {
      seed: 20261111,
      highlight: "red-team",
      mode: "live",
    });

    expect(href).toContain("view=swiss-a");
    expect(href).toContain("seed=20261111");
    expect(href).toContain("highlight=red-team");
    expect(href).toContain("mode=live");
  });

  it("reuses the stored session seed before creating a new one", () => {
    installSessionStorage("202611110001");

    expect(getOrCreateSessionSeed()).toBe(202611110001);
  });

  it("creates and stores a fresh session seed when refreshing", () => {
    const { store, windowStub } = installSessionStorage("202611110001");

    const nextSeed = refreshSessionSeed();

    expect(nextSeed).not.toBe(202611110001);
    expect(store.get("rmuc-live-seed")).toBe(String(nextSeed));
    expect(windowStub.sessionStorage.setItem).toHaveBeenCalledWith("rmuc-live-seed", String(nextSeed));
  });

  it("falls back to a valid default seed on the server", () => {
    expect(getOrCreateSessionSeed()).toBe(DEFAULT_SEED);
  });

  it("creates positive seeds for new simulations", () => {
    const seed = createLiveSeed();

    expect(seed).toBeGreaterThan(0);
    expect(Number.isFinite(seed)).toBe(true);
  });
});
