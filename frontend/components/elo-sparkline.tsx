export function formatEloDelta(value: number) {
  if (Math.abs(value) < 0.05) return "±0.0";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

export function downsampleTrajectory(
  points: number[],
  targetCount: number = 6,
): number[] {
  if (points.length <= targetCount) return points;
  const result: number[] = [];
  const step = (points.length - 1) / (targetCount - 1);
  for (let i = 0; i < targetCount; i++) {
    result.push(points[Math.round(i * step)]);
  }
  return result;
}

export function EloSparkline({
  points,
  className = "mt-0.5 h-4 w-12",
}: {
  points: number[];
  className?: string;
}) {
  const viewWidth = 48;
  const viewHeight = 18;
  const padY = 3;
  const plotHeight = viewHeight - padY * 2;

  // 退化态：不足 2 个点，显示水平虚线 + 灰点
  if (points.length < 2) {
    const y = viewHeight / 2;
    return (
      <svg
        viewBox={`0 0 ${viewWidth} ${viewHeight}`}
        className={className}
        role="img"
        aria-label="暂无 Elo 变化数据"
      >
        <line
          x1="4" y1={y} x2="42" y2={y}
          className="stroke-rm-metal-textMuted"
          strokeWidth="1"
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
        <circle
          cx="44" cy={y} r="1.75"
          className="fill-rm-metal-textMuted"
        />
      </svg>
    );
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = Math.max(1, max - min);
  const delta = points[points.length - 1] - points[0];

  const xStep = (viewWidth - 4) / (points.length - 1);
  const toY = (value: number) =>
    padY + plotHeight - ((value - min) / range) * plotHeight;

  const pathCoords = points
    .map((value, index) => `${4 + index * xStep},${toY(value)}`)
    .join(" ");

  const lastX = 4 + (points.length - 1) * xStep;
  const lastY = toY(points[points.length - 1]);

  const tone =
    delta > 0.05
      ? "stroke-rm-status-safe"
      : delta < -0.05
        ? "stroke-rm-red"
        : "stroke-rm-metal-textMuted";
  const fillTone =
    delta > 0.05
      ? "fill-rm-status-safe"
      : delta < -0.05
        ? "fill-rm-red"
        : "fill-rm-metal-textMuted";

  return (
    <svg
      viewBox={`0 0 ${viewWidth} ${viewHeight}`}
      className={className}
      role="img"
      aria-label={`赛季 Elo 走势 ${formatEloDelta(delta)}`}
    >
      <polyline
        points={pathCoords}
        fill="none"
        className={`${tone} drop-shadow-[0_0_3px_currentColor]`}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={lastX}
        cy={lastY}
        r="1.75"
        className={fillTone}
      />
    </svg>
  );
}
