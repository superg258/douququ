import { describe, expect, it } from "vitest";

import {
  buildForecastHref,
  forecastEventsResourceIdentity,
  shouldShowForecastLoadError,
} from "@/lib/forecast-routing";

describe("forecast routing", () => {
  it("preserves an explicit simulation mode and seed when switching events", () => {
    expect(buildForecastHref("/forecast-center", {
      event: "nationals",
      mode: "sim",
      stage: "swiss-a",
      seed: 20260414,
    })).toBe("/forecast-center?event=nationals&mode=sim&stage=swiss-a&seed=20260414");
  });

  it("does not leak a simulation seed into an explicit live deep link", () => {
    expect(buildForecastHref("/forecast-center", {
      event: "repechage",
      mode: "live",
      stage: "qualification",
      seed: 20260414,
    })).toBe("/forecast-center?event=repechage&mode=live&stage=qualification");
  });

  it("changes the full-load identity for mode, event, and retry transitions", () => {
    const initial = forecastEventsResourceIdentity("repechage", "sim", 0);
    expect(forecastEventsResourceIdentity("repechage", "live", 0)).not.toBe(initial);
    expect(forecastEventsResourceIdentity("nationals", "sim", 0)).not.toBe(initial);
    expect(forecastEventsResourceIdentity("repechage", "sim", 1)).not.toBe(initial);
  });

  it("surfaces a failed mode transition instead of leaving the old mode behind a loader", () => {
    expect(shouldShowForecastLoadError({
      hasError: true,
      hasCurrentEvent: true,
      loadedMode: "sim",
      requestedMode: "live",
    })).toBe(true);
    expect(shouldShowForecastLoadError({
      hasError: true,
      hasCurrentEvent: true,
      loadedMode: "live",
      requestedMode: "live",
    })).toBe(false);
  });
});
