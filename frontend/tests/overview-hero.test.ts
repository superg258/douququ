import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OverviewHero } from "@/components/overview-hero";

describe("OverviewHero", () => {
  it("keeps the homepage focused on official finals content", () => {
    const html = renderToStaticMarkup(
      createElement(OverviewHero, {
        serviceGeneratedLabel: "官方赛程已接入",
        nextMatchHref: "/forecast-center?event=repechage&mode=live",
        ctaLabel: "查看复活赛赛程",
      })
    );

    expect(html).toContain("系统运行正常");
    expect(html).toContain("服务响应 官方赛程已接入");
    expect(html).toContain("复活赛 · 全国赛 赛程与预测");
    expect(html).not.toContain("模型产物");
  });
});
