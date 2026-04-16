"use client";

import type { CanvasConnector } from "@/lib/types";

function toneClass(tone: CanvasConnector["tone"]) {
  switch (tone) {
    case "amber":
      return "canvas-connector tone-amber";
    case "emerald":
      return "canvas-connector tone-emerald";
    case "steel":
      return "canvas-connector tone-steel";
    default:
      return "canvas-connector tone-cyan";
  }
}

function connectorPath(connector: CanvasConnector) {
  const horizontalGap = Math.max(84, Math.abs(connector.toX - connector.fromX) * 0.45);
  const control1X = connector.fromX + horizontalGap;
  const control2X = connector.toX - horizontalGap;
  return `M ${connector.fromX} ${connector.fromY} C ${control1X} ${connector.fromY}, ${control2X} ${connector.toY}, ${connector.toX} ${connector.toY}`;
}

function bracketPath(connector: CanvasConnector) {
  const viaX = connector.viaX ?? connector.fromX + Math.max(28, (connector.toX - connector.fromX) * 0.45);
  const branchY = (connector.branchY ?? []).slice().sort((left, right) => left - right);
  if (!branchY.length) {
    return connectorPath(connector);
  }

  const segments = [`M ${connector.fromX} ${connector.fromY} H ${viaX}`];
  const spineTop = Math.min(connector.fromY, branchY[0]);
  const spineBottom = Math.max(connector.fromY, branchY[branchY.length - 1]);
  segments.push(`M ${viaX} ${spineTop} V ${spineBottom}`);
  branchY.forEach((y) => {
    segments.push(`M ${viaX} ${y} H ${connector.toX}`);
  });
  return segments.join(" ");
}

function mergePath(connector: CanvasConnector) {
  const viaX = connector.viaX ?? connector.fromX + Math.max(28, (connector.toX - connector.fromX) * 0.45);
  const branchY = (connector.branchY ?? []).slice().sort((left, right) => left - right);
  if (!branchY.length) {
    return connectorPath(connector);
  }

  const spineTop = Math.min(connector.toY, branchY[0]);
  const spineBottom = Math.max(connector.toY, branchY[branchY.length - 1]);
  const segments = branchY.map((y) => `M ${connector.fromX} ${y} H ${viaX}`);
  segments.push(`M ${viaX} ${spineTop} V ${spineBottom}`);
  segments.push(`M ${viaX} ${connector.toY} H ${connector.toX}`);
  return segments.join(" ");
}

export function CanvasConnectorLine({ connector }: { connector: CanvasConnector }) {
  const isBracket = connector.kind === "bracket";
  const isMerge = connector.kind === "merge";
  return (
    <path
      className={toneClass(connector.tone)}
      d={isMerge ? mergePath(connector) : isBracket ? bracketPath(connector) : connectorPath(connector)}
      strokeWidth={connector.weight === "strong" ? 3 : 2}
      markerEnd={isBracket || isMerge ? undefined : "url(#workspace-arrow)"}
    />
  );
}
