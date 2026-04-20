"use client";

import type { CanvasCard, MatchCanvasCard, TeamCanvasCard } from "@/lib/types";
import { cn } from "@/lib/utils";

function pct(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

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
      onClick={() => onTeamSelect(card.teamKey)}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {card.orderLabel ? (
        <span className="flex-none flex items-center justify-center w-12 h-full px-1 overflow-hidden border-r border-inherit bg-black/40 text-[16px] font-bold font-mono text-[#A0A0B0]">
          {card.orderLabel}
        </span>
      ) : null}
      
      <div className="flex-1 flex flex-col justify-center px-3 min-w-0 bg-[#12121A]/80 backdrop-blur-sm relative overflow-hidden">
        <div className={cn("font-bold text-[14px] truncate drop-shadow-sm", isSafe ? "text-[#FFFFFF]" : "text-[#E0E0E0]")}>
          {card.collegeName}
        </div>
        <div className={cn("text-[10px] font-mono truncate mt-0.5", isSafe ? "text-[#FFD180]" : "text-[#A0A0B0]")}>
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

function MatchRowLine({
  side,
  showProbability,
  selectedTeamKey,
  highlightedTeamKey,
  onTeamSelect,
}: {
  side: MatchCanvasCard["redSide"] | MatchCanvasCard["blueSide"];
  showProbability: boolean;
  selectedTeamKey: string | null;
  highlightedTeamKey: string | null;
  onTeamSelect: (teamKey: string) => void;
}) {
  const isRed = side.side === "red";
  const isWinner = side.isWinner;
  const isLoser = !isWinner;

  const activeBg = isRed ? "bg-[#4A1111]" : "bg-[#11264A]";
  const hoverBg = isRed ? "hover:bg-[#2A0505]" : "hover:bg-[#05112A]";
  const scoreBoxColor = isRed ? "bg-[#E62E2E]/25 text-[#FFF0D4] border-[#FF3333]/50" : "bg-[#1E88E5]/25 text-[#DCEFFF] border-[#3399FF]/50";
  const probColor = isRed ? "text-[#FF4D4D]" : "text-[#3399FF]";
  const barBg = isRed ? "bg-[#E62E2E]/30" : "bg-[#1E88E5]/30";

  return (
    <button
      type="button"
      className={cn(
        "relative w-full flex items-stretch text-left group/row transition-all outline-none flex-1 border-b last:border-b-0 border-[#2f303d] overflow-hidden",
        isWinner ? activeBg : isLoser ? "bg-black/60 grayscale opacity-60" : `bg-transparent ${hoverBg}`
      )}
      onClick={onTeamSelect ? (e) => { e.stopPropagation(); onTeamSelect(side.teamKey); } : undefined}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {showProbability && (
        <div 
          className={cn("absolute top-0 bottom-0 left-0 transition-all duration-700 ease-out z-0", barBg)} 
          style={{ width: pct(side.probability) }}
        />
      )}

      <div className={cn("relative z-10 flex flex-col items-center justify-center w-10 shrink-0 border-r", scoreBoxColor)}>
        <span className="font-machine text-lg leading-none drop-shadow-sm">{side.score || "-"}</span>
      </div>

      <div className="relative z-10 flex flex-col justify-center flex-1 px-3 min-w-0">
        <span className={cn("font-bold text-[13px] leading-tight truncate drop-shadow-sm", isWinner ? "text-white" : "text-[#D0D0E0]")}>
          {side.collegeName}
        </span>
        <span className="text-[10px] text-[#A0A0B0] font-mono truncate mt-0.5">
          {side.teamName}
        </span>
      </div>

      {showProbability && (
        <div className="relative z-10 shrink-0 flex items-center pr-3">
          <span className={cn("font-mono text-[10px] font-bold drop-shadow-sm", probColor)}>
            {pct(side.probability)} {isWinner ? "WIN" : ""}
          </span>
        </div>
      )}
    </button>
  );
}

function MatchCanvasCardComponent({
  card,
  mode,
  showProbability,
  selectedTeamKey,
  highlightedTeamKey,
  onTeamSelect,
  onMatchSelect,
  selectedMatchLabel,
}: {
  card: MatchCanvasCard;
  mode?: "sim" | "live";
  showProbability: boolean;
  selectedTeamKey: string | null;
  highlightedTeamKey: string | null;
  onTeamSelect: (teamKey: string) => void;
  onMatchSelect: (matchLabel: string) => void;
  selectedMatchLabel: string | null;
}) {
  const isSelected = selectedMatchLabel === card.match.matchLabel;
  const headless = card.variant === "compact" || card.variant === "playoff";
  const row = card.match;
  const expectedRed = row.pSeriesRed ?? card.redSide.probability;
  const expectedBlue = row.pSeriesBlue ?? card.blueSide.probability;
  const isSimulationMode = mode === "sim";
  const hasRealResult = Boolean(row.isRealResult);
  const showsResolvedScoreline = isSimulationMode || hasRealResult;
  
  const [redGamesText, blueGamesText] = (row.scoreline || "0:0").split(":");
  const redGames = Number(redGamesText);
  const blueGames = Number(blueGamesText);
  const actualWinnerName = redGames > blueGames ? row.redTeam.collegeName : row.blueTeam.collegeName;
  const predictedScore = predictScoreline(row.pGameRed ?? expectedRed, expectedRed, row.bestOf || 3);

  const containerBorder = (() => {
    if (isSimulationMode) return "border-[2px] border-rm-blue shadow-[0_0_20px_rgba(0,163,255,0.2)] bg-rm-blue/10";
    if (row.isRealResult) {
      const predWinnerSame = (predictedScore.scoreline[0] > predictedScore.scoreline[2]) === (redGames > blueGames);
      const predScoreSame = predictedScore.scoreline === row.scoreline;
      if (!predWinnerSame) {
        return "border-[2px] border-[#ef4444] shadow-[0_0_20px_rgba(239,68,68,0.3)] bg-[#ef4444]/10";
      } else if (!predScoreSame) {
        return "border-[2px] border-[#a855f7] shadow-[0_0_20px_rgba(168,85,247,0.3)] bg-[#a855f7]/10";
      }
      return "border-[2px] border-rm-status-safe shadow-[0_0_20px_rgba(0,255,157,0.3)] bg-rm-status-safe/10";
    }
    if (row.isConfirmedMatchup) return "border-[2px] border-[#facc15] shadow-[0_0_20px_rgba(250,204,21,0.3)] bg-[#facc15]/10";
    return "border-[2px] border-rm-blue shadow-[0_0_20px_rgba(0,163,255,0.2)] bg-rm-blue/10";
  })();

  const statusConfig = (() => {
    if (isSimulationMode) return { label: "推演战果", className: "border-rm-blue font-extrabold text-rm-blue bg-rm-blue/20 shadow-[0_0_12px_rgba(0,163,255,0.6)]" };
    if (row.isRealResult) {
      const predWinnerSame = (predictedScore.scoreline[0] > predictedScore.scoreline[2]) === (redGames > blueGames);
      const predScoreSame = predictedScore.scoreline === row.scoreline;
      if (!predWinnerSame) return { label: "爆冷", className: "border-[#ef4444] font-extrabold text-[#ef4444] bg-[#ef4444]/20 shadow-[0_0_12px_rgba(239,68,68,0.6)]" };
      if (!predScoreSame) return { label: "比分偏离", className: "border-[#a855f7] font-extrabold text-[#a855f7] bg-[#a855f7]/20 shadow-[0_0_12px_rgba(168,85,247,0.6)]" };
      return { label: "已完赛", className: "border-rm-status-safe font-extrabold text-rm-status-safe bg-rm-status-safe/20 shadow-[0_0_12px_rgba(0,255,157,0.6)]" };
    }
    if (row.isConfirmedMatchup) return { label: "已排期", className: "border-[#facc15] font-extrabold text-[#facc15] bg-[#facc15]/20 shadow-[0_0_12px_rgba(250,204,21,0.6)]" };
    return { label: "预测", className: "border-rm-blue font-extrabold text-rm-blue bg-rm-blue/20 shadow-[0_0_12px_rgba(0,163,255,0.6)]" };
  })();

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "absolute touch-none group flex flex-col bg-[#05070c] outline-none transition-all overflow-hidden clip-chamfer cursor-pointer",
        isSelected ? "ring-2 ring-white/80 z-30" : "hover:border-rm-blue/50 z-10",
        containerBorder
      )}
      style={{
        transform: `translate3d(${card.x}px, ${card.y}px, 0)`,
        width: card.width,
        height: card.height,
      }}
      onClick={() => onMatchSelect(row.matchLabel)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onMatchSelect(row.matchLabel);
        }
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {hasRealResult && (
        <div className="absolute inset-0 bg-gradient-to-r from-rm-status-safe/5 via-transparent to-transparent pointer-events-none" />
      )}
      {card.orderLabel ? (
        <span className="absolute top-0 bottom-0 left-0 flex items-center justify-center w-6 px-1 border-r border-rm-metal-border bg-black/40 text-[10px] font-bold font-mono text-[#A0A0B0] z-20">
          {card.orderLabel}
        </span>
      ) : null}

      <div className={cn("flex flex-col flex-1 p-2 relative z-10 w-full h-full", card.orderLabel ? "pl-8" : "")}>
        {/* Header */}
        {!headless && (
          <div className="flex items-center justify-between border-b border-rm-metal-border/50 pb-1 mb-1.5 shrink-0">
            <div className="flex items-center gap-2">
              <span className={cn(
                "text-[8px] font-mono font-bold uppercase tracking-widest px-1.5 py-0.5 clip-chamfer border",
                statusConfig.className
              )}>
                {statusConfig.label}
              </span>
              <span className="text-[10px] font-machine tracking-widest text-[#E0E0F0] truncate">{card.displayLabel}</span>
            </div>
            <div className="text-[9px] text-[#A0A0B0] font-mono border border-rm-metal-border/50 px-1 shrink-0">
              BO{row.bestOf}
            </div>
          </div>
        )}

        {/* VS / Teams area */}
        <div className="flex flex-1 items-stretch justify-between relative bg-[#0a0a0f] border border-rm-metal-border/30 clip-chamfer min-h-[60px] mb-1.5 group-hover:border-rm-metal-border/70 transition-colors">
          
          {/* Red Team Side */}
          <div className={cn(
            "flex-[0.42] flex flex-col justify-center p-2 border-l-2 bg-gradient-to-r from-rm-red/10 to-transparent overflow-hidden z-10",
            hasRealResult && actualWinnerName === row.redTeam.collegeName ? "border-rm-status-safe shadow-[inset_0_0_12px_rgba(0,255,157,0.15)]" : "border-rm-red",
            (selectedTeamKey === row.redTeam.teamKey || highlightedTeamKey === row.redTeam.teamKey) && "ring-1 ring-white/30"
          )}
          onClick={(e) => { e.stopPropagation(); onTeamSelect(row.redTeam.teamKey); }}>
            {hasRealResult && actualWinnerName === row.redTeam.collegeName && (
              <span className="text-[7.5px] font-machine text-rm-status-safe tracking-widest mb-0.5 animate-pulse">{">>> 胜者"}</span>
            )}
            <div 
              title={row.redTeam.collegeName} 
              className={cn("text-[13px] leading-tight font-bold tracking-widest break-normal line-clamp-2 mt-0.5 h-full flex items-center shadow-black drop-shadow-md", showsResolvedScoreline && actualWinnerName === row.redTeam.collegeName ? "text-white text-glow-white" : "text-rm-red")}
            >
              {row.redTeam.collegeName}
            </div>
          </div>
          
          {/* Center VS */}
          <div className="flex-[0.16] flex flex-col items-center justify-center relative shrink-0 z-20">
            <div className="text-xl font-machine italic text-rm-metal-text opacity-30 select-none">VS</div>
            {showsResolvedScoreline ? (
              <div className={cn(
                "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[#0a0a0f] border px-2 py-0.5 text-lg font-machine whitespace-nowrap",
                isSimulationMode
                  ? "border-rm-blue text-rm-blue shadow-[0_0_10px_rgba(0,163,255,0.4)]"
                  : "border-rm-status-safe text-rm-status-safe shadow-[0_0_10px_rgba(0,255,157,0.4)] text-glow"
              )}>
                {row.scoreline}
              </div>
            ) : row.isConfirmedMatchup ? (
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[#0a0a0f] border border-[#facc15] px-1 py-0 px-2 text-[10px] font-machine text-[#facc15] whitespace-nowrap flex flex-col items-center shadow-[0_0_10px_rgba(250,204,21,0.4)]">
                <span className="-mb-0.5 text-[7px] text-[#facc15]/80 uppercase scale-90">预测</span>
                <span className="text-[13px] tracking-widest leading-none mt-0.5">{predictedScore.scoreline}</span>
              </div>
            ) : (
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[#0a0a0f] border border-rm-blue/80 px-1 py-0 px-2 text-[10px] font-machine text-rm-blue whitespace-nowrap flex flex-col items-center shadow-[0_0_10px_rgba(0,163,255,0.4)]">
                <span className="-mb-0.5 text-[7px] text-rm-blue/80 uppercase scale-90">预测</span>
                <span className="text-[13px] tracking-widest leading-none mt-0.5">{predictedScore.scoreline}</span>
              </div>
            )}
          </div>

          {/* Blue Team Side */}
          <div className={cn(
            "flex-[0.42] flex flex-col justify-center items-end p-2 border-r-2 bg-gradient-to-l from-rm-blue/10 to-transparent text-right overflow-hidden z-10",
            hasRealResult && actualWinnerName === row.blueTeam.collegeName ? "border-rm-status-safe shadow-[inset_0_0_12px_rgba(0,255,157,0.15)]" : "border-rm-blue",
            (selectedTeamKey === row.blueTeam.teamKey || highlightedTeamKey === row.blueTeam.teamKey) && "ring-1 ring-white/30"
          )}
          onClick={(e) => { e.stopPropagation(); onTeamSelect(row.blueTeam.teamKey); }}>
            {hasRealResult && actualWinnerName === row.blueTeam.collegeName && (
              <span className="text-[7.5px] font-machine text-rm-status-safe tracking-widest mb-0.5 animate-pulse">胜者 {"<<<"}</span>
            )}
            <div 
              title={row.blueTeam.collegeName} 
              className={cn("text-[13px] leading-tight font-bold tracking-widest break-normal line-clamp-2 mt-0.5 h-full flex items-center justify-end shadow-black drop-shadow-md", showsResolvedScoreline && actualWinnerName === row.blueTeam.collegeName ? "text-white text-glow-white" : "text-rm-blue")}
            >
              {row.blueTeam.collegeName}
            </div>
          </div>
        </div>

        {/* Probability Bar */}
        {(showProbability ?? card.showProbability ?? true) && (
          <div className="shrink-0">
            <div className="flex items-center justify-center text-[7px] font-mono mb-1 px-1 uppercase tracking-widest drop-shadow-md">
              {hasRealResult ? (
                <span className="text-rm-metal-text/60">系统预测记录</span>
              ) : isSimulationMode ? (
                <span className="text-rm-blue/80">模拟赛果推演</span>
              ) : (
                <span className="text-rm-status-warn/80">实时预测信号</span>
              )}
            </div>
            <div className="h-[18px] w-full relative bg-rm-metal-dark border border-rm-metal-border overflow-hidden clip-chamfer">
              {/* Red Bar */}
              <div 
                className="absolute left-0 top-0 bottom-0 bg-gradient-to-r from-rm-red/80 to-rm-red/90 transition-all duration-500 flex items-center justify-start pl-1.5 z-10"
                style={{ 
                  width: `calc(${(expectedRed * 100).toFixed(1)}% + 4px)`, 
                  clipPath: "polygon(0 0, 100% 0, calc(100% - 8px) 100%, 0 100%)" 
                }}
              >
                <span className="text-white font-machine text-[9px] tracking-wider drop-shadow-[0_1px_2px_rgba(0,0,0,1)]">
                  {(expectedRed * 100).toFixed(1)}%
                </span>
              </div>

              {/* Glowing Separator */}
              <div 
                className="absolute top-0 bottom-0 w-[2px] bg-white z-20 transition-all duration-500"
                style={{
                  left: `${(expectedRed * 100).toFixed(1)}%`,
                  marginLeft: '-1px',
                  transform: "skewX(-20deg)",
                  boxShadow: "0 0 8px 1px rgba(255,255,255,0.7)"
                }}
              />

              {/* Blue Bar */}
              <div 
                className="absolute right-0 top-0 bottom-0 bg-gradient-to-l from-rm-blue/80 to-rm-blue/90 transition-all duration-500 flex items-center justify-end pr-1.5 z-10"
                style={{ 
                  width: `calc(${(expectedBlue * 100).toFixed(1)}% + 4px)`, 
                  clipPath: "polygon(8px 0, 100% 0, 100% 100%, 0 100%)" 
                }}
              >
                <span className="text-white font-machine text-[9px] tracking-wider drop-shadow-[0_1px_2px_rgba(0,0,0,1)]">
                  {(expectedBlue * 100).toFixed(1)}%
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
export function CanvasCardView({
  card,
  mode,
  showProbability,
  selectedTeamKey,
  highlightedTeamKey,

  onTeamSelect,
  onMatchSelect,
  selectedMatchLabel,


}: {
  card: CanvasCard;
  mode?: "sim" | "live";
  showProbability: boolean;
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
        showProbability={card.showProbability ?? showProbability ?? true}
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
