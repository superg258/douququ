import { buildRegionHref } from "@/lib/region-config";
import type { TeamProfileResponse } from "@/lib/types";

export function buildTeamHref(teamKey: string) {
  return `/teams/${encodeURIComponent(teamKey)}`;
}

export function buildTeamRegionHref(profile: TeamProfileResponse) {
  const { regionSlug, view, seed, mode, highlightTeamKey } = profile.regionEntry;
  return buildRegionHref(regionSlug, view, {
    seed,
    mode,
    highlight: highlightTeamKey,
  });
}
