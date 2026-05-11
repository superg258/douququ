import { describe, expect, it } from "vitest";

import {
  clampViewportPosition,
  fitWorkspaceViewport,
  resizeWorkspaceViewport,
  scaleViewportAroundFramePoint,
} from "@/lib/workspace-viewport";
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

  it("uses more desktop width when the extra vertical overflow stays modest", () => {
    const playoffStage = makeStage("playoff", 1938, 1240, 0.74);

    const viewport = fitWorkspaceViewport(playoffStage, 1920, 1180);

    expect(viewport.scale).toBeGreaterThan(0.9);
  });

  it("backs off the desktop preferred scale so playoff brackets are not clipped horizontally on entry", () => {
    const playoffStage = makeStage("playoff", 2120, 1591, 0.76);

    const viewport = fitWorkspaceViewport(playoffStage, 1440, 914);

    expect(viewport.x).toBeGreaterThanOrEqual(0);
    expect(viewport.x + playoffStage.width * viewport.scale).toBeLessThanOrEqual(1440);
  });

  it("clamps panning so the stage cannot be dragged completely out of view", () => {
    const stage = makeStage("playoff", 1938, 1240, 0.74);

    const clamped = clampViewportPosition(stage, { width: 390, height: 844 }, { scale: 0.58, x: -5000, y: -5000 });

    expect(clamped.x).toBeGreaterThan(-900);
    expect(clamped.y).toBeGreaterThan(-700);
  });

  it("still allows panning when the scaled stage is narrower than the fullscreen frame", () => {
    const stage = makeStage("playoff", 1938, 1620, 0.74);

    const clamped = clampViewportPosition(stage, { width: 1914, height: 1182 }, { scale: 0.74, x: 320, y: 34 });

    expect(clamped.x).toBe(320);
  });

  it("keeps the pinch center anchored while scaling the viewport", () => {
    const stage = makeStage("playoff", 1938, 1240, 0.74);
    const current = { scale: 0.6, x: 24, y: 30 };

    const next = scaleViewportAroundFramePoint(stage, { width: 390, height: 844 }, current, 180, 260, 0.9);

    const currentWorldX = (180 - current.x) / current.scale;
    const currentWorldY = (260 - current.y) / current.scale;
    const nextWorldX = (180 - next.x) / next.scale;
    const nextWorldY = (260 - next.y) / next.scale;

    expect(next.scale).toBe(0.9);
    expect(Math.abs(nextWorldX - currentWorldX)).toBeLessThan(0.001);
    expect(Math.abs(nextWorldY - currentWorldY)).toBeLessThan(0.001);
  });

  it("allows desktop users to zoom out to 10 percent", () => {
    const stage = makeStage("playoff", 2120, 1591, 0.76);
    const current = { scale: 0.42, x: 24, y: 30 };

    const next = scaleViewportAroundFramePoint(stage, { width: 1440, height: 914 }, current, 720, 420, 0.01);

    expect(next.scale).toBe(0.1);
  });

  it("allows mobile users to zoom out to 10 percent", () => {
    const stage = makeStage("playoff", 1938, 1240, 0.74);
    const current = { scale: 0.42, x: 18, y: 34 };

    const next = scaleViewportAroundFramePoint(stage, { width: 390, height: 844 }, current, 180, 260, 0.01);

    expect(next.scale).toBe(0.1);
  });

  it("preserves the current pan and zoom when the drawer resizes the desktop frame", () => {
    const stage = makeStage("qualification", 2100, 1460, 0.72);
    const current = { scale: 0.82, x: -224, y: 34 };
    const nextFrame = { width: 1120, height: 814 };

    const next = resizeWorkspaceViewport(stage, nextFrame, current);

    expect(next.scale).toBe(current.scale);
    expect(next.x).toBe(current.x);
    expect(next.y).toBe(current.y);
  });
});
