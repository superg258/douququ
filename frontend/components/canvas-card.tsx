"use client";

import { useRef } from "react";

import type { CanvasCard, MatchCanvasCard, MatchRow, TeamCanvasCard } from "@/lib/types";
import { cn } from "@/lib/utils";
import { getPredictedAdvantageLabel } from "@/lib/prediction-display";
import { formatBeijingMonthDayTime } from "@/lib/time-format";

function toneClass(tone: CanvasCard["tone"]) {
  switch (tone) {
    case "amber":
    case "emerald":
      return "border-rm-result-winner bg-black/80";
    case "steel":
      return "border-white/10 bg-black/80 opacity-40 grayscale";
    default:
      return "border-white/10 hover:brightness-110 bg-black/80";
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

export function formatMatchCardScheduleTime(plannedStartAt?: string | null) {
  return formatBeijingMonthDayTime(plannedStartAt);
}

export const PREDICTION_MATCH_VISUAL_CLASSES = {
  container: "border border-dashed border-rm-blue/8 bg-black/60",
  statusBadge: "border-rm-blue/20 text-rm-blue/40 bg-rm-blue/[0.03]",
  sideAccent: "opacity-[0.12]",
  redTeamRow: "bg-[linear-gradient(90deg,rgba(232,48,42,0.05),transparent_60%)]",
  blueTeamRow: "bg-[linear-gradient(90deg,rgba(42,159,255,0.05),transparent_60%)]",
  redScorePanel: "bg-[linear-gradient(180deg,rgba(232,48,42,0.12),rgba(232,48,42,0.07),rgba(200,35,28,0.09))] text-white/30",
  blueScorePanel: "bg-[linear-gradient(180deg,rgba(42,159,255,0.12),rgba(42,159,255,0.07),rgba(30,130,220,0.09))] text-white/30",
  dividerBackground: "linear-gradient(90deg, rgba(232,48,42,0.12), rgba(42,159,255,0.12))",
};

export function deriveMatchCardState(row: MatchRow, mode?: "sim" | "live") {
  const isSimulationMode = mode === "sim";
  const hasRealResult = Boolean(row.isRealResult);
  const hasPredictedTeamRefs = Boolean(row.redTeam.teamKey && row.blueTeam.teamKey);
  const isOfficialPlaceholder = !isSimulationMode && !hasRealResult && Boolean(row.officialMatchId) && row.isConfirmedMatchup === false && !hasPredictedTeamRefs;
  const isOfficialScheduled = !isSimulationMode && !hasRealResult && Boolean(row.officialMatchId) && row.isConfirmedMatchup !== false;
  const isPrediction = !isSimulationMode && !hasRealResult && !isOfficialScheduled;
  const showsResolvedScoreline = isSimulationMode || hasRealResult;
  const usesActualResultVisuals = isSimulationMode || hasRealResult;
  const scheduleTimeLabel = formatMatchCardScheduleTime(row.plannedStartAt);
  const statusLabel = (() => {
    if (hasRealResult) return "已完赛";
    if (isOfficialPlaceholder) return "队伍待定";
    if (isPrediction) return "预测";
    if (isOfficialScheduled) return "已排期";
    if (isSimulationMode) return "模拟战果";
    return "预测";
  })();

  return {
    isSimulationMode,
    hasRealResult,
    isOfficialScheduled,
    isOfficialPlaceholder,
    isPrediction,
    showsResolvedScoreline,
    usesActualResultVisuals,
    scheduleTimeLabel,
    statusLabel,
  };
}

export function deriveTeamCardState(card: TeamCanvasCard, mode?: "sim" | "live") {
  const isSimulated = mode === "sim" ? false : (card.isSimulated ?? card.variant === "summary");
  const isSafe = card.tone === "emerald" || card.tone === "amber";
  const isSummary = card.variant === "summary";
  const certaintyLabel = isSimulated ? "预期" : "实际";
  const outcomeLabel = isSafe ? "晋级" : "淘汰";
  const hasDashedFrame = isSummary && isSimulated;
  const visualTier = isSummary && !isSafe
    ? (isSimulated ? "predicted-eliminated" : "actual-eliminated")
    : isSummary && isSafe
      ? (isSimulated ? "predicted-safe" : "actual-safe")
      : "standard";

  return {
    isSimulated,
    isSafe,
    isSummary,
    certaintyLabel,
    outcomeLabel,
    summaryLabel: `${certaintyLabel}${outcomeLabel}`,
    hasDashedFrame,
    visualTier,
  };
}


function TeamCanvasCardComponent({
  card,
  mode,
  selectedTeamKey,
  highlightedTeamKey,
  hasActiveHighlight,
  onTeamSelect,
}: {
  card: TeamCanvasCard;
  mode?: "sim" | "live";
  selectedTeamKey: string | null;
  highlightedTeamKey: string | null;
  hasActiveHighlight: boolean;
  onTeamSelect: (teamKey: string) => void;
}) {
  const hasTeamKey = Boolean(card.teamKey);
  const isSelected = hasTeamKey && selectedTeamKey === card.teamKey;
  const isHighlighted = hasTeamKey && highlightedTeamKey === card.teamKey;
  const dimmed = hasActiveHighlight && !isSelected && !isHighlighted;
  const teamState = deriveTeamCardState(card, mode);
  const { isSimulated, isSafe, isSummary, summaryLabel, visualTier } = teamState;
  const shellClass = (() => {
    if (visualTier === "actual-eliminated") {
      return "border-rm-status-upset/55 bg-black/85 opacity-90 grayscale-[18%] shadow-[inset_3px_0_0_rgba(239,68,68,0.45),0_0_10px_rgba(239,68,68,0.08)]";
    }
    if (visualTier === "predicted-eliminated") {
      return "border-dashed border-rm-status-upset/30 bg-black/65 opacity-70 grayscale-[55%]";
    }
    if (visualTier === "predicted-safe") {
      return "border-dashed border-rm-status-safe/40 bg-black/75";
    }
    if (isSimulated) {
      return isSafe ? "border-rm-status-safe/30 bg-black/75" : "border-white/10 bg-black/70";
    }
    return toneClass(card.tone);
  })();
  const badgeClass = (() => {
    if (visualTier === "actual-eliminated") {
      return "border border-rm-status-upset/70 bg-rm-status-upset/25 text-rm-status-upset shadow-[0_0_8px_rgba(239,68,68,0.24)]";
    }
    if (visualTier === "predicted-eliminated") {
      return "border border-dashed border-rm-status-upset/35 bg-rm-status-upset/10 text-rm-status-upset/65";
    }
    if (visualTier === "predicted-safe") {
      return "border border-dashed border-rm-status-safe/40 bg-rm-status-safe/12 text-rm-status-safe/70";
    }
    if (isSimulated) {
      return isSafe ? "bg-rm-status-safe/20 text-rm-status-safe/60" : "bg-rm-status-upset/15 text-rm-status-upset/50";
    }
    return isSafe
      ? "bg-rm-status-safe/30 text-rm-status-safe shadow-[0_0_6px_rgba(0,232,120,0.2)]"
      : "bg-rm-status-upset/25 text-rm-status-upset shadow-[0_0_6px_rgba(239,68,68,0.2)]";
  })();
  const titleClass = (() => {
    if (visualTier === "actual-eliminated") return "text-white/85";
    if (visualTier === "predicted-eliminated") return "text-[#A0A0B0]/65";
    return isSimulated ? (isSafe ? "text-white/70" : "text-[#A0A0B0]/70") : (isSafe ? "text-[#FFFFFF]" : "text-[#E0E0E0]");
  })();
  const detailClass = (() => {
    if (visualTier === "actual-eliminated") return "text-rm-status-upset/75";
    if (visualTier === "predicted-eliminated") return "text-[#808080]/55";
    return isSimulated
      ? (isSafe ? "text-rm-status-safe/50" : "text-[#808080]/50")
      : (isSafe ? "text-rm-result-winner" : "text-[#A0A0B0]");
  })();

  const pointerIntentRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  return (
    <button
      type="button"
      className={cn(
        "absolute touch-none flex transition-all text-left outline-none border",
        shellClass,
        isSelected
          ? "border-rm-blue ring-[3px] ring-rm-blue shadow-[0_0_12px_rgba(42,159,255,0.5),0_0_24px_rgba(42,159,255,0.2)] z-20 bg-black"
          : isHighlighted
            ? "z-20"
            : dimmed
              ? "opacity-[0.50] grayscale-[30%] z-10"
              : "z-10"
      )}
      style={{
        transform: `translate3d(${card.x}px, ${card.y}px, 0)`,
        width: card.width,
        height: card.height,
      }}
      title={[card.collegeName, card.teamName, card.statLine, ...(card.meta ?? [])].filter(Boolean).join(" / ")}
      onClick={hasTeamKey ? () => {
        if (pointerIntentRef.current?.moved) {
          pointerIntentRef.current = null;
          return;
        }
        onTeamSelect(card.teamKey);
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
      {isSummary ? (
        <span className={cn(
          "flex-none flex items-center justify-center px-2 h-5 text-[8px] font-extrabold uppercase tracking-widest leading-none",
          badgeClass
        )}>
          {summaryLabel}
        </span>
      ) : null}

      {card.orderLabel ? (
        <span className="flex-none flex items-center justify-center w-12 h-full px-1 overflow-hidden border-r border-white/10 bg-black/40 text-[16px] font-bold font-mono text-[#A0A0B0]">
          {card.orderLabel}
        </span>
      ) : null}

      <div className="flex-1 flex flex-col justify-center px-3 min-w-0 bg-transparent relative overflow-hidden">
        <div className={cn(
          "font-bold text-[16px] leading-[1.25] line-clamp-2 min-h-[2.65rem]",
          titleClass
        )}>
          {card.collegeName}
        </div>
        <div className={cn(
          "text-[10px] font-mono line-clamp-1 mt-1",
          detailClass
        )}>
          {card.subtitle ?? card.teamName} {card.statLine ? ` / ${card.statLine}` : ""}
        </div>
      </div>

      {isHighlighted && !isSelected ? (
        <span className="absolute -top-1.5 -right-1.5 w-[15px] h-[15px] flex items-center justify-center bg-rm-result-winner text-black text-[11px] font-extrabold leading-none animate-dot-pulse z-30 clip-chamfer shadow-[0_0_10px_rgba(240,151,44,0.7)]">
          ◆
        </span>
      ) : null}
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
      statusLabel: "暂未开放",
      available: false,
      title: "王牌预言家投票通道暂未开放",
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
    statusLabel: hasCache ? "历史记录" : "暂未开放",
    available: hasCache,
    title: prediction.reason ?? "王牌预言家暂未开放",
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
  const statusColor = statusLabel.includes("红方")
    ? "text-rm-red"
    : statusLabel.includes("蓝方")
      ? "text-rm-blue"
      : red >= blue
        ? "text-rm-red"
        : "text-rm-blue";
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
  isSimulated,
  isScheduled,
  selectedTeamKey,
  highlightedTeamKey,
  onTeamSelect,
}: {
  side: MatchCanvasCard["redSide"] | MatchCanvasCard["blueSide"];
  score: string;
  resultResolved: boolean;
  isPrediction: boolean;
  isSimulated: boolean;
  isScheduled: boolean;
  selectedTeamKey: string | null;
  highlightedTeamKey: string | null;
  onTeamSelect: (teamKey: string) => void;
}) {
  const isRed = side.side === "red";
  const isRealWinner = resultResolved && !isSimulated && side.isWinner;
  const isSimWinner = resultResolved && isSimulated && side.isWinner;
  const isRealLoser = resultResolved && !isSimulated && !side.isWinner;
  const isSimLoser = resultResolved && isSimulated && !side.isWinner;
  const isWinner = resultResolved && side.isWinner;
  const isLoser = resultResolved && !side.isWinner;
  const hasTeamKey = Boolean(side.teamKey);
  const isFocused = hasTeamKey && (selectedTeamKey === side.teamKey || highlightedTeamKey === side.teamKey);
  const pointerIntentRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const sideBg = isRealWinner
    ? (isRed
        ? "bg-[linear-gradient(90deg,rgba(232,48,42,0.22),rgba(232,48,42,0.08),transparent)]"
        : "bg-[linear-gradient(90deg,rgba(42,159,255,0.22),rgba(42,159,255,0.08),transparent)]")
    : isSimWinner
    ? (isRed
        ? "bg-[linear-gradient(90deg,rgba(232,48,42,0.12),rgba(232,48,42,0.04),transparent)]"
        : "bg-[linear-gradient(90deg,rgba(42,159,255,0.12),rgba(42,159,255,0.04),transparent)]")
    : isRealLoser
    ? (isRed
        ? "bg-[linear-gradient(90deg,rgba(232,48,42,0.06),transparent)]"
        : "bg-[linear-gradient(90deg,rgba(42,159,255,0.06),transparent)]")
    : isSimLoser
    ? (isRed
        ? "bg-[linear-gradient(90deg,rgba(232,48,42,0.03),transparent)]"
        : "bg-[linear-gradient(90deg,rgba(42,159,255,0.03),transparent)]")
    : isPrediction
    ? (isRed
        ? PREDICTION_MATCH_VISUAL_CLASSES.redTeamRow
        : PREDICTION_MATCH_VISUAL_CLASSES.blueTeamRow)
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
        isRealWinner && "hover:brightness-110",
        isSimWinner && "hover:brightness-105",
        isRealLoser && "hover:bg-white/[0.02]",
        isSimLoser && "hover:bg-white/[0.01]",
        isFocused && "z-20"
      )}
      onClick={hasTeamKey ? (e) => {
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
      {/* Left: 6px color bar — dim by tier */}
      <div
        className={cn(
          "h-full relative",
          isRed ? "bg-rm-red" : "bg-rm-blue",
          isRealWinner && "shadow-[0_0_10px_rgba(255,255,255,0.5)] brightness-125",
          isSimWinner && "opacity-50",
          isRealLoser && "opacity-25 grayscale-[50%]",
          isSimLoser && "opacity-15 grayscale-[65%]",
          !resultResolved && !isSimulated && (isScheduled ? "opacity-35" : PREDICTION_MATCH_VISUAL_CLASSES.sideAccent),
          !resultResolved && !isSimulated && !isScheduled && "border-dashed"
        )}
      >
        {isFocused ? (
          <span className="absolute -left-[3px] top-1/2 -translate-y-1/2 w-[8px] h-[8px] rounded-full bg-rm-result-winner animate-dot-pulse shadow-[0_0_8px_rgba(240,151,44,0.8)]" />
        ) : null}
      </div>

      {/* Center: 校名 | 队名 */}
      <div className="min-w-0 px-3 flex items-center gap-2">
        <span
          title={side.collegeName}
          className={cn(
            "truncate text-[15px] font-extrabold leading-[1.2] tracking-normal",
            isRealWinner ? "text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.3)]"
            : isSimWinner ? "text-white/70"
            : isLoser ? "text-rm-result-loser"
            : "text-[#F0F0F0]"
          )}
        >
          {side.collegeName}
        </span>
        <span className={cn(
          "shrink-0 text-[11px] font-bold",
          isRealWinner ? "text-white/70"
          : isSimWinner ? "text-white/40"
          : isLoser ? "text-rm-result-loser/40"
          : "text-[#A0A0B0]"
        )}>|</span>
        <span className={cn(
          "truncate text-[11px] font-bold font-mono tracking-wide",
          isRealWinner ? "text-white/80"
          : isSimWinner ? "text-white/50"
          : isLoser ? "text-rm-result-loser/50"
          : "text-[#A0A0B0]"
        )}>
          {side.teamName}
        </span>
      </div>

      {/* Right: score — real=满色 radiant, simulated=dim */}
      <div className={cn(
        "flex flex-col items-center justify-center gap-0.5 border-l border-white/[0.08]",
        isRealWinner
          ? (isRed
              ? "bg-[linear-gradient(180deg,rgba(255,90,80,0.95),rgba(232,48,42,0.88),rgba(200,35,28,0.92))] shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_0_12px_rgba(232,48,42,0.35)] text-white"
              : "bg-[linear-gradient(180deg,rgba(80,185,255,0.95),rgba(42,159,255,0.88),rgba(30,130,220,0.92))] shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_0_12px_rgba(42,159,255,0.35)] text-white")
          : isSimWinner
          ? (isRed
              ? "bg-[linear-gradient(180deg,rgba(232,48,42,0.35),rgba(232,48,42,0.22),rgba(200,35,28,0.25))] text-white/70"
              : "bg-[linear-gradient(180deg,rgba(42,159,255,0.35),rgba(42,159,255,0.22),rgba(30,130,220,0.25))] text-white/70")
          : isRealLoser
          ? (isRed
              ? "bg-[linear-gradient(180deg,rgba(232,48,42,0.22),rgba(232,48,42,0.14),rgba(232,48,42,0.18))] text-rm-result-loser"
              : "bg-[linear-gradient(180deg,rgba(42,159,255,0.22),rgba(42,159,255,0.14),rgba(42,159,255,0.18))] text-rm-result-loser")
          : isSimLoser
          ? (isRed
              ? "bg-[linear-gradient(180deg,rgba(232,48,42,0.10),rgba(232,48,42,0.06),rgba(232,48,42,0.08))] text-rm-result-loser/50"
              : "bg-[linear-gradient(180deg,rgba(42,159,255,0.10),rgba(42,159,255,0.06),rgba(42,159,255,0.08))] text-rm-result-loser/50")
          : isScheduled
          ? (isRed
              ? "bg-[linear-gradient(180deg,rgba(232,48,42,0.35),rgba(232,48,42,0.25),rgba(200,35,28,0.30))] text-white/60"
              : "bg-[linear-gradient(180deg,rgba(42,159,255,0.35),rgba(42,159,255,0.25),rgba(30,130,220,0.30))] text-white/60")
          : (isRed
              ? PREDICTION_MATCH_VISUAL_CLASSES.redScorePanel
              : PREDICTION_MATCH_VISUAL_CLASSES.blueScorePanel),
        isPrediction && "border-dashed"
      )}>
        <span className={cn(
          "font-machine text-[20px] leading-none",
          isRealWinner && "font-bold"
        )}>
          {score || "-"}
        </span>
        {isRealWinner ? (
          <span className="text-[9px] font-extrabold leading-none text-[#D0D0D0]">胜</span>
        ) : isSimWinner ? (
          <span className="text-[8px] font-semibold leading-none text-white/50">预测胜</span>
        ) : !resultResolved ? (
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
  hasActiveHighlight,
  onTeamSelect,
  onMatchSelect,
  selectedMatchLabel,
}: {
  card: MatchCanvasCard;
  mode?: "sim" | "live";
  selectedTeamKey: string | null;
  highlightedTeamKey: string | null;
  hasActiveHighlight: boolean;
  onTeamSelect: (teamKey: string) => void;
  onMatchSelect: (matchLabel: string) => void;
  selectedMatchLabel: string | null;
}) {
  const isSelected = selectedMatchLabel === card.match.matchLabel;
  const matchDimmed = hasActiveHighlight && !isSelected &&
    highlightedTeamKey !== card.redSide.teamKey &&
    highlightedTeamKey !== card.blueSide.teamKey;
  const pointerIntentRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const row = card.match;
  const expectedRed = row.pSeriesRed ?? card.redSide.probability;
  const cardState = deriveMatchCardState(row, mode);
  const { isSimulationMode, isOfficialScheduled, isOfficialPlaceholder, isPrediction, showsResolvedScoreline, usesActualResultVisuals, scheduleTimeLabel } = cardState;
  const rendersDimmedPredictionOutcome = showsResolvedScoreline && !usesActualResultVisuals;
  const [redGamesText, blueGamesText] = (row.scoreline || "0:0").split(":");
  const redGames = Number(redGamesText);
  const blueGames = Number(blueGamesText);
  const predictedScore = predictScoreline(row.pGameRed ?? expectedRed, expectedRed, row.bestOf || 3);
  const resolvedDisplayScore = scoreParts(row.scoreline);
  const predictedDisplayScore = scoreParts(predictedScore.scoreline);
  const audience = audienceSignal(row.miniProgramPrediction);

  /* ─── 三档亮度仅用于真实赛程（live），模拟保持不变 ─── */
  const containerBorder = (() => {
    // Simulation mode — unchanged
    if (isSimulationMode) return "border border-rm-blue/40 bg-black/80";
    // Tier 1: real result — brightest
    if (row.isRealResult) {
      const predWinnerSame = (predictedScore.scoreline[0] > predictedScore.scoreline[2]) === (redGames > blueGames);
      const predScoreSame = predictedScore.scoreline === row.scoreline;
      if (!predWinnerSame) return "border-2 border-rm-status-upset bg-[#0D0D10] shadow-[0_0_16px_rgba(239,68,68,0.2)]";
      if (!predScoreSame) return "border-2 border-rm-status-deviation bg-[#0D0D10] shadow-[0_0_16px_rgba(168,85,247,0.2)]";
      return "border-2 border-rm-status-safe bg-[#0D0D10] shadow-[0_0_12px_rgba(0,232,120,0.15)]";
    }
    // Tier 2: scheduled — medium
    if (isOfficialPlaceholder) return "border border-dashed border-rm-status-scheduled/45 bg-black/55";
    if (isOfficialScheduled) return "border border-rm-status-scheduled/50 bg-black/65";
    // Tier 3: pure prediction — dimmest
    if (isPrediction) return PREDICTION_MATCH_VISUAL_CLASSES.container;
    return "border border-white/10 bg-black/80";
  })();

  const statusConfig = (() => {
    // Simulation — unchanged
    if (isSimulationMode) return { label: "模拟战果", className: "border-rm-blue/50 text-rm-blue bg-rm-blue/10" };
    // Tier 1: real result — prominent glow
    if (row.isRealResult) {
      const predWinnerSame = (predictedScore.scoreline[0] > predictedScore.scoreline[2]) === (redGames > blueGames);
      const predScoreSame = predictedScore.scoreline === row.scoreline;
      if (!predWinnerSame) return { label: "爆冷", className: "border-rm-status-upset text-rm-status-upset bg-rm-status-upset/20 shadow-[0_0_10px_rgba(239,68,68,0.35)]" };
      if (!predScoreSame) return { label: "比分偏离", className: "border-rm-status-deviation text-rm-status-deviation bg-rm-status-deviation/20 shadow-[0_0_10px_rgba(168,85,247,0.35)]" };
      return { label: "已完赛", className: "border-rm-status-safe text-rm-status-safe bg-rm-status-safe/20 shadow-[0_0_10px_rgba(0,232,120,0.3)]" };
    }
    // Tier 2: scheduled — muted
    if (isOfficialPlaceholder) return { label: "队伍待定", className: "border-dashed border-rm-status-scheduled/55 text-rm-status-scheduled/75 bg-rm-status-scheduled/8" };
    if (isOfficialScheduled) return { label: "已排期", className: "border-rm-status-scheduled/60 text-rm-status-scheduled/80 bg-rm-status-scheduled/10" };
    // Tier 3: prediction — faint
    if (isPrediction) return { label: "预测", className: PREDICTION_MATCH_VISUAL_CLASSES.statusBadge };
    return { label: "预测", className: PREDICTION_MATCH_VISUAL_CLASSES.statusBadge };
  })();

  // Show simulated/real scoreline when available, predicted score only in pure prediction mode
  const displayScore = isOfficialPlaceholder
    ? { red: "-", blue: "-" }
    : showsResolvedScoreline
      ? resolvedDisplayScore
      : predictedDisplayScore;

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "absolute touch-none group flex flex-col outline-none transition-all clip-chamfer cursor-pointer",
        "hover:brightness-110",
        isSelected ? "ring-1 ring-rm-result-winner z-30" : "z-10",
        containerBorder,
        matchDimmed && "opacity-[0.50] grayscale-[30%]"
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
        {scheduleTimeLabel && (
          <div className="shrink-0 flex items-center gap-1.5 text-[9px] font-mono text-rm-metal-text">
            <span className="border border-rm-status-scheduled/25 bg-rm-status-scheduled/8 px-1.5 py-0.5 text-rm-status-scheduled tabular-nums">
              {scheduleTimeLabel}
            </span>
          </div>
        )}
      </div>

      {/* Red team row */}
      <MatchTeamLine
        side={card.redSide}
        score={displayScore.red}
        resultResolved={showsResolvedScoreline}
        isPrediction={isPrediction}
        isSimulated={rendersDimmedPredictionOutcome}
        isScheduled={isOfficialScheduled}
        selectedTeamKey={selectedTeamKey}
        highlightedTeamKey={highlightedTeamKey}
        onTeamSelect={onTeamSelect}
      />

      {/* Red-Blue gradient divider — dim by tier */}
      <div
        className="h-[2px] shrink-0"
        style={{
          background: usesActualResultVisuals
            ? "linear-gradient(90deg, rgba(232,48,42,0.6), rgba(42,159,255,0.6))"
            : isOfficialScheduled
            ? "linear-gradient(90deg, rgba(232,48,42,0.35), rgba(42,159,255,0.35))"
            : PREDICTION_MATCH_VISUAL_CLASSES.dividerBackground,
          boxShadow: usesActualResultVisuals ? "0 0 6px rgba(100,80,200,0.2)" : "none",
        }}
      />

      {/* Blue team row */}
      <MatchTeamLine
        side={card.blueSide}
        score={displayScore.blue}
        resultResolved={showsResolvedScoreline}
        isPrediction={isPrediction}
        isSimulated={rendersDimmedPredictionOutcome}
        isScheduled={isOfficialScheduled}
        selectedTeamKey={selectedTeamKey}
        highlightedTeamKey={highlightedTeamKey}
        onTeamSelect={onTeamSelect}
      />

      {/* Prediction signal bars: TS2 + 王牌 */}
      <div className="shrink-0 border-t border-white/[0.06] px-2.5 py-1.5 flex flex-col gap-1.5">
        <SignalMicroRow
          label="Elo"
          redRate={row.pSeriesRed}
          blueRate={row.pSeriesBlue}
          statusLabel={isOfficialPlaceholder ? "未确认" : getPredictedAdvantageLabel({
            pSeriesRed: row.pSeriesRed,
            pSeriesBlue: row.pSeriesBlue,
            predictedScoreline: predictedScore.scoreline,
          })}
          variant="model"
          available={!isOfficialPlaceholder}
          title={isOfficialPlaceholder ? "官方排期已接入，真实对阵尚未确认" : `战力预测胜率：红 ${formatRate(row.pSeriesRed)}，蓝 ${formatRate(row.pSeriesBlue)}`}
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
  hasActiveHighlight,
  onTeamSelect,
  onMatchSelect,
  selectedMatchLabel,
}: {
  card: CanvasCard;
  mode?: "sim" | "live";
  selectedTeamKey: string | null;
  highlightedTeamKey: string | null;
  hasActiveHighlight: boolean;
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
        hasActiveHighlight={hasActiveHighlight}
        selectedMatchLabel={selectedMatchLabel}
        onTeamSelect={onTeamSelect}
        onMatchSelect={onMatchSelect}
      />
    );
  }

  return (
    <TeamCanvasCardComponent
      card={card}
      mode={mode}
      selectedTeamKey={selectedTeamKey}
      highlightedTeamKey={highlightedTeamKey}
      hasActiveHighlight={hasActiveHighlight}
      onTeamSelect={onTeamSelect}
    />
  );
}
