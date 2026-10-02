# 通信客户资料库 · 开发进程（Development Process）

> 本文记录「通信客户资料库」从需求到交付的完整开发过程：技术选型、架构演进、关键决策、验证方式。
> 版本更迭明细见 [CHANGELOG.md](CHANGELOG.md)；安装配置见 [安装配置.md](安装配置.md)。

---

## 一、项目背景与需求

通信行业营业/装维场景需要一套**客户资料管理工具**，核心诉求：

1. 客户档案：姓名、联系电话、**身份证住址**、**装机地址**（敏感个人信息，需妥善存储）
2. 套餐管理：套餐名称、套餐费用（元/月）
3. 小业务：云盘、云监控、路由器等增值业务
4. **协议到期提醒**：自动计算剩余天数与状态（已到期/30天内/60天内/正常），红橙黄绿标色
5. 数据导入导出：格式不限制（CSV/Excel/JSON/TXT）
6. 服务端与手机端**互通互联**：同一份数据
7. 多用户、管理员、登录验证、安全访问

部署形态要求：**飞牛 fnOS 原生应用（.fpk）** + **Docker 部署** + **安卓手机 APP**。

## 二、技术选型

| 层 | 选型 | 理由 |
| --- | --- | --- |
| 后端 | Node.js + Express | fnOS 原生应用规范要求；统一网关转发（X-Trim-Userid 多用户隔离） |
| 存储 | **SQLite（Node 内置 node:sqlite）** | 零外部依赖、适合大数据量、并发写；数据目录自定义（安装向导/设置页/环境变量） |
| 前端 | React + Vite（移动优先） | 手机优先设计、PWA 化、打包后由后端直接托管静态资源 |
| 应用包 | fnOS Native 规范（fnpack） | manifest / cmd / config / ui / wizard 标准布局，可安装到飞牛 |
| 安卓 | PWA + WebView 壳 APK（Android Studio 工程） | 与服务端同一数据源，填 NAS 地址即用 |
| 认证 | 三类账号：超管 admin / 正式登录用户 / 临时访问用户 | 所有用户需登录验证（默认开启） |
| 公网访问 | frpc / NPC / cloudflared / 节点小宝 隧道模板 | 内置配置模板，安全建议内置 |

## 三、架构演进

```
浏览器(电脑/手机PWA/安卓APK)
        │  HTTPS / 网关
        ▼
飞牛统一网关(/app/custdb) 或 直接 TCP:5001
        │  X-Trim-Userid 多用户隔离
        ▼
Express API (/api/*) ──┬─ customers（正式客户）
                       ├─ portin（异网用户）
                       ├─ plan_library（套餐业务库 v0.0.23）
                       ├─ addon_library（小业务库 v0.0.23）
                       ├─ detect-operator（号码识别 v0.0.23）
                       ├─ auth/login、admin/*（用户与权限）
                       └─ stats、export、import（统计与数据交换）
        │
        ▼
SQLite custdb.db（数据目录自定义；正式客户/异网用户分表；按用户隔离）
```

### 关键演进节点

- **v0.0.1–v0.0.4**：基础 CRUD + 到期提醒 + 导入 + 打包修复（符号链接清理）
- **v0.0.5–v0.0.6**：数据路径自定义 + 安装向导
- **v0.0.7–v0.0.8**：管理员体系 + 三类统计（自动统计/套餐统计/协议统计）
- **v0.0.9**：异网用户（策反名单）独立视图
- **v0.0.10**：存储定稿 SQLite + 数据导出
- **v0.0.11–v0.0.12**：超管/临时账号 + 隧道模板 + 安装向导端口
- **v0.0.14–v0.0.15**：登录体系 + Docker 部署
- **v0.0.18**：所有用户需登录验证（默认开启）
- **v0.0.19–v0.0.21**：安卓 APP + 手机端适配 + 运营商/备注/在线导出打印
- **v0.0.22**：开发者/发布者改 cp
- **v0.0.23（当前）**：套餐业务库 + 小业务库 + 折扣 + 号码识别运营商 + 库自定义管理

## 四、v0.0.23 开发过程（本轮）

### 1. 后端改造（已完成并通过验证）

在既有 Express API 之上新增：

- **数据表**：`plan_library`（套餐业务库）、`addon_library`（小业务库）；`customers`/`portin` 增加 `discount` 列（ALTER 兼容旧库）
- **幂等预置**：`seedLibrary()` 启动时自动写入内置套餐 33 条、小业务 21 条（已存在则跳过）
- **号码识别**：`detectOperator(phone)` 按号段识别运营商（移动/联通/电信，非法/虚拟号段返回 null）
- **新 API**：
  - `GET /api/library/plans`、`GET /api/library/addons`（支持 ?operator= 过滤）
  - `POST/DELETE /api/library/plans`、`POST/DELETE /api/library/addons`（管理员；内置不可删）
  - `GET /api/detect-operator?phone=`
- **折扣全链路**：导入表头别名（折扣/优惠/折扣优惠/discount/off）、导出列、种子数据、创建/更新接口全部支持

### 2. 前端注入（构建产物级）

- 前端为压缩 React bundle（无源码），采用字符串注入方式完成 14 处修改：
  - 客户/异网表单与详情卡：折扣输入栏、折扣行、运营商自动识别、套餐/小业务 datalist 候选
  - 管理后台新增「套餐业务库」页签（套餐库/小业务库两个子页，管理员增删，内置标注不可删）
- 注入后经 acorn/Node vm 语法校验通过（多轮括号修复：try 闭合、函数声明分号、数组闭合、逗号恢复）

### 3. 验证（自动化）

- **后端冒烟测试**：独立数据目录 + 独立端口启动真实服务，21 项用例全部通过（登录、套餐/小业务预置数量与类别、号段识别 138→移动/130→联通/189→电信/非法→null、管理员增删自定义套餐与小业务、内置不可删、客户/异网创建更新带折扣、导出可用）
- **端到端验证**：启动完整服务 → 前端页面 200 → bundle 含注入代码 → 登录 admin/admin → 套餐库 33 项 → 小业务库 21 项 → 号码识别 → 创建客户（折扣 8折）→ 列表含折扣字段 → 导出 CSV 含折扣列 → 协议统计接口正常，全部通过

### 4. 打包与发布

- manifest 更新：version=0.0.23、maintainer=cp、distributor=cp；LICENSE 版权人改 cp
- 按 fnOS Native 规范重新组装 app.tgz（MD5 写回 manifest checksum），gzip(tar) 打包生成 `custdb-v0.0.23.fpk`
- 解包回读验证：checksum 一致、新代码在包内、包结构完整
- 上传 GitHub 源码仓库（cp4857971/custdb，main 分支）

## 五、开发/构建/安装流程速览

```bash
# 1) 本地开发预览
npm install --workspaces
npm run dev:backend          # 后端 http://localhost:5001/app/custdb
npm run dev:frontend         # Vite 开发服务器

# 2) 构建 fnOS 应用包
npm install --workspaces
npm run build                # 前端构建 → 组装 backend+public → 依赖 → fnpack 打包
# 未装 fnpack 时手动执行：
fnpack build --directory custdb   # 生成 custdb.fpk

# 3) 安装到飞牛 fnOS
# 应用中心 → 设置 → 开发者模式(开启) → 手动安装 → 选择 custdb.fpk

# 4) Docker 部署
cd backend && docker build -t custdb:0.0.23 .
# 或 docker-compose up -d
# 访问 http://IP:5001/app/custdb
```

## 六、验证与质量保障

| 环节 | 方式 |
| --- | --- |
| 后端语法 | `node --check server.js`（exit 0） |
| 后端逻辑 | 21 项冒烟测试（独立端口实起服务） |
| 前端注入 | acorn / Node vm.Script 语法校验 bundle |
| 端到端 | 完整服务启动：页面、登录、套餐库、号码识别、折扣链路、导出、统计 |
| 打包 | 解包回读 + checksum 一致性 + 文件存在性核对 |
| 仓库 | GitHub 上传后 get_file_contents 回读确认 |

---

## 七、本轮迭代同步（v0.0.23 增强）

**2026-10-03 · 套餐名称运营商联动增强**

- 需求：选择运营商后，即可选择该运营商的套餐名称（家庭融合/E家融合/单卡）。
- 实现：正式客户与异网用户两个表单的「套餐名称」在原有 datalist（随运营商过滤）基础上，新增**运营商套餐标签区**——选择运营商后直接展示该运营商全部套餐（含类别与月费提示），点击标签即填入套餐名称；仍可自行输入新套餐名（写入套餐业务库后后续可选）。
- 涉及文件：`frontend/src/App.jsx`（FormModal / PortinFormModal 两处）。

**2026-10-03 · 联系电话 11 字符限制**

- 需求：联系电话输入最多限制 11 字符（手机号码）。
- 实现：正式客户与异网用户表单的「联系电话 *」输入框增加 `maxLength={11}`，超长输入自动截断；不影响运营商自动识别。
- 涉及文件：`frontend/src/App.jsx`（两处 phone input）。

**构建与发布**

- 重新构建：`npm install && export PATH="$PWD/tools:$PATH" && node scripts/build-combined.js`
- 新前端 bundle：`index-DgR8XVQV.js`；新安装包 `custdb.fpk`（md5 a83db5d844e9…，5.38MB）
- 已同步 GitHub 仓库 `cp4857971/custdb-crm`（main 分支）：App.jsx 源码、两侧 public 前端产物、新版 fpk、CHANGELOG.md；旧版 JS bundle 已清理，git clone 终验通过。
