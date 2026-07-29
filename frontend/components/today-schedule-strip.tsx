"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getFinalEvents } from "@/lib/api";
import { buildScheduleStrip } from "@/lib/schedule-strip";
import type { FinalEventSchedule, FinalEventSlug } from "@/lib/types";
import { useRevisionPolling } from "@/lib/use-revision-polling";
import { cn } from "@/lib/utils";

const EVENT_BADGE_TONES: Record<FinalEventSlug, string> = {
  repechage: "border-rm-blue/35 bg-rm-blue/10 text-rm-blue",
  nationals: "border-rm-status-warn/35 bg-rm-status-warn/10 text-rm-status-warn",
};

export function TodayScheduleStrip() {
  const [events, setEvents] = useState<Record<FinalEventSlug, FinalEventSchedule> | null>(null);
  const [dataRevision, setDataRevision] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const payload = await getFinalEvents("live");
    const { repechage, nationals } = payload.events;
    if (!repechage || !nationals) throw new Error("决赛数据不完整");
    setEvents({ repechage: repechage.event, nationals: nationals.event });
    setDataRevision(payload.dataRevision ?? payload.runtimeArtifactVersion);
  }, []);

  useRevisionPolling({
    enabled: true,
    resourceIdentity: "today-schedule",
    currentRevision: dataRevision,
    selectRevision: (payload) => payload.finals.dataRevision,
    loadFull: load,
  });

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const model = useMemo(
    () => events ? buildScheduleStrip(events, new Date(now)) : null,
    [events, now],
  );

  if (!model) return null;

  return (
    <section aria-labelledby="today-schedule-heading">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <div className="h-4 w-0.5 bg-rm-red/70 shadow-[0_0_6px_rgba(232,48,42,0.35)]" />
          <div className="h-4 w-0.5 bg-rm-blue/70 shadow-[0_0_6px_rgba(42,159,255,0.35)]" />
        </div>
        <h2 id="today-schedule-heading" className="font-sans text-sm font-semibold tracking-wide text-rm-metal-textLight">
          {model.kind === "today" ? "今日赛程" : "即将开赛"}
        </h2>
        <span className="font-mono text-[10px] text-rm-metal-textFaint">
          {model.kind === "today" ? `${model.dateLabel} · 共 ${model.items.length} 场` : `最近一场 ${model.dateLabel}`}
        </span>
        <Link
          href="/forecast-center?event=repechage&mode=live"
          className="ml-auto font-mono text-[10px] text-rm-metal-textMuted transition-colors hover:text-white"
        >
          实时对阵图 →
        </Link>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
        {model.items.map((item) => (
          <Link
            key={item.id}
            href={`/forecast-center?event=${item.eventSlug}&mode=live`}
            className={cn(
              "group w-64 shrink-0 border border-rm-metal-border bg-rm-metal-card px-3 py-2.5 transition-colors",
              item.status === "live"
                ? "border-rm-red/50 shadow-[0_0_12px_rgba(232,48,42,0.15)]"
                : "hover:border-white/25",
            )}
            style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02)" }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className={cn("border px-1.5 py-0.5 font-mono text-[9px]", EVENT_BADGE_TONES[item.eventSlug])}>
                {item.eventShortName}
              </span>
              {item.status === "live" ? (
                <span className="flex items-center gap-1 font-mono text-[9px] font-bold text-rm-red">
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-rm-red" />
                  进行中
                </span>
              ) : item.status === "completed" ? (
                <span className="font-mono text-[9px] text-rm-status-safe">已结束</span>
              ) : (
                <span className="font-mono text-[10px] font-bold tabular-nums text-rm-metal-textLight">{item.timeLabel}</span>
              )}
            </div>
            <div className="mt-2 flex items-baseline gap-2 text-xs">
              <span className={cn(
                "min-w-0 flex-1 truncate text-right font-semibold",
                item.winnerSide === "red" ? "text-rm-red" : item.hasActualTeams ? "text-rm-metal-textLight" : "text-rm-metal-textMuted",
              )}>
                {item.redName}
              </span>
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-rm-metal-textFaint">
                {item.scoreline ?? "vs"}
              </span>
              <span className={cn(
                "min-w-0 flex-1 truncate font-semibold",
                item.winnerSide === "blue" ? "text-rm-blue" : item.hasActualTeams ? "text-rm-metal-textLight" : "text-rm-metal-textMuted",
              )}>
                {item.blueName}
              </span>
            </div>
            <div className="mt-1.5 truncate font-mono text-[9px] text-rm-metal-textFaint">
              #{String(item.matchNumber).padStart(2, "0")} · {item.stage}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
