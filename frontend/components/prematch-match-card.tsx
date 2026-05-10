// frontend/components/prematch-match-card.tsx
"use client";

import Link from "next/link";
import { formatMatchLabel } from "@/lib/display";
import { buildPrematchHref, getDataSourceLabel, formatPrematchTime } from "@/lib/prematch-center";
import type { PrematchCenterMatch } from "@/lib/types";

function DataSourceDot({ source }: { source: PrematchCenterMatch["dataSource"] }) {
  const isOfficial = source === "official_live";
  const isProxy = source === "simulation_proxy";
  const label = getDataSourceLabel(source);
  return (
    <span
      title={label}
      className={`inline-flex items-center gap-1 shrink-0 font-mono text-[9px] leading-none
        ${isOfficial ? "text-rm-status-safe" : ""}
        ${isProxy ? "text-rm-status-warn" : ""}
        ${!isOfficial && !isProxy ? "text-rm-status-prediction" : ""}
      `}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full animate-dot-pulse
          ${isOfficial ? "bg-rm-status-safe shadow-[0_0_4px_rgba(0,232,120,0.6)]" : ""}
          ${isProxy ? "bg-rm-status-warn shadow-[0_0_4px_rgba(255,176,0,0.6)]" : ""}
          ${!isOfficial && !isProxy ? "bg-rm-status-prediction shadow-[0_0_4px_rgba(42,159,255,0.6)]" : ""}
        `}
      />
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}

function SignalStrip({
  match,
  includeScoreline = true,
}: {
  match: PrematchCenterMatch;
  includeScoreline?: boolean;
}) {
  if (match.isConfirmedMatchup === false) {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] text-rm-metal-textFaint">
        <span className="text-rm-status-scheduled font-semibold shrink-0">官方占位</span>
        <span className="text-rm-metal-textFaint/30">·</span>
        <span>学校队伍待确认</span>
      </div>
    );
  }

  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] text-rm-metal-textFaint"
    >
      {includeScoreline && (
        <>
          <span className="text-rm-metal-textLight font-semibold shrink-0">
            预测 {match.predictedScoreline}
          </span>
          <span className="text-rm-metal-textFaint/30">·</span>
          <span>{match.confidenceText}</span>
        </>
      )}

      {match.modelAudienceDivergence.available && (
        <>
          <span className="text-rm-metal-textFaint/30">·</span>
          <span>
            分歧
            <span
              className={
                match.modelAudienceDivergence.label === "明显分歧"
                  ? "text-rm-status-deviation"
                  : match.modelAudienceDivergence.label === "轻微分歧"
                    ? "text-rm-status-warn"
                    : "text-rm-metal-textMuted"
              }
            >
              {match.modelAudienceDivergence.label}
            </span>
          </span>
        </>
      )}

      <span className="text-rm-metal-textFaint/30">·</span>
      <span>
        爆冷
        <span
          className={
            match.upsetRisk.label === "高"
              ? "text-rm-status-upset"
              : match.upsetRisk.label === "中"
                ? "text-rm-status-warn"
                : "text-rm-metal-textMuted"
          }
        >
          {match.upsetRisk.label}
        </span>
      </span>
    </div>
  );
}

/** Red-blue bar matching the canvas SignalMicroRow aesthetic:
 *  gradient fills, inset highlight, per-segment glow, luminous divider dot.
 *  The divider dot (white for model, gold for audience) eliminates
 *  chromostereopsis while adding a polished mechanical accent. */
function SplitBar({
  redRate,
  blueRate,
  barHeight,
  variant = "model",
}: {
  redRate: number;
  blueRate: number;
  barHeight: string;
  variant?: "model" | "audience";
}) {
  const red = Math.max(0, Math.min(1, redRate));
  const blue = Math.max(0, Math.min(1, blueRate));
  const dividerColor = variant === "audience" ? "#FFE0A0" : "#FFFFFF";
  const dividerGlow =
    variant === "audience"
      ? "0 0 3px rgba(255,224,160,0.5)"
      : "0 0 3px rgba(255,255,255,0.5)";

  return (
    <span
      className={`relative block flex-1 min-w-[32px] overflow-hidden bg-black/80 ${barHeight}`}
      style={{ borderRadius: "1px", border: "1px solid rgba(255,255,255,0.12)" }}
    >
      {/* Red segment — gradient with subtle inset highlight */}
      <span
        className="absolute inset-y-0 left-0"
        style={{
          width: `${(red * 100).toFixed(1)}%`,
          background: "linear-gradient(90deg, rgba(232,48,42,0.85), rgba(232,48,42,0.65))",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.10)",
        }}
      />
      {/* Blue segment — gradient from right edge */}
      <span
        className="absolute inset-y-0 right-0"
        style={{
          width: `${(blue * 100).toFixed(1)}%`,
          background: "linear-gradient(270deg, rgba(42,159,255,0.85), rgba(42,159,255,0.65))",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.10)",
        }}
      />
      {/* Subtle divider line at red/blue boundary */}
      <span
        className="absolute inset-y-0"
        style={{
          left: `${(red * 100).toFixed(1)}%`,
          width: "1px",
          background: dividerColor,
          boxShadow: dividerGlow,
        }}
      />
      {/* Small dot centered on the divider line */}
      <span
        className="absolute rounded-full"
        style={{
          left: `calc(${(red * 100).toFixed(1)}% - 1.5px)`,
          top: "50%",
          transform: "translateY(-50%)",
          width: "3px",
          height: "3px",
          background: dividerColor,
          boxShadow: dividerGlow,
        }}
      />
    </span>
  );
}

function AudienceBar({ match }: { match: PrematchCenterMatch }) {
  const aud = match.audience;
  if (!aud.available || aud.redRate == null || aud.blueRate == null) return null;
  const redPct = Math.round(aud.redRate * 100);
  const bluePct = Math.round(aud.blueRate * 100);

  return (
    <div className="space-y-1">
      {/* ── Desktop: single row with label + pct + bar + pct ── */}
      <div className="hidden sm:flex items-center gap-1.5">
        <span className="font-mono text-[9px] text-rm-metal-textFaint/60 tracking-wide shrink-0">
          王牌预言家
        </span>
        <span className="text-rm-red tabular-nums w-7 text-right shrink-0 font-mono text-[9px]">
          {redPct}%
        </span>
        <SplitBar redRate={aud.redRate} blueRate={aud.blueRate} barHeight="h-1" variant="audience" />
        <span className="text-rm-blue tabular-nums w-7 text-left shrink-0 font-mono text-[9px]">
          {bluePct}%
        </span>
      </div>

      {/* ── Mobile: stacked full-width, same rhythm as Elo bar ── */}
      <div className="sm:hidden space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[9px] text-rm-metal-textFaint/50 tracking-widest uppercase shrink-0">
            王牌预言家
          </span>
          <span className="flex-1 h-px bg-rm-metal-border/30" />
        </div>
        <SplitBar redRate={aud.redRate} blueRate={aud.blueRate} barHeight="h-2" variant="audience" />
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] text-rm-red tabular-nums">
            红 {redPct}%
          </span>
          <span className="font-mono text-[10px] text-rm-blue tabular-nums">
            蓝 {bluePct}%
          </span>
        </div>
      </div>
    </div>
  );
}

export function PrematchMatchCard({
  match,
  variant = "default",
}: {
  match: PrematchCenterMatch;
  variant?: "default" | "hero";
}) {
  const href = buildPrematchHref(match);
  const time = formatPrematchTime(match.plannedStartAt);
  const isHero = variant === "hero";
  const redPct = Math.round(match.pSeriesRed * 100);
  const bluePct = Math.round(match.pSeriesBlue * 100);
  const isOfficialPlaceholder = match.dataSource === "official_live" && match.isConfirmedMatchup === false;
  const winnerSide = match.pSeriesRed >= match.pSeriesBlue ? "red" : "blue";
  const accentColor = winnerSide === "red" ? "bg-rm-red" : "bg-rm-blue";
  const accentGlow = winnerSide === "red"
    ? "shadow-[0_0_6px_rgba(232,48,42,0.5)]"
    : "shadow-[0_0_6px_rgba(42,159,255,0.5)]";

  return (
    <Link
      href={href}
      className={`block group relative bg-rm-metal-card border overflow-hidden
        transition-all duration-300
        ${isHero
          ? "border-rm-metal-border/80 ring-1 ring-rm-status-warn/20 animate-glow-breathe"
          : "border-rm-metal-border/60 hover:border-rm-blue/40 hover:shadow-[0_0_18px_rgba(42,159,255,0.08),0_0_18px_rgba(232,48,42,0.05)]"
        }
      `}
      style={{ clipPath: "polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 6px 100%, 0 calc(100% - 6px))" }}
    >
      {/* Left accent bar — predicted winner side */}
      <span
        className={`absolute left-0 top-0 bottom-0 ${isHero ? "w-1" : "w-0.5"} ${accentColor} ${accentGlow}`}
      />

      {/* ═══ Zone A: Context header ═══ */}
      <div className={`flex items-center justify-between gap-2 border-b border-white/[0.04]
        ${isHero ? "px-3 pt-2 pb-1.5" : "px-2.5 pt-1.5 pb-1"}`}>
        <div className="flex items-center gap-1.5 min-w-0">
          {isHero && (
            <span className="font-mono text-[9px] text-rm-status-warn border border-rm-status-warn/30
              bg-rm-status-warn/8 px-1.5 py-px tracking-widest shrink-0">
              NEXT
            </span>
          )}
          <span className="font-mono text-[10px] text-rm-metal-textMuted truncate">
            {match.regionName} · {formatMatchLabel(match.matchLabel)}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <DataSourceDot source={match.dataSource} />
          {time && (
            <span className="font-mono text-[10px] text-rm-status-scheduled tabular-nums shrink-0">
              {time}
            </span>
          )}
        </div>
      </div>

      {/* ═══ Zone B: Combat — Teams + Elo bar ═══ */}
      <div className={`border-b border-white/[0.04]
        ${isHero ? "px-3 py-2.5" : "px-2.5 py-2"}`}>

        {/* Desktop: single horizontal row */}
        <div className="hidden sm:flex items-center gap-1.5">
          <span
            title={match.redTeam.collegeName}
            className={`flex-1 min-w-[52px] text-right truncate font-sans font-semibold text-rm-red
              ${isHero ? "text-sm" : "text-[12px]"}`}
          >
            {match.redTeam.collegeName}
          </span>
          {isOfficialPlaceholder ? (
            <span className="shrink-0 border border-rm-status-scheduled/30 bg-rm-status-scheduled/8 px-2 py-0.5 font-mono text-[10px] text-rm-status-scheduled">
              队伍待定
            </span>
          ) : (
            <>
              <span className="w-8 text-right shrink-0 font-mono font-bold text-rm-red tabular-nums text-[13px]">
                {redPct}%
              </span>
              <SplitBar
                redRate={match.pSeriesRed}
                blueRate={match.pSeriesBlue}
                barHeight={isHero ? "h-2" : "h-1.5"}
              />
              <span className="w-8 text-left shrink-0 font-mono font-bold text-rm-blue tabular-nums text-[13px]">
                {bluePct}%
              </span>
            </>
          )}
          <span
            title={match.blueTeam.collegeName}
            className={`flex-1 min-w-[52px] text-left truncate font-sans font-semibold text-rm-blue
              ${isHero ? "text-sm" : "text-[12px]"}`}
          >
            {match.blueTeam.collegeName}
          </span>
        </div>

        {/* Mobile: stacked */}
        <div className="sm:hidden space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span title={match.redTeam.collegeName} className="truncate font-sans font-semibold text-rm-red text-[13px]">
              {match.redTeam.collegeName}
            </span>
            {!isOfficialPlaceholder && (
              <span className="shrink-0 font-mono font-bold text-rm-red tabular-nums text-[13px]">{redPct}%</span>
            )}
          </div>
          {isOfficialPlaceholder ? (
            <div className="border border-rm-status-scheduled/25 bg-rm-status-scheduled/8 py-1 text-center font-mono text-[10px] text-rm-status-scheduled">
              学校队伍待确认
            </div>
          ) : (
            <SplitBar redRate={match.pSeriesRed} blueRate={match.pSeriesBlue} barHeight="h-2" />
          )}
          <div className="flex items-center justify-between gap-2">
            <span title={match.blueTeam.collegeName} className="truncate font-sans font-semibold text-rm-blue text-[13px]">
              {match.blueTeam.collegeName}
            </span>
            {!isOfficialPlaceholder && (
              <span className="shrink-0 font-mono font-bold text-rm-blue tabular-nums text-[13px]">{bluePct}%</span>
            )}
          </div>
        </div>
      </div>

      {/* ═══ Zone C: Intel — Scoreline + signals + audience ═══ */}
      {isHero ? (
        <>
          {!isOfficialPlaceholder && (
            <div className="flex items-center gap-2 px-3 pt-2 pb-1">
              <span className="font-mono text-sm font-semibold text-rm-metal-textLight">
                预测比分 {match.predictedScoreline}
              </span>
              <span className="text-rm-metal-textFaint/30">·</span>
              <span className="font-mono text-[12px] text-rm-metal-textMuted">{match.confidenceText}</span>
            </div>
          )}
          <div className="px-3 pb-2.5 pt-1 space-y-1.5">
            <SignalStrip match={match} includeScoreline={false} />
            <AudienceBar match={match} />
          </div>
        </>
      ) : (
        <div className="px-2.5 py-2 space-y-1.5">
          <SignalStrip match={match} />
          <AudienceBar match={match} />
        </div>
      )}
    </Link>
  );
}
