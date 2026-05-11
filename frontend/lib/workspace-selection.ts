import type { InspectorSelection } from "@/lib/types";

export type InspectorPanelState = {
  selection: InspectorSelection | null;
  inspectorOpen: boolean;
};

export function resolveHighlightSelectionState(
  state: InspectorPanelState,
  highlightedTeamKey: string | null
): InspectorPanelState {
  if (highlightedTeamKey) {
    const selection: InspectorSelection =
      state.selection?.kind === "team" && state.selection.teamKey === highlightedTeamKey
        ? state.selection
        : { kind: "team", teamKey: highlightedTeamKey };

    return { selection, inspectorOpen: true };
  }

  if (state.selection?.kind === "team") {
    return { selection: null, inspectorOpen: false };
  }

  return state;
}
