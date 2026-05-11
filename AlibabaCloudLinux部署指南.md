# RMUC 总控台 Alibaba Cloud Linux 部署指南

本文档面向将当前项目部署到阿里云 ECS 的场景，目标环境为 `Alibaba Cloud Linux`。

推荐部署形态：

- 前端：Next.js 生产服务，监听 `127.0.0.1:3005`
- 后端：FastAPI + Uvicorn，监听 `127.0.0.1:8001`
- 反向代理：Nginx 对外提供 `80/443`
- 进程管理：`systemd`
- 部署方式：整仓部署到服务器

当前仓库实际依赖：

- 前端：`next@16.2.4`、`react@18.3.1`
- 后端：`fastapi`、`uvicorn`、`httpx`
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

这两个端口只监听本机回环地址。

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
- 如果你的镜像是 `Alibaba Cloud Linux 2`，把文档里的 `dnf` 替换为 `yum`

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
```

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
sudo -u douququ /opt/douququ/.venv/bin/pip install -r /opt/douququ/backend/requirements.txt
```

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

新增的官方赛程和“王牌预言家”同步不在后端请求路径里实时抓取，而是由独立的 `systemd timer` 定时运行：

- 官方赛程写入：`/opt/douququ/data/runtime/rmuc_live/normalized_schedule.json`
- 王牌预言家写入：`/opt/douququ/data/runtime/rmuc_live/mini_program_predictions.json`
- 同步状态汇总：`/opt/douququ/data/runtime/rmuc_live/sync_manifest.json`

仓库已提供模板，部署时直接复制：

```bash
sudo cp /opt/douququ/deploy/systemd/rmuc-live-sync.service /etc/systemd/system/rmuc-live-sync.service
sudo cp /opt/douququ/deploy/systemd/rmuc-live-sync.timer /etc/systemd/system/rmuc-live-sync.timer
```

当前定时策略是：

- `00:00-06:00`：每 30 分钟同步一次
- `06:00:30-23:59:30`：每 30 秒同步一次
- `AccuracySec=5s`、`RandomizedDelaySec=5s`：保留少量抖动，避免完全固定时刻集中请求

如果部署用户不是 `douququ`，同步修改 `/etc/systemd/system/rmuc-live-sync.service` 里的 `User`、`Group` 和 `/opt/douququ` 路径。

上线前建议先手动跑一轮，确认网络和写入权限正常：

```bash
cd /opt/douququ
sudo -u douququ /opt/douququ/.venv/bin/python /opt/douququ/scripts/sync_rmuc_live.py --mini-program-ttl-seconds 300 --mini-program-refresh-window-seconds 60
ls -lh /opt/douququ/data/runtime/rmuc_live/
```

如果需要临时关闭王牌预言家同步，可以把 `rmuc-live-sync.service` 里的环境变量改成：

```ini
Environment=RMUC_MINI_PROGRAM_ENABLED=0
```

### 9.4 启动服务

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now rmuc-backend
sudo systemctl enable --now rmuc-frontend
sudo systemctl enable --now rmuc-live-sync.timer
```

检查状态：

```bash
sudo systemctl status rmuc-backend
sudo systemctl status rmuc-frontend
sudo systemctl status rmuc-live-sync.timer
systemctl list-timers rmuc-live-sync.timer
```

查看日志：

```bash
sudo journalctl -u rmuc-backend -f
sudo journalctl -u rmuc-frontend -f
sudo journalctl -u rmuc-live-sync.service -n 100 --no-pager
```

## 10. 配置 Nginx

Alibaba Cloud Linux 通常直接使用 `/etc/nginx/conf.d/*.conf`，不是 Ubuntu 常见的 `sites-available / sites-enabled` 结构。

创建 `/etc/nginx/conf.d/rmuc.conf`：

```nginx
server {
    listen 80;
    server_name rm.ecustcic.com;

    client_max_body_size 20m;

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
curl http://127.0.0.1:8001/api/overview | head
curl -I http://127.0.0.1:3005
curl -I http://你的域名或公网IP
systemctl list-timers rmuc-live-sync.timer
sudo journalctl -u rmuc-live-sync.service -n 50 --no-pager
test -s /opt/douququ/data/runtime/rmuc_live/normalized_schedule.json
test -s /opt/douququ/data/runtime/rmuc_live/sync_manifest.json
```

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
sudo -u douququ /opt/douququ/.venv/bin/pip install -r /opt/douququ/backend/requirements.txt
```

如果前端依赖有变化：

```bash
cd /opt/douququ/frontend
sudo -u douququ npm ci
```

重新构建并重启：

```bash
cd /opt/douququ/frontend
sudo -u douququ npm run build
sudo systemctl restart rmuc-backend
sudo systemctl restart rmuc-frontend
sudo systemctl restart rmuc-live-sync.timer
sudo systemctl reload nginx
```

更新后检查：

```bash
sudo systemctl status rmuc-backend
sudo systemctl status rmuc-frontend
sudo systemctl status rmuc-live-sync.timer
sudo systemctl status nginx
curl http://127.0.0.1:8001/api/health
systemctl list-timers rmuc-live-sync.timer
```

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
systemctl list-timers rmuc-live-sync.timer
```

再看最近一次同步日志：

```bash
sudo journalctl -u rmuc-live-sync.service -n 100 --no-pager
```

如果日志提示权限问题，重点检查：

- `/opt/douququ/data/runtime/rmuc_live/` 是否允许部署用户写入
- `rmuc-live-sync.service` 里的 `User`、`Group` 是否和实际部署用户一致
- `WorkingDirectory=/opt/douququ` 是否正确

如果日志正常但页面仍未显示实时结果，检查运行期产物：

```bash
ls -lh /opt/douququ/data/runtime/rmuc_live/
cat /opt/douququ/data/runtime/rmuc_live/sync_manifest.json
```

## 16. 推荐最终状态

推荐上线后的结构：

- 代码目录：`/opt/douququ`
- Python 虚拟环境：`/opt/douququ/.venv`
- 前端监听：`127.0.0.1:3005`
- 后端监听：`127.0.0.1:8001`
- 实时同步：`rmuc-live-sync.timer`
- 实时数据目录：`/opt/douququ/data/runtime/rmuc_live`
- 对外入口：Nginx `80/443`
- 进程托管：`systemd`
- 云侧放通：安全组 `22/80/443`

如果你准备继续推进，我下一步可以直接再给你两份成品：

1. 一份可直接复制到服务器的 `rmuc-backend.service`、`rmuc-frontend.service` 和 `rmuc-live-sync.timer`
2. 一份带 HTTPS、安全头和缓存策略的 `Nginx` 完整配置
