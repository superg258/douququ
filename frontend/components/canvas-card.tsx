"use client";

import { useRef } from "react";

import type { CanvasCard, MatchCanvasCard, TeamCanvasCard } from "@/lib/types";
import { cn } from "@/lib/utils";

function toneClass(tone: CanvasCard["tone"]) {
  switch (tone) {
    case "amber":
    case "emerald":
      return "border-[#FFB74D]/30 shadow-[0_0_15px_rgba(255,183,77,0.1)]";
    case "steel":
      return "border-[#2F303D] bg-black/60 grayscale opacity-60";
    default:
      return "border-[#3A3B4C] hover:border-[#5A5C7A] bg-[#11111A]";
  }
}

export function predictScoreline(pGameRed: number, pSeriesRed: number, bestOf: number = 3) {
  const p = Math.max(0.0, Math.min(1.0, pGameRed));
  const q = 1.0 - p;
  if (bestOf === 3) {
    const probs = {
      "2:0": p * p,
      "2:1": 2.0 * p * p * q,
      "1:2": 2.0 * p * q * q,
      "0:2": q * q,
    };
    if (pSeriesRed >= 0.5) return (pSeriesRed < 0.72) ? { scoreline: "2:1", probability: probs["2:1"] } : { scoreline: "2:0", probability: probs["2:0"] };
    return (pSeriesRed > 0.28) ? { scoreline: "1:2", probability: probs["1:2"] } : { scoreline: "0:2", probability: probs["0:2"] };
  } else {
    // BO5
    const probs = {
      "3:0": p * p * p,
      "3:1": 3.0 * p * p * p * q,
      "3:2": 6.0 * p * p * p * q * q,
      "2:3": 6.0 * p * p * q * q * q,
      "1:3": 3.0 * p * q * q * q,
      "0:3": q * q * q,
    };
    if (pSeriesRed >= 0.5) {
      if (pSeriesRed < 0.65) return { scoreline: "3:2", probability: probs["3:2"] };
      if (pSeriesRed < 0.85) return { scoreline: "3:1", probability: probs["3:1"] };
      return { scoreline: "3:0", probability: probs["3:0"] };
    } else {
      if (pSeriesRed > 0.35) return { scoreline: "2:3", probability: probs["2:3"] };
      if (pSeriesRed > 0.15) return { scoreline: "1:3", probability: probs["1:3"] };
      return { scoreline: "0:3", probability: probs["0:3"] };
    }
  }
}


function TeamCanvasCardComponent({
  card,
  selectedTeamKey,
  highlightedTeamKey,
  onTeamSelect,
}: {
  card: TeamCanvasCard;
  selectedTeamKey: string | null;
  highlightedTeamKey: string | null;
  onTeamSelect: (teamKey: string) => void;
}) {
  const isSelected = selectedTeamKey === card.teamKey;
  const isHighlighted = highlightedTeamKey === card.teamKey;
  const isSafe = card.tone === "emerald" || card.tone === "amber";
  const pointerIntentRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  return (
    <button
      type="button"
      className={cn(
        "absolute touch-none flex transition-all text-left outline-none border",
        toneClass(card.tone),
        isSelected || isHighlighted ? "border-[#2196F3] ring-1 ring-[#2196F3]/50 z-20 shadow-[0_0_15px_rgba(33,150,243,0.4)] bg-[#112233]" : "z-10"
      )}
      style={{
        transform: `translate3d(${card.x}px, ${card.y}px, 0)`,
        width: card.width,
        height: card.height,
      }}
      title={[card.collegeName, card.teamName, card.statLine, ...(card.meta ?? [])].filter(Boolean).join(" / ")}
      onClick={() => {
        if (pointerIntentRef.current?.moved) {
          pointerIntentRef.current = null;
          return;
        }
        onTeamSelect(card.teamKey);
        pointerIntentRef.current = null;
      }}
      onPointerDown={(event) => {
        pointerIntentRef.current = { x: event.clientX, y: event.clientY, moved: false };
      }}
      onPointerMove={(event) => {
        if (!pointerIntentRef.current) return;
        const deltaX = Math.abs(event.clientX - pointerIntentRef.current.x);
        const deltaY = Math.abs(event.clientY - pointerIntentRef.current.y);
        if (deltaX > 6 || deltaY > 6) {
          pointerIntentRef.current = { ...pointerIntentRef.current, moved: true };
        }
      }}
      onPointerUp={() => {
        if (pointerIntentRef.current?.moved) {
          pointerIntentRef.current = null;
        }
      }}
      onPointerCancel={() => {
        pointerIntentRef.current = null;
      }}
    >
      {card.orderLabel ? (
        <span className="flex-none flex items-center justify-center w-12 h-full px-1 overflow-hidden border-r border-inherit bg-black/40 text-[16px] font-bold font-mono text-[#A0A0B0]">
          {card.orderLabel}
        </span>
      ) : null}
      
      <div className="flex-1 flex flex-col justify-center px-3 min-w-0 bg-[#12121A]/80 backdrop-blur-sm relative overflow-hidden">
        <div className={cn("font-bold text-[13px] leading-[1.25] line-clamp-2 min-h-[2.65rem] drop-shadow-sm", isSafe ? "text-[#FFFFFF]" : "text-[#E0E0E0]")}>
          {card.collegeName}
        </div>
        <div className={cn("text-[9px] font-mono line-clamp-1 mt-1", isSafe ? "text-[#FFD180]" : "text-[#A0A0B0]")}>
          {card.subtitle ?? card.teamName} {card.statLine ? ` / ${card.statLine}` : ""}
        </div>
        
        {card.meta?.length ? (
          <div className="flex gap-1 mt-1">
            {card.meta.slice(0, 2).map((item) => (
               <span key={item} className="text-[9px] bg-black/40 border border-white/10 px-1 py-0.5 text-[#808090] font-mono rounded-none">
                 {item}
               </span>
            ))}
          </div>
        ) : null}
      </div>
    </button>
  );
}

function scoreParts(scoreline: string) {
  const [red = "-", blue = "-"] = scoreline.split(":");
  return { red, blue };
}

function clampRate(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function formatRate(value: number) {
  return `${Math.round(clampRate(value) * 100)}%`;
}

function audienceSignal(prediction: MatchCanvasCard["match"]["miniProgramPrediction"]) {
  if (!prediction) {
    return {
      redRate: 0,
      blueRate: 0,
      statusLabel: "待接入",
      available: false,
      title: "王牌预言家观众投票待接入",
    };
  }

  if (prediction.status === "available") {
    return {
      redRate: prediction.redRate,
      blueRate: prediction.blueRate,
      statusLabel: `${prediction.totalCount}票`,
      available: true,
      title: `王牌预言家观众投票：红 ${formatRate(prediction.redRate)}，蓝 ${formatRate(prediction.blueRate)}`,
    };
  }

  const hasCache = typeof prediction.redRate === "number" && typeof prediction.blueRate === "number";
  return {
    redRate: hasCache ? (prediction.redRate ?? 0) : 0,
    blueRate: hasCache ? (prediction.blueRate ?? 0) : 0,
    statusLabel: hasCache ? "缓存" : "暂不可用",
    available: hasCache,
    title: prediction.reason ?? "王牌预言家暂不可用",
  };
}

function SignalMicroRow({
  label,
  redRate,
  blueRate,
  statusLabel,
  variant,
  available = true,
  title,
}: {
  label: string;
  redRate: number;
  blueRate: number;
  statusLabel: string;
  variant: "model" | "audience";
  available?: boolean;
  title?: string;
}) {
  const red = clampRate(redRate);
  const blue = clampRate(blueRate);
  const accentClass = variant === "model" ? "text-rm-blue" : "text-rm-status-warn";
  const trackClass = variant === "model" ? "border-rm-blue/25" : "border-rm-status-warn/25";

  return (
    <div
      className="grid h-[13px] grid-cols-[28px_34px_minmax(0,1fr)_34px_44px] items-center gap-1.5 font-mono"
      title={title}
    >
      <span className={cn("text-[8px] font-extrabold tracking-widest", available ? accentClass : "text-rm-metal-text/70")}>
        {label}
      </span>
      <span className={cn("text-left text-[8px] font-bold", available ? "text-rm-red/90" : "text-rm-metal-text/60")}>
        {available ? formatRate(red) : "--"}
      </span>
      <span className={cn("relative h-[5px] overflow-hidden border bg-black/55", trackClass)}>
        {available ? (
          <>
            <span
              className="absolute inset-y-0 left-0 bg-[linear-gradient(90deg,rgba(255,31,31,0.62),rgba(255,96,96,0.9))]"
              style={{ width: `${(red * 100).toFixed(1)}%` }}
            />
            <span
              className="absolute inset-y-0 right-0 bg-[linear-gradient(270deg,rgba(0,163,255,0.62),rgba(88,191,255,0.9))]"
              style={{ width: `${(blue * 100).toFixed(1)}%` }}
            />
            <span
              className="absolute inset-y-[-2px] w-px bg-white/75 shadow-[0_0_6px_rgba(255,255,255,0.55)]"
              style={{ left: `${(red * 100).toFixed(1)}%` }}
            />
          </>
        ) : (
          <span className="absolute inset-x-1 top-1/2 border-t border-dashed border-white/15" />
        )}
      </span>
      <span className={cn("text-right text-[8px] font-bold", available ? "text-rm-blue/90" : "text-rm-metal-text/60")}>
        {available ? formatRate(blue) : "--"}
      </span>
      <span className={cn("truncate text-right text-[8px] font-bold", available ? accentClass : "text-rm-metal-text/65")}>
        {statusLabel}
      </span>
    </div>
  );
}

function MatchTeamLine({
  side,
  score,
  resultResolved,
  selectedTeamKey,
  highlightedTeamKey,
  onTeamSelect,
}: {
  side: MatchCanvasCard["redSide"] | MatchCanvasCard["blueSide"];
  score: string;
  resultResolved: boolean;
  selectedTeamKey: string | null;
  highlightedTeamKey: string | null;
  onTeamSelect: (teamKey: string) => void;
}) {
  const isRed = side.side === "red";
  const isWinner = resultResolved && side.isWinner;
  const isLoser = resultResolved && !side.isWinner;
  const isFocused = selectedTeamKey === side.teamKey || highlightedTeamKey === side.teamKey;
  const pointerIntentRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  return (
    <div
      role="button"
      tabIndex={-1}
      className={cn(
        "relative grid min-h-[42px] grid-cols-[4px_minmax(0,1fr)_44px] items-stretch overflow-hidden border-b border-white/10 bg-[#070a10]/95 text-left outline-none transition-colors last:border-b-0 hover:bg-white/[0.045]",
        isWinner && "bg-[linear-gradient(90deg,rgba(255,213,74,0.12),rgba(255,213,74,0.03)_58%,rgba(255,255,255,0.025))]",
        isLoser && "bg-black/38",
        isFocused && "ring-1 ring-white/30"
      )}
      onClick={onTeamSelect ? (e) => {
        if (pointerIntentRef.current?.moved) {
          pointerIntentRef.current = null;
          return;
        }
        e.stopPropagation();
        onTeamSelect(side.teamKey);
        pointerIntentRef.current = null;
      } : undefined}
      onPointerDown={(event) => {
        pointerIntentRef.current = { x: event.clientX, y: event.clientY, moved: false };
      }}
      onPointerMove={(event) => {
        if (!pointerIntentRef.current) return;
        const deltaX = Math.abs(event.clientX - pointerIntentRef.current.x);
        const deltaY = Math.abs(event.clientY - pointerIntentRef.current.y);
        if (deltaX > 6 || deltaY > 6) {
          pointerIntentRef.current = { ...pointerIntentRef.current, moved: true };
        }
      }}
      onPointerUp={() => {
        if (pointerIntentRef.current?.moved) {
          pointerIntentRef.current = null;
        }
      }}
      onPointerCancel={() => {
        pointerIntentRef.current = null;
      }}
    >
      <div className={cn("h-full", isRed ? "bg-rm-red shadow-[0_0_8px_rgba(255,31,31,0.28)]" : "bg-rm-blue shadow-[0_0_8px_rgba(0,163,255,0.28)]")} />

      <div className="min-w-0 px-2.5 py-1">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "shrink-0 border px-1 py-0.5 text-[7px] font-bold leading-none tracking-widest",
              isRed ? "border-rm-red/45 text-rm-red/90 bg-rm-red/10" : "border-rm-blue/45 text-rm-blue/90 bg-rm-blue/10"
            )}
          >
            {isRed ? "红方" : "蓝方"}
          </span>
          {isWinner ? (
            <span className="shrink-0 border border-rm-result-winner/70 bg-rm-result-winner/20 px-1 py-0.5 text-[8px] font-extrabold leading-none text-rm-result-winner">
              胜
            </span>
          ) : null}
        </div>
        <div
          title={`${side.collegeName} / ${side.teamName}`}
          className={cn(
            "mt-0.5 text-[13px] font-extrabold leading-[1.16] tracking-normal line-clamp-2",
            isWinner ? "text-rm-result-winner [text-shadow:0_0_8px_rgba(255,213,74,0.35)]" : isLoser ? "text-rm-result-loser" : "text-white",
            isRed && !isWinner && !isLoser && "text-[#FF6A6A]",
            !isRed && !isWinner && !isLoser && "text-[#58BFFF]"
          )}
        >
          {side.collegeName}
        </div>
        <div className="mt-0.5 line-clamp-1 text-[9px] font-mono text-rm-metal-text/80">
          {side.teamName}
        </div>
      </div>

      <div className={cn(
        "flex items-center justify-center border-l border-white/10 bg-[#04060a]/80 font-machine text-[19px] leading-none",
        isWinner
          ? "border-l-rm-result-winner/55 bg-[linear-gradient(180deg,rgba(255,213,74,0.22),rgba(255,213,74,0.075))] text-rm-result-winner shadow-[inset_0_0_10px_rgba(255,213,74,0.10),0_0_10px_rgba(255,213,74,0.10)]"
          : isLoser
            ? "text-rm-result-loser"
            : "text-white"
      )}>
        {score || "-"}
      </div>
    </div>
  );
}

function MatchCanvasCardComponent({
  card,
  mode,
  selectedTeamKey,
  highlightedTeamKey,
  onTeamSelect,
  onMatchSelect,
  selectedMatchLabel,
}: {
  card: MatchCanvasCard;
  mode?: "sim" | "live";
  selectedTeamKey: string | null;
  highlightedTeamKey: string | null;
  onTeamSelect: (teamKey: string) => void;
  onMatchSelect: (matchLabel: string) => void;
  selectedMatchLabel: string | null;
}) {
  const isSelected = selectedMatchLabel === card.match.matchLabel;
  const pointerIntentRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const row = card.match;
  const expectedRed = row.pSeriesRed ?? card.redSide.probability;
  const isSimulationMode = mode === "sim";
  const hasRealResult = Boolean(row.isRealResult);
  const showsResolvedScoreline = isSimulationMode || hasRealResult;
  const [redGamesText, blueGamesText] = (row.scoreline || "0:0").split(":");
  const redGames = Number(redGamesText);
  const blueGames = Number(blueGamesText);
  const predictedScore = predictScoreline(row.pGameRed ?? expectedRed, expectedRed, row.bestOf || 3);
  const displayScore = showsResolvedScoreline ? scoreParts(row.scoreline) : scoreParts(predictedScore.scoreline);
  const scoreLabel = showsResolvedScoreline ? "比分" : "预测";
  const audience = audienceSignal(row.miniProgramPrediction);

  const containerBorder = (() => {
    if (isSimulationMode) return "border border-rm-blue/75 bg-rm-blue/10 shadow-[0_0_14px_rgba(0,163,255,0.12)]";
    if (row.isRealResult) {
      const predWinnerSame = (predictedScore.scoreline[0] > predictedScore.scoreline[2]) === (redGames > blueGames);
      const predScoreSame = predictedScore.scoreline === row.scoreline;
      if (!predWinnerSame) {
        return "border border-rm-status-upset/80 bg-rm-status-upset/10 shadow-[0_0_14px_rgba(255,31,31,0.18)]";
      } else if (!predScoreSame) {
        return "border border-rm-status-deviation/80 bg-rm-status-deviation/10 shadow-[0_0_14px_rgba(168,85,247,0.16)]";
      }
      return "border border-rm-status-safe/75 bg-rm-status-safe/10 shadow-[0_0_14px_rgba(0,255,157,0.14)]";
    }
    if (row.isConfirmedMatchup) return "border border-rm-status-scheduled/75 bg-rm-status-scheduled/10 shadow-[0_0_14px_rgba(250,204,21,0.16)]";
    return "border border-rm-blue/65 bg-rm-blue/10 shadow-[0_0_12px_rgba(0,163,255,0.10)]";
  })();

  const statusConfig = (() => {
    if (isSimulationMode) return { label: "模拟战果", className: "border-rm-blue/70 text-rm-blue bg-rm-blue/10" };
    if (row.isRealResult) {
      const predWinnerSame = (predictedScore.scoreline[0] > predictedScore.scoreline[2]) === (redGames > blueGames);
      const predScoreSame = predictedScore.scoreline === row.scoreline;
      if (!predWinnerSame) return { label: "爆冷", className: "border-rm-status-upset/80 text-rm-status-upset bg-rm-status-upset/10" };
      if (!predScoreSame) return { label: "比分偏离", className: "border-rm-status-deviation/80 text-rm-status-deviation bg-rm-status-deviation/10" };
      return { label: "已完赛", className: "border-rm-status-safe/75 text-rm-status-safe bg-rm-status-safe/10" };
    }
    if (row.isConfirmedMatchup) return { label: "已排期", className: "border-rm-status-scheduled/75 text-rm-status-scheduled bg-rm-status-scheduled/10" };
    return { label: "预测", className: "border-rm-blue/70 text-rm-blue bg-rm-blue/10" };
  })();

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "absolute touch-none group flex flex-col bg-[linear-gradient(145deg,rgba(7,10,16,0.98),rgba(5,7,12,0.96)_52%,rgba(10,15,24,0.98))] outline-none transition-all overflow-hidden clip-chamfer cursor-pointer",
        "hover:border-white/35 hover:shadow-[0_14px_28px_rgba(0,0,0,0.34),0_0_18px_rgba(255,255,255,0.06)]",
        isSelected ? "ring-2 ring-rm-result-winner/80 z-30" : "z-10",
        containerBorder
      )}
      style={{
        transform: `translate3d(${card.x}px, ${card.y}px, 0)`,
        width: card.width,
        height: card.height,
      }}
      onClick={() => {
        if (pointerIntentRef.current?.moved) {
          pointerIntentRef.current = null;
          return;
        }
        onMatchSelect(row.matchLabel);
        pointerIntentRef.current = null;
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onMatchSelect(row.matchLabel);
        }
      }}
      onPointerDown={(event) => {
        pointerIntentRef.current = { x: event.clientX, y: event.clientY, moved: false };
      }}
      onPointerMove={(event) => {
        if (!pointerIntentRef.current) return;
        const deltaX = Math.abs(event.clientX - pointerIntentRef.current.x);
        const deltaY = Math.abs(event.clientY - pointerIntentRef.current.y);
        if (deltaX > 6 || deltaY > 6) {
          pointerIntentRef.current = { ...pointerIntentRef.current, moved: true };
        }
      }}
      onPointerUp={() => {
        if (pointerIntentRef.current?.moved) {
          pointerIntentRef.current = null;
        }
      }}
      onPointerCancel={() => {
        pointerIntentRef.current = null;
      }}
    >
      <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_12%_0%,rgba(255,255,255,0.08),transparent_34%),linear-gradient(90deg,rgba(255,255,255,0.04),transparent_32%,rgba(255,255,255,0.025))]" />
      {card.orderLabel ? (
        <div className="absolute inset-y-0 left-0 z-20 flex w-8 flex-col items-center justify-center border-r border-white/10 bg-black/70">
          <span className="font-machine text-[15px] leading-none text-white/90">{card.orderLabel}</span>
          <span className="mt-1 text-[7px] font-bold tracking-widest text-rm-metal-text/85">{scoreLabel}</span>
        </div>
      ) : null}

      <div className={cn("relative z-10 flex h-full min-w-0 flex-col", card.orderLabel ? "pl-8" : "")}>
        <div className="flex h-7 shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-white/[0.035] px-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className={cn("shrink-0 border px-1.5 py-0.5 text-[8px] font-extrabold leading-none tracking-widest", statusConfig.className)}>
              {statusConfig.label}
            </span>
            <span className="truncate text-[10px] font-machine tracking-widest text-white/90">{card.displayLabel}</span>
          </div>
          <div className="shrink-0 border border-white/10 bg-black/30 px-1.5 py-0.5 text-[9px] font-mono text-rm-metal-text">
            {card.metaLabel}
          </div>
        </div>

        <div className="grid flex-1 grid-rows-2 overflow-hidden">
          <MatchTeamLine
            side={card.redSide}
            score={displayScore.red}
            resultResolved={showsResolvedScoreline}
            selectedTeamKey={selectedTeamKey}
            highlightedTeamKey={highlightedTeamKey}
            onTeamSelect={onTeamSelect}
          />
          <MatchTeamLine
            side={card.blueSide}
            score={displayScore.blue}
            resultResolved={showsResolvedScoreline}
            selectedTeamKey={selectedTeamKey}
            highlightedTeamKey={highlightedTeamKey}
            onTeamSelect={onTeamSelect}
          />
        </div>

        <div className="shrink-0 border-t border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(0,0,0,0.22))] px-2 py-1">
          <SignalMicroRow
            label="TS2"
            redRate={row.pSeriesRed}
            blueRate={row.pSeriesBlue}
            statusLabel={row.pSeriesRed >= row.pSeriesBlue ? "红方占优" : "蓝方占优"}
            variant="model"
            title={`TS2 预测胜率：红 ${formatRate(row.pSeriesRed)}，蓝 ${formatRate(row.pSeriesBlue)}`}
          />
          <SignalMicroRow
            label="王牌"
            redRate={audience.redRate}
            blueRate={audience.blueRate}
            statusLabel={audience.statusLabel}
            variant="audience"
            available={audience.available}
            title={audience.title}
          />
        </div>
      </div>
    </div>
  );
}
export function CanvasCardView({
  card,
  mode,
  selectedTeamKey,
  highlightedTeamKey,

  onTeamSelect,
  onMatchSelect,
  selectedMatchLabel,


}: {
  card: CanvasCard;
  mode?: "sim" | "live";
  selectedTeamKey: string | null;
  highlightedTeamKey: string | null;

  onTeamSelect: (teamKey: string) => void;
  onMatchSelect: (matchLabel: string) => void;
  selectedMatchLabel: string | null;

}) {
  if (card.kind === "match") {
    return (
      <MatchCanvasCardComponent
        card={card}
        mode={mode}
        selectedTeamKey={selectedTeamKey}
        highlightedTeamKey={highlightedTeamKey}
        selectedMatchLabel={selectedMatchLabel}
        onTeamSelect={onTeamSelect}
        onMatchSelect={onMatchSelect}
      />
    );
  }

  return (
    <TeamCanvasCardComponent
      card={card}
      selectedTeamKey={selectedTeamKey}
      highlightedTeamKey={highlightedTeamKey}
      onTeamSelect={onTeamSelect}
    />
  );
}
