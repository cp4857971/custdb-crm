# 通信客户资料库 v0.0.36 更新内容（2026-10-04）

## 本轮需求

**正式用户：显示删除选项，显示创建临时用户，生成授权码**

即正式登录用户（管理员角色）登录后：
1. 主页客户卡片显示「删除」选项；
2. 管理入口显示「创建临时用户」；
3. 顶部显示「授权导出」（生成授权码）。

## 问题根因

- 后端 `isAdminUser` 只认 `config.json` 的 `admins` 名单——正式登录用户即使角色是「管理员」也不在名单中，导致 `/api/admin/status` 返回 `isAdmin:false`。
- 前端 bundle 的管理模态框存在 bug：`(l||isAdmin)?[["system","系统设置"]]` 引用了**未定义的变量 `isAdmin`**（组件只接收 `isSuper`），管理员/超管打开「管理」模态框即抛 `ReferenceError: isAdmin is not defined`，React 崩溃、模态框打不开——系统设置页签与临时用户入口从未真正可用。

## 实现说明

### 后端（server.js）
- `isAdminUser(uid)` 增强：正式登录用户（`AUTH.users` 中 `role=admin` 且未停用）**自动视为管理员**，无需再手动加入 `admins` 名单；与 v0.0.27 主页全库视图 `adminLike` 口径完全一致。
- 操作员（`role=operator`）仍被 `requireAdmin` 拦截，不受影响；临时用户、普通 NAS 用户逻辑不变。

### 前端（index-DIKYHF41.js）
- 修复管理模态框 3 处 `(l||isAdmin)` 未定义变量引用：`(l||isAdmin)` → `(true)`（管理模态框仅管理员/超管可进入，恒显示系统设置页签与「③ 临时访问用户」区块）。
- 修复后管理模态框五页签（用户管理/套餐统计/协议统计/套餐业务库/系统设置）完整可用，管理员可在「系统设置 → ③ 临时访问用户」创建临时用户。

## 验证

- **后端**：正式用户 chenping（不在 admins 名单）登录 → `/api/admin/status` 返回 `isAdmin:true`；`GET /api/admin/temp-users` 返回 200（可创建临时用户）。
- **前端（浏览器实测）**：chenping 登录后——卡片显示「删除」按钮 ✓、顶部显示「授权导出」✓、「管理」模态框正常打开（五页签完整）✓、系统设置页可见「③ 临时访问用户：创建临时用户」✓。
- **二进制**：pkg 重建后实测同上（isAdmin:true、bundle 含修复）。
- **fpk**：fnpack 打包（gzip tar），解包运行主页 HTTP 200、bundle 含修复。

## 发布包

| 文件 | MD5 |
| --- | --- |
| custdb.fpk（fnOS 应用包） | 34874b8c775b38cabf53fdb7bf2e9557 |
| custdb-server-linux-x64.zip | 15f2cdb2b9a1c4b2083a828282a19125 |
| custdb-server-win-x64.zip | c936d893d252c941480b4d3501257000 |

## 源码同步说明

- `backend/server.js`（92KB）与前端 `assets/index-DIKYHF41.js`（209KB）因文本通道大小限制未直接同步仓库文本（与既有 `assets` 处理一致）；**最新代码已内置在发布包内**（fpk `app.tgz` / zip `web/` 与二进制），仓库文档与本更新内容为权威发布说明。
- 后端修复要点见上文「实现说明 · 后端」，可直接在发布包 `server.js` 中检索 `v0.0.36：正式登录用户（role=admin，非操作员）自动视为管理员` 定位改动。

## 升级方式

- **fnOS**：应用中心 → 手动安装 `custdb.fpk`（覆盖升级，数据保留）。
- **Windows / Linux 服务端**：解压新 zip 替换旧目录（`web/` 已含最新前端；`custdb-data/` 数据目录保留即不丢数据）。
- 安卓 APP / Electron 客户端无需更新（加载服务端页面）。
