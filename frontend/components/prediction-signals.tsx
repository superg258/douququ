import type { MiniProgramPrediction } from "@/lib/types";
import { cn } from "@/lib/utils";

type SignalDensity = "compact" | "full";
type SignalStatus = "available" | "stale" | "unavailable";
type SignalVariant = "model" | "audience";

interface PredictionSignalsPanelProps {
  ts2RedRate: number;
  ts2BlueRate: number;
  miniProgramPrediction?: MiniProgramPrediction;
  showAudience?: boolean;
  density?: SignalDensity;
  modelBadge?: string;
  className?: string;
}

function clampRate(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function hasRate(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formatRate(value: number) {
  return `${(clampRate(value) * 100).toFixed(1)}%`;
}

function audienceSignal(prediction: MiniProgramPrediction | undefined): {
  status: SignalStatus;
  redRate: number;
  blueRate: number;
  centerLabel: string;
  title: string;
} {
  if (!prediction) {
    return {
      status: "unavailable",
      redRate: 0,
      blueRate: 0,
      centerLabel: "待接入",
      title: "王牌预言家观众投票待接入",
    };
  }

  if (prediction.status === "available") {
    const tieText = prediction.tieRate > 0 ? ` / 平 ${formatRate(prediction.tieRate)}` : "";
    return {
      status: "available",
      redRate: prediction.redRate,
      blueRate: prediction.blueRate,
      centerLabel: `${prediction.totalCount}票${tieText}`,
      title: `王牌预言家观众投票：红 ${formatRate(prediction.redRate)}，蓝 ${formatRate(prediction.blueRate)}${tieText}`,
    };
  }

  if (hasRate(prediction.redRate) && hasRate(prediction.blueRate)) {
    return {
      status: "stale",
      redRate: prediction.redRate,
      blueRate: prediction.blueRate,
      centerLabel: "缓存 / 暂不可用",
      title: prediction.reason ?? "王牌预言家暂不可用，展示最近一次缓存值",
    };
  }

  return {
    status: "unavailable",
    redRate: 0,
    blueRate: 0,
    centerLabel: "暂不可用",
    title: prediction.reason ?? "王牌预言家暂不可用",
  };
}

function signalTone(variant: SignalVariant, status: SignalStatus) {
  if (status === "unavailable") {
    return {
      row: "border-white/10 bg-white/5 text-rm-metal-text",
      label: "text-rm-metal-text",
      badge: "border-white/10 bg-black/30 text-rm-metal-text/70",
      center: "text-rm-metal-text/80",
    };
  }

  if (variant === "audience") {
    return {
      row: cn(
        "border-rm-status-warn/45 bg-rm-status-warn/10 shadow-[inset_0_0_16px_rgba(255,184,46,0.08)]",
        status === "stale" && "opacity-80"
      ),
      label: "text-rm-status-warn",
      badge: "border-rm-status-warn/45 bg-rm-status-warn/15 text-rm-status-warn",
      center: "text-rm-status-warn",
    };
  }

  return {
    row: "border-rm-blue/35 bg-rm-blue/10 shadow-[inset_0_0_16px_rgba(0,163,255,0.08)]",
    label: "text-rm-blue",
    badge: "border-rm-blue/35 bg-rm-blue/15 text-rm-blue",
    center: "text-rm-blue/90",
  };
}

function SignalRow({
  label,
  badge,
  redRate,
  blueRate,
  centerLabel,
  title,
  variant,
  status = "available",
  density,
}: {
  label: string;
  badge: string;
  redRate: number;
  blueRate: number;
  centerLabel?: string;
  title?: string;
  variant: SignalVariant;
  status?: SignalStatus;
  density: SignalDensity;
}) {
  const compact = density === "compact";
  const tone = signalTone(variant, status);
  const red = clampRate(redRate);
  const blue = clampRate(blueRate);
  const showBars = status !== "unavailable";

  return (
    <div
      className={cn(
        "grid items-center border clip-chamfer",
        compact
          ? "grid-cols-[58px_42px_minmax(54px,1fr)_42px] gap-1.5 px-1.5 py-1"
          : "grid-cols-[86px_58px_minmax(84px,1fr)_58px] gap-2 px-2.5 py-2",
        tone.row
      )}
      title={title}
    >
      <div className="min-w-0">
        <div className={cn("truncate font-bold tracking-widest", compact ? "text-[8px]" : "text-[10px]", tone.label)}>
          {label}
        </div>
        <div
          className={cn(
            "mt-0.5 inline-flex max-w-full border px-1 font-mono font-bold leading-tight",
            compact ? "text-[7px]" : "text-[8px]",
            tone.badge
          )}
        >
          <span className="truncate">{badge}</span>
        </div>
      </div>

      <div className={cn("text-left font-machine text-rm-red", compact ? "text-[10px]" : "text-xs")}>
        {showBars ? formatRate(red) : "--"}
      </div>

      <div
        className={cn(
          "relative min-w-0 overflow-hidden border border-white/10 bg-black/55 clip-chamfer",
          compact ? "h-3" : "h-4"
        )}
      >
        {showBars ? (
          <>
            <div
              className="absolute left-0 top-0 bottom-0 bg-gradient-to-r from-rm-red/80 to-rm-red/95 transition-all duration-500"
              style={{ width: `${(red * 100).toFixed(1)}%` }}
            />
            <div
              className="absolute right-0 top-0 bottom-0 bg-gradient-to-l from-rm-blue/80 to-rm-blue/95 transition-all duration-500"
              style={{ width: `${(blue * 100).toFixed(1)}%` }}
            />
            {variant === "model" ? (
              <div
                className="absolute top-0 bottom-0 w-px bg-white/80 transition-all duration-500"
                style={{
                  left: `${(red * 100).toFixed(1)}%`,
                  boxShadow: "0 0 7px rgba(255,255,255,0.75)",
                }}
              />
            ) : null}
          </>
        ) : null}
        {centerLabel ? (
          <div
            className={cn(
              "absolute inset-0 flex items-center justify-center px-1 text-center font-mono font-bold leading-none drop-shadow-[0_1px_2px_rgba(0,0,0,1)]",
              compact ? "text-[7px]" : "text-[9px]",
              tone.center
            )}
          >
            <span className="truncate">{centerLabel}</span>
          </div>
        ) : null}
      </div>

      <div className={cn("text-right font-machine text-rm-blue", compact ? "text-[10px]" : "text-xs")}>
        {showBars ? formatRate(blue) : "--"}
      </div>
    </div>
  );
}

export function PredictionSignalsPanel({
  ts2RedRate,
  ts2BlueRate,
  miniProgramPrediction,
  showAudience,
  density = "full",
  modelBadge = "胜率预测",
  className,
}: PredictionSignalsPanelProps) {
  const compact = density === "compact";
  const audience = audienceSignal(miniProgramPrediction);
  const shouldShowAudience = showAudience ?? Boolean(miniProgramPrediction);

  return (
    <div
      className={cn(
        "border border-rm-metal-border/60 bg-[#05070c] clip-chamfer",
        compact ? "space-y-1 p-1" : "space-y-2 p-2.5",
        className
      )}
    >
      <SignalRow
        label="TS2 模型"
        badge={modelBadge}
        redRate={ts2RedRate}
        blueRate={ts2BlueRate}
        variant="model"
        density={density}
      />
      {shouldShowAudience ? (
        <SignalRow
          label="观众投票"
          badge="王牌预言家"
          redRate={audience.redRate}
          blueRate={audience.blueRate}
          centerLabel={audience.centerLabel}
          title={audience.title}
          variant="audience"
          status={audience.status}
          density={density}
        />
      ) : null}
    </div>
  );
}
