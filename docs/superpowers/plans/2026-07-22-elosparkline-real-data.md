# EloSparkline 真实数据曲线 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 EloSparkline 的数据源从伪造的 (current, delta) 替换为实时赛果驱动的真实 Elo 轨迹数组

**Architecture:** 在 `simulateEvent()` 处理真实赛果时同步记录每队 Elo 轨迹，通过 `FinalsEventSimulation` 返回。Sparkline 组件入参改为 `points: number[]`，消费方降采样到 5~6 个点后传入。视觉渲染逻辑不变。

**Tech Stack:** TypeScript, React, SVG polyline

## Global Constraints

- 仅在实时模式（live mode）下启用；模拟模式不消费 sparkline
- 轨迹等距降采样到 5~6 个点（含首尾）
- 视觉风格保持不变：上升绿/下降红/持平灰，polyline + 末端圆点
- `points.length < 2` 时退化显示水平虚线 + 灰点
- `points.length <= 6` 时全量保留，不降采样
- 改动范围：`FinalsEventSimulation` 类型、`simulateEvent()`、`EloSparkline`、两个消费方组件

---

### Task 1: 类型定义 + 轨迹采集

**Files:**
- Modify: `frontend/lib/finals-simulation.ts:35-56` (FinalsEventSimulation 接口), `:286-592` (simulateEvent 函数体)

**Interfaces:**
- Produces: `FinalsEventSimulation.eloTrajectoryByTeamKey: Record<string, number[]>` — 每支队伍按时间顺序的 Elo 值数组

- [ ] **Step 1: 在 `FinalsEventSimulation` 接口中添加 `eloTrajectoryByTeamKey` 字段**

在 `finalEloByTeamKey` 字段后面添加：

```typescript
  /** 仅实时模式：每支队伍的真实赛果 Elo 轨迹（按时间顺序，首点 = 该队赛事起始 Elo） */
  eloTrajectoryByTeamKey: Record<string, number[]>;
```

- [ ] **Step 2: 在 `simulateEvent()` 中初始化轨迹 Map**

在 `eloByTeamKey` 初始化之后（约第 296 行），添加轨迹初始化：

```typescript
  // 轨迹：每队从当前 Elo 开始，每次真实赛果后追加更新后的 Elo
  const trajectories = new Map<string, number[]>();
  for (const [teamKey, elo] of eloByTeamKey) {
    trajectories.set(teamKey, [elo]);
  }
```

- [ ] **Step 3: 在真实赛果更新 Elo 后追加轨迹点**

在 `playMatch()` 内部的 Elo 更新代码块（约第 411-412 行）之后，添加轨迹追加：

```typescript
        eloByTeamKey.set(resolvedRed.teamKey, result.redEloAfter);
        eloByTeamKey.set(resolvedBlue.teamKey, result.blueEloAfter);
        // 追加轨迹点
        const redTraj = trajectories.get(resolvedRed.teamKey);
        if (redTraj) redTraj.push(result.redEloAfter);
        const blueTraj = trajectories.get(resolvedBlue.teamKey);
        if (blueTraj) blueTraj.push(result.blueEloAfter);
```

- [ ] **Step 4: 在 `simulateEvent()` 返回值中添加 `eloTrajectoryByTeamKey`**

在 return 语句的 `finalEloByTeamKey` 之后添加：

```typescript
    eloTrajectoryByTeamKey: Object.fromEntries(trajectories),
```

- [ ] **Step 5: 运行现有测试确认无回归**

```bash
cd /Users/wencha/Code/Projects/douququ/frontend && npx vitest run tests/canvas-builders.test.ts tests/canvas-card-status.test.ts tests/finals-schedule.test.ts 2>&1 | tail -20
```

预期：所有已有测试 PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/finals-simulation.ts
git commit -m "feat: add eloTrajectoryByTeamKey to FinalsEventSimulation"
```

---

### Task 2: EloSparkline 组件重构

**Files:**
- Modify: `frontend/components/elo-sparkline.tsx`

**Interfaces:**
- Produces: `EloSparkline({ points, className })` — 新接口，用真实轨迹数组替代 (current, delta)
- Produces: `downsampleTrajectory(points, targetCount?)` — 导出的降采样工具函数

- [ ] **Step 1: 重写 `EloSparkline` 组件**

保留 `formatEloDelta` 不变。重写 `EloSparkline`：

```typescript
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
```

- [ ] **Step 2: 运行类型检查（预期两个消费方有类型错误，Task 3/4 修复）**

```bash
cd /Users/wencha/Code/Projects/douququ/frontend && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add frontend/components/elo-sparkline.tsx
git commit -m "refactor: EloSparkline accepts real trajectory points"
```

---

### Task 3: 排行榜页接入轨迹数据

**Files:**
- Modify: `frontend/components/elo-rankings-page.tsx`
- Modify: `frontend/components/finals-elo-rankings.tsx`

**Interfaces:**
- Consumes: `FinalsEventSimulation.eloTrajectoryByTeamKey`
- Consumes: `EloSparkline({ points, className })`, `downsampleTrajectory()`

- [ ] **Step 1: 在 `elo-rankings-page.tsx` 中提取轨迹数据**

修改 `liveEloByEventSlug` useMemo（约第 61-75 行），在 return 对象中添加：

```typescript
      eloTrajectoryByTeamKey: {
        ...simulation.repechage.eloTrajectoryByTeamKey,
        ...simulation.nationals.eloTrajectoryByTeamKey,
      } as Record<string, number[]>,
```

- [ ] **Step 2: 透传 `eloTrajectoryByTeamKey` 到 `FinalsEloRankings`**

在 `FinalsEloRankings` 调用处新增 prop：

```typescript
            eloTrajectoryByTeamKey={liveEloByEventSlug?.eloTrajectoryByTeamKey ?? null}
```

- [ ] **Step 3: 在 `FinalsEloRankings` 中接收并透传到行数据**

Props 类型添加：`eloTrajectoryByTeamKey?: Record<string, number[]> | null;`

`FinalsEloRankingRow` 类型添加：`eloTrajectory?: number[];`

在 `buildRankingSection()` 中查找轨迹并放入 row：

```typescript
    const eloTrajectory = eloTrajectoryByTeamKey?.[teamKey];
    // 在 rows.push 对象中添加:
      eloTrajectory,
```

在 `RankingRow` 中替换 sparkline（约第 279 行）：

```typescript
        {row.eloTrajectory && row.eloTrajectory.length >= 2 ? (
          <EloSparkline
            points={downsampleTrajectory(row.eloTrajectory)}
          />
        ) : (
          <EloSparkline points={[]} />
        )}
```

更新 import 添加 `downsampleTrajectory`。

- [ ] **Step 4: 运行类型检查**

```bash
cd /Users/wencha/Code/Projects/douququ/frontend && npx tsc --noEmit 2>&1 | grep -c "error"
```

预期：仅剩 forecast-inspector-panel 相关错误

- [ ] **Step 5: Commit**

```bash
git add frontend/components/elo-rankings-page.tsx frontend/components/finals-elo-rankings.tsx
git commit -m "feat: rankings page uses real Elo trajectories for sparklines"
```

---

### Task 4: 预测中心情报面板接入轨迹数据

**Files:**
- Modify: `frontend/components/forecast-center-page.tsx`
- Modify: `frontend/components/forecast-inspector-panel.tsx`

**Interfaces:**
- Consumes: `FinalsEventSimulation.eloTrajectoryByTeamKey`
- Consumes: `EloSparkline({ points, className })`, `downsampleTrajectory()`

- [ ] **Step 1: 在 `InspectorTeamInfo` 中添加轨迹字段**

```typescript
export interface InspectorTeamInfo {
  // ... 现有字段 ...
  eloTrajectory?: number[];
}
```

- [ ] **Step 2: 在 `selectedTeamInfo` 构建中注入轨迹**

约第 263 行 return 对象中添加：

```typescript
    eloTrajectory: currentSimulation?.eloTrajectoryByTeamKey?.[selectedTeamKey],
```

- [ ] **Step 3: 替换情报面板中的 sparkline 调用**

约第 126-139 行，将 `{current, delta}` 替换为 `{points}`：

```typescript
            {mode === "live" && teamInfo.eloTrajectory && teamInfo.eloTrajectory.length >= 2 ? (
              <div className="col-span-2 mt-1 flex items-center justify-between border-y border-rm-metal-border/70 py-2">
                <div>
                  <div className="text-rm-metal-textMuted">赛季 Elo 走势</div>
                  <div className={teamInfo.seasonDelta && teamInfo.seasonDelta >= 0 ? "text-rm-status-safe" : "text-rm-red"}>
                    赛季 {teamInfo.seasonDelta !== null ? formatEloDelta(teamInfo.seasonDelta) : "--"}
                  </div>
                </div>
                <EloSparkline
                  points={downsampleTrajectory(teamInfo.eloTrajectory)}
                  className="h-7 w-20"
                />
              </div>
            ) : null}
```

更新 import 添加 `downsampleTrajectory`。

- [ ] **Step 4: 运行类型检查**

```bash
cd /Users/wencha/Code/Projects/douququ/frontend && npx tsc --noEmit 2>&1 | grep -c "error"
```

预期：0

- [ ] **Step 5: Commit**

```bash
git add frontend/components/forecast-center-page.tsx frontend/components/forecast-inspector-panel.tsx
git commit -m "feat: forecast inspector uses real Elo trajectories for sparklines"
```

---

### Task 5: 测试

**Files:**
- Create: `frontend/tests/elo-sparkline.test.ts`

- [ ] **Step 1: 编写单元测试**

```typescript
import { describe, expect, it } from "vitest";
import { downsampleTrajectory } from "@/components/elo-sparkline";

describe("downsampleTrajectory", () => {
  it("returns original array when length <= targetCount", () => {
    const points = [1500, 1510, 1520];
    expect(downsampleTrajectory(points, 6)).toEqual(points);
  });

  it("downsamples 12 points to 6 with first and last preserved", () => {
    const points = [1500, 1505, 1510, 1512, 1508, 1515, 1520, 1518, 1525, 1530, 1528, 1535];
    const result = downsampleTrajectory(points, 6);
    expect(result).toHaveLength(6);
    expect(result[0]).toBe(1500);
    expect(result[5]).toBe(1535);
  });

  it("downsamples 20 points to 5", () => {
    const points = Array.from({ length: 20 }, (_, i) => 1500 + i * 2);
    const result = downsampleTrajectory(points, 5);
    expect(result).toHaveLength(5);
    expect(result[0]).toBe(1500);
    expect(result[4]).toBe(1538);
  });

  it("handles 7 points to 6", () => {
    const points = [1500, 1505, 1510, 1512, 1518, 1522, 1530];
    const result = downsampleTrajectory(points, 6);
    expect(result).toHaveLength(6);
    expect(result[0]).toBe(1500);
    expect(result[5]).toBe(1530);
  });
});
```

- [ ] **Step 2: 运行新测试**

```bash
cd /Users/wencha/Code/Projects/douququ/frontend && npx vitest run tests/elo-sparkline.test.ts 2>&1
```

预期：4 tests PASS

- [ ] **Step 3: 运行全量已有测试**

```bash
cd /Users/wencha/Code/Projects/douququ/frontend && npx vitest run 2>&1 | tail -20
```

预期：全部 PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/tests/elo-sparkline.test.ts
git commit -m "test: add downsampleTrajectory unit tests"
```

---

### Task 6: 最终验证

- [ ] **Step 1: 类型检查**

```bash
cd /Users/wencha/Code/Projects/douququ/frontend && npx tsc --noEmit 2>&1 | tail -5
```

预期：无错误

- [ ] **Step 2: 全量前端测试**

```bash
cd /Users/wencha/Code/Projects/douququ/frontend && npx vitest run 2>&1 | tail -10
```

预期：全部 PASS

- [ ] **Step 3: 后端测试**

```bash
cd /Users/wencha/Code/Projects/douququ && python -m pytest backend/tests/test_api.py -x -q 2>&1 | tail -10
```

预期：全部 PASS
