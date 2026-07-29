import { describe, expect, it, vi } from "vitest";

import { createRevisionPollCheck } from "@/lib/use-revision-polling";
import type { LiveRevisionsResponse } from "@/lib/types";

function revisions(dataRevision: string, etag: string) {
  return {
    changed: true,
    etag,
    payload: {
      finals: { dataRevision },
    } as LiveRevisionsResponse,
  };
}

describe("revision poll check", () => {
  it("retries the initial full load before checking revisions", async () => {
    const loadFull = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    const fetchRevisions = vi.fn();
    const controller = new AbortController();
    const check = createRevisionPollCheck({
      signal: controller.signal,
      isActive: () => true,
      readCurrentRevision: () => "r1",
      commitRevision: () => undefined,
      selectRevision: (payload) => payload.finals.dataRevision,
      loadFull,
      fetchRevisions,
    });

    await expect(check()).rejects.toThrow("offline");
    await check();

    expect(loadFull).toHaveBeenCalledTimes(2);
    expect(fetchRevisions).not.toHaveBeenCalled();
  });

  it("does not commit a new ETag until the matching full load succeeds", async () => {
    let currentRevision = "r1";
    const loadFull = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("refresh failed"))
      .mockResolvedValueOnce(undefined);
    const fetchRevisions = vi.fn()
      .mockResolvedValueOnce(revisions("r1", "etag-1"))
      .mockResolvedValueOnce(revisions("r2", "etag-2"))
      .mockResolvedValueOnce(revisions("r2", "etag-2"));
    const controller = new AbortController();
    const check = createRevisionPollCheck({
      signal: controller.signal,
      isActive: () => true,
      readCurrentRevision: () => currentRevision,
      commitRevision: (revision) => {
        currentRevision = revision;
      },
      selectRevision: (payload) => payload.finals.dataRevision,
      loadFull,
      fetchRevisions,
    });

    await check();
    await check();
    await expect(check()).rejects.toThrow("refresh failed");
    await check();

    expect(fetchRevisions.mock.calls.map(([etag]) => etag)).toEqual([
      undefined,
      "etag-1",
      "etag-1",
    ]);
    expect(currentRevision).toBe("r2");
  });

  it("forces a full load for every new resource identity even when revisions match", async () => {
    const loadFull = vi.fn().mockResolvedValue(undefined);
    const controllerA = new AbortController();
    const controllerB = new AbortController();
    const common = {
      isActive: () => true,
      readCurrentRevision: () => "same-revision",
      commitRevision: () => undefined,
      selectRevision: (payload: LiveRevisionsResponse) => payload.finals.dataRevision,
      loadFull,
      fetchRevisions: vi.fn(),
    };

    await createRevisionPollCheck({ ...common, signal: controllerA.signal })();
    await createRevisionPollCheck({ ...common, signal: controllerB.signal })();

    expect(loadFull).toHaveBeenCalledTimes(2);
  });

  it("does not let a stale identity commit a revision after its load resolves", async () => {
    let active = true;
    let currentRevision = "r1";
    let resolveRefresh!: () => void;
    const loadFull = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        resolveRefresh = resolve;
      }));
    const fetchRevisions = vi.fn()
      .mockResolvedValueOnce(revisions("r1", "etag-1"))
      .mockResolvedValueOnce(revisions("r2", "etag-2"));
    const controller = new AbortController();
    const check = createRevisionPollCheck({
      signal: controller.signal,
      isActive: () => active,
      readCurrentRevision: () => currentRevision,
      commitRevision: (revision) => {
        currentRevision = revision;
      },
      selectRevision: (payload) => payload.finals.dataRevision,
      loadFull,
      fetchRevisions,
    });

    await check();
    await check();
    const staleRefresh = check();
    await Promise.resolve();
    await Promise.resolve();
    expect(loadFull).toHaveBeenCalledTimes(2);
    active = false;
    controller.abort();
    resolveRefresh();
    await staleRefresh;

    expect(currentRevision).toBe("r1");
  });
});
