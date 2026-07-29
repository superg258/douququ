import type {
  FinalEventSlug,
  FinalEventStageFilter,
} from "@/lib/types";

export type ForecastMode = "live" | "sim";

export function buildForecastHref(
  pathname: string,
  {
    event,
    mode,
    stage,
    seed,
  }: {
    event: FinalEventSlug;
    mode: ForecastMode;
    stage: FinalEventStageFilter;
    seed: number | null;
  },
) {
  const params = new URLSearchParams({ event, mode, stage });
  if (mode === "sim" && seed !== null) {
    params.set("seed", String(seed));
  }
  return `${pathname}?${params.toString()}`;
}

export function forecastEventsResourceIdentity(
  event: FinalEventSlug,
  mode: ForecastMode,
  reloadKey: number,
) {
  return `finals:${event}:${mode}:${reloadKey}`;
}

export function shouldShowForecastLoadError({
  hasError,
  hasCurrentEvent,
  loadedMode,
  requestedMode,
}: {
  hasError: boolean;
  hasCurrentEvent: boolean;
  loadedMode: ForecastMode | null;
  requestedMode: ForecastMode;
}) {
  return hasError && (!hasCurrentEvent || loadedMode !== requestedMode);
}
