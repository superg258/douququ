"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { getFinalEvents } from "@/lib/api";
import { buildFinalsCanvasEntry } from "@/lib/finals-schedule";
import type { FinalEventsSnapshotResponse } from "@/lib/types";

export function FinalsCanvasEntryLink({
  className,
}: {
  className?: string;
}) {
  const [snapshot, setSnapshot] = useState<FinalEventsSnapshotResponse | null | undefined>(undefined);

  useEffect(() => {
    let canceled = false;
    getFinalEvents("live")
      .then((data) => {
        if (!canceled) setSnapshot(data);
      })
      .catch(() => {
        if (!canceled) setSnapshot(null);
      });
    return () => {
      canceled = true;
    };
  }, []);

  const entry = buildFinalsCanvasEntry(snapshot);

  return (
    <Link href={entry.href} className={className}>
      <span>{entry.label}</span>
      {entry.statusLabel !== null && (
        <span className="ml-2 border border-current/35 px-1.5 py-0.5 text-[9px] tracking-normal opacity-80">
          {entry.statusLabel}
        </span>
      )}
    </Link>
  );
}
