import { describe, expect, it } from "vitest";

import { resolveHighlightSelectionState } from "@/lib/workspace-selection";
import type { InspectorSelection } from "@/lib/types";

describe("workspace inspector selection state", () => {
  it("keeps an active match selection when a stale team highlight is cleared", () => {
    const matchSelection: InspectorSelection = { kind: "match", matchLabel: "qualification-r1-1" };

    const next = resolveHighlightSelectionState(
      { selection: matchSelection, inspectorOpen: true },
      null
    );

    expect(next).toEqual({ selection: matchSelection, inspectorOpen: true });
  });

  it("closes a team selection when its URL highlight is cleared", () => {
    const next = resolveHighlightSelectionState(
      { selection: { kind: "team", teamKey: "team-a" }, inspectorOpen: true },
      null
    );

    expect(next).toEqual({ selection: null, inspectorOpen: false });
  });

  it("opens the inspector for a highlighted team deep link", () => {
    const next = resolveHighlightSelectionState(
      { selection: null, inspectorOpen: false },
      "team-a"
    );

    expect(next).toEqual({
      selection: { kind: "team", teamKey: "team-a" },
      inspectorOpen: true,
    });
  });
});
