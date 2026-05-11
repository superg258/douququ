# douququ

RoboMaster 赛程模拟、实时状态聚合与区域赛总控台。

本仓库包含：

- `frontend/`：Next.js App Router 前端。
- `backend/`：FastAPI 聚合与模拟接口。
- `research/trueskill2/`、`scripts/`、`data/derived/`：评分、模拟与发布产物流水线。

## 本地开发

后端默认监听 `127.0.0.1:8001`：

```powershell
.venv-win\Scripts\uvicorn.exe backend.app.main:app --host 127.0.0.1 --port 8001
```

前端默认监听 `127.0.0.1:3005`：

```powershell
cd frontend
npm run dev
```

常用校验：

```powershell
cd frontend
npm test
npm run build
```

## 引用与致谢

本项目参考并引用了 scutrobotlab 的 RoboMaster 赛程分析相关开源仓库：

- https://github.com/scutrobotlab/rm-schedule-ui
- https://github.com/scutrobotlab/rm-schedule

两个上游仓库均以 Apache License 2.0 开源。更完整的第三方署名见 `NOTICE`。

## 许可证

本项目以 Apache License 2.0 开源，见 `LICENSE`。
