# RMUC 总控台 Ubuntu 部署指南

本文档面向将当前项目部署到一台 Ubuntu 服务器的场景，默认目标是：

- 前端：Next.js 生产服务，监听 `127.0.0.1:3005`
- 后端：FastAPI + Uvicorn，监听 `127.0.0.1:8001`
- 反向代理：Nginx 对外提供 `80/443`
- 部署方式：整仓部署到服务器，而不是只传 `frontend` 或 `backend`

当前文档基于下面这组版本验证：

- 前端：`next@16.2.4`
- React：`18.3.1`
- 后端：FastAPI + Uvicorn

## 1. 项目结构说明

这个项目不能只部署前端或只部署后端，原因是：

- 后端会直接读取根目录下的 `data/derived/...`
- 后端会直接导入根目录下的 `scripts/...`
- 前端会通过 `NEXT_PUBLIC_API_BASE_URL` 请求后端接口

因此推荐把整个仓库完整部署到服务器，例如：

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
- 如果你之前在服务器上临时把服务指到 `frontend_new`，现在统一切回 `/opt/douququ/frontend`

## 2. 服务器建议

推荐环境：

- Ubuntu 22.04 LTS 或 24.04 LTS
- Python 3.12
- Node.js 22 LTS
- Nginx 1.18+

额外说明：

- Next.js 16 官方要求 `Node.js >= 20.9.0`
- 如果你不用 Node.js 22，也至少要保证 `node -v` 不低于 `v20.9.0`

如果只是自用演示，`2C4G` 也能跑；如果准备公开访问，建议至少：

- 2 vCPU
- 4 GB 内存
- 20 GB SSD

## 3. 一次性安装系统依赖

先更新系统：

```bash
sudo apt update
sudo apt upgrade -y
```

安装基础依赖：

```bash
sudo apt install -y git curl nginx python3 python3-venv python3-pip
```

安装 Node.js 22：

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

检查版本：

```bash
node -v
npm -v
python3 --version
nginx -v
```

其中 `node -v` 必须满足：

```bash
>= v20.9.0
```

## 4. 拉取代码

以部署到 `/opt/douququ` 为例：

```bash
sudo mkdir -p /opt/douququ
sudo chown -R $USER:$USER /opt/douququ
git clone <你的仓库地址> /opt/douququ
cd /opt/douququ
```

如果你是手工上传代码，也建议保持相同目录结构。

## 5. 部署后端

### 5.1 创建虚拟环境

在仓库根目录执行：

```bash
cd /opt/douququ
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r backend/requirements.txt
```

### 5.2 本地验证后端

```bash
cd /opt/douququ
source .venv/bin/activate
uvicorn backend.app.main:app --host 127.0.0.1 --port 8001
```

新开一个终端检查：

```bash
curl http://127.0.0.1:8001/api/health
```

应返回：

```json
{"status":"ok"}
```

确认无误后按 `Ctrl+C` 停掉手动运行。

### 5.3 可选环境变量

当前后端只有一个可选环境变量：

```bash
RMUC_SIMULATION_SAMPLES=1200
```

说明：

- 不设置时默认是 `1200`
- 如果你未来想降低实时模拟压力，可以调低
- 如果你要更高精度，也可以调高，但会增加 CPU 开销

## 6. 部署前端

### 6.1 安装依赖

```bash
cd /opt/douququ/frontend
npm ci
```

建议先确认 Node 版本：

```bash
node -v
```

如果低于 `v20.9.0`，不要继续构建，先升级 Node.js。

### 6.2 配置前端环境变量

前端通过 `NEXT_PUBLIC_API_BASE_URL` 调后端接口。

推荐使用同域名反代，所以这里直接写站点根域名：

```bash
cd /opt/douququ/frontend
cat > .env.production <<'EOF'
NEXT_PUBLIC_API_BASE_URL=https://你的域名
EOF
```

如果你还没有域名，临时也可以写公网 IP：

```bash
NEXT_PUBLIC_API_BASE_URL=http://你的服务器公网IP
```

注意：

- 这个变量是前端编译时使用的
- 改完以后必须重新执行 `npm run build`
- 如果未来改域名或改反代地址，也必须重新构建前端

### 6.3 构建并验证前端

```bash
cd /opt/douququ/frontend
npm run build
npm run start -- --hostname 127.0.0.1 --port 3005
```

说明：

- 当前项目已经在本地用 `Next.js 16.2.4` 验证通过
- Next.js 16 的 `next build` 默认会显示 `Turbopack`，这是正常现象，不是报错
- 如果你修改了 `.env.production`，必须重新执行一次 `npm run build`

新开一个终端检查：

```bash
curl -I http://127.0.0.1:3005
```

确认返回 `200` 后按 `Ctrl+C` 停掉手动运行。

## 7. 配置 systemd 守护进程

### 7.1 后端服务

创建文件：

```bash
sudo nano /etc/systemd/system/rmuc-backend.service
```

写入：

```ini
[Unit]
Description=RMUC Backend API
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/opt/douququ
Environment=PYTHONPATH=/opt/douququ
Environment=RMUC_SIMULATION_SAMPLES=1200
ExecStart=/opt/douququ/.venv/bin/uvicorn backend.app.main:app --host 127.0.0.1 --port 8001
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

如果你不想用 `www-data`，也可以换成自己的部署用户，但前后端服务建议统一。

### 7.2 前端服务

创建文件：

```bash
sudo nano /etc/systemd/system/rmuc-frontend.service
```

写入：

```ini
[Unit]
Description=RMUC Frontend
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/opt/douququ/frontend
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm run start -- --hostname 127.0.0.1 --port 3005
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

### 7.3 启动服务

```bash
sudo systemctl daemon-reload
sudo systemctl enable rmuc-backend
sudo systemctl enable rmuc-frontend
sudo systemctl start rmuc-backend
sudo systemctl start rmuc-frontend
```

检查状态：

```bash
sudo systemctl status rmuc-backend
sudo systemctl status rmuc-frontend
```

查看日志：

```bash
journalctl -u rmuc-backend -f
journalctl -u rmuc-frontend -f
```

## 8. 配置 Nginx 反向代理

创建配置文件：

```bash
sudo nano /etc/nginx/sites-available/rmuc
```

写入：

```nginx
server {
    listen 80;
    server_name 你的域名;

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

启用配置：

```bash
sudo ln -s /etc/nginx/sites-available/rmuc /etc/nginx/sites-enabled/rmuc
sudo nginx -t
sudo systemctl reload nginx
```

## 9. 配置 HTTPS

安装 Certbot：

```bash
sudo apt install -y certbot python3-certbot-nginx
```

申请证书：

```bash
sudo certbot --nginx -d 你的域名
```

完成后，前端环境变量建议保持：

```bash
NEXT_PUBLIC_API_BASE_URL=https://你的域名
```

如果你原来不是 HTTPS 地址，改完后要重新构建前端：

```bash
cd /opt/douququ/frontend
npm run build
sudo systemctl restart rmuc-frontend
```

## 10. 防火墙建议

如果启用了 UFW：

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

不需要对外放行 `3005` 和 `8001`，因为它们只监听 `127.0.0.1`。

## 11. 部署后的检查项

建议逐项检查：

### 11.1 基础接口

```bash
curl http://127.0.0.1:8001/api/health
curl http://127.0.0.1:8001/api/overview | head
```

### 11.2 前端页面

浏览器检查：

- `/`
- `/elo-rankings`
- `/regions/east_region?view=qualification`
- `/regions/east_region?view=playoff`
- `/regions/north_region?view=slots`
- `/regions/north_region?view=final-rankings`

### 11.3 重点功能

- 首页是否正常加载
- Elo 总览页是否正常加载
- 赛区页是否会自动生成随机种子
- 抽签布位是否按 `1,2,3...` 正常排序
- 资格赛与主淘汰赛是否分开显示
- 冠军战是否位于季军战上方

## 12. 后续更新流程

以后代码更新时，推荐按这个顺序：

```bash
cd /opt/douququ
git pull
```

如果 Python 依赖变了：

```bash
source .venv/bin/activate
pip install -r backend/requirements.txt
```

如果前端依赖变了：

```bash
cd /opt/douququ/frontend
npm ci
```

重新构建前端：

```bash
cd /opt/douququ/frontend
npm run build
```

重启服务：

```bash
sudo systemctl restart rmuc-backend
sudo systemctl restart rmuc-frontend
```

更新完成后建议检查：

```bash
sudo systemctl status rmuc-backend
sudo systemctl status rmuc-frontend
curl http://127.0.0.1:8001/api/health
```

## 13. 常见问题

### 13.1 页面能打开，但数据请求失败

先检查前端环境变量：

```bash
cat /opt/douququ/frontend/.env.production
```

确认 `NEXT_PUBLIC_API_BASE_URL` 是否正确。

然后确认后端是否正常：

```bash
curl http://127.0.0.1:8001/api/health
```

### 13.2 改了域名但页面仍然请求旧地址

这是因为 `NEXT_PUBLIC_API_BASE_URL` 是编译进前端包里的。

解决方法：

```bash
cd /opt/douququ/frontend
npm run build
sudo systemctl restart rmuc-frontend
```

### 13.3 后端启动失败，提示找不到数据文件

通常是因为你没有部署完整仓库，或者 `WorkingDirectory` 配错了。

必须保证：

- 根目录包含 `data/`
- 根目录包含 `scripts/`
- systemd 的 `WorkingDirectory=/opt/douququ`

### 13.4 赛区页很慢

可以先适当降低后端样本数：

```ini
Environment=RMUC_SIMULATION_SAMPLES=800
```

然后：

```bash
sudo systemctl daemon-reload
sudo systemctl restart rmuc-backend
```

## 14. 上线前建议再做的两件事

### 14.1 收紧后端 CORS

当前后端代码里 CORS 是全开放：

```python
allow_origins=["*"]
```

正式上线后建议改成只允许你的域名，例如：

```python
allow_origins=[
    "https://你的域名",
]
```

### 14.2 保持 Next.js 补丁更新

当前前端已经升级到 `next@16.2.4`。这次本地升级后，`npm test`、`npm run build` 和关键页面浏览器回归都已通过，当前 `npm audit --omit=dev` 结果也是 `0 vulnerabilities`。

但这不代表后续可以长期不动。正式上线后仍建议：

- 定期执行 `npm outdated`
- 优先跟进 `next` 的补丁版本更新
- 每次升级后至少重新跑一次 `npm run build`

## 15. 推荐的最终目录与服务组合

推荐最终状态如下：

- 代码目录：`/opt/douququ`
- Python venv：`/opt/douququ/.venv`
- 前端端口：`127.0.0.1:3005`
- 后端端口：`127.0.0.1:8001`
- 对外访问：`https://你的域名`
- 进程管理：`systemd`
- 反向代理：`nginx`

如果你后面准备正式上线，我还可以继续帮你补两份东西：

1. 一份可直接复制的 `systemd` 服务文件模板
2. 一份适合这个项目的 `Nginx + HTTPS + 安全头` 完整配置
