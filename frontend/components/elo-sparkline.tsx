export function formatEloDelta(value: number) {
  if (Math.abs(value) < 0.05) return "±0.0";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

export function EloSparkline({
  current,
  delta,
  className = "mt-0.5 h-4 w-12",
}: {
  current: number;
  delta: number;
  className?: string;
}) {
  const start = current - delta;
  const direction = delta >= 0 ? 1 : -1;
  const points = [
    start,
    start + delta * 0.28 - direction * 8,
    start + delta * 0.58 + direction * 5,
    current,
  ];
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = Math.max(1, max - min);
  const path = points
    .map((value, index) => `${index * 16},${15 - ((value - min) / range) * 12}`)
    .join(" ");
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
      viewBox="0 0 48 18"
      className={className}
      role="img"
      aria-label={`赛季 Elo 走势 ${formatEloDelta(delta)}`}
    >
      <polyline
        points={path}
        fill="none"
        className={`${tone} drop-shadow-[0_0_3px_currentColor]`}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx="48"
        cy={15 - ((current - min) / range) * 12}
        r="1.75"
        className={fillTone}
      />
    </svg>
  );
}
