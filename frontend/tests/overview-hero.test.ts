import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OverviewHero } from "@/components/overview-hero";

describe("OverviewHero", () => {
  it("labels service response time separately from model artifact time", () => {
    const html = renderToStaticMarkup(
      createElement(OverviewHero, {
        serviceGeneratedLabel: "05/11 16:24",
        modelGeneratedLabel: "05/06 14:10",
        nextMatchHref: "/regions/south_region",
        ctaLabel: "进入实时赛程",
      })
    );

    expect(html).toContain("系统运行正常");
    expect(html).toContain("服务响应 05/11 16:24");
    expect(html).toContain("模型产物 05/06 14:10");
  });
});
