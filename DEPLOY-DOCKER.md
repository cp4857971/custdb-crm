# 通信客户资料库 · Docker 部署说明（v0.0.21）

把「通信客户资料库」以 **Docker 容器**方式运行（适合飞牛 NAS 的 Docker 应用中心、群晖/威联通、云服务器、软路由等任意支持 Docker 的设备）。
功能与 fnOS 原生应用包一致：客户档案、套餐费用、小业务、协议到期提醒、数据导入导出、管理员/登录用户/临时账号、**严格登录验证（所有用户需登录）**。

---

## 一、目录结构

```
通信客户资料库-Docker部署/
├── 部署说明.md           # 本文档
├── docker-compose.yml    # 一键部署编排
└── backend/              # 镜像构建上下文
    ├── Dockerfile        # 镜像定义（node:22-slim）
    ├── .dockerignore
    ├── package.json / package-lock.json
    ├── server.js         # 服务端（含全部业务逻辑）
    └── public/           # 前端静态页面（已构建好，无需再编译）
```

## 二、快速开始

### 方式 A：命令行构建 + 启动（推荐，任选一台有 Docker 的机器）

```bash
# 1) 构建镜像（只需一次）
cd backend
docker build -t custdb:0.0.21 .

# 2) 回到部署包根目录，启动
cd ..
docker compose up -d

# 3) 查看状态
docker compose ps
```

### 方式 B：飞牛 NAS · Docker 应用中心

1. 飞牛桌面 → **Docker → 应用中心 → 自定义应用 → 新建**；
2. 粘贴 `docker-compose.yml` 内容（或按界面填写：镜像 `custdb:0.0.21`、端口 5001、挂载目录）；
3. 先在任意机器上执行 `docker build` 得到镜像，再通过 **镜像 → 导入**（`docker save custdb:0.0.21 -o custdb.tar` + 界面导入）把镜像装入飞牛；
4. 启动后访问 `http://NAS内网IP:5001/app/custdb`。

### 访问地址

```
http://服务器IP:5001/app/custdb
```

- 默认超级管理员：`admin` / `admin`（**登录后请立即修改**，系统设置 → ① 修改密码）
- **所有用户需登录验证（默认开启）**：未登录一律 401 并弹登录框（公网/匿名进不来）；登录弹窗已精简（无提示文字）。如需临时免登录，超管在「系统设置 → ⓪ 严格登录验证」关闭

## 三、数据存储

- 客户数据保存在挂载卷 `./custdb-data`（相对 compose 文件所在目录）→ 容器内 `/data`
  - `custdb.db`（SQLite 客户数据库）、`config.json`（账号/端口/路径等配置）
- **升级容器**：`docker compose pull`（或重新 build 新 tag）→ `docker compose up -d`，卷不动数据不丢；**备份**：直接复制 `custdb-data` 目录。
- 迁移旧 fnOS 数据：把旧 `custdb.db`、`config.json` 复制进新数据目录即可（结构与本地一致）。

## 四、常用运维命令

```bash
docker compose logs -f custdb     # 查看日志
docker compose restart custdb     # 重启
docker compose down               # 停止（数据仍在卷中）
docker volume rm 不需要             # 数据在 bind mount 目录，无需管理匿名卷
```

## 五、环境变量（docker-compose.yml 中可调）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `5001` | 容器内服务端口（映射到宿主时改左侧端口即可，如 `8001:5001`） |
| `GATEWAY_PREFIX` | `/app/custdb` | 访问路径前缀，保持默认 |
| `DATA_DIR` | `/data` | 容器内数据目录，**勿改**（配合卷挂载） |
| `TZ` | 无 | 时区，可设 `Asia/Shanghai` |

## 六、手机 APP（安卓）

- **PWA 方式（无需安装）**：手机浏览器打开 `http://服务器IP:5001/app/custdb` → 浏览器菜单「添加到主屏幕」，桌面生成图标，全屏打开，和 APP 一样用；
- **APK 方式**：使用「通信客户资料库-安卓APP.zip」内的 `app-debug.apk`（WebView 壳），首次打开填 `http://服务器IP:5001/app/custdb`，数据仍存 Docker 卷，电脑手机互通。

## 七、公网访问（可选）

- 飞牛 NAS：优先 **FN Connect**（设置 → 远程访问），应用地址 = `https://你的fNID域名/app/custdb`；
- 第三方隧道（frpc / NPC / cloudflared / 节点小宝）：把公网端口映射到 **宿主 5001 端口**即可，`https://你的域名/app/custdb`；
- 容器已内置健康检查；公网暴露前建议：① **先改默认超管密码**；② 在「系统设置 → ⓪ 严格登录验证」开启严格登录（未登录一律 401 进不来）。

## 七、注意事项

- 镜像使用 `node:22-slim`，内置 SQLite（node:sqlite），无需额外数据库；
- 首次启动自动生成 `config.json` 与管理员配置，无初始化步骤；
- 若宿主 5001 被占用：改 compose 中 `ports` 左侧端口（如 `"8001:5001"`），再 `docker compose up -d`。
