# EloSparkline 真实数据曲线重构

## 背景

当前 `EloSparkline` 组件只接收 `current`（当前 Elo）和 `delta`（赛季变化量）两个标量，用四个硬编码的人造中间点伪造一条波动曲线，不反映真实比赛数据。

本重构将 sparkline 数据源切换为实时赛果驱动的 Elo 轨迹。

## 适用范围

仅在**实时模式**（live mode）下启用真实轨迹。模拟模式不消费 sparkline。

## 数据采集

### 轨迹来源

`simulateFinalsLiveEvents()` 逐场处理真实赛果时，在每场比赛后记录双方队伍的最新 Elo 值，聚合成轨迹数组返回。

### 采集流程

```
初始化：每队轨迹 = [preseasonElo]
逐场处理真实赛果：
  red.eloAfter → 写入 redTeam 轨迹
  blue.eloAfter → 写入 blueTeam 轨迹
返回新增字段：
  eloTrajectoryByTeamKey: Record<string, number[]>
```

一支队伍的轨迹长度 = 1（季前起点）+ 该队已完成比赛数。一场比赛的红蓝双方各获得一个轨迹点。

### 降采样

消费方在传给 `EloSparkline` 之前，对轨迹等距采样到 5~6 个点（始终包含首尾），保证在小图上清晰美观。

采样策略：`points.length <= 6` 时全量保留；超过 6 个时等距取 6 个（含首尾）。

## 组件接口

```typescript
// 之前
EloSparkline({ current: number, delta: number, className?: string })

// 之后
EloSparkline({ points: number[], className?: string })
```

- `points`：按时间顺序排列的 Elo 值数组，长度 5~6，首 = 季前，尾 = 当前
- 视觉风格保持不变：SVG polyline + 末端圆点，上升绿/下降红/持平灰
- `points.length < 2` 时显示退化态：水平虚线 + 灰色单点

## 消费方改动

| 页面 | 文件 | 改动 |
|------|------|------|
| Elo 战力榜 | `finals-elo-rankings.tsx` | `buildRankingSection()` 从 simulation 读 `eloTrajectoryByTeamKey[teamKey]`，降采样，传入 sparkline |
| 预测中心情报面板 | `forecast-center-page.tsx` + `forecast-inspector-panel.tsx` | 从 `currentSimulation.eloTrajectoryByTeamKey` 读轨迹，降采样，传入 sparkline |

## 文件清单

| 文件 | 改动类型 |
|------|----------|
| `frontend/components/elo-sparkline.tsx` | 修改：入参替换，渲染逻辑保持不变 |
| `frontend/lib/finals-simulation.ts` | 修改：新增 `eloTrajectoryByTeamKey` 到返回值 |
| `frontend/components/finals-elo-rankings.tsx` | 修改：消费轨迹数据 |
| `frontend/components/forecast-inspector-panel.tsx` | 修改：消费轨迹数据 |
| `frontend/components/forecast-center-page.tsx` | 可能需透传轨迹数据 |
| `frontend/tests/` 相关测试 | 新增/修改：覆盖降采样、退化态 |
