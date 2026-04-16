# AGENTS

本文件面向后续在 `D:\code\douququ` 工作的代理。

## 项目概况

- 前端位于 `D:\code\douququ\frontend`
  - Next.js App Router
  - 关键入口：`app/page.tsx`、`app/regions/[region]`、`components/`、`lib/`
- 后端位于 `D:\code\douququ\backend`
- 赛程画布逻辑集中在 `frontend/lib/canvas-builders.ts`
- 阶段/结果中文映射集中在 `frontend/lib/display.ts`

## 必须遵守的产品约束

- 不要修改后端接口契约：
  - `GET /api/overview`
  - `GET /api/regions/:regionSlug/simulation?seed=...`
- 不要破坏赛区页的 URL 深链参数：
  - `seed`
  - `highlight`
  - `view`
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

## 文案和显示规则

- 面向中文用户，禁止把内部英文枚举直接暴露在 UI 上。
- `Swiss`、`champion`、`runner_up`、`national_qualified`、`repechage_qualified`、`group_eliminated` 等内部值都必须通过中文映射显示。
- 队伍名、队名、比分、胜率、晋级/淘汰状态优先级高于装饰效果。
- 长文本不能因为卡片高度或 clamp 设置而被无意义截断。

## 实现建议

- 赛程页优先延续当前“自定义静态画布 + 绝对定位卡片 + SVG 连接线”的实现，不要退回通用流程图库。
- 大改画布布局前，先去浏览参考页面，再决定分栏和连线逻辑。
- 主题调整不要只改零散颜色值，应优先从全局 token、状态色、卡片底板、连接线和首页主视觉整体入手。

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
- 常规校验命令：
  - `npm test`
  - `npm run build`

## 环境经验

- 当前机器上 `next dev` 偶发 `.next` 增量构建损坏，出现 `Cannot find module './xxx.js'` 时先怀疑本地缓存而不是业务代码。
- 遇到这类问题时：
  - 清理 `frontend/.next`
  - 或直接改用 `next start` 做稳定验收
