import { afterEach, describe, expect, it, vi } from "vitest";

import {
  API_REQUEST_TIMEOUT_MS,
  getOverview,
} from "@/lib/api";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("shared API requests", () => {
  it("aborts a hung underlying request after the shared timeout", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted.", "AbortError"));
      }, { once: true });
    }));
    vi.stubGlobal("fetch", fetch);

    const expectation = expect(getOverview()).rejects.toThrow(
      `Request timed out after ${API_REQUEST_TIMEOUT_MS}ms`,
    );
    await vi.advanceTimersByTimeAsync(API_REQUEST_TIMEOUT_MS);
    await expectation;
    expect((fetch.mock.calls[0]?.[1] as RequestInit | undefined)?.signal?.aborted).toBe(true);
  });

  it("does not start an underlying request for an already-aborted subscriber", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    controller.abort();

    await expect(getOverview(controller.signal)).rejects.toHaveProperty("name", "AbortError");
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps a shared request alive when only one subscriber aborts", async () => {
    let resolveFetch!: (response: Response) => void;
    const fetch = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((resolve, reject) => {
        resolveFetch = resolve;
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        }, { once: true });
      });
    });
    vi.stubGlobal("fetch", fetch);
    const firstController = new AbortController();
    const secondController = new AbortController();

    const first = getOverview(firstController.signal);
    const second = getOverview(secondController.signal);
    firstController.abort();

    await expect(first).rejects.toHaveProperty("name", "AbortError");
    expect((fetch.mock.calls[0]?.[1] as RequestInit | undefined)?.signal?.aborted).toBe(false);
    resolveFetch(new Response(JSON.stringify({ generatedAt: "test", regions: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    await expect(second).resolves.toEqual({ generatedAt: "test", regions: [] });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
