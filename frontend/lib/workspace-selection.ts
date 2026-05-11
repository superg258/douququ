import type { InspectorSelection, MatchRow, OverviewTeam, RegionSlug, SlotRow, TeamRef } from "@/lib/types";

export type TeamDrawerMode = "sim" | "live";

export type InspectorPanelState = {
  selection: InspectorSelection | null;
  inspectorOpen: boolean;
};

export type WorkspaceInspectorTeam = {
  teamKey: string;
  collegeName: string;
  teamName: string;
  slot?: string | null;
  mu0?: number;
  currentElo?: number;
  preseasonElo?: number;
  eloDeltaFromPreseason?: number;
  sigma0?: number;
  eloGlobalRank?: number;
  eloRegionRank?: number;
  seedTier?: string;
  seedRankInRegion?: number;
  regionSlug?: RegionSlug;
  regionName?: string;
  probabilities: OverviewTeam["probabilities"] | null;
};

export function resolveHighlightSelectionState(
  state: InspectorPanelState,
  highlightedTeamKey: string | null
): InspectorPanelState {
  if (highlightedTeamKey) {
    const selection: InspectorSelection =
      state.selection?.kind === "team" && state.selection.teamKey === highlightedTeamKey
        ? state.selection
        : { kind: "team", teamKey: highlightedTeamKey };

    return { selection, inspectorOpen: true };
  }

  if (state.selection?.kind === "team") {
    return { selection: null, inspectorOpen: false };
  }

  return state;
}

export function shouldRenderTeamInspector<T>(
  selection: InspectorSelection | null,
  selectedTeam: T | null | undefined
): selectedTeam is T {
  return selection?.kind === "team" && Boolean(selectedTeam);
}

export function shouldShowTeamDrawerMatch(
  match: Pick<MatchRow, "isRealResult" | "isConfirmedMatchup" | "officialMatchId" | "plannedStartAt">,
  mode: TeamDrawerMode
) {
  if (mode === "sim") return true;
  if (match.isRealResult) return true;
  if (match.isConfirmedMatchup === false) return false;
  return Boolean(match.officialMatchId || match.plannedStartAt);
}

export function isOfficialPlaceholderMatch(
  match: Pick<MatchRow, "isRealResult" | "isConfirmedMatchup" | "officialMatchId" | "redTeam" | "blueTeam">,
  mode: TeamDrawerMode
) {
  const hasResolvedTeams = Boolean(match.redTeam.teamKey && match.blueTeam.teamKey);
  return mode === "live" && !match.isRealResult && Boolean(match.officialMatchId) && match.isConfirmedMatchup === false && !hasResolvedTeams;
}

export function filterTeamDrawerMatches<T extends Pick<MatchRow, "isRealResult" | "isConfirmedMatchup" | "officialMatchId" | "plannedStartAt">>(
  matches: T[],
  mode: TeamDrawerMode
) {
  return matches.filter((match) => shouldShowTeamDrawerMatch(match, mode));
}

function fromOverviewTeam(team: OverviewTeam): WorkspaceInspectorTeam {
  return { ...team, probabilities: team.probabilities };
}

function fromSlotRow(slot: SlotRow, regionSlug: RegionSlug, regionName: string): WorkspaceInspectorTeam {
  return {
    ...slot,
    regionSlug,
    regionName,
    probabilities: null,
  };
}

function fromTeamRef(ref: TeamRef, regionSlug: RegionSlug, regionName: string): WorkspaceInspectorTeam {
  return {
    teamKey: ref.teamKey,
    collegeName: ref.collegeName,
    teamName: ref.teamName,
    slot: ref.slot ?? null,
    regionSlug,
    regionName,
    probabilities: null,
  };
}

export function resolveWorkspaceInspectorTeam({
  selectedTeamKey,
  allTeams,
  slots,
  matches,
  regionSlug,
  regionName,
}: {
  selectedTeamKey: string | null;
  allTeams: OverviewTeam[];
  slots: SlotRow[];
  matches: MatchRow[];
  regionSlug: RegionSlug;
  regionName: string;
}): WorkspaceInspectorTeam | null {
  if (!selectedTeamKey) return null;

  const overviewTeam = allTeams.find((team) => team.teamKey === selectedTeamKey);
  if (overviewTeam) return fromOverviewTeam(overviewTeam);

  const slotTeam = slots.find((team) => team.teamKey === selectedTeamKey);
  if (slotTeam) return fromSlotRow(slotTeam, regionSlug, regionName);

  for (const match of matches) {
    if (match.redTeam.teamKey === selectedTeamKey) return fromTeamRef(match.redTeam, regionSlug, regionName);
    if (match.blueTeam.teamKey === selectedTeamKey) return fromTeamRef(match.blueTeam, regionSlug, regionName);
  }

  return null;
}
