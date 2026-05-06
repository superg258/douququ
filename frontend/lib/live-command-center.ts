import type { CommandCenterResponse, PrematchCenterMatch } from "@/lib/types";

export interface LiveCommandCenterBucket {
  id:
    | "live-now"
    | "up-next"
    | "today-pending"
    | "confirmed-upcoming"
    | "overdue-unresolved";
  title: string;
  description: string;
  tone: "blue" | "red" | "amber" | "green" | "steel";
  emptyLabel: string;
  items: PrematchCenterMatch[];
}

export interface LiveCommandCenter {
  source: "live";
  unavailableReason: string;
  sections: LiveCommandCenterBucket[];
}

export function buildLiveCommandCenter(command: CommandCenterResponse): LiveCommandCenter {
  const coverageLabel = command.sourceFreshness.coverageLabel;
  const unavailableReason =
    command.source.effectiveMode === "simulation_proxy" ? coverageLabel.split("，")[0] : "";

  return {
    source: "live",
    unavailableReason,
    sections: [
      {
        id: "live-now",
        title: "正在进行",
        description: "实时追踪当前正在直播的比赛，见证每一场对决的胜负走向。",
        tone: "green",
        emptyLabel: "暂无进行中比赛",
        items: command.timelineBuckets.liveNow,
      },
      {
        id: "up-next",
        title: "即将开赛",
        description: "下一场即将打响的焦点对决，提前锁定关注目标。",
        tone: "amber",
        emptyLabel: "暂无即将开赛",
        items: command.timelineBuckets.upNext,
      },
      {
        id: "today-pending",
        title: "尚未开赛",
        description: "今日赛程中仍未开赛的场次，赛程状态以官方同步为准。",
        tone: "blue",
        emptyLabel: "今日没有尚未开赛的比赛",
        items: command.timelineBuckets.todayPending,
      },
      {
        id: "confirmed-upcoming",
        title: "后续已确认",
        description: "已排定时间与对阵的后续比赛，提前预览未来的精彩碰撞。",
        tone: "blue",
        emptyLabel: "暂无后续确认赛程",
        items: command.timelineBuckets.confirmedUpcoming,
      },
      {
        id: "overdue-unresolved",
        title: "已过期未同步",
        description: "计划开赛时间已过但仍在等待官方赛果同步，数据更新后将自动移至对应分区。",
        tone: "red",
        emptyLabel: "无过期未同步比赛",
        items: command.timelineBuckets.overdueUnresolved,
      },
    ],
  };
}
