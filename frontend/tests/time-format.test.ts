import { describe, expect, it } from "vitest";

import { formatShortDateTimeLabel } from "@/lib/time-format";

describe("formatShortDateTimeLabel", () => {
  it("formats timestamps in Beijing time with slash-separated month and day", () => {
    expect(formatShortDateTimeLabel("2026-05-11T08:24:00Z")).toBe("05/11 16:24");
  });

  it("returns a Chinese empty-data label for missing values", () => {
    expect(formatShortDateTimeLabel(null)).toBe("暂无数据");
  });
});
