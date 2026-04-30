"use client";

import { useRef } from "react";

import type { CanvasCard, MatchCanvasCard, TeamCanvasCard } from "@/lib/types";
import { cn } from "@/lib/utils";

function toneClass(tone: CanvasCard["tone"]) {
  switch (tone) {
    case "amber":
    case "emerald":
      return "border-rm-result-winner bg-black/80";
    case "steel":
      return "border-white/10 bg-black/80 opacity-40 grayscale";
    default:
      return "border-white/10 hover:border-white/30 bg-black/80";
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
        isSelected || isHighlighted ? "border-rm-blue ring-1 ring-rm-blue z-20 bg-black" : "z-10"
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
        <span className="flex-none flex items-center justify-center w-12 h-full px-1 overflow-hidden border-r border-white/10 bg-black/40 text-[16px] font-bold font-mono text-[#A0A0B0]">
          {card.orderLabel}
        </span>
      ) : null}
      
      <div className="flex-1 flex flex-col justify-center px-3 min-w-0 bg-transparent relative overflow-hidden">
        <div className={cn("font-bold text-[16px] leading-[1.25] line-clamp-2 min-h-[2.65rem]", isSafe ? "text-[#FFFFFF]" : "text-[#E0E0E0]")}>
          {card.collegeName}
        </div>
        <div className={cn("text-[10px] font-mono line-clamp-1 mt-1", isSafe ? "text-rm-result-winner" : "text-[#A0A0B0]")}>
          {card.subtitle ?? card.teamName} {card.statLine ? ` / ${card.statLine}` : ""}
        </div>
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
  // Label stays neutral (gray), never red or blue
  const labelClass = variant === "model" ? "text-rm-metal-text" : "text-rm-metal-text";
  // Status color reflects who's winning: red-dominant → red, blue-dominant → blue
  const statusColor = red >= blue ? "text-rm-red" : "text-rm-blue";
  const trackBorder = variant === "model" ? "border-white/15" : "border-white/10";
  const dividerColor = variant === "model" ? "#FFFFFF" : "#FFE0A0";
  const dividerGlow = variant === "model"
    ? "0 0 6px rgba(255,255,255,0.8), 0 0 12px rgba(255,255,255,0.3)"
    : "0 0 6px rgba(255,224,160,0.8), 0 0 12px rgba(255,224,160,0.3)";

  return (
    <div
      className="grid h-[18px] grid-cols-[28px_34px_minmax(0,1fr)_34px_44px] items-center gap-1.5 font-mono"
      title={title}
    >
      <span className={cn("text-[8px] font-extrabold tracking-widest", available ? labelClass : "text-rm-metal-text/50")}>
        {label}
      </span>
      <span className={cn("text-left text-[8px] font-bold", available ? "text-rm-red" : "text-rm-metal-text/60")}>
        {available ? formatRate(red) : "--"}
      </span>
      <span className={cn("relative h-[10px] overflow-hidden bg-black/80", trackBorder)} style={{ borderRadius: "1px" }}>
        {available ? (
          <>
            <span
              className="absolute inset-y-0 left-0"
              style={{
                width: `${(red * 100).toFixed(1)}%`,
                background: "linear-gradient(90deg, rgba(232,48,42,0.9), rgba(232,48,42,0.7))",
                boxShadow: "0 0 6px rgba(232,48,42,0.5), inset 0 1px 0 rgba(255,255,255,0.12)",
              }}
            />
            <span
              className="absolute inset-y-0 right-0"
              style={{
                width: `${(blue * 100).toFixed(1)}%`,
                background: "linear-gradient(270deg, rgba(42,159,255,0.9), rgba(42,159,255,0.7))",
                boxShadow: "0 0 6px rgba(42,159,255,0.5), inset 0 1px 0 rgba(255,255,255,0.12)",
              }}
            />
            <span
              className="absolute inset-y-[0px]"
              style={{
                left: `${(red * 100).toFixed(1)}%`,
                width: "2px",
                background: dividerColor,
                boxShadow: dividerGlow,
              }}
            />
            <span
              style={{
                position: "absolute",
                left: `calc(${(red * 100).toFixed(1)}% - 2.5px)`,
                top: "50%",
                transform: "translateY(-50%)",
                width: "5px",
                height: "5px",
                borderRadius: "50%",
                background: dividerColor,
                boxShadow: dividerGlow,
              }}
            />
          </>
        ) : (
          <span className="absolute inset-x-1 top-1/2 border-t border-dashed border-white/15" />
        )}
      </span>
      <span className={cn("text-right text-[8px] font-bold", available ? "text-rm-blue" : "text-rm-metal-text/60")}>
        {available ? formatRate(blue) : "--"}
      </span>
      <span className={cn("truncate text-right text-[8px] font-bold", available ? statusColor : "text-rm-metal-text/65")}>
        {statusLabel}
      </span>
    </div>
  );
}

function MatchTeamLine({
  side,
  score,
  resultResolved,
  isPrediction,
  selectedTeamKey,
  highlightedTeamKey,
  onTeamSelect,
}: {
  side: MatchCanvasCard["redSide"] | MatchCanvasCard["blueSide"];
  score: string;
  resultResolved: boolean;
  isPrediction: boolean;
  selectedTeamKey: string | null;
  highlightedTeamKey: string | null;
  onTeamSelect: (teamKey: string) => void;
}) {
  const isRed = side.side === "red";
  const isWinner = resultResolved && side.isWinner;
  const isLoser = resultResolved && !side.isWinner;
  const isFocused = selectedTeamKey === side.teamKey || highlightedTeamKey === side.teamKey;
  const pointerIntentRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const sideBg = isWinner
    ? (isRed
        ? "bg-[linear-gradient(90deg,rgba(232,48,42,0.22),rgba(232,48,42,0.08),transparent)]"
        : "bg-[linear-gradient(90deg,rgba(42,159,255,0.22),rgba(42,159,255,0.08),transparent)]")
    : isLoser
    ? (isRed
        ? "bg-[linear-gradient(90deg,rgba(232,48,42,0.06),transparent)]"
        : "bg-[linear-gradient(90deg,rgba(42,159,255,0.06),transparent)]")
    : (isRed
        ? "bg-[linear-gradient(90deg,rgba(232,48,42,0.10),transparent_60%)]"
        : "bg-[linear-gradient(90deg,rgba(42,159,255,0.10),transparent_60%)]");

  return (
    <div
      role="button"
      tabIndex={-1}
      className={cn(
        "relative grid min-h-[52px] grid-cols-[6px_minmax(0,1fr)_56px] items-stretch overflow-hidden text-left outline-none transition-colors",
        sideBg,
        !isWinner && !isLoser && "hover:bg-white/[0.06]",
        isWinner && "hover:brightness-110",
        isLoser && "hover:bg-white/[0.02]",
        isFocused && "ring-1 ring-white/30 z-10"
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
      {/* Left: 6px color bar — bright for winner, dim for loser */}
      <div
        className={cn(
          "h-full",
          isRed ? "bg-rm-red" : "bg-rm-blue",
          isWinner && "shadow-[0_0_10px_rgba(255,255,255,0.5)] brightness-125",
          isLoser && "opacity-25 grayscale-[50%]"
        )}
      />

      {/* Center: 校名 | 队名 */}
      <div className="min-w-0 px-3 flex items-center gap-2">
        <span
          title={side.collegeName}
          className={cn(
            "truncate text-[15px] font-extrabold leading-[1.2] tracking-normal",
            isWinner ? "text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.3)]"
            : isLoser ? "text-rm-result-loser"
            : "text-[#F0F0F0]"
          )}
        >
          {side.collegeName}
        </span>
        <span className={cn(
          "shrink-0 text-[11px] font-bold",
          isWinner ? "text-white/70"
          : isLoser ? "text-rm-result-loser/40"
          : "text-[#A0A0B0]"
        )}>|</span>
        <span className={cn(
          "truncate text-[11px] font-bold font-mono tracking-wide",
          isWinner ? "text-white/80"
          : isLoser ? "text-rm-result-loser/50"
          : "text-[#A0A0B0]"
        )}>
          {side.teamName}
        </span>
      </div>

      {/* Right: score — 满色 radiant */}
      <div className={cn(
        "flex flex-col items-center justify-center gap-0.5 border-l border-white/[0.08]",
        isWinner
          ? (isRed
              ? "bg-[linear-gradient(180deg,rgba(255,90,80,0.95),rgba(232,48,42,0.88),rgba(200,35,28,0.92))] shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_0_12px_rgba(232,48,42,0.35)] text-white"
              : "bg-[linear-gradient(180deg,rgba(80,185,255,0.95),rgba(42,159,255,0.88),rgba(30,130,220,0.92))] shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_0_12px_rgba(42,159,255,0.35)] text-white")
          : isLoser
          ? (isRed
              ? "bg-[linear-gradient(180deg,rgba(232,48,42,0.22),rgba(232,48,42,0.14),rgba(232,48,42,0.18))] text-rm-result-loser"
              : "bg-[linear-gradient(180deg,rgba(42,159,255,0.22),rgba(42,159,255,0.14),rgba(42,159,255,0.18))] text-rm-result-loser")
          : (isRed
              ? "bg-[linear-gradient(180deg,rgba(232,48,42,0.55),rgba(232,48,42,0.40),rgba(200,35,28,0.50))] shadow-[0_0_8px_rgba(232,48,42,0.25)] text-white"
              : "bg-[linear-gradient(180deg,rgba(42,159,255,0.55),rgba(42,159,255,0.40),rgba(30,130,220,0.50))] shadow-[0_0_8px_rgba(42,159,255,0.25)] text-white"),
        isPrediction && "border-dashed"
      )}>
        <span className={cn(
          "font-machine text-[20px] leading-none",
          isWinner && "font-bold"
        )}>
          {score || "-"}
        </span>
        {isWinner ? (
          <span className="text-[9px] font-extrabold leading-none text-[#D0D0D0]">胜</span>
        ) : isPrediction ? (
          <span className="text-[8px] font-semibold leading-none text-[#A0A0A0]">预测</span>
        ) : null}
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
  const resolvedDisplayScore = scoreParts(row.scoreline);
  const predictedDisplayScore = scoreParts(predictedScore.scoreline);
  const audience = audienceSignal(row.miniProgramPrediction);

  // Prediction mode = live mode without any result or confirmed matchup
  const isPrediction = !isSimulationMode && !hasRealResult && !row.isConfirmedMatchup;

  const containerBorder = (() => {
    if (isPrediction) return "border border-dashed border-rm-blue/25 bg-black/80";
    if (row.isRealResult) {
      const predWinnerSame = (predictedScore.scoreline[0] > predictedScore.scoreline[2]) === (redGames > blueGames);
      const predScoreSame = predictedScore.scoreline === row.scoreline;
      if (!predWinnerSame) return "border-2 border-rm-status-upset/70 bg-black/80";
      if (!predScoreSame) return "border border-rm-status-deviation/70 bg-black/80";
      return "border-2 border-rm-status-safe/60 bg-black/80";
    }
    if (row.isConfirmedMatchup) return "border border-rm-status-scheduled/80 bg-black/80";
    // Simulation mode (has resolved scoreline)
    if (isSimulationMode) return "border border-rm-blue/40 bg-black/80";
    return "border border-white/15 bg-black/80";
  })();

  const statusConfig = (() => {
    if (isPrediction) return { label: "预测", className: "border-rm-blue/60 text-rm-blue bg-rm-blue/10" };
    if (row.isRealResult) {
      const predWinnerSame = (predictedScore.scoreline[0] > predictedScore.scoreline[2]) === (redGames > blueGames);
      const predScoreSame = predictedScore.scoreline === row.scoreline;
      if (!predWinnerSame) return { label: "爆冷", className: "border-rm-status-upset/80 text-rm-status-upset bg-rm-status-upset/10" };
      if (!predScoreSame) return { label: "比分偏离", className: "border-rm-status-deviation/80 text-rm-status-deviation bg-rm-status-deviation/10" };
      return { label: "已完赛", className: "border-rm-status-safe/75 text-rm-status-safe bg-rm-status-safe/10" };
    }
    if (row.isConfirmedMatchup) return { label: "已排期", className: "border-rm-status-scheduled/75 text-rm-status-scheduled bg-rm-status-scheduled/10" };
    if (isSimulationMode) return { label: "模拟战果", className: "border-rm-blue/50 text-rm-blue bg-rm-blue/10" };
    return { label: "预测", className: "border-rm-blue/70 text-rm-blue bg-rm-blue/10" };
  })();

  // Show simulated/real scoreline when available, predicted score only in pure prediction mode
  const displayScore = showsResolvedScoreline ? resolvedDisplayScore : predictedDisplayScore;
  const scoreLabel = showsResolvedScoreline ? (isSimulationMode ? "模拟比分" : "比分") : "预测比分";

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "absolute touch-none group flex flex-col outline-none transition-all clip-chamfer cursor-pointer bg-black/80",
        "hover:border-white/60",
        isSelected ? "ring-1 ring-rm-result-winner z-30" : "z-10",
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
      {/* Top bar: status badge + match label + BO info */}
      <div className="flex h-[28px] shrink-0 items-center justify-between gap-2 border-b border-white/[0.06] bg-white/[0.025] px-2.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={cn("shrink-0 border px-1.5 py-0.5 text-[9px] font-extrabold leading-none tracking-widest", statusConfig.className)}>
            {statusConfig.label}
          </span>
          <span className="truncate text-[11px] font-machine tracking-widest text-white/90">{card.displayLabel}</span>
        </div>
        <div className="shrink-0 flex items-center gap-1.5 text-[9px] font-mono text-rm-metal-text">
          {isPrediction ? (
            <span className="border border-dashed border-rm-blue/20 bg-rm-blue/5 px-1.5 py-0.5 text-rm-blue">{scoreLabel}</span>
          ) : (
            <span className="border border-white/10 bg-black/30 px-1.5 py-0.5">{scoreLabel}</span>
          )}
          <span className="border border-white/10 bg-black/30 px-1.5 py-0.5">{card.metaLabel}</span>
        </div>
      </div>

      {/* Red team row */}
      <MatchTeamLine
        side={card.redSide}
        score={displayScore.red}
        resultResolved={showsResolvedScoreline}
        isPrediction={isPrediction}
        selectedTeamKey={selectedTeamKey}
        highlightedTeamKey={highlightedTeamKey}
        onTeamSelect={onTeamSelect}
      />

      {/* Red-Blue gradient divider line */}
      <div
        className="h-[2px] shrink-0"
        style={{
          background: "linear-gradient(90deg, rgba(232,48,42,0.6), rgba(42,159,255,0.6))",
          boxShadow: "0 0 6px rgba(100,80,200,0.2)",
        }}
      />

      {/* Blue team row */}
      <MatchTeamLine
        side={card.blueSide}
        score={displayScore.blue}
        resultResolved={showsResolvedScoreline}
        isPrediction={isPrediction}
        selectedTeamKey={selectedTeamKey}
        highlightedTeamKey={highlightedTeamKey}
        onTeamSelect={onTeamSelect}
      />

      {/* Prediction signal bars: TS2 + 王牌 */}
      <div className="shrink-0 border-t border-white/[0.06] px-2.5 py-1.5 flex flex-col gap-1.5">
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
