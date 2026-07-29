# RMUC 总控台 Alibaba Cloud Linux 部署指南

本文档面向将当前项目部署到阿里云 ECS 的场景，目标环境为 `Alibaba Cloud Linux`。

推荐部署形态：

- 前端：Next.js 生产服务，监听 `127.0.0.1:3005`
- 后端：FastAPI + Uvicorn，监听 `127.0.0.1:8001`
- 反向代理：Nginx 对外提供 `80/443`
- 进程管理：`systemd`
- 部署方式：整仓部署到服务器

当前仓库实际依赖：

- 前端：`next@16.2.12`、`react@18.3.1`
- 后端：`fastapi`、`uvicorn`、`httpx`、`pandas`、`pyarrow`
- 前端构建命令：`npm run build`
- 前端启动命令：`npm run start -- --hostname 127.0.0.1 --port 3005`
- 后端启动命令：`uvicorn backend.app.main:app --host 127.0.0.1 --port 8001`

## 1. 先确认服务器和网络条件

推荐至少：

- 2 vCPU
- 4 GB 内存
- 20 GB 系统盘

阿里云侧至少放通这些安全组端口：

- `22/tcp`：SSH
- `80/tcp`：HTTP
- `443/tcp`：HTTPS

不需要对公网开放：

- `3005/tcp`
- `8001/tcp`
- `3010/tcp`（仅启用 PNG worker 时使用）

这三个端口只监听本机回环地址。

## 2. 项目为什么必须整仓部署

这个项目不能只上传 `frontend` 或 `backend`，因为：

- 后端会直接读取仓库根目录下的 `data/`
- 后端会直接使用仓库根目录下的 `scripts/`
- 前端通过 `NEXT_PUBLIC_API_BASE_URL` 请求后端接口

推荐最终目录：

```bash
/opt/douququ
├── backend
├── data
├── frontend
├── scripts
├── tests
└── ...
```

说明：

- 仓库当前只保留 `frontend` 这一套前端源码，不再区分 `frontend_new`
- 如果你的服务器之前临时跑过 `frontend_new`，把对应进程目录和自定义脚本统一切回 `/opt/douququ/frontend`

## 3. 推荐系统版本和软件版本

优先推荐：

- `Alibaba Cloud Linux 3`
- `Python 3.11` 或 `3.12`
- `Node.js 22 LTS`
- `Nginx 1.20+`

注意：

- Next.js 16 要求 `Node.js >= 20.9.0`
- 当前后端和实时同步入口要求 `Python >= 3.11`；生产推荐固定使用 3.11 或 3.12
- 如果你的镜像是 `Alibaba Cloud Linux 2`，把文档里的 `dnf` 替换为 `yum`
- Playwright 自动安装浏览器系统依赖只支持其官方列出的 Ubuntu/Debian
  平台；`playwright install-deps` 在 Linux 上调用 `apt-get`，不能用于
  Alibaba Cloud Linux

## 4. 一次性安装系统依赖

### 4.1 更新系统

`Alibaba Cloud Linux 3`：

```bash
sudo dnf update -y
```

`Alibaba Cloud Linux 2`：

```bash
sudo yum update -y
```

### 4.2 安装基础组件

`Alibaba Cloud Linux 3`：

```bash
sudo dnf install -y git curl nginx python3 python3-pip python3-devel firewalld
```

`Alibaba Cloud Linux 2`：

```bash
sudo yum install -y git curl nginx python3 python3-pip python3-devel firewalld
```

### 4.3 安装 Node.js 22

建议直接使用 NodeSource 的 EL 安装脚本：

```bash
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
```

然后安装 Node.js：

`Alibaba Cloud Linux 3`：

```bash
sudo dnf install -y nodejs
```

`Alibaba Cloud Linux 2`：

```bash
sudo yum install -y nodejs
```

### 4.4 检查版本

```bash
node -v
npm -v
python3 --version
nginx -v
```

要求至少满足：

```bash
node >= v20.9.0
python >= 3.11
```

如果 `python3 --version` 低于 3.11，先通过受支持的软件源安装 Python 3.11/3.12，
并在后续所有 `venv` 命令中使用同一个解释器；不要继续使用系统自带的旧版
`python3`。

## 5. 创建部署用户和目录

建议单独创建一个部署用户，例如 `douququ`：

```bash
sudo useradd -r -m -d /opt/douququ -s /bin/bash douququ
sudo mkdir -p /opt/douququ
sudo chown -R douququ:douququ /opt/douququ
```

如果你已经有固定的运维用户，也可以继续用现有用户，但后面的 `systemd` 配置要同步替换 `User`。

## 6. 拉取代码

以 Git 部署为例：

```bash
sudo -u douququ git clone <你的仓库地址> /opt/douququ
cd /opt/douququ
```

如果目录不是空的，可以改成：

```bash
cd /opt/douququ
sudo -u douququ git init
sudo -u douququ git remote add origin <你的仓库地址>
sudo -u douququ git fetch --all
sudo -u douququ git checkout -f main
```

## 7. 部署后端

### 7.1 创建虚拟环境并安装依赖

```bash
cd /opt/douququ
sudo -u douququ python3 -m venv .venv
sudo -u douququ /opt/douququ/.venv/bin/pip install --upgrade pip
sudo -u douququ /opt/douququ/.venv/bin/pip install -r /opt/douququ/backend/requirements-live-sync.txt
```

`requirements-live-sync.txt` 复用后端依赖，并固定实时发布链实际使用的
`pandas==2.3.3`、`pyarrow==23.0.1`。不要只安装
`backend/requirements.txt`；区域赛首场完赛后发布实时评分账本时也会用到这两个包。

### 7.2 本地验证后端

```bash
cd /opt/douququ
sudo -u douququ /opt/douququ/.venv/bin/uvicorn backend.app.main:app --host 127.0.0.1 --port 8001
```

另开一个终端检查：

```bash
curl http://127.0.0.1:8001/api/health
```

预期返回：

```json
{"status":"ok"}
```

确认正常后按 `Ctrl+C` 停止。

### 7.3 后端可选环境变量

当前代码中使用到的可选变量：

```bash
RMUC_SIMULATION_SAMPLES=1200
```

说明：

- 默认值就是 `1200`
- 值越高，模拟更稳定，但 CPU 开销更高
- 如果 ECS 规格较低，可先降到 `800`

## 8. 部署前端

### 8.1 安装依赖

```bash
cd /opt/douququ/frontend
sudo -u douququ npm ci
```

上述步骤足够运行 Next.js 前端。PNG 画布导出由独立的 Playwright worker 完成，
它有额外的操作系统边界：

- 在 Playwright 官方支持的 Ubuntu/Debian 上，从 `/opt/douququ/frontend`
  执行 `sudo npx playwright install-deps chromium`，再执行
  `sudo -u douququ env PLAYWRIGHT_BROWSERS_PATH=/opt/douququ/.cache/ms-playwright npx playwright install chromium`
- 在 Alibaba Cloud Linux 上不要执行 `playwright install-deps`；该命令会调用不存在的
  `apt-get`
- 如果必须在 Alibaba Cloud Linux 上启用 PNG 导出，需要先由运维提供并实机验证
  Chromium 的 RPM 系统依赖，然后仅以 `douququ` 用户执行
  上述带 `PLAYWRIGHT_BROWSERS_PATH` 的 `npx playwright install chromium`，
  并通过第 13.1 节的 ready 与 PNG smoke
- 未完成上述实机验证时，保持 PNG worker 和
  `RMUC_CANVAS_EXPORT_REQUIRED` 关闭；这不影响前端、后端及两条实时赛程链

### 8.2 配置生产环境变量

前端会在构建时读取 `NEXT_PUBLIC_API_BASE_URL`，所以这个值一旦修改，必须重新构建。

如果你已经有域名：

```bash
sudo -u douququ bash -lc "cat > /opt/douququ/frontend/.env.production <<'EOF'
NEXT_PUBLIC_API_BASE_URL=https://rm.ecustcic.com
EOF"
```

如果暂时只有公网 IP：

```bash
sudo -u douququ bash -lc "cat > /opt/douququ/frontend/.env.production <<'EOF'
NEXT_PUBLIC_API_BASE_URL=http://你的服务器公网IP
EOF"
```

### 8.3 构建并验证前端

```bash
cd /opt/douququ/frontend
sudo -u douququ npm run build
sudo -u douququ npm run start -- --hostname 127.0.0.1 --port 3005
```

另开一个终端检查：

```bash
curl -I http://127.0.0.1:3005
```

确认返回 `200` 或 `307` 后按 `Ctrl+C` 停止。

## 9. 配置 systemd

### 9.1 后端服务

创建 `/etc/systemd/system/rmuc-backend.service`：

```ini
[Unit]
Description=RMUC Backend API
After=network.target

[Service]
Type=simple
User=douququ
Group=douququ
WorkingDirectory=/opt/douququ
Environment=PYTHONPATH=/opt/douququ
Environment=RMUC_SIMULATION_SAMPLES=1200
# 生产环境要求复活赛/全国赛自动同步最近一次成功；本地和 CI 不设置此变量。
Environment=RMUC_FINALS_LIVE_REQUIRED=1
# 仅在第 8.1 节的 Chromium ready 与 PNG smoke 已通过后启用。
# Environment=RMUC_CANVAS_EXPORT_REQUIRED=1
ExecStart=/opt/douququ/.venv/bin/uvicorn backend.app.main:app --host 127.0.0.1 --port 8001
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

### 9.2 前端服务

创建 `/etc/systemd/system/rmuc-frontend.service`：

```ini
[Unit]
Description=RMUC Frontend
After=network.target

[Service]
Type=simple
User=douququ
Group=douququ
WorkingDirectory=/opt/douququ/frontend
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm run start -- --hostname 127.0.0.1 --port 3005
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

### 9.3 实时赛程同步定时器

官方赛程和“王牌预言家”同步不在后端请求路径里实时抓取，而是由两个相互隔离的
`systemd timer` 定时运行，避免其中一个上游变慢时阻塞另一条链：

- 官方赛程写入：`/opt/douququ/data/runtime/rmuc_live/normalized_schedule.json`
- 王牌预言家写入：`/opt/douququ/data/runtime/rmuc_live/mini_program_predictions.json`
- 同步状态汇总：`/opt/douququ/data/runtime/rmuc_live/sync_manifest.json`
- 复活赛/全国赛官方覆盖层：`/opt/douququ/data/runtime/rmuc_live/finals/normalized_schedule.json`
- 复活赛/全国赛最近检查：`/opt/douququ/data/runtime/rmuc_live/finals/check_status.json`

仓库已提供模板，部署时直接复制：

```bash
sudo cp /opt/douququ/deploy/systemd/rmuc-live-sync.service /etc/systemd/system/rmuc-live-sync.service
sudo cp /opt/douququ/deploy/systemd/rmuc-live-sync.timer /etc/systemd/system/rmuc-live-sync.timer
sudo cp /opt/douququ/deploy/systemd/rmuc-finals-live-sync.service /etc/systemd/system/rmuc-finals-live-sync.service
sudo cp /opt/douququ/deploy/systemd/rmuc-finals-live-sync.timer /etc/systemd/system/rmuc-finals-live-sync.timer
```

当前定时策略是：

- 区域赛（北京时间）：`00:00-06:00` 每 30 分钟，其余时间每 30 秒
- 复活赛/全国赛：全天每 30 秒；未变化时官方源返回 `304`，仅刷新
  `lastCheckedAt/lastSuccessAt`
- `AccuracySec=5s`、`RandomizedDelaySec=5s`：保留少量抖动，避免完全固定时刻集中请求
- 两条 timer 都显式固定 `Asia/Shanghai`，不受服务器本地时区影响

如果部署用户不是 `douququ`，同步修改两个 sync service 里的 `User`、`Group`
和 `/opt/douququ` 路径。

上线前建议先手动跑一轮，确认网络和写入权限正常：

```bash
cd /opt/douququ
sudo -u douququ mkdir -p /opt/douququ/data/runtime/rmuc_live/finals/raw
sudo -u douququ /opt/douququ/.venv/bin/python /opt/douququ/scripts/sync_rmuc_live.py --mini-program-ttl-seconds 300 --mini-program-refresh-window-seconds 60
sudo -u douququ /opt/douququ/.venv/bin/python /opt/douququ/scripts/sync_finals_live.py
ls -lh /opt/douququ/data/runtime/rmuc_live/
python3 -m json.tool /opt/douququ/data/runtime/rmuc_live/finals/check_status.json
```

finals 手动同步必须输出 `status: ok`、`matchCount: 128`，其中正式复活赛 32 场、
全国赛 96 场；官方源中的两场全明星赛不会进入正式赛覆盖层。若编号、BO、group ID
或 reference 映射不一致，脚本会非零退出并保留上一份
`normalized_schedule.json`，不得绕过校验继续上线。

如果需要临时关闭王牌预言家同步，可以把 `rmuc-live-sync.service` 里的环境变量改成：

```ini
Environment=RMUC_MINI_PROGRAM_ENABLED=0
```

### 9.4 PNG 画布导出 worker

仅在第 8.1 节所述的受支持或已实机验证环境中，复制并启用受限 worker unit：

```bash
sudo cp /opt/douququ/deploy/systemd/rmuc-canvas-export.service /etc/systemd/system/rmuc-canvas-export.service
```

它会在监听端口前实际启动 Chromium；启动失败或浏览器断连时进程非零退出，由
systemd 自动重启。它只监听 `127.0.0.1:3010`，由后端调用，不应在安全组或
Nginx 中直接暴露。

### 9.5 启动服务

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now rmuc-backend
sudo systemctl enable --now rmuc-frontend
sudo systemctl enable --now rmuc-live-sync.timer
sudo systemctl enable --now rmuc-finals-live-sync.timer
```

如果 PNG worker 的操作系统依赖已经实机验证，再执行：

```bash
sudo systemctl enable --now rmuc-canvas-export
```

检查状态：

```bash
sudo systemctl status rmuc-backend
sudo systemctl status rmuc-frontend
sudo systemctl status rmuc-live-sync.timer
sudo systemctl status rmuc-finals-live-sync.timer
systemctl list-timers rmuc-live-sync.timer rmuc-finals-live-sync.timer
```

查看日志：

```bash
sudo journalctl -u rmuc-backend -f
sudo journalctl -u rmuc-frontend -f
sudo journalctl -u rmuc-live-sync.service -n 100 --no-pager
sudo journalctl -u rmuc-finals-live-sync.service -n 100 --no-pager
```

启用了 PNG worker 时，再检查：

```bash
sudo systemctl status rmuc-canvas-export
sudo journalctl -u rmuc-canvas-export -n 100 --no-pager
```

## 10. 配置 Nginx

Alibaba Cloud Linux 通常直接使用 `/etc/nginx/conf.d/*.conf`，不是 Ubuntu 常见的 `sites-available / sites-enabled` 结构。

创建 `/etc/nginx/conf.d/rmuc.conf`：

```nginx
# These directives live in the http context because conf.d/*.conf is included
# from nginx.conf's http block.  Per-IP limits bound unique-seed simulation CPU
# work and the much more expensive browser-backed PNG export.
limit_req_zone $binary_remote_addr zone=rmuc_simulation:10m rate=2r/s;
limit_req_zone $binary_remote_addr zone=rmuc_export:10m rate=12r/m;

server {
    listen 80;
    server_name rm.ecustcic.com;

    client_max_body_size 20m;
    limit_req_status 429;
    limit_req_log_level warn;

    location ~ ^/api/(?:regions/[^/]+/simulation|prematch-center|command-center|prediction-recap|teams/[^/]+)/?$ {
        limit_req zone=rmuc_simulation burst=6 nodelay;
        proxy_pass http://127.0.0.1:8001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location = /api/exports/canvas.png {
        limit_req zone=rmuc_export burst=3 nodelay;
        proxy_pass http://127.0.0.1:8001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:3005;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

检查并启动：

```bash
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx
```

## 11. 处理防火墙、SELinux 和阿里云安全组

### 11.1 阿里云安全组

在 ECS 控制台放通：

- `22/tcp`
- `80/tcp`
- `443/tcp`

### 11.2 firewalld

如果服务器启用了 `firewalld`：

```bash
sudo systemctl enable --now firewalld
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

### 11.3 SELinux

如果 `getenforce` 返回 `Enforcing`，Nginx 反代到本机高位端口时，通常还需要执行：

```bash
sudo setsebool -P httpd_can_network_connect 1
```

否则可能出现：

- Nginx 配置没问题
- `curl 127.0.0.1:3005`、`curl 127.0.0.1:8001` 都正常
- 但通过 Nginx 访问时报 `502`

## 12. HTTPS 两种做法

### 方案 A：先按 HTTP 跑通，再补证书

这是最稳的顺序。先确认：

- `http://你的域名` 能打开首页
- `/api/health` 能返回 `200`

跑通后再上 HTTPS。

### 方案 B：在 ECS 上直接申请 Let’s Encrypt

如果你的域名已经解析到这台 ECS，可以安装 `certbot` 和 Nginx 插件。

不同 Alibaba Cloud Linux 镜像的软件源差异较大，做法不完全一致，推荐思路是：

1. 先尝试通过系统仓库安装 `certbot`
2. 如果仓库没有对应包，再改用 `snapd` 或 `acme.sh`

证书生效后，如果你的前端之前是按 `http://公网IP` 构建的，需要改成正式域名并重新构建：

```bash
cd /opt/douququ/frontend
sudo -u douququ bash -lc "cat > /opt/douququ/frontend/.env.production <<'EOF'
NEXT_PUBLIC_API_BASE_URL=https://你的域名
EOF"
sudo -u douququ npm run build
sudo systemctl restart rmuc-frontend
```

## 13. 上线前验证

### 13.1 服务层

```bash
curl http://127.0.0.1:8001/api/health
curl --fail http://127.0.0.1:8001/api/health/ready
curl http://127.0.0.1:8001/api/overview | head
curl -I http://127.0.0.1:3005
curl -I http://你的域名或公网IP
systemctl list-timers rmuc-live-sync.timer rmuc-finals-live-sync.timer
sudo journalctl -u rmuc-live-sync.service -n 50 --no-pager
sudo journalctl -u rmuc-finals-live-sync.service -n 50 --no-pager
test -s /opt/douququ/data/runtime/rmuc_live/normalized_schedule.json
test -s /opt/douququ/data/runtime/rmuc_live/sync_manifest.json
test -s /opt/douququ/data/runtime/rmuc_live/finals/normalized_schedule.json
test -s /opt/douququ/data/runtime/rmuc_live/finals/check_status.json
python3 -m json.tool /opt/douququ/data/runtime/rmuc_live/finals/check_status.json
```

生产 backend 设置了 `RMUC_FINALS_LIVE_REQUIRED=1`，因此 finals
`check_status.json` 缺失、最近一次失败或超过允许新鲜度时，
`/api/health/ready` 必须返回 `503`；不要用仅检查进程存活的 `/api/health`
代替发布 gate。

如果启用了 PNG worker，额外验证 Chromium ready 与完整导出；两条命令都必须成功：

```bash
curl --fail http://127.0.0.1:3010/health/ready
curl --fail -o /tmp/rmuc-canvas-smoke.png 'http://127.0.0.1:8001/api/exports/canvas.png?competition=south_region&stage=playoff&mode=live'
file /tmp/rmuc-canvas-smoke.png
```

确认后在 backend unit 或 drop-in 中设置
`Environment=RMUC_CANVAS_EXPORT_REQUIRED=1`，重启 backend，再次确认
`/api/health/ready`。

如果启用了王牌预言家同步，再确认缓存文件已经生成：

```bash
test -s /opt/douququ/data/runtime/rmuc_live/mini_program_predictions.json
```

### 13.2 前端构建校验

```bash
cd /opt/douququ/frontend
sudo -u douququ npm test
sudo -u douququ npm run build
```

### 13.3 页面验收

至少检查：

- `/`
- `/elo-rankings`
- `/regions/east_region?view=qualification&seed=20260414`
- `/regions/east_region?view=playoff&seed=20260414`
- `/regions/north_region?view=swiss-a&seed=20260414`
- `/regions/north_region?view=final-rankings&seed=20260414`

重点看：

- 页面是否能正常出数
- 前端能否正常请求 `/api/overview`
- 赛区页深链参数是否保持可用
- 资格赛和主淘汰赛是否仍然分开
- 冠军战是否位于季军战上方
- 胜负颜色和文本可读性是否正常

## 14. 常规更新流程

后续更新时：

```bash
cd /opt/douququ
sudo -u douququ git pull
```

如果后端依赖有变化：

```bash
sudo -u douququ /opt/douququ/.venv/bin/pip install -r /opt/douququ/backend/requirements-live-sync.txt
```

如果前端依赖有变化：

```bash
cd /opt/douququ/frontend
sudo -u douququ npm ci
```

只有已按第 8.1 节启用 PNG worker 的环境，才按对应操作系统的已验证流程更新
Chromium；不要在 Alibaba Cloud Linux 上运行 `playwright install-deps`。

仓库新增或修改 systemd unit 时，每次更新都重新复制，避免服务器继续运行旧 timer：

```bash
sudo cp /opt/douququ/deploy/systemd/rmuc-live-sync.service /etc/systemd/system/rmuc-live-sync.service
sudo cp /opt/douququ/deploy/systemd/rmuc-live-sync.timer /etc/systemd/system/rmuc-live-sync.timer
sudo cp /opt/douququ/deploy/systemd/rmuc-finals-live-sync.service /etc/systemd/system/rmuc-finals-live-sync.service
sudo cp /opt/douququ/deploy/systemd/rmuc-finals-live-sync.timer /etc/systemd/system/rmuc-finals-live-sync.timer
sudo cp /opt/douququ/deploy/systemd/rmuc-canvas-export.service /etc/systemd/system/rmuc-canvas-export.service
sudo install -d /etc/systemd/system/rmuc-backend.service.d
sudo tee /etc/systemd/system/rmuc-backend.service.d/runtime-readiness.conf >/dev/null <<'EOF'
[Service]
Environment=RMUC_FINALS_LIVE_REQUIRED=1
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now rmuc-live-sync.timer
sudo systemctl enable --now rmuc-finals-live-sync.timer
```

如果 PNG worker 已通过第 13.1 节的验证，在同一个 drop-in 中另加
`Environment=RMUC_CANVAS_EXPORT_REQUIRED=1`，并执行
`sudo systemctl enable --now rmuc-canvas-export`。

如果第 10 节的 API 限流规则有变化，同步合并到
`/etc/nginx/conf.d/rmuc.conf` 并先执行 `sudo nginx -t`。随后重新构建并重启：

```bash
cd /opt/douququ/frontend
sudo -u douququ npm run build
sudo systemctl restart rmuc-backend
sudo systemctl restart rmuc-frontend
sudo systemctl restart rmuc-live-sync.timer
sudo systemctl restart rmuc-finals-live-sync.timer
sudo systemctl reload nginx
```

启用了 PNG worker 时，再执行 `sudo systemctl restart rmuc-canvas-export`。

更新后检查：

```bash
sudo systemctl status rmuc-backend
sudo systemctl status rmuc-frontend
sudo systemctl status rmuc-live-sync.timer
sudo systemctl status rmuc-finals-live-sync.timer
sudo systemctl status nginx
curl http://127.0.0.1:8001/api/health
curl --fail http://127.0.0.1:8001/api/health/ready
systemctl list-timers rmuc-live-sync.timer rmuc-finals-live-sync.timer
```

启用了 PNG worker 时，再检查 `sudo systemctl status rmuc-canvas-export` 与
`curl --fail http://127.0.0.1:3010/health/ready`。

## 15. 常见问题

### 15.1 页面能打开，但数据请求失败

先看前端编译变量：

```bash
cat /opt/douququ/frontend/.env.production
```

确认 `NEXT_PUBLIC_API_BASE_URL` 是否正确。

再检查：

```bash
curl http://127.0.0.1:8001/api/health
sudo journalctl -u rmuc-backend -n 100 --no-pager
```

### 15.2 改了域名，但页面还在请求旧地址

这是因为 `NEXT_PUBLIC_API_BASE_URL` 会被打进前端构建产物。

解决方法：

```bash
cd /opt/douququ/frontend
sudo -u douququ npm run build
sudo systemctl restart rmuc-frontend
```

### 15.3 Nginx 返回 502

按这个顺序排查：

```bash
curl http://127.0.0.1:3005
curl http://127.0.0.1:8001/api/health
sudo nginx -t
sudo journalctl -u nginx -n 100 --no-pager
getenforce
```

如果前两个 `curl` 都正常，重点怀疑：

- SELinux 没放行 `httpd_can_network_connect`
- Nginx 配置写错
- systemd 服务没有真正启动成功

### 15.4 后端启动失败，提示找不到数据文件

通常是因为：

- 没有完整部署整个仓库
- `WorkingDirectory` 不在 `/opt/douququ`
- 用错了启动目录

后端不是一个独立目录即可运行的服务，它依赖仓库根目录的数据和脚本。

### 15.5 服务器性能不够，赛区页很慢

可以先把后端服务里的样本数调低：

```ini
Environment=RMUC_SIMULATION_SAMPLES=800
```

然后执行：

```bash
sudo systemctl daemon-reload
sudo systemctl restart rmuc-backend
```

### 15.6 实时赛程没有更新

先确认定时器是否启用、下一次触发时间是否正常：

```bash
sudo systemctl status rmuc-live-sync.timer
sudo systemctl status rmuc-finals-live-sync.timer
systemctl list-timers rmuc-live-sync.timer rmuc-finals-live-sync.timer
```

再看最近一次同步日志：

```bash
sudo journalctl -u rmuc-live-sync.service -n 100 --no-pager
sudo journalctl -u rmuc-finals-live-sync.service -n 100 --no-pager
```

如果日志提示权限问题，重点检查：

- `/opt/douququ/data/runtime/rmuc_live/` 是否允许部署用户写入
- 两个 sync service 里的 `User`、`Group` 是否和实际部署用户一致
- `WorkingDirectory=/opt/douququ` 是否正确

如果日志正常但页面仍未显示实时结果，检查运行期产物：

```bash
ls -lh /opt/douququ/data/runtime/rmuc_live/
cat /opt/douququ/data/runtime/rmuc_live/sync_manifest.json
cat /opt/douququ/data/runtime/rmuc_live/finals/check_status.json
```

如果 finals `check_status.json` 为 `failed`，先看 `errorType` 和 `error`。
编号缺失/重复、BO 不一致、未知 group 或除已登记全明星赛外的越界场次都属于
fail-closed；修复 source/reference 契约前不要删除 last-known-good 或手工改写覆盖层。

## 16. 推荐最终状态

推荐上线后的结构：

- 代码目录：`/opt/douququ`
- Python 虚拟环境：`/opt/douququ/.venv`
- 前端监听：`127.0.0.1:3005`
- 后端监听：`127.0.0.1:8001`
- 区域赛实时同步：`rmuc-live-sync.timer`
- 复活赛/全国赛实时同步：`rmuc-finals-live-sync.timer`
- 实时数据目录：`/opt/douququ/data/runtime/rmuc_live`
- 对外入口：Nginx `80/443`
- 进程托管：`systemd`
- 云侧放通：安全组 `22/80/443`

如果你准备继续推进，我下一步可以直接再给你两份成品：

1. 一份可直接复制到服务器的 backend/frontend service 和两条 live-sync timer
2. 一份带 HTTPS、安全头和缓存策略的 `Nginx` 完整配置
