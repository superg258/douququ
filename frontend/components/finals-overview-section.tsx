"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { getFinalEvent, getOverview } from "@/lib/api";
import {
  hasActualFinalMatchup,
  projectFinalsStageProbabilities,
  rankFinalEventParticipantsByCurrentElo,
} from "@/lib/finals-schedule";
import type { FinalsStageProbabilityProjection } from "@/lib/finals-schedule";
import type { FinalEventResponse, FinalEventSlug, OverviewResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

type EventSchedule = FinalEventResponse["event"];

const EVENT_ORDER: FinalEventSlug[] = ["repechage", "nationals"];

const EVENT_TONES: Record<FinalEventSlug, {
  eyebrow: string;
  accent: string;
  border: string;
  glow: string;
  wash: string;
  badge: string;
  button: string;
}> = {
  repechage: {
    eyebrow: "LAST CHANCE QUALIFIER",
    accent: "text-rm-blue",
    border: "border-rm-blue/35",
    glow: "bg-rm-blue/75 shadow-[0_0_12px_rgba(42,159,255,0.45)]",
    wash: "bg-[radial-gradient(circle_at_12%_16%,rgba(42,159,255,0.13),transparent_38%)]",
    badge: "border-rm-blue/35 bg-rm-blue/8 text-rm-blue",
    button: "border-rm-blue/45 bg-rm-blue/10 text-rm-blue hover:bg-rm-blue hover:text-black",
  },
  nationals: {
    eyebrow: "NATIONAL CHAMPIONSHIP",
    accent: "text-rm-status-warn",
    border: "border-rm-status-warn/35",
    glow: "bg-rm-status-warn/70 shadow-[0_0_12px_rgba(255,176,0,0.45)]",
    wash: "bg-[radial-gradient(circle_at_88%_16%,rgba(255,176,0,0.11),transparent_36%)]",
    badge: "border-rm-status-warn/35 bg-rm-status-warn/8 text-rm-status-warn",
    button: "border-rm-status-warn/45 bg-rm-status-warn/10 text-rm-status-warn hover:bg-rm-status-warn hover:text-black",
  },
};

const STAGE_LABELS: Record<string, string> = {
  swiss: "瑞士轮",
  repechage_qualification: "名额争夺",
  round_of_16: "十六强",
  quarterfinal: "八强战",
  semifinal: "半决赛",
  third_place: "季军战",
  final: "冠军战",
};

const DATE_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "long",
  day: "numeric",
});

const MATCH_TIME_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function formatDateRange(range: EventSchedule["competitionRange"]) {
  return `${DATE_FORMATTER.format(new Date(`${range.start}T00:00:00+08:00`))}—${DATE_FORMATTER.format(new Date(`${range.end}T00:00:00+08:00`))}`;
}

function formatMatchTime(value: string) {
  return MATCH_TIME_FORMATTER.format(new Date(value)).replace(" ", " · ");
}

function formatProbability(value: number | undefined) {
  return value === undefined ? "—" : `${(value * 100).toFixed(1)}%`;
}

function buildStageFlow(event: EventSchedule) {
  const labels: string[] = [];
  for (const match of event.matches) {
    const label = STAGE_LABELS[match.stageKey] ?? match.stage;
    if (!labels.includes(label)) labels.push(label);
  }
  return labels;
}

function selectSchedulePreview(event: EventSchedule) {
  const ordered = event.matches
    .filter(hasActualFinalMatchup)
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt));
  const now = Date.now();
  const nextIndex = ordered.findIndex((match) => Date.parse(match.startsAt) >= now);
  const start = nextIndex >= 0 ? nextIndex : Math.max(0, ordered.length - 3);
  return ordered.slice(start, start + 3);
}

function EventPanel({
  eventSlug,
  event,
  overview,
  probabilities,
}: {
  eventSlug: FinalEventSlug;
  event: EventSchedule;
  overview: OverviewResponse;
  probabilities: FinalsStageProbabilityProjection;
}) {
  const tone = EVENT_TONES[eventSlug];
  const confirmedParticipants = rankFinalEventParticipantsByCurrentElo(event.participants, overview);
  const schedulePreview = selectSchedulePreview(event);
  const stageFlow = buildStageFlow(event);
  const statusLabel = eventSlug === "repechage"
    ? "参赛名单已确认 · 抽签待定"
    : `${confirmedParticipants.length} 队名单已确认 · 抽签待定`;
  const thirdMetric = eventSlug === "repechage"
    ? { label: "晋级名额", value: `${event.advancementSlots ?? 0} 席` }
    : { label: "赛事阶段", value: `${stageFlow.length} 段` };

  return (
    <article className={cn("relative min-w-0 overflow-hidden border bg-rm-metal-card", tone.border)}>
      <div className={cn("pointer-events-none absolute inset-0", tone.wash)} />
      <div className={cn("absolute inset-x-0 top-0 h-0.5", tone.glow)} />

      <div className="relative flex h-full min-w-0 flex-col p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-rm-metal-border/70 pb-5">
          <div>
            <p className={cn("font-mono text-[9px] font-bold tracking-[0.28em]", tone.accent)}>{tone.eyebrow}</p>
            <h3 className="mt-2 font-machine text-2xl font-black tracking-widest text-rm-metal-textLight md:text-3xl">
              {event.name}
            </h3>
            <p className="mt-2 font-mono text-[11px] text-rm-metal-textMuted">
              {formatDateRange(event.competitionRange)} · 北京时间
            </p>
          </div>
          <span className={cn("border px-2.5 py-1 font-mono text-[9px]", tone.badge)}>{statusLabel}</span>
        </div>

        <div className="grid grid-cols-3 gap-2 border-b border-rm-metal-border/70 py-4">
          {[
            { label: "已确认队伍", value: `${confirmedParticipants.length} 支` },
            { label: "正式赛局", value: `${event.matches.length} 场` },
            thirdMetric,
          ].map((metric) => (
            <div key={metric.label} className="border border-rm-metal-border bg-black/20 px-3 py-3">
              <p className="font-mono text-[8px] tracking-widest text-rm-metal-textFaint">{metric.label}</p>
              <p className={cn("mt-1 font-machine text-lg font-bold", tone.accent)}>{metric.value}</p>
            </div>
          ))}
        </div>

        {schedulePreview.length > 0 && (
          <div className="border-b border-rm-metal-border/70 py-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h4 className="font-sans text-sm font-semibold text-rm-metal-textLight">赛程预览</h4>
              <span className="font-mono text-[9px] text-rm-metal-textFaint">接下来 3 场</span>
            </div>
            <div className="space-y-2">
              {schedulePreview.map((match) => (
                <div key={`${match.number}-${match.startsAt}`} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border border-rm-metal-border/80 bg-rm-metal-panel/65 px-3 py-2.5">
                  <span className={cn("font-mono text-[10px] font-bold", tone.accent)}>#{String(match.number).padStart(2, "0")}</span>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-rm-metal-textLight" title={`${match.redSlot} 对阵 ${match.blueSlot}`}>
                      <span className="text-rm-red">{match.redSlot}</span>
                      <span className="mx-2 font-mono text-[9px] text-rm-metal-textFaint">对阵</span>
                      <span className="text-rm-blue">{match.blueSlot}</span>
                    </p>
                    <p className="mt-0.5 truncate font-mono text-[9px] text-rm-metal-textFaint" title={match.stage}>{match.stage}</p>
                  </div>
                  <span className="whitespace-nowrap font-mono text-[9px] text-rm-metal-textMuted">{formatMatchTime(match.startsAt)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex-1 py-4">
          <div className="mb-2 flex items-center gap-2">
            <div className={cn("h-3 w-1", tone.glow)} />
            <h4 className="text-[9px] font-bold uppercase tracking-widest text-rm-metal-textLight">战力矩阵</h4>
            <span className="ml-auto text-[8px] text-rm-metal-textFaint/50">
              共 {confirmedParticipants.length} 支 · {probabilities.iterations.toLocaleString("zh-CN")} 次 ELO 模拟
            </span>
          </div>
          <div className="w-full min-w-0 max-w-full max-h-64 overflow-auto border-y border-rm-metal-border/40 pr-1">
            <table className={cn(
              "w-full table-fixed border-collapse text-[10px]",
              eventSlug === "nationals" ? "min-w-[30rem]" : "min-w-[22rem]",
            )}>
              <thead className="sticky top-0 z-10 bg-rm-metal-dark/95 backdrop-blur">
                <tr className="border-b border-rm-metal-border text-[8px] uppercase tracking-widest text-rm-metal-textFaint">
                  <td className="w-8 py-1.5">#</td>
                  <td className={cn("py-1.5", eventSlug === "nationals" && "w-32")}>高校</td>
                  <td className="w-16 py-1.5 text-right">Elo</td>
                  {eventSlug === "repechage" ? (
                    <td className="w-14 py-1.5 text-right">晋级</td>
                  ) : (
                    <>
                      <td className="w-14 py-1.5 text-right">出线</td>
                      <td className="w-14 py-1.5 text-right">四强</td>
                      <td className="w-14 py-1.5 text-right">冠军</td>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-rm-metal-border/30 font-mono">
                {confirmedParticipants.map((participant, index) => (
                  <tr
                    key={`${participant.order}-${participant.teamName}`}
                    className={cn(
                      "transition-colors hover:bg-rm-metal-panel/50",
                      index < 2 ? "font-semibold text-rm-metal-textLight" : "text-rm-metal-textMuted",
                    )}
                  >
                    <td className="py-1.5 text-rm-metal-textFaint">{index + 1}</td>
                    <td className="whitespace-nowrap py-1.5 pr-2 font-sans text-[11px] leading-snug" title={`${participant.collegeName} · ${participant.teamName}`}>
                      {participant.collegeName}
                    </td>
                    <td className={cn("py-1.5 text-right font-semibold tracking-tight tabular-nums", tone.accent)}>
                      {participant.currentElo?.toFixed(1) ?? "待关联"}
                    </td>
                    {eventSlug === "repechage" ? (
                      <td className="py-1.5 text-right font-semibold tabular-nums text-rm-status-safe">
                        {formatProbability(probabilities.repechage.get(participant.teamKey)?.advancementRate)}
                      </td>
                    ) : (
                      <>
                        <td className="py-1.5 text-right tabular-nums text-rm-metal-textLight">
                          {formatProbability(probabilities.nationals.get(participant.teamKey)?.groupAdvancementRate)}
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-rm-metal-textLight">
                          {formatProbability(probabilities.nationals.get(participant.teamKey)?.topFourRate)}
                        </td>
                        <td className={cn("py-1.5 text-right font-semibold tabular-nums", tone.accent)}>
                          {formatProbability(probabilities.nationals.get(participant.teamKey)?.championRate)}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 border-t border-rm-metal-border/70 pt-4">
          <Link
            href={`/forecast-center?event=${eventSlug}&view=bracket`}
            className={cn("flex items-center justify-center border px-3 py-2.5 font-mono text-[11px] font-bold transition-all", tone.button)}
          >
            查看对阵图
          </Link>
          <Link
            href={`/forecast-center?event=${eventSlug}&view=matches`}
            className="flex items-center justify-center border border-rm-metal-border bg-rm-metal-panel px-3 py-2.5 font-mono text-[11px] font-bold text-rm-metal-textLight transition-all hover:border-white/35 hover:bg-white/5"
          >
            查看全部赛局
          </Link>
        </div>
      </div>
    </article>
  );
}

function LoadingPanels() {
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      {EVENT_ORDER.map((eventSlug) => (
        <div key={eventSlug} className="h-[34rem] animate-pulse border border-rm-metal-border bg-rm-metal-card/70">
          <div className="h-0.5 bg-rm-blue/30" />
          <div className="space-y-4 p-6">
            <div className="h-7 w-2/5 bg-rm-metal-panel" />
            <div className="h-20 bg-rm-metal-panel/80" />
            <div className="h-36 bg-rm-metal-panel/60" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function FinalsOverviewSection() {
  const [events, setEvents] = useState<Record<FinalEventSlug, FinalEventResponse> | null>(null);
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState("");
  const probabilities = useMemo(() => {
    if (!events || !overview) return null;
    return projectFinalsStageProbabilities(
      events.repechage.event.participants,
      events.nationals.event.participants,
      overview,
    );
  }, [events, overview]);

  useEffect(() => {
    let canceled = false;
    Promise.all([getOverview(), getFinalEvent("repechage"), getFinalEvent("nationals")])
      .then(([overviewResponse, repechage, nationals]) => {
        if (canceled) return;
        setOverview(overviewResponse);
        setEvents({ repechage, nationals });
        setError("");
      })
      .catch((reason) => {
        if (canceled) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      canceled = true;
    };
  }, []);

  return (
    <section aria-labelledby="finals-overview-heading">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <div className="h-4 w-0.5 bg-rm-blue/70 shadow-[0_0_6px_rgba(42,159,255,0.35)]" />
            <div className="h-4 w-0.5 bg-rm-status-warn/70 shadow-[0_0_6px_rgba(255,176,0,0.35)]" />
          </div>
          <div>
            <h2 id="finals-overview-heading" className="font-sans text-lg font-semibold tracking-wide text-rm-metal-textLight">
              复活赛与全国赛
            </h2>
            <p className="mt-1 font-mono text-[10px] text-rm-metal-textFaint">官方名单 · 正式场序 · 北京时间</p>
          </div>
        </div>
        <span className={cn(
          "border px-2.5 py-1 font-mono text-[9px]",
          error
            ? "border-rm-red/30 bg-rm-red/5 text-rm-red"
            : events
              ? "border-rm-status-safe/25 bg-rm-status-safe/5 text-rm-status-safe"
              : "border-rm-blue/25 bg-rm-blue/5 text-rm-blue",
        )}>
          {error ? "数据暂不可用" : events ? "官方赛程已接入" : "官方赛程同步中"}
        </span>
      </div>

      {error ? (
        <div className="border border-rm-red/30 bg-rm-red/5 p-4 font-mono text-xs text-rm-red">
          全国阶段数据加载失败：{error}
        </div>
      ) : !events || !overview || !probabilities ? (
        <LoadingPanels />
      ) : (
        <div className="grid items-stretch gap-5 xl:grid-cols-2">
          {EVENT_ORDER.map((eventSlug) => (
            <EventPanel
              key={eventSlug}
              eventSlug={eventSlug}
              event={events[eventSlug].event}
              overview={overview}
              probabilities={probabilities}
            />
          ))}
        </div>
      )}
    </section>
  );
}
