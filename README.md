# 通信客户资料库（CustDb）

> 通信行业客户档案 / 套餐管理 / 协议到期提醒 ｜ fnOS Native 应用 + Docker + 安卓 APP + Windows/Linux 桌面版
> 开发者/发布者：**cp**（manifest、LICENSE 版权人同步）；版本 v0.0.26

---

## 一、功能概览

| 功能 | 说明 |
| --- | --- |
| 客户档案 | 姓名、联系电话、身份证住址、装机地址；增删改查、搜索、筛选、导入导出（CSV/Excel/JSON/TXT） |
| 套餐管理 | 套餐名称/费用、折扣、小业务、运营商；内置套餐业务库（33 套餐 + 21 小业务），可自定义增删 |
| 协议到期提醒 | 已到期/30 天内/60 天内/正常 四档，红橙黄绿标色；统计看板 |
| 电话拨打 | 手机端列表/详情一键拨打 |
| **权限体系** | 超级管理员 / 管理员 / 临时访问用户 三类账号（见下表） |
| **超级控制台（v0.0.24）** | 超管全库视图 + 回收站恢复/彻底删除 + 按创建人筛选 |
| **管理控制台（v0.0.25）** | 管理员全库视图 + 打印 + 删除自建数据 |
| **v0.0.26 修复** | 编辑客户/异网用户时，「协议到期日期」留空（选填字段）不再误报格式错误，可正常保存；接口未捕获异常（磁盘满 / 数据库只读 / 锁定）返回 JSON 具体原因，不再只显示“请求失败” |
| 开发者/发布者（v0.0.22+） | 由 doubao 改为 **cp** |

---

## 二、权限体系（v0.0.24 起）

| 角色 | 数据可见范围 | 操作权限 | 脱敏/导出 |
| --- | --- | --- | --- |
| 超级管理员 | 所有管理员添加的数据（超级控制台，含归属用户/创建人列，可按创建人筛选） | 可删除任意数据；可**恢复 / 彻底删除**回收站数据 | 完整可见，可直接导出 |
| 管理员 | 所有数据（管理控制台，含归属用户列） | 可打印名单；仅可删除**自建数据**（他人数据只读，删除他人 403） | 完整可见；可生成**单次有效随机授权码**供临时用户导出 |
| 临时访问用户 | 绑定用户的正式客户 / 异网用户 | 可导入完整数据；**不可删除**（403） | **脱敏查看**：身份证住址后 9 位、装机地址后 9 位为 `*********`，联系号码尾数 4 位为 `****`；导出需管理员生成的随机授权码 |

---

## 三、接口速览（前缀 /app/custdb）

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| POST | /api/auth/login | 全部 | 登录（admin / 正式用户 / 临时用户） |
| GET | /api/customers · /api/portin | 登录 | 当前用户数据 |
| POST/PUT/DELETE | /api/customers/:id 等 | 登录 | 正式客户增删改（临时用户禁删 403） |
| GET | /admin/all-customers · /admin/all-portin · /admin/all-facets | 管理员 | 全部用户数据（含归属用户） |
| DELETE | /admin/all-customers/:id · /admin/all-portin/:id | 管理员 | 删除自建数据（非自建 403，软删除进回收站） |
| POST | /admin/export-codes | 管理员 | 生成单次有效随机授权导出码 |
| GET | /export?code= | 临时用户 | 凭授权码导出完整数据 |
| GET | /super/customers · /super/portin · /super/facets · /super/deleted | 超级管理员 | 全库视图 + 回收站 |
| POST | /super/customers/:id/restore · /super/portin/:id/restore | 超级管理员 | 恢复回收站数据 |
| POST | /super/customers/:id/purge · /super/portin/:id/purge | 超级管理员 | 彻底删除回收站数据 |

---

## 四、安卓 APP / PWA

- 手机浏览器访问系统后，可「添加到主屏幕」生成桌面图标（PWA）；也可安装独立 APK（`mobile/CustDbApp` Android Studio 工程，WebView 壳，零第三方依赖）。
- APP 内可设置服务器地址，随时切换/重连；与服务端共用同一套账号与数据。

## 五、Windows / Linux 桌面版（EXE，v0.0.23，v0.0.26 已重建更新）

- **服务端**：单文件二进制（Windows x64 / Linux x64，Node 22 内置 SQLite，零依赖）；数据存二进制旁 `custdb-data/`；静态页从二进制旁 `web/` 读取。
- **客户端**：桌面启动器（win / linux），双击即可打开系统页面。
- 与 fnOS / Docker / 安卓 APP **互通互联**：同一份数据、同一套界面接口。

## 六、安装 / 部署

- **fnOS**：应用中心 → 手动安装 `custdb.fpk`（升级直接覆盖，数据保留）。
- **Docker**：`backend/Dockerfile` + `docker-compose.yml`（源码部署，数据卷 `./custdb-data:/data`）。
- **Windows / Linux 服务端**：解压 zip → 运行二进制 → 访问 `http://本机IP:5001/app/custdb`。
- **安卓**：安装 `CustDbApp-app-debug.apk`，首次启动填写服务器地址。
- 默认超管 **admin / admin**，登录后请立即修改。

---

## 七、目录结构（源码仓库）

```
backend/
  server.js          # 服务端（Express + node:sqlite，单文件）
  public/            # 前端（index.html / super.html / export-center.html + assets）
  Dockerfile         # Docker 部署
  docker-compose.yml
mobile/CustDbApp/    # 安卓 APK 工程（WebView 壳）
releases/            # 分卷发布物（GitHub 网页单文件限 25MB，大包拆 .z01 + .zip）
docs/                # 更新内容与发布物清单（docs/v0.0.26-更新内容.md）
CHANGELOG.md
README.md
```

> 大文件分卷说明：GitHub 网页直接上传单文件上限 25MB，`releases/` 目录将大包拆为 `.z01` + `.zip` 分卷；合并方法：全部下载到同一目录后解压任意 `.zip`（或按 7-Zip「合并 + 解压」）。分卷内容与完整 zip 一致。

---

## 八、版本记录

完整版本更迭见 [CHANGELOG.md](CHANGELOG.md)；最新：v0.0.26（修复编辑空协议日期误报 + 错误详情回显）。
