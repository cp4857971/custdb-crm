# 通信客户资料库 v0.0.35 更新内容（2026-10-04）

## 本轮需求

**删除该段文字**：主页底部「存储：SQLite 数据库 · 目录：… · 数据保存在 NAS 数据目录（按 NAS 用户隔离），电脑与手机访问同一份数据；内置示例数据为虚构演示，可在页面中删除。含身份证住址等敏感信息，请妥善保管。」

## 实现说明

- 该段文字由主页底部 `<footer class="footer">` 渲染（bundle 内组件），屏幕显示与打印预览均会出现。
- 在 `public/index.html` 注入一行样式：`footer.footer{display:none!important}`，整段说明文字不再显示（屏幕与打印均不出现）。
- 不动业务打包产物，React 重渲染不受影响（!important 规则恒定生效）。

## 验证

- 本地服务实测：`index.html` 含隐藏样式（HTTP 200，页面正常加载）。
- fpk 解包回读：`server/public/index.html` 含隐藏样式。
- 两平台 zip 完整性校验通过（unzip -t）。

## 发布包

| 文件 | MD5 |
| --- | --- |
| custdb.fpk（fnOS 应用包） | dfdcdf20a6ff3c8af726e4ee94de5780 |
| custdb-server-linux-x64.zip | 687eb068161563d82668395833acee42 |
| custdb-server-win-x64.zip | 67454d66f3865c98b15e402fbdc4a749 |

## 升级方式

- **fnOS**：应用中心 → 手动安装 `custdb.fpk`（覆盖升级，数据保留）。
- **Windows / Linux 服务端**：解压新 zip 替换旧目录（`web/` 已含最新前端；`custdb-data/` 数据目录保留即不丢数据）。
- 安卓 APP / Electron 客户端无需更新（加载服务端页面）。
