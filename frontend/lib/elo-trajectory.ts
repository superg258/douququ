import type { LiveStateLedgerRow, OverviewResponse } from "@/lib/types";

/**
 * 构建整个 2026 赛季的完整 Elo 轨迹。
 *
 * 合并三个数据源：
 * 1. 季前 Elo（overview.regions[].teams[].preseasonElo / mu0）
 * 2. 区域赛逐场记录（live-state matchLedger，按 matchDate 排序）
 * 3. 决赛阶段真实赛果（simulation.eloTrajectoryByTeamKey）
 *
 * 返回的轨迹按时间顺序排列，连续相同值已去重。
 * 调用方通过 downsampleTrajectory 采样到 6 个点即可用于 EloSparkline。
 */
export function buildFullSeasonTrajectories(
  overview: OverviewResponse,
  regionLedgers: LiveStateLedgerRow[][],
  finalsTrajectories: Record<string, number[]>,
): Record<string, number[]> {
  // ── 季前 Elo 查找表 ──
  const preseasonByTeamKey = new Map<string, number>();
  for (const region of overview.regions) {
    for (const team of region.teams) {
      const key = team.teamKey.trim();
      if (!key) continue;
      const preseason = team.preseasonElo ?? team.mu0;
      if (preseason != null) preseasonByTeamKey.set(key, preseason);
    }
  }

  // ── 区域赛 Elo 记录，按比赛时间升序 ──
  const regionalByTeamKey = new Map<string, number[]>();
  const allLedgerRows = regionLedgers
    .flat()
    .sort((a, b) => a.matchDate.localeCompare(b.matchDate));
  for (const row of allLedgerRows) {
    const key = row.teamKey.trim();
    if (!key) continue;
    const points = regionalByTeamKey.get(key) ?? [];
    const last = points[points.length - 1];
    // 连续相同值去重
    if (last === undefined || Math.abs(last - row.publishedRatingAfterMatch) > 0.005) {
      points.push(row.publishedRatingAfterMatch);
    }
    regionalByTeamKey.set(key, points);
  }

  // ── 合并：季前 → 区域赛 → 决赛 ──
  const allTeamKeys = new Set([
    ...preseasonByTeamKey.keys(),
    ...regionalByTeamKey.keys(),
    ...Object.keys(finalsTrajectories),
  ]);

  const result: Record<string, number[]> = {};
  for (const teamKey of allTeamKeys) {
    const full: number[] = [];
    const preseason = preseasonByTeamKey.get(teamKey);

    // 起点：季前 Elo
    if (preseason != null) full.push(preseason);

    // 区域赛逐场变化
    for (const elo of regionalByTeamKey.get(teamKey) ?? []) {
      if (full.length === 0 || Math.abs(elo - full[full.length - 1]) > 0.005) {
        full.push(elo);
      }
    }

    // 决赛阶段变化
    // 模拟轨迹结构: [preseasonElo, eventEntryElo, result1, result2, ...]
    // 跳过首点（preseasonElo 已由季前 Elo 覆盖），其余点去重追加
    const finals = finalsTrajectories[teamKey];
    if (finals) {
      for (let i = 1; i < finals.length; i++) {
        const elo = finals[i];
        if (full.length === 0 || Math.abs(elo - full[full.length - 1]) > 0.005) {
          full.push(elo);
        }
      }
    }

    if (full.length >= 2) result[teamKey] = full;
  }

  return result;
}
