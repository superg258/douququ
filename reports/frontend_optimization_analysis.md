# 前端页面优化与美化分析报告

> 分支：`frontend-optimization-analysis`
> 方法：五个页面并行代码走查（5 个 explore agent）+ 本地实跑截图（桌面 1440 / 移动 390，全页面）+ 浏览器运行时探针（document.fonts / computed style / 溢出检测）。
> 前提：**保持现有"机甲战术 HUD"设计语言**（纯黑底、红 #E8302A 蓝 #2A9FFF 对抗、金属灰面板、切角、发光、扫描线），不做风格迁移。

## 1. 设计系统现状盘点

已有风格资产（质量不错，应继续复用）：

- 色彩 token：`rm-red/blue`（含 glow/dim）、`rm-metal-*`（dark/raised/panel/card/border/4 级文字）、`rm-status-*`、`rm-result-*`（tailwind.config.ts:16-65）
- 形状语言：`clip-chamfer` 系列切角、`mech-panel`、`glass-sheet`（globals.css:72-83）
- 特效：`text-glow-*`、扫描线 keyframes、`canvas-background`（赛事背景图+85% 暗化）、tactical grid
- UI 原语：`MechCard`（切角面板）、`BattleBadge`（红蓝交战牌）
- 布局：`max-w-screen-2xl` 居中 + RootNav 吸顶

**核心结论：视觉风格的"骨架"是好的，最大问题是设计意图没有真正落地**——字体链断裂导致全站用 Arial 渲染，部分 token 被硬编码绕过，若干 CSS 类名是无效死类。美化工作的第一优先级不是"换皮"，而是"让设计生效"。

## 2. 全站级问题（跨页面）

### P0-1 字体链完全断裂（运行时探针实证）

- `tailwind.config.ts:73-75` 的 `font-sans/mono/machine` 引用 `var(--font-inter/roboto-mono/orbitron)`，**这三个变量全项目从未定义**；`layout.tsx:6-11` 只加载了 Quantico（`--font-quantico`）且 config 未引用。
- 探针实测：`h1`、`.font-machine`、`.font-mono`、`body` 的 computed font-family **全部为 `Arial, Helvetica, sans-serif`**。即全站的数字、表格、面板标题这些 HUD 感最强的位置全部回退 Arial。
- 唯一生效的是 hero 大标题的 `font-['Quantico']`（document.fonts 显示 Quantico 700 已加载）。
- `globals.css:5-11` 的 `Dji-Bold` @font-face 无任何引用（状态 unloaded，未产生下载，纯属死代码）。

**修复 = 最大的"美化"收益**：用 next/font 加载 Orbitron（数字/标题，对应 `--font-orbitron`）与 Roboto Mono（数据，对应 `--font-roboto-mono`），或把 `font-machine` 指向已加载的 Quantico；删除 Dji-Bold 声明。视觉风格不变，只是把设计还原。

### P0-2 token 绕行与语义色不一致

- 硬编码 hex 散布：`#05070c`/`#0a0a0f`（workspace-stage.tsx:28、forecast-center-page.tsx:567 等）、`#A0A0B0/#808080/#F0F0F0` 系列（canvas-card.tsx:162-169,550-567）、hero 的 8 种金色（overview-hero.tsx:7-8）。
- 语义色分裂：同是"爆冷红"，`rm-status-upset` = `#E8302A`（token），但图例/情报面板用 `#ef4444`（region-workspace.tsx:471,1094）、发光阴影用 `rgba(239,68,68)`（canvas-card.tsx:129,677）。
- `MechCard` 三个变体的阴影色值与 token 实际色对不上（ui/mech-card.tsx:18-20）。
- 首页复活赛表 ELO 数字用红色、全国赛表用金色（finals-overview-section）——红色语义是"红方/警报"，用在 Elo 数值上怪异。

**修复**：补 token（`rm.gold.*`、`rm-metal.canvas`、`rm-metal.textDim` 等），全部硬编码归位；爆冷红二选一（建议保留 `#E8302A`）；Elo 数值统一用 `textLight` 或赛事主题色。

### P0-3 失效样式与死代码

- `bg-rm-metal-panel/78`（finals-elo-rankings.tsx:191）不在 Tailwind 透明度刻度 → 规则不生成，行卡背景丢失只剩边框。
- 死类名：`animate-in fade-in slide-in-from-right-8`、`no-scrollbar`、`text-glow`、`text-glow-white`（region-workspace.tsx 多处）均无对应 CSS/插件，"以为有动画实际没有"。
- 死文件：`overview-model-recap.tsx` + `model-recap-panel.tsx`（375 行）、`rankings-column(s).tsx` + `buildEloRankingsDashboard`（318 行+lib）、`SouthSwissReplayList`（region-workspace.tsx:156-327，开关恒 false）、`REGION_ACCENT` 约一半键（team-profile-page.tsx:29-97）。
- 死交互：team-profile-page.tsx:505 的 `group-hover/btn` 找不到父级 `group/btn`；canvas-card.tsx:328,706 同值三元。

### P1-1 微字号与对比度

全站大量 `text-[7px]`/`text-[8px]` + `/50` 透明度灰字（canvas-card.tsx:348,403；prediction-signals.tsx:159,202；finals-overview-section.tsx:135,153,188；team-profile-page.tsx:468,477）。黑底下 `#71717A` 9px 达不到 WCAG AA（4.5:1）。建议微字号下限 10px、透明度档位上调，这不改变风格，只提升可读性。

### P1-2 伪实时与数据新鲜度

- Hero"系统运行正常 | 赛程已同步"是静态字符串（overview-page.tsx:11），与真实同步状态脱节。
- 各页均为挂载时一次性 fetch，无轮询（仅 region 页有 3 分钟轮询），但文案多处宣称"实时"。`selectSchedulePreview` 在渲染期调 `Date.now()`（finals-overview-section.tsx:99），不会随时间更新。
- 队伍页 seed/mode 硬编码 `20260414/"live"`（team-profile-page.tsx:272），从赛区 sim 模式点进来上下文断裂。

### P1-3 三态（加载/空/错误）不规范

- 错误态普遍只有一行文案、无重试按钮（finals-overview-section.tsx:347、forecast-center-page.tsx:566、elo-rankings-page.tsx:57、region-workspace.tsx:1112、team-profile-page.tsx:298）。
- 骨架屏固定高 `h-[34rem]` 与实际内容不符 → CLS（finals-overview-section.tsx:276）。
- 单接口失败整页报错（Promise.all 一损俱损，elo-rankings-page.tsx:25、forecast-center-page.tsx:404）。

### P1-4 可访问性（批量）

双 `<h1>`（RootNav vs 各页 hero）、嵌套 `<main>`（elo-rankings-page.tsx:55）、表头用 `<td>`（finals-overview-section.tsx:199）、激活链接无 `aria-current`、画布队伍行键盘不可达（canvas-card.tsx:482 `tabIndex={-1}`）、无 `focus-visible` 样式、全站无 `prefers-reduced-motion`（50 个无限粒子动画不可关闭）、tabs 缺方向键导航与正确 `tabpanel` 关联。

### P1-5 性能

- 画布 pan/zoom 每帧 setState 全量重渲染，`CanvasCardView`/`CanvasConnectorView` 未 memo（workspace-stage.tsx:538-550），回调引用不稳定。
- React 根级 wheel 监听是 passive，`onWheel` 里 `preventDefault()` 无效（workspace-stage.tsx:479，待实测确认）→ 改原生非 passive 监听。
- 首屏客户端 10,000 次蒙特卡洛（finals-overview-section.tsx:293）。
- elo 榜移动端/桌面端双 DOM 实例同时挂载（finals-elo-rankings.tsx:420-428）。
- 轮询在 sim 模式/页面隐藏时不暂停（region-workspace.tsx:672-694）。

## 3. 逐页观察与美化建议

> 截图存于 `output/screenshots/`（本地，gitignore），桌面/移动双视口。

### 3.1 首页 `/`

**现状**：hero（金色粒子 + 大标题 + CTA）→ 复活赛/全国赛双面板（指标 + 战力矩阵 + 入口）→ 页脚。整体成立，但桌面端 hero 右侧偏空、信息密度低；移动端战力矩阵表 ELO 列被裁进内部滚动条（页面本身无溢出，探针已验证）。

**优化（逻辑/可用性）**：状态去伪（§P1-2）；骨架按内容分区；错误态加重试；`Date.now()` 移入 effect；删双重容器（layout 已有 `max-w-screen-2xl`，overview-page.tsx:8 又包一层）。

**美化（保持风格）**：
- hero 右侧 CTA 卡升级为"下一场比赛情报条"（下一场时间/对阵/倒计时），填充空白；
- 两个赛事面板头部增加主题色 hairline + 阶段进度指示（小组赛→淘汰赛发光节点），与画布页视觉呼应；
- 战力矩阵前 3 名行内加主题色左描边，与 elo 榜 top3 处理统一；
- 金色粒子数移动端减半，且全部纳入 `prefers-reduced-motion` 开关。

### 3.2 预测中心 `/forecast-center`

**现状**：全视口画布 + 赛事背景图 + 分组卡片列 + 顶部两行工具栏 + 右侧情报抽屉。氛围最好的一页。问题：未排班卡片的 Elo/王牌占位虚线行占卡片近半面积（截图实证）；背景 ROBOMASTER 大字在卡片列间隙透出，略显嘈杂；情报面板未打开也常驻挂载。

**优化**：错误分级（overview 失败降级显示而非整页错误）；`useSearchParams` 替换手写 `window.location.search`（支持前进/后退）；memo + useCallback 解决 pan/zoom 全量重渲染；4 份拖拽判定逻辑合并为 `usePressGuard`；InspectorPanel 拆文件。

**美化**：
- 占位行折叠为单行"等待抽签"态（虚线框 + 微光），卡片瘦身；
- 卡片列后方加局部 radial 暗化（不改变背景图，只压对比），文字对比立升；
- 晋级路径连接器加发光流动动画（复用现有 `dash` keyframes），强调"晋级脉络"这一核心信息；
- 阶段 tabs 激活项加底部发光指示条，与 RootNav 激活语言统一。

### 3.3 Elo 战力榜 `/elo-rankings`

**现状**：复活赛/全国赛双榜（桌面并排、移动 tab 切换）。section 头（金色 small caps + 大标题 + 榜首 + 时间）观感不错，但头部区与表格之间有大段空白（截图实证）；行高约 110px 偏松；移动端队名 4 字即截断而行内右侧空间富余；双 sticky 头（RootNav 未排除本页 + RankingsHero）滚动时互相遮挡。

**优化**：RootNav 排除本页或 Hero 降级为非 sticky；修 `/78` 失效背景；tab 状态入 URL；桌面单一 DOM（去双实例）；删旧三列版死代码。

**美化**：
- top3 行金/银/铜描边 + 排名数字放大（机甲风的"授勋"感）；
- 行内加赛季 Elo 迷你趋势线（sparkline，主题色发光，契合 HUD 数据感）；
- 压缩行高、队名列加宽（解决移动端 4 字截断）；
- 表头行 sticky + 毛玻璃，长列表滚动不丢列语义。

### 3.4 队伍详情页 `/teams/[teamKey]`

**现状**：面包屑 → hero（队名）→ 新鲜度条 → 四指标卡 → 赛程路径/预测路径双栏。四指标卡是全站最精致的组件。问题：hero 面板空旷（只有队名 + 返回按钮）；预测路径空态与赛程路径 8 场并列时右栏塌陷失衡；装饰 div（铆钉/L 角/刻度）约 35 行 DOM 噪音。

**优化**：seed/mode 从 URL 贯通（对齐赛区页）；收敛 `REGION_ACCENT` 死配置与 6 处三元链；错误态加重试/返回；进度条加 `role="progressbar"`；「最终落位」卡字号与其他三卡对齐。

**美化**：
- hero 左侧加赛区主题色带 + 队伍编号大字（如 `A1`，Orbitron 发光），把空面板变成"队伍铭牌"；
- 预测路径空态改为赛季总结卡（最终排名 + 冠军徽记金色描边），空态也有仪式感；
- 时间线节点改为发光铆钉 + 胜/负主题色连线，强化"晋级之路"叙事；
- 赛程行整卡可点（与预测路径行行为对齐）。

### 3.5 赛区工作区 `/regions/[region]`

**现状**：功能最重的页面（6 视图 tab + 画布 + 搜索 + 情报抽屉 + 3 分钟轮询）。移动端 bracket 卡片可读性好。问题：1208 行单文件 + 10 个 useEffect；图例浮层移动端遮挡工具栏；轮询在 sim 模式/后台不暂停；非法 slug 静默回退。

**优化**：按 §2 P1-5 修轮询与 wheel；拆文件（Toolbar/InspectorPanel 三态/SearchModal/LegendPopover）；爆冷判定逻辑三处合一；SearchModal 补 `role="dialog"`/Esc/autoFocus。

**美化**：
- 图例浮层改底部抽屉（移动端）+ 遮罩点击关闭；
- 轮询状态点改为呼吸灯（`dot-pulse` 已有），与"模拟"静态标识区分；
- 搜索弹窗结果行加 hover 发光与键盘高亮，向画布情报面板看齐。

## 4. 全局美化方向（保持机甲 HUD 风）

1. **排版系统**：字体链修复后建立三级阶梯——`font-machine` 只用于大数字/标题/排名，`font-mono` 用于数据表/时间戳，正文用系统栈；数字加 `tabular-nums` 防跳动。
2. **色彩语义收敛**：红/蓝 = 对阵双方；金 = 冠军/榜首；绿 = 已确认/上涨；紫 = 偏离；橙 = 爆冷。写进 token 注释，新代码不许再造 hex。
3. **面板层级**：三层底色（page `#09090B` → panel `#16161A` → raised `#1C1C1F`）+ 1px border + 单一高光来源，避免多层 glow 叠加的"脏亮"。
4. **数据可视化增强**：概率/胜率全部走统一的发光进度条组件；Elo 走势 sparkline；晋级路径发光连线。HUD 感靠"数据发光"而非装饰发光。
5. **动效纪律**：常驻无限动画（粒子/扫描线/ping）减量 50%，交互反馈类动效（hover/focus/press）优先；全局 `prefers-reduced-motion` 兜底。
6. **三态规范**：统一的加载骨架（扫描线扫过）、空态（虚线切角框 + 一句话）、错误态（红色面板 + 重试按钮）组件，全站复用。
7. **移动端**：微字号 ≥10px；榜单行高压缩换队名列宽；画布页 minimap 保留；触控目标 ≥40px。

## 5. 优先级路线图

| 级别 | 事项 | 主要涉及文件 | 改风格？ |
|---|---|---|---|
| P0 | 修复字体链（Orbitron/Roboto Mono 上 next/font，删 Dji-Bold） | layout.tsx、tailwind.config.ts、globals.css | 否（还原设计） |
| P0 | 修 `bg-rm-metal-panel/78` 等失效样式与死类名 | finals-elo-rankings.tsx、region-workspace.tsx | 否 |
| P0 | token 补齐与硬编码归位（含金色、爆冷红统一） | tailwind.config.ts、canvas-card.tsx 等 | 否 |
| P0 | 删死代码（model-recap、旧 rankings-column、SouthSwissReplayList 等，约 900 行） | components/、lib/ | 否 |
| P1 | 错误态加重试 + 骨架防 CLS + 接口失败降级 | 各页 *-page.tsx | 否 |
| P1 | a11y 批量：h1/main 结构、aria-current、focus-visible、键盘可达、reduced-motion | 全站 | 否 |
| P1 | 双 sticky 头（elo 榜）、移动端队名截断、微字号下限 10px | root-nav.tsx、finals-elo-rankings.tsx 等 | 否 |
| P1 | 画布性能：memo/useCallback/原生 wheel/轮询暂停 | workspace-stage.tsx、canvas-*.tsx | 否 |
| P1 | URL 状态贯通（useSearchParams、队伍页 seed/mode、tab 入 URL） | forecast-center、team-profile、elo-rankings | 否 |
| P2 | 首页 hero 情报条、top3 授勋、sparkline、占位行折叠、三态组件 | 见 §3/§4 | 否（在既有语言内增强） |
| P2 | 文件拆分（forecast InspectorPanel、region-workspace 五块） | 两大单文件 | 否 |

## 附：探针实测记录

- `document.fonts`：Quantico 700 loaded；Dji-Bold 700 unloaded；无 Inter/Orbitron/Roboto Mono。
- computed font-family：h1 / .font-machine / .font-mono / body 全部 = `Arial, Helvetica, sans-serif`。
- 移动端 390px：`/`、`/elo-rankings`、`/teams/...` 均无页面级横向溢出（elo/首页表格为容器内滚动）。
- 待实测确认：workspace-stage `onWheel` 的 passive 警告（建议 dev 下滚轮缩放时看 console）。
