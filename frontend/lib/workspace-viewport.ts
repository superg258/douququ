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

const INTERACTIVE_MIN_SCALE = 0.1;

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

function desktopTargetScale(stage: WorkspaceStage, width: number, height: number, fittedScale: number, gutterX: number, gutterY: number) {
  const widthScale = Math.min((width - gutterX * 2) / stage.width, 1);
  const projectedHeight = stage.height * widthScale + gutterY * 2;
  const overflowY = projectedHeight - height;

  if (overflowY > 0 && overflowY <= height * 0.14) {
    return Math.max(fittedScale, widthScale);
  }

  return fittedScale;
}

function viewportBounds(stage: WorkspaceStage, frame: FrameSize, scale: number) {
  const stageWidth = stage.width * scale;
  const stageHeight = stage.height * scale;
  const minVisibleX = Math.min(72, frame.width * 0.24);
  const minVisibleY = Math.min(120, frame.height * 0.18);
  const maxY = Math.min(44, frame.height * 0.06);

  const xBounds = stageWidth <= frame.width
    ? {
        min: minVisibleX - stageWidth,
        max: frame.width - minVisibleX,
      }
    : {
        min: frame.width - stageWidth - minVisibleX,
        max: minVisibleX,
      };

  const yBounds = stageHeight <= frame.height
    ? {
        min: maxY - stageHeight,
        max: frame.height - minVisibleY,
      }
    : {
        min: frame.height - stageHeight - minVisibleY,
        max: maxY,
      };

  return {
    minX: Math.min(xBounds.min, xBounds.max),
    maxX: xBounds.max,
    minY: Math.min(yBounds.min, yBounds.max),
    maxY: yBounds.max,
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

export function scaleViewportAroundFramePoint(
  stage: WorkspaceStage,
  frame: FrameSize,
  viewport: ViewportState,
  frameX: number,
  frameY: number,
  nextScale: number
): ViewportState {
  const scale = clamp(nextScale, INTERACTIVE_MIN_SCALE, 2);
  const worldX = (frameX - viewport.x) / viewport.scale;
  const worldY = (frameY - viewport.y) / viewport.scale;

  return clampViewportPosition(stage, frame, {
    scale,
    x: frameX - worldX * scale,
    y: frameY - worldY * scale,
  });
}

export function fitWorkspaceViewport(stage: WorkspaceStage, width: number, height: number): ViewportState {
  const requestedPaddingX = stage.viewport?.paddingX ?? 72;
  const requestedPaddingY = stage.viewport?.paddingY ?? 72;
  const gutterX = clamp(Math.min(requestedPaddingX, width * 0.045), 18, 36);
  const gutterY = clamp(Math.min(requestedPaddingY, height * 0.055), 18, 34);
  const fittedScale = Math.min((width - gutterX * 2) / stage.width, (height - gutterY * 2) / stage.height, 1);
  const desktopMinScale = stage.viewport?.minScale ?? 0.56;
  const desktopScale = desktopTargetScale(stage, width, height, fittedScale, gutterX, gutterY);
  const nonClippingDesktopMinScale = Math.min(desktopMinScale, (width - gutterX * 2) / stage.width);
  const minScale = width < 768
    ? Math.max(mobileMinScaleForStage(stage), Math.min(desktopMinScale, 0.5))
    : nonClippingDesktopMinScale;
  const targetScale = width < 768 ? fittedScale : desktopScale;
  const scale = clamp(Math.max(targetScale, minScale), minScale, 1);
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
