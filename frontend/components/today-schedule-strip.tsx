"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getFinalEvents } from "@/lib/api";
import { getOfficialFinalSchedules } from "@/lib/finals-schedule";
import { buildScheduleStrip } from "@/lib/schedule-strip";
import type { FinalEventsSnapshotResponse, FinalEventSlug } from "@/lib/types";
import { useRevisionPolling } from "@/lib/use-revision-polling";
import { cn } from "@/lib/utils";

const EVENT_BADGE_TONES: Record<FinalEventSlug, string> = {
  repechage: "border-rm-blue/35 bg-rm-blue/10 text-rm-blue",
  nationals: "border-rm-status-warn/35 bg-rm-status-warn/10 text-rm-status-warn",
};

export function TodayScheduleStrip() {
  const [snapshot, setSnapshot] = useState<FinalEventsSnapshotResponse | null>(null);
  const [dataRevision, setDataRevision] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async (signal: AbortSignal) => {
    const payload = await getFinalEvents("live", signal);
    if (signal.aborted) return;
    setSnapshot(payload);
    setDataRevision(payload.dataRevision ?? payload.runtimeArtifactVersion);
    setLoadError(null);
  }, []);

  useRevisionPolling({
    enabled: true,
    resourceIdentity: `today-schedule:${reloadKey}`,
    currentRevision: dataRevision,
    selectRevision: (payload) => payload.finals.dataRevision,
    loadFull: load,
    onError: (error) => setLoadError(error.message),
  });

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const officialEvents = useMemo(
    () => snapshot ? getOfficialFinalSchedules(snapshot.events) : null,
    [snapshot],
  );
  const model = useMemo(
    () => officialEvents ? buildScheduleStrip(officialEvents, new Date(now)) : null,
    [officialEvents, now],
  );
  const liveEventSlug = model?.items[0]?.eventSlug
    ?? (officialEvents?.repechage ? "repechage" : officialEvents?.nationals ? "nationals" : null);

  if (!snapshot && loadError) {
    return (
      <div className="border border-rm-red/35 bg-rm-red/5 px-3 py-2 font-mono text-[10px] text-rm-red">
        官方赛程状态暂不可用。
        <button type="button" onClick={() => setReloadKey((key) => key + 1)} className="ml-2 underline underline-offset-2">
          重试
        </button>
      </div>
    );
  }
  if (!snapshot) return null;
  const refreshWarning = loadError ? (
    <div className="mb-2 border border-rm-status-warn/35 bg-rm-status-warn/5 px-3 py-1.5 font-mono text-[10px] text-rm-status-warn">
      官方赛程刷新失败，当前保留上一次成功数据。
      <button type="button" onClick={() => setReloadKey((key) => key + 1)} className="ml-2 underline underline-offset-2">
        重试
      </button>
    </div>
  ) : null;
  if (!liveEventSlug) {
    return (
      <>
        {refreshWarning}
        <section aria-label="官方赛程状态" className="flex flex-wrap items-center gap-2 border border-rm-status-warn/35 bg-rm-status-warn/5 px-3 py-2.5">
          <span className="font-mono text-[10px] font-bold text-rm-status-warn">官方实时赛程尚未发布</span>
          <span className="font-mono text-[10px] text-rm-metal-textMuted">首页仅提供模拟推演，不把参考模板标为实时。</span>
          <Link href="/forecast-center?event=repechage&mode=sim" className="ml-auto font-mono text-[10px] text-rm-blue hover:text-white">
            进入模拟对阵图 →
          </Link>
        </section>
      </>
    );
  }
  if (!model) {
    return (
      <>
        {refreshWarning}
        <section aria-label="官方赛程状态" className="flex flex-wrap items-center gap-2 border border-rm-metal-border bg-rm-metal-card px-3 py-2.5">
          <span className="font-mono text-[10px] text-rm-metal-textMuted">当前没有后续官方比赛。</span>
          <Link href={`/forecast-center?event=${liveEventSlug}&mode=live`} className="ml-auto font-mono text-[10px] text-rm-blue hover:text-white">
            查看官方对阵图 →
          </Link>
        </section>
      </>
    );
  }

  return (
    <>
      {refreshWarning}
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
            href={`/forecast-center?event=${liveEventSlug}&mode=live`}
            className="ml-auto font-mono text-[10px] text-rm-metal-textMuted transition-colors hover:text-white"
          >
            官方实时对阵图 →
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
    </>
  );
}
