"use client";

import { WorkspaceStageContent } from "@/components/workspace-stage";
import type { WorkspaceStage } from "@/lib/types";

const ignoreSelection = () => {};

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
    <WorkspaceStageContent
      stage={stage}
      mode={mode}
      selectedTeamKey={highlight}
      highlightedTeamKey={highlight}
      selectedMatchLabel={null}
      onTeamSelect={ignoreSelection}
      onMatchSelect={ignoreSelection}
      className="relative overflow-hidden bg-rm-metal-canvas"
    />
  );
}
