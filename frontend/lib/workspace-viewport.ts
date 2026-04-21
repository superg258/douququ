import type { WorkspaceStage } from "@/lib/types";

export interface FrameSize {
  width: number;
  height: number;
}

export interface ViewportState {
  scale: number;
  x: number;
  y: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function mobileMinScaleForStage(stage: WorkspaceStage) {
  switch (stage.id) {
    case "playoff":
      return 0.52;
    case "qualification":
      return 0.5;
    case "swiss-a":
    case "swiss-b":
      return 0.48;
    case "final-rankings":
      return 0.44;
    default:
      return 0.46;
  }
}

function viewportBounds(stage: WorkspaceStage, frame: FrameSize, scale: number) {
  const stageWidth = stage.width * scale;
  const stageHeight = stage.height * scale;
  const minVisibleX = Math.min(72, frame.width * 0.24);
  const minVisibleY = Math.min(120, frame.height * 0.18);
  const minX = frame.width - stageWidth - minVisibleX;
  const maxX = minVisibleX;
  const minY = frame.height - stageHeight - minVisibleY;
  const maxY = Math.min(44, frame.height * 0.06);

  return {
    minX: Math.min(minX, maxX),
    maxX,
    minY: Math.min(minY, maxY),
    maxY,
  };
}

export function clampViewportPosition(stage: WorkspaceStage, frame: FrameSize, viewport: ViewportState): ViewportState {
  const bounds = viewportBounds(stage, frame, viewport.scale);
  return {
    ...viewport,
    x: clamp(viewport.x, bounds.minX, bounds.maxX),
    y: clamp(viewport.y, bounds.minY, bounds.maxY),
  };
}

export function fitWorkspaceViewport(stage: WorkspaceStage, width: number, height: number): ViewportState {
  const requestedPaddingX = stage.viewport?.paddingX ?? 72;
  const requestedPaddingY = stage.viewport?.paddingY ?? 72;
  const gutterX = clamp(Math.min(requestedPaddingX, width * 0.045), 18, 36);
  const gutterY = clamp(Math.min(requestedPaddingY, height * 0.055), 18, 34);
  const fittedScale = Math.min((width - gutterX * 2) / stage.width, (height - gutterY * 2) / stage.height, 1);
  const desktopMinScale = stage.viewport?.minScale ?? 0.56;
  const minScale = width < 768 ? Math.max(mobileMinScaleForStage(stage), Math.min(desktopMinScale, 0.5)) : desktopMinScale;
  const scale = clamp(Math.max(fittedScale, minScale), minScale, 1);
  const align = width < 768
    ? (stage.id === "final-rankings" ? "center" : "left")
    : (stage.viewport?.align ?? "center");

  const initialViewport = {
    scale,
    x: align === "left" ? gutterX : Math.max(gutterX, (width - stage.width * scale) / 2),
    y: Math.max(gutterY, (height - stage.height * scale) / 2),
  };

  return clampViewportPosition(stage, { width, height }, initialViewport);
}
