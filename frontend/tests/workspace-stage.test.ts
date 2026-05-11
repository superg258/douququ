import { describe, expect, it } from "vitest";

import {
  getWorkspaceStageFullscreenClasses,
  shouldAutoPanToHighlightedTeam,
  shouldBlockCanvasPanTarget,
} from "@/components/workspace-stage";

function fakeTarget(matches: string[]) {
  return {
    closest(selector: string) {
      const selectors = selector.split(",").map((item) => item.trim());
      return selectors.some((item) => matches.includes(item)) ? this : null;
    },
  };
}

describe("WorkspaceStageView pointer handling", () => {
  it("allows drags that begin on selectable cards to pan the canvas", () => {
    expect(shouldBlockCanvasPanTarget(fakeTarget(["button"]))).toBe(false);
    expect(shouldBlockCanvasPanTarget(fakeTarget(["[role='button']"]))).toBe(false);
  });

  it("keeps form controls and links from starting canvas pan", () => {
    expect(shouldBlockCanvasPanTarget(fakeTarget(["input"]))).toBe(true);
    expect(shouldBlockCanvasPanTarget(fakeTarget(["a"]))).toBe(true);
  });
});

describe("WorkspaceStageView inspector rail layout", () => {
  it("reserves desktop inline space for the inspector while fullscreen canvas is active", () => {
    const classes = getWorkspaceStageFullscreenClasses(true, true);

    expect(classes).toContain("fixed inset-0");
    expect(classes).toContain("md:right-80");
    expect(classes).not.toContain("w-screen");
  });

  it("does not reserve inspector space when the inspector is closed or fullscreen is inactive", () => {
    expect(getWorkspaceStageFullscreenClasses(true, false)).not.toContain("md:right-80");
    expect(getWorkspaceStageFullscreenClasses(false, true)).toBe("");
  });
});

describe("WorkspaceStageView highlight auto-pan", () => {
  it("does not pan to a stale URL highlight while a local team click is catching up", () => {
    expect(shouldAutoPanToHighlightedTeam({
      highlightedTeamKey: "team-a",
      selectedTeamKey: "team-b",
      suppressAutoPanTeamKey: "team-b",
    })).toBe(false);
  });

  it("still allows external highlighted deep links to auto-pan", () => {
    expect(shouldAutoPanToHighlightedTeam({
      highlightedTeamKey: "team-c",
      selectedTeamKey: "team-c",
      suppressAutoPanTeamKey: "team-b",
    })).toBe(true);
  });
});
