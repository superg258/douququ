import { buildRegionHref } from "@/lib/region-config";
import type { TeamProfileResponse } from "@/lib/types";

type TeamProfileSubtitleSlot = {
  slot?: string | null;
} | null;

export function buildTeamHref(teamKey: string) {
  return `/teams/${encodeURIComponent(teamKey)}`;
}

export function formatTeamProfileSubtitle(teamName: string, slot: TeamProfileSubtitleSlot) {
  return slot?.slot ? `${teamName} · ${slot.slot}` : teamName;
}

export function buildTeamRegionHref(profile: TeamProfileResponse) {
  const { regionSlug, view, seed, mode, highlightTeamKey } = profile.regionEntry;
  return buildRegionHref(regionSlug, view, {
    seed,
    mode,
    highlight: highlightTeamKey,
  });
}
