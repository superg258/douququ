# 主页 & ELO 排名页重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将主页和ELO排名页从单一大组件拆分为职责单一的小组件，精简颜色体系（红蓝=品牌装饰/UI交互，状态色仅描述赛程，概率用排版表达），统一页面背景与区域工作区一致。

**Architecture:** 新建13个组件文件，重写2个页面文件为薄壳数据加载层，修改tailwind.config.ts（新增色键+保留向后兼容）和globals.css（新增page-background），移除实时指挥中心存根和战术阵型全表。

**Tech Stack:** Next.js 16 (App Router), React 18, TypeScript, Tailwind CSS 3

---

### Task 1: Tailwind 配置 — 新增颜色 + 保持向后兼容

**Files:**
- Modify: `frontend/tailwind.config.ts`

- [ ] **Step 1: 新增颜色键，保留所有现有颜色值**

在 `tailwind.config.ts` 的 `colors.rm.metal` 中新增 `raised`、`textLight`、`textMuted`、`textFaint`。在 `colors.rm.status` 中新增 `confirmed`、`pending`。不删除也不重命名任何现有键。

```typescript
// frontend/tailwind.config.ts — 在 rm.metal 块中新增:
metal: {
  dark: "#040608",        // 保留，不动
  raised: "#0A0A0C",      // 新增 — 卡片底层
  panel: "#121212",       // 保留，不动 (区域工作区依赖)
  border: "#2A2A2A",     // 保留，不动
  text: "#A3A3A3",       // 保留，不动
  textLight: "#E2E8F0",  // 新增 — 主文字
  textMuted: "#94A3B8",  // 新增 — 次文字
  textFaint: "#64748B",  // 新增 — 弱文字
},

// 在 rm.status 块中新增:
status: {
  safe: "#00E878",         // 保留 (已被 overview-page 旧代码引用)
  warn: "#FFB000",         // 保留 (已被 overview-page 旧代码引用)
  dead: "#4B5563",         // 保留 (已被 canvas-card 引用)
  upset: "#E8302A",        // 保留 (已被 canvas-card 引用)
  deviation: "#A855F7",    // 保留 (已被 canvas-card 引用)
  prediction: "#2A9FFF",   // 保留 (已被 prediction-signals 引用)
  scheduled: "#FACC15",    // 保留 (已被 canvas-card 引用)
  confirmed: "#00E878",    // 新增 — 赛程已确认 (同 safe 值但语义清晰)
  pending: "#FFB000",      // 新增 — 赛程进行中 (同 warn 值但语义清晰)
},

// result 块全部保留不动
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: 无新错误（已存在的类型错误如 `next-env.d.ts` 忽略）。

- [ ] **Step 3: Commit**

```bash
git add frontend/tailwind.config.ts
git commit -m "feat: add new color tokens (raised, textLight, textMuted, textFaint, confirmed, pending)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: Global CSS — 添加 page-background + page-grid

**Files:**
- Modify: `frontend/app/globals.css`

- [ ] **Step 1: 在 globals.css 末尾追加 page-background 和 page-grid 类**

```css
/* frontend/app/globals.css — 追加到文件末尾 */

.page-background {
  background-image:
    radial-gradient(ellipse at 30% 50%, rgba(232, 48, 42, 0.04) 0%, transparent 55%),
    radial-gradient(ellipse at 70% 50%, rgba(42, 159, 255, 0.04) 0%, transparent 55%),
    linear-gradient(rgba(4, 6, 8, 0.92), rgba(4, 6, 8, 0.92)),
    url('/主视图.png');
  background-size: cover, cover, cover, cover;
  background-position: center;
  background-repeat: no-repeat;
}

.page-grid {
  background-image:
    linear-gradient(to right, rgba(255, 255, 255, 0.025) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(255, 255, 255, 0.025) 1px, transparent 1px);
  background-size: 64px 64px;
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/app/globals.css
git commit -m "feat: add page-background and page-grid CSS classes

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: 新建 overview-hero.tsx

**Files:**
- Create: `frontend/components/overview-hero.tsx`

- [ ] **Step 1: 创建组件**

```typescript
// frontend/components/overview-hero.tsx
export function OverviewHero({ generatedLabel }: { generatedLabel: string }) {
  return (
    <div className="relative border-b border-transparent pb-6">
      {/* 红蓝底部微光条 */}
      <div className="absolute bottom-0 left-0 right-1/2 h-px bg-gradient-to-r from-transparent to-rm-red/40" />
      <div className="absolute bottom-0 right-0 left-1/2 h-px bg-gradient-to-l from-transparent to-rm-blue/40" />

      <h1 className="font-machine text-2xl sm:text-3xl font-bold tracking-widest text-rm-metal-textLight">
        <span>RoboMaster 胜率预测总控台</span>
      </h1>
      <p className="mt-2 font-mono text-xs text-rm-metal-textMuted tracking-wide">
        覆盖南部·东部·北部三赛区 — TrueSkill 2 与蒙特卡洛推演晋级形势
      </p>
      <div className="mt-3 flex items-center gap-2">
        <span className="flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-1.5 w-1.5 rounded-full bg-rm-status-confirmed opacity-75" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-rm-status-confirmed" />
        </span>
        <span className="font-mono text-[10px] text-rm-metal-textFaint tracking-widest">
          {generatedLabel}
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/overview-hero.tsx
git commit -m "feat: add OverviewHero component

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: 新建 region-card.tsx

**Files:**
- Create: `frontend/components/region-card.tsx`

- [ ] **Step 1: 创建组件**

```typescript
// frontend/components/region-card.tsx
import Link from "next/link";
import type { OverviewTeam, RegionDashboardCard, WorkspaceView } from "@/lib/types";
import { buildRegionHref } from "@/lib/region-config";
import { deriveRealtimeAvailability } from "@/lib/realtime";
import { cn } from "@/lib/utils";

function pct(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function elo(value: number) {
  return value.toFixed(1);
}

const QUICK_VIEWS: Array<{ id: WorkspaceView; label: string }> = [
  { id: "qualification", label: "资格赛" },
  { id: "playoff", label: "淘汰赛" },
  { id: "final-rankings", label: "最终排名" },
];

/** 按概率层级渲染队伍行：>70% 加粗亮白，30-70% 常规灰色，<30% 弱色 */
function TeamProbRow({ team }: { team: OverviewTeam }) {
  const prob = team.probabilities.national;
  const isHigh = prob >= 0.7;
  const isMid = prob >= 0.3;

  return (
    <div className={cn(
      "flex items-center justify-between text-xs",
      isHigh ? "text-rm-metal-textLight font-semibold" :
        isMid ? "text-rm-metal-textMuted" : "text-rm-metal-textFaint"
    )}>
      <span className="truncate max-w-[60%]">{team.collegeName}</span>
      <span className="font-mono tabular-nums shrink-0">
        国赛 {pct(prob)} · 夺冠 {pct(team.probabilities.champion)}
      </span>
    </div>
  );
}

export function RegionCard({ region }: { region: RegionDashboardCard }) {
  const realtimeAvailability = deriveRealtimeAvailability(
    region.regionSlug,
    region.liveStatus,
  );
  const fallbackMode = realtimeAvailability.enabled ? "live" : "sim";
  const workspaceHref = buildRegionHref(
    region.regionSlug,
    "playoff",
    { mode: fallbackMode },
  );

  const sortedTeams = [...region.teams]
    .sort((a, b) => b.probabilities.national - a.probabilities.national)
    .slice(0, 6);

  return (
    <div className="flex flex-col bg-rm-metal-raised border border-rm-metal-border rounded-sm overflow-hidden
                    hover:border-rm-blue/30 transition-colors duration-200">
      {/* 赛区头部 */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="font-sans text-base font-semibold text-rm-metal-textLight">
              {region.regionName}
            </h2>
            <span
              className={cn(
                "w-1.5 h-1.5 rounded-full",
                realtimeAvailability.enabled
                  ? "bg-rm-status-confirmed"
                  : "bg-rm-metal-textFaint",
              )}
              title={realtimeAvailability.hint}
            />
          </div>
          <span className="font-mono text-[10px] text-rm-metal-textFaint">
            {realtimeAvailability.badge}
          </span>
        </div>

        {/* 核心指标行 */}
        <div className="mt-2 flex gap-4 font-mono text-[11px] text-rm-metal-textMuted">
          <span>{region.teamCount} 队</span>
          <span>种子 {region.favorite.collegeName}</span>
          <span>国赛 {region.nationalSlots} 席</span>
        </div>
      </div>

      {/* 队伍概率列表 */}
      <div className="px-4 pb-3 space-y-1.5 flex-1">
        {sortedTeams.map((team) => (
          <TeamProbRow key={team.teamKey} team={team} />
        ))}
        {region.teams.length > 6 && (
          <div className="text-[10px] text-rm-metal-textFaint font-mono">
            ... 等 {region.teams.length - 6} 支队伍
          </div>
        )}
      </div>

      {/* 底部操作区 */}
      <div className="px-4 py-3 border-t border-rm-metal-border flex items-center justify-between">
        <Link
          href={workspaceHref}
          className="font-sans text-sm font-medium text-rm-blue hover:text-rm-blue/80 transition-colors"
        >
          进入赛区沙盘 →
        </Link>
        <div className="flex gap-3">
          {QUICK_VIEWS.map((view) => (
            <Link
              key={view.id}
              href={buildRegionHref(region.regionSlug, view.id, { mode: fallbackMode })}
              className="font-mono text-[10px] text-rm-metal-textMuted hover:text-rm-metal-textLight transition-colors"
            >
              {view.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript 编译检查**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep "region-card" | head -10
```

Expected: 无 region-card 相关错误。

- [ ] **Step 3: Commit**

```bash
git add frontend/components/region-card.tsx
git commit -m "feat: add RegionCard component with probability-driven typography

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: 新建 region-card-grid.tsx

**Files:**
- Create: `frontend/components/region-card-grid.tsx`

- [ ] **Step 1: 创建组件**

```typescript
// frontend/components/region-card-grid.tsx
import type { RegionDashboardCard } from "@/lib/types";
import { RegionCard } from "@/components/region-card";

export function RegionCardGrid({ regions }: { regions: RegionDashboardCard[] }) {
  return (
    <section>
      <h2 className="font-sans text-lg font-semibold text-rm-metal-textLight mb-4">
        赛区推演概览
      </h2>
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {regions.map((region) => (
          <RegionCard key={region.regionSlug} region={region} />
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/region-card-grid.tsx
git commit -m "feat: add RegionCardGrid component

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 6: 新建 contender-section.tsx

**Files:**
- Create: `frontend/components/contender-section.tsx`

- [ ] **Step 1: 创建组件**

```typescript
// frontend/components/contender-section.tsx
import type { OverviewTeam } from "@/lib/types";
import { cn } from "@/lib/utils";

function elo(value: number) {
  return value.toFixed(1);
}

function pct(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function tierLabel(index: number) {
  if (index < 4) return "T1";
  if (index < 8) return "T2";
  return "T3";
}

export function ContenderSection({ contenders }: { contenders: OverviewTeam[] }) {
  if (!contenders || contenders.length === 0) return null;

  return (
    <section>
      <h2 className="font-sans text-lg font-semibold text-rm-metal-textLight mb-4">
        全国冠军争夺者
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {contenders.map((team, idx) => (
          <div
            key={team.teamKey}
            className="bg-rm-metal-raised border border-rm-metal-border px-4 py-3
                       hover:border-rm-blue/20 transition-colors duration-200"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-mono text-[10px] text-rm-metal-textFaint tracking-widest">
                {tierLabel(idx)} · 全国 #{idx + 1}
              </span>
              <span className="font-mono text-[10px] text-rm-metal-textMuted">
                {team.regionName}
              </span>
            </div>
            <div className="font-sans text-base font-semibold text-rm-metal-textLight mb-3 truncate">
              {team.collegeName}
            </div>
            <div className="flex justify-between items-end pt-2 border-t border-rm-metal-border">
              <div>
                <div className="text-[9px] text-rm-metal-textFaint tracking-widest">战力</div>
                <div className="font-mono text-sm text-rm-metal-textLight">{elo(team.mu0)}</div>
              </div>
              <div className="text-right">
                <div className="text-[9px] text-rm-metal-textFaint tracking-widest">夺冠率</div>
                <div className={cn(
                  "font-mono text-sm",
                  team.probabilities.champion > 0.1
                    ? "text-rm-metal-textLight font-semibold"
                    : "text-rm-metal-textMuted",
                )}>
                  {pct(team.probabilities.champion)}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/contender-section.tsx
git commit -m "feat: add ContenderSection component

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 7: 新建 comparison-section.tsx

**Files:**
- Create: `frontend/components/comparison-section.tsx`

- [ ] **Step 1: 创建组件**

```typescript
// frontend/components/comparison-section.tsx
import type { RegionStrengthRow } from "@/lib/types";

function elo(value: number) {
  return value.toFixed(1);
}

function pct(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

export function ComparisonSection({ strengths }: { strengths: RegionStrengthRow[] }) {
  if (!strengths || strengths.length === 0) return null;

  return (
    <section>
      <h2 className="font-sans text-lg font-semibold text-rm-metal-textLight mb-4">
        赛区实力对比
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-rm-metal-border text-rm-metal-textFaint font-mono text-[10px] uppercase tracking-widest">
              <th className="py-3 px-3 font-bold">赛区</th>
              <th className="py-3 px-3 font-bold text-right">强度指数</th>
              <th className="py-3 px-3 font-bold text-right">四强均ELO</th>
              <th className="py-3 px-3 font-bold text-right">八强均ELO</th>
              <th className="py-3 px-3 font-bold text-right">中位ELO</th>
              <th className="py-3 px-3 font-bold text-right">头号种子夺冠率</th>
            </tr>
          </thead>
          <tbody className="font-mono divide-y divide-rm-metal-border/50">
            {strengths.map((row) => (
              <tr
                key={row.regionSlug}
                className="hover:bg-rm-metal-raised transition-colors"
              >
                <td className="py-3 px-3 font-sans font-semibold text-sm text-rm-metal-textLight">
                  {row.regionName}
                </td>
                <td className="py-3 px-3 text-right">
                  <span className="font-bold text-rm-metal-textLight">
                    {row.powerIndex.toFixed(1)}
                  </span>
                </td>
                <td className="py-3 px-3 text-right text-rm-metal-textMuted">
                  {elo(row.top4AverageElo)}
                </td>
                <td className="py-3 px-3 text-right text-rm-metal-textMuted">
                  {elo(row.top8AverageElo)}
                </td>
                <td className="py-3 px-3 text-right text-rm-metal-textFaint">
                  {elo(row.medianElo)}
                </td>
                <td className="py-3 px-3 text-right">
                  <span className="bg-rm-metal-dark border border-rm-metal-border px-2 py-0.5 text-rm-metal-textMuted">
                    {pct(row.favoriteChampionProbability)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/comparison-section.tsx
git commit -m "feat: add ComparisonSection component

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 8: 新建 overview-footer.tsx

**Files:**
- Create: `frontend/components/overview-footer.tsx`

- [ ] **Step 1: 创建组件**

```typescript
// frontend/components/overview-footer.tsx
export function OverviewFooter() {
  return (
    <footer className="text-center font-mono text-[9px] text-rm-metal-textFaint/40 pt-4 pb-12 tracking-widest">
      RoboMaster 2026 机甲大师区域赛战术测算系统 / TrueSkill 2 + 蒙特卡洛预测引擎
    </footer>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/overview-footer.tsx
git commit -m "feat: add OverviewFooter component

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 9: 重写 overview-page.tsx 为薄壳数据加载层

**Files:**
- Modify: `frontend/components/overview-page.tsx`

- [ ] **Step 1: 替换为薄壳组件**

将整个文件替换为：

```typescript
// frontend/components/overview-page.tsx
"use client";

import { useEffect, useState } from "react";
import { getOverview } from "@/lib/api";
import { buildOverviewDashboard } from "@/lib/overview-builders";
import type { OverviewDashboard } from "@/lib/types";

import { OverviewHero } from "@/components/overview-hero";
import { RegionCardGrid } from "@/components/region-card-grid";
import { ContenderSection } from "@/components/contender-section";
import { ComparisonSection } from "@/components/comparison-section";
import { OverviewFooter } from "@/components/overview-footer";

export function OverviewPage() {
  const [dashboard, setDashboard] = useState<OverviewDashboard | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let canceled = false;
    getOverview()
      .then((res) => {
        if (!canceled) setDashboard(buildOverviewDashboard(res));
      })
      .catch((err) => {
        if (!canceled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => { canceled = true; };
  }, []);

  if (error) {
    return (
      <div className="text-rm-red p-4 bg-rm-red/5 border border-rm-red/30 font-mono text-sm">
        数据加载失败：{error}
      </div>
    );
  }

  if (!dashboard) {
    return (
      <div className="flex flex-col items-center justify-center py-20 animate-pulse">
        <div className="w-8 h-8 border-4 border-rm-blue/30 border-t-rm-blue rounded-full animate-spin mb-4" />
        <span className="font-machine text-rm-blue tracking-widest uppercase text-xs">
          接入预测引擎...
        </span>
      </div>
    );
  }

  return (
    <div className="page-background page-grid min-h-screen">
      <div className="max-w-screen-2xl mx-auto px-4 py-8 space-y-10">
        <OverviewHero generatedLabel={dashboard.generatedLabel} />
        <RegionCardGrid regions={dashboard.regions} />
        <ContenderSection contenders={dashboard.contenders} />
        <ComparisonSection strengths={dashboard.regionStrength} />
        <OverviewFooter />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript 编译检查**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep -v "next-env.d.ts" | head -20
```

Expected: 无新错误。

- [ ] **Step 3: Commit**

```bash
git add frontend/components/overview-page.tsx
git commit -m "refactor: rewrite OverviewPage as thin data-loading shell

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 10: 新建 rankings-hero.tsx

**Files:**
- Create: `frontend/components/rankings-hero.tsx`

- [ ] **Step 1: 创建组件**

```typescript
// frontend/components/rankings-hero.tsx
import Link from "next/link";

export function RankingsHero({
  generatedLabel,
}: {
  generatedLabel: string;
}) {
  return (
    <header className="sticky top-0 z-10 border-b border-rm-metal-border bg-rm-metal-dark/90 backdrop-blur-md">
      <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="flex items-center gap-2 text-rm-metal-textMuted hover:text-rm-metal-textLight transition-colors group"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-4 h-4 group-hover:-translate-x-1 transition-transform"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
            <span className="text-xs tracking-widest font-bold uppercase">
              返回总控台
            </span>
          </Link>
          <div className="h-5 w-px bg-rm-metal-border" />
          <h1 className="font-machine text-lg font-bold tracking-widest text-rm-metal-textLight">
            全局 ELO 排名
          </h1>
        </div>
        <span className="font-mono text-[10px] text-rm-metal-textFaint">
          {generatedLabel}
        </span>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/rankings-hero.tsx
git commit -m "feat: add RankingsHero component

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 11: 新建 rankings-column.tsx

**Files:**
- Create: `frontend/components/rankings-column.tsx`

- [ ] **Step 1: 创建组件**

```typescript
// frontend/components/rankings-column.tsx
import Link from "next/link";
import type { EloRankingRow, RegionSlug } from "@/lib/types";
import { buildRegionHref } from "@/lib/region-config";
import { cn } from "@/lib/utils";

function pct(value: number) {
  if (value < 0.001 && value > 0) return "<0.1%";
  return `${(value * 100).toFixed(1)}%`;
}

function elo(value: number) {
  return value.toFixed(1);
}

/** 概率用字重+透明度表达，不用颜色 */
function probClass(value: number) {
  if (value >= 0.8) return "text-rm-metal-textLight font-bold";
  if (value >= 0.4) return "text-rm-metal-textLight font-semibold";
  if (value >= 0.1) return "text-rm-metal-textMuted";
  return "text-rm-metal-textFaint";
}

function RankingRow({
  regionSlug,
  row,
  globalRank,
}: {
  regionSlug: RegionSlug;
  row: EloRankingRow;
  globalRank: number;
}) {
  const playoffUrl = buildRegionHref(regionSlug, "playoff", { highlight: row.teamKey });

  return (
    <Link
      href={playoffUrl}
      className="group flex flex-col p-2.5 mb-1 bg-rm-metal-raised border border-rm-metal-border
                 hover:border-rm-blue/20 transition-colors duration-200"
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-3">
          {/* 赛区排名 */}
          <div className="flex flex-col items-center w-7">
            <span className="font-mono text-sm font-bold text-rm-metal-textLight">
              {row.rankInRegion}
            </span>
            <span className="text-[8px] text-rm-metal-textFaint">赛区</span>
          </div>
          {/* 全国排名 */}
          <div className="flex flex-col items-center w-7 border-l border-rm-metal-border pl-2">
            <span className="font-mono text-sm font-bold text-rm-metal-textLight">
              {globalRank}
            </span>
            <span className="text-[8px] text-rm-metal-textFaint">全国</span>
          </div>
          <div className="ml-1">
            <div className="text-sm font-semibold text-rm-metal-textLight truncate max-w-[120px]">
              {row.collegeName}
            </div>
            <div className="text-[10px] text-rm-metal-textFaint tracking-wider">
              {row.teamName}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[9px] text-rm-metal-textFaint tracking-widest">ELO</div>
          <div className="font-mono text-sm text-rm-metal-textLight">{elo(row.mu0)}</div>
        </div>
      </div>

      {/* 概率三栏 — 用排版层级而非颜色 */}
      <div className="grid grid-cols-3 gap-2 pt-2 border-t border-rm-metal-border">
        <div className="text-center">
          <div className="text-[9px] text-rm-metal-textFaint tracking-widest">复活赛</div>
          <div className={cn("text-xs font-mono mt-0.5", probClass(row.repechageProbability))}>
            {pct(row.repechageProbability)}
          </div>
        </div>
        <div className="text-center border-l border-rm-metal-border">
          <div className="text-[9px] text-rm-metal-textFaint tracking-widest">国赛</div>
          <div className={cn("text-xs font-mono mt-0.5", probClass(row.nationalProbability))}>
            {pct(row.nationalProbability)}
          </div>
        </div>
        <div className="text-center border-l border-rm-metal-border">
          <div className="text-[9px] text-rm-metal-textFaint tracking-widest">夺冠</div>
          <div className={cn("text-xs font-mono mt-0.5", probClass(row.championProbability))}>
            {pct(row.championProbability)}
          </div>
        </div>
      </div>
    </Link>
  );
}

export function RankingsColumn({
  regionSlug,
  regionName,
  teamCount,
  topTeam,
  top8AverageElo,
  rows,
  globalRanks,
}: {
  regionSlug: RegionSlug;
  regionName: string;
  teamCount: number;
  topTeam: string;
  top8AverageElo: number;
  rows: EloRankingRow[];
  globalRanks: Map<string, number>;
}) {
  return (
    <div className="flex flex-col bg-rm-metal-raised border border-rm-metal-border">
      {/* 列头部 */}
      <div className="px-4 py-3 border-b border-rm-metal-border">
        <h2 className="font-sans text-base font-semibold text-rm-metal-textLight mb-2">
          {regionName}
        </h2>
        <div className="space-y-1 font-mono text-[10px]">
          <div className="flex justify-between">
            <span className="text-rm-metal-textFaint">赛区天花板</span>
            <span className="text-rm-metal-textMuted">{topTeam}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-rm-metal-textFaint">八强均ELO</span>
            <span className="text-rm-metal-textMuted">{elo(top8AverageElo)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-rm-metal-textFaint">队伍集群</span>
            <span className="text-rm-metal-textMuted">{teamCount} 支</span>
          </div>
        </div>
      </div>

      {/* 队伍列表 */}
      <div className="flex flex-col p-2">
        <div className="flex justify-between px-2 pb-2 text-[10px] tracking-widest text-rm-metal-textFaint font-bold border-b border-rm-metal-border/50 mb-1">
          <span>队伍 / 排名</span>
          <span>概率推演</span>
        </div>
        {rows.map((row) => (
          <RankingRow
            key={row.teamKey}
            regionSlug={regionSlug}
            row={row}
            globalRank={globalRanks.get(row.teamKey) ?? 0}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/rankings-column.tsx
git commit -m "feat: add RankingsColumn component with typography-driven probabilities

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 12: 新建 rankings-columns.tsx

**Files:**
- Create: `frontend/components/rankings-columns.tsx`

- [ ] **Step 1: 创建组件**

```typescript
// frontend/components/rankings-columns.tsx
import { useMemo } from "react";
import type { EloRankingSection } from "@/lib/types";
import { RankingsColumn } from "@/components/rankings-column";

export function RankingsColumns({ sections }: { sections: EloRankingSection[] }) {
  const globalRanks = useMemo(() => {
    const allTeams = sections.flatMap((s) => s.rows);
    allTeams.sort((a, b) => b.mu0 - a.mu0);
    const ranks = new Map<string, number>();
    allTeams.forEach((team, i) => ranks.set(team.teamKey, i + 1));
    return ranks;
  }, [sections]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
      {sections.map((section) => (
        <RankingsColumn
          key={section.regionSlug}
          regionSlug={section.regionSlug}
          regionName={section.regionName}
          teamCount={section.teamCount}
          topTeam={section.topTeam?.collegeName ?? "待定"}
          top8AverageElo={section.top8AverageElo}
          rows={section.rows}
          globalRanks={globalRanks}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/rankings-columns.tsx
git commit -m "feat: add RankingsColumns component

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 13: 重写 elo-rankings-page.tsx 为薄壳数据加载层

**Files:**
- Modify: `frontend/components/elo-rankings-page.tsx`

- [ ] **Step 1: 替换为薄壳组件**

将整个文件替换为：

```typescript
// frontend/components/elo-rankings-page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { getOverview } from "@/lib/api";
import { buildEloRankingsDashboard } from "@/lib/overview-builders";
import type { OverviewResponse } from "@/lib/types";

import { RankingsHero } from "@/components/rankings-hero";
import { RankingsColumns } from "@/components/rankings-columns";

export function EloRankingsPage() {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getOverview()
      .then((payload) => {
        setData(payload);
        setError(null);
      })
      .catch((err: Error) => {
        setError(err.message);
      });
  }, []);

  const dashboard = useMemo(
    () => (data ? buildEloRankingsDashboard(data) : null),
    [data],
  );

  return (
    <div className="page-background page-grid min-h-screen">
      <RankingsHero generatedLabel={dashboard?.generatedLabel ?? "同步中..."} />

      <main className="relative z-10 max-w-[1600px] mx-auto px-4 py-8">
        {error ? (
          <div className="p-4 bg-rm-red/5 border border-rm-red/30 text-rm-red font-mono text-sm mb-8">
            数据加载失败：{error}
          </div>
        ) : !dashboard ? (
          <div className="flex flex-col items-center justify-center py-20 text-rm-metal-textMuted">
            <div className="w-8 h-8 border-4 border-rm-blue/30 border-t-rm-blue rounded-full animate-spin mb-4" />
            <span className="font-machine tracking-widest uppercase text-xs">
              建立 ELO 并行流连接...
            </span>
          </div>
        ) : (
          <RankingsColumns sections={dashboard.sections} />
        )}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript 编译检查**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep -v "next-env.d.ts" | head -20
```

Expected: 无新错误。

- [ ] **Step 3: Commit**

```bash
git add frontend/components/elo-rankings-page.tsx
git commit -m "refactor: rewrite EloRankingsPage as thin data-loading shell

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 14: Verification — 编译 + 测试 + 开发服务器

**Files:** 无新建，验证所有改动。

- [ ] **Step 1: TypeScript 全量编译**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep -v "next-env.d.ts"
```

Expected: 无任何错误输出。

- [ ] **Step 2: 运行现有测试**

```bash
cd frontend && npx vitest run 2>&1
```

Expected: 所有已有测试通过（无新增测试，现有测试应在该重构中不变）。

- [ ] **Step 3: 启动开发服务器检查页面**

```bash
cd frontend && npm run dev &
# 等待启动后，检查：
# - http://localhost:3000/ — 主页渲染正常，红蓝微光背景可见，三栏卡片正确，无实时指挥中心
# - http://localhost:3000/elo-rankings — 三栏排名显示正常，概率无彩色标签
# - http://localhost:3000/regions/south_region — 区域工作区正常渲染，颜色未受影响
```

- [ ] **Step 4: Commit verification results (if any fixes)**

```bash
git status
# 如果有修复，提交
```

---

## 文件变更汇总

| 操作 | 文件 |
|------|------|
| Modify | `frontend/tailwind.config.ts` |
| Modify | `frontend/app/globals.css` |
| Modify | `frontend/components/overview-page.tsx` |
| Modify | `frontend/components/elo-rankings-page.tsx` |
| Create | `frontend/components/overview-hero.tsx` |
| Create | `frontend/components/region-card.tsx` |
| Create | `frontend/components/region-card-grid.tsx` |
| Create | `frontend/components/contender-section.tsx` |
| Create | `frontend/components/comparison-section.tsx` |
| Create | `frontend/components/overview-footer.tsx` |
| Create | `frontend/components/rankings-hero.tsx` |
| Create | `frontend/components/rankings-column.tsx` |
| Create | `frontend/components/rankings-columns.tsx` |
