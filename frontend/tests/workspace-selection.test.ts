import { describe, expect, it } from "vitest";

import {
  filterTeamDrawerMatches,
  resolveHighlightSelectionState,
  resolveWorkspaceInspectorTeam,
  shouldRenderTeamInspector,
} from "@/lib/workspace-selection";
import type { InspectorSelection, MatchRow, OverviewTeam, SlotRow } from "@/lib/types";

describe("workspace inspector selection state", () => {
  it("keeps an active match selection when a stale team highlight is cleared", () => {
    const matchSelection: InspectorSelection = { kind: "match", matchLabel: "qualification-r1-1" };

    const next = resolveHighlightSelectionState(
      { selection: matchSelection, inspectorOpen: true },
      null
    );

    expect(next).toEqual({ selection: matchSelection, inspectorOpen: true });
  });

  it("closes a team selection when its URL highlight is cleared", () => {
    const next = resolveHighlightSelectionState(
      { selection: { kind: "team", teamKey: "team-a" }, inspectorOpen: true },
      null
    );

    expect(next).toEqual({ selection: null, inspectorOpen: false });
  });

  it("opens the inspector for a highlighted team deep link", () => {
    const next = resolveHighlightSelectionState(
      { selection: null, inspectorOpen: false },
      "team-a"
    );

    expect(next).toEqual({
      selection: { kind: "team", teamKey: "team-a" },
      inspectorOpen: true,
    });
  });

  it("renders team intelligence even when live final rankings are hidden", () => {
    const team = {
      teamKey: "south-team-a",
      collegeName: "南部测试大学",
      teamName: "南部战队",
    } as OverviewTeam;

    expect(shouldRenderTeamInspector({ kind: "team", teamKey: team.teamKey }, team)).toBe(true);
  });

  it("does not render team intelligence without a resolved overview team", () => {
    expect(shouldRenderTeamInspector({ kind: "team", teamKey: "missing-team" }, null)).toBe(false);
    expect(shouldRenderTeamInspector({ kind: "match", matchLabel: "south-r1-1" }, null)).toBe(false);
  });

  it("falls back to live slot assignments when the overview team is absent", () => {
    const slot = {
      teamKey: "official-only-team",
      collegeName: "实时落位大学",
      teamName: "实时战队",
      mu0: 1510,
      currentElo: 1530,
      eloGlobalRank: 88,
    } as SlotRow;

    const team = resolveWorkspaceInspectorTeam({
      selectedTeamKey: slot.teamKey,
      allTeams: [],
      slots: [slot],
      matches: [],
      regionSlug: "south_region",
      regionName: "南部赛区",
    });

    expect(team).toMatchObject({
      teamKey: slot.teamKey,
      collegeName: slot.collegeName,
      teamName: slot.teamName,
      currentElo: 1530,
      probabilities: null,
    });
  });

  it("falls back to a live match team ref when no overview or slot row exists", () => {
    const match = {
      redTeam: {
        teamKey: "match-only-team",
        collegeName: "赛程仅有大学",
        teamName: "赛程战队",
      },
      blueTeam: {
        teamKey: "opponent-team",
        collegeName: "对手大学",
        teamName: "对手战队",
      },
    } as MatchRow;

    const team = resolveWorkspaceInspectorTeam({
      selectedTeamKey: "match-only-team",
      allTeams: [],
      slots: [],
      matches: [match],
      regionSlug: "south_region",
      regionName: "南部赛区",
    });

    expect(team).toMatchObject({
      teamKey: "match-only-team",
      collegeName: "赛程仅有大学",
      teamName: "赛程战队",
      probabilities: null,
    });
  });

  it("keeps only actual results and confirmed scheduled matches in the live drawer path", () => {
    const completed = {
      matchLabel: "completed",
      isRealResult: true,
    } as MatchRow;
    const scheduledByOfficialId = {
      matchLabel: "scheduled-official",
      isRealResult: false,
      isConfirmedMatchup: true,
      officialMatchId: "30901",
    } as MatchRow;
    const scheduledByStartTime = {
      matchLabel: "scheduled-time",
      isRealResult: false,
      isConfirmedMatchup: true,
      plannedStartAt: "2026-05-13T08:10:00+08:00",
    } as MatchRow;
    const predictedOfficialShell = {
      matchLabel: "predicted-shell",
      isRealResult: false,
      isConfirmedMatchup: false,
      officialMatchId: "30902",
      plannedStartAt: "2026-05-13T09:10:00+08:00",
    } as MatchRow;
    const predictedOnly = {
      matchLabel: "predicted-only",
      isRealResult: false,
    } as MatchRow;

    expect(
      filterTeamDrawerMatches(
        [completed, scheduledByOfficialId, scheduledByStartTime, predictedOfficialShell, predictedOnly],
        "live"
      ).map((match) => match.matchLabel)
    ).toEqual(["completed", "scheduled-official", "scheduled-time"]);
  });

  it("keeps simulated path matches in simulation mode", () => {
    const predictedOnly = {
      matchLabel: "sim-predicted",
      isRealResult: false,
    } as MatchRow;

    expect(filterTeamDrawerMatches([predictedOnly], "sim")).toEqual([predictedOnly]);
  });
});
