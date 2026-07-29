"use client";

import { useEffect, useRef } from "react";

import { getLiveRevisions } from "@/lib/api";
import { startRealtimePolling } from "@/lib/realtime-polling";
import type { LiveRevisionsResponse } from "@/lib/types";

export const LIVE_REVISION_INTERVAL_MS = 30_000;
export const LIVE_REVISION_JITTER_MS = 5_000;
export const LIVE_REVISION_RETRY_DELAYS_MS = [30_000, 60_000, 120_000, 300_000];

type RevisionResponse = Awaited<ReturnType<typeof getLiveRevisions>>;

export function createRevisionPollCheck({
  signal,
  isActive,
  readCurrentRevision,
  commitRevision,
  selectRevision,
  loadFull,
  fetchRevisions = getLiveRevisions,
}: {
  signal: AbortSignal;
  isActive: () => boolean;
  readCurrentRevision: () => string | null | undefined;
  commitRevision: (revision: string) => void;
  selectRevision: (payload: LiveRevisionsResponse) => string | null | undefined;
  loadFull: (signal: AbortSignal) => Promise<void>;
  fetchRevisions?: (previousEtag?: string, signal?: AbortSignal) => Promise<RevisionResponse>;
}) {
  let initialized = false;
  let committedEtag = "";

  return async () => {
    // Every resource identity starts with an authoritative full load. This also
    // makes explicit retries and sim/live transitions independent of whether
    // both modes happen to share the same data revision.
    if (!initialized) {
      await loadFull(signal);
      if (!isActive()) return;
      initialized = true;
      return;
    }

    const revision = await fetchRevisions(committedEtag || undefined, signal);
    if (!isActive() || !revision.changed || !revision.payload) return;

    const nextRevision = selectRevision(revision.payload);
    if (!nextRevision) return;
    if (nextRevision !== readCurrentRevision()) {
      await loadFull(signal);
      if (!isActive()) return;
      commitRevision(nextRevision);
    }

    // A changed ETag is only acknowledged after any required full refresh
    // completed successfully. A failed refresh therefore retries against the
    // previous ETag instead of getting stuck on repeated 304 responses.
    if (isActive() && revision.etag) {
      committedEtag = revision.etag;
    }
  };
}

export function useRevisionPolling({
  enabled,
  resourceIdentity,
  currentRevision,
  selectRevision,
  loadFull,
  onError,
}: {
  enabled: boolean;
  resourceIdentity: string;
  currentRevision: string | null | undefined;
  selectRevision: (payload: LiveRevisionsResponse) => string | null | undefined;
  loadFull: (signal: AbortSignal) => Promise<void>;
  onError?: (error: Error) => void;
}) {
  const currentRevisionRef = useRef(currentRevision);
  const loadFullRef = useRef(loadFull);
  const selectRevisionRef = useRef(selectRevision);
  const onErrorRef = useRef(onError);
  const generationRef = useRef(0);

  useEffect(() => {
    currentRevisionRef.current = currentRevision;
    loadFullRef.current = loadFull;
    selectRevisionRef.current = selectRevision;
    onErrorRef.current = onError;
  }, [currentRevision, loadFull, onError, selectRevision]);

  useEffect(() => {
    if (!enabled) return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    let canceled = false;
    const controller = new AbortController();
    const isActive = () => !canceled
      && !controller.signal.aborted
      && generationRef.current === generation;
    const pollCheck = createRevisionPollCheck({
      signal: controller.signal,
      isActive,
      readCurrentRevision: () => currentRevisionRef.current,
      commitRevision: (revision) => {
        currentRevisionRef.current = revision;
      },
      selectRevision: (payload) => selectRevisionRef.current(payload),
      loadFull: (signal) => loadFullRef.current(signal),
    });
    const check = async () => {
      try {
        await pollCheck();
      } catch (error) {
        if (isActive()) {
          onErrorRef.current?.(error instanceof Error ? error : new Error(String(error)));
        }
        throw error;
      }
    };
    const stop = startRealtimePolling(check, LIVE_REVISION_INTERVAL_MS, {
      pauseWhenHidden: true,
      jitterMs: LIVE_REVISION_JITTER_MS,
      retryDelaysMs: LIVE_REVISION_RETRY_DELAYS_MS,
    });
    return () => {
      canceled = true;
      controller.abort();
      stop();
    };
  }, [enabled, resourceIdentity]);
}
