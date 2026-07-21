"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { getTeamProfile } from "@/lib/api";
import { formatMatchLabel, formatRankingResultLabel } from "@/lib/display";
import { DEFAULT_SEED, parseSeed } from "@/lib/region-config";
import { buildTeamRegionHref, buildTeamHref, formatTeamProfileSubtitle } from "@/lib/team-profile";
import type { TeamProfileMatch, TeamProfileResponse } from "@/lib/types";
import { SourceFreshnessStrip } from "@/components/source-freshness-strip";
import { ErrorPanel, EmptyState } from "@/components/ui/async-state";
import { MechCard } from "@/components/ui/mech-card";
import { cn } from "@/lib/utils";
import { formatBeijingMonthDayTime } from "@/lib/time-format";

/** 从 URL 查询串解析 seed/mode；缺省或非法时回退到 live 默认上下文 */
export function resolveTeamProfileRequest(
  seedText: string | null,
  modeText: string | null,
): { seed: number; mode: "live" | "sim" } {
  return {
    seed: parseSeed(seedText) ?? DEFAULT_SEED,
    mode: modeText === "sim" || modeText === "live" ? modeText : "live",
  };
}

function pct(value: number | undefined) {
  if (typeof value !== "number") return "暂无";
  return `${(value * 100).toFixed(1)}%`;
}

function signed(value: number | undefined) {
  if (typeof value !== "number") return "暂无";
  if (Math.abs(value) < 0.05) return "±0.0";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

function formatTime(value: string | null | undefined) {
  return formatBeijingMonthDayTime(value) ?? "未排期";
}

const REGION_ACCENT: Record<string, {
  glowPrimary: string;
  glowSecondary: string;
  glowBar: string;
  blob: string;
  blobSecondary: string;
  divider: string;
  edgePrimary: string;
  edgeSecondary: string;
  accentBar: string;
  btnBg: string;
  btnBorder: string;
  btnHover: string;
  linkColor: string;
  barColor: string;
  bottomBar: string;
}> = {
  south_region: {
    glowPrimary: "bg-rm-red",
    glowSecondary: "bg-rm-blue",
    glowBar: "from-rm-red/90 via-rm-red/30 to-rm-blue/30",
    blob: "bg-rm-red/6",
    blobSecondary: "bg-rm-blue/4",
    divider: "bg-rm-red/40",
    edgePrimary: "bg-rm-red/30",
    edgeSecondary: "bg-rm-blue/30",
    accentBar: "bg-rm-blue/60",
    btnBg: "bg-rm-red/15",
    btnBorder: "border-rm-red/60",
    btnHover: "hover:bg-rm-red hover:text-white hover:shadow-[0_0_20px_rgba(232,48,42,0.4)]",
    linkColor: "text-rm-red",
    barColor: "bg-rm-red/50 shadow-[0_0_6px_rgba(232,48,42,0.3)]",
    bottomBar: "bg-rm-red/60",
  },
  east_region: {
    glowPrimary: "bg-rm-blue",
    glowSecondary: "bg-rm-red",
    glowBar: "from-rm-blue/90 via-rm-blue/30 to-rm-red/30",
    blob: "bg-rm-blue/6",
    blobSecondary: "bg-rm-red/4",
    divider: "bg-rm-blue/40",
    edgePrimary: "bg-rm-blue/30",
    edgeSecondary: "bg-rm-red/30",
    accentBar: "bg-rm-red/60",
    btnBg: "bg-rm-blue/15",
    btnBorder: "border-rm-blue/60",
    btnHover: "hover:bg-rm-blue hover:text-white hover:shadow-[0_0_20px_rgba(42,159,255,0.4)]",
    linkColor: "text-rm-blue",
    barColor: "bg-rm-blue/50 shadow-[0_0_6px_rgba(42,159,255,0.3)]",
    bottomBar: "bg-rm-blue/60",
  },
  north_region: {
    glowPrimary: "bg-rm-violet",
    glowSecondary: "bg-rm-blue",
    glowBar: "from-rm-violet/90 via-rm-violet/30 to-rm-blue/30",
    blob: "bg-rm-violet/6",
    blobSecondary: "bg-rm-red/4",
    divider: "bg-rm-violet/40",
    edgePrimary: "bg-rm-violet/30",
    edgeSecondary: "bg-rm-blue/30",
    accentBar: "bg-rm-red/60",
    btnBg: "bg-rm-violet/15",
    btnBorder: "border-rm-violet/60",
    btnHover: "hover:bg-rm-violet hover:text-white hover:shadow-[0_0_20px_rgba(139,92,246,0.4)]",
    linkColor: "text-rm-violet",
    barColor: "bg-rm-violet/50 shadow-[0_0_6px_rgba(139,92,246,0.3)]",
    bottomBar: "bg-rm-violet/60",
  },
};

/* ─── 赛程路径行（时间线样式） ─── */
function MatchPathRow({
  match,
  isLast,
  accent,
}: {
  match: TeamProfileMatch;
  isLast: boolean;
  accent: (typeof REGION_ACCENT)[string];
}) {
  const isWin = match.resultForTeam === "win";
  const isLoss = match.resultForTeam === "loss";
  const isPending = !isWin && !isLoss;

  const dotColor = isWin
    ? "bg-rm-status-safe shadow-[0_0_6px_rgba(0,232,120,0.5)]"
    : isLoss
      ? "bg-rm-red shadow-[0_0_6px_rgba(232,48,42,0.5)]"
      : "bg-rm-blue shadow-[0_0_6px_rgba(42,159,255,0.4)] animate-dot-pulse";

  const leftBorder = isWin
    ? "border-l-rm-status-safe/60"
    : isLoss
      ? "border-l-rm-red/60"
      : "border-l-rm-blue/40";

  const bgHover = isWin
    ? "hover:bg-rm-status-safe/5"
    : isLoss
      ? "hover:bg-rm-red/5"
      : "hover:bg-rm-blue/5";

  return (
    <div className="relative flex gap-3">
      {/* 时间线竖线 + 节点 */}
      <div className="flex flex-col items-center shrink-0 w-5">
        <div className={cn("w-2.5 h-2.5 rounded-full border-2 border-rm-metal-border", dotColor)} />
        {!isLast && <div className="w-px flex-1 bg-rm-metal-border/50 my-0.5" />}
      </div>

      {/* 内容卡片 */}
      <Link
        href={buildTeamHref(match.opponent.teamKey)}
        aria-label={`查看对手 ${match.opponent.collegeName} 的队伍档案`}
        className={cn(
          "group/match flex-1 border border-rm-metal-border bg-rm-metal-card px-3 py-2.5 transition-colors duration-200",
          `border-l-2 ${leftBorder}`,
          bgHover,
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "font-mono text-[10px] px-1.5 py-0.5 border",
                  isWin
                    ? "border-rm-status-safe/30 bg-rm-status-safe/10 text-rm-status-safe"
                    : isLoss
                      ? "border-rm-red/30 bg-rm-red/10 text-rm-red"
                      : "border-rm-blue/30 bg-rm-blue/10 text-rm-blue",
                )}
              >
                {isWin ? "已胜" : isLoss ? "已负" : "未赛"}
              </span>
              <span className="font-sans text-sm font-semibold text-rm-metal-textLight truncate">
                {formatMatchLabel(match.matchLabel)}
              </span>
            </div>
            <div className="mt-1.5 font-mono text-[11px] text-rm-metal-textMuted">
              对手{" "}
              <span
                className={cn(
                  "underline-offset-2 transition-colors group-hover/match:underline",
                  isWin ? "text-rm-status-safe/70 hover:text-rm-status-safe" : "text-rm-metal-text hover:text-rm-metal-textLight",
                )}
              >
                {match.opponent.collegeName}
              </span>
              {" "}· {match.opponent.teamName} · {formatTime(match.plannedStartAt)}
            </div>
          </div>
          <div className="text-right font-mono text-xs shrink-0">
            {!isWin && !isLoss && (
              <div className={cn("font-semibold", accent.linkColor)}>
                预测胜率 {(match.winProbability * 100).toFixed(0)}%
              </div>
            )}
            <div className="text-rm-metal-textFaint">{match.scoreline}</div>
          </div>
        </div>
      </Link>
    </div>
  );
}

/* ─── 后续对手行 ─── */
function UpcomingOpponentRow({
  match,
  teamElo,
}: {
  match: TeamProfileMatch;
  teamElo: number;
}) {
  const opponentElo =
    match.side === "red"
      ? (match.blueCurrentElo ?? match.blueMu0 ?? 0)
      : (match.redCurrentElo ?? match.redMu0 ?? 0);
  const eloDiff = teamElo - opponentElo;
  const winPct = match.winProbability * 100;

  return (
    <Link
      href={buildTeamHref(match.opponent.teamKey)}
      className="block border border-rm-metal-border bg-rm-metal-panel px-3 py-3 transition-all duration-200 hover:border-rm-metal-textMuted/30 hover:bg-rm-metal-card group/opp"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-sans text-sm font-semibold text-rm-metal-textLight group-hover/opp:text-white transition-colors truncate">
            {match.opponent.collegeName}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[11px] text-rm-metal-textMuted">
            <span>{match.opponent.teamName}</span>
            <span className="text-rm-metal-textFaint/70">·</span>
            <span>{match.stageLabel}</span>
            {opponentElo > 0 && (
              <>
                <span className="text-rm-metal-textFaint/70">·</span>
                <span className={cn(
                  "font-semibold",
                  eloDiff > 5 ? "text-rm-status-safe/80" : eloDiff < -5 ? "text-rm-red/80" : "text-rm-metal-text/70",
                )}>
                  Elo {opponentElo.toFixed(1)} ({eloDiff > 0 ? "+" : ""}{eloDiff.toFixed(1)})
                </span>
              </>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div
            className={cn(
              "font-mono text-sm font-bold",
              winPct > 60 ? "text-rm-status-safe" : winPct > 40 ? "text-rm-status-warn" : "text-rm-red",
            )}
          >
            {winPct.toFixed(0)}%
          </div>
          <div className="mt-1 font-mono text-[10px] text-rm-metal-textFaint tracking-widest">胜率</div>
        </div>
      </div>
      {/* 胜率进度条 */}
      <div
        role="progressbar"
        aria-label="预测胜率"
        aria-valuenow={Math.round(winPct)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="mt-2.5 h-1 bg-rm-metal-dark rounded-full overflow-hidden"
      >
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            winPct > 60 ? "bg-rm-status-safe/60" : winPct > 40 ? "bg-rm-status-warn/60" : "bg-rm-red/60",
          )}
          style={{ width: `${winPct}%` }}
        />
      </div>
    </Link>
  );
}

/* ══════════════════════════════════════════
   TeamProfilePage
   ══════════════════════════════════════════ */
export function TeamProfilePage({ encodedTeamKey }: { encodedTeamKey: string }) {
  const [profile, setProfile] = useState<TeamProfileResponse | null>(null);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const teamKey = decodeURIComponent(encodedTeamKey);
  const searchParams = useSearchParams();
  const { seed, mode } = resolveTeamProfileRequest(
    searchParams.get("seed"),
    searchParams.get("mode"),
  );

  useEffect(() => {
    const controller = new AbortController();
    getTeamProfile(teamKey, seed, mode)
      .then((payload) => {
        if (!controller.signal.aborted) setProfile(payload);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      controller.abort();
    };
  }, [teamKey, seed, mode, reloadKey]);

  const handleRetry = () => {
    setProfile(null);
    setError("");
    setReloadKey((key) => key + 1);
  };

  /* ── 错误态 ── */
  if (error) {
    return (
      <div className="min-h-screen">
        <div className="mx-auto max-w-screen-xl px-4 py-8">
          <ErrorPanel
            title="系统错误"
            message={`队伍档案加载失败：${error}`}
            onRetry={handleRetry}
            backHref="/"
            backLabel="返回总控台"
          />
        </div>
      </div>
    );
  }

  /* ── 加载态（骨架屏） ── */
  if (!profile) {
    return (
      <div className="min-h-screen">
        <div className="mx-auto max-w-screen-xl space-y-6 px-4 py-8">
          {/* 骨架 header */}
          <div className="border border-rm-metal-border bg-rm-metal-panel px-5 py-6 animate-pulse">
            <div className="h-3 w-24 bg-rm-metal-border rounded mb-3" />
            <div className="h-7 w-64 bg-rm-metal-border rounded mb-2" />
            <div className="h-4 w-40 bg-rm-metal-border rounded" />
          </div>
          {/* 骨架指标卡片 */}
          <div className="grid gap-3 md:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="border border-rm-metal-border bg-rm-metal-card px-4 py-3 animate-pulse">
                <div className="h-2.5 w-16 bg-rm-metal-border rounded mb-2" />
                <div className="h-6 w-20 bg-rm-metal-border rounded" />
              </div>
            ))}
          </div>
          {/* 骨架双栏 */}
          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="space-y-3 animate-pulse">
                <div className="h-5 w-28 bg-rm-metal-border rounded" />
                {[...Array(3)].map((_, j) => (
                  <div key={j} className="border border-rm-metal-border bg-rm-metal-card px-3 py-4">
                    <div className="h-4 w-full bg-rm-metal-border rounded mb-2" />
                    <div className="h-3 w-2/3 bg-rm-metal-border rounded" />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ── 正常内容 ── */
  const finalLabel = profile.finalRanking
    ? formatRankingResultLabel(profile.finalRanking.rank, profile.finalRanking.finalBucket, profile.finalRanking.advancement)
    : "暂无最终落位";
  const regionHref = buildTeamRegionHref(profile);
  const regionSlug = profile.region.regionSlug;
  const accent = REGION_ACCENT[regionSlug] ?? REGION_ACCENT.north_region;
  const teamElo = profile.team.currentElo ?? profile.team.mu0;

  return (
    <div className="min-h-screen">
      {/* 页面氛围光晕 */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
        <div
          className={cn(
            "absolute top-0 right-0 w-[40vw] h-[60vh] rounded-full blur-[120px] opacity-[0.07]",
            accent.glowPrimary,
          )}
          style={{ transform: "translate(20%, -20%)" }}
        />
        <div
          className={cn(
            "absolute bottom-0 left-0 w-[35vw] h-[50vh] rounded-full blur-[100px] opacity-[0.05]",
            accent.glowSecondary,
          )}
          style={{ transform: "translate(-20%, 20%)" }}
        />
      </div>

      <div className="relative mx-auto max-w-screen-xl space-y-6 px-4 py-8">
        {/* ═══ 面包屑 ═══ */}
        <nav aria-label="面包屑" className="flex items-center gap-2 font-mono text-[10px] text-rm-metal-textFaint tracking-widest">
          <Link href="/" className="hover:text-rm-metal-textMuted transition-colors">
            战术指挥中心
          </Link>
          <span>/</span>
          <Link
            href={regionHref}
            className={cn("hover:text-rm-metal-textLight transition-colors", accent.linkColor)}
          >
            {profile.region.regionName}
          </Link>
          <span>/</span>
          <span aria-current="page" className="text-rm-metal-textLight">{profile.team.collegeName}</span>
        </nav>

        {/* ═══ Hero 头部 ═══ */}
        <div>
          <div className="relative">
            {/* 顶部发光条 */}
            <div
              className={cn(
                "h-0.5 bg-gradient-to-r shadow-[0_0_12px_rgba(232,48,42,0.2),0_0_12px_rgba(42,159,255,0.2)]",
                accent.glowBar,
              )}
            />

            {/* 主面板 */}
            <div
              className={cn(
                "relative bg-rm-metal-panel border-x border-b border-rm-metal-border",
                "clip-chamfer-tr-bl overflow-hidden",
              )}
              style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03), inset 0 -1px 0 rgba(0,0,0,0.3)" }}
            >
              {/* 扫描线覆盖层 */}
              <div
                className="absolute inset-0 pointer-events-none z-10 opacity-[0.025]"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.8) 2px, rgba(255,255,255,0.8) 3px)",
                  backgroundSize: "100% 4px",
                }}
              />

              {/* 氛围光晕 */}
              <div
                className={cn(
                  "absolute top-0 right-0 w-64 h-64 rounded-full blur-3xl -translate-y-1/3 translate-x-1/4 pointer-events-none",
                  accent.blob,
                )}
              />
              <div
                className={cn(
                  "absolute bottom-0 left-0 w-72 h-72 rounded-full blur-3xl translate-y-1/3 -translate-x-1/4 pointer-events-none opacity-60",
                  accent.blobSecondary,
                )}
              />

              {/* 角落铆钉 */}
              {[
                "top-4 left-4",
                "top-4 left-9",
                "top-4 right-4",
                "top-4 right-9",
                "bottom-4 left-4",
                "bottom-4 left-9",
                "bottom-4 right-4",
                "bottom-4 right-9",
              ].map((pos) => (
                <div
                  key={pos}
                  className={cn(
                    "absolute w-2 h-2 rounded-full bg-rm-metal-textMuted/25 shadow-[0_0_3px_rgba(255,255,255,0.08)]",
                    pos,
                  )}
                />
              ))}

              {/* L型角标 */}
              <div className="absolute top-3 left-3 w-5 h-5 border-t-2 border-l-2 border-rm-metal-textMuted/20 pointer-events-none" />
              <div className="absolute top-3 right-3 w-5 h-5 border-t-2 border-r-2 border-rm-metal-textMuted/20 pointer-events-none" />
              <div className="absolute bottom-3 left-3 w-5 h-5 border-b-2 border-l-2 border-rm-metal-textMuted/20 pointer-events-none" />
              <div className="absolute bottom-3 right-3 w-5 h-5 border-b-2 border-r-2 border-rm-metal-textMuted/20 pointer-events-none" />

              {/* 顶部边缘标记 */}
              <div className="absolute top-0 left-1/3 w-px h-2 bg-rm-metal-textMuted/15 pointer-events-none" />
              <div className="absolute top-0 left-1/2 w-px h-2 bg-rm-metal-textMuted/20 pointer-events-none" />
              <div className="absolute top-0 right-1/3 w-px h-2 bg-rm-metal-textMuted/15 pointer-events-none" />
              <div className="absolute top-0 left-1/2 -translate-x-6 text-[10px] text-rm-metal-textFaint/25 font-mono pointer-events-none">
                SYS
              </div>

              {/* ── 内容区 ── */}
              <div className="relative z-10 px-6 sm:px-8 py-7">
                {/* 分类标签 */}
                <div className="flex items-center gap-2 mb-3">
                  <div className={cn("h-px w-6", accent.divider)} />
                  <span className="font-mono text-[10px] text-rm-metal-textFaint/70 tracking-[0.3em] uppercase">
                    {profile.region.regionName} · 队伍档案
                  </span>
                </div>

                {/* 队名 + 操作区 */}
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                  <div className={cn("flex items-center gap-4 border-l-2 pl-4", accent.btnBorder)}>
                    <div
                      aria-label={`队伍编号 ${profile.slot?.slot ?? "待定"}`}
                      className={cn(
                        "min-w-16 border border-current/35 bg-black/30 px-3 py-2 text-center font-machine text-2xl font-black tracking-tight text-glow-blue sm:min-w-20 sm:text-3xl",
                        accent.linkColor,
                      )}
                    >
                      {profile.slot?.slot ?? "--"}
                    </div>
                    <div className="min-w-0">
                      <h1
                        className="font-sans text-2xl font-black text-rm-metal-textLight sm:text-3xl"
                        style={{ textShadow: "0 0 18px rgba(255,255,255,0.08)" }}
                      >
                        {profile.team.collegeName}
                      </h1>
                      <p className="mt-1.5 font-mono text-xs text-rm-metal-textMuted">
                        {formatTeamProfileSubtitle(profile.team.teamName, profile.slot)}
                      </p>
                    </div>
                  </div>
                  <Link
                    href={regionHref}
                    className={cn(
                      "group/btn inline-flex items-center gap-2 border px-4 py-2.5 text-center font-mono text-xs transition-all duration-200 active:scale-[0.98]",
                      accent.btnBorder,
                      accent.btnBg,
                      accent.linkColor,
                      accent.btnHover,
                      "shadow-[0_0_10px_rgba(232,48,42,0.1)]",
                    )}
                  >
                    <span className="group-hover/btn:translate-x-0.5 transition-transform duration-200">←</span>
                    回到赛区沙盘并高亮该队
                  </Link>
                </div>
              </div>
            </div>

            {/* 底部装饰条 */}
            <div className="flex items-center gap-0 -mt-px">
              <div className={cn("h-0.5 flex-1", accent.edgePrimary)} />
              <div className={cn("h-0.5 w-12", accent.bottomBar)} />
              <div className="h-0.5 w-8 bg-rm-result-winner/40" />
              <div className="h-0.5 w-6 bg-rm-metal-textMuted/15" />
              <div className={cn("h-0.5 w-12", accent.accentBar)} />
              <div className={cn("h-0.5 flex-1", accent.edgeSecondary)} />
            </div>
          </div>
        </div>

        {/* ═══ 数据源新鲜度 ═══ */}
        <SourceFreshnessStrip freshness={profile.sourceFreshness} />

        {/* ═══ 四维指标卡片 ═══ */}
        <section className="grid gap-3 md:grid-cols-4">
          <MechCard variant="blue" label="当前 Elo">
            <div className="font-machine text-2xl font-bold text-rm-metal-textLight tracking-wide">
              {teamElo.toFixed(1)}
            </div>
            <div className="mt-1 flex items-center gap-1.5 font-mono text-xs">
              <span
                className={cn(
                  (profile.team.eloDeltaFromPreseason ?? 0) > 0 ? "text-rm-status-safe" : "text-rm-red",
                )}
              >
                {signed(profile.team.eloDeltaFromPreseason)}
              </span>
              <span className="text-rm-metal-textFaint text-[10px]">vs 赛季初</span>
            </div>
          </MechCard>

          <MechCard
            variant="default"
            label="国赛概率"
            className="!border-rm-status-warn/60 !bg-[rgba(255,176,0,0.13)] shadow-[0_0_15px_rgba(255,176,0,0.15)]"
          >
            <div className="font-machine text-2xl font-bold text-rm-status-warn tracking-wide">
              {pct(profile.team.probabilities.national)}
            </div>
            <div
              role="progressbar"
              aria-label="国赛概率"
              aria-valuenow={Math.round((profile.team.probabilities.national ?? 0) * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              className="mt-2 h-1.5 bg-rm-metal-dark rounded-full overflow-hidden"
            >
              <div
                className="h-full bg-rm-status-warn/50 rounded-full"
                style={{ width: `${(profile.team.probabilities.national ?? 0) * 100}%` }}
              />
            </div>
          </MechCard>

          <MechCard
            variant="default"
            label="复活赛概率"
            className="!border-rm-blue/60 !bg-[rgba(42,159,255,0.13)] shadow-[0_0_15px_rgba(42,159,255,0.15)]"
          >
            <div className="font-machine text-2xl font-bold text-rm-blue tracking-wide">
              {pct(profile.team.probabilities.repechage)}
            </div>
            <div
              role="progressbar"
              aria-label="复活赛概率"
              aria-valuenow={Math.round((profile.team.probabilities.repechage ?? 0) * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              className="mt-2 h-1.5 bg-rm-metal-dark rounded-full overflow-hidden"
            >
              <div
                className="h-full bg-rm-blue/50 rounded-full"
                style={{ width: `${(profile.team.probabilities.repechage ?? 0) * 100}%` }}
              />
            </div>
          </MechCard>

          <MechCard variant="red" label="最终落位">
            <div className="font-machine text-lg font-bold text-rm-metal-textLight tracking-wide">
              {finalLabel}
            </div>
            <div className="mt-1 font-mono text-[10px] text-rm-metal-textFaint">
              {profile.finalRanking ? `排名 #${profile.finalRanking.rank}` : "模拟中"}
            </div>
          </MechCard>
        </section>

        {/* ═══ 双栏：赛程路径 + 预测路径 ═══ */}
        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          {/* 左侧：赛程路径（时间线） */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className={cn("h-4 w-0.5", accent.barColor)} />
              <h2 className="font-sans text-lg font-semibold text-rm-metal-textLight">赛程路径</h2>
              <span className="font-mono text-[10px] text-rm-metal-textFaint tracking-widest">
                {profile.matchPath.length} 场
              </span>
            </div>
            <div className="space-y-1.5 pl-0.5">
              {profile.matchPath.map((match, idx) => (
                <MatchPathRow
                  key={match.matchLabel}
                  match={match}
                  isLast={idx === profile.matchPath.length - 1}
                  accent={accent}
                />
              ))}
              {profile.matchPath.length === 0 && (
                <EmptyState text="暂无已举行比赛" />
              )}
            </div>
          </div>

          {/* 右侧：预测路径 */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="h-4 w-0.5 bg-rm-status-warn/60 shadow-[0_0_6px_rgba(255,176,0,0.3)]" />
              <h2 className="font-sans text-lg font-semibold text-rm-metal-textLight">预测路径</h2>
              <span className="font-mono text-[10px] text-rm-metal-textFaint tracking-widest">
                {profile.upcomingMatches.length} 场
              </span>
            </div>
            <div className="space-y-2">
              {profile.upcomingMatches.map((match) => (
                <UpcomingOpponentRow key={match.matchLabel} match={match} teamElo={teamElo} />
              ))}
              {profile.upcomingMatches.length === 0 && (
                <div className={cn(
                  "relative overflow-hidden border p-5 text-center",
                  profile.finalRanking?.rank === 1
                    ? "border-rm-gold/60 bg-rm-gold/10 shadow-[0_0_24px_rgba(232,196,74,0.12)]"
                    : "border-rm-metal-border bg-rm-metal-card",
                )}>
                  <div className={cn("font-machine text-[10px] tracking-[0.28em]", profile.finalRanking?.rank === 1 ? "text-rm-gold" : "text-rm-metal-textMuted")}>SEASON SUMMARY</div>
                  <div className={cn("mt-3 font-machine text-xl font-black", profile.finalRanking?.rank === 1 ? "text-rm-gold text-glow-winner" : "text-rm-metal-textLight")}>{finalLabel}</div>
                  <p className="mt-2 text-xs text-rm-metal-textMuted">本赛区赛程已经结束，暂无后续预测对阵。</p>
                  {profile.finalRanking?.rank === 1 ? <div className="mt-4 border-t border-rm-gold/25 pt-3 font-mono text-[10px] tracking-widest text-rm-gold">REGIONAL CHAMPION</div> : null}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
