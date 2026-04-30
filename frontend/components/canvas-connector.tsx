"use client";

import type { CanvasConnector } from "@/lib/types";

function toneClass(connector: CanvasConnector) {
  const strong = connector.weight === "strong";
  switch (connector.tone) {
    case "amber":
      return strong
        ? "stroke-rm-result-winner opacity-100"
        : "stroke-rm-result-winner opacity-30";
    case "emerald":
      return strong
        ? "stroke-rm-status-safe opacity-100"
        : "stroke-rm-status-safe opacity-30";
    case "steel":
      return "stroke-white/15 opacity-25";
    default:
      return strong ? "stroke-rm-blue opacity-100" : "stroke-rm-metal-text opacity-25";
  }
}

function connectorPath(connector: CanvasConnector) {
  const baseGap = Math.max(96, Math.abs(connector.toX - connector.fromX) * 0.38);
  const control1X = connector.fromX + baseGap * 0.85;
  const control2X = connector.toX - baseGap * 0.55;
  return `M ${connector.fromX} ${connector.fromY} C ${control1X} ${connector.fromY}, ${control2X} ${connector.toY}, ${connector.toX} ${connector.toY}`;
}

function bracketPath(connector: CanvasConnector) {
  const viaX = connector.viaX ?? connector.fromX + Math.max(32, (connector.toX - connector.fromX) * 0.42);
  const branchY = (connector.branchY ?? []).slice().sort((left, right) => left - right);
  if (!branchY.length) {
    return connectorPath(connector);
  }

  if (connector.kind === "merge") {
    const spineTop = Math.min(branchY[0], connector.toY);
    const spineBottom = Math.max(branchY[branchY.length - 1], connector.toY);
    const segments: string[] = [];

    branchY.forEach((y) => {
      segments.push(`M ${connector.fromX} ${y} Q ${viaX} ${y} ${viaX} ${y}`);
    });
    segments.push(`M ${viaX} ${spineTop} V ${spineBottom}`);
    const toMidY = (viaX + connector.toX) / 2;
    segments.push(`M ${viaX} ${connector.toY} Q ${toMidY} ${connector.toY} ${connector.toX} ${connector.toY}`);

    return segments.join(" ");
  }

  const segments = [`M ${connector.fromX} ${connector.fromY} H ${viaX}`];
  const spineTop = Math.min(connector.fromY, branchY[0]);
  const spineBottom = Math.max(connector.fromY, branchY[branchY.length - 1]);
  segments.push(`M ${viaX} ${spineTop} V ${spineBottom}`);
  branchY.forEach((y) => {
    const toMidX = (viaX + connector.toX) / 2;
    segments.push(`M ${viaX} ${y} Q ${toMidX} ${y} ${connector.toX} ${y}`);
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
  const strokeWidth = connector.weight === "strong" ? "stroke-[2.5px]" : "stroke-[1.5px]";
  const styleAttr = "stroke-linecap: round; stroke-linejoin: round";
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
    const isAmber = connector.tone === "amber";
    const clr = isAmber ? "stroke-rm-result-winner" : "stroke-rm-blue";
    return (
      <g>
        <path d={d} className={`fill-none ${clr} stroke-[2.5px]`} style={{ strokeLinecap: "round", strokeLinejoin: "round" }} />
      </g>
    );
  }

  return (
    <g>
      <path d={d} className={`fill-none transition-all ${strokeWidth} ${toneClass(connector)}`} style={{ strokeLinecap: "round", strokeLinejoin: "round" }} />
      {connector.branchLabels?.map((label) => {
        const width = Math.max(80, label.text.length * 12 + 22);
        return (
          <g key={`${connector.id}:${label.text}:${label.y}`} transform={`translate(${labelX} ${label.y})`}>
            <rect
              x={0}
              y={-12}
              width={width}
              height={24}
              className="fill-[#05070c]/90 stroke-rm-metal-border"
              rx={0}
              style={{ backdropFilter: "blur(2px)" }}
            />
            <text
              x={9}
              y={4}
              className={`${labelToneClass} font-mono`}
              style={{ fontSize: 12, fontWeight: 800 }}
            >
              {label.text}
            </text>
          </g>
        );
      })}
    </g>
  );
}
