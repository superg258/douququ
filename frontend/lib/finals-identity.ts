import type { FinalEventParticipant } from "@/lib/types";

/**
 * 在参赛名单中按身份匹配查找队伍。
 *
 * 匹配优先级：
 * 1. teamKey 精确匹配（官方数据源的标准 key）
 * 2. collegeName + teamName 身份匹配（跨数据源的可靠锚点）
 *
 * 当 matchTeamName 为空时，仅按 collegeName 匹配（宽松回退），适配部分
 * 数据源只提供学校名而不提供具体队名的情况。
 *
 * 此函数是 officialTeamRef（finals-match-adapter）与
 * officialParticipantForSide（finals-simulation）的统一查找入口，
 * 避免身份匹配逻辑分散重复。
 */
export function findParticipantForMatchSide(
  participants: readonly FinalEventParticipant[],
  matchTeamKey: string,
  matchCollegeName: string,
  matchTeamName: string,
): FinalEventParticipant | null {
  if (!matchTeamKey && !matchCollegeName) return null;

  return participants.find((candidate) => (
    (matchTeamKey && candidate.teamKey === matchTeamKey)
    || (matchCollegeName && candidate.collegeName === matchCollegeName
        && (!matchTeamName || candidate.teamName === matchTeamName))
  )) ?? null;
}
