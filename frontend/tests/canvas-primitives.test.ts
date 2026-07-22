import { describe, expect, it } from "vitest";

import {
  CANVAS_LAYOUT,
  connectCardGroupToCard,
  connectCardGroupToCards,
  connectHeaderBands,
  createMatchCanvasCard,
  createTeamCanvasCard,
} from "@/lib/canvas-primitives";
import {
  officialPlaceholderSwissBucket,
  SWISS_STAGE_COLUMNS,
  SWISS_STAGE_FLOWS,
} from "@/lib/swiss-canvas";
import type { MatchRow, TeamRef, WorkspaceStageHeader } from "@/lib/types";

function team(teamKey: string, collegeName: string): TeamRef {
  return { teamKey, collegeName, teamName: `${collegeName}战队`, slot: teamKey.toUpperCase() };
}

function match(overrides: Partial<MatchRow> = {}): MatchRow {
  return {
    matchLabel: "M-1",
    stage: "swiss",
    stageOrder: 1,
    roundNumber: 1,
    groupName: "A",
    bestOf: 3,
    isRealResult: false,
    isConfirmedMatchup: false,
    scoreline: "0:0",
    pGameRed: 0.5,
    pGameBlue: 0.5,
    pSeriesRed: 0.5,
    pSeriesBlue: 0.5,
    deltaH2H: 0,
    confidenceLabel: "balanced",
    winnerNext: "",
    loserNext: "",
    redTeam: team("", "A1"),
    blueTeam: team("", "A2"),
    winnerTeamKey: "",
    loserTeamKey: "",
    ...overrides,
  };
}

function header(id: string, x: number, y: number): WorkspaceStageHeader {
  return { id, x, y, width: 400, title: id };
}

describe("canvas primitives", () => {
  it("creates the shared match-card shape without making empty official slots winners", () => {
    const card = createMatchCanvasCard(match(), {
      x: 64,
      y: 120,
      tone: "cyan",
      orderLabel: "1",
      displayLabel: "第 1 场",
      metaLabel: "瑞士轮 / BO3",
    });

    expect(card).toMatchObject({
      width: CANVAS_LAYOUT.match.width,
      height: CANVAS_LAYOUT.match.height,
      redSide: { score: "0", isWinner: false },
      blueSide: { score: "0", isWinner: false },
    });
  });

  it("keeps shared team-card outcome and simulation bindings intact", () => {
    const card = createTeamCanvasCard({
      id: "outcome-1",
      teamKey: "",
      collegeName: "待确认",
      teamName: "学校队伍待确认",
      x: 510,
      y: 120,
      variant: "summary",
      outcome: "qualified",
      simulationKey: { kind: "matchOutcome", matchNumber: 1, outcome: "winner" },
    });

    expect(card).toMatchObject({
      kind: "team",
      tone: "steel",
      width: CANVAS_LAYOUT.team.width,
      height: CANVAS_LAYOUT.team.height,
      outcome: "qualified",
      simulationKey: { kind: "matchOutcome", matchNumber: 1, outcome: "winner" },
    });
  });

  it("uses one null-safe geometry contract for header, merge, and merge-split connectors", () => {
    expect(connectHeaderBands([], [header("target", 510, 120)], "empty")).toBeNull();

    const headerConnector = connectHeaderBands(
      [header("source", 64, 120)],
      [header("winner", 510, 60), header("loser", 510, 300)],
      "header-flow",
      "amber",
      ["胜者", "负者"],
    );
    expect(headerConnector).toMatchObject({
      kind: "bracket",
      tone: "amber",
      weight: "strong",
      branchY: [84, 324],
      branchLabels: [{ text: "胜者", y: 48 }, { text: "负者", y: 288 }],
    });

    const source = createTeamCanvasCard({ id: "source", teamKey: "a", collegeName: "甲校", teamName: "甲队", x: 64, y: 120 });
    const target = createTeamCanvasCard({ id: "target", teamKey: "b", collegeName: "乙校", teamName: "乙队", x: 510, y: 220 });
    const sibling = createTeamCanvasCard({ id: "sibling", teamKey: "c", collegeName: "丙校", teamName: "丙队", x: 510, y: 420 });

    expect(connectCardGroupToCard([source, undefined], target, "merge")?.kind).toBe("merge");
    expect(connectCardGroupToCards([source], [target, sibling], "pool")).toMatchObject({
      kind: "merge-split",
      branchY: [174],
      targetBranchY: [274, 474],
    });
    expect(connectCardGroupToCards([source], [], "empty-pool")).toBeNull();
  });
});

describe("shared Swiss canvas skeleton", () => {
  it("maps every official placeholder round and retains all nine record-pool flows", () => {
    expect(officialPlaceholderSwissBucket(1, 7)).toBe("0-0");
    expect(officialPlaceholderSwissBucket(4, 5)).toBe("1-2");
    expect(officialPlaceholderSwissBucket(5, 2)).toBe("2-2");
    expect(officialPlaceholderSwissBucket(5, 3)).toBeNull();
    expect(SWISS_STAGE_COLUMNS).toHaveLength(6);
    expect(SWISS_STAGE_FLOWS).toHaveLength(9);
    expect(SWISS_STAGE_FLOWS.map((flow) => flow.sourceId)).toContain("r5-2-2");
  });
});
