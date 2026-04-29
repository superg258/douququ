import type { OverviewResponse } from "@/lib/types";

export interface LiveCommandCenterBucket {
  id: "live-now" | "up-next" | "confirmed-upcoming" | "upset-results" | "vote-split" | "review-pending";
  title: string;
  description: string;
  tone: "blue" | "red" | "amber" | "green" | "steel";
  emptyLabel: string;
  items: [];
}

export interface LiveCommandCenter {
  source: "live";
  unavailableReason: string;
  sections: LiveCommandCenterBucket[];
}

export function buildLiveCommandCenter(_overview: OverviewResponse): LiveCommandCenter {
  return {
    source: "live",
    unavailableReason: "实时赛程源尚未接入，当前只预留官方赛程、官方赛果与观众投票分歧入口。",
    sections: [
      {
        id: "live-now",
        title: "正在进行",
        description: "官方赛程返回进行中状态后，集中展示可实时追踪的比赛。",
        tone: "green",
        emptyLabel: "等待官方源",
        items: [],
      },
      {
        id: "up-next",
        title: "即将开赛",
        description: "用于赛前短时间窗口内的重点入口，方便用户快速进入观赛判断。",
        tone: "amber",
        emptyLabel: "等待官方源",
        items: [],
      },
      {
        id: "confirmed-upcoming",
        title: "已确认未开赛",
        description: "仅收录官方已经确认对阵、但尚未开赛的比赛。",
        tone: "blue",
        emptyLabel: "等待官方源",
        items: [],
      },
      {
        id: "upset-results",
        title: "赛后爆冷",
        description: "赛果确认后，归档与赛前判断明显反向的比赛。",
        tone: "red",
        emptyLabel: "等待官方源",
        items: [],
      },
      {
        id: "vote-split",
        title: "投票分歧",
        description: "观众投票与赛前判断差异明显时，作为争议观察入口。",
        tone: "steel",
        emptyLabel: "等待官方源",
        items: [],
      },
      {
        id: "review-pending",
        title: "赛果待复盘",
        description: "已完赛但还未完成命中率、比分和爆冷归档的比赛。",
        tone: "steel",
        emptyLabel: "等待官方源",
        items: [],
      },
    ],
  };
}
