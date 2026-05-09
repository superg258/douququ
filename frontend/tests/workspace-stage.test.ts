import { describe, expect, it } from "vitest";

import { shouldBlockCanvasPanTarget } from "@/components/workspace-stage";

function fakeTarget(matches: string[]) {
  return {
    closest(selector: string) {
      const selectors = selector.split(",").map((item) => item.trim());
      return selectors.some((item) => matches.includes(item)) ? this : null;
    },
  };
}

describe("WorkspaceStageView pointer handling", () => {
  it("allows drags that begin on selectable cards to pan the canvas", () => {
    expect(shouldBlockCanvasPanTarget(fakeTarget(["button"]))).toBe(false);
    expect(shouldBlockCanvasPanTarget(fakeTarget(["[role='button']"]))).toBe(false);
  });

  it("keeps form controls and links from starting canvas pan", () => {
    expect(shouldBlockCanvasPanTarget(fakeTarget(["input"]))).toBe(true);
    expect(shouldBlockCanvasPanTarget(fakeTarget(["a"]))).toBe(true);
  });
});
