import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  CompetitionSelector,
  isRegionCompetition,
} from "@/components/competition-selector";

describe("CompetitionSelector", () => {
  it("keeps all three regions alongside repechage and nationals", () => {
    const markup = renderToStaticMarkup(createElement(CompetitionSelector, {
      value: "nationals",
      onChange: () => undefined,
    }));

    expect(markup).toContain("南部赛区");
    expect(markup).toContain("东部赛区");
    expect(markup).toContain("北部赛区");
    expect(markup).toContain("复活赛");
    expect(markup).toContain("全国总决赛");
  });

  it("distinguishes regional workspaces from later events", () => {
    expect(isRegionCompetition("south_region")).toBe(true);
    expect(isRegionCompetition("east_region")).toBe(true);
    expect(isRegionCompetition("north_region")).toBe(true);
    expect(isRegionCompetition("repechage")).toBe(false);
    expect(isRegionCompetition("nationals")).toBe(false);
  });
});
