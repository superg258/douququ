"use client";

import type { CanvasConnector } from "@/lib/types";

function toneClass(connector: CanvasConnector) {
  const strong = connector.weight === "strong";
  switch (connector.tone) {
    case "amber":
      return strong
        ? "stroke-rm-result-winner drop-shadow-[0_0_7px_rgba(255,213,74,0.42)] opacity-85"
        : "stroke-rm-result-winner opacity-45";
    case "emerald":
      return strong
        ? "stroke-rm-status-safe drop-shadow-[0_0_7px_rgba(0,255,157,0.38)] opacity-80"
        : "stroke-rm-status-safe opacity-45";
    case "steel":
      return "stroke-rm-metal-border opacity-45";
    default:
      return strong ? "stroke-rm-blue opacity-70 drop-shadow-[0_0_6px_rgba(0,163,255,0.28)]" : "stroke-rm-metal-text opacity-35";
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

  // Merge connectors should explicitly converge to the target Y, otherwise
  // branches can look vertically offset from the destination card.
  if (connector.kind === "merge") {
    const spineTop = Math.min(branchY[0], connector.toY);
    const spineBottom = Math.max(branchY[branchY.length - 1], connector.toY);
    const segments: string[] = [];

    branchY.forEach((y) => {
      segments.push(`M ${connector.fromX} ${y} H ${viaX}`);
    });
    segments.push(`M ${viaX} ${spineTop} V ${spineBottom}`);
    segments.push(`M ${viaX} ${connector.toY} H ${connector.toX}`);

    return segments.join(" ");
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

export function CanvasConnectorView({
  connector,
  selectedTeamKey,
  highlightedTeamKey,
}: {
  connector: CanvasConnector;
  selectedTeamKey: string | null;
  highlightedTeamKey: string | null;
}) {
  const d = connector.kind !== "bracket" && connector.kind !== "merge" ? connectorPath(connector) : bracketPath(connector);
  const isSelected = connector.teamKey && connector.teamKey === selectedTeamKey;
  const isHighlighted = connector.teamKey && connector.teamKey === highlightedTeamKey;
  const strokeWidth = connector.weight === "strong" ? "stroke-[3px]" : "stroke-[2px]";
  const labelX = (connector.viaX ?? (connector.fromX + connector.toX) / 2) + 10;
  const labelToneClass =
    connector.tone === "amber"
      ? "fill-rm-result-winner"
      : connector.tone === "emerald"
        ? "fill-rm-status-safe"
        : connector.tone === "steel"
          ? "fill-rm-metal-text"
          : "fill-rm-blue";

  if (isSelected || isHighlighted) {
    return (
      <g>
        {/* Glow behind */}
        <path d={d} className="fill-none stroke-rm-blue opacity-30 stroke-[8px] blur-sm mix-blend-screen" />
        {/* Main path */}
        <path d={d} className="fill-none stroke-white opacity-100 stroke-[3px]" />
        {/* Energized dashes */}
        <path d={d} className="fill-none stroke-rm-blue opacity-100 stroke-[4px] stroke-dasharray-[10_20] animate-[dash_1s_linear_infinite]" />
      </g>
    );
  }

  return (
    <g>
      <path d={d} className={`fill-none transition-all ${strokeWidth} ${toneClass(connector)}`} />
      {connector.branchLabels?.map((label) => {
        const width = Math.max(74, label.text.length * 12 + 18);
        return (
          <g key={`${connector.id}:${label.text}:${label.y}`} transform={`translate(${labelX} ${label.y})`}>
            <rect
              x={0}
              y={-12}
              width={width}
              height={24}
              className="fill-[#05070c] stroke-rm-metal-border opacity-90"
              rx={0}
            />
            <text
              x={9}
              y={4}
              className={`${labelToneClass} font-mono`}
              style={{ fontSize: 11, fontWeight: 800 }}
            >
              {label.text}
            </text>
          </g>
        );
      })}
    </g>
  );
}
