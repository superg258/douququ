import { describe, expect, it } from "vitest";

import { clampViewportPosition, fitWorkspaceViewport } from "@/lib/workspace-viewport";
import type { WorkspaceStage } from "@/lib/types";

function makeStage(id: WorkspaceStage["id"], width: number, height: number, minScale?: number): WorkspaceStage {
  return {
    id,
    label: id,
    title: id,
    description: id,
    width,
    height,
    viewport: {
      align: "left",
      minScale,
      paddingX: 48,
      paddingY: 48,
    },
    headers: [],
    cards: [],
    connectors: [],
  };
}

describe("workspace-viewport", () => {
  it("keeps mobile playoff and qualification stages at a more readable minimum scale", () => {
    const playoffStage = makeStage("playoff", 1938, 1240, 0.74);
    const qualificationStage = makeStage("qualification", 2100, 1460, 0.72);

    const playoffViewport = fitWorkspaceViewport(playoffStage, 390, 844);
    const qualificationViewport = fitWorkspaceViewport(qualificationStage, 390, 844);

    expect(playoffViewport.scale).toBeGreaterThanOrEqual(0.52);
    expect(qualificationViewport.scale).toBeGreaterThanOrEqual(0.5);
  });

  it("allows final rankings to fit smaller on mobile than bracket-heavy views", () => {
    const rankingsStage = makeStage("final-rankings", 1842, 1120, 0.62);
    const viewport = fitWorkspaceViewport(rankingsStage, 390, 844);

    expect(viewport.scale).toBeGreaterThanOrEqual(0.44);
    expect(viewport.scale).toBeLessThan(0.52);
  });

  it("clamps panning so the stage cannot be dragged completely out of view", () => {
    const stage = makeStage("playoff", 1938, 1240, 0.74);

    const clamped = clampViewportPosition(stage, { width: 390, height: 844 }, { scale: 0.58, x: -5000, y: -5000 });

    expect(clamped.x).toBeGreaterThan(-900);
    expect(clamped.y).toBeGreaterThan(-600);
  });
});
