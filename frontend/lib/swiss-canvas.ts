import type { CanvasTone } from "@/lib/types";

/** 16 队、五轮瑞士轮的共享画布骨架；区域赛与全国赛共用该赛制表示。 */
export type SwissBucketKey = `${number}-${number}`;

export type SwissSummaryId =
  | "qualified-3-0"
  | "qualified-3-1"
  | "qualified-3-2"
  | "eliminated-0-3"
  | "eliminated-1-3"
  | "eliminated-2-3";

export type SwissStageColumnId = "round1" | "round2" | "round3" | "round4-band" | "round5-band" | "final-band";

export type SwissStageSection =
  | {
      kind: "matches";
      id: string;
      round: number;
      bucket: SwissBucketKey;
      title: string;
      y: number;
      tone: CanvasTone;
    }
  | {
      kind: "summary";
      id: string;
      summaryId: SwissSummaryId;
      title: string;
      y: number;
      tone: CanvasTone;
    };

export const SWISS_STAGE_COLUMNS: Array<{ id: SwissStageColumnId; x: number; sections: SwissStageSection[] }> = [
  {
    id: "round1",
    x: 64,
    sections: [{ kind: "matches", id: "r1-0-0", round: 1, bucket: "0-0", title: "第 1 轮 · 0-0 组", y: 184, tone: "cyan" }],
  },
  {
    id: "round2",
    x: 510,
    sections: [
      { kind: "matches", id: "r2-1-0", round: 2, bucket: "1-0", title: "第 2 轮 · 1-0 组", y: 92, tone: "cyan" },
      { kind: "matches", id: "r2-0-1", round: 2, bucket: "0-1", title: "第 2 轮 · 0-1 组", y: 720, tone: "cyan" },
    ],
  },
  {
    id: "round3",
    x: 956,
    sections: [
      { kind: "matches", id: "r3-2-0", round: 3, bucket: "2-0", title: "第 3 轮 · 2-0 组", y: 44, tone: "cyan" },
      { kind: "matches", id: "r3-1-1", round: 3, bucket: "1-1", title: "第 3 轮 · 1-1 组", y: 480, tone: "cyan" },
      { kind: "matches", id: "r3-0-2", round: 3, bucket: "0-2", title: "第 3 轮 · 0-2 组", y: 1052, tone: "cyan" },
    ],
  },
  {
    id: "round4-band",
    x: 1402,
    sections: [
      { kind: "summary", id: "qualified-3-0", summaryId: "qualified-3-0", title: "3-0 晋级", y: 44, tone: "amber" },
      { kind: "matches", id: "r4-2-1", round: 4, bucket: "2-1", title: "第 4 轮 · 2-1 组", y: 340, tone: "cyan" },
      { kind: "matches", id: "r4-1-2", round: 4, bucket: "1-2", title: "第 4 轮 · 1-2 组", y: 790, tone: "cyan" },
      { kind: "summary", id: "eliminated-0-3", summaryId: "eliminated-0-3", title: "0-3 淘汰", y: 1250, tone: "steel" },
    ],
  },
  {
    id: "round5-band",
    x: 1848,
    sections: [
      { kind: "summary", id: "qualified-3-1", summaryId: "qualified-3-1", title: "3-1 晋级", y: 132, tone: "amber" },
      { kind: "matches", id: "r5-2-2", round: 5, bucket: "2-2", title: "第 5 轮 · 2-2 组", y: 560, tone: "cyan" },
      { kind: "summary", id: "eliminated-1-3", summaryId: "eliminated-1-3", title: "1-3 淘汰", y: 1038, tone: "steel" },
    ],
  },
  {
    id: "final-band",
    x: 2294,
    sections: [
      { kind: "summary", id: "qualified-3-2", summaryId: "qualified-3-2", title: "3-2 晋级", y: 300, tone: "amber" },
      { kind: "summary", id: "eliminated-2-3", summaryId: "eliminated-2-3", title: "2-3 淘汰", y: 800, tone: "steel" },
    ],
  },
];

export const SWISS_STAGE_FLOWS: Array<{ sourceId: string; targetIds: string[]; tone: CanvasTone }> = [
  { sourceId: "r1-0-0", targetIds: ["r2-1-0", "r2-0-1"], tone: "cyan" },
  { sourceId: "r2-1-0", targetIds: ["r3-2-0", "r3-1-1"], tone: "cyan" },
  { sourceId: "r2-0-1", targetIds: ["r3-1-1", "r3-0-2"], tone: "cyan" },
  { sourceId: "r3-2-0", targetIds: ["qualified-3-0", "r4-2-1"], tone: "amber" },
  { sourceId: "r3-1-1", targetIds: ["r4-2-1", "r4-1-2"], tone: "cyan" },
  { sourceId: "r3-0-2", targetIds: ["r4-1-2", "eliminated-0-3"], tone: "steel" },
  { sourceId: "r4-2-1", targetIds: ["qualified-3-1", "r5-2-2"], tone: "amber" },
  { sourceId: "r4-1-2", targetIds: ["r5-2-2", "eliminated-1-3"], tone: "steel" },
  { sourceId: "r5-2-2", targetIds: ["qualified-3-2", "eliminated-2-3"], tone: "amber" },
];

export const SWISS_OFFICIAL_PLACEHOLDER_BUCKETS: Record<number, SwissBucketKey[]> = {
  1: ["0-0", "0-0", "0-0", "0-0", "0-0", "0-0", "0-0", "0-0"],
  2: ["1-0", "1-0", "1-0", "1-0", "0-1", "0-1", "0-1", "0-1"],
  3: ["2-0", "2-0", "1-1", "1-1", "1-1", "1-1", "0-2", "0-2"],
  4: ["2-1", "2-1", "2-1", "1-2", "1-2", "1-2"],
  5: ["2-2", "2-2", "2-2"],
};

export const SWISS_OFFICIAL_PLACEHOLDER_SUMMARY_COUNTS: Record<SwissSummaryId, number> = {
  "qualified-3-0": 2,
  "qualified-3-1": 3,
  "qualified-3-2": 3,
  "eliminated-0-3": 2,
  "eliminated-1-3": 3,
  "eliminated-2-3": 3,
};

export function officialPlaceholderSwissBucket(roundNumber: number, indexInRound: number) {
  return SWISS_OFFICIAL_PLACEHOLDER_BUCKETS[roundNumber]?.[indexInRound] ?? null;
}
