import { REGION_ORDER } from "@/lib/region-config";
import type { LiveStateResponse } from "@/lib/types";

export function mergeRegionLiveStates(
  current: LiveStateResponse[],
  updates: LiveStateResponse[],
) {
  const byRegion = new Map(current.map((state) => [state.regionSlug, state]));
  for (const state of updates) {
    byRegion.set(state.regionSlug, state);
  }
  return REGION_ORDER
    .map((regionSlug) => byRegion.get(regionSlug))
    .filter((state): state is LiveStateResponse => state !== undefined);
}
