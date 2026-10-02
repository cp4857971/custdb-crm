# 通信客户资料库 · 各服务端部署配置教程（v0.0.23）

> 适用版本：v0.0.23（增强版）
> 默认超级管理员：**admin / admin**（登录后请立即修改密码）
> 所有用户均需登录验证；数据统一存 SQLite

本教程覆盖 4 种服务端部署形态：**Windows 服务端 EXE**、**Linux 服务端**、**Docker**、**飞牛 fnOS 原生应用**，
以及**桌面客户端**与**公网安全访问**的配置。四种形态共用同一套界面、接口与数据格式，可自由混用（例如 Windows 服务端 + 安卓 APP 客户端）。

---

## 〇、名词速览

| 名词 | 说明 |
| --- | --- |
| 服务端 | 保存客户资料、提供网页界面的程序（Windows EXE / Linux 程序 / Docker 容器 / fnOS 应用） |
| 客户端 | 打开浏览器/APP 访问服务端的程序（桌面客户端启动器、手机 PWA/APK、浏览器直接访问） |
| 数据目录 | SQLite 数据库与配置文件所在目录（`custdb.db` + `config.json`），可整体备份/迁移 |
| 访问地址 | 默认 `http://服务器IP:5001/app/custdb` |

---

## 一、Windows 服务端（EXE）配置

### 1.1 安装

1. 解压 `custdb-server-win-x64.zip`，得到：
   ```
   custdb-server-win-x64.exe   ← 服务端主程序（双击运行）
   web/                        ← 前端界面目录（必须与 EXE 同级，勿删除）
   ```
2. 双击 `custdb-server-win-x64.exe`，弹出命令行窗口显示：
   `[custdb] listening on http://0.0.0.0:5001/app/custdb`
3. 浏览器访问 `http://本机IP:5001/app/custdb`，用 admin/admin 登录。

### 1.2 数据目录

- 首次运行自动在 EXE 同目录创建 `custdb-data/`（内含 `custdb.db` 与 `config.json`）。
- **备份/迁移**：整目录复制 `custdb-data/` 到新机器同位置即可。

### 1.3 修改端口与路径（可选）

- 临时生效（当前命令行窗口）：先按 `Ctrl+C` 停止，再运行：
  ```bat
  set PORT=8080
  custdb-server-win-x64.exe
  ```
  访问地址变为 `http://本机IP:8080/app/custdb`
- 永久生效：`此电脑 → 属性 → 高级系统设置 → 环境变量` 新建：
  - `PORT`（默认 5001）
  - `GATEWAY_PREFIX`（默认 /app/custdb，一般不用改）

### 1.4 开机自启（可选）

任务计划程序 → 创建基本任务 → 触发器选「计算机启动时」→ 操作选「启动程序」→ 程序选择 EXE 完整路径。若需后台静默运行，可配合启动器脚本。

### 1.5 防火墙放行

- 控制面板 → Windows 防火墙 → 高级设置 → 入站规则 → 新建规则 → 端口 → TCP 5001 → 允许连接。
- 局域网其他电脑/手机即可访问；公网访问见「五、公网安全访问」。

---

## 二、Linux 服务端配置

### 2.1 安装

1. 解压 `custdb-server-linux-x64.zip`：
   ```bash
   unzip custdb-server-linux-x64.zip
   cd custdb-server-linux-x64
   chmod +x custdb-server-linux-x64
   ```
2. 前台运行（测试）：
   ```bash
   ./custdb-server-linux-x64
   ```
   看到 `listening on http://0.0.0.0:5001/app/custdb` 即成功，浏览器访问 `http://服务器IP:5001/app/custdb`。

### 2.2 数据目录

同 Windows：首次运行自动创建 EXE 同目录 `custdb-data/`，整目录备份即可。

### 2.3 修改端口

```bash
PORT=8080 ./custdb-server-linux-x64
```

### 2.4 注册 systemd 服务（开机自启 + 后台运行）

创建 `/etc/systemd/system/custdb.service`：
```ini
[Unit]
Description=CustDb Telecom Customer DB
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/custdb
ExecStart=/opt/custdb/custdb-server-linux-x64
Restart=always
# 如需改端口：Environment=PORT=8080

[Install]
WantedBy=multi-user.target
```
启用：
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now custdb
sudo systemctl status custdb     # 查看运行状态
```

### 2.5 防火墙放行

```bash
sudo firewall-cmd --permanent --add-port=5001/tcp && sudo firewall-cmd --reload
# 或 ufw：sudo ufw allow 5001/tcp
```

---

## 三、Docker 部署

### 3.1 构建镜像

```bash
cd backend   # 进入项目 backend 目录
docker build -t custdb:0.0.23 .
```

### 3.2 docker compose 一键部署

项目根目录已有 `docker-compose.yml`：
```bash
docker compose up -d
```
- 访问：`http://服务器IP:5001/app/custdb`
- 数据卷：`./custdb-data:/data`（客户数据持久化在宿主目录，升级容器不丢数据）
- 改宿主端口：编辑 docker-compose.yml 的 `ports: "8001:5001"`，访问 `http://IP:8001/app/custdb`

### 3.3 单独 docker run（示例）

```bash
docker run -d --name custdb -p 5001:5001 \
  -v /你的数据目录:/data \
  -e GATEWAY_PREFIX=/app/custdb \
  custdb:0.0.23
```

> 说明：Docker 镜像基于 node:22-slim，内置 SQLite，无需额外数据库；支持群晖 / 飞牛 Docker 应用中心 / 云服务器。

---

## 四、飞牛 fnOS 原生应用（.fpk）

1. fnOS 应用中心 → 设置 → 开发者模式（开启）→ 手动安装 → 选择 `custdb.fpk`。
2. 安装向导可选填：**数据存储路径**（默认应用数据目录）与**服务端口**（TCP，默认 5001）。
3. 访问：浏览器 `http://NAS的IP:5666/app/custdb`（经 fnOS 统一网关，多用户隔离）或 `http://NAS的IP:5001/app/custdb`（直连 TCP）。
4. 数据目录：安装向导指定路径下生成 `custdb.db`（SQLite）+ `config.json`。

---

## 五、桌面客户端配置（Windows / Linux）

1. 解压对应客户端包（`custdb-client-win-x64.zip` / `custdb-client-linux-x64.zip`）。
2. 打开同目录 `client-config.json`：
   ```json
   {
     "server": "http://192.168.1.100:5001/app/custdb"
   }
   ```
   把 `server` 改为**服务端地址**（服务器 IP 或域名；公网访问时填隧道域名）。
3. 双击 EXE（Windows）/ `./custdb-client-linux-x64`（Linux），自动打开默认浏览器登录使用。

> 手机端：浏览器直接访问服务端地址即可（PWA 可「添加到主屏幕」）；安卓 APK 见 `mobile/CustDbApp`。

---

## 六、公网安全访问（隧道）

应用管理页「系统设置」内置 4 种隧道模板（统一把本机端口映射到公网域名），任选其一：

| 隧道 | 适用 | 示例配置要点 |
| --- | --- | --- |
| **frpc** | 有自建 frps 服务器 | serverAddr/serverPort + token，`local_port=5001`，remote_port 自定义 |
| **NPC（nps）** | 有自建 nps 服务器 | 客户端 key，映射 `local_port=5001` |
| **cloudflared** | 有 Cloudflare 账号/域名 | `cloudflared tunnel --url http://127.0.0.1:5001`（Quick Tunnel 免费） |
| **节点小宝** | 内网穿透工具 | 选「Web 站点」类型，内网地址填 `http://127.0.0.1:5001` |

**安全建议**（务必执行）：
1. 登录后立即修改默认密码 admin/admin
2. 访客/临时人员使用**临时访问用户**（限时账号，超管可建）
3. 公网只走 **HTTPS 域名**，不要直接暴露 5001 端口到公网

---

## 七、常见问题

| 问题 | 处理 |
| --- | --- |
| 页面打不开 / 连接拒绝 | 检查服务端进程是否在跑、端口是否被占用、防火墙是否放行 |
| 数据目录在哪 | EXE 同目录 `custdb-data/`（Docker 为挂载卷 /data；fnOS 为向导指定路径） |
| 忘记密码 | 删除 `custdb-data/config.json` 中的用户后重启服务（超管 admin/admin 重置） |
| 端口被占用 | 换 PORT 环境变量（见各节） |
| 手机访问不了 | 手机与服务端同一局域网；跨网用隧道（见六） |
| 打印机打印 | 管理员在线可导出 CSV/Excel/JSON 并直接打印名单（页面打印样式已内置） |

---

*开发者/发布者：cp · 仓库：https://github.com/cp4857971/custdb-crm*
