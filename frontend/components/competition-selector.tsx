"use client";

import type { FinalEventSlug, RegionSlug } from "@/lib/types";

export type CompetitionId = RegionSlug | FinalEventSlug;

export const REGION_COMPETITIONS: Array<{ id: RegionSlug; label: string }> = [
  { id: "south_region", label: "南部赛区" },
  { id: "east_region", label: "东部赛区" },
  { id: "north_region", label: "北部赛区" },
];

export const FINAL_COMPETITIONS: Array<{ id: FinalEventSlug; label: string }> = [
  { id: "repechage", label: "复活赛" },
  { id: "nationals", label: "全国赛" },
];

export function isRegionCompetition(id: CompetitionId): id is RegionSlug {
  return id === "south_region" || id === "east_region" || id === "north_region";
}

export function CompetitionSelector({
  value,
  onChange,
}: {
  value: CompetitionId;
  onChange: (value: CompetitionId) => void;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as CompetitionId)}
      aria-label="赛事"
      className="shrink-0 border border-white/10 bg-rm-metal-dark/80 px-2.5 py-1.5 text-xs text-white focus:border-rm-blue focus:outline-none"
    >
      <optgroup label="区域赛">
        {REGION_COMPETITIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </optgroup>
      <optgroup label="后续赛事">
        {FINAL_COMPETITIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </optgroup>
    </select>
  );
}
