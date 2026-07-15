"use client";

import { useEffect, useMemo, useState } from "react";

import { WorkspaceStageView } from "@/components/workspace-stage";
import { getFinalEvent } from "@/lib/api";
import { buildFinalsWorkspaceStage } from "@/lib/finals-canvas";
import {
  FINAL_STAGE_OPTIONS,
  buildFinalEventDays,
  formatFinalsDate,
  formatFinalsDateRange,
  matchesForFinalStage,
} from "@/lib/finals-schedule";
import type {
  FinalEventMatch,
  FinalEventResponse,
  FinalEventSlug,
  FinalEventStageFilter,
} from "@/lib/types";
import { cn } from "@/lib/utils";

type ForecastView = "bracket" | "matches";

const EVENT_OPTIONS: Array<{ id: FinalEventSlug; label: string; code: string }> = [
  { id: "repechage", label: "复活赛", code: "REP" },
  { id: "nationals", label: "全国赛", code: "NAT" },
];

const VIEW_OPTIONS: Array<{ id: ForecastView; label: string; description: string }> = [
  { id: "bracket", label: "对阵图", description: "查看槽位与胜败流向" },
  { id: "matches", label: "赛局", description: "按日期查看正式比赛" },
];

function defaultStage(eventSlug: FinalEventSlug) {
  return FINAL_STAGE_OPTIONS[eventSlug][0].id;
}

function isFinalEventSlug(value: string | null): value is FinalEventSlug {
  return value === "repechage" || value === "nationals";
}

function isForecastView(value: string | null): value is ForecastView {
  return value === "bracket" || value === "matches";
}

function updateDeepLink(eventSlug: FinalEventSlug, view: ForecastView, stage: FinalEventStageFilter) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams({ event: eventSlug, view, stage });
  window.history.replaceState(null, "", `/forecast-center?${params.toString()}`);
}

function MatchRoute({ match }: { match: FinalEventMatch }) {
  if (!match.winnerTo && !match.loserTo) {
    return <span className="text-rm-metal-textFaint">瑞士轮排名决定后续落位</span>;
  }
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {match.winnerTo ? <span className="text-rm-status-safe">胜 → {match.winnerTo}</span> : null}
      {match.loserTo ? <span className="text-rm-metal-textMuted">负 → {match.loserTo}</span> : null}
    </span>
  );
}

function ScheduledMatchCard({ match, selected, onSelect }: {
  match: FinalEventMatch;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group relative w-full overflow-hidden border bg-black/55 text-left clip-chamfer transition-all hover:border-rm-blue/50 hover:bg-black/75",
        selected ? "border-rm-blue shadow-[0_0_18px_rgba(42,159,255,0.16)]" : "border-rm-metal-border",
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] bg-white/[0.025] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 border border-rm-status-scheduled/40 bg-rm-status-scheduled/10 px-1.5 py-0.5 font-mono text-[9px] font-bold text-rm-status-scheduled">
            官方排期
          </span>
          <span className="truncate font-machine text-[11px] font-bold tracking-widest text-white">第 {match.number} 场</span>
        </div>
        <span className="shrink-0 font-mono text-[10px] text-rm-metal-textMuted">{match.startTime} · BO{match.bestOf}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2">
        <div className="flex min-w-0 items-center gap-3 border-b border-white/[0.05] bg-[linear-gradient(90deg,rgba(232,48,42,0.12),transparent)] px-4 py-3 sm:border-b-0 sm:border-r">
          <span className="h-8 w-1 shrink-0 bg-rm-red/80 shadow-[0_0_8px_rgba(232,48,42,0.3)]" />
          <div className="min-w-0">
            <div className="font-mono text-[9px] tracking-widest text-rm-red/70">红方槽位</div>
            <div className="mt-1 truncate font-mono text-sm font-bold text-white" title={match.redSlot}>{match.redSlot}</div>
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-3 bg-[linear-gradient(90deg,rgba(42,159,255,0.12),transparent)] px-4 py-3">
          <span className="h-8 w-1 shrink-0 bg-rm-blue/80 shadow-[0_0_8px_rgba(42,159,255,0.3)]" />
          <div className="min-w-0">
            <div className="font-mono text-[9px] tracking-widest text-rm-blue/70">蓝方槽位</div>
            <div className="mt-1 truncate font-mono text-sm font-bold text-white" title={match.blueSlot}>{match.blueSlot}</div>
          </div>
        </div>
      </div>
      <div className="border-t border-white/[0.06] px-3 py-2 font-mono text-[9px]">
        <MatchRoute match={match} />
      </div>
    </button>
  );
}

function MatchesView({ event, stage, selectedMatchKey, onSelect }: {
  event: FinalEventResponse["event"];
  stage: FinalEventStageFilter;
  selectedMatchKey: string | null;
  onSelect: (matchKey: string) => void;
}) {
  const days = buildFinalEventDays(event, stage);
  return (
    <div className="space-y-7">
      {days.map((day) => (
        <section key={day.date} className="border border-rm-metal-border bg-rm-metal-panel/65">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rm-metal-border bg-black/35 px-4 py-3">
            <div>
              <div className="font-machine text-sm font-bold tracking-widest text-white">{formatFinalsDate(day.date)}</div>
              <div className="mt-1 font-mono text-[9px] tracking-[0.18em] text-rm-metal-textFaint">OFFICIAL MATCH DAY</div>
            </div>
            <span className="border border-rm-blue/30 bg-rm-blue/10 px-2 py-1 font-mono text-[10px] text-rm-blue">{day.matchCount} 场正式比赛</span>
          </div>
          <div className="space-y-5 p-4">
            {day.stages.map((stageGroup) => (
              <div key={stageGroup.stage}>
                <div className="mb-3 flex items-center gap-3">
                  <span className="h-px flex-1 bg-rm-metal-border" />
                  <span className="font-mono text-[10px] font-bold tracking-wider text-rm-metal-textMuted">{stageGroup.stage}</span>
                  <span className="h-px flex-1 bg-rm-metal-border" />
                </div>
                <div className="grid gap-3 xl:grid-cols-2">
                  {stageGroup.matches.map((match) => {
                    const matchKey = `${event.slug}:${match.number}`;
                    return (
                      <ScheduledMatchCard
                        key={matchKey}
                        match={match}
                        selected={selectedMatchKey === matchKey}
                        onSelect={() => onSelect(matchKey)}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function SelectedMatchStrip({ match }: { match: FinalEventMatch | null }) {
  if (!match) return null;
  return (
    <div className="grid gap-3 border-x border-b border-rm-metal-border bg-black/70 px-4 py-3 font-mono text-[10px] md:grid-cols-[auto_1fr_auto] md:items-center">
      <span className="font-bold text-white">已选第 {match.number} 场 · {match.stage}</span>
      <MatchRoute match={match} />
      <span className="text-rm-status-scheduled">{match.startsAt.slice(0, 10)} {match.startTime} · BO{match.bestOf}</span>
    </div>
  );
}

export function ForecastCenterPage() {
  const [eventSlug, setEventSlug] = useState<FinalEventSlug>("repechage");
  const [view, setView] = useState<ForecastView>("bracket");
  const [stage, setStage] = useState<FinalEventStageFilter>(defaultStage("repechage"));
  const [events, setEvents] = useState<Record<FinalEventSlug, FinalEventResponse> | null>(null);
  const [selectedMatchKey, setSelectedMatchKey] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedEvent = params.get("event");
    const requestedView = params.get("view");
    const nextEvent = isFinalEventSlug(requestedEvent) ? requestedEvent : "repechage";
    const nextView = isForecastView(requestedView) ? requestedView : "bracket";
    const allowedStages = FINAL_STAGE_OPTIONS[nextEvent].map((item) => item.id);
    const requestedStage = params.get("stage") as FinalEventStageFilter | null;
    const nextStage = requestedStage && allowedStages.includes(requestedStage) ? requestedStage : defaultStage(nextEvent);
    setEventSlug(nextEvent);
    setView(nextView);
    setStage(nextStage);

    let canceled = false;
    Promise.all([getFinalEvent("repechage"), getFinalEvent("nationals")])
      .then(([repechage, nationals]) => {
        if (!canceled) setEvents({ repechage, nationals });
      })
      .catch((reason) => {
        if (!canceled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      canceled = true;
    };
  }, []);

  const current = events?.[eventSlug] ?? null;
  const workspace = useMemo(
    () => current ? buildFinalsWorkspaceStage(current.event, stage) : null,
    [current, stage],
  );
  const selectedMatch = useMemo(() => {
    if (!current || !selectedMatchKey) return null;
    return current.event.matches.find((match) => `${current.event.slug}:${match.number}` === selectedMatchKey) ?? null;
  }, [current, selectedMatchKey]);

  const chooseEvent = (nextEvent: FinalEventSlug) => {
    const nextStage = defaultStage(nextEvent);
    setEventSlug(nextEvent);
    setStage(nextStage);
    setSelectedMatchKey(null);
    updateDeepLink(nextEvent, view, nextStage);
  };
  const chooseView = (nextView: ForecastView) => {
    setView(nextView);
    updateDeepLink(eventSlug, nextView, stage);
  };
  const chooseStage = (nextStage: FinalEventStageFilter) => {
    setStage(nextStage);
    setSelectedMatchKey(null);
    updateDeepLink(eventSlug, view, nextStage);
  };

  if (error) {
    return <div className="border border-rm-red/30 bg-rm-red/5 p-4 font-mono text-sm text-rm-red">实时预测中心加载失败：{error}</div>;
  }
  if (!current || !workspace) {
    return (
      <div className="flex min-h-[55vh] flex-col items-center justify-center animate-pulse">
        <div className="mb-4 h-8 w-8 animate-spin rounded-full border-4 border-rm-blue/30 border-t-rm-blue" />
        <span className="font-mono text-xs tracking-widest text-rm-blue">加载正式赛程...</span>
      </div>
    );
  }

  const visibleMatches = matchesForFinalStage(current.event, stage);

  return (
    <div className="min-h-screen">
      <div className="space-y-6">
        <header className="relative overflow-hidden border border-rm-metal-border bg-rm-metal-panel clip-chamfer-tr-bl">
          <div className="h-0.5 bg-gradient-to-r from-rm-blue via-rm-blue/20 to-rm-red" />
          <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_15%_0%,rgba(42,159,255,0.10),transparent_38%),radial-gradient(circle_at_85%_100%,rgba(232,48,42,0.08),transparent_40%)]" />
          <div className="relative flex flex-col gap-5 px-5 py-6 sm:px-8 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2 font-mono text-[9px] tracking-[0.3em] text-rm-blue">
                <span className="h-px w-7 bg-rm-blue" /> LIVE FORECAST CONSOLE
              </div>
              <h1 className="font-machine text-2xl font-black tracking-[0.08em] text-white sm:text-3xl">实时预测中心</h1>
              <p className="mt-3 max-w-3xl font-mono text-xs leading-relaxed text-rm-metal-textMuted">
                复活赛与全国赛共用一份正式赛程；在对阵图中追踪胜败流向，在赛局模式按日期查看每一场比赛。
              </p>
            </div>
            <div className="grid grid-cols-3 gap-px border border-rm-metal-border bg-rm-metal-border text-center font-mono">
              <div className="bg-black/70 px-4 py-2.5"><div className="text-lg font-bold text-white">{current.event.participantCount}</div><div className="text-[8px] tracking-wider text-rm-metal-textFaint">当前队伍</div></div>
              <div className="bg-black/70 px-4 py-2.5"><div className="text-lg font-bold text-rm-blue">{current.event.formalMatchCount}</div><div className="text-[8px] tracking-wider text-rm-metal-textFaint">正式赛局</div></div>
              <div className="bg-black/70 px-4 py-2.5"><div className="text-sm font-bold text-rm-status-scheduled">{formatFinalsDateRange(current.event.competitionRange.start, current.event.competitionRange.end)}</div><div className="text-[8px] tracking-wider text-rm-metal-textFaint">比赛区间</div></div>
            </div>
          </div>
        </header>

        <section className="border border-rm-status-scheduled/25 bg-rm-status-scheduled/[0.04] px-4 py-3">
          <div className="flex flex-col gap-2 font-mono text-[10px] leading-relaxed sm:flex-row sm:items-center sm:justify-between">
            <span className="text-rm-status-scheduled">抽签待公布 · 当前展示官方场序与来源槽位</span>
            <span className="text-rm-metal-textMuted">双方实际落位后才启用 Elo 胜率，不使用虚构对阵或默认 50/50</span>
          </div>
        </section>

        <section className="border border-rm-metal-border bg-rm-metal-panel/85">
          <div className="grid border-b border-rm-metal-border lg:grid-cols-[1fr_auto]">
            <div className="flex flex-wrap gap-2 p-3">
              {EVENT_OPTIONS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => chooseEvent(item.id)}
                  className={cn(
                    "flex items-center gap-2 border px-4 py-2 font-mono text-[11px] font-bold transition-colors",
                    eventSlug === item.id
                      ? "border-rm-blue bg-rm-blue/15 text-white shadow-[0_0_12px_rgba(42,159,255,0.12)]"
                      : "border-rm-metal-border bg-black/20 text-rm-metal-textMuted hover:text-white",
                  )}
                >
                  <span className="text-[8px] text-rm-blue/70">{item.code}</span>{item.label}
                </button>
              ))}
            </div>
            <div className="flex border-t border-rm-metal-border lg:border-l lg:border-t-0">
              {VIEW_OPTIONS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => chooseView(item.id)}
                  className={cn(
                    "min-w-28 flex-1 px-4 py-2 text-left transition-colors lg:flex-none",
                    view === item.id ? "bg-rm-blue/12 text-white" : "bg-black/20 text-rm-metal-textMuted hover:text-white",
                  )}
                >
                  <div className="font-machine text-xs font-bold tracking-wider">{item.label}</div>
                  <div className="mt-1 font-mono text-[8px] text-rm-metal-textFaint">{item.description}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 p-3">
            {FINAL_STAGE_OPTIONS[eventSlug].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => chooseStage(item.id)}
                className={cn(
                  "border px-3 py-1.5 font-mono text-[10px] transition-colors",
                  stage === item.id
                    ? "border-rm-result-winner/60 bg-rm-result-winner/10 text-rm-result-winner"
                    : "border-rm-metal-border bg-black/20 text-rm-metal-textMuted hover:border-rm-metal-textMuted hover:text-white",
                )}
              >
                {item.label}
              </button>
            ))}
            <span className="ml-auto self-center font-mono text-[9px] text-rm-metal-textFaint">当前视图 {visibleMatches.length} 场</span>
          </div>
        </section>

        {view === "bracket" ? (
          <section>
            <div className="flex flex-wrap items-center gap-4 border-x border-t border-rm-metal-border bg-black/55 px-4 py-2 font-mono text-[9px] text-rm-metal-textMuted">
              <span className="font-bold text-white">路线图例</span>
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-7 bg-rm-status-safe" />胜者路线</span>
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-7 bg-white/20" />败者路线</span>
              <span className="ml-auto text-rm-metal-textFaint">支持拖拽、缩放与全屏</span>
            </div>
            <div className="h-[68vh] min-h-[560px] max-h-[880px] border-x border-rm-metal-border">
              <WorkspaceStageView
                stage={workspace}
                mode="live"
                selectedTeamKey={null}
                highlightedTeamKey={null}
                selectedMatchLabel={selectedMatchKey}
                onTeamSelect={() => undefined}
                onMatchSelect={setSelectedMatchKey}
              />
            </div>
            <SelectedMatchStrip match={selectedMatch} />
          </section>
        ) : (
          <MatchesView
            event={current.event}
            stage={stage}
            selectedMatchKey={selectedMatchKey}
            onSelect={setSelectedMatchKey}
          />
        )}

        <footer className="flex flex-col gap-2 border-t border-rm-metal-border py-4 font-mono text-[9px] text-rm-metal-textFaint sm:flex-row sm:items-center sm:justify-between">
          <span>资料核对：{current.verifiedAt.slice(0, 10)} · Asia/Shanghai</span>
          <span>正式赛程状态：{current.event.statusLabel}</span>
        </footer>
      </div>
    </div>
  );
}
