# 主页 & ELO 排名页小重构设计

日期：2026-04-30

## Context

当前主页（overview-page.tsx，672行）和 ELO 排名页（elo-rankings-page.tsx，281行）存在三个问题：

1. **颜色过多**：tailwind 配置中定义了 10+ 种语义色（红/蓝/绿/琥珀/紫/橙/黄/死灰...），它们在页面上混合使用，互相争夺注意力，导致缺乏清晰的视觉层次。
2. **逻辑过于集中**：overview-page.tsx 在一个组件中混合了数据加载、实时指挥中心（已存根化）、区域卡片网格（含完整战术阵型表）、全球竞争者、区域比较、页脚等全部内容，672 行难以维护。
3. **可读性差**：颜色驱动信息层级而非排版驱动，部分颜色对队伍有不当暗示（红色=淘汰/危险，蓝色=晋级/安全）。

参考 VLR.gg、HLTV.org 等成熟电竞赛事网站的信息架构和配色方案，进行小范围重构。

范围：仅主页（overview-page.tsx）和 ELO 排名页（elo-rankings-page.tsx）。区域工作区（region-workspace.tsx）不动，但作为风格参考。

## 一、色彩体系

### 核心原则

- **红蓝** = 品牌对抗色 + UI 交互色（装饰背景、链接），不对队伍做"好/坏"评判
- **绿/琥珀** = 仅描述赛程状态（比赛已确认/进行中），不是"队伍稳进/队伍危险"
- **概率** = 用排版层级（字重、字号、透明度）表达，数字本身说话

### 色板定义

**品牌色：**
- `rm.red.DEFAULT` `#E8302A` — 装饰渐变、红方标记、hover 状态
- `rm.red.glow` `rgba(232,48,42,0.7)` — 发光效果（保留）
- `rm.red.dim` `rgba(232,48,42,0.12)` — 背景微光（保留）
- `rm.blue.DEFAULT` `#2A9FFF` — 装饰渐变、蓝方标记、链接色
- `rm.blue.glow` `rgba(42,159,255,0.7)` — 发光效果（保留）
- `rm.blue.dim` `rgba(42,159,255,0.12)` — 背景微光（保留）

**赛程状态色（仅描述比赛层级）：**
- `rm.status.confirmed` `#00E878` — 赛程确认/比赛已完赛
- `rm.status.pending` `#FFB000` — 比赛进行中/即将开始

**灰阶（承载信息层级）：**
- `rm.metal.dark` `#040608` — 页面底色
- `rm.metal.raised` `#0A0A0C` — 卡片底层
- `rm.metal.panel` `#0D0D0F` — 卡片面板
- `rm.metal.border` `#1E1E20` — 边框/分割线
- `rm.metal.textLight` `#E2E8F0` — 主文字（标题、重要数据）
- `rm.metal.textMuted` `#94A3B8` — 次文字（说明、副标题）
- `rm.metal.textFaint` `#64748B` — 弱文字（辅助信息、时间戳）

**移除的颜色：**
- `rm.status.safe` / `upset` / `deviation` / `prediction` / `scheduled` / `dead`
- `rm.result.winner` / `winnerGlow` / `loser` / `neutral`

### 背景统一

主页和 ELO 排名页使用与区域工作区一致的 `canvas-background`（主视图.png + 暗色叠加 + 红蓝微光），形成跨页面的一体感。

## 二、组件拆分

### 主页

```
overview-page.tsx (~60行，纯数据加载壳)
├── overview-hero.tsx
│   — 页面标题 "RoboMaster 胜率预测总控台"
│   — 一行系统副标题
│   — 红蓝微光背景条装饰
├── region-card-grid.tsx
│   └── region-card.tsx (×3, 可复用)
│       — 赛区名 + 实时连接状态点
│       — 核心指标行（队伍数 / 头号种子 / 国赛名额）
│       — 队伍概率列表（前5支，按国赛概率降序）
│       — "进入赛区沙盘 →" 主链接 + 快捷视图链接
├── contender-section.tsx
│   — 全国冠军争夺者梯队
├── comparison-section.tsx
│   — 赛区实力对比表
└── overview-footer.tsx
    — 底部系统标识
```

**移除：**
- 实时指挥中心面板（6个存根任务桶）
- 区域卡片内的完整战术阵型表 → 改为链接到区域画布
- 4行系统简报 → 合并为 hero 区一句话
- MechCard 装饰容器 → 统一使用扁平卡片

### ELO 排名页

```
elo-rankings-page.tsx (~40行，纯数据加载壳)
├── rankings-hero.tsx
│   — 页面标题 "全局 ELO 排名"
│   — 副标题说明
└── rankings-columns.tsx
    └── rankings-column.tsx (×3, 可复用)
        — 赛区名表头
        — 队伍行：区排/全排 + 队名 + ELO + 概率值
```

**改动：**
- 概率不再用彩色标签，改用排版层级区分
- 统一灰阶表格样式

## 三、排版层级

| 层级 | 字体 | 字号 | 字重 | 颜色 | 用途 |
|------|------|------|------|------|------|
| H1 | machine | xl/2xl | bold | textLight | 页面标题 |
| H2 | sans | lg | semibold | textLight | 区块标题 |
| H3 | sans | base | semibold | textLight | 卡片标题 |
| Body-强 | sans | sm | semibold | textLight | 高概率数据（>70%） |
| Body-中 | sans | sm | normal | textMuted | 中概率数据（30-70%） |
| Body-弱 | sans | xs | normal | textFaint | 低概率数据（<30%） |
| 数字 | mono | sm | medium | textLight | ELO、比分 |
| 链接 | sans | xs/sm | medium | blue.DEFAULT | 导航链接 |
| 状态点 | — | 4px | — | confirmed/pending | 实时连接状态 |

## 四、页面背景统一

主页和 ELO 排名页的 `<main>` 区域增加与区域工作区一致的 `canvas-background` + `canvas-grid`：

```css
.page-background {
  background-image:
    radial-gradient(ellipse at 30% 50%, rgba(232, 48, 42, 0.04) 0%, transparent 55%),
    radial-gradient(ellipse at 70% 50%, rgba(42, 159, 255, 0.04) 0%, transparent 55%),
    linear-gradient(rgba(4, 6, 8, 0.92), rgba(4, 6, 8, 0.92)),
    url('/主视图.png');
}
.page-grid {
  background-image:
    linear-gradient(to right, rgba(255, 255, 255, 0.025) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(255, 255, 255, 0.025) 1px, transparent 1px);
  background-size: 64px 64px;
}
```

## 五、文件变更清单

### 修改
1. `frontend/tailwind.config.ts` — 精简颜色定义，新增 `rm.metal.raised`、重命名文本色为 `textLight/textMuted/textFaint`，移除多余状态/结果色
2. `frontend/app/globals.css` — 添加 `.page-background` / `.page-grid` 类，移除不再使用的 CSS 类
3. `frontend/components/overview-page.tsx` — 重写为薄壳数据加载层
4. `frontend/components/elo-rankings-page.tsx` — 重写为薄壳数据加载层

### 新增
5. `frontend/components/overview-hero.tsx` — 主页标题区
6. `frontend/components/region-card.tsx` — 单张区域卡片
7. `frontend/components/region-card-grid.tsx` — 三栏区域卡片网格
8. `frontend/components/contender-section.tsx` — 全国冠军争夺者
9. `frontend/components/comparison-section.tsx` — 赛区实力对比表
10. `frontend/components/overview-footer.tsx` — 页脚
11. `frontend/components/rankings-hero.tsx` — ELO 排名标题
12. `frontend/components/rankings-column.tsx` — 单栏排名列表
13. `frontend/components/rankings-columns.tsx` — 三栏排名布局

### 不变
- `frontend/components/root-nav.tsx` — 导航栏保持不变（颜色清理由 tailwind 配置自动继承）
- `frontend/lib/overview-builders.ts` — 数据构建逻辑不变
- 所有 `frontend/lib/*.ts` — 库文件不变
- 区域工作区相关全部文件不变

## 六、风险与约束

### 向后兼容策略

区域工作区（region-workspace.tsx 及相关 canvas 组件）不动，但 tailwind 配置是全局的。变更策略：

1. **现有颜色值保留不动**：`rm.metal.dark/panel/border/text` 的值不变，确保区域工作区不受影响
2. **新增色键**：通过新增而非重命名的方式扩展灰阶和状态色：
   - 新增 `rm.metal.raised: "#0A0A0C"` — 卡片底层
   - 新增 `rm.metal.textLight: "#E2E8F0"` — 比当前 `text` 更亮，用于主文字
   - 新增 `rm.metal.textMuted: "#94A3B8"` — 次文字
   - 新增 `rm.metal.textFaint: "#64748B"` — 弱文字
   - 新增 `rm.status.confirmed: "#00E878"` — 替代原 `safe` 的语义
   - 新增 `rm.status.pending: "#FFB000"` — 替代原 `warn` 的语义
3. **移除多余颜色需 grep 确认**：被移除的颜色（safe/warn/upset/deviation/prediction/scheduled/dead/winner/loser/neutral）需要 grep 全项目确认区域工作区无引用。若有引用则保留值但标记 deprecated。
4. 移除 `mech-card` 依赖：仅 overview-page 和 elo-rankings-page 中移除，ui/mech-card.tsx 文件本身保留不动（区域工作区可能引用）

## 七、Verification

1. `npm run dev` 启动开发服务器，检查主页 `/`：
   - Hero 区显示正常，红蓝背景微光可见
   - 三栏区域卡片渲染正确，概率层级清晰
   - 争夺者区域和实力对比表显示正常
   - 移除的实时指挥中心不再出现
2. 检查 `/elo-rankings`：
   - 三栏排名显示正常，概率无彩色标签
3. `npx vitest run` 确认现有测试通过
4. 对比区域工作区 `/regions/south_region` 确认 tailwind 颜色变更未破坏画布页面
5. TypeScript 编译无错误：`npx tsc --noEmit`
