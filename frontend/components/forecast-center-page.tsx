"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { CompetitionSelector, isRegionCompetition } from "@/components/competition-selector";
import { WorkspaceStageView } from "@/components/workspace-stage";
import { getFinalEvent } from "@/lib/api";
import { buildFinalsWorkspaceStage } from "@/lib/finals-canvas";
import { buildRegionHref } from "@/lib/region-config";
import {
  FINAL_STAGE_OPTIONS,
  buildFinalEventDays,
  formatFinalsDate,
  formatFinalsDateRange,
  getRepechageSwissMatchHint,
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

function MatchRoute({ match, eventSlug }: { match: FinalEventMatch; eventSlug?: FinalEventSlug }) {
  const flowHint = eventSlug === "repechage" ? getRepechageSwissMatchHint(match) : null;
  if (flowHint) {
    return <span className="text-rm-status-scheduled">{flowHint.title}</span>;
  }
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

function ScheduledMatchCard({ match, eventSlug, selected, onSelect }: {
  match: FinalEventMatch;
  eventSlug: FinalEventSlug;
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
        <MatchRoute match={match} eventSlug={eventSlug} />
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
                        eventSlug={event.slug}
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

function SelectedMatchPanel({ match, eventSlug, onClose }: { match: FinalEventMatch; eventSlug: FinalEventSlug; onClose: () => void }) {
  return (
    <aside className="glass-sheet absolute inset-x-0 bottom-0 z-30 max-h-[54%] overflow-y-auto border-t border-rm-metal-border md:relative md:inset-auto md:h-full md:max-h-none md:w-80 md:shrink-0 md:border-l md:border-t-0">
      <div className="flex items-center justify-between border-b border-rm-metal-border px-4 py-3">
        <div>
          <div className="font-machine text-sm font-bold tracking-widest text-white">第 {match.number} 场</div>
          <div className="mt-1 font-mono text-[9px] tracking-wider text-rm-metal-textFaint">MATCH INTELLIGENCE</div>
        </div>
        <button type="button" onClick={onClose} className="font-mono text-[10px] text-rm-metal-text hover:text-white">关闭</button>
      </div>
      <div className="space-y-4 p-4 font-mono text-[10px]">
        <div>
          <div className="text-rm-metal-textFaint">阶段</div>
          <div className="mt-1 font-bold text-white">{match.stage}</div>
        </div>
        <div className="grid grid-cols-2 gap-px border border-rm-metal-border bg-rm-metal-border">
          <div className="bg-black/70 p-3">
            <div className="text-[8px] text-rm-red/70">红方槽位</div>
            <div className="mt-1 break-words text-xs font-bold text-white">{match.redSlot}</div>
          </div>
          <div className="bg-black/70 p-3">
            <div className="text-[8px] text-rm-blue/70">蓝方槽位</div>
            <div className="mt-1 break-words text-xs font-bold text-white">{match.blueSlot}</div>
          </div>
        </div>
        <div className="border border-rm-metal-border bg-black/50 p-3 leading-relaxed">
          <div className="mb-2 text-rm-metal-textFaint">胜败流向</div>
          <MatchRoute match={match} eventSlug={eventSlug} />
        </div>
        <div className="flex items-center justify-between border-t border-rm-metal-border pt-3 text-rm-metal-textMuted">
          <span>{match.startsAt.slice(0, 10)} {match.startTime}</span>
          <span className="text-rm-status-scheduled">BO{match.bestOf}</span>
        </div>
      </div>
    </aside>
  );
}

export function ForecastCenterPage() {
  const router = useRouter();
  const [eventSlug, setEventSlug] = useState<FinalEventSlug>("repechage");
  const [view, setView] = useState<ForecastView>("bracket");
  const [stage, setStage] = useState<FinalEventStageFilter>(defaultStage("repechage"));
  const [events, setEvents] = useState<Record<FinalEventSlug, FinalEventResponse> | null>(null);
  const [selectedMatchKey, setSelectedMatchKey] = useState<string | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);
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
  const selectMatch = (matchKey: string) => {
    setSelectedMatchKey(matchKey);
  };

  if (error) {
    return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0a0a0f] p-6"><div className="border border-rm-red/30 bg-rm-red/5 p-4 font-mono text-sm text-rm-red">实时预测中心加载失败：{error}</div></div>;
  }
  if (!current || !workspace) {
    return (
      <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#0a0a0f] animate-pulse">
        <div className="mb-4 h-8 w-8 animate-spin rounded-full border-4 border-rm-blue/30 border-t-rm-blue" />
        <span className="font-mono text-xs tracking-widest text-rm-blue">加载正式赛程...</span>
      </div>
    );
  }

  const visibleMatches = matchesForFinalStage(current.event, stage);

  return (
    <div className="fixed inset-0 z-[100] flex min-h-0 flex-col bg-[#0a0a0f] bg-red-blue-split">
      <header className="glass-sheet z-30 flex select-none flex-col gap-2 px-3 py-2 md:px-4 md:py-2.5">
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
          <Link href="/" className="flex h-7 w-7 shrink-0 items-center justify-center border border-rm-blue/40 bg-rm-blue/15 text-rm-blue clip-chamfer transition-colors hover:bg-rm-blue hover:text-white" title="返回全景战略板">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          </Link>
          <CompetitionSelector
            value={eventSlug}
            onChange={(nextCompetition) => {
              if (isRegionCompetition(nextCompetition)) {
                router.push(buildRegionHref(nextCompetition, "playoff"));
                return;
              }
              chooseEvent(nextCompetition);
            }}
          />
          <div className="flex shrink-0 overflow-hidden border border-white/10 bg-rm-metal-dark/80">
            {VIEW_OPTIONS.map((item) => (
              <button key={item.id} type="button" onClick={() => chooseView(item.id)} title={item.description} className={cn("px-3 py-1.5 text-xs font-bold transition-colors", view === item.id ? "bg-rm-blue text-white" : "text-rm-metal-text hover:text-white")}>{item.label}</button>
            ))}
          </div>
          <div className="hidden items-center gap-2 font-mono text-[10px] text-rm-metal-textMuted lg:flex">
            <span>{current.event.participantCount} 队</span><span className="text-white/20">/</span>
            <span>{current.event.formalMatchCount} 场</span><span className="text-white/20">/</span>
            <span className="text-rm-status-scheduled">{formatFinalsDateRange(current.event.competitionRange.start, current.event.competitionRange.end)}</span>
          </div>
          <div className="flex-1" />
          <button type="button" onClick={() => setLegendOpen((open) => !open)} className={cn("shrink-0 border px-2.5 py-1.5 text-xs transition-colors", legendOpen ? "border-rm-blue bg-rm-blue/15 text-rm-blue" : "border-white/10 bg-rm-metal-dark/80 text-rm-metal-text hover:text-white")}>图例</button>
          <span className="hidden shrink-0 font-mono text-[10px] text-rm-metal-textFaint sm:inline">{current.event.statusLabel}</span>
        </div>
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
          {FINAL_STAGE_OPTIONS[eventSlug].map((item) => (
            <button key={item.id} type="button" onClick={() => chooseStage(item.id)} className={cn("flex-none px-3 py-1 text-[11px] font-bold uppercase tracking-widest transition-all clip-chamfer", stage === item.id ? "bg-rm-blue text-white shadow-[0_0_10px_rgba(42,159,255,0.4)]" : "border border-transparent text-rm-metal-text hover:border-white/15")}>{item.label}</button>
          ))}
          <span className="ml-auto hidden shrink-0 font-mono text-[9px] text-rm-metal-textFaint md:inline">当前 {visibleMatches.length} 场 · 核对 {current.verifiedAt.slice(0, 10)}</span>
        </div>
      </header>

      {legendOpen ? (
        <div className="absolute left-0 right-0 top-[74px] z-40 glass-sheet border-y border-rm-metal-border px-3 py-3 md:left-auto md:right-4 md:top-20 md:w-72 md:border">
          <div className="flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-widest text-rm-metal-text">路线图例</span><button type="button" onClick={() => setLegendOpen(false)} className="font-mono text-[10px] text-rm-metal-text hover:text-white">收起</button></div>
          <div className="mt-3 space-y-2 font-mono text-[10px] text-rm-metal-textMuted">
            <span className="flex items-center gap-2"><span className="h-0.5 w-8 bg-rm-status-safe" />胜者路线</span>
            <span className="flex items-center gap-2"><span className="w-8 border-t-2 border-dashed border-rm-metal-text/80" />败者下沉路线</span>
            <div className="border-t border-rm-metal-border pt-2 text-rm-metal-textFaint">画布支持拖拽、滚轮缩放、归位与全屏</div>
          </div>
        </div>
      ) : null}

      {view === "bracket" ? (
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <div className="relative min-w-0 flex-1">
            <div className="absolute inset-0">
              <WorkspaceStageView stage={workspace} mode="live" selectedTeamKey={null} highlightedTeamKey={null} selectedMatchLabel={selectedMatchKey} onTeamSelect={() => undefined} onMatchSelect={selectMatch} reserveRightRail={Boolean(selectedMatch)} />
            </div>
          </div>
          {selectedMatch ? <SelectedMatchPanel match={selectedMatch} eventSlug={eventSlug} onClose={() => setSelectedMatchKey(null)} /> : null}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-3 md:p-6">
          <div className="mx-auto max-w-screen-xl">
            <MatchesView event={current.event} stage={stage} selectedMatchKey={selectedMatchKey} onSelect={selectMatch} />
          </div>
        </div>
      )}
    </div>
  );
}
