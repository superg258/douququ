"use client";

import { useEffect, useMemo, useState } from "react";

import { getFinalEvent } from "@/lib/api";
import type { FinalEventMatch, FinalEventSlug } from "@/lib/types";

interface NextMatchState {
  event: FinalEventSlug;
  eventName: string;
  match: FinalEventMatch;
}

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
  const [next, setNext] = useState<NextMatchState | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let canceled = false;
    Promise.allSettled([getFinalEvent("repechage"), getFinalEvent("nationals")]).then((results) => {
      if (canceled) return;
      const candidates = results.flatMap((result, index) => {
        if (result.status !== "fulfilled") return [];
        const event = index === 0 ? "repechage" : "nationals";
        return result.value.event.matches.map((match) => ({
          event: event as FinalEventSlug,
          eventName: result.value.event.shortName,
          match,
        }));
      });
      const currentTime = Date.now();
      const upcoming = candidates
        .filter((candidate) => Date.parse(candidate.match.startsAt) >= currentTime)
        .sort((left, right) => left.match.startsAt.localeCompare(right.match.startsAt))[0] ?? null;
      setNext(upcoming);
      setFailed(results.every((result) => result.status === "rejected"));
    });
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const countdown = useMemo(() => next ? countdownLabel(next.match.startsAt, now) : "", [next, now]);

  if (failed) {
    return <div className="border border-rm-red/35 bg-rm-red/5 px-3 py-2 font-mono text-[10px] text-rm-red">下一场情报暂不可用</div>;
  }

  if (!next) {
    return <div className="border border-rm-metal-border bg-black/25 px-3 py-2 font-mono text-[10px] text-rm-metal-textMuted">正在同步下一场比赛情报…</div>;
  }

  return (
    <section aria-label="下一场比赛" className="border border-rm-gold/35 bg-rm-gold-dim px-3 py-2.5">
      <div className="flex items-center justify-between gap-3 font-mono text-[10px]">
        <span className="font-bold tracking-widest text-rm-gold">NEXT MATCH · {next.eventName}</span>
        <span className="text-rm-status-safe">{countdown}</span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs font-semibold text-rm-metal-textLight">
        <span className="truncate text-rm-red">{next.match.redSlot}</span>
        <span className="shrink-0 font-mono text-[10px] text-rm-metal-textMuted">VS</span>
        <span className="truncate text-right text-rm-blue">{next.match.blueSlot}</span>
      </div>
      <div className="mt-1 font-mono text-[10px] text-rm-metal-textMuted">
        #{String(next.match.number).padStart(2, "0")} · {formatTime(next.match.startsAt)} · BO{next.match.bestOf}
      </div>
    </section>
  );
}
