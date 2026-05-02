# AGENTS

本文件面向后续在 `D:\code\douququ`、`/home/winx/douququ` 或部署目录 `/opt/douququ` 工作的代理。

## 项目概况

- 前端位于 `D:\code\douququ\frontend` / `/home/winx/douququ/frontend`
  - Next.js App Router
  - 仓库只保留这一套前端实现，不再维护 `frontend_new`
  - 关键入口：`app/page.tsx`、`app/regions/[region]`、`components/`、`lib/`
  - 首页总控台集中在 `frontend/components/overview-page.tsx`、`overview-hero.tsx`、`region-card*.tsx`
  - 赛区工作区集中在 `frontend/components/region-workspace.tsx`
- 后端位于 `D:\code\douququ\backend` / `/home/winx/douququ/backend`
  - FastAPI 入口：`backend/app/main.py`
  - 聚合/模拟服务：`backend/app/service.py`
  - 官方实时赛程适配：`backend/app/rmuc_live.py`
- TS2 / Monte Carlo / 产物流水线位于 `research/trueskill2`、`scripts/`、`data/derived/`
- 赛程画布逻辑集中在 `frontend/lib/canvas-builders.ts`
- 阶段/结果中文映射集中在 `frontend/lib/display.ts`
- 赛区视图、URL 构造、实时模式入口集中在 `frontend/lib/region-config.ts`
- 前端 API 客户端集中在 `frontend/lib/api.ts`，默认后端地址是 `http://127.0.0.1:8001`

## 必须遵守的产品约束

- 不要修改后端接口契约：
  - `GET /api/overview`
  - `GET /api/regions/:regionSlug/simulation?seed=...`
  - `GET /api/regions/:regionSlug/simulation?seed=...&mode=sim|live`
  - `GET /api/regions/:regionSlug/live-state`
- 不要破坏赛区页的 URL 深链参数：
  - `seed`
  - `highlight`
  - `view`
  - `mode`
- `mode=sim` 与 `mode=live` 都是用户可见状态；实时源不可用时可以降级到模拟，但必须在 UI/状态字段中清楚表达，不要伪装成官方实时结果。
- 首页或赛区入口必须让“实时模式/实时预测”可被发现，不能只依赖用户手写 URL。
- 赛区工作区必须保持分视图结构：
  - `slots`
  - `swiss-a`
  - `swiss-b`
  - `qualification`
  - `playoff`
  - `final-rankings`
- `qualification` 与 `playoff` 必须是分开的两个页面。
- `playoff` 只展示主淘汰链；冠军战在季军战上方。
- `qualification` 需要按轮次即时展示分流结果，不能把晋级/淘汰全部堆在最后。
- 70% 及以上国赛概率的文案语义是“稳进国赛”；不要在相邻面板重复使用同一个成功标签表达不同含义。

## 设计与视觉要求

- 这个站点的设计目标是 RoboMaster 赛事总控台，不是通用后台模板。
- 视觉方向应以“红蓝对抗 + 机甲控制台 + 区域赛主视觉”展开。
- 调色优先参考：
  - `D:\code\douququ\微信图片_2026-04-14_221134_519.png`
  - [schedule.scutbot.cn](https://schedule.scutbot.cn/)
  - [robomaster.com/live](https://www.robomaster.com/live)
- 不要照搬参考站，但要学习它们的：
  - 赛程分栏
  - 阶段标题独立表达
  - 每轮后即时显示晋级/淘汰结果
  - 红蓝胜负状态的可判读性
- 当前用户明确不满意“红色不明显”和“蓝色调下胜负不清晰”，后续改主题时必须优先解决这两点。
- 避免把整站压成单一深蓝/蓝绿色主题。红方、蓝方、胜者、败者、晋级、淘汰、爆冷等状态必须一眼能区分。
- 总控台可以有直播感、赛事氛围和机甲感，但信息密度、队伍名、比分、胜率、分流状态永远优先于装饰。

## 文案和显示规则

- 面向中文用户，禁止把内部英文枚举直接暴露在 UI 上。
- `Swiss`、`champion`、`runner_up`、`national_qualified`、`repechage_qualified`、`group_eliminated` 等内部值都必须通过中文映射显示。
- `sim`、`live`、`official_live`、`simulation_proxy` 等内部模式/数据源也必须转换成中文可理解文案。
- 队伍名、队名、比分、胜率、晋级/淘汰状态优先级高于装饰效果。
- 长文本不能因为卡片高度或 clamp 设置而被无意义截断。

## 实现建议

- 赛程页优先延续当前“自定义静态画布 + 绝对定位卡片 + SVG 连接线”的实现，不要退回通用流程图库。
- 大改画布布局前，先去浏览参考页面，再决定分栏和连线逻辑。
- 主题调整不要只改零散颜色值，应优先从全局 token、状态色、卡片底板、连接线和首页主视觉整体入手。
- 改赛区跳转或标签时，优先使用 `buildRegionHref` / `REGION_VIEWS`，不要手拼一套会遗漏 `seed`、`highlight`、`view`、`mode` 的 URL。
- 改实时模式时，先理解 `LiveRuntimeContext`、`liveStatus`、`miniProgramPrediction`、`isRealResult` 的来源；不要把赛前预测、官方完赛比分和小程序实时预测混成同一种状态。
- 改概览页国赛/复活赛文案时，同步检查 `frontend/lib/overview-builders.ts` 的阈值和计数逻辑。

## 验证流程

- 改动赛程布局或样式后，至少检查：
  - `/regions/east_region?view=qualification&seed=20260414`
  - `/regions/east_region?view=playoff&seed=20260414`
  - `/regions/north_region?view=swiss-a&seed=20260414`
  - `/regions/north_region?view=final-rankings&seed=20260414`
- 浏览器验收时重点看：
  - 遮挡
  - 文本截断
  - 胜负可读性
  - 连线是否表达正确
  - 冠军战/季军战顺序
  - 资格赛是否做到“每轮结束即时分流”
- 运行前端校验时必须进入 `frontend/`：
  - `cd frontend && npm test`
  - `cd frontend && npm run build`
- 改后端接口、模拟、实时赛程或 TS2 产物读取后，至少运行相关后端测试：
  - `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 ./.venv312/bin/python -m pytest backend/tests/test_api.py -q`
  - 涉及官方实时赛程时追加 `backend/tests/test_live_integration.py`
- 改赛区布局或实时模式后，额外检查：
  - `/regions/south_region?view=slots&mode=live&seed=20260414`
  - `/regions/south_region?view=playoff&mode=live&seed=20260414`

## 环境经验

- 前端开发默认使用 `cd frontend && npm run dev`，监听 `127.0.0.1:3005`。
- 稳定生产验收使用 `cd frontend && npm run build && npm run start`，同样监听 `127.0.0.1:3005`。
- 后端默认使用 `uvicorn backend.app.main:app --host 127.0.0.1 --port 8001`。
- 本地/部署健康检查：
  - `curl -sf http://127.0.0.1:3005`
  - `curl -sf http://127.0.0.1:8001/api/health`
- 当前机器上 `next dev` 偶发 `.next` 增量构建损坏，出现 `Cannot find module './xxx.js'` 时先怀疑本地缓存而不是业务代码。
- 遇到这类问题时：
  - 清理 `frontend/.next`
  - 或直接改用 `next start` 做稳定验收
- `frontend/package-lock.json` 是有效锁文件；遇到 `npm ci` 报 package/lock 不一致时，先从 `frontend/` 检查并修复锁文件，不要给泛泛的 npm 建议。
- 如果 Next.js 提示多个 lockfile / workspace root 混淆，先确认命令是否从 `frontend/` 运行，再处理根目录锁文件的清理问题。
- `next build` 可能改写 `frontend/next-env.d.ts` 中的 `.next/dev/types` 与 `.next/types` 引用；除非明确要改生成类型，不要把这类构建抖动混进功能提交。

## Git 与产物边界

- 提交时只 stage 本次任务必要文件，不要 `git add .`。
- 不要提交 `frontend/node_modules/`、`.venv312/`、`.playwright-mcp/`、截图、临时 patch、运行缓存或未确认的中间数据。
- `/data/runtime/` 是运行期实时数据落点，默认不应进入 Git。
- 生成的 TS2 / Monte Carlo 大产物只有在用户明确要求发布或任务需要时才纳入提交；否则先说明它们是运行产物。
- 如果用户要求“只提交必要内容”，先用 `git status --short`、`git diff --stat`、必要时 `git status --short --ignored` 区分已跟踪变更、未跟踪文件和被忽略的大目录。
