# Forecast Center Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine the live forecast center page — colored filter buttons per region/status, and redesigned deviation match cards with left-right comparison layout.

**Architecture:** Two-file change. `forecast-center-page.tsx` gets per-item color maps for region/bucket filter buttons. `model-recap-panel.tsx` gets a redesigned deviation card with three-column layout (prediction | badge | actual).

**Tech Stack:** React, TypeScript, Tailwind CSS

---

### Task 1: Add region and bucket color maps to forecast-center-page.tsx

**Files:**
- Modify: `frontend/components/forecast-center-page.tsx`

- [ ] **Step 1: Add color config maps and apply to filter buttons**

Replace the `REGIONS` and `BUCKETS` button rendering with color-mapped variants.

First, add these color maps right after the `BUCKETS` constant (before the `ForecastCenterPage` function):

```tsx
const REGION_COLORS: Record<string, { border: string; bg: string; text: string; shadow: string }> = {
  all: {
    border: "border-rm-metal-textMuted/50",
    bg: "bg-rm-metal-textMuted/10",
    text: "text-rm-metal-textLight",
    shadow: "shadow-[0_0_10px_rgba(255,255,255,0.04)]",
  },
  south_region: {
    border: "border-rm-red/70",
    bg: "bg-rm-red/15",
    text: "text-white",
    shadow: "shadow-[0_0_10px_rgba(232,48,42,0.08)]",
  },
  east_region: {
    border: "border-rm-blue/70",
    bg: "bg-rm-blue/15",
    text: "text-white",
    shadow: "shadow-[0_0_10px_rgba(42,159,255,0.08)]",
  },
  north_region: {
    border: "border-rm-violet/70",
    bg: "bg-rm-violet/15",
    text: "text-white",
    shadow: "shadow-[0_0_10px_rgba(139,92,246,0.08)]",
  },
};

const BUCKET_COLORS: Record<string, { border: string; bg: string; text: string; shadow: string }> = {
  all: {
    border: "border-rm-metal-textMuted/50",
    bg: "bg-rm-metal-textMuted/10",
    text: "text-rm-metal-textLight",
    shadow: "shadow-[0_0_10px_rgba(255,255,255,0.04)]",
  },
  "live-now": {
    border: "border-rm-status-safe/70",
    bg: "bg-rm-status-safe/10",
    text: "text-white",
    shadow: "shadow-[0_0_10px_rgba(0,232,120,0.06)]",
  },
  "up-next": {
    border: "border-rm-status-warn/70",
    bg: "bg-rm-status-warn/10",
    text: "text-white",
    shadow: "shadow-[0_0_10px_rgba(255,176,0,0.06)]",
  },
  "today-pending": {
    border: "border-rm-blue/70",
    bg: "bg-rm-blue/15",
    text: "text-white",
    shadow: "shadow-[0_0_10px_rgba(42,159,255,0.08)]",
  },
  "overdue-unresolved": {
    border: "border-rm-status-upset/70",
    bg: "bg-rm-status-upset/10",
    text: "text-white",
    shadow: "shadow-[0_0_10px_rgba(255,80,80,0.06)]",
  },
};
```

Then replace the region button rendering inside the filters bar. Find this code block (lines 176-189):

```tsx
{REGIONS.map((item) => (
  <button
    key={item.id}
    type="button"
    onClick={() => setRegion(item.id)}
    className={`border px-3 py-2 font-mono text-[11px] transition-all ${
      region === item.id
        ? "border-rm-blue/70 bg-rm-blue/15 text-white shadow-[0_0_10px_rgba(42,159,255,0.08)]"
        : "border-rm-metal-border bg-transparent text-rm-metal-textMuted hover:border-rm-blue/40 hover:text-rm-metal-textLight"
    }`}
  >
    {item.label}
  </button>
))}
```

Replace with:

```tsx
{REGIONS.map((item) => {
  const c = REGION_COLORS[item.id];
  return (
    <button
      key={item.id}
      type="button"
      onClick={() => setRegion(item.id)}
      className={`border px-3 py-2 font-mono text-[11px] transition-all ${
        region === item.id
          ? `${c.border} ${c.bg} ${c.text} ${c.shadow}`
          : "border-rm-metal-border bg-transparent text-rm-metal-textMuted hover:border-rm-metal-textMuted/40 hover:text-rm-metal-textLight"
      }`}
    >
      {item.label}
    </button>
  );
})}
```

Then replace the bucket button rendering. Find this code block (lines 196-209):

```tsx
{BUCKETS.map((item) => (
  <button
    key={item.id}
    type="button"
    onClick={() => setBucket(item.id)}
    className={`border px-3 py-1.5 font-mono text-[11px] transition-all ${
      bucket === item.id
        ? "border-rm-status-warn/70 bg-rm-status-warn/10 text-white shadow-[0_0_10px_rgba(255,176,0,0.06)]"
        : "border-rm-metal-border bg-rm-metal-panel text-rm-metal-textMuted hover:border-rm-status-warn/40 hover:text-rm-metal-textLight"
    }`}
  >
    {item.label}
  </button>
))}
```

Replace with:

```tsx
{BUCKETS.map((item) => {
  const c = BUCKET_COLORS[item.id];
  return (
    <button
      key={item.id}
      type="button"
      onClick={() => setBucket(item.id)}
      className={`border px-3 py-1.5 font-mono text-[11px] transition-all ${
        bucket === item.id
          ? `${c.border} ${c.bg} ${c.text} ${c.shadow}`
          : "border-rm-metal-border bg-rm-metal-panel text-rm-metal-textMuted hover:border-rm-metal-textMuted/40 hover:text-rm-metal-textLight"
      }`}
    >
      {item.label}
    </button>
  );
})}
```

- [ ] **Step 2: Verify build compiles and review visually**

Run: `cd /home/winx/douququ/frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: No new type errors from our changes.

### Task 2: Redesign deviation match cards with left-right comparison layout

**Files:**
- Modify: `frontend/components/model-recap-panel.tsx`

- [ ] **Step 1: Replace the notable deviation card rendering**

Find the notable deviation matches section — the `{notable.map((match) => (` block (lines 82-109). Replace the entire Link card with:

```tsx
{notable.map((match) => {
  const isUpset = match.deviationType === "upset_miss";
  return (
    <Link
      key={match.id}
      href={buildRegionHref(match.regionSlug, match.workspaceView, {
        seed: match.seed,
        mode: "live",
        highlight: match.actualWinnerTeamKey ?? match.predictedWinnerTeamKey,
      })}
      className="border border-rm-metal-border bg-rm-metal-card px-3 py-2.5 transition-all hover:border-rm-status-deviation/50 hover:shadow-[0_0_12px_rgba(139,92,246,0.06)]"
    >
      {/* Top: match context */}
      <div className="mb-2 truncate font-mono text-[10px] text-rm-metal-textFaint/70">
        {match.regionName} · {match.stageLabel} · {match.matchLabel}
      </div>

      {/* Three-column comparison */}
      <div className="flex items-stretch gap-2">
        {/* Left: Prediction */}
        <div className="flex-1 min-w-0 border border-rm-red/15 bg-rm-red/5 px-2 py-1.5">
          <div className="font-mono text-[9px] text-rm-metal-textFaint/60">预测结果</div>
          <div className="mt-0.5 font-sans text-sm font-semibold text-rm-metal-textLight truncate">
            {match.predictedWinnerName}
          </div>
          <div className="font-mono text-xs text-rm-red tabular-nums">
            {match.predictedScoreline}
          </div>
        </div>

        {/* Center: Deviation badge */}
        <div className="flex flex-col items-center justify-center shrink-0 px-2">
          <span className={`font-mono text-[10px] px-1.5 py-0.5 border ${
            isUpset
              ? "text-rm-status-upset border-rm-status-upset/30 bg-rm-status-upset/8"
              : "text-rm-status-warn border-rm-status-warn/30 bg-rm-status-warn/8"
          }`}>
            {isUpset ? "爆冷" : "比分偏差"}
          </span>
        </div>

        {/* Right: Actual */}
        <div className="flex-1 min-w-0 border border-rm-blue/15 bg-rm-blue/5 px-2 py-1.5">
          <div className="font-mono text-[9px] text-rm-metal-textFaint/60">实际结果</div>
          <div className="mt-0.5 font-sans text-sm font-semibold text-rm-metal-textLight truncate">
            {match.actualWinnerName ?? "未知"}
          </div>
          <div className="font-mono text-xs text-rm-blue tabular-nums">
            {match.actualScoreline ?? "待确认"}
          </div>
        </div>
      </div>
    </Link>
  );
})}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /home/winx/douququ/frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: No new type errors.

- [ ] **Step 3: Run existing tests**

Run: `cd /home/winx/douququ/frontend && npx vitest run 2>&1`
Expected: All existing tests pass.

### Task 3: Commit

- [ ] **Step 1: Stage and commit**

```bash
cd /home/winx/douququ && git add frontend/components/forecast-center-page.tsx frontend/components/model-recap-panel.tsx
git commit -m "refine: update forecast center button colors and deviation card layout"
```
