"use client";

import { useEffect, useRef } from "react";

import { getLiveRevisions } from "@/lib/api";
import { startRealtimePolling } from "@/lib/realtime-polling";
import type { LiveRevisionsResponse } from "@/lib/types";

export const LIVE_REVISION_INTERVAL_MS = 30_000;
export const LIVE_REVISION_JITTER_MS = 5_000;
export const LIVE_REVISION_RETRY_DELAYS_MS = [30_000, 60_000, 120_000, 300_000];

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
  loadFull: () => Promise<void>;
  onError?: (error: Error) => void;
}) {
  const currentRevisionRef = useRef(currentRevision);
  const loadFullRef = useRef(loadFull);
  const selectRevisionRef = useRef(selectRevision);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    currentRevisionRef.current = currentRevision;
    loadFullRef.current = loadFull;
    selectRevisionRef.current = selectRevision;
    onErrorRef.current = onError;
  }, [currentRevision, loadFull, onError, selectRevision]);

  useEffect(() => {
    if (!enabled) return;
    let etag = "";
    let canceled = false;
    const controller = new AbortController();
    const check = async () => {
      try {
        if (!currentRevisionRef.current) {
          await loadFullRef.current();
          return;
        }
        const revision = await getLiveRevisions(etag || undefined, controller.signal);
        if (revision.etag) etag = revision.etag;
        if (!revision.changed || !revision.payload) return;
        const nextRevision = selectRevisionRef.current(revision.payload);
        if (nextRevision && nextRevision !== currentRevisionRef.current) {
          await loadFullRef.current();
          currentRevisionRef.current = nextRevision;
        }
      } catch (error) {
        if (!canceled) {
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
