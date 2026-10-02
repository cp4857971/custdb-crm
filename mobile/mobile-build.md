# 通信客户资料库 · 安卓手机 APP（CustDbApp）

纯 WebView 壳：手机打开后直连 NAS 上的「通信客户资料库」服务端，电脑与手机访问**同一台 NAS、同一份数据**（数据仍在 NAS 上，不在手机）。

## 已构建产物

`CustDbApp/app/build/outputs/apk/debug/app-debug.apk` —— **可直接安装**（Debug 签名），
发送到手机（微信/QQ/网盘/数据线）点击安装即可。首次打开会要求填写服务器地址。

## 服务器地址怎么填

- 局域网：`http://NAS内网IP:5001/app/custdb`（需先在应用「设置 → 服务端口」确认端口，默认 5001）
- 飞牛网关：`http://NAS内网IP:5666/app/custdb`（无需端口设置）
- 公网（FN Connect 或 frpc/NPC/cloudflared/节点小宝 隧道）：`https://你的域名/app/custdb`
- 地址必须以 `/app/custdb` 结尾；已填过可随时改：应用右上角菜单 → 修改服务器地址

## 本机安装工具链（本机已装好并成功构建，记录路径）

| 组件 | 路径 | 说明 |
|---|---|---|
| JDK 17 | `/opt/jdk-17` | AGP 8.x 必需（`JAVA_HOME=/opt/jdk-17`） |
| Android SDK | `/opt/android-sdk` | platform-tools / platforms;android-34 / build-tools;34.0.0 |
| Gradle 8.6 | `/opt/gradle/gradle-8.6` | 或工程内 `./gradlew`（wrapper 已生成） |

本机构建命令：
```bash
cd mobile/CustDbApp
export JAVA_HOME=/opt/jdk-17
/opt/gradle/gradle-8.6/bin/gradle assembleDebug --no-daemon
# 产物：app/build/outputs/apk/debug/app-debug.apk
```

## 在你自己电脑上构建（任选一种）

### 方式 A：Android Studio（推荐）
1. 安装 Android Studio（自带 JDK/SDK/Gradle）；
2. 打开本目录 `CustDbApp`，等待 Gradle 同步；
3. Build → Build App Bundle(s)/APK(s) → Build APK(s)；
4. 产物在 `app/build/outputs/apk/debug/`。

### 方式 B：命令行（已装 JDK 17 + Android SDK）
```bash
cd CustDbApp
./gradlew assembleDebug          # wrapper 自动下载 Gradle 8.6
# 需在 local.properties 写 sdk.dir=你的Android SDK路径
```

## 工程结构

```
CustDbApp/
├── settings.gradle / build.gradle / gradle.properties
├── gradlew + gradle/wrapper/       # Gradle Wrapper 8.6
├── local.properties                # sdk.dir（本机已配好）
└── app/
    ├── build.gradle                # 无任何第三方依赖（纯系统 API）
    ├── proguard-rules.pro
    └── src/main/
        ├── AndroidManifest.xml     # INTERNET 权限 + 明文 http 允许
        ├── java/com/custdb/app/MainActivity.java  # WebView 壳 + 服务器地址设置 + 返回键
        └── res/
            ├── drawable/ic_launcher.png   # 应用图标（与 fnOS 包同款）
            └── values/strings.xml, themes.xml
```

## 常见问题

- **无法连接服务器**：检查手机与 NAS 是否同一局域网；地址是否以 `/app/custdb` 结尾；NAS 防火墙是否放行 5001（走 5666 网关则无需）。
- **改服务器地址**：应用右上角 ⋮ 菜单 → 修改服务器地址（首次启动也会自动弹出）。
- **登录验证**：应用默认开启「所有用户需登录」，填好地址后先登录（admin/admin，登录后建议改密码）再使用。
- 想生成正式安装包（Release）：Android Studio → Build → Generate Signed Bundle/APK，按向导创建签名后构建，产物可上架或长期使用。
