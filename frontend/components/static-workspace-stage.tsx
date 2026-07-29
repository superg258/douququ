"use client";

import { CanvasCardView } from "@/components/canvas-card";
import { CanvasConnectorView } from "@/components/canvas-connector";
import type { WorkspaceStage } from "@/lib/types";
import { cn } from "@/lib/utils";

function headerToneClass(tone: WorkspaceStage["headers"][number]["tone"]) {
  switch (tone) {
    case "amber":
      return "border-l-4 border-rm-result-winner bg-rm-result-winner/10 text-rm-result-winner";
    case "emerald":
      return "border-l-4 border-rm-status-safe bg-rm-status-safe/10 text-rm-status-safe";
    case "steel":
      return "border-l-4 border-rm-metal-text bg-white/5 text-rm-metal-text";
    default:
      return "border-l-4 border-rm-blue bg-rm-blue/10 text-rm-blue";
  }
}

export function StaticWorkspaceStage({
  stage,
  mode,
  highlight,
}: {
  stage: WorkspaceStage;
  mode: "live" | "sim";
  highlight: string | null;
}) {
  return (
    <div
      className="canvas-grid relative overflow-hidden bg-rm-metal-canvas"
      style={{ width: stage.width, height: stage.height }}
    >
      {stage.headers.map((header) => (
        <div
          key={header.id}
          className={cn(
            "glass-panel absolute flex h-12 min-w-0 items-center justify-between gap-3 overflow-hidden border-y border-r border-y-white/10 border-r-white/10 px-3 py-2 font-mono clip-chamfer",
            headerToneClass(header.tone),
          )}
          style={{ left: header.x, top: header.y, width: header.width }}
        >
          <div className="min-w-0">
            <div className="truncate font-machine text-[16px] font-extrabold leading-none tracking-widest">
              {header.title}
            </div>
            {header.subtitle ? (
              <div className="mt-1 truncate text-[10px] font-semibold leading-none tracking-widest opacity-70">
                {header.subtitle}
              </div>
            ) : null}
          </div>
        </div>
      ))}
      <svg className="pointer-events-none absolute inset-0" width={stage.width} height={stage.height}>
        {stage.connectors.map((connector) => (
          <CanvasConnectorView
            key={connector.id}
            connector={connector}
            selectedTeamKey={highlight}
            highlightedTeamKey={highlight}
          />
        ))}
      </svg>
      {stage.cards.map((card) => (
        <CanvasCardView
          key={card.id}
          card={card}
          mode={mode}
          selectedTeamKey={highlight}
          highlightedTeamKey={highlight}
          selectedMatchLabel={null}
          hasActiveHighlight={Boolean(highlight)}
          onTeamSelect={() => {}}
          onMatchSelect={() => {}}
        />
      ))}
    </div>
  );
}
