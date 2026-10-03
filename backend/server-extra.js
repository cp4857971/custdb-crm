// ============================================================================
// server-extra.js —— server.js 尾部缺失段（v0.0.27 完整版补丁）
// 用途：GitHub 网页单文件写入上限约 80KB，完整 server.js（108KB）无法一次写入，
//       因此把「套餐业务库 API / 数据导出 / 超级管理员全库 / 管理员全库」四段
//       单独存放。补全方法（2 分钟）：
//   1. 打开 https://github.com/cp4857971/custdb-crm/blob/main/backend/server.js
//   2. 点右上角铅笔进入编辑，Ctrl+F 搜索：app.use(GATEWAY_PREFIX + "/api", api);
//   3. 把光标移到这一行【之前】，粘贴本文件 // === 开始 === 之后、// === 结束 === 之前的全部内容
//   4. 删除本文件开头的说明注释，Commit changes 即可
// 提示：本文件内容与本地发布包内 server.js（108,860 字节）完全一致。
// ============================================================================

// === 开始 ===
// ---------------- 套餐业务库 / 小业务库 API（v0.0.23） ----------------
// 普通用户可读取；添加/删除仅管理员（内置项不可删除）
api.get("/library/plans", (req, res) => {
  const op = String(req.query.operator || "").trim();
  let rows = sqliteGet().prepare("SELECT * FROM plan_library ORDER BY builtin DESC, fee ASC").all();
  if (op) rows = rows.filter((r) => r.operator === op || (!r.operator && r.builtin === 0));
  res.json({ plans: rows });
});

api.get("/library/addons", (req, res) => {
  const op = String(req.query.operator || "").trim();
  let rows = sqliteGet().prepare("SELECT * FROM addon_library ORDER BY builtin DESC, name ASC").all();
  if (op) rows = rows.filter((r) => r.operator === op || (!r.operator && r.builtin === 0));
  res.json({ addons: rows });
});

api.post("/library/plans", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const b = req.body || {};
  const name = String(b.name || "").trim();
  if (!name) return res.status(400).json({ error: "套餐名称不能为空" });
  const id = "PL-" + Date.now().toString().slice(-8) + crypto.randomBytes(2).toString("hex").toUpperCase();
  sqliteGet().prepare("INSERT INTO plan_library (id,name,category,fee,operator,builtin) VALUES (?,?,?,?,?,0)")
    .run(id, name, String(b.category || "").trim(), b.fee === "" || b.fee == null ? null : Number(b.fee), String(b.operator || "").trim());
  res.json({ ok: true, id });
});

api.delete("/library/plans/:id", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const row = sqliteGet().prepare("SELECT * FROM plan_library WHERE id=?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "套餐不存在" });
  if (row.builtin) return res.status(403).json({ error: "内置套餐不可删除" });
  sqliteGet().prepare("DELETE FROM plan_library WHERE id=?").run(req.params.id);
  res.json({ ok: true, deleted: row.id });
});

api.post("/library/addons", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const b = req.body || {};
  const name = String(b.name || "").trim();
  if (!name) return res.status(400).json({ error: "小业务名称不能为空" });
  const id = "AD-" + Date.now().toString().slice(-8) + crypto.randomBytes(2).toString("hex").toUpperCase();
  sqliteGet().prepare("INSERT INTO addon_library (id,name,operator,builtin) VALUES (?,?,?,0)")
    .run(id, name, String(b.operator || "").trim());
  res.json({ ok: true, id });
});

api.delete("/library/addons/:id", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const row = sqliteGet().prepare("SELECT * FROM addon_library WHERE id=?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "小业务不存在" });
  if (row.builtin) return res.status(403).json({ error: "内置小业务不可删除" });
  sqliteGet().prepare("DELETE FROM addon_library WHERE id=?").run(req.params.id);
  res.json({ ok: true, deleted: row.id });
});

// 号码自动识别运营商（前端输入 11 位手机号实时调用）
api.get("/detect-operator", (req, res) => {
  const operator = detectOperator(String(req.query.phone || ""));
  res.json({ phone: String(req.query.phone || ""), operator: operator || "" });
});

// ---------------- 数据导出（CSV / Excel / JSON） ----------------
// 参数：format=csv|xlsx|json（默认 csv）、type=customers|portin（默认 customers）
// 范围：uid=指定用户（仅管理员）；all=1 全部用户（仅管理员）；否则导出当前用户
api.get("/export", (req, res) => {
  const format = ["csv", "xlsx", "json"].includes(req.query.format) ? req.query.format : "csv";
  const type = req.query.type === "portin" ? "portin" : "customers";

  // v0.0.24：临时用户导出数据需要管理员生成的随机授权码（单次有效，过期作废）
  if (isTempUser(req)) {
    const code = String(req.query.code || "").trim().toUpperCase();
    const active = activeExportCodes();
    const rec = active.find((x) => x.code === code);
    if (!rec) {
      return res.status(403).json({ error: "导出需要管理员授权码：请联系管理员在「授权导出」页面生成授权码后填写" });
    }
    rec.used = true;
    writeExportCodes(active);
  }

  let rows;
  let scopeName = "";
  const uid = String(req.query.uid || "").replace(/[^\w.-]/g, "");
  if (uid) {
    const a = req.auth || {};
    if (!a.isSuper && !isAdminUser(a.uid || userOf(req))) return res.status(403).json({ error: "仅管理员可导出指定用户数据" });
    rows = type === "portin" ? readPortinByUid(uid) : readCustomersByUid(uid);
    scopeName = uid + "-";
  } else if (req.query.all === "1") {
    const a = req.auth || {};
    if (!a.isSuper && !isAdminUser(a.uid || userOf(req))) return res.status(403).json({ error: "仅管理员可导出全部用户数据" });
    rows = type === "portin" ? readAllPortin() : readAllCustomers();
    scopeName = "全部用户-";
  } else {
    rows = type === "portin" ? readPortin(req) : readCustomers(req);
  }

  const typeName = type === "portin" ? "异网用户" : "客户资料";
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-T:]/g, "");
  const base = typeName + "-" + scopeName + stamp;

  if (format === "json") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename*=UTF-8''" + encodeURIComponent(base + ".json"));
    return res.send(JSON.stringify({ exportedAt: new Date().toISOString(), type, scope: scopeName || "current", count: rows.length, items: rows }, null, 2));
  }

  if (format === "xlsx") {
    const fields = type === "portin"
      ? [{ c: "联系电话", k: "phone" }, { c: "家庭住址", k: "familyAddress" }, { c: "运营商", k: "operator" }, { c: "套餐费用", k: "planFee" }, { c: "套餐名称", k: "planName" }, { c: "折扣", k: "discount" }, { c: "更换决策人", k: "decider" }, { c: "备注", k: "remark" }]
      : [{ c: "姓名", k: "name" }, { c: "联系电话", k: "phone" }, { c: "运营商", k: "operator" }, { c: "身份证住址", k: "idAddress" }, { c: "装机地址", k: "installAddress" }, { c: "套餐名称", k: "planName" }, { c: "套餐费用", k: "planFee" }, { c: "折扣", k: "discount" }, { c: "小业务", k: "addonServices" }, { c: "备注", k: "remark" }, { c: "协议开始日期", k: "contractStart" }, { c: "协议到期日期", k: "contractEnd" }, { c: "到期状态", k: "status" }, { c: "剩余天数", k: "daysLeft" }];
    const data = rows.map((r) => {
      const dec = type === "portin" ? r : decorate(r);
      const o = {};
      fields.forEach((f) => { o[f.c] = dec[f.k] == null ? "" : dec[f.k]; });
      return o;
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), typeName);
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename*=UTF-8''" + encodeURIComponent(base + ".xlsx"));
    return res.send(Buffer.from(buf));
  }

  // CSV（带 BOM，Excel 直接打开中文不乱码）
  const fields = type === "portin"
    ? [{ c: "联系电话", k: "phone" }, { c: "家庭住址", k: "familyAddress" }, { c: "运营商", k: "operator" }, { c: "套餐费用", k: "planFee" }, { c: "套餐名称", k: "planName" }, { c: "折扣", k: "discount" }, { c: "更换决策人", k: "decider" }, { c: "备注", k: "remark" }]
    : [{ c: "姓名", k: "name" }, { c: "联系电话", k: "phone" }, { c: "运营商", k: "operator" }, { c: "身份证住址", k: "idAddress" }, { c: "装机地址", k: "installAddress" }, { c: "套餐名称", k: "planName" }, { c: "套餐费用", k: "planFee" }, { c: "折扣", k: "discount" }, { c: "小业务", k: "addonServices" }, { c: "备注", k: "remark" }, { c: "协议开始日期", k: "contractStart" }, { c: "协议到期日期", k: "contractEnd" }, { c: "到期状态", k: "status" }, { c: "剩余天数", k: "daysLeft" }];
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [fields.map((f) => esc(f.c)).join(",")];
  for (const r of rows) {
    const dec = type === "portin" ? r : decorate(r);
    lines.push(fields.map((f) => esc(dec[f.k])).join(","));
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename*=UTF-8''" + encodeURIComponent(base + ".csv"));
  res.send("\uFEFF" + lines.join("\r\n"));
});

// ---------------- 超级管理员：全库数据 / 按创建人筛选 / 回收站恢复（v0.0.24） ----------------
// 需求：①超级管理员可查看所有管理员添加的数据（含创建人归属）②可按“哪个管理员添加的”筛选
//      ③管理员/用户删除的数据进入回收站，超级管理员可恢复或彻底删除
function superFilter(rows, q, creator, owner) {
  const k = String(q || "").trim().toLowerCase();
  const cr = String(creator || "").trim();
  const ow = String(owner || "").trim();
  if (k) rows = rows.filter((c) =>
    [c.name, c.phone, c.idAddress, c.installAddress, c.planName, c.addonServices, c.remark, c.operator]
      .some((v) => String(v || "").toLowerCase().includes(k))
  );
  if (cr) rows = rows.filter((c) => String(c.createdBy || "") === cr);
  if (ow) rows = rows.filter((c) => String(c.user || "") === ow);
  return rows;
}

// 全部客户数据（所有用户的全部记录，含创建人/归属用户；默认不含已删除，回收站见 /super/deleted）
api.get("/super/customers", (req, res) => {
  if (!requireSuper(req, res)) return;
  const list = superFilter(readAllCustomers().map(decorate), req.query.q, req.query.creator, req.query.user);
  list.sort((a, b) => (a.daysLeft == null ? 999999 : a.daysLeft) - (b.daysLeft == null ? 999999 : b.daysLeft));
  res.json({ customers: list, total: list.length });
});

// 全部异网用户数据
api.get("/super/portin", (req, res) => {
  if (!requireSuper(req, res)) return;
  let rows = readAllPortin();
  const k = String(req.query.q || "").trim().toLowerCase();
  const cr = String(req.query.creator || "").trim();
  const ow = String(req.query.user || "").trim();
  if (k) rows = rows.filter((c) =>
    [c.phone, c.familyAddress, c.planName, c.decider, c.operator, c.remark]
      .some((v) => String(v || "").toLowerCase().includes(k))
  );
  if (cr) rows = rows.filter((c) => String(c.createdBy || "") === cr);
  if (ow) rows = rows.filter((c) => String(c.user || "") === ow);
  res.json({ portin: rows, total: rows.length });
});

// 筛选维度数据源（创建人 / 归属用户下拉）
api.get("/super/facets", (req, res) => {
  if (!requireSuper(req, res)) return;
  const db = sqliteGet();
  const creators = new Set(), owners = new Set();
  for (const r of db.prepare("SELECT DISTINCT createdBy FROM customers").all()) if (r.createdBy) creators.add(r.createdBy);
  for (const r of db.prepare("SELECT DISTINCT createdBy FROM portin").all()) if (r.createdBy) creators.add(r.createdBy);
  for (const r of db.prepare("SELECT DISTINCT user FROM customers").all()) owners.add(r.user);
  for (const r of db.prepare("SELECT DISTINCT user FROM portin").all()) owners.add(r.user);
  res.json({ creators: [...creators].sort(), owners: [...owners].sort() });
});

// 回收站：已删除的客户 / 异网用户（type=customers|portin|all，默认 all）
api.get("/super/deleted", (req, res) => {
  if (!requireSuper(req, res)) return;
  const type = String(req.query.type || "all");
  const out = [];
  if (type === "all" || type === "customers") out.push(...deletedCustomersRows());
  if (type === "all" || type === "portin") out.push(...deletedPortinRows());
  const k = String(req.query.q || "").trim().toLowerCase();
  if (k) {
    const hit = out.filter((c) =>
      [c.name || "", c.phone, c.familyAddress || "", c.planName || "", c.decider || "", c.remark || "", c.deletedBy || "", c.createdBy || ""]
        .some((v) => String(v || "").toLowerCase().includes(k))
    );
    out.length = 0;
    out.push(...hit);
  }
  res.json({ deleted: out, total: out.length });
});

// 恢复已删除的客户（回到原归属用户的数据中）
api.post("/super/customers/:id/restore", (req, res) => {
  if (!requireSuper(req, res)) return;
  const row = sqliteGet().prepare("SELECT * FROM deleted_customers WHERE id=?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "回收站中不存在该客户记录" });
  const db = sqliteGet();
  db.exec("BEGIN");
  try {
    db.prepare(
      "INSERT INTO customers (id,user,name,phone,idAddress,installAddress,planName,planFee,addonServices,operator,remark,discount,contractStart,contractEnd,createdAt,createdBy) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
    ).run(row.id, row.user, row.name, row.phone, row.idAddress || "", row.installAddress || "", row.planName || "",
      row.planFee, row.addonServices || "", row.operator || "", row.remark || "", row.discount || "",
      row.contractStart || "", row.contractEnd || "", row.createdAt || "", row.createdBy || "");
    db.prepare("DELETE FROM deleted_customers WHERE id=?").run(row.id);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    return res.status(409).json({ error: "恢复失败：该客户 ID 已存在于原用户数据中（" + (e.message || String(e)) + "）" });
  }
  res.json({ ok: true, restored: row.id, user: row.user });
});

// 恢复已删除的异网用户
api.post("/super/portin/:id/restore", (req, res) => {
  if (!requireSuper(req, res)) return;
  const row = sqliteGet().prepare("SELECT * FROM deleted_portin WHERE id=?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "回收站中不存在该异网用户记录" });
  const db = sqliteGet();
  db.exec("BEGIN");
  try {
    db.prepare(
      "INSERT INTO portin (id,user,phone,familyAddress,planName,planFee,decider,operator,remark,discount,createdAt,createdBy) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
    ).run(row.id, row.user, row.phone, row.familyAddress || "", row.planName || "",
      row.planFee, row.decider || "", row.operator || "", row.remark || "", row.discount || "",
      row.createdAt || "", row.createdBy || "");
    db.prepare("DELETE FROM deleted_portin WHERE id=?").run(row.id);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    return res.status(409).json({ error: "恢复失败：该异网用户 ID 已存在于原用户数据中（" + (e.message || String(e)) + "）" });
  }
  res.json({ ok: true, restored: row.id, user: row.user });
});

// 彻底删除（从回收站物理删除，不可恢复，慎用）
api.post("/super/customers/:id/purge", (req, res) => {
  if (!requireSuper(req, res)) return;
  const r = sqliteGet().prepare("DELETE FROM deleted_customers WHERE id=?").run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: "回收站中不存在该记录" });
  res.json({ ok: true, purged: req.params.id });
});

api.post("/super/portin/:id/purge", (req, res) => {
  if (!requireSuper(req, res)) return;
  const r = sqliteGet().prepare("DELETE FROM deleted_portin WHERE id=?").run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: "回收站中不存在该记录" });
  res.json({ ok: true, purged: req.params.id });
});

// ---------------- 管理员：全库数据视图 / 打印 / 删除自建数据（v0.0.25） ----------------
// 需求：管理员可以看到所有数据（全库合并视图，含创建人/归属用户）、可打印；
//      可删除自己添加的数据（自建数据）——软删除进回收站，超级管理员可恢复；
//      其他管理员/用户添加的数据，管理员不可删（需超级管理员处理）。

// 全库客户数据（所有用户的全部记录）
api.get("/admin/all-customers", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const list = superFilter(readAllCustomers().map(decorate), req.query.q, req.query.creator, req.query.user);
  list.sort((a, b) => (a.daysLeft == null ? 999999 : a.daysLeft) - (b.daysLeft == null ? 999999 : b.daysLeft));
  res.json({ customers: list, total: list.length });
});

// 全库异网用户数据
api.get("/admin/all-portin", (req, res) => {
  if (!requireAdmin(req, res)) return;
  let rows = readAllPortin();
  const k = String(req.query.q || "").trim().toLowerCase();
  const cr = String(req.query.creator || "").trim();
  const ow = String(req.query.user || "").trim();
  if (k) rows = rows.filter((c) =>
    [c.phone, c.familyAddress, c.planName, c.decider, c.operator, c.remark]
      .some((v) => String(v || "").toLowerCase().includes(k))
  );
  if (cr) rows = rows.filter((c) => String(c.createdBy || "") === cr);
  if (ow) rows = rows.filter((c) => String(c.user || "") === ow);
  res.json({ portin: rows, total: rows.length });
});

// 全库筛选维度（创建人 / 归属用户下拉）
api.get("/admin/all-facets", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = sqliteGet();
  const creators = new Set(), owners = new Set();
  for (const r of db.prepare("SELECT DISTINCT createdBy FROM customers").all()) if (r.createdBy) creators.add(r.createdBy);
  for (const r of db.prepare("SELECT DISTINCT createdBy FROM portin").all()) if (r.createdBy) creators.add(r.createdBy);
  for (const r of db.prepare("SELECT DISTINCT user FROM customers").all()) owners.add(r.user);
  for (const r of db.prepare("SELECT DISTINCT user FROM portin").all()) owners.add(r.user);
  res.json({ creators: [...creators].sort(), owners: [...owners].sort() });
});

// 删除自建客户数据：仅可删除自己添加的记录（createdBy 与当前身份一致）；超级管理员可删除任意记录
api.delete("/admin/all-customers/:id", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const a = req.auth || {};
  const self = creatorOf(req);
  const row = sqliteGet().prepare("SELECT * FROM customers WHERE id=?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "客户不存在" });
  if (!a.isSuper && String(row.createdBy || "") !== self) {
    return res.status(403).json({ error: "仅可删除自己添加的数据（自建数据）；其他管理员/用户添加的数据如需删除请联系超级管理员" });
  }
  const ok = softDeleteCustomer(row.id, row.user, self);
  if (!ok) return res.status(404).json({ error: "客户不存在" });
  res.json({ deleted: row.id, toRecycle: true });
});

// 删除自建异网数据
api.delete("/admin/all-portin/:id", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const a = req.auth || {};
  const self = creatorOf(req);
  const row = sqliteGet().prepare("SELECT * FROM portin WHERE id=?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "异网用户不存在" });
  if (!a.isSuper && String(row.createdBy || "") !== self) {
    return res.status(403).json({ error: "仅可删除自己添加的数据（自建数据）；其他管理员/用户添加的数据如需删除请联系超级管理员" });
  }
  const ok = softDeletePortin(row.id, row.user, self);
  if (!ok) return res.status(404).json({ error: "异网用户不存在" });
  res.json({ deleted: row.id, toRecycle: true });
});
// === 结束 ===
