// 通信行业客户资料库 - 后端服务
// 环境变量：
//   PORT            本地开发端口（默认 5001）
//   SOCKET_PATH     安装到飞牛 fnOS 后监听的 Unix Socket（统一网关转发）
//   GATEWAY_PREFIX  统一网关访问前缀（默认 /app/custdb）
//   DATA_DIR        数据保存目录（fnOS 上指向 data-share 创建的数据目录）
// 统一网关转发时携带 X-Trim-Userid，用于区分不同 NAS 用户的数据。
"use strict";

const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const XLSX = require("xlsx");

const PORT_DEFAULT = 5001;
const SOCKET_PATH = process.env.SOCKET_PATH || "";
const GATEWAY_PREFIX = (process.env.GATEWAY_PREFIX || "/app/custdb").replace(/\/+$/, "");
// 基目录：独立二进制（pkg 打包）以可执行文件所在目录为基；node server.js 运行以源码目录为基
const BASE_DIR = typeof process.pkg !== "undefined" ? path.dirname(process.execPath) : __dirname;
// 静态站点目录：fnOS 部署为 public/；独立二进制包为 web/（与二进制同目录）
const PUBLIC_DIR = fs.existsSync(path.join(BASE_DIR, "public"))
  ? path.join(BASE_DIR, "public")
  : path.join(BASE_DIR, "web");
const DEFAULT_DATA_DIR = path.join(BASE_DIR, "data");

const app = express();
app.use(express.json({ limit: "1mb" }));

// 文件上传（内存存储，供数据导入使用）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});

// ---------------- 数据存储（SQLite + 数据路径自定义） ----------------
// config.json 位于“基础数据目录”（env DATA_DIR 或默认 data/），字段：
//   dataDir —— 数据存放路径（自定义，绝对路径；默认与基础数据目录一致）
//   port    —— 额外监听的 TCP 服务端口（局域网直连 / 隧道映射用；默认 5001）
// 存储方式固定为 SQLite（Node 内置 node:sqlite，零外部依赖，适合大数据量）。
// 数据路径优先级：config.json dataDir（用户自定义）> env DATA_DIR（部署默认）> 默认 data/
function loadAppConfig() {
  const baseDir = process.env.DATA_DIR || DEFAULT_DATA_DIR;
  let cfg = {};
  try {
    const f = path.join(baseDir, "config.json");
    if (fs.existsSync(f)) cfg = JSON.parse(fs.readFileSync(f, "utf8")) || {};
  } catch (e) { /* 配置损坏时使用默认值 */ }
  if (typeof cfg !== "object" || cfg === null || Array.isArray(cfg)) cfg = {};

  let dataDir = process.env.DATA_DIR || DEFAULT_DATA_DIR;
  let dataDirSource = "env";
  if (cfg.dataDir && typeof cfg.dataDir === "string" && cfg.dataDir.trim()) {
    dataDir = cfg.dataDir.trim();
    dataDirSource = "config";
  }

  const appPort = Number(cfg.port);
  return {
    storage: "sqlite",
    dataDir,
    dataDirSource,
    appPort: Number.isInteger(appPort) && appPort >= 1 && appPort <= 65535 ? appPort : null,
    requireLogin: cfg.requireLogin !== false, // 默认开启：所有用户都需要登录验证
    cfgFile: path.join(baseDir, "config.json")
  };
}

function readAppConfig() {
  const f = path.join(process.env.DATA_DIR || DEFAULT_DATA_DIR, "config.json");
  try {
    if (fs.existsSync(f)) {
      const c = JSON.parse(fs.readFileSync(f, "utf8"));
      if (typeof c === "object" && c !== null && !Array.isArray(c)) return c;
    }
  } catch (e) { /* ignore */ }
  return {};
}

function writeAppConfig(cfg) {
  const f = path.join(process.env.DATA_DIR || DEFAULT_DATA_DIR, "config.json");
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(cfg, null, 2));
}

const APP_CFG = loadAppConfig();
const DATA_DIR = APP_CFG.dataDir;
// TCP 服务端口：优先级 env PORT（启动脚本传入）> config.json port（向导/设置页）> 默认 5001
const PORT = Number(process.env.PORT || APP_CFG.appPort || PORT_DEFAULT);
fs.mkdirSync(DATA_DIR, { recursive: true });

function userOf(req) {
  const uid = String(req.headers["x-trim-userid"] || "local").replace(/[^\w.-]/g, "");
  return uid || "local";
}

// 当前操作人标识（用于 createdBy / deletedBy）：登录账号优先（超管为 admin），否则 NAS 用户标识
function creatorOf(req) {
  const a = req.auth || {};
  return String(a.username || a.uid || userOf(req));
}

// SQLite 后端（Node 22 内置 node:sqlite，无需安装额外依赖）
let sqliteDb = null;
function sqliteGet() {
  if (!sqliteDb) {
    const { DatabaseSync } = require("node:sqlite");
    sqliteDb = new DatabaseSync(path.join(DATA_DIR, "custdb.db"));
    sqliteDb.exec(
      "CREATE TABLE IF NOT EXISTS customers (" +
      "id TEXT PRIMARY KEY, user TEXT NOT NULL, name TEXT NOT NULL, phone TEXT NOT NULL, " +
      "idAddress TEXT, installAddress TEXT, planName TEXT, planFee REAL, addonServices TEXT, " +
      "operator TEXT, remark TEXT, discount TEXT, contractStart TEXT, contractEnd TEXT, createdAt TEXT)"
    );
    // 兼容旧库：为已存在的 customers 表补充新增列（operator 运营商 / remark 备注 / discount 折扣）
    try { sqliteDb.exec("ALTER TABLE customers ADD COLUMN operator TEXT"); } catch (e) { /* 列已存在则忽略 */ }
    try { sqliteDb.exec("ALTER TABLE customers ADD COLUMN remark TEXT"); } catch (e) { /* 列已存在则忽略 */ }
    try { sqliteDb.exec("ALTER TABLE customers ADD COLUMN discount TEXT"); } catch (e) { /* 列已存在则忽略 */ }
    // v0.0.24：创建人（createdBy）归属 + 软删除回收站（deleted_customers，超级管理员可恢复）
    try { sqliteDb.exec("ALTER TABLE customers ADD COLUMN createdBy TEXT"); } catch (e) { /* 列已存在则忽略 */ }
    sqliteDb.exec(
      "CREATE TABLE IF NOT EXISTS deleted_customers (" +
      "id TEXT PRIMARY KEY, user TEXT NOT NULL, name TEXT NOT NULL, phone TEXT NOT NULL, " +
      "idAddress TEXT, installAddress TEXT, planName TEXT, planFee REAL, addonServices TEXT, " +
      "operator TEXT, remark TEXT, discount TEXT, contractStart TEXT, contractEnd TEXT, createdAt TEXT, " +
      "createdBy TEXT, deletedAt TEXT, deletedBy TEXT)"
    );
    sqliteDb.exec(
      "CREATE TABLE IF NOT EXISTS portin (" +
      "id TEXT PRIMARY KEY, user TEXT NOT NULL, phone TEXT NOT NULL, " +
      "familyAddress TEXT, planName TEXT, planFee REAL, decider TEXT, " +
      "operator TEXT, remark TEXT, discount TEXT, createdAt TEXT)"
    );
    // 兼容旧库：为已存在的 portin 表补充新增列（operator 运营商 / remark 备注 / discount 折扣）
    try { sqliteDb.exec("ALTER TABLE portin ADD COLUMN operator TEXT"); } catch (e) { /* 列已存在则忽略 */ }
    try { sqliteDb.exec("ALTER TABLE portin ADD COLUMN remark TEXT"); } catch (e) { /* 列已存在则忽略 */ }
    try { sqliteDb.exec("ALTER TABLE portin ADD COLUMN discount TEXT"); } catch (e) { /* 列已存在则忽略 */ }
    // v0.0.24：创建人（createdBy）归属 + 软删除回收站（deleted_portin，超级管理员可恢复）
    try { sqliteDb.exec("ALTER TABLE portin ADD COLUMN createdBy TEXT"); } catch (e) { /* 列已存在则忽略 */ }
    sqliteDb.exec(
      "CREATE TABLE IF NOT EXISTS deleted_portin (" +
      "id TEXT PRIMARY KEY, user TEXT NOT NULL, phone TEXT NOT NULL, " +
      "familyAddress TEXT, planName TEXT, planFee REAL, decider TEXT, " +
      "operator TEXT, remark TEXT, discount TEXT, createdAt TEXT, " +
      "createdBy TEXT, deletedAt TEXT, deletedBy TEXT)"
    );
    // 套餐业务库（plan_library）与小业务库（addon_library）——内置 + 管理员可增删
    sqliteDb.exec(
      "CREATE TABLE IF NOT EXISTS plan_library (" +
      "id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT, fee REAL, operator TEXT, builtin INTEGER DEFAULT 0)"
    );
    sqliteDb.exec(
      "CREATE TABLE IF NOT EXISTS addon_library (" +
      "id TEXT PRIMARY KEY, name TEXT NOT NULL, operator TEXT, builtin INTEGER DEFAULT 0)"
    );
    sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_customers_user ON customers(user)");
    sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_portin_user ON portin(user)");
  }
  return sqliteDb;
}

function rowToObj(r) {
  return {
    id: r.id, user: r.user, name: r.name, phone: r.phone,
    idAddress: r.idAddress || "", installAddress: r.installAddress || "",
    planName: r.planName || "", planFee: r.planFee == null ? null : r.planFee,
    addonServices: r.addonServices || "", operator: r.operator || "", remark: r.remark || "",
    discount: r.discount || "",
    contractStart: r.contractStart || "",
    contractEnd: r.contractEnd || "", createdAt: r.createdAt || "",
    createdBy: r.createdBy || ""
  };
}

function portinRowToObj(r) {
  return {
    id: r.id, user: r.user, phone: r.phone,
    familyAddress: r.familyAddress || "", planName: r.planName || "",
    planFee: r.planFee == null ? null : r.planFee,
    decider: r.decider || "", operator: r.operator || "", remark: r.remark || "",
    discount: r.discount || "",
    createdAt: r.createdAt || "",
    createdBy: r.createdBy || ""
  };
}

function readCustomersByUid(user) {
  return sqliteGet().prepare("SELECT * FROM customers WHERE user=? ORDER BY createdAt").all(user).map(rowToObj);
}

function writeCustomersByUid(user, list) {
  const db = sqliteGet();
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM customers WHERE user=?").run(user);
    const ins = db.prepare(
      "INSERT OR REPLACE INTO customers (id,user,name,phone,idAddress,installAddress,planName,planFee,addonServices,operator,remark,discount,contractStart,contractEnd,createdAt,createdBy) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
    );
    for (const c of list) {
      ins.run(c.id, user, c.name, c.phone, c.idAddress || "", c.installAddress || "", c.planName || "",
        c.planFee == null ? null : c.planFee, c.addonServices || "", c.operator || "", c.remark || "",
        c.discount || "", c.contractStart || "",
        c.contractEnd || "", c.createdAt || "", c.createdBy || "");
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

function readCustomers(req) {
  return readCustomersByUid(req.auth ? req.auth.uid : userOf(req));
}

function writeCustomers(req, list) {
  writeCustomersByUid(req.auth ? req.auth.uid : userOf(req), list);
}

// ---------------- 异网用户（策反名单） ----------------
function readPortinByUid(user) {
  return sqliteGet().prepare("SELECT * FROM portin WHERE user=? ORDER BY createdAt").all(user).map(portinRowToObj);
}

function writePortinByUid(user, list) {
  const db = sqliteGet();
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM portin WHERE user=?").run(user);
    const ins = db.prepare(
      "INSERT OR REPLACE INTO portin (id,user,phone,familyAddress,planName,planFee,decider,operator,remark,discount,createdAt,createdBy) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
    );
    for (const c of list) {
      ins.run(c.id, user, c.phone, c.familyAddress || "", c.planName || "",
        c.planFee == null ? null : c.planFee, c.decider || "", c.operator || "", c.remark || "",
        c.discount || "", c.createdAt || "", c.createdBy || "");
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

function readPortin(req) {
  return readPortinByUid(req.auth ? req.auth.uid : userOf(req));
}

function writePortin(req, list) {
  writePortinByUid(req.auth ? req.auth.uid : userOf(req), list);
}

// ---------------- 软删除（回收站） ----------------
// v0.0.24：删除的客户/异网用户进入 deleted_* 表（不再直接物理删除），
// 超级管理员可在「超级控制台 → 回收站」中恢复或彻底删除。
function softDeleteCustomer(id, uid, deleter) {
  const db = sqliteGet();
  const row = db.prepare("SELECT * FROM customers WHERE id=? AND user=?").get(id, uid);
  if (!row) return false;
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM customers WHERE id=? AND user=?").run(id, uid);
    db.prepare(
      "INSERT OR REPLACE INTO deleted_customers (id,user,name,phone,idAddress,installAddress,planName,planFee,addonServices,operator,remark,discount,contractStart,contractEnd,createdAt,createdBy,deletedAt,deletedBy) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
    ).run(row.id, row.user, row.name, row.phone, row.idAddress || "", row.installAddress || "", row.planName || "",
      row.planFee, row.addonServices || "", row.operator || "", row.remark || "", row.discount || "",
      row.contractStart || "", row.contractEnd || "", row.createdAt || "", row.createdBy || "",
      new Date().toISOString(), deleter);
    db.exec("COMMIT");
    return true;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

function softDeletePortin(id, uid, deleter) {
  const db = sqliteGet();
  const row = db.prepare("SELECT * FROM portin WHERE id=? AND user=?").get(id, uid);
  if (!row) return false;
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM portin WHERE id=? AND user=?").run(id, uid);
    db.prepare(
      "INSERT OR REPLACE INTO deleted_portin (id,user,phone,familyAddress,planName,planFee,decider,operator,remark,discount,createdAt,createdBy,deletedAt,deletedBy) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
    ).run(row.id, row.user, row.phone, row.familyAddress || "", row.planName || "",
      row.planFee, row.decider || "", row.operator || "", row.remark || "", row.discount || "",
      row.createdAt || "", row.createdBy || "", new Date().toISOString(), deleter);
    db.exec("COMMIT");
    return true;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

function deletedCustomersRows() {
  return sqliteGet().prepare("SELECT * FROM deleted_customers ORDER BY deletedAt DESC").all()
    .map((r) => Object.assign({}, r, { type: "customers" }));
}

function deletedPortinRows() {
  return sqliteGet().prepare("SELECT * FROM deleted_portin ORDER BY deletedAt DESC").all()
    .map((r) => Object.assign({}, r, { type: "portin" }));
}

function storageInfo() {
  return {
    storage: "sqlite",
    dataDir: DATA_DIR,
    dataDirSource: APP_CFG.dataDirSource,
    configFile: APP_CFG.cfgFile,
    dbFile: path.join(DATA_DIR, "custdb.db"),
    appPort: PORT,
    appPortSource: process.env.PORT ? "env" : (APP_CFG.appPort ? "config" : "default"),
    requireLogin: APP_CFG.requireLogin,
    appFileDir: process.env.TRIM_DATA_SHARE_PATHS ? String(process.env.TRIM_DATA_SHARE_PATHS).split(":")[0] : null,
    pkgVarDir: process.env.TRIM_PKGVAR || null
  };
}

// 首次使用写入示例数据（虚构演示数据，可在页面中删除）
const SEED = [
  { id: "KH-2026-001", name: "王秀英", phone: "13800001234", idAddress: "四川省泸州市合江县XX镇XX村X社", installAddress: "四川省泸州市合江县XX街道XX小区X栋X单元", planName: "家庭融合宽带套餐", planFee: 129, addonServices: "视频彩铃、家庭云盘", operator: "中国移动", remark: "老客户，宽带2026-09已到期，待续费回访", discount: "95折", contractStart: "2024-10-01", contractEnd: "2026-09-15", createdAt: "2026-09-30T00:00:00.000Z" },
  { id: "KH-2026-002", name: "李建国", phone: "13900005678", idAddress: "四川省泸州市合江县XX街道XX路X号", installAddress: "四川省泸州市合江县XX镇XX街XX号", planName: "5G畅享套餐", planFee: 99, addonServices: "腾讯视频会员", operator: "中国移动", remark: "协议10月到期，主推5G融合套餐", discount: "8折", contractStart: "2024-10-10", contractEnd: "2026-10-10", createdAt: "2026-09-30T00:00:00.000Z" },
  { id: "KH-2026-003", name: "张桂芳", phone: "13600009876", idAddress: "四川省泸州市合江县XX乡XX村X组", installAddress: "四川省泸州市合江县XX小区X栋X单元", planName: "5G融合家庭套餐", planFee: 159, addonServices: "宽带提速包、视频彩铃", operator: "中国联通", remark: "", discount: "9折", contractStart: "2024-11-01", contractEnd: "2026-11-01", createdAt: "2026-09-30T00:00:00.000Z" },
  { id: "KH-2026-004", name: "刘德明", phone: "13700004567", idAddress: "四川省泸州市合江县XX镇XX村X社", installAddress: "四川省泸州市合江县XX路XX号", planName: "手机流量畅享套餐", planFee: 59, addonServices: "亲情网、骚扰拦截", operator: "中国联通", remark: "有意向办理家庭宽带", discount: "", contractStart: "2025-01-15", contractEnd: "2027-01-15", createdAt: "2026-09-30T00:00:00.000Z" },
  { id: "KH-2026-005", name: "陈秀兰", phone: "15000001234", idAddress: "四川省泸州市合江县XX街道XX小区", installAddress: "四川省泸州市合江县XX街道XX小区X栋", planName: "宽带+手机融合套餐", planFee: 199, addonServices: "家庭云盘、视频会员", operator: "中国电信", remark: "存量电信号码，关注小业务叠加", discount: "95折", contractStart: "2025-03-01", contractEnd: "2027-03-01", createdAt: "2026-09-30T00:00:00.000Z" },
  { id: "KH-2026-006", name: "杨志强", phone: "15100007890", idAddress: "四川省泸州市合江县XX镇XX街X号", installAddress: "四川省泸州市合江县XX小区X栋X单元", planName: "5G畅享套餐（尊享版）", planFee: 139, addonServices: "视频彩铃", operator: "中国电信", remark: "", discount: "免月租", contractStart: "2025-05-20", contractEnd: "2027-05-20", createdAt: "2026-09-30T00:00:00.000Z" },
  { id: "KH-2026-007", name: "赵春花", phone: "15200004567", idAddress: "四川省泸州市合江县XX乡XX村X组", installAddress: "四川省泸州市合江县XX镇XX路XX号", planName: "学生青春卡套餐", planFee: 29, addonServices: "校园流量包", operator: "中国电信", remark: "", discount: "", contractStart: "2025-09-01", contractEnd: "2027-09-01", createdAt: "2026-09-30T00:00:00.000Z" },
  { id: "KH-2026-008", name: "孙红军", phone: "15300001234", idAddress: "四川省泸州市合江县XX街道XX路X号", installAddress: "四川省泸州市合江县XX小区X栋", planName: "家庭融合套餐（千兆版）", planFee: 169, addonServices: "千兆提速包、视频彩铃", operator: "中国联通", remark: "协议11月到期", discount: "9折", contractStart: "2025-11-11", contractEnd: "2027-11-11", createdAt: "2026-09-30T00:00:00.000Z" },
  { id: "KH-2026-009", name: "周晓梅", phone: "15500007890", idAddress: "四川省泸州市合江县XX镇XX村X社", installAddress: "四川省泸州市合江县XX街XX号", planName: "5G畅享套餐", planFee: 99, addonServices: "来电管家、家庭云盘", operator: "中国移动", remark: "", discount: "8折", contractStart: "2023-12-01", contractEnd: "2026-10-25", createdAt: "2026-09-30T00:00:00.000Z" },
  { id: "KH-2026-010", name: "吴国栋", phone: "15600004567", idAddress: "四川省泸州市合江县XX乡XX村X组", installAddress: "四川省泸州市合江县XX路XX号", planName: "宽带融合套餐", planFee: 189, addonServices: "视频会员、亲情网", operator: "中国联通", remark: "视频会员赠送已结束，可复推", discount: "95折", contractStart: "2026-01-01", contractEnd: "2028-01-01", createdAt: "2026-09-30T00:00:00.000Z" },
];

// 首次启动：为空库写入示例数据（演示用，可在页面中删除）
function seedIfEmpty() {
  const db = sqliteGet();
  const c = db.prepare("SELECT COUNT(*) AS n FROM customers WHERE user=?").get("local");
  if (!c.n) {
    const ins = db.prepare(
      "INSERT INTO customers (id,user,name,phone,idAddress,installAddress,planName,planFee,addonServices,operator,remark,discount,contractStart,contractEnd,createdAt,createdBy) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
    );
    for (const s of SEED) {
      ins.run(s.id, "local", s.name, s.phone, s.idAddress, s.installAddress, s.planName, s.planFee, s.addonServices, s.operator || "", s.remark || "", s.discount || "", s.contractStart, s.contractEnd, s.createdAt, "system");
    }
  }
}
seedIfEmpty();

// ---------------- 套餐业务库 / 小业务库（v0.0.23） ----------------
// 内置四川省内常见资费参考（家庭融合 / E家融合 / 单卡），管理员可增删自定义项
const BUILTIN_PLANS = [
  // 中国移动 —— 家庭融合
  { name: "全家享融合套餐 99元", category: "家庭融合", fee: 99, operator: "中国移动" },
  { name: "全家享融合套餐 129元", category: "家庭融合", fee: 129, operator: "中国移动" },
  { name: "全家享融合套餐 169元", category: "家庭融合", fee: 169, operator: "中国移动" },
  { name: "全家享融合套餐 199元", category: "家庭融合", fee: 199, operator: "中国移动" },
  { name: "全家享融合套餐 229元", category: "家庭融合", fee: 229, operator: "中国移动" },
  // 中国移动 —— 单卡
  { name: "飞享套餐 8元", category: "单卡", fee: 8, operator: "中国移动" },
  { name: "飞享套餐 18元", category: "单卡", fee: 18, operator: "中国移动" },
  { name: "飞享套餐 38元", category: "单卡", fee: 38, operator: "中国移动" },
  { name: "全球通套餐 88元", category: "单卡", fee: 88, operator: "中国移动" },
  { name: "全球通套餐 128元", category: "单卡", fee: 128, operator: "中国移动" },
  { name: "5G智享套餐 158元", category: "单卡", fee: 158, operator: "中国移动" },
  { name: "5G智享套餐 238元", category: "单卡", fee: 238, operator: "中国移动" },
  // 中国联通 —— 家庭融合
  { name: "沃家融合套餐 99元", category: "家庭融合", fee: 99, operator: "中国联通" },
  { name: "沃家融合套餐 129元", category: "家庭融合", fee: 129, operator: "中国联通" },
  { name: "沃家融合套餐 169元", category: "家庭融合", fee: 169, operator: "中国联通" },
  { name: "冰激凌融合套餐 199元", category: "家庭融合", fee: 199, operator: "中国联通" },
  // 中国联通 —— 单卡
  { name: "沃派套餐 29元", category: "单卡", fee: 29, operator: "中国联通" },
  { name: "冰激凌套餐 99元", category: "单卡", fee: 99, operator: "中国联通" },
  { name: "冰激凌套餐 129元", category: "单卡", fee: 129, operator: "中国联通" },
  { name: "5G冰激凌套餐 159元", category: "单卡", fee: 159, operator: "中国联通" },
  { name: "5G冰激凌套餐 239元", category: "单卡", fee: 239, operator: "中国联通" },
  // 中国电信 —— E家融合
  { name: "E家融合套餐 99元", category: "E家融合", fee: 99, operator: "中国电信" },
  { name: "E家融合套餐 129元", category: "E家融合", fee: 129, operator: "中国电信" },
  { name: "E家融合套餐 169元", category: "E家融合", fee: 169, operator: "中国电信" },
  { name: "E家融合套餐 199元", category: "E家融合", fee: 199, operator: "中国电信" },
  { name: "E家融合套餐 239元", category: "E家融合", fee: 239, operator: "中国电信" },
  // 中国电信 —— 家庭融合 / 单卡
  { name: "全家福融合套餐 129元", category: "家庭融合", fee: 129, operator: "中国电信" },
  { name: "全家福融合套餐 169元", category: "家庭融合", fee: 169, operator: "中国电信" },
  { name: "天翼畅享套餐 59元", category: "单卡", fee: 59, operator: "中国电信" },
  { name: "5G畅享套餐 129元", category: "单卡", fee: 129, operator: "中国电信" },
  { name: "5G畅享套餐 169元", category: "单卡", fee: 169, operator: "中国电信" },
  { name: "5G畅享套餐 199元", category: "单卡", fee: 199, operator: "中国电信" },
  { name: "5G畅享套餐 239元", category: "单卡", fee: 239, operator: "中国电信" },
];
const BUILTIN_ADDONS = [
  // 中国移动
  { name: "和彩云（云盘）", operator: "中国移动" },
  { name: "移动看家（云监控）", operator: "中国移动" },
  { name: "和路由（路由器）", operator: "中国移动" },
  { name: "视频彩铃", operator: "中国移动" },
  { name: "咪咕视频会员", operator: "中国移动" },
  { name: "和家亲智能家居", operator: "中国移动" },
  { name: "移动云电脑", operator: "中国移动" },
  // 中国联通
  { name: "沃云盘（云盘）", operator: "中国联通" },
  { name: "沃家神眼（云监控）", operator: "中国联通" },
  { name: "联通路由器（路由器）", operator: "中国联通" },
  { name: "沃视频会员", operator: "中国联通" },
  { name: "视频彩铃", operator: "中国联通" },
  { name: "智慧沃家", operator: "中国联通" },
  { name: "联通云电脑", operator: "中国联通" },
  // 中国电信
  { name: "天翼云盘（云盘）", operator: "中国电信" },
  { name: "天翼看家（云监控）", operator: "中国电信" },
  { name: "天翼路由器（路由器）", operator: "中国电信" },
  { name: "天翼云电脑", operator: "中国电信" },
  { name: "视频彩铃", operator: "中国电信" },
  { name: "天翼超高清", operator: "中国电信" },
  { name: "天翼云会议", operator: "中国电信" },
];

// 幂等预置：已存在同名（同运营商）内置项则跳过
function seedLibrary() {
  const db = sqliteGet();
  db.exec("BEGIN");
  try {
    const insP = db.prepare("INSERT OR IGNORE INTO plan_library (id,name,category,fee,operator,builtin) VALUES (?,?,?,?,?,1)");
    for (const p of BUILTIN_PLANS) {
      const id = "PL-" + crypto.createHash("sha256").update(p.operator + "|" + p.name).digest("hex").slice(0, 12).toUpperCase();
      insP.run(id, p.name, p.category, p.fee, p.operator);
    }
    const insA = db.prepare("INSERT OR IGNORE INTO addon_library (id,name,operator,builtin) VALUES (?,?,?,1)");
    for (const a of BUILTIN_ADDONS) {
      const id = "AD-" + crypto.createHash("sha256").update(a.operator + "|" + a.name).digest("hex").slice(0, 12).toUpperCase();
      insA.run(id, a.name, a.operator);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
seedLibrary();

// 手机号段识别运营商（中国大陆 11 位手机号，粗略号段规则，可手动修改）
function detectOperator(phone) {
  const s = String(phone || "").replace(/\D/g, "");
  if (!/^1\d{10}$/.test(s)) return null;
  const p = s.slice(0, 3);
  // 中国移动：134 135 136 137 138 139 147 148 150 151 152 157 158 159 172 178 182 183 184 187 188 195 197 198
  if (/^(134|135|136|137|138|139|147|148|150|151|152|157|158|159|172|178|182|183|184|187|188|195|197|198)$/.test(p)) return "中国移动";
  // 中国联通：130 131 132 145 146 155 156 166 167 171 175 176 185 186 196
  if (/^(130|131|132|145|146|155|156|166|167|171|175|176|185|186|196)$/.test(p)) return "中国联通";
  // 中国电信：133 149 153 173 174 177 180 181 189 190 191 193 199
  if (/^(133|149|153|173|174|177|180|181|189|190|191|193|199)$/.test(p)) return "中国电信";
  return null;
}

// ---------------- 管理员 ----------------
// 管理员名单存放在 config.json 的 admins 字段；名单为空时，第一个使用应用的用户自动成为管理员
function getAdmins() {
  const c = readAppConfig();
  return Array.isArray(c.admins) ? c.admins.filter((a) => typeof a === "string" && a.trim() !== "") : [];
}

function setAdmins(list) {
  const c = readAppConfig();
  c.admins = Array.isArray(list) ? list.filter((a) => typeof a === "string" && a.trim() !== "") : [];
  writeAppConfig(c);
}

// ---------------- 导出授权码（v0.0.24） ----------------
// 临时用户导出数据需要管理员生成的随机授权码（单次有效、默认 30 分钟过期）
function readExportCodes() {
  const c = readAppConfig();
  return Array.isArray(c.exportCodes) ? c.exportCodes : [];
}

function writeExportCodes(list) {
  const c = readAppConfig();
  c.exportCodes = list;
  writeAppConfig(c);
}

function activeExportCodes() {
  const now = Date.now();
  const list = readExportCodes();
  const active = list.filter((x) => !x.used && new Date(x.expireAt).getTime() > now);
  const expired = list.filter((x) => x.used || new Date(x.expireAt).getTime() <= now);
  if (expired.length) writeExportCodes(active); // 顺手清理过期/已用码
  return active;
}

// 管理员判断：名单为空时首个使用者自动成为管理员（仅兼容模式 requireLogin=false 时）。
// 严格登录模式（requireLogin=true）下不自动任命，管理员只能由超管在用户管理中手动添加。
function isAdminUser(uid, autoPromote) {
  const admins = getAdmins();
  if (admins.length === 0) {
    if (autoPromote === undefined) autoPromote = APP_CFG.requireLogin === false;
    if (!autoPromote) return false;
    setAdmins([uid]); // 首个使用者自动成为管理员
    return true;
  }
  return admins.includes(uid);
}

// 管理员校验：通过返回当前用户 uid，未通过写 403 并返回 null
// 通过条件：超管 Token 身份，或该 NAS 用户已加入管理员名单
function requireAdmin(req, res) {
  const a = req.auth || { uid: userOf(req), isSuper: false };
  // 操作员（role=operator）不拥有管理权限：即使绑定管理员名单内的 uid 也被拒绝
  if (!a.isSuper && (a.isOperator || !isAdminUser(a.uid))) {
    res.status(403).json({ error: "仅管理员可执行此操作" });
    return null;
  }
  return a.uid;
}

// 超级管理员校验（仅内置超管 Token 身份）
function requireSuper(req, res) {
  const a = req.auth || {};
  if (!a.isSuper) {
    res.status(403).json({ error: "仅超级管理员可执行此操作" });
    return null;
  }
  return a.username;
}

// v0.0.27：主页全库视图身份判断——超级管理员 / 管理员角色登录用户（操作员除外）
function adminLike(req) {
  const a = req.auth || {};
  return !!(a.isSuper || (a.isUser && !a.isOperator));
}

function summarizeUid(uid, arr) {
  const all = (arr || []).map(decorate);
  const count = (s) => all.filter((c) => c.status === s).length;
  return {
    uid,
    total: all.length,
    expired: count("已到期"),
    due30: count("30天内到期"),
    due60: count("60天内到期"),
    normal: count("正常"),
    unset: count("未设置")
  };
}

// 全部用户的客户量统计（管理员用）
function listUsersSummary() {
  const db = sqliteGet();
  const users = db.prepare("SELECT DISTINCT user FROM customers").all().map((r) => r.user);
  return users.map((u) => summarizeUid(u, db.prepare("SELECT * FROM customers WHERE user=?").all(u).map(rowToObj)));
}

// 全部用户的客户数据合并（管理员全库统计用）
function readAllCustomers() {
  return sqliteGet().prepare("SELECT * FROM customers ORDER BY createdAt").all().map(rowToObj);
}

// 全部用户的异网用户合并（管理员全库导出用）
function readAllPortin() {
  return sqliteGet().prepare("SELECT * FROM portin ORDER BY createdAt").all().map(portinRowToObj);
}

// ---------------- 到期提醒计算 ----------------
function dayDiff(endStr) {
  if (!endStr) return null;
  const end = new Date(endStr + "T00:00:00");
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((end.getTime() - now.getTime()) / 86400000);
}

function statusOf(days) {
  if (days === null) return "未设置";
  if (days < 0) return "已到期";
  if (days <= 30) return "30天内到期";
  if (days <= 60) return "60天内到期";
  return "正常";
}

function decorate(c) {
  const days = dayDiff(c.contractEnd);
  return Object.assign({}, c, { daysLeft: days, status: statusOf(days) });
}

// ---------------- 临时用户数据脱敏（v0.0.24） ----------------
// 临时用户可查看数据，但敏感字段打码：
//   身份证地址后 9 个字符 → ****；装机地址后 9 个字符 → ****；联系电话尾数（后 4 位）→ ****
function maskTail(v, tail) {
  const s = String(v == null ? "" : v);
  if (!s) return "";
  return s.length > tail ? s.slice(0, s.length - tail) + "****" : "****";
}

function maskTempCustomer(c) {
  return Object.assign({}, c, {
    idAddress: maskTail(c.idAddress, 9),
    installAddress: maskTail(c.installAddress, 9),
    phone: maskTail(c.phone, 4)
  });
}

function maskTempPortin(c) {
  return Object.assign({}, c, { phone: maskTail(c.phone, 4) });
}

function isTempUser(req) {
  return !!(req.auth && req.auth.isTemp);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
