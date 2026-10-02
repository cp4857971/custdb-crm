#!/usr/bin/env node
// 通信客户资料库 · 桌面客户端（启动器）
// 双击 / 运行本程序 → 打开默认浏览器访问服务端（客户端自身不存数据，数据都在服务端）
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const exeDir = process.pkg ? path.dirname(process.execPath) : __dirname;
const cfgPath = path.join(exeDir, "client-config.json");
let cfg = { server: "http://127.0.0.1:5001/app/custdb" };
try {
  const parsed = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  if (parsed && parsed.server) cfg.server = parsed.server;
} catch (e) { /* 无配置文件则使用默认 */ }

console.log("通信客户资料库 客户端 v0.0.23（Windows/Linux 桌面）");
console.log("服务端地址:", cfg.server);
console.log("修改地址：编辑本文件旁的 client-config.json 后重新运行。");
console.log("正在打开浏览器…");

let cmd, args;
if (process.platform === "win32") { cmd = "cmd"; args = ["/c", "start", "", cfg.server]; }
else if (process.platform === "darwin") { cmd = "open"; args = [cfg.server]; }
else { cmd = "xdg-open"; args = [cfg.server]; }
try {
  spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
} catch (e) {
  console.error("无法自动打开浏览器，请手动访问：", cfg.server);
}
