"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getFinalEvents } from "@/lib/api";
import { findNextOfficialMatch, getOfficialFinalSchedules } from "@/lib/finals-schedule";
import type { FinalEventsSnapshotResponse } from "@/lib/types";
import { useRevisionPolling } from "@/lib/use-revision-polling";

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

function countdownLabel(startsAt: string, now: number) {
  const delta = Date.parse(startsAt) - now;
  if (delta <= 0) return "已到开赛时间";
  const minutes = Math.ceil(delta / 60_000);
  const days = Math.floor(minutes / 1_440);
  const hours = Math.floor((minutes % 1_440) / 60);
  if (days > 0) return `${days} 天 ${hours} 小时后`;
  if (hours > 0) return `${hours} 小时 ${minutes % 60} 分后`;
  return `${minutes} 分钟后`;
}

export function NextMatchBrief() {
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
    resourceIdentity: `next-match:${reloadKey}`,
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
  const hasOfficialEvents = Boolean(
    officialEvents && (officialEvents.repechage || officialEvents.nationals),
  );
  const next = useMemo(
    () => snapshot ? findNextOfficialMatch(snapshot.events, new Date(now).toISOString()) : null,
    [now, snapshot],
  );
  const countdown = useMemo(() => next ? countdownLabel(next.match.startsAt, now) : "", [next, now]);

  if (!snapshot && loadError) {
    return (
      <div className="border border-rm-red/35 bg-rm-red/5 px-3 py-2 font-mono text-[10px] text-rm-red">
        下一场官方比赛情报暂不可用。
        <button type="button" onClick={() => setReloadKey((key) => key + 1)} className="ml-2 underline underline-offset-2">
          重试
        </button>
      </div>
    );
  }

  if (!snapshot) {
    return <div className="border border-rm-metal-border bg-black/25 px-3 py-2 font-mono text-[10px] text-rm-metal-textMuted">正在同步下一场比赛情报…</div>;
  }
  const refreshWarning = loadError ? (
    <div className="mb-2 border border-rm-status-warn/35 bg-rm-status-warn/5 px-3 py-1.5 font-mono text-[10px] text-rm-status-warn">
      实时刷新失败，当前保留上一次成功数据。
      <button type="button" onClick={() => setReloadKey((key) => key + 1)} className="ml-2 underline underline-offset-2">
        重试
      </button>
    </div>
  ) : null;
  if (!hasOfficialEvents) {
    return (
      <>
        {refreshWarning}
        <div className="flex flex-wrap items-center gap-2 border border-rm-status-warn/35 bg-rm-status-warn/5 px-3 py-2 font-mono text-[10px] text-rm-status-warn">
          官方实时赛程尚未发布。
          <Link href="/forecast-center?event=repechage&mode=sim" className="ml-auto text-rm-blue hover:text-white">
            查看模拟推演 →
          </Link>
        </div>
      </>
    );
  }
  if (!next) {
    return (
      <>
        {refreshWarning}
        <div className="border border-rm-metal-border bg-black/25 px-3 py-2 font-mono text-[10px] text-rm-metal-textMuted">当前没有后续官方比赛。</div>
      </>
    );
  }

  const eventName = snapshot.events[next.eventSlug].event.shortName;
  const redName = next.match.redCollegeName ?? next.match.redSlot;
  const blueName = next.match.blueCollegeName ?? next.match.blueSlot;

  return (
    <>
      {refreshWarning}
      <section aria-label="下一场比赛" className="border border-rm-gold/35 bg-rm-gold-dim px-3 py-2.5">
        <div className="flex items-center justify-between gap-3 font-mono text-[10px]">
          <span className="font-bold tracking-widest text-rm-gold">NEXT MATCH · {eventName}</span>
          <span className="text-rm-status-safe">{countdown}</span>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 text-xs font-semibold text-rm-metal-textLight">
          <span className="truncate text-rm-red">{redName}</span>
          <span className="shrink-0 font-mono text-[10px] text-rm-metal-textMuted">VS</span>
          <span className="truncate text-right text-rm-blue">{blueName}</span>
        </div>
        <div className="mt-1 font-mono text-[10px] text-rm-metal-textMuted">
          #{String(next.match.number).padStart(2, "0")} · {formatTime(next.match.startsAt)} · BO{next.match.bestOf}
        </div>
      </section>
    </>
  );
}
