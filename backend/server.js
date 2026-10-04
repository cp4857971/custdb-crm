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
const BASE_DIR = typeof process.pkg !== "undefined" ? path.dirname(process.execPath) : __dirname;
const PUBLIC_DIR = fs.existsSync(path.join(BASE_DIR, "public"))
  ? path.join(BASE_DIR, "public")
  : path.join(BASE_DIR, "web");
const DEFAULT_DATA_DIR = path.join(BASE_DIR, "data");

const app = express();
app.use(express.json({ limit: "1mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});

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
    requireLogin: cfg.requireLogin !== false,
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
const PORT = Number(process.env.PORT || APP_CFG.appPort || PORT_DEFAULT);
fs.mkdirSync(DATA_DIR, { recursive: true });

function userOf(req) {
  const uid = String(req.headers["x-trim-userid"] || "local").replace(/[^\w.-]/g, "");
  return uid || "local";
}

function creatorOf(req) {
  const a = req.auth || {};
  return String(a.username || a.uid || userOf(req));
}

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
    try { sqliteDb.exec("ALTER TABLE customers ADD COLUMN operator TEXT"); } catch (e) { /* 列已存在则忽略 */ }
    try { sqliteDb.exec("ALTER TABLE customers ADD COLUMN remark TEXT"); } catch (e) { /* 列已存在则忽略 */ }
    try { sqliteDb.exec("ALTER TABLE customers ADD COLUMN discount TEXT"); } catch (e) { /* 列已存在则忽略 */ }
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
    try { sqliteDb.exec("ALTER TABLE portin ADD COLUMN operator TEXT"); } catch (e) { /* 列已存在则忽略 */ }
    try { sqliteDb.exec("ALTER TABLE portin ADD COLUMN remark TEXT"); } catch (e) { /* 列已存在则忽略 */ }
    try { sqliteDb.exec("ALTER TABLE portin ADD COLUMN discount TEXT"); } catch (e) { /* 列已存在则忽略 */ }
    try { sqliteDb.exec("ALTER TABLE portin ADD COLUMN createdBy TEXT"); } catch (e) { /* 列已存在则忽略 */ }
    sqliteDb.exec(
      "CREATE TABLE IF NOT EXISTS deleted_portin (" +
      "id TEXT PRIMARY KEY, user TEXT NOT NULL, phone TEXT NOT NULL, " +
      "familyAddress TEXT, planName TEXT, planFee REAL, decider TEXT, " +
      "operator TEXT, remark TEXT, discount TEXT, createdAt TEXT, " +
      "createdBy TEXT, deletedAt TEXT, deletedBy TEXT)"
    );
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

const BUILTIN_PLANS = [
  { name: "全家享融合套餐 99元", category: "家庭融合", fee: 99, operator: "中国移动" },
  { name: "全家享融合套餐 129元", category: "家庭融合", fee: 129, operator: "中国移动" },
  { name: "全家享融合套餐 169元", category: "家庭融合", fee: 169, operator: "中国移动" },
  { name: "全家享融合套餐 199元", category: "家庭融合", fee: 199, operator: "中国移动" },
  { name: "全家享融合套餐 229元", category: "家庭融合", fee: 229, operator: "中国移动" },
  { name: "飞享套餐 8元", category: "单卡", fee: 8, operator: "中国移动" },
  { name: "飞享套餐 18元", category: "单卡", fee: 18, operator: "中国移动" },
  { name: "飞享套餐 38元", category: "单卡", fee: 38, operator: "中国移动" },
  { name: "全球通套餐 88元", category: "单卡", fee: 88, operator: "中国移动" },
  { name: "全球通套餐 128元", category: "单卡", fee: 128, operator: "中国移动" },
  { name: "5G智享套餐 158元", category: "单卡", fee: 158, operator: "中国移动" },
  { name: "5G智享套餐 238元", category: "单卡", fee: 238, operator: "中国移动" },
  { name: "沃家融合套餐 99元", category: "家庭融合", fee: 99, operator: "中国联通" },
  { name: "沃家融合套餐 129元", category: "家庭融合", fee: 129, operator: "中国联通" },
  { name: "沃家融合套餐 169元", category: "家庭融合", fee: 169, operator: "中国联通" },
  { name: "冰激凌融合套餐 199元", category: "家庭融合", fee: 199, operator: "中国联通" },
  { name: "沃派套餐 29元", category: "单卡", fee: 29, operator: "中国联通" },
  { name: "冰激凌套餐 99元", category: "单卡", fee: 99, operator: "中国联通" },
  { name: "冰激凌套餐 129元", category: "单卡", fee: 129, operator: "中国联通" },
  { name: "5G冰激凌套餐 159元", category: "单卡", fee: 159, operator: "中国联通" },
  { name: "5G冰激凌套餐 239元", category: "单卡", fee: 239, operator: "中国联通" },
  { name: "E家融合套餐 99元", category: "E家融合", fee: 99, operator: "中国电信" },
  { name: "E家融合套餐 129元", category: "E家融合", fee: 129, operator: "中国电信" },
  { name: "E家融合套餐 169元", category: "E家融合", fee: 169, operator: "中国电信" },
  { name: "E家融合套餐 199元", category: "E家融合", fee: 199, operator: "中国电信" },
  { name: "E家融合套餐 239元", category: "E家融合", fee: 239, operator: "中国电信" },
  { name: "全家福融合套餐 129元", category: "家庭融合", fee: 129, operator: "中国电信" },
  { name: "全家福融合套餐 169元", category: "家庭融合", fee: 169, operator: "中国电信" },
  { name: "天翼畅享套餐 59元", category: "单卡", fee: 59, operator: "中国电信" },
  { name: "5G畅享套餐 129元", category: "单卡", fee: 129, operator: "中国电信" },
  { name: "5G畅享套餐 169元", category: "单卡", fee: 169, operator: "中国电信" },
  { name: "5G畅享套餐 199元", category: "单卡", fee: 199, operator: "中国电信" },
  { name: "5G畅享套餐 239元", category: "单卡", fee: 239, operator: "中国电信" },
];
const BUILTIN_ADDONS = [
  { name: "和彩云（云盘）", operator: "中国移动" },
  { name: "移动看家（云监控）", operator: "中国移动" },
  { name: "和路由（路由器）", operator: "中国移动" },
  { name: "视频彩铃", operator: "中国移动" },
  { name: "咪咕视频会员", operator: "中国移动" },
  { name: "和家亲智能家居", operator: "中国移动" },
  { name: "移动云电脑", operator: "中国移动" },
  { name: "沃云盘（云盘）", operator: "中国联通" },
  { name: "沃家神眼（云监控）", operator: "中国联通" },
  { name: "联通路由器（路由器）", operator: "中国联通" },
  { name: "沃视频会员", operator: "中国联通" },
  { name: "视频彩铃", operator: "中国联通" },
  { name: "智慧沃家", operator: "中国联通" },
  { name: "联通云电脑", operator: "中国联通" },
  { name: "天翼云盘（云盘）", operator: "中国电信" },
  { name: "天翼看家（云监控）", operator: "中国电信" },
  { name: "天翼路由器（路由器）", operator: "中国电信" },
  { name: "天翼云电脑", operator: "中国电信" },
  { name: "视频彩铃", operator: "中国电信" },
  { name: "天翼超高清", operator: "中国电信" },
  { name: "天翼云会议", operator: "中国电信" },
];

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

function detectOperator(phone) {
  const s = String(phone || "").replace(/\D/g, "");
  if (!/^1\d{10}$/.test(s)) return null;
  const p = s.slice(0, 3);
  if (/^(134|135|136|137|138|139|147|148|150|151|152|157|158|159|172|178|182|183|184|187|188|195|197|198)$/.test(p)) return "中国移动";
  if (/^(130|131|132|145|146|155|156|166|167|171|175|176|185|186|196)$/.test(p)) return "中国联通";
  if (/^(133|149|153|173|174|177|180|181|189|190|191|193|199)$/.test(p)) return "中国电信";
  return null;
}

function getAdmins() {
  const c = readAppConfig();
  return Array.isArray(c.admins) ? c.admins.filter((a) => typeof a === "string" && a.trim() !== "") : [];
}

function setAdmins(list) {
  const c = readAppConfig();
  c.admins = Array.isArray(list) ? list.filter((a) => typeof a === "string" && a.trim() !== "") : [];
  writeAppConfig(c);
}

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
  if (expired.length) writeExportCodes(active);
  return active;
}

function isAdminUser(uid, autoPromote) {
  const admins = getAdmins();
  if (admins.length === 0) {
    if (autoPromote === undefined) autoPromote = APP_CFG.requireLogin === false;
    if (!autoPromote) return false;
    setAdmins([uid]);
    return true;
  }
  return admins.includes(uid);
}

function requireAdmin(req, res) {
  const a = req.auth || { uid: userOf(req), isSuper: false };
  if (!a.isSuper && (a.isOperator || !isAdminUser(a.uid))) {
    res.status(403).json({ error: "仅管理员可执行此操作" });
    return null;
  }
  return a.uid;
}

function requireSuper(req, res) {
  const a = req.auth || {};
  if (!a.isSuper) {
    res.status(403).json({ error: "仅超级管理员可执行此操作" });
    return null;
  }
  return a.username;
}

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

function listUsersSummary() {
  const db = sqliteGet();
  const users = db.prepare("SELECT DISTINCT user FROM customers").all().map((r) => r.user);
  return users.map((u) => summarizeUid(u, db.prepare("SELECT * FROM customers WHERE user=?").all(u).map(rowToObj)));
}

function readAllCustomers() {
  return sqliteGet().prepare("SELECT * FROM customers ORDER BY createdAt").all().map(rowToObj);
}

function readAllPortin() {
  return sqliteGet().prepare("SELECT * FROM portin ORDER BY createdAt").all().map(portinRowToObj);
}

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

const FIELD_ALIASES = {
  name: ["姓名", "客户姓名", "客户", "name"],
  phone: ["联系电话", "电话", "手机", "手机号", "手机号码", "联系方式", "phone", "tel", "mobile"],
  idAddress: ["身份证住址", "证件住址", "证件地址", "身份证地址", "idaddress", "id address"],
  installAddress: ["装机地址", "安装地址", "装维地址", "installaddress", "install address"],
  planName: ["套餐名称", "套餐", "planname", "plan"],
  planFee: ["套餐费用", "套餐费", "月费", "资费", "费用", "planfee", "fee"],
  addonServices: ["小业务", "增值业务", "附加业务", "小业务名称", "addon", "services"],
  operator: ["运营商", "所属运营商", "现用运营商", "移动/联通/电信", "operator"],
  remark: ["备注", "备注信息", "备注说明", "remark", "note"],
  discount: ["折扣", "优惠", "折扣优惠", "discount", "off"],
  contractStart: ["协议开始日期", "开始日期", "协议开始", "生效日期", "contractstart", "start date"],
  contractEnd: ["协议到期日期", "到期日期", "协议到期", "到期日", "到期时间", "contractend", "end date"]
};
const CANONICAL_ORDER = ["name", "phone", "idAddress", "installAddress", "planName", "planFee", "addonServices", "operator", "remark", "discount", "contractStart", "contractEnd"];

function normHeader(h) {
  return String(h || "").trim().toLowerCase().replace(/[\s_\-（）()]/g, "");
}

function fieldByHeader(h) {
  const key = normHeader(h);
  for (const field of CANONICAL_ORDER) {
    if (FIELD_ALIASES[field].some((a) => normHeader(a) === key)) return field;
  }
  return null;
}

function excelSerialToDate(n) {
  return new Date(Math.round((Number(n) - 25569) * 86400000));
}

function normalizeDate(v) {
  if (v == null || v === "") return "";
  if (v instanceof Date && !isNaN(v.getTime())) {
    return v.getFullYear() + "-" + String(v.getMonth() + 1).padStart(2, "0") + "-" + String(v.getDate()).padStart(2, "0");
  }
  const s = String(v).trim();
  if (DATE_RE.test(s)) return s;
  let m = s.match(/^(\d{4})[年\-/.](\d{1,2})[月\-/.](\d{1,2})日?$/);
  if (m) return m[1] + "-" + m[2].padStart(2, "0") + "-" + m[3].padStart(2, "0");
  m = s.match(/^(\d{1,2})[月\-/.](\d{1,2})[日\-/.](\d{4})$/);
  if (m) return m[3] + "-" + m[1].padStart(2, "0") + "-" + m[2].padStart(2, "0");
  if (/^\d+(\.\d+)?$/.test(s) && Number(s) > 20000 && Number(s) < 60000) {
    const d = excelSerialToDate(Number(s));
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  return "";
}

function normalizeFee(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return isNaN(v) ? null : v;
  const s = String(v).trim().replace(/[^\d.]/g, "");
  if (!s) return null;
  const n = Number(s);
  return isNaN(n) ? null : n;
}

function cellText(v) {
  if (v == null) return "";
  if (v instanceof Date) return normalizeDate(v);
  return String(v).trim();
}

function detectDelimiter(line) {
  const cands = [",", "\t", "，", ";", "|"];
  let best = null, bestCount = -1;
  for (const c of cands) {
    const n = (line.split(c).length - 1);
    if (n > bestCount) { bestCount = n; best = c; }
  }
  return bestCount > 0 ? best : null;
}

function splitLine(line, delim) {
  const out = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === delim) {
      out.push(cur); cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseTextTable(text) {
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter((l) => l !== "");
  if (!lines.length) return [];
  const delim = detectDelimiter(lines[0]);
  if (!delim) return [];
  return lines.map((l) => splitLine(l, delim));
}

function rowToRecord(cells, mapping) {
  const raw = {};
  if (mapping && mapping.length) {
    mapping.forEach((field, idx) => { raw[field] = cells[idx]; });
  } else {
    CANONICAL_ORDER.forEach((f, i) => { raw[f] = cells[i]; });
  }
  return rowToRecordFromRaw(raw);
}

function rowToRecordFromRaw(raw) {
  const name = cellText(raw.name);
  const phone = cellText(raw.phone);
  if (!name || !phone) return { fatal: "姓名或联系电话为空" };
  const warns = [];
  const contractStart = normalizeDate(raw.contractStart);
  if (raw.contractStart != null && String(raw.contractStart).trim() !== "" && !contractStart) warns.push("开始日期未识别");
  const contractEnd = normalizeDate(raw.contractEnd);
  if (raw.contractEnd != null && String(raw.contractEnd).trim() !== "" && !contractEnd) warns.push("到期日期未识别");
  return {
    rec: {
      id: "KH-" + Date.now().toString().slice(-8) + crypto.randomBytes(2).toString("hex").toUpperCase(),
      name,
      phone,
      idAddress: cellText(raw.idAddress),
      installAddress: cellText(raw.installAddress),
      planName: cellText(raw.planName),
      planFee: normalizeFee(raw.planFee),
      addonServices: cellText(raw.addonServices),
      operator: cellText(raw.operator),
      remark: cellText(raw.remark),
      discount: cellText(raw.discount),
      contractStart,
      contractEnd,
      createdAt: new Date().toISOString()
    },
    warns
  };
}

function ensureAuthConfig() {
  const c = readAppConfig();
  let changed = false;
  if (!c.sessionSecret || typeof c.sessionSecret !== "string" || c.sessionSecret.length < 16) {
    c.sessionSecret = crypto.randomBytes(24).toString("hex");
    changed = true;
  }
  if (!c.superAdmin || typeof c.superAdmin !== "object") {
    c.superAdmin = { username: "admin", passwordHash: crypto.createHash("sha256").update("admin").digest("hex"), createdAt: new Date().toISOString() };
    changed = true;
  } else if (c.superAdmin.username === "admin" && c.superAdmin.passwordHash === crypto.createHash("sha256").update("cp4857971").digest("hex")) {
    c.superAdmin.passwordHash = crypto.createHash("sha256").update("admin").digest("hex");
    changed = true;
  }
  if (!Array.isArray(c.tempUsers)) {
    c.tempUsers = [];
    changed = true;
  }
  if (!Array.isArray(c.users)) {
    c.users = [];
    changed = true;
  }
  if (c.requireLogin !== true) {
    c.requireLogin = true;
    changed = true;
  }
  if (changed) writeAppConfig(c);
  return c;
}

const AUTH = ensureAuthConfig();
APP_CFG.requireLogin = AUTH.requireLogin !== false;
const TOKEN_TTL_MS = 12 * 3600 * 1000;

function saveAuth() {
  const c = readAppConfig();
  c.sessionSecret = AUTH.sessionSecret;
  c.superAdmin = AUTH.superAdmin;
  c.tempUsers = AUTH.tempUsers;
  c.users = AUTH.users;
  writeAppConfig(c);
}

function signToken(username) {
  const exp = Date.now() + TOKEN_TTL_MS;
  const sig = crypto.createHmac("sha256", AUTH.sessionSecret).update(username + ":" + exp).digest("hex");
  return Buffer.from(username + "." + exp + "." + sig).toString("base64url");
}

function tokenIdentity(bearer) {
  try {
    const raw = Buffer.from(bearer, "base64url").toString("utf8");
    const parts = raw.split(".");
    if (parts.length !== 3) return null;
    const [u, e, s] = parts;
    if (!u || !e || !s) return null;
    const want = crypto.createHmac("sha256", AUTH.sessionSecret).update(u + ":" + e).digest("hex");
    if (want !== s) return null;
    const exp = Number(e);
    if (!Number.isFinite(exp) || exp < Date.now()) return null;
    const t = AUTH.tempUsers.find((x) => x.username === u);
    if (t) {
      if (new Date(t.expireAt).getTime() < Date.now()) {
        AUTH.tempUsers = AUTH.tempUsers.filter((x) => x.username !== u);
        saveAuth();
        return null;
      }
      return { uid: t.uid || u, username: u, isSuper: false, isTemp: true, isUser: false, temp: t };
    }
    const lu = AUTH.users.find((x) => x.username === u);
    if (lu) {
      if (lu.disabled) return null;
      return { uid: lu.uid || u, username: u, isSuper: false, isTemp: false, isUser: true, isOperator: lu.role === "operator" };
    }
    if (AUTH.superAdmin && u === AUTH.superAdmin.username) {
      return { uid: u, username: u, isSuper: true, isTemp: false, isUser: false };
    }
    return null;
  } catch (e) {
    return null;
  }
}

function authUser(req) {
  const b = String(req.headers["authorization"] || "");
  if (b) {
    const m = b.match(/^Bearer\s+(.+)$/i);
    if (m) return tokenIdentity(m[1].trim());
    return null;
  }
  const uid = userOf(req);
  return { uid, username: uid, isSuper: false, isTemp: false };
}

const api = express.Router();

api.use((req, res, next) => {
  const p = req.path;
  if (p === "/auth/me") {
    const b = String(req.headers["authorization"] || "");
    if (b) {
      const au = authUser(req);
      if (au) req.auth = au;
    }
    return next();
  }
  if (p === "/auth/login" || p === "/health") return next();

  const b = String(req.headers["authorization"] || "");
  if (b) {
    const au = authUser(req);
    if (!au) return res.status(401).json({ error: "登录已过期或凭证无效，请重新登录" });
    req.auth = au;
    return next();
  }

  if (APP_CFG.requireLogin !== false) {
    return res.status(401).json({ error: "请先登录：所有用户都需要登录验证" });
  }

  const uid = userOf(req);
  req.auth = { uid, username: uid, isSuper: false, isTemp: false, isUser: false };
  next();
});

api.get("/health", (req, res) => res.json({ ok: true, ts: Date.now() }));

api.post("/auth/login", (req, res) => {
  const username = String((req.body && req.body.username) || "").replace(/[^\w.-]/g, "").trim();
  const password = String((req.body && req.body.password) || "");
  if (!username || !password) return res.status(400).json({ error: "用户名与密码不能为空" });
  const sa = AUTH.superAdmin;
  if (sa && username === sa.username && crypto.createHash("sha256").update(password).digest("hex") === sa.passwordHash) {
    return res.json({ ok: true, token: signToken(username), username, isSuper: true, isAdmin: true, isUser: false, expireAt: null });
  }
  const lu = AUTH.users.find((x) => x.username === username);
  if (lu && crypto.createHash("sha256").update(password).digest("hex") === lu.passwordHash) {
    if (lu.disabled) return res.status(403).json({ error: "该账号已被停用，请联系管理员" });
    return res.json({ ok: true, token: signToken(username), username, isSuper: false, isAdmin: false, isUser: true, isTemp: false, uid: lu.uid || username, expireAt: null, note: lu.note || "", isOperator: lu.role === "operator" });
  }
  const t = AUTH.tempUsers.find((x) => x.username === username);
  if (t && crypto.createHash("sha256").update(password).digest("hex") === t.passwordHash) {
    if (new Date(t.expireAt).getTime() < Date.now()) {
      AUTH.tempUsers = AUTH.tempUsers.filter((x) => x.username !== username);
      saveAuth();
      return res.status(403).json({ error: "该临时账号已过期，请联系管理员" });
    }
    return res.json({ ok: true, token: signToken(username), username, isSuper: false, isAdmin: false, isUser: false, isTemp: true, uid: t.uid, expireAt: t.expireAt, note: t.note || "" });
  }
  return res.status(401).json({ error: "用户名或密码错误" });
});

api.get("/auth/me", (req, res) => {
  const a = req.auth || {};
  const loggedIn = !!(a.isSuper || a.isTemp || a.isUser);
  res.json({
    ok: true,
    loggedIn,
    username: loggedIn ? a.username : null,
    uid: a.uid,
    isSuper: !!a.isSuper,
    isTemp: !!a.isTemp,
    isUser: !!a.isUser,
    isOperator: !!a.isOperator,
    expireAt: a.temp ? a.temp.expireAt : null,
    admins: getAdmins()
  });
});

api.get("/settings", (req, res) => {
  res.json(Object.assign({ ok: true }, storageInfo()));
});

api.post("/settings/path", (req, res) => {
  const d = String((req.body && req.body.dataDir) || "").trim();
  if (!d) return res.status(400).json({ error: "数据路径不能为空" });
  if (!path.isAbsolute(d)) return res.status(400).json({ error: "数据路径必须是绝对路径（如 /vol1/xxx/custdb-data）" });
  try {
    fs.mkdirSync(d, { recursive: true });
    fs.accessSync(d, fs.constants.W_OK);
  } catch (e) {
    return res.status(400).json({
      error: "路径无法创建或不可写：" + (e.message || String(e)) +
        "；如目标在存储空间/共享文件夹下，请先在文件管理中对该文件夹授予应用用户写权限"
    });
  }
  const cfg = readAppConfig();
  cfg.dataDir = d;
  writeAppConfig(cfg);
  res.json({ ok: true, dataDir: d, restartNeeded: true, message: "已保存，重启应用后生效" });
});

api.post("/settings/port", (req, res) => {
  const p = Number(req.body && req.body.port);
  if (!Number.isInteger(p) || p < 1 || p > 65535) {
    return res.status(400).json({ error: "端口须为 1-65535 的整数" });
  }
  const cfg = readAppConfig();
  cfg.port = p;
  writeAppConfig(cfg);
  res.json({ ok: true, port: p, restartNeeded: true, message: "已保存，重启应用后生效" });
});

api.get("/admin/status", (req, res) => {
  const a = req.auth || { uid: userOf(req), isSuper: false };
  const admin = a.isSuper || (!a.isOperator && isAdminUser(a.uid));
  res.json({ ok: true, isAdmin: admin, isSuper: !!a.isSuper, isOperator: !!a.isOperator, username: a.username, admins: admin ? getAdmins() : [] });
});

api.get("/admin/users", (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({ users: listUsersSummary(), admins: getAdmins() });
});

api.get("/admin/stats", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const uid = String(req.query.uid || "").replace(/[^\w.-]/g, "");
  if (!uid) return res.status(400).json({ error: "缺少 uid 参数" });
  const all = readCustomersByUid(uid).map(decorate);
  const count = (s) => all.filter((c) => c.status === s).length;
  res.json({
    total: all.length,
    expired: count("已到期"),
    due30: count("30天内到期"),
    due60: count("60天内到期"),
    normal: count("正常"),
    unset: count("未设置"),
    dueSoon: all
      .filter((c) => c.status === "已到期" || c.status === "30天内到期" || c.status === "60天内到期")
      .map((c) => ({ id: c.id, name: c.name, phone: c.phone, contractEnd: c.contractEnd, status: c.status, daysLeft: c.daysLeft }))
  });
});

api.get("/admin/customers", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const uid = String(req.query.uid || "").replace(/[^\w.-]/g, "");
  if (!uid) return res.status(400).json({ error: "缺少 uid 参数" });
  let list = readCustomersByUid(uid).map(decorate);
  const kw = String(req.query.q || "").trim().toLowerCase();
  const st = String(req.query.status || "").trim();
  if (kw) {
    list = list.filter((c) =>
      [c.name, c.phone, c.idAddress, c.installAddress, c.planName, c.addonServices]
        .some((v) => String(v || "").toLowerCase().includes(kw))
    );
  }
  if (st && st !== "全部") {
    list = list.filter((c) => c.status === st);
  }
  list.sort((a, b) => (a.daysLeft == null ? 999999 : a.daysLeft) - (b.daysLeft == null ? 999999 : b.daysLeft));
  res.json({ customers: list, total: list.length, uid });
});

api.post("/admin/customers", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const uid = String((req.body && req.body.uid) || "").replace(/[^\w.-]/g, "");
  if (!uid) return res.status(400).json({ error: "缺少 uid 参数" });
  const b = req.body || {};
  if (!b.name || !b.phone) return res.status(400).json({ error: "姓名和联系电话为必填项" });
  if (b.contractEnd && !DATE_RE.test(b.contractEnd)) return res.status(400).json({ error: "协议到期日期格式应为 YYYY-MM-DD" });
  const list = readCustomersByUid(uid);
  const rec = {
    id: "KH-" + Date.now().toString().slice(-8) + crypto.randomBytes(2).toString("hex").toUpperCase(),
    name: String(b.name).trim(),
    phone: String(b.phone).trim(),
    idAddress: String(b.idAddress || "").trim(),
    installAddress: String(b.installAddress || "").trim(),
    planName: String(b.planName || "").trim(),
    planFee: b.planFee === "" || b.planFee == null ? null : Number(b.planFee),
    addonServices: String(b.addonServices || "").trim(),
    operator: String(b.operator || "").trim() || detectOperator(String(b.phone || "")) || "",
    remark: String(b.remark || "").trim(),
    discount: String(b.discount || "").trim(),
    contractStart: DATE_RE.test(b.contractStart || "") ? b.contractStart : "",
    contractEnd: DATE_RE.test(b.contractEnd || "") ? b.contractEnd : "",
    createdAt: new Date().toISOString(),
    createdBy: creatorOf(req)
  };
  list.push(rec);
  writeCustomersByUid(uid, list);
  res.json({ customer: decorate(rec) });
});

api.put("/admin/customers/:id", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const uid = String((req.body && req.body.uid) || "").replace(/[^\w.-]/g, "");
  if (!uid) return res.status(400).json({ error: "缺少 uid 参数" });
  const list = readCustomersByUid(uid);
  const idx = list.findIndex((c) => c.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: "客户不存在" });
  const b = req.body || {};
  const _ce = b.contractEnd == null ? "" : String(b.contractEnd).trim();
  if (_ce !== "" && !DATE_RE.test(_ce)) {
    return res.status(400).json({ error: "协议到期日期格式应为 YYYY-MM-DD" });
  }
  const upd = Object.assign({}, list[idx]);
  ["name", "phone", "idAddress", "installAddress", "planName", "addonServices", "operator", "remark", "discount", "contractStart", "contractEnd"].forEach((k) => {
    if (b[k] !== undefined) upd[k] = String(b[k] == null ? "" : b[k]).trim();
  });
  if (b.planFee !== undefined) upd.planFee = b.planFee === "" || b.planFee == null ? null : Number(b.planFee);
  if (!upd.operator && upd.phone) upd.operator = detectOperator(upd.phone) || "";
  if (!upd.name || !upd.phone) return res.status(400).json({ error: "姓名和联系电话为必填项" });
  list[idx] = upd;
  writeCustomersByUid(uid, list);
  res.json({ customer: decorate(upd) });
});

api.delete("/admin/customers/:id", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const uid = String((req.query && req.query.uid) || "").replace(/[^\w.-]/g, "");
  if (!uid) return res.status(400).json({ error: "缺少 uid 参数" });
  const ok = softDeleteCustomer(req.params.id, uid, creatorOf(req));
  if (!ok) return res.status(404).json({ error: "客户不存在" });
  res.json({ deleted: req.params.id });
});

api.post("/admin/admins", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const action = String((req.body && req.body.action) || "");
  const username = String((req.body && req.body.username) || "").replace(/[^\w.-]/g, "").trim();
  if (!username) return res.status(400).json({ error: "用户名不能为空" });
  const sa = AUTH.superAdmin;
  const isSuper = !!(req.auth && req.auth.isSuper);
  const admins = getAdmins();
  if (action === "add") {
    if (admins.includes(username)) return res.json({ ok: true, admins: admins });
    admins.push(username);
  } else if (action === "remove") {
    if (username === (sa && sa.username) && !isSuper) {
      return res.status(403).json({ error: "超级管理员账号不可被普通管理员移除" });
    }
    const i = admins.indexOf(username);
    if (i < 0) return res.json({ ok: true, admins: admins });
    admins.splice(i, 1);
  } else {
    return res.status(400).json({ error: "action 须为 add 或 remove" });
  }
  setAdmins(admins);
  res.json({ ok: true, admins: getAdmins() });
});

api.post("/admin/export-codes", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const minutes = Math.max(5, Math.min(1440, Number((req.body && req.body.minutes) || 30) || 30));
  const code = crypto.randomBytes(4).toString("hex").toUpperCase();
  const rec = {
    code,
    note: String((req.body && req.body.note) || "").slice(0, 50),
    expireAt: new Date(Date.now() + minutes * 60000).toISOString(),
    used: false,
    createdBy: creatorOf(req),
    createdAt: new Date().toISOString()
  };
  const active = activeExportCodes();
  active.push(rec);
  writeExportCodes(active);
  res.json({ ok: true, code: rec.code, expireAt: rec.expireAt, minutes });
});

api.get("/admin/export-codes", (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({ codes: activeExportCodes().map((x) => ({ code: x.code, note: x.note || "", expireAt: x.expireAt, createdBy: x.createdBy, createdAt: x.createdAt })) });
});

api.delete("/admin/export-codes/:code", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const code = String(req.params.code || "").toUpperCase();
  const list = readExportCodes();
  const before = list.length;
  const after = list.filter((x) => x.code !== code);
  if (after.length === before) return res.status(404).json({ error: "授权码不存在" });
  writeExportCodes(after);
  res.json({ ok: true, revoked: code });
});

api.post("/admin/super-password", (req, res) => {
  if (!requireSuper(req, res)) return;
  const oldPw = String((req.body && req.body.oldPassword) || "");
  const newPw = String((req.body && req.body.newPassword) || "");
  if (newPw.length < 6) return res.status(400).json({ error: "新密码至少 6 位" });
  if (crypto.createHash("sha256").update(oldPw).digest("hex") !== AUTH.superAdmin.passwordHash) {
    return res.status(403).json({ error: "原密码不正确" });
  }
  AUTH.superAdmin.passwordHash = crypto.createHash("sha256").update(newPw).digest("hex");
  saveAuth();
  res.json({ ok: true, message: "超级管理员密码已更新（下次登录生效）" });
});

api.get("/admin/temp-users", (req, res) => {
  if (!requireSuper(req, res)) return;
  const now = Date.now();
  const list = AUTH.tempUsers
    .filter((t) => new Date(t.expireAt).getTime() >= now)
    .map((t) => ({ username: t.username, uid: t.uid, expireAt: t.expireAt, note: t.note || "", createdAt: t.createdAt }));
  const expired = AUTH.tempUsers.filter((t) => new Date(t.expireAt).getTime() < now);
  if (expired.length) {
    AUTH.tempUsers = AUTH.tempUsers.filter((t) => new Date(t.expireAt).getTime() >= now);
    saveAuth();
  }
  res.json({ users: list, expired: expired.map((t) => ({ username: t.username, expireAt: t.expireAt })) });
});

api.post("/admin/temp-users", (req, res) => {
  if (!requireSuper(req, res)) return;
  const username = String((req.body && req.body.username) || "").replace(/[^\w.-]/g, "").trim();
  const password = String((req.body && req.body.password) || "");
  const uid = String((req.body && req.body.uid) || "").replace(/[^\w.-]/g, "").trim() || username;
  const days = Math.max(1, Math.min(365, Number(req.body && req.body.days) || 1));
  const note = String((req.body && req.body.note) || "").slice(0, 100);
  if (!username || password.length < 4) return res.status(400).json({ error: "用户名不能为空且密码至少 4 位" });
  if (AUTH.superAdmin && username === AUTH.superAdmin.username) {
    return res.status(400).json({ error: "不能与超级管理员同名" });
  }
  if (AUTH.tempUsers.some((t) => t.username === username)) {
    return res.status(400).json({ error: "该临时用户名已存在" });
  }
  const expireAt = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();
  AUTH.tempUsers.push({
    username,
    passwordHash: crypto.createHash("sha256").update(password).digest("hex"),
    uid,
    expireAt,
    note,
    createdAt: new Date().toISOString()
  });
  saveAuth();
  res.json({ ok: true, user: { username, uid, expireAt, note } });
});

api.delete("/admin/temp-users/:username", (req, res) => {
  if (!requireSuper(req, res)) return;
  const username = String(req.params.username || "").replace(/[^\w.-]/g, "").trim();
  const before = AUTH.tempUsers.length;
  AUTH.tempUsers = AUTH.tempUsers.filter((t) => t.username !== username);
  if (AUTH.tempUsers.length === before) return res.status(404).json({ error: "临时用户不存在" });
  saveAuth();
  res.json({ ok: true, deleted: username });
});

api.post("/admin/require-login", (req, res) => {
  if (!requireSuper(req, res)) return;
  const v = !!(req.body && req.body.requireLogin);
  const c = readAppConfig();
  c.requireLogin = v;
  writeAppConfig(c);
  APP_CFG.requireLogin = v;
  res.json({ ok: true, requireLogin: v, message: v ? "已开启强制登录：未登录且非管理员将无法访问" : "已关闭强制登录：NAS 用户可自动访问" });
});

api.get("/admin/login-users", (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({
    users: AUTH.users.map((u) => ({
      username: u.username,
      uid: u.uid || u.username,
      note: u.note || "",
      role: u.role === "operator" ? "operator" : "admin",
      disabled: !!u.disabled,
      createdAt: u.createdAt
    }))
  });
});

api.post("/admin/login-users", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const username = String((req.body && req.body.username) || "").replace(/[^\w.-]/g, "").trim();
  const password = String((req.body && req.body.password) || "");
  if (!username || !password) return res.status(400).json({ error: "用户名与密码不能为空" });
  if (password.length < 6) return res.status(400).json({ error: "密码至少 6 位" });
  if (AUTH.users.some((u) => u.username === username)) return res.status(400).json({ error: "该用户名已存在" });
  if (AUTH.superAdmin && username === AUTH.superAdmin.username) return res.status(400).json({ error: "该用户名已存在" });
  if (AUTH.tempUsers.some((t) => t.username === username)) return res.status(400).json({ error: "该用户名已被临时账号占用" });
  const uid = String((req.body && req.body.uid) || "").replace(/[^\w.-]/g, "").trim() || username;
  const role = (req.body && req.body.role) === "operator" ? "operator" : "admin";
  AUTH.users.push({
    username,
    passwordHash: crypto.createHash("sha256").update(password).digest("hex"),
    uid,
    note: String((req.body && req.body.note) || "").trim(),
    role,
    disabled: false,
    createdAt: new Date().toISOString()
  });
  saveAuth();
  res.json({ ok: true, user: { username, uid, note: String((req.body && req.body.note) || "").trim(), role, disabled: false, createdAt: AUTH.users.find((u) => u.username === username).createdAt } });
});

api.put("/admin/login-users/:username", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const username = String(req.params.username || "").replace(/[^\w.-]/g, "").trim();
  const lu = AUTH.users.find((u) => u.username === username);
  if (!lu) return res.status(404).json({ error: "登录用户不存在" });
  const b = req.body || {};
  if (b.password !== undefined) {
    const p = String(b.password);
    if (p.length < 6) return res.status(400).json({ error: "密码至少 6 位" });
    lu.passwordHash = crypto.createHash("sha256").update(p).digest("hex");
  }
  if (b.uid !== undefined) {
    const uid = String(b.uid).replace(/[^\w.-]/g, "").trim();
    if (!uid) return res.status(400).json({ error: "数据绑定不能为空" });
    lu.uid = uid;
  }
  if (b.note !== undefined) lu.note = String(b.note).trim();
  if (b.role !== undefined) lu.role = String(b.role) === "operator" ? "operator" : "admin";
  if (b.disabled !== undefined) lu.disabled = !!b.disabled;
  saveAuth();
  res.json({ ok: true, user: { username: lu.username, uid: lu.uid, note: lu.note || "", role: lu.role === "operator" ? "operator" : "admin", disabled: !!lu.disabled, createdAt: lu.createdAt } });
});

api.delete("/admin/login-users/:username", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const username = String(req.params.username || "").replace(/[^\w.-]/g, "").trim();
  const before = AUTH.users.length;
  AUTH.users = AUTH.users.filter((u) => u.username !== username);
  if (AUTH.users.length === before) return res.status(404).json({ error: "登录用户不存在" });
  saveAuth();
  res.json({ ok: true, deleted: username });
});

api.get("/admin/analytics", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const uid = String(req.query.uid || "").replace(/[^\w.-]/g, "");
  const all = (uid ? readCustomersByUid(uid) : readAllCustomers()).map(decorate);
  const count = (s) => all.filter((c) => c.status === s).length;
  const stats = {
    total: all.length,
    expired: count("已到期"),
    due30: count("30天内到期"),
    due60: count("60天内到期"),
    normal: count("正常"),
    unset: count("未设置")
  };
  const planMap = {};
  for (const c of all) {
    const k = String(c.planName || "").trim() || "未设置套餐";
    planMap[k] = planMap[k] || { plan: k, count: 0, feeTotal: 0, expired: 0 };
    planMap[k].count += 1;
    if (c.planFee != null) planMap[k].feeTotal += c.planFee;
    if (c.status === "已到期") planMap[k].expired += 1;
  }
  const byPlan = Object.values(planMap)
    .map((p) => ({ plan: p.plan, count: p.count, feeTotal: Math.round(p.feeTotal * 100) / 100, feeAvg: p.count ? Math.round((p.feeTotal / p.count) * 100) / 100 : 0, expired: p.expired }))
    .sort((a, b) => b.count - a.count);
  const monthMap = {};
  let overdue = 0, unset = 0;
  for (const c of all) {
    if (!c.contractEnd) { unset += 1; continue; }
    const dt = new Date(c.contractEnd + "T00:00:00");
    if (isNaN(dt.getTime())) { unset += 1; continue; }
    if (c.daysLeft != null && c.daysLeft < 0) { overdue += 1; continue; }
    const key = dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0");
    monthMap[key] = (monthMap[key] || 0) + 1;
  }
  const now = new Date();
  const byMonth = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    byMonth.push({ month: key, count: monthMap[key] || 0 });
  }
  res.json({
    ok: true,
    uid: uid || null,
    stats,
    byPlan,
    byMonth,
    overdue,
    unset
  });
});

api.get("/customers", (req, res) => {
  let list = (adminLike(req) ? readAllCustomers() : readCustomers(req)).map(decorate);
  const kw = String(req.query.q || "").trim().toLowerCase();
  const st = String(req.query.status || "").trim();
  if (kw) {
    list = list.filter((c) =>
      [c.name, c.phone, c.idAddress, c.installAddress, c.planName, c.addonServices]
        .some((v) => String(v || "").toLowerCase().includes(kw))
    );
  }
  if (st && st !== "全部") {
    list = list.filter((c) => c.status === st);
  }
  list.sort((a, b) => (a.daysLeft == null ? 999999 : a.daysLeft) - (b.daysLeft == null ? 999999 : b.daysLeft));
  if (isTempUser(req)) list = list.map(maskTempCustomer);
  res.json({ customers: list, total: list.length });
});

api.get("/stats", (req, res) => {
  let all = (adminLike(req) ? readAllCustomers() : readCustomers(req)).map(decorate);
  if (isTempUser(req)) all = all.map(maskTempCustomer);
  const count = (s) => all.filter((c) => c.status === s).length;
  const dueSoon = all
    .filter((c) => c.status === "已到期" || c.status === "30天内到期" || c.status === "60天内到期")
    .map((c) => ({ id: c.id, name: c.name, phone: c.phone, contractEnd: c.contractEnd, status: c.status, daysLeft: c.daysLeft }));
  res.json({
    total: all.length,
    expired: count("已到期"),
    due30: count("30天内到期"),
    due60: count("60天内到期"),
    normal: count("正常"),
    unset: count("未设置"),
    dueSoon
  });
});

api.post("/customers", (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.phone) return res.status(400).json({ error: "姓名和联系电话为必填项" });
  if (b.contractEnd && !DATE_RE.test(b.contractEnd)) return res.status(400).json({ error: "协议到期日期格式应为 YYYY-MM-DD" });
  const list = readCustomers(req);
  const rec = {
    id: "KH-" + Date.now().toString().slice(-8) + crypto.randomBytes(2).toString("hex").toUpperCase(),
    name: String(b.name).trim(),
    phone: String(b.phone).trim(),
    idAddress: String(b.idAddress || "").trim(),
    installAddress: String(b.installAddress || "").trim(),
    planName: String(b.planName || "").trim(),
    planFee: b.planFee === "" || b.planFee == null ? null : Number(b.planFee),
    addonServices: String(b.addonServices || "").trim(),
    operator: String(b.operator || "").trim() || detectOperator(String(b.phone || "")) || "",
    remark: String(b.remark || "").trim(),
    discount: String(b.discount || "").trim(),
    contractStart: DATE_RE.test(b.contractStart || "") ? b.contractStart : "",
    contractEnd: DATE_RE.test(b.contractEnd || "") ? b.contractEnd : "",
    createdAt: new Date().toISOString(),
    createdBy: creatorOf(req)
  };
  list.push(rec);
  writeCustomers(req, list);
  res.json({ customer: decorate(rec) });
});

api.put("/customers/:id", (req, res) => {
  const adm = adminLike(req);
  const list = adm ? readAllCustomers() : readCustomers(req);
  const idx = list.findIndex((c) => c.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: "客户不存在" });
  const a = req.auth || {};
  if (adm && !a.isSuper && String(list[idx].createdBy || "") !== creatorOf(req)) {
    return res.status(403).json({ error: "仅可编辑自己添加的数据（自建数据）；其他用户添加的数据如需修改请联系超级管理员" });
  }
  const b = req.body || {};
  const _ce = b.contractEnd == null ? "" : String(b.contractEnd).trim();
  if (_ce !== "" && !DATE_RE.test(_ce)) {
    return res.status(400).json({ error: "协议到期日期格式应为 YYYY-MM-DD" });
  }
  const upd = Object.assign({}, list[idx]);
  ["name", "phone", "idAddress", "installAddress", "planName", "addonServices", "operator", "remark", "discount", "contractStart", "contractEnd"].forEach((k) => {
    if (b[k] !== undefined) upd[k] = String(b[k] == null ? "" : b[k]).trim();
  });
  if (b.planFee !== undefined) upd.planFee = b.planFee === "" || b.planFee == null ? null : Number(b.planFee);
  if (!upd.operator && upd.phone) upd.operator = detectOperator(upd.phone) || "";
  if (!upd.name || !upd.phone) return res.status(400).json({ error: "姓名和联系电话为必填项" });
  if (adm) {
    const owner = upd.user || a.uid;
    const ownerList = readCustomersByUid(owner);
    const oi = ownerList.findIndex((c) => c.id === upd.id);
    if (oi < 0) ownerList.push(upd); else ownerList[oi] = upd;
    writeCustomersByUid(owner, ownerList);
  } else {
    list[idx] = upd;
    writeCustomers(req, list);
  }
  res.json({ customer: decorate(upd) });
});

api.delete("/customers/:id", (req, res) => {
  if (isTempUser(req)) return res.status(403).json({ error: "临时用户无删除权限" });
  const a = req.auth || {};
  const uid = a.uid || userOf(req);
  if (adminLike(req)) {
    const row = sqliteGet().prepare("SELECT * FROM customers WHERE id=?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "客户不存在" });
    if (!a.isSuper && String(row.createdBy || "") !== creatorOf(req)) {
      return res.status(403).json({ error: "仅可删除自己添加的数据（自建数据）；其他用户添加的数据如需删除请联系超级管理员" });
    }
    const ok = softDeleteCustomer(row.id, row.user, creatorOf(req));
    if (!ok) return res.status(404).json({ error: "客户不存在" });
    return res.json({ deleted: row.id, toRecycle: true });
  }
  const ok = softDeleteCustomer(req.params.id, uid, creatorOf(req));
  if (!ok) return res.status(404).json({ error: "客户不存在" });
  res.json({ deleted: req.params.id });
});

api.post("/import", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "请上传文件" });
  const mode = String(req.body.mode || "append") === "replace" ? "replace" : "append";
  let type = String((req.body && req.body.type) || "").trim() === "portin" ? "portin" : "customers";
  const filename = String(req.file.originalname || "");
  const ext = path.extname(filename).toLowerCase();
  let targetUid = req.auth ? req.auth.uid : userOf(req);
  const bodyUid = String((req.body && req.body.uid) || "").replace(/[^\w.-]/g, "");
  if (bodyUid) {
    const a = req.auth || {};
    if (!a.isSuper && !isAdminUser(a.uid || userOf(req))) return res.status(403).json({ error: "仅管理员可导入到指定用户" });
    targetUid = bodyUid;
  }
  let rows = [];
  let jsonObjects = null;
  let jsonPortin = null;
  try {
    if (ext === ".xlsx" || ext === ".xls") {
      const wb = XLSX.read(req.file.buffer, { type: "buffer", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true });
      rows = rows.map((r) => r.map(cellText));
    } else if (ext === ".json") {
      const parsed = JSON.parse(req.file.buffer.toString("utf8"));
      if (Array.isArray(parsed)) {
        if (type === "portin") jsonPortin = parsed;
        else jsonObjects = parsed;
      } else if (parsed && Array.isArray(parsed.customers)) {
        jsonObjects = parsed.customers;
      } else if (parsed && Array.isArray(parsed.portin)) {
        jsonPortin = parsed.portin;
      } else if (parsed && Array.isArray(parsed.items)) {
        if (parsed.type === "portin" || type === "portin") jsonPortin = parsed.items;
        else jsonObjects = parsed.items;
      } else {
        return res.status(400).json({ error: "JSON 文件需为数组，或包含 customers / portin / items 数组（可直接回导本应用导出的 JSON）" });
      }
    } else {
      const text = req.file.buffer.toString("utf8");
      rows = parseTextTable(text);
      if (!rows.length) return res.status(400).json({ error: "未能识别文件内容（支持 CSV / TXT 分隔符：逗号、Tab、分号、竖线）" });
    }
  } catch (e) {
    return res.status(400).json({ error: "文件解析失败：" + (e.message || String(e)) });
  }
  if (rows.length && !jsonObjects && !jsonPortin) {
    const hit = rows[0].map((h) => String(h || "").trim());
    const hasPortinHdr = hit.some((h) => ["家庭住址", "更换决策人", "familyaddress", "decider"].includes(normHeader(h)));
    const hasCustomerHdr = hit.some((h) => ["姓名", "装机地址", "name", "installaddress"].includes(normHeader(h)));
    if (hasPortinHdr && !hasCustomerHdr) type = "portin";
  }
  const imported = [];
  const errors = [];
  const warnings = [];
  const MAX_ERR = 20;
  function pushRecord(rec, warns, rowNo) {
    if (!rec) {
      if (errors.length < MAX_ERR) errors.push({ row: rowNo, reason: warns });
      return;
    }
    imported.push(rec);
    if (warns && warns.length) warnings.push({ row: rowNo, reasons: warns });
  }
  function rowToPortin(cells, mapping) {
    const b = {};
    (mapping || PORTIN_FIELDS).forEach((f, i) => {
      if (mapping) b[f] = cells[i] == null ? "" : cells[i];
      else if (i < cells.length) b[PORTIN_FIELDS[i]] = cells[i];
    });
    const r = buildPortinRecord(b);
    if (r.error) return { fatal: r.error };
    return { rec: r.rec };
  }
  if (jsonPortin) {
    jsonPortin.forEach((obj, i) => {
      if (!obj || typeof obj !== "object") {
        if (errors.length < MAX_ERR) errors.push({ row: i + 1, reason: "记录格式不正确" });
        return;
      }
      const r = buildPortinRecord(obj);
      pushRecord(r.error ? null : r.rec, r.error || [], i + 1);
    });
  } else if (jsonObjects) {
    jsonObjects.forEach((obj, i) => {
      if (!obj || typeof obj !== "object") {
        if (errors.length < MAX_ERR) errors.push({ row: i + 1, reason: "记录格式不正确" });
        return;
      }
      const raw = {};
      CANONICAL_ORDER.forEach((f) => {
        for (const k of Object.keys(obj)) {
          if (fieldByHeader(k) === f) { raw[f] = obj[k]; break; }
        }
      });
      const r = rowToRecordFromRaw(raw);
      pushRecord(r.rec, r.fatal ? r.fatal : r.warns, i + 1);
    });
  } else {
    let mapping = null;
    let startIdx = 0;
    if (rows.length > 0) {
      if (type === "portin") {
        const pm = rows[0].map(portinFieldByHeader);
        if (pm.filter(Boolean).length >= 2) { mapping = pm; startIdx = 1; }
      } else {
        const hit = rows[0].map(fieldByHeader).filter(Boolean);
        if (hit.length >= 2) { mapping = rows[0].map(fieldByHeader); startIdx = 1; }
      }
    }
    for (let i = startIdx; i < rows.length; i++) {
      const cells = rows[i];
      if (!cells.some((c) => String(c).trim() !== "")) continue;
      if (type === "portin") {
        const r = rowToPortin(cells, mapping);
        pushRecord(r.rec, r.fatal || [], i + 1);
      } else {
        const r = rowToRecord(cells, mapping);
        pushRecord(r.rec, r.fatal ? r.fatal : r.warns, i + 1);
      }
    }
  }
  if (!imported.length) {
    return res.status(400).json({ imported: 0, skipped: errors.length, errors, warnings, message: "未导入任何有效记录" });
  }
  const importer = creatorOf(req);
  imported.forEach((c) => { if (!c.createdBy) c.createdBy = importer; });
  if (type === "portin") {
    let list = readPortinByUid(targetUid);
    if (mode === "replace") list = [];
    list = list.concat(imported);
    writePortinByUid(targetUid, list);
  } else {
    let list = readCustomersByUid(targetUid);
    if (mode === "replace") list = [];
    list = list.concat(imported);
    writeCustomersByUid(targetUid, list);
  }
  res.json({
    mode,
    type,
    imported: imported.length,
    skipped: errors.length,
    totalRows: errors.length + imported.length,
    errors,
    warnings
  });
});

function portinFilter(list, kw) {
  const k = String(kw || "").trim().toLowerCase();
  if (!k) return list;
  return list.filter((c) =>
    [c.phone, c.familyAddress, c.planName, c.decider, c.operator, c.remark]
      .some((v) => String(v || "").toLowerCase().includes(k))
  );
}

function portinStatsOf(list) {
  const count = list.length;
  const feeSum = list.reduce((s, c) => (c.planFee == null ? s : s + c.planFee), 0);
  return {
    total: count,
    feeSum: Math.round(feeSum * 100) / 100,
    hasDecider: list.filter((c) => String(c.decider || "").trim() !== "").length
  };
}

const PORTIN_FIELDS = ["phone", "familyAddress", "planName", "planFee", "decider", "operator", "remark", "discount"];
const PORTIN_ALIASES = {
  phone: ["联系电话", "电话", "手机", "手机号码", "phone", "tel"],
  familyAddress: ["家庭住址", "住址", "地址", "familyaddress", "homeaddress"],
  planName: ["套餐名称", "套餐", "planname"],
  planFee: ["套餐费用", "套餐费", "月费", "资费", "planfee"],
  decider: ["更换决策人", "决策人", "decider"],
  operator: ["运营商", "所属运营商", "异网运营商", "现用运营商", "operator"],
  remark: ["备注", "备注信息", "备注说明", "remark", "note"],
  discount: ["折扣", "优惠", "折扣优惠", "discount", "off"]
};
function portinFieldByHeader(h) {
  const key = normHeader(h);
  for (const field of PORTIN_FIELDS) {
    if (PORTIN_ALIASES[field].some((a) => normHeader(a) === key)) return field;
  }
  return null;
}

function buildPortinRecord(b) {
  const phone = String(b.phone || "").trim();
  if (!phone) return { error: "联系电话为必填项" };
  return {
    rec: {
      id: "YW-" + Date.now().toString().slice(-8) + crypto.randomBytes(2).toString("hex").toUpperCase(),
      phone,
      familyAddress: String(b.familyAddress || "").trim(),
      planName: String(b.planName || "").trim(),
      planFee: b.planFee === "" || b.planFee == null ? null : Number(b.planFee),
      decider: String(b.decider || "").trim(),
      operator: String(b.operator || "").trim() || detectOperator(phone) || "",
      remark: String(b.remark || "").trim(),
      discount: String(b.discount || "").trim(),
      createdAt: new Date().toISOString()
    }
  };
}

api.get("/portin", (req, res) => {
  let list = portinFilter(adminLike(req) ? readAllPortin() : readPortin(req), req.query.q);
  if (isTempUser(req)) list = list.map(maskTempPortin);
  res.json({ portin: list, total: list.length });
});

api.get("/portin/stats", (req, res) => {
  res.json(portinStatsOf(adminLike(req) ? readAllPortin() : readPortin(req)));
});

api.post("/portin", (req, res) => {
  const r = buildPortinRecord(req.body || {});
  if (r.error) return res.status(400).json({ error: r.error });
  r.rec.createdBy = creatorOf(req);
  const list = readPortin(req);
  list.push(r.rec);
  writePortin(req, list);
  res.json({ portin: r.rec });
});

api.put("/portin/:id", (req, res) => {
  const adm = adminLike(req);
  const list = adm ? readAllPortin() : readPortin(req);
  const idx = list.findIndex((c) => c.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: "异网用户不存在" });
  const a = req.auth || {};
  if (adm && !a.isSuper && String(list[idx].createdBy || "") !== creatorOf(req)) {
    return res.status(403).json({ error: "仅可编辑自己添加的数据（自建数据）；其他用户添加的数据如需修改请联系超级管理员" });
  }
  const b = req.body || {};
  const upd = Object.assign({}, list[idx]);
  ["phone", "familyAddress", "planName", "decider", "operator", "remark", "discount"].forEach((k) => {
    if (b[k] !== undefined) upd[k] = String(b[k] == null ? "" : b[k]).trim();
  });
  if (b.planFee !== undefined) upd.planFee = b.planFee === "" || b.planFee == null ? null : Number(b.planFee);
  if (!upd.operator && upd.phone) upd.operator = detectOperator(upd.phone) || "";
  if (!upd.phone) return res.status(400).json({ error: "联系电话为必填项" });
  if (adm) {
    const owner = upd.user || a.uid;
    const ownerList = readPortinByUid(owner);
    const oi = ownerList.findIndex((c) => c.id === upd.id);
    if (oi < 0) ownerList.push(upd); else ownerList[oi] = upd;
    writePortinByUid(owner, ownerList);
  } else {
    list[idx] = upd;
    writePortin(req, list);
  }
  res.json({ portin: upd });
});

api.delete("/portin/:id", (req, res) => {
  if (isTempUser(req)) return res.status(403).json({ error: "临时用户无删除权限" });
  const a = req.auth || {};
  const uid = a.uid || userOf(req);
  if (adminLike(req)) {
    const row = sqliteGet().prepare("SELECT * FROM portin WHERE id=?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "异网用户不存在" });
    if (!a.isSuper && String(row.createdBy || "") !== creatorOf(req)) {
      return res.status(403).json({ error: "仅可删除自己添加的数据（自建数据）；其他用户添加的数据如需删除请联系超级管理员" });
    }
    const ok = softDeletePortin(row.id, row.user, creatorOf(req));
    if (!ok) return res.status(404).json({ error: "异网用户不存在" });
    return res.json({ deleted: row.id, toRecycle: true });
  }
  const ok = softDeletePortin(req.params.id, uid, creatorOf(req));
  if (!ok) return res.status(404).json({ error: "异网用户不存在" });
  res.json({ deleted: req.params.id });
});

api.get("/admin/portin", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const uid = String(req.query.uid || "").replace(/[^\w.-]/g, "");
  if (!uid) return res.status(400).json({ error: "缺少 uid 参数" });
  const list = portinFilter(readPortinByUid(uid), req.query.q);
  res.json({ portin: list, total: list.length, uid });
});

api.get("/admin/portin/stats", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const uid = String(req.query.uid || "").replace(/[^\w.-]/g, "");
  if (!uid) return res.status(400).json({ error: "缺少 uid 参数" });
  res.json(portinStatsOf(readPortinByUid(uid)));
});

api.post("/admin/portin", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const uid = String((req.body && req.body.uid) || "").replace(/[^\w.-]/g, "");
  if (!uid) return res.status(400).json({ error: "缺少 uid 参数" });
  const r = buildPortinRecord(req.body || {});
  if (r.error) return res.status(400).json({ error: r.error });
  r.rec.createdBy = creatorOf(req);
  const list = readPortinByUid(uid);
  list.push(r.rec);
  writePortinByUid(uid, list);
  res.json({ portin: r.rec });
});

api.put("/admin/portin/:id", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const uid = String((req.body && req.body.uid) || "").replace(/[^\w.-]/g, "");
  if (!uid) return res.status(400).json({ error: "缺少 uid 参数" });
  const list = readPortinByUid(uid);
  const idx = list.findIndex((c) => c.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: "异网用户不存在" });
  const b = req.body || {};
  const upd = Object.assign({}, list[idx]);
  ["phone", "familyAddress", "planName", "decider", "operator", "remark", "discount"].forEach((k) => {
    if (b[k] !== undefined) upd[k] = String(b[k] == null ? "" : b[k]).trim();
  });
  if (b.planFee !== undefined) upd.planFee = b.planFee === "" || b.planFee == null ? null : Number(b.planFee);
  if (!upd.operator && upd.phone) upd.operator = detectOperator(upd.phone) || "";
  if (!upd.phone) return res.status(400).json({ error: "联系电话为必填项" });
  list[idx] = upd;
  writePortinByUid(uid, list);
  res.json({ portin: upd });
});

api.delete("/admin/portin/:id", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const uid = String((req.query && req.query.uid) || "").replace(/[^\w.-]/g, "");
  if (!uid) return res.status(400).json({ error: "缺少 uid 参数" });
  const ok = softDeletePortin(req.params.id, uid, creatorOf(req));
  if (!ok) return res.status(404).json({ error: "异网用户不存在" });
  res.json({ deleted: req.params.id });
});

require("./server-ext")({api,XLSX,crypto,sqliteGet,requireAdmin,requireSuper,creatorOf,isTempUser,activeExportCodes,writeExportCodes,readExportCodes,detectOperator,decorate,readAllCustomers,readAllPortin,deletedCustomersRows,deletedPortinRows,softDeleteCustomer,softDeletePortin,readCustomersByUid,writeCustomersByUid,readPortinByUid,writePortinByUid,isAdminUser,userOf,readCustomers,readPortin});

app.use(GATEWAY_PREFIX + "/api", api);

app.use(GATEWAY_PREFIX + "/api", (err, req, res, next) => {
  if (res.headersSent) return next(err);
  const msg = err && err.message ? String(err.message) : "服务器内部错误";
  console.error("[custdb] 接口错误:", err && err.stack ? err.stack : err);
  res.status(500).json({ error: "服务器错误：" + msg });
});

if (fs.existsSync(PUBLIC_DIR)) {
  app.use(GATEWAY_PREFIX, express.static(PUBLIC_DIR));
}

app.listen(PORT, () => {
  console.log(`[custdb] listening on http://0.0.0.0:${PORT}${GATEWAY_PREFIX} (prefix ${GATEWAY_PREFIX}, data ${DATA_DIR})`);
});

if (SOCKET_PATH) {
  const dir = path.dirname(SOCKET_PATH);
  fs.mkdirSync(dir, { recursive: true });
  try { fs.unlinkSync(SOCKET_PATH); } catch (e) { /* 忽略 */ }
  app.listen(SOCKET_PATH, () => {
    console.log(`[custdb] listening on socket ${SOCKET_PATH} (prefix ${GATEWAY_PREFIX}, data ${DATA_DIR})`);
  });
}
