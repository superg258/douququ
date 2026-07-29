"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { getFinalEvents } from "@/lib/api";
import { buildFinalsCanvasEntry } from "@/lib/finals-schedule";
import type { FinalEventsSnapshotResponse } from "@/lib/types";
import { useRevisionPolling } from "@/lib/use-revision-polling";

export function FinalsCanvasEntryLink({
  className,
}: {
  className?: string;
}) {
  const [snapshot, setSnapshot] = useState<FinalEventsSnapshotResponse | null | undefined>(undefined);
  const [dataRevision, setDataRevision] = useState<string | null>(null);

  const load = useCallback(async (signal: AbortSignal) => {
    const data = await getFinalEvents("live", signal);
    if (signal.aborted) return;
    setSnapshot(data);
    setDataRevision(data.dataRevision ?? data.runtimeArtifactVersion);
  }, []);

  useRevisionPolling({
    enabled: true,
    resourceIdentity: "finals-canvas-entry",
    currentRevision: dataRevision,
    selectRevision: (payload) => payload.finals.dataRevision,
    loadFull: load,
    onError: () => setSnapshot((current) => current ?? null),
  });

  const entry = buildFinalsCanvasEntry(snapshot);

  return (
    <Link href={entry.href} className={className}>
      <span>{entry.label}</span>
    </Link>
  );
}
