# `rm-schedule` 参考优化修复文档

> 状态：待实施设计稿
>
> 编写日期：2026-07-29
>
> 本地审阅基线：`main` / `702946204450d943f7c93a4383de404aefeef288` 加当前未提交工作树
>
> 上游参考基线：`rm-schedule@0202abe`、`rm-schedule-ui@f1ef2b8`
>
> 目的：结合上游可取之处、`douququ` 当前实现和产品边界，作为后续修复、测试与验收依据。本文档本身不代表功能已经完成。

## 1. 已确认的产品决策

### 1.1 实时更新：恢复及时性，但必须无感

区域赛服务端目前约每 30 秒同步一次官方数据。前端曾采用约 30 秒刷新，但刷新时会出现加载层、画布重挂载和视口跳动，因此后来把周期延长到 3 分钟。

本轮决定不是简单把 `3 分钟` 改回 `30 秒`，而是分两步：

1. 先修复后台更新引起的整页/整画布刷新。
2. 只有无感更新验收通过后，才把前端改为每约 30 秒检查一次轻量数据版本。

目标是“数据能在约一分钟内跟上”，不是“每 30 秒让用户看到网站刷新一次”。

### 1.2 导出与分享：保留；OBS：明确不做

可以参考上游的确定性渲染、内容版本和失败回退思路，但当前产品只需要：

- 复制可复现当前语义状态的分享链接；
- 导出静态赛程图，用于留档、转发或报告；
- 导出结果明确标注实时、模拟或合成数据及其来源版本。

明确排除：

- OBS 页面、直播叠加层和透明背景；
- 面向导播的 iframe、安全区、触控光标模拟；
- 为直播持续刷新的 capture 模式；
- 仅为 OBS 引入的接口、参数和运维负担。

## 2. 修复范围与非目标

### 2.1 本文档覆盖

1. 无感实时刷新链路。
2. 前端请求去重、取消和旧数据保留。
3. 模拟结果缓存和数据版本契约。
4. 分享链接与静态图片导出。
5. API 契约、CI、readiness 和关键回归测试。
6. 后续赛事拓扑、简称展示和历史快照治理。

### 2.2 本轮不做

- 不把 Next.js/FastAPI 重写成 Vue/Go/Iris。
- 第一阶段不引入 WebSocket 或 SSE。
- 不把 live-sync 定时任务塞回 FastAPI 进程。
- 不引入开放图片代理、任意 URL 截图或无界内存缓存。
- 不让学校简称参与身份合并、Elo、晋级传播或历史对阵。
- 不允许 runtime 数据修改官方参考拓扑。
- 不建设 OBS 或直播导播功能。

## 3. 当前问题与根因

### 3.1 当前刷新链路

当前主要链路如下：

```text
服务端 live-sync 约 30 秒执行
        ↓
页面每 3 分钟请求一次 live-state 或完整业务 payload
        ↓
liveStateRefreshKey 变化
        ↓
区域页重新请求完整 simulation
        ↓
先 setSimulation(null)
        ↓
画布卸载并显示“正在生成预测图谱”
        ↓
新 simulation 构造新的 WorkspaceStage 对象
        ↓
WorkspaceStageView 以对象引用变化判断新画布并重新 fit
```

证据位置：

- 全局前端轮询常量当前为 3 分钟：`frontend/lib/realtime-polling.ts:1`。
- 区域页轮询 live state：`frontend/components/region-workspace.tsx:218-244`。
- 数据版本变化后先清空 simulation：`frontend/components/region-workspace.tsx:246-256`。
- simulation 为空时画布卸载并显示全屏加载态：`frontend/components/region-workspace.tsx:618-643`。
- `WorkspaceStageView` 当前以 `previousStage !== stage` 判断需要重新适配视口：`frontend/components/workspace-stage.tsx:181-194`。

因此，过去 30 秒刷新体验差的根因不是“30 秒太短”，而是背景更新仍被当成首次加载或页面导航处理。

区域页的卸载最明显，但共享画布判断也影响决赛预测中心：finals 轮询每次成功都会写入新的 events 对象、重建 stage；即使赛程语义未变化，`previousStage !== stage` 仍会重新 fit。highlight 自动居中 effect 也依赖 stage 对象，可能再次移动视口。

### 3.2 `live-state` 目前不是轻量版本接口

`/api/regions/{region}/live-state` 当前同时返回：

- 完整 `currentSnapshot`；
- 完整 `matchLedger`；
- `teamIndex`；
- 数据源状态和 artifact version。

构造位置为 `backend/app/service.py:902-1037`。直接把这个端点改成 30 秒轮询，会重复传输和解析大对象，不能作为最终方案。

同时，前端的 `liveStateRefreshKey` 包含 `generatedAt` 等字段，见 `frontend/lib/realtime.ts:83-96`。后续应使用“赛事数据语义发生变化”的稳定 revision，不能因为检查时间、文件 mtime 或数据年龄变化就触发重建。

### 3.3 上游 304 目前仍可能造成“假变化”

当前 `sync_rmuc_live.py` 在上游返回 304 后会读取旧 `schedule.json`，但随后仍会：

- 以新的 `fetched_at` 重新 normalize；
- 重写 `normalized_schedule.json`；
- 在存在完赛数据时重新发布 rating、ledger、snapshot 和 manifest；
- 重写 `sync_manifest.json`。

相关位置为 `scripts/sync_rmuc_live.py:961-1038`。而 `backend/app/artifacts.py:13-26` 的 artifact version 由文件 mtime 和大小组成。

这意味着“官方数据没有变化”和“本地 artifact version 没有变化”目前不是一回事。如果直接恢复 30 秒检查，可能每个同步周期都触发完整 payload 和 1200 samples 的区域 simulation 重算。

修复必须同时处理：

1. 上游未变化时不重写语义相同的 artifact。
2. revision 使用规范化内容摘要，而不是 mtime。
3. `lastCheckedAt`、`fetchedAt`、`sourceAgeSeconds` 等运维新鲜度字段与赛事数据 revision 分离。

如果运维仍需记录“最近检查时间”，应写入独立状态/指标，不应借此改写赛事 artifact 或推进 semantic revision。

### 3.4 当前 30 秒服务端同步并未覆盖所有赛事链路

仓库中的 `rmuc-live-sync.timer` 白天约每 30 秒运行一次，但对应 service 只执行 `scripts/sync_rmuc_live.py`，见：

- `deploy/systemd/rmuc-live-sync.timer:4-15`
- `deploy/systemd/rmuc-live-sync.service:6-14`

当前 Git 中没有同等明确的 finals 定时同步 unit。实施全局 revision 端点前，必须分别确认：

- 区域赛官方数据如何更新；
- 复活赛/全国赛 runtime 如何更新；
- 每类数据的实际更新频率和 source-of-truth；
- 没有自动同步的赛事不能在 UI 中宣称“30 秒实时更新”。

### 3.5 页面之间的刷新行为不统一

当前以下页面分别创建自己的轮询和加载生命周期：

- `forecast-center-page.tsx`
- `finals-overview-section.tsx`
- `elo-rankings-page.tsx`
- `prematch-center.tsx`
- `region-workspace.tsx`

存在的问题包括：

- 有的页面轮询完整 payload，有的先查 live state；
- 有的失败后保留旧数据，有的直接把已有内容替换成错误面板；
- 初次加载和后台刷新没有统一状态；
- 页面之间没有统一 stale-time、退避和 revision 失效机制。
- 决赛预测中心周期刷新 finals，但 overview/区域 Elo 基础只在初次加载时获取，且后台 finals 失败可能替换为整页错误。
- Elo 榜单个区域失败时会用成功子集替换旧的完整区域集合。
- 赛前中心刷新失败会用错误块替换仍可阅读的旧数据。
- 部分入口、下一场和队伍页仅首次加载，长时间打开后会无限期陈旧。

现有 `frontend/tests/realtime-polling.test.ts` 主要锁定 180 秒周期和 visibility 行为，尚未覆盖组件不卸载、viewport 保持、请求不重叠、后台失败保留和旧响应防覆盖。

### 3.6 请求去重仍有取消传播风险

`frontend/lib/api.ts` 当前按 path 共享在途 Promise，但共享请求也使用首个调用方的 `AbortSignal`。一个调用方卸载并 abort 时，可能把其他调用方正在复用的请求一起取消。

修复时必须把“网络请求去重”和“单个组件取消等待”分离。

此外，当前轮询 helper 使用固定 `setInterval`，不会等待上一次 Promise 完成；慢请求可能发生重叠。区域 simulation 请求也没有调用代次/version guard，快速切换赛区、seed 或连续 revision 时，较旧响应可能晚到并覆盖新状态。

### 3.7 当前没有真正的导出/分享实现

仓库目前没有以下能力：

- 静态图片导出；
- 导出任务或 manifest；
- `navigator.share` / 复制规范化深链；
- 专用的确定性导出渲染器。

现有优势是赛事、视图、模式、seed、阶段和 highlight 已较多地进入 URL，并且区域赛、复活赛、全国赛共用 `WorkspaceStageView`。导出应建立在这些既有契约上，而不是另造一套赛事图。

当前画布由 DOM 卡片、SVG 连接器、CSS 背景和 transform 共同组成，并不是单一 `<canvas>`；因此不能把 `canvas.toDataURL()` 当作直接实现方案。导出必须经过专用静态渲染或可靠的 DOM 截图链路。

### 3.8 其他基础问题

- FastAPI 路由仍普遍返回 `dict[str, Any]`，缺少显式 response model。
- 前端 `frontend/lib/types.ts` 为大型手写类型文件，后端与前端的部分枚举重复维护。
- 区域 simulation 请求会同步重新执行完整模拟，尚无完整结果缓存。
- `backend/app/service.py` 承担过多应用职责。
- Git 中没有完整 CI workflow，也没有现行 Playwright E2E。
- 区域赛和全国赛画布 builder 仍是两个大型硬编码文件。
- runtime raw 快照持续增长，但仍兼具历史回放价值，不能直接删除。

## 4. 修复必须保持的系统不变量

后续所有实现均须满足：

1. `live`、`sim`、`synthetic` 必须明确区分。
2. 官方参考拓扑不可被 runtime overlay 改写。
3. 区域赛、复活赛、全国赛继续复用共享画布交互层。
4. 背景刷新不得改变 URL 中的 `event/view/mode/stage/seed/highlight`。
5. 背景刷新不得重置拖拽位置、缩放、全屏、当前选择、Inspector 和搜索状态。
6. 请求失败时保留最后一次成功数据，不回退为空白或模拟数据。
7. 数据只有在完整 payload 成功并通过契约检查后才能原子替换。
8. 模拟导出必须显示 seed、模型版本和“模拟”标识。
9. 简称只能是 canonical identity 之后的展示字段。
10. 不为刷新功能引入新的外部写入或修改正式赛程。

## 5. P0：无感实时刷新设计

### 5.1 统一资源状态

前端实时资源统一采用以下状态，而不是只用 `data/null/error`：

| 状态 | 页面行为 |
|---|---|
| `initial-loading` | 仅首次没有任何成功数据时显示加载骨架 |
| `ready` | 正常展示最近一次成功数据 |
| `refreshing` | 继续展示旧数据；只在局部状态点显示后台同步 |
| `stale` | 刷新失败但已有旧数据；继续展示并显示“更新失败，当前为旧数据” |
| `failed-without-data` | 只有从未成功加载时才显示阻断式错误面板 |

严禁在后台刷新开始时把当前业务数据设为 `null`。

### 5.2 新增轻量 revision 契约

建议新增只描述变化的小型端点，例如：

```http
GET /api/live-revisions
If-None-Match: "<previous-etag>"
```

建议返回：

```json
{
  "regions": {
    "south_region": {
      "sourceStatus": "active",
      "dataRevision": "sha256:...",
      "sourceUpdatedAt": "2026-07-29T10:00:00+08:00",
      "completedOfficialMatches": 120,
      "confirmedOfficialMatches": 132
    }
  },
  "finals": {
    "dataRevision": "sha256:..."
  }
}
```

要求：

- `dataRevision` 由规范化赛程、赛果 ledger 和会影响展示/预测的 artifact 规范内容生成。
- 计算摘要前排除 `lastCheckedAt`、`fetchedAt`、`sourceAgeSeconds` 和纯运维生成时间。
- 仅 `sourceAgeSeconds`、检查时间或无语义 mtime 变化时，revision 不得改变。
- 上游 304 且辅助数据不变时，不重写 normalized/published artifact，不重跑 TS2 发布和 simulation。
- 区分 `scheduleRevision`、`ratingRevision`；页面可以使用二者组合后的 `dataRevision`，但调试时必须能定位是哪一层变化。
- 摘要必须覆盖真正影响目标页面的官方赛程、组排名、Elo、模型配置和小程序预测等输入，不能为了稳定而漏掉有效变化。
- 支持 `ETag` 和 `If-None-Match`；无变化返回 `304`。
- 使用 `Cache-Control: no-cache` 允许条件校验，不使用强制重复下载的 `no-store`。
- 全部响应保持在小型 JSON 范围内，不携带 snapshot、ledger 或完整队伍索引。

### 5.3 两级拉取

可见的 live 页面执行：

1. 首次进入时请求完整数据。
2. 后台只检查 revision。
3. revision 未变化：不更新 React state，不重建画布。
4. revision 变化：后台请求对应的完整 payload。
5. 完整 payload 成功且版本匹配：一次性原子替换。
6. 请求失败：保留旧数据并进入 `stale`，按退避策略重试。

同一 revision 的完整 payload 最多只允许一个在途请求。

调度器不能继续使用不关心 Promise 状态的固定 `setInterval`。应在本轮请求 settle 后再安排下一轮，保证同一资源无并发重叠，并为每次完整请求附加 generation/revision guard；只有仍属于当前赛区、seed、mode 和目标 revision 的响应才可提交。

### 5.4 修复区域画布重置

需要同时修改区域数据层和共享画布层。

区域页：

- 初次加载可以 `simulation === null`。
- 后台刷新必须保留现有 `simulation`，新结果先放入 pending/ref。
- 成功后一次性替换，不再显示全屏 spinner。
- revision 相同不得再次运行完整 simulation。

共享画布：

- 增加稳定的 `layoutKey` 或 `topologyKey`，例如 `regionSlug:view:mode:formatVersion`。
- 不再用 `WorkspaceStage` 对象引用变化判断是否重置 viewport。
- 普通比分、状态、Elo 或卡片内容更新只替换内容，不重新 fit。
- 真正切换赛事、视图、模式或拓扑版本时才允许重新 fit。
- 若拓扑新增节点，默认保留当前视口并 clamp 到新边界；通过轻提示告知“赛程图已更新”，由用户决定是否点击“查看新增”。
- 自动居中只响应 highlight 语义本身的变化，不再因 stage 对象替换重复执行。
- 未变化卡片和连接器尽量保持结构共享；连接器使用稳定 id，而不是数组序号，避免无意义全量重渲染。

必须保留：

- `viewport.scale/x/y`；
- 全屏状态；
- 已选队伍与比赛；
- highlight；
- Inspector 开关与滚动位置；
- 当前 URL。

### 5.5 刷新频率与退避

分阶段启用：

#### 阶段 A：结构修复期间

- 暂时保留当前 3 分钟周期。
- 完成状态机、revision、旧数据保留和 viewport 稳定测试。

#### 阶段 B：无感刷新验收后

- 可见 live 页面每约 30 秒检查一次 revision。
- 加入 0–5 秒随机抖动，避免所有客户端同时请求。
- 页面隐藏时暂停。
- 恢复可见时立即检查一次。
- sim 模式不进行 live revision 轮询。
- 连续失败采用 30 秒、60 秒、120 秒、最长 5 分钟退避；成功后恢复正常周期。

第一阶段不采用 10 秒轮询，也不引入 WebSocket/SSE。服务端本身约 30 秒同步，更高频检查不会带来相称收益。

### 5.6 其他页面迁移

按以下顺序迁移到共享刷新控制器：

1. `region-workspace`
2. `forecast-center`
3. `finals-overview-section`
4. `elo-rankings-page`
5. `prematch-center`

迁移要求：

- 首次加载和背景更新使用同一状态机。
- 多接口页面分别保留最后成功值，单接口失败不清空整页。
- 背景刷新不显示全页错误面板。
- 只有当前页面实际使用的数据 revision 变化时才请求完整 payload。

### 5.7 修复请求去重与取消

建议采用“共享底层请求 + 调用方独立订阅”：

- 网络层按完整 request key 去重；
- 底层请求不直接绑定任一组件的 `AbortSignal`；
- 每个组件取消时只停止等待和状态提交；
- 最后一个订阅者离开时，才可以取消底层请求；
- GET key 必须包含 path、query 和影响响应的 header；
- 错误 Promise 不永久缓存。

## 6. P0：模拟缓存与 API 契约

### 6.1 模拟结果缓存

建议缓存键：

```text
event/region
+ mode
+ seed
+ sourceArtifactVersion
+ modelVersion
+ samples
+ topologyVersion
```

要求：

- per-key singleflight；
- 成功与失败分别设置 TTL；
- live artifact version 变化后自然失效；
- sim seed 或模型版本变化必须得到新结果；
- 不把失败结果伪装为最后成功的实时结果。

### 6.2 显式响应模型

逐步为以下端点增加 Pydantic response model：

1. revision/status；
2. simulation；
3. finals；
4. overview；
5. prematch/command center；
6. team profile。

由 OpenAPI 生成前端类型或在 CI 中进行 schema diff，减少 Python/TypeScript 状态枚举漂移。

## 7. P1：分享与静态导出，不包含 OBS

### 7.1 第一阶段：规范化分享链接

提供“复制分享链接”，至少保留：

- event/region；
- view/stage；
- mode；
- sim seed；
- highlight 或选中队伍；
- 必要的赛事版本提示。

不建议第一阶段保存原始 `x/y/scale` 相机坐标。分享链接应恢复语义视图并自动适配当前设备；精确画面由静态图片导出负责。

验收要求：

- 新标签页打开后恢复相同赛事、阶段、模式和目标队伍；
- sim 链接 seed 一致；
- finals 自动进入 sim 时，复制前必须把当前有效 seed 补入 URL，不能只留在会话内存；
- 无官方赛程时不得把 live 链接静默伪装成真实实时内容；
- 明确提示 live 分享链接会继续展示最新数据，不等于历史快照；
- 分享按钮失败时允许复制纯文本 URL，不阻断页面。

### 7.2 第二阶段：静态赛程图

优先实现独立的只读导出页面和静态渲染器，输入仍为现有 `WorkspaceStage`。例如内部 `/export/canvas` 页面只负责确定性渲染，不承担直播或普通用户交互：

- 使用固定逻辑尺寸；
- 渲染完整阶段，而不是截取用户当前可见窗口；
- 去除缩放按钮、Inspector、搜索框等交互 UI；
- 保留队伍卡、比赛卡、连接器、图例和必要赛事背景；
- 禁止轮询，渲染期间固定一个 data revision；
- 等待 `document.fonts.ready`、所有图片 load/decode 和布局稳定；
- 导出 root 暴露 `data-export-status="pending|ready|error"`；
- 输出 PNG；SVG/PDF 暂不进入 MVP。

导出图片必须包含：

- 赛事和阶段名称；
- 数据模式：实时 / 模拟 / 合成测试；
- `sourceUpdatedAt`；
- `dataRevision` 或 artifact version；
- sim seed 与模型版本；
- 导出生成时间；
- 项目名称或来源归属。

推荐由独立、低权限的 Playwright/Chromium worker 打开固定内部路由，等待 `ready` 后只截取 export root。开始和结束时比较 data revision：发生变化则重试一次，仍不一致则返回版本冲突，不得拼出跨版本图片。

若要先验证纯浏览器端 DOM rasterizer，必须先证明中文字体、SVG 连接器、CSS 背景、超长画布和移动设备内存稳定；不能因为普通视口截图成功就判断完整赛程图可用。

### 7.3 高频固定视图的可选物化

第一版只按用户请求生成，不预渲染任意 seed。固定 live 视图确有重复访问后，才借鉴上游：

- 内容 hash；
- 冷却合并；
- `pending/ready/error`；
- 失败时保留 last-known-good；
- 临时文件后原子 rename；
- 带内容版本的 immutable URL。

导出 key 至少包含：

```text
event + stage + mode + seed
+ sourceRevision + modelVersion + layoutVersion + rendererVersion
+ width + height + DPR
```

安全要求：

- 只允许枚举内的赛事和阶段参数；
- 不接收任意 URL；
- 不允许访问任意外部主机；
- 请求限流、并发有界、输出尺寸有上限；
- Chromium 使用专用低权限用户和正常 sandbox，不复制 `--no-sandbox`；
- 渲染 worker 只能访问固定内部 origin，并限制最终像素数和响应字节数；
- manifest 查询不得触发新的无界任务。

### 7.4 明确禁止进入实现的 OBS 内容

以下内容即使上游已有，也不进入 backlog：

- `/obs` 页面；
- `capture=1` 连续采集模式；
- OBS safe-area 参数；
- 透明直播叠加层；
- 设备外框和触控光标；
- 面向导播的自动轮播、iframe 或实时推送。
- 录屏、视频、GIF、PDF、批量 ZIP 和外部平台自动发布。
- 任意当前视口截图和模拟 seed 全量预渲染。

## 8. P1/P2：其余实际问题

| 优先级 | 事项 | 修复方向 |
|---|---|---|
| P0 | CI 和契约门禁 | 后端 pytest；前端 test、typecheck、build；OpenAPI/schema diff；关键页面 E2E |
| P0 | readiness | 区分 liveness/readiness，报告同步年龄、artifact version、必要文件和模拟依赖 |
| P1 | 后端领域拆分 | 继续把 `service.py` 拆成明确 application services，不回退为双轨实现 |
| P1 | 声明式赛事拓扑 | 用共享、可验证的赛事图协议减少两个大型 builder 和跨语言重复规则 |
| P1 | 学校简称 | 只在 canonical `schoolKey/teamKey` 之后附加 `schoolAbbreviation4/2` |
| P2 | runtime 快照治理 | 压缩、时间索引、冷热分层和显式保留策略；历史回放所需数据不得直接删除 |

## 9. 实施顺序

### Phase 0：实施前基线

1. 处理或明确当前工作树中已有的大量前端修改。
2. 复核 `team-profile-page.tsx` 固定 `DEFAULT_SEED + live` 是否为有意语义。
3. 建立当前 tests/typecheck/build 基线，不引用旧报告中的通过数量。
4. 为真实 live/sim/synthetic 场景准备可撤销 fixture。

### Phase 1：无感刷新最小闭环

1. 修复上游 304/语义未变化时仍重写 artifact 的问题。
2. 分别确认区域赛、复活赛、全国赛的自动同步来源和频率。
3. 增加稳定的 semantic revision 和 ETag。
4. 建立共享刷新状态机。
5. 修复请求去重与取消传播。
6. 区域页后台更新不清空 simulation。
7. 画布只按稳定 layout/topology key 决定是否重新 fit。
8. 保持 3 分钟周期完成回归。

### Phase 2：恢复约 30 秒版本检查

1. 切换为 revision 条件请求。
2. 增加可见性暂停、恢复立即检查、抖动和失败退避。
3. 依次迁移 finals、首页、榜单和赛前中心。
4. 验证发布后约 60 秒内页面更新且无视觉跳变。

### Phase 3：分享

1. 统一并测试规范化深链。
2. 增加复制链接/系统分享入口。
3. 验证 live/sim/seed/highlight 恢复。

### Phase 4：静态导出

1. 建立只读 `/export/canvas` 页面和静态 `WorkspaceStage` 渲染器。
2. 增加字体、图片、布局和 `pending/ready/error` 屏障。
3. 使用有界、低权限的导出 worker 截取固定 export root。
4. 完成 PNG、来源元数据和版本前后校验。
5. 不增加 OBS 功能。

### Phase 5：基础治理

推进 response model、生成类型、CI、readiness、模拟缓存、拓扑协议和快照归档。

## 10. 验收标准

### 10.1 实时刷新

- 初次成功加载后，周期刷新不再出现全屏 spinner、空白画布或错误页替换。
- 同一 revision 返回时，不请求完整 simulation，不重建 stage。
- 设置画布为 137% 缩放并平移后，数据更新前后 `scale` 偏差不超过 0.001、`x/y` 偏差不超过 1px；允许因边界缩小发生必要 clamp，但不得自动 fit。
- 普通数据更新前后 `WorkspaceStageView` 保持同一次挂载。
- 全屏、选中队伍、选中比赛、highlight、Inspector 和 URL 保持不变。
- 后台完整请求失败时继续展示最后成功数据，并出现非阻断 stale 提示。
- 服务恢复后能自动更新并清除 stale 状态。
- 页面隐藏时不周期轮询；恢复可见时立即检查。
- sim 模式不进行 live revision 轮询。
- 服务端 data revision 已发布后，正常网络下前端不迟于约 35 秒发现并更新；按两个独立 30 秒周期计算的完整端到端目标上限为约 70 秒。
- 复活赛/全国赛若尚无自动同步链路，页面按真实状态说明，不错误承诺 30 秒更新。
- 多组件请求同一资源时只有一个底层请求；单个组件卸载不会取消其他订阅者。
- 同一资源的周期请求不重叠；迟到的旧赛区、旧 seed 或旧 revision 响应不能覆盖新状态。

### 10.2 分享与导出

- 分享链接能恢复赛事、阶段、模式、seed 和目标队伍。
- 同一数据与导出 key 生成语义一致的图片。
- 图片连接器、卡片、中文字体、背景和图例完整。
- 图片明确标注实时/模拟/合成和数据版本。
- 导出失败不影响正常页面。
- 不存在 OBS 页面、OBS 参数或直播专用持续刷新逻辑。
- 服务端导出若启用，不可请求任意 URL，且具有限流和并发上限。
- 成功响应为 `200 image/png`；非法参数、版本漂移和渲染超时分别返回 `400`、`409`、`504`，不能把 loading 或旧图当作成功结果。

### 10.3 赛事契约

- 南部、东部、北部、复活赛和全国赛均通过同一组相关契约测试。
- runtime overlay 不能修改官方赛制字段。
- live/sim/synthetic 不互相伪装或静默回退。
- 简称不影响 identity、Elo、历史和晋级传播。

## 11. 建议测试矩阵

### 单元测试

- revision 对无语义时间变化保持稳定。
- 赛果、对阵或 artifact 改变时 revision 必须变化。
- refresh state machine 的首次加载、无变化、成功更新、失败保留和恢复。
- `layoutKey` 不变时不重新 fit；真实导航时重新 fit。
- 请求共享和调用方独立取消。
- simulation cache key 覆盖 seed、mode、artifact 和 model version。
- export key 覆盖所有来源与模拟参数。

### 后端集成测试

- `If-None-Match` 命中返回 `304`。
- 上游 schedule 返回 304 且辅助源不变时，semantic revision、normalized artifact 和 published artifact 均不变化。
- 只有检查时间或 source age 变化时，不重跑 TS2 发布和区域 simulation。
- revision 端点不返回 snapshot/ledger 大字段。
- 完整 payload 的 artifact version 与请求时 revision 一致。
- 读取过程中 artifact 改变时重试或失败关闭，不混入两个版本。

### 前端组件测试

- fake timers 推进 30 秒时只检查 revision。
- revision 未变化不调用完整数据 API。
- 慢请求期间不会启动第二个同资源轮询请求。
- 后台失败后旧卡片仍存在。
- 刷新期间不出现初次加载组件。
- sim 模式无 live polling。
- 延迟到达的旧 generation 响应不会覆盖当前数据。

### 浏览器 E2E

1. 打开实时画布并拖拽、缩放、全屏、选择队伍。
2. 注入新 revision 和新赛果。
3. 确认卡片数据更新。
4. 确认 viewport、全屏、选择和 Inspector 均保持。
5. 注入一次 500，确认旧数据保留；恢复 200 后自动追平。
6. 复制分享链接并在新标签页验证状态恢复。
7. 导出 PNG 并检查模式、来源版本、字体、卡片和连接器。
8. 桌面与 390px 移动端各执行一次。

## 12. Go / No-Go 门槛

### 把 revision 检查调到约 30 秒

只有以下条件全部满足才 Go：

- 上游 304 不再制造新的 semantic revision；
- 区域页不再清空 simulation；
- stage 对象变化不会重置 viewport；
- 旧数据保留和 stale 状态测试通过；
- 页面隐藏和 sim 模式不轮询；
- 已分别确认各赛事的实际服务端同步覆盖与频率；
- 浏览器 E2E 无画布闪烁、跳动和交互丢失。

否则维持 3 分钟，不以缩短间隔掩盖结构问题。

### 启用静态图片导出

只有以下条件全部满足才 Go：

- 共享 `WorkspaceStage` 是唯一赛事图输入；
- 导出包含来源、模式、revision 和必要模拟信息；
- 区域赛、复活赛、全国赛连接器均验证；
- 超长画布和移动设备内存可接受；
- 无任意 URL 渲染和无界任务入口。

若暂不接受受控导出 worker，而纯客户端 DOM 导出又未通过完整验收，则第一版只上线分享链接，不以不稳定 PNG 凑功能；不得顺势扩大为 OBS 项目。

## 13. 回滚策略

- revision v2 在完成页面迁移前保留旧读取路径。
- 新刷新控制器应可按页面逐步启用。
- 若 30 秒检查出现回归，先恢复 3 分钟周期，不回滚旧数据保留和 viewport 稳定修复。
- 导出入口可独立关闭，不影响正常赛事页面。
- 服务端生成产物必须版本化，不覆盖唯一旧文件；失败继续保留 last-known-good。

## 14. Definition of Done

本修复计划只有在以下结果同时成立时才算完成：

1. 实时数据及时性恢复，但用户不再感知周期性整页或整画布刷新。
2. 更新失败只影响新鲜度，不破坏当前可读内容和交互状态。
3. 分享链接和静态图片能够复现并说明数据语义。
4. 没有引入 OBS、开放代理、身份歧义或 live/sim 混淆。
5. 自动测试、API、实际页面和运行链路均完成验证。
