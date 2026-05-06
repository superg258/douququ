"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getTeamProfile } from "@/lib/api";
import { formatRankingResultLabel } from "@/lib/display";
import { buildTeamRegionHref } from "@/lib/team-profile";
import type { TeamProfileMatch, TeamProfileResponse } from "@/lib/types";
import { SourceFreshnessStrip } from "@/components/source-freshness-strip";

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
  if (!value) return "未排期";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "未排期";
  return parsed.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function MatchPathRow({ match }: { match: TeamProfileMatch }) {
  const isWin = match.resultForTeam === "win";
  const isLoss = match.resultForTeam === "loss";
  return (
    <div className="border border-rm-metal-border bg-rm-metal-card px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-sans text-sm font-semibold text-rm-metal-textLight">
            {match.stageLabel} · {match.matchLabel}
          </div>
          <div className="mt-1 font-mono text-[11px] text-rm-metal-textMuted">
            对手 {match.opponent.collegeName} · {formatTime(match.plannedStartAt)}
          </div>
        </div>
        <div className="text-right font-mono text-xs">
          <div className={isWin ? "text-rm-status-safe" : isLoss ? "text-rm-red" : "text-rm-blue"}>
            {isWin ? "已胜" : isLoss ? "已负" : `预测胜率 ${(match.winProbability * 100).toFixed(0)}%`}
          </div>
          <div className="text-rm-metal-textFaint">{match.scoreline}</div>
        </div>
      </div>
    </div>
  );
}

export function TeamProfilePage({ encodedTeamKey }: { encodedTeamKey: string }) {
  const [profile, setProfile] = useState<TeamProfileResponse | null>(null);
  const [error, setError] = useState("");
  const teamKey = decodeURIComponent(encodedTeamKey);

  useEffect(() => {
    let canceled = false;
    getTeamProfile(teamKey, 20260414, "live")
      .then((payload) => {
        if (!canceled) setProfile(payload);
      })
      .catch((err) => {
        if (!canceled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      canceled = true;
    };
  }, [teamKey]);

  if (error) {
    return (
      <div className="mx-auto max-w-screen-xl px-4 py-8">
        <div className="border border-rm-red/30 bg-rm-red/5 p-4 font-mono text-sm text-rm-red">
          队伍档案加载失败：{error}
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex min-h-[55vh] flex-col items-center justify-center animate-pulse">
        <div className="mb-4 h-8 w-8 rounded-full border-4 border-rm-blue/30 border-t-rm-blue animate-spin" />
        <span className="font-mono text-xs tracking-widest text-rm-blue">加载队伍档案...</span>
      </div>
    );
  }

  const finalLabel = profile.finalRanking
    ? formatRankingResultLabel(profile.finalRanking.rank, profile.finalRanking.finalBucket, profile.finalRanking.advancement)
    : "暂无最终落位";
  const regionHref = buildTeamRegionHref(profile);

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-screen-xl space-y-6 px-4 py-8">
        <header className="border border-rm-metal-border bg-rm-metal-panel px-5 py-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="mb-2 font-mono text-[10px] tracking-[0.3em] text-rm-metal-textFaint">
                {profile.region.regionName} · 队伍档案
              </div>
              <h1 className="font-sans text-2xl font-black text-rm-metal-textLight">{profile.team.collegeName}</h1>
              <p className="mt-1 font-mono text-xs text-rm-metal-textMuted">{profile.team.teamName} · {profile.slot?.slot ?? "未落位"}</p>
            </div>
            <Link
              href={regionHref}
              className="border border-rm-blue/30 bg-rm-blue/10 px-4 py-2 text-center font-mono text-xs text-rm-blue transition-colors hover:border-rm-blue/70 hover:text-white"
            >
              回到赛区沙盘并高亮该队
            </Link>
          </div>
        </header>

        <SourceFreshnessStrip freshness={profile.sourceFreshness} />

        <section className="grid gap-3 md:grid-cols-4">
          <div className="border border-rm-metal-border bg-rm-metal-card px-4 py-3">
            <div className="font-mono text-[9px] tracking-widest text-rm-metal-textFaint">当前 Elo</div>
            <div className="font-mono text-xl font-bold text-rm-metal-textLight">{(profile.team.currentElo ?? profile.team.mu0).toFixed(1)}</div>
            <div className="font-mono text-xs text-rm-status-safe">{signed(profile.team.eloDeltaFromPreseason)}</div>
          </div>
          <div className="border border-rm-metal-border bg-rm-metal-card px-4 py-3">
            <div className="font-mono text-[9px] tracking-widest text-rm-metal-textFaint">国赛概率</div>
            <div className="font-mono text-xl font-bold text-rm-status-safe">{pct(profile.team.probabilities.national)}</div>
          </div>
          <div className="border border-rm-metal-border bg-rm-metal-card px-4 py-3">
            <div className="font-mono text-[9px] tracking-widest text-rm-metal-textFaint">复活赛概率</div>
            <div className="font-mono text-xl font-bold text-rm-status-warn">{pct(profile.team.probabilities.repechage)}</div>
          </div>
          <div className="border border-rm-metal-border bg-rm-metal-card px-4 py-3">
            <div className="font-mono text-[9px] tracking-widest text-rm-metal-textFaint">最终落位</div>
            <div className="font-mono text-sm font-bold text-rm-metal-textLight">{finalLabel}</div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="h-4 w-0.5 bg-rm-blue/70" />
              <h2 className="font-sans text-lg font-semibold text-rm-metal-textLight">赛程路径</h2>
            </div>
            <div className="space-y-2">
              {profile.matchPath.map((match) => (
                <MatchPathRow key={match.matchLabel} match={match} />
              ))}
              {profile.matchPath.length === 0 && (
                <div className="border border-rm-metal-border bg-rm-metal-panel px-4 py-4 font-mono text-xs text-rm-metal-textFaint">
                  暂无该队赛程路径。
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="h-4 w-0.5 bg-rm-status-warn/70" />
              <h2 className="font-sans text-lg font-semibold text-rm-metal-textLight">后续可能对手</h2>
            </div>
            <div className="space-y-2">
              {profile.upcomingMatches.slice(0, 6).map((match) => (
                <div key={match.matchLabel} className="border border-rm-metal-border bg-rm-metal-panel px-3 py-2">
                  <div className="font-sans text-sm font-semibold text-rm-metal-textLight">{match.opponent.collegeName}</div>
                  <div className="mt-1 font-mono text-[11px] text-rm-metal-textMuted">
                    {match.stageLabel} · 预测胜率 {(match.winProbability * 100).toFixed(0)}%
                  </div>
                </div>
              ))}
              {profile.upcomingMatches.length === 0 && (
                <div className="border border-rm-metal-border bg-rm-metal-panel px-4 py-4 font-mono text-xs text-rm-metal-textFaint">
                  暂无后续未赛对手。
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
