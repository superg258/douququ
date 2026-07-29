import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OverviewHero } from "@/components/overview-hero";

describe("OverviewHero", () => {
  it("keeps the homepage focused on official finals content", () => {
    const html = renderToStaticMarkup(createElement(OverviewHero));

    expect(html).toContain("复活赛 · 全国赛 赛程与预测");
    expect(html).toContain("/forecast-center?event=repechage");
    expect(html).toContain("进入复活赛对阵图");
    expect(html).not.toContain("系统运行正常");
    expect(html).not.toContain("服务响应");
    expect(html).not.toContain("模型产物");
  });
});
