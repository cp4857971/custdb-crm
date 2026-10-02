import React, { useEffect, useMemo, useState } from "react";
import {
  listCustomers, getStats, getSettings, ping, setBase, setDataPath, setPort,
  createCustomer, updateCustomer, deleteCustomer, importFile,
  getAdminStatus, listAdminUsers, setAdminView, adminAddAdmin, adminRemoveAdmin,
  adminAnalytics, adminCreate,
  listPortin, getPortinStats, createPortin, updatePortin, deletePortin,
  exportData, saveBlob,
  login, me, logoutLocal, saveLogin, isSuperLocal, isOperatorLocal,
  superChangePassword, superListTempUsers, superCreateTempUser, superDeleteTempUser,
  superSetRequireLogin,
  listLoginUsers, createLoginUser, updateLoginUser, deleteLoginUser,
  listPlans, listAddons, createPlan, deletePlan, createAddon, deleteAddon, detectOperatorApi
} from "./api.js";

const FILTERS = ["全部", "已到期", "30天内到期", "60天内到期", "正常"];

const OPERATORS = ["中国移动", "中国联通", "中国电信"];

const STATUS_STYLE = {
  "已到期": "chip-red",
  "30天内到期": "chip-orange",
  "60天内到期": "chip-yellow",
  "正常": "chip-green",
  "未设置": "chip-gray"
};

const EMPTY_FORM = {
  name: "", phone: "", idAddress: "", installAddress: "",
  planName: "", planFee: "", addonServices: "", operator: "", remark: "", discount: "",
  contractStart: "", contractEnd: ""
};

function daysText(days) {
  if (days == null) return "未设置到期日";
  if (days < 0) return "已过期 " + (-days) + " 天";
  if (days === 0) return "今天到期";
  return "剩余 " + days + " 天";
}

function CustomerCard({ c, onEdit, onDelete }) {
  return (
    <div className="card">
      <div className="card-top">
        <span className="card-name">{c.name}</span>
        <span className={"chip " + (STATUS_STYLE[c.status] || "chip-gray")}>{c.status}</span>
      </div>
      <div className="card-sub">
        <span className="days" data-status={c.status}>{daysText(c.daysLeft)}</span>
        <span className="plan">{c.planName || "未设置套餐"}{c.planFee != null ? " · ¥" + c.planFee + "/月" : ""}</span>
      </div>
      <div className="card-rows">
        <div className="row"><span className="label">联系电话</span><a className="val phone" href={"tel:" + c.phone}>{c.phone}</a></div>
        <div className="row"><span className="label">运营商</span><span className="val">{c.operator || "—"}</span></div>
        <div className="row"><span className="label">套餐费用</span><span className="val">{c.planFee != null ? "¥" + c.planFee + "/月" : "—"}{c.discount ? "（" + c.discount + "）" : ""}</span></div>
        <div className="row"><span className="label">身份证住址</span><span className="val">{c.idAddress || "—"}</span></div>
        <div className="row"><span className="label">装机地址</span><span className="val">{c.installAddress || "—"}</span></div>
        <div className="row"><span className="label">小业务</span><span className="val">{c.addonServices || "—"}</span></div>
        {c.remark ? <div className="row"><span className="label">备注</span><span className="val">{c.remark}</span></div> : null}
        <div className="row"><span className="label">协议到期</span><span className="val">{c.contractEnd || "—"}{c.contractStart ? "（开始 " + c.contractStart + "）" : ""}</span></div>
      </div>
      <div className="card-actions">
        <button className="btn btn-ghost" onClick={() => onEdit(c)}>编辑</button>
        <button className="btn btn-danger-ghost" onClick={() => onDelete(c)}>删除</button>
      </div>
    </div>
  );
}

function StatCard({ label, value, active, onClick }) {
  return (
    <button className={"stat " + (active ? "stat-active" : "")} onClick={onClick}>
      <div className="stat-num">{value}</div>
      <div className="stat-label">{label}</div>
    </button>
  );
}

// 小业务多选器：随运营商过滤候选，库选项勾选 + 自行输入合并（逗号/顿号分隔存储）
function AddonPicker({ value, addons, operator, onChange }) {
  const list = (addons || []).filter((a) => !operator || !a.operator || a.operator === operator);
  const names = list.map((a) => a.name);
  const parts = (value || "").split(/[、,，]/).map((s) => s.trim()).filter(Boolean);
  const checked = parts.filter((p) => names.includes(p));
  const extra = parts.filter((p) => !names.includes(p)).join("、");

  function setParts(checkedArr, extraStr) {
    const all = [
      ...checkedArr,
      ...String(extraStr || "").split(/[、,，]/).map((s) => s.trim()).filter(Boolean)
    ];
    onChange(all.join("、"));
  }

  return (
    <div className="addon-picker">
      {list.length > 0 ? (
        <div className="addon-checks">
          {list.map((a) => (
            <label className="addon-check" key={a.id}>
              <input type="checkbox" checked={checked.includes(a.name)} onChange={(e) => {
                const next = e.target.checked ? [...checked, a.name] : checked.filter((x) => x !== a.name);
                setParts(next, extra);
              }} />
              {a.name}
            </label>
          ))}
        </div>
      ) : null}
      <input className="addon-extra" value={extra} onChange={(e) => setParts(checked, e.target.value)} placeholder="自行输入其他小业务（多个用顿号或逗号分隔）" />
    </div>
  );
}

function FormModal({ initial, onClose, onSave, plans, addons }) {
  const [form, setForm] = useState(initial || EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  // 输入 11 位手机号自动识别运营商（仅当运营商未手动选择时）
  function autoOp(v) {
    const digits = String(v || "").replace(/\D/g, "");
    if (digits.length === 11) {
      detectOperatorApi(digits).then((r) => {
        if (r.operator) setForm((f) => (f.operator ? f : { ...f, operator: r.operator }));
      }).catch(() => {});
    }
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.phone.trim()) {
      setError("姓名和联系电话为必填项");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave(form);
      onClose();
    } catch (err) {
      setError(err.message || "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mask">
      <div className="modal">
        <div className="modal-head">
          <h2>{initial ? "编辑客户" : "新增客户"}</h2>
          <button className="btn btn-ghost" onClick={onClose}>关闭</button>
        </div>
        <form onSubmit={submit}>
          <div className="grid">
            <label>姓名 *<input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="客户姓名" /></label>
            <label>联系电话 *<input value={form.phone} onChange={(e) => { const v = e.target.value; set("phone", v); autoOp(v); }} placeholder="手机号码（自动识别运营商）" inputMode="tel" /></label>
            <label className="full">身份证住址<input value={form.idAddress} onChange={(e) => set("idAddress", e.target.value)} placeholder="证件登记地址" /></label>
            <label className="full">装机地址<input value={form.installAddress} onChange={(e) => set("installAddress", e.target.value)} placeholder="宽带/线路实际安装地址" /></label>
            <label className="full">套餐名称
              <input list="cust-plan-list" value={form.planName} onChange={(e) => set("planName", e.target.value)} placeholder="从套餐业务库选择或自行输入（随运营商过滤）" />
              <datalist id="cust-plan-list">{(plans || []).filter((p) => !form.operator || !p.operator || p.operator === form.operator).map((p) => <option key={p.id} value={p.name} />)}</datalist>
            </label>
            <label>套餐费用（元/月）<input value={form.planFee} onChange={(e) => set("planFee", e.target.value)} placeholder="99" inputMode="decimal" /></label>
            <label>折扣<input value={form.discount} onChange={(e) => set("discount", e.target.value)} placeholder="如：8折、95折、免月租" /></label>
            <label className="full">小业务（可多选，随运营商过滤）
              <AddonPicker value={form.addonServices} addons={addons} operator={form.operator} onChange={(v) => set("addonServices", v)} />
            </label>
            <label className="full">运营商<select value={form.operator} onChange={(e) => set("operator", e.target.value)}>
              <option value="">请选择运营商</option>
              {OPERATORS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select></label>
            <label className="full">备注<input value={form.remark} onChange={(e) => set("remark", e.target.value)} placeholder="备注信息，如：老客户、待续费回访等" /></label>
            <label>协议开始日期<input type="date" value={form.contractStart} onChange={(e) => set("contractStart", e.target.value)} /></label>
            <label>协议到期日期<input type="date" value={form.contractEnd} onChange={(e) => set("contractEnd", e.target.value)} /></label>
          </div>
          {error ? <p className="form-error">{error}</p> : null}
          <div className="modal-foot">
            <button type="button" className="btn btn-ghost" onClick={onClose}>取消</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "保存中…" : "保存"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

const EMPTY_PORTIN = { phone: "", familyAddress: "", planName: "", planFee: "", decider: "", operator: "", remark: "", discount: "" };

function PortinCard({ p, onEdit, onDelete }) {
  return (
    <div className="card card-portin">
      <div className="card-top">
        <span className="card-name">异网用户</span>
        <span className="chip chip-purple">策反目标</span>
      </div>
      <div className="card-rows">
        <div className="row"><span className="label">联系电话</span><a className="val phone" href={"tel:" + p.phone}>{p.phone}</a></div>
        <div className="row"><span className="label">运营商</span><span className="val">{p.operator || "—"}</span></div>
        <div className="row"><span className="label">家庭住址</span><span className="val">{p.familyAddress || "—"}</span></div>
        <div className="row"><span className="label">套餐名称</span><span className="val">{p.planName || "—"}</span></div>
        <div className="row"><span className="label">套餐费用</span><span className="val">{p.planFee != null ? "¥" + p.planFee + "/月" : "—"}{p.discount ? "（" + p.discount + "）" : ""}</span></div>
        <div className="row"><span className="label">更换决策人</span><span className="val">{p.decider || "—"}</span></div>
        {p.remark ? <div className="row"><span className="label">备注</span><span className="val">{p.remark}</span></div> : null}
      </div>
      <div className="card-actions">
        <button className="btn btn-ghost" onClick={() => onEdit(p)}>编辑</button>
        <button className="btn btn-danger-ghost" onClick={() => onDelete(p)}>删除</button>
      </div>
    </div>
  );
}

function PortinFormModal({ initial, onClose, onSave, plans, addons }) {
  const [form, setForm] = useState(initial || EMPTY_PORTIN);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  function autoOp(v) {
    const digits = String(v || "").replace(/\D/g, "");
    if (digits.length === 11) {
      detectOperatorApi(digits).then((r) => {
        if (r.operator) setForm((f) => (f.operator ? f : { ...f, operator: r.operator }));
      }).catch(() => {});
    }
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.phone.trim()) {
      setError("联系电话为必填项");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave(form);
      onClose();
    } catch (err) {
      setError(err.message || "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mask">
      <div className="modal">
        <div className="modal-head">
          <h2>{initial ? "编辑异网用户" : "添加异网用户"}</h2>
          <button className="btn btn-ghost" onClick={onClose}>关闭</button>
        </div>
        <form onSubmit={submit}>
          <div className="grid">
            <label className="full">联系电话 *<input value={form.phone} onChange={(e) => { const v = e.target.value; set("phone", v); autoOp(v); }} placeholder="手机号码（自动识别运营商）" inputMode="tel" /></label>
            <label className="full">家庭住址<input value={form.familyAddress} onChange={(e) => set("familyAddress", e.target.value)} placeholder="用户家庭住址" /></label>
            <label className="full">套餐名称
              <input list="portin-plan-list" value={form.planName} onChange={(e) => set("planName", e.target.value)} placeholder="从套餐业务库选择或自行输入（随运营商过滤）" />
              <datalist id="portin-plan-list">{(plans || []).filter((p) => !form.operator || !p.operator || p.operator === form.operator).map((p) => <option key={p.id} value={p.name} />)}</datalist>
            </label>
            <label className="full">套餐费用（元/月）<input value={form.planFee} onChange={(e) => set("planFee", e.target.value)} placeholder="99" inputMode="decimal" /></label>
            <label className="full">折扣<input value={form.discount} onChange={(e) => set("discount", e.target.value)} placeholder="如：8折、95折、免月租" /></label>
            <label className="full">运营商<select value={form.operator} onChange={(e) => set("operator", e.target.value)}>
              <option value="">请选择运营商</option>
              {OPERATORS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select></label>
            <label className="full">更换决策人<input value={form.decider} onChange={(e) => set("decider", e.target.value)} placeholder="家里谁做主决定换运营商，如：王秀英" /></label>
            <label className="full">备注<input value={form.remark} onChange={(e) => set("remark", e.target.value)} placeholder="备注信息，如：外呼跟进情况等" /></label>
          </div>
          {error ? <p className="form-error">{error}</p> : null}
          <div className="modal-foot">
            <button type="button" className="btn btn-ghost" onClick={onClose}>取消</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "保存中…" : "保存"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ImportModal({ onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [mode, setMode] = useState("append");
  const [itype, setItype] = useState("customers");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (!file) {
      setError("请先选择要导入的文件");
      return;
    }
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const r = await importFile(file, mode, itype);
      setResult(r);
      onDone();
    } catch (err) {
      setError(err.message || "导入失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mask">
      <div className="modal">
        <div className="modal-head">
          <h2>导入数据</h2>
          <button className="btn btn-ghost" onClick={onClose}>关闭</button>
        </div>
        <form onSubmit={submit}>
          <div className="import-hint">
            支持文件格式：<b>CSV / Excel(.xlsx/.xls) / JSON / TXT</b>（逗号、Tab、分号、竖线分隔均可）。
            <br />
            <b>正式客户</b>表头：姓名*、联系电话*、运营商、身份证住址、装机地址、套餐名称、套餐费用、折扣、小业务、备注、协议开始日期、协议到期日期；
            <b>异网用户</b>表头：联系电话*、家庭住址、运营商、套餐费用、套餐名称、折扣、更换决策人、备注。
            <br />
            也可直接回导本应用「导出数据」生成的 JSON / CSV / Excel 文件（自动识别表头，无需改名）。
          </div>
          <label className="f-label">数据类型</label>
          <div className="mode-row">
            <label><input type="radio" name="itype" checked={itype === "customers"} onChange={() => setItype("customers")} /> 正式客户</label>
            <label><input type="radio" name="itype" checked={itype === "portin"} onChange={() => setItype("portin")} /> 异网用户</label>
          </div>
          <input
            type="file"
            className="file-input"
            accept=".csv,.xlsx,.xls,.json,.txt"
            onChange={(e) => { setFile(e.target.files[0] || null); setResult(null); }}
          />
          <div className="mode-row">
            <label><input type="radio" name="mode" checked={mode === "append"} onChange={() => setMode("append")} /> 追加到现有数据</label>
            <label><input type="radio" name="mode" checked={mode === "replace"} onChange={() => setMode("replace")} /> 清空现有数据后导入</label>
          </div>
          {error ? <p className="form-error">{error}</p> : null}
          {result ? (
            <div className="import-result">
              <p className={result.imported > 0 ? "ok-line" : "err-line"}>
                成功导入 <b>{result.imported}</b> 条，跳过 <b>{result.skipped}</b> 条
                {result.type === "portin" ? "（异网用户）" : "（正式客户）"}
                {result.mode === "replace" ? "（已清空原有数据）" : ""}
              </p>
              {(result.errors || []).slice(0, 10).length ? (
                <ul className="err-list">
                  {(result.errors || []).slice(0, 10).map((e2, i) => (
                    <li key={i}>第 {e2.row} 行：{e2.reason}</li>
                  ))}
                </ul>
              ) : null}
              {(result.warnings || []).slice(0, 10).length ? (
                <ul className="warn-list">
                  {(result.warnings || []).slice(0, 10).map((w, i) => (
                    <li key={i}>第 {w.row} 行：{w.reasons.join("、")}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          <div className="modal-foot">
            <button type="button" className="btn btn-ghost" onClick={onClose}>取消</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "导入中…" : "开始导入"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ExportModal({ isAdmin, viewUid, onClose }) {
  const [type, setType] = useState("customers");
  const [format, setFormat] = useState("csv");
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const canAll = isAdmin && !viewUid;

  async function download() {
    setBusy(true);
    setError("");
    try {
      const blob = await exportData(format, type, all);
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-T:]/g, "");
      const scope = all && !viewUid ? "全部用户-" : viewUid ? viewUid + "-" : "";
      const ext = format === "xlsx" ? "xlsx" : format;
      saveBlob(blob, (type === "portin" ? "异网用户-" : "客户资料-") + scope + stamp + "." + ext);
      onClose();
    } catch (err) {
      setError(err.message || "导出失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mask">
      <div className="modal">
        <div className="modal-head">
          <h2>导出数据</h2>
          <button className="btn btn-ghost" onClick={onClose}>关闭</button>
        </div>
        <div className="import-hint">
          导出为 <b>CSV / Excel / JSON</b> 文件，可直接用 Excel、WPS 打开或备份（导出文件可用「导入数据」直接回导）。
          {viewUid ? <><br />当前为管理员视角：导出 <b>{viewUid}</b> 的数据。</> : null}
        </div>
        <label className="f-label">数据类型</label>
        <div className="mode-row">
          <label><input type="radio" name="etype" checked={type === "customers"} onChange={() => setType("customers")} /> 正式客户</label>
          <label><input type="radio" name="etype" checked={type === "portin"} onChange={() => setType("portin")} /> 异网用户</label>
        </div>
        <label className="f-label">文件格式</label>
        <div className="mode-row">
          {[["csv", "CSV（Excel 可直接打开）"], ["xlsx", "Excel 工作簿"], ["json", "JSON（备份/迁移）"]].map(([k, l]) => (
            <label key={k}><input type="radio" name="fmt" checked={format === k} onChange={() => setFormat(k)} /> {l}</label>
          ))}
        </div>
        {canAll ? (
          <>
            <label className="f-label">导出范围</label>
            <div className="mode-row">
              <label><input type="radio" name="scope" checked={!all} onChange={() => setAll(false)} /> 当前用户</label>
              <label><input type="radio" name="scope" checked={all} onChange={() => setAll(true)} /> 全部用户（管理员）</label>
            </div>
          </>
        ) : null}
        {error ? <p className="form-error">{error}</p> : null}
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>取消</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={download}>{busy ? "导出中…" : "下载导出文件"}</button>
        </div>
      </div>
    </div>
  );
}

function SettingsModal({ onClose, onSaved }) {
  const [addr, setAddr] = useState(() => localStorage.getItem("custdb_base") || "");
  const [pathInput, setPathInput] = useState("");
  const [portInput, setPortInput] = useState("");
  const [info, setInfo] = useState(null);
  const [conn, setConn] = useState(null); // null | true | false
  const [checking, setChecking] = useState(false);
  const [savingPath, setSavingPath] = useState(false);
  const [pathMsg, setPathMsg] = useState(null); // {ok:boolean, text:string}
  const [savingPort, setSavingPort] = useState(false);
  const [portMsg, setPortMsg] = useState(null);

  async function check() {
    setChecking(true);
    setConn(null);
    if (addr.trim()) setBase(addr);
    try {
      const ok = await ping();
      setConn(ok);
      if (ok) {
        const s = await getSettings().catch(() => null);
        setInfo(s);
        if (s) {
          setPathInput(s.dataDir);
          setPortInput(String(s.appPort != null ? s.appPort : ""));
        }
      }
    } catch (e) {
      setConn(false);
    } finally {
      setChecking(false);
    }
  }

  async function savePath() {
    const d = pathInput.trim();
    if (!d) {
      setPathMsg({ ok: false, text: "请输入数据路径" });
      return;
    }
    setSavingPath(true);
    setPathMsg(null);
    try {
      const r = await setDataPath(d);
      setPathMsg({ ok: true, text: "已保存到配置文件，重启应用后生效（应用中心可重启）" });
      setInfo((prev) => (prev ? Object.assign({}, prev, { dataDir: r.dataDir, dataDirSource: "config" }) : prev));
    } catch (e) {
      setPathMsg({ ok: false, text: e.message || "保存失败" });
    } finally {
      setSavingPath(false);
    }
  }

  async function savePort() {
    const p = Number(portInput);
    if (!Number.isInteger(p) || p < 1 || p > 65535) {
      setPortMsg({ ok: false, text: "端口须为 1-65535 的整数" });
      return;
    }
    setSavingPort(true);
    setPortMsg(null);
    try {
      const r = await setPort(p);
      setPortMsg({ ok: true, text: "已保存到配置文件，重启应用后生效（应用中心可重启）" });
      setInfo((prev) => (prev ? Object.assign({}, prev, { appPort: r.port, appPortSource: "config" }) : prev));
    } catch (e) {
      setPortMsg({ ok: false, text: e.message || "保存失败" });
    } finally {
      setSavingPort(false);
    }
  }

  function save() {
    if (addr.trim()) setBase(addr);
    else setBase("");
    onSaved();
  }

  return (
    <div className="mask">
      <div className="modal">
        <div className="modal-head">
          <h2>连接与存储设置</h2>
          <button className="btn btn-ghost" onClick={onClose}>关闭</button>
        </div>
        <div className="import-hint">
          手机端与电脑端访问<b>同一台 NAS、同一份数据</b>：填写 NAS 上飞牛系统的应用网关地址，
          例如 <code>http://192.168.1.100:5666/app/custdb</code> 或
          <code> https://nas.example.com/app/custdb</code>。留空则使用当前网页同源地址。
        </div>
        <div className="import-result">
          <p>📱 <b>安卓手机 APP</b>：① 手机浏览器打开本应用 → 菜单「<b>添加到主屏幕</b>」即可生成桌面图标（无需安装 APK）；
          ② 也可用「安卓APP工程.zip」在 Android Studio 构建独立 APK。两者都连同一台 NAS、同一份数据。</p>
        </div>
        <label className="f-label">服务器地址</label>
        <input
          className="f-input"
          placeholder="/app/custdb"
          value={addr}
          onChange={(e) => setAddr(e.target.value)}
        />
        {conn === true ? <p className="ok-line">✓ 已连接服务器</p> : null}
        {conn === false ? <p className="err-line">✗ 无法连接，请检查地址与网络</p> : null}
        {info ? (
          <div className="import-result">
            <p>数据存储：<b>SQLite 数据库</b>（零外部依赖，适合大数据量）</p>
            <p className="small-muted">当前数据路径：{info.dataDir}
              {info.dataDirSource === "config" ? "（配置文件自定义）" : "（系统默认）"}
            </p>
            <p className="small-muted">数据库文件：<code>{info.dbFile}</code></p>
            {info.appFileDir ? (
              <p className="small-muted">默认应用文件区：<code>{info.appFileDir}</code>（文件管理 → 应用文件 → custdb/data）</p>
            ) : null}
            <label className="f-label">自定义数据路径（绝对路径，重启后生效）</label>
            <input
              className="f-input"
              placeholder="如 /var/apps/custdb/share/data/备份A 或 /vol1/存储空间1/custdb-data"
              value={pathInput}
              onChange={(e) => { setPathInput(e.target.value); setPathMsg(null); }}
            />
            {pathMsg ? (
              <p className={pathMsg.ok ? "ok-line" : "err-line"}>{pathMsg.text}</p>
            ) : null}
            <p className="small-muted">
              可填：① 应用文件区内的子目录（一定可写）；② 存储卷/共享文件夹路径（需在文件管理中对该文件夹授予应用用户写权限，保存时会自动校验）。
              也可直接编辑 <code>{info.configFile}</code> 的 <code>dataDir</code> 字段，或用环境变量 <code>DATA_DIR</code> 指定。
            </p>
            <div className="modal-foot-inline">
              <button type="button" className="btn btn-ghost" disabled={savingPath} onClick={savePath}>
                {savingPath ? "保存中…" : "保存数据路径"}
              </button>
            </div>

            <label className="f-label">服务端口（TCP，重启后生效）</label>
            <div className="form-row">
              <input
                className="f-input"
                placeholder={info.appPort != null ? "当前：" + info.appPort + "（默认 5001）" : "默认 5001"}
                value={portInput}
                onChange={(e) => { setPortInput(e.target.value); setPortMsg(null); }}
              />
              <button type="button" className="btn btn-ghost" disabled={savingPort} onClick={savePort}>
                {savingPort ? "保存中…" : "保存端口"}
              </button>
            </div>
            {portMsg ? (
              <p className={portMsg.ok ? "ok-line" : "err-line"}>{portMsg.text}</p>
            ) : null}
            <p className="small-muted">
              经飞牛网关访问（/app/custdb）无需端口；该端口仅用于<b>局域网直连</b>（http://NAS内网IP:端口/app/custdb）或
              <b>隧道映射</b>（frpc / NPC / cloudflared / 节点小宝 等把外网访问转发到该端口）。修改后需在应用中心重启应用生效。
            </p>
          </div>
        ) : null}
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>取消</button>
          <button type="button" className="btn btn-ghost" disabled={checking} onClick={check}>{checking ? "检测中…" : "测试连接"}</button>
          <button type="button" className="btn btn-primary" onClick={save}>保存并重连</button>
        </div>
      </div>
    </div>
  );
}

function AdminModal({ currentAdmins, onClose, onView, onAdminsChanged, isSuper }) {
  const [tab, setTab] = useState("users"); // users | plans | contract | library | system
  const [users, setUsers] = useState([]);
  const [admins, setAdmins] = useState(currentAdmins || []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [newAdmin, setNewAdmin] = useState("");
  const [anaUid, setAnaUid] = useState(""); // "" = 全部用户
  const [ana, setAna] = useState(null);
  const [addFor, setAddFor] = useState(null); // {uid} 触发该用户的新增表单

  // ---- 套餐业务库 / 小业务库（v0.0.23） ----
  const [libPlans, setLibPlans] = useState([]);
  const [libAddons, setLibAddons] = useState([]);
  const [libBusy, setLibBusy] = useState(false);
  const [libMsg, setLibMsg] = useState(null);
  const [libSubTab, setLibSubTab] = useState("plans"); // plans | addons
  const [planForm, setPlanForm] = useState({ name: "", category: "家庭融合", fee: "", operator: "中国移动" });
  const [addonForm, setAddonForm] = useState({ name: "", operator: "中国移动" });

  // ---- 系统设置（仅超管） ----
  const [tempUsers, setTempUsers] = useState([]);
  const [tempForm, setTempForm] = useState({ username: "", password: "", uid: "", days: 1, note: "" });
  const [tempMsg, setTempMsg] = useState(null);
  const [pwForm, setPwForm] = useState({ old: "", next: "" });
  const [pwMsg, setPwMsg] = useState(null);
  const [requireLogin, setRequireLogin] = useState(null);
  const [rlMsg, setRlMsg] = useState(null);
  const [rlBusy, setRlBusy] = useState(false);
  // ---- 正式登录用户（角色：admin 管理员 / operator 操作员） ----
  const [loginUsers, setLoginUsers] = useState([]);
  const [luForm, setLuForm] = useState({ username: "", password: "", uid: "", note: "", role: "admin" });
  const [luMsg, setLuMsg] = useState(null);
  const [luBusy, setLuBusy] = useState(false);
  const [luEdit, setLuEdit] = useState(null); // {username, uid, note, password?, role?}

  async function load() {
    setBusy(true);
    setError("");
    try {
      const r = await listAdminUsers();
      setUsers(r.users || []);
      setAdmins(r.admins || []);
    } catch (e) {
      setError(e.message || "加载用户列表失败");
    } finally {
      setBusy(false);
    }
  }

  async function loadTempUsers() {
    try {
      const r = await superListTempUsers();
      setTempUsers(r.users || []);
    } catch (e) { setError(e.message || "加载临时用户失败"); }
  }

  async function loadRequireLogin() {
    try {
      const s = await getSettings();
      setRequireLogin(!!s.requireLogin);
    } catch (e) { /* 忽略 */ }
  }

  async function loadLoginUsers() {
    try {
      const r = await listLoginUsers();
      setLoginUsers(r.users || []);
    } catch (e) { setError(e.message || "加载登录用户失败"); }
  }

  async function saveLoginUser(ev) {
    ev && ev.preventDefault();
    setLuBusy(true);
    setLuMsg(null);
    try {
      const u = {
        username: luForm.username.trim(),
        password: luForm.password,
        uid: luForm.uid.trim() || luForm.username.trim(),
        note: luForm.note.trim(),
        role: luForm.role === "operator" ? "operator" : "admin"
      };
      if (!u.username || !u.password) { setLuMsg({ ok: false, text: "用户名与密码必填" }); setLuBusy(false); return; }
      await createLoginUser(u);
      setLuMsg({ ok: true, text: "登录用户已创建（立即生效，可登录使用）" });
      setLuForm({ username: "", password: "", uid: "", note: "", role: "admin" });
      loadLoginUsers();
    } catch (err) {
      setLuMsg({ ok: false, text: err.message });
    } finally {
      setLuBusy(false);
    }
  }

  async function saveLuEdit() {
    if (!luEdit) return;
    setLuBusy(true);
    setLuMsg(null);
    try {
      const patch = {};
      if (luEdit.password) {
        if (luEdit.password.length < 6) { setLuMsg({ ok: false, text: "密码至少 6 位" }); setLuBusy(false); return; }
        patch.password = luEdit.password;
      }
      patch.uid = luEdit.uid.trim();
      patch.note = luEdit.note.trim();
      patch.role = luEdit.role === "operator" ? "operator" : "admin";
      await updateLoginUser(luEdit.username, patch);
      setLuMsg({ ok: true, text: "已更新（立即生效）" });
      setLuEdit(null);
      loadLoginUsers();
    } catch (err) {
      setLuMsg({ ok: false, text: err.message });
    } finally {
      setLuBusy(false);
    }
  }

  async function toggleLuDisabled(u) {
    try {
      await updateLoginUser(u.username, { disabled: !u.disabled });
      loadLoginUsers();
    } catch (e) { setError(e.message || "操作失败"); }
  }

  async function removeLoginUser(u) {
    if (!window.confirm("确定删除登录用户「" + u.username + "」？该账号将无法再登录。")) return;
    try {
      await deleteLoginUser(u.username);
      loadLoginUsers();
    } catch (e) { setError(e.message || "删除失败"); }
  }

  async function loadAnalytics(uid) {
    setBusy(true);
    setError("");
    try {
      const r = await adminAnalytics(uid);
      setAna(r);
    } catch (e) {
      setError(e.message || "加载统计失败");
    } finally {
      setBusy(false);
    }
  }

  async function loadLibrary() {
    setLibBusy(true);
    try {
      const [p, a] = await Promise.all([listPlans(), listAddons()]);
      setLibPlans(p.plans || []);
      setLibAddons(a.addons || []);
    } catch (e) {
      setError(e.message || "加载套餐业务库失败");
    } finally {
      setLibBusy(false);
    }
  }

  async function addPlan(ev) {
    ev.preventDefault();
    if (!planForm.name.trim()) { setLibMsg({ ok: false, text: "套餐名称不能为空" }); return; }
    setLibBusy(true); setLibMsg(null);
    try {
      await createPlan(planForm);
      setLibMsg({ ok: true, text: "套餐已添加" });
      setPlanForm({ name: "", category: "家庭融合", fee: "", operator: planForm.operator || "中国移动" });
      loadLibrary();
    } catch (e) { setLibMsg({ ok: false, text: e.message || "添加失败" }); setLibBusy(false); }
  }

  async function delPlan(id, name) {
    if (!window.confirm("确定删除套餐「" + name + "」？")) return;
    setLibBusy(true); setLibMsg(null);
    try {
      await deletePlan(id);
      setLibMsg({ ok: true, text: "套餐已删除" });
      loadLibrary();
    } catch (e) { setLibMsg({ ok: false, text: e.message || "删除失败" }); setLibBusy(false); }
  }

  async function addAddon(ev) {
    ev.preventDefault();
    if (!addonForm.name.trim()) { setLibMsg({ ok: false, text: "小业务名称不能为空" }); return; }
    setLibBusy(true); setLibMsg(null);
    try {
      await createAddon(addonForm);
      setLibMsg({ ok: true, text: "小业务已添加" });
      setAddonForm({ name: "", operator: addonForm.operator || "中国移动" });
      loadLibrary();
    } catch (e) { setLibMsg({ ok: false, text: e.message || "添加失败" }); setLibBusy(false); }
  }

  async function delAddon(id, name) {
    if (!window.confirm("确定删除小业务「" + name + "」？")) return;
    setLibBusy(true); setLibMsg(null);
    try {
      await deleteAddon(id);
      setLibMsg({ ok: true, text: "小业务已删除" });
      loadLibrary();
    } catch (e) { setLibMsg({ ok: false, text: e.message || "删除失败" }); setLibBusy(false); }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (tab === "system") { loadTempUsers(); loadRequireLogin(); loadLoginUsers(); }
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (tab === "plans" || tab === "contract") loadAnalytics(anaUid || "");
    if (tab === "library") loadLibrary();
  }, [tab, anaUid]); // eslint-disable-line react-hooks/exhaustive-deps

  async function addAdmin(e) {
    e.preventDefault();
    const name = newAdmin.trim();
    if (!name) return;
    setBusy(true);
    setError("");
    try {
      const r = await adminAddAdmin(name);
      setAdmins(r.admins || []);
      setNewAdmin("");
      onAdminsChanged();
    } catch (err) {
      setError(err.message || "操作失败");
    } finally {
      setBusy(false);
    }
  }

  async function removeAdmin(name) {
    if (!window.confirm("确定移除管理员「" + name + "」？")) return;
    setBusy(true);
    setError("");
    try {
      const r = await adminRemoveAdmin(name);
      setAdmins(r.admins || []);
      onAdminsChanged();
    } catch (err) {
      setError(err.message || "操作失败");
    } finally {
      setBusy(false);
    }
  }

  async function saveNewCustomer(uid, form) {
    try {
      await adminCreate(uid, form);
      await Promise.all([load(), loadAnalytics(anaUid || "")]);
    } finally { /* 错误由 FormModal 捕获提示 */ }
  }

  const maxMonth = ana && ana.byMonth.length ? Math.max(1, ...ana.byMonth.map((m) => m.count)) : 1;

  return (
    <div className="mask">
      <div className="modal modal-lg">
        <div className="modal-head">
          <h2>管理（管理员）</h2>
          <button className="btn btn-ghost" onClick={onClose}>关闭</button>
        </div>

        <div className="admin-tabs">
          {[
            ["users", "用户管理"],
            ["plans", "套餐统计"],
            ["contract", "协议统计"],
            ["library", "套餐业务库"],
            ...(isSuper ? [["system", "系统设置"]] : [])
          ].map(([k, label]) => (
            <button key={k} className={"admin-tab " + (tab === k ? "admin-tab-active" : "")} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </div>

        {error ? <p className="form-error">{error}</p> : null}

        {tab === "users" ? (
          <>
            <div className="import-hint">
              管理员可查看/管理<b>所有 NAS 用户</b>的客户资料：每行可「添加客户」（直接给该用户建档）或「查看」（进入该用户列表，可编辑/删除/导入）。
              管理员名单保存在数据目录 <code>config.json</code> 的 <code>admins</code> 字段；首个使用应用的用户自动成为管理员。
            </div>
            <h3 className="admin-h3">用户与自动统计（客户数 / 到期分布）</h3>
            {busy && users.length === 0 ? <div className="empty">加载中…</div> : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>NAS 用户</th><th>客户数</th><th>已到期</th><th>30天内</th><th>60天内</th><th>正常</th><th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.length === 0 ? (
                      <tr><td colSpan="7" className="empty">暂无用户数据</td></tr>
                    ) : (
                      users.map((u) => (
                        <tr key={u.uid}>
                          <td><b>{u.uid}</b></td>
                          <td>{u.total}</td>
                          <td className={u.expired ? "num-warn" : ""}>{u.expired}</td>
                          <td className={u.due30 ? "num-warn" : ""}>{u.due30}</td>
                          <td>{u.due60}</td>
                          <td>{u.normal}</td>
                          <td>
                            <span className="row-ops">
                              <button className="btn btn-sm btn-primary" onClick={() => setAddFor({ uid: u.uid })}>添加客户</button>
                              <button className="btn btn-sm btn-ghost" onClick={() => { onView(u.uid); onClose(); }}>查看</button>
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}

            <h3 className="admin-h3">管理员名单</h3>
            <div className="admin-list">
              {admins.map((a) => (
                <span className="admin-chip" key={a}>
                  {a}
                  <button className="btn btn-sm btn-danger-ghost" disabled={busy} onClick={() => removeAdmin(a)}>移除</button>
                </span>
              ))}
              {admins.length === 0 ? <span className="small-muted">暂无管理员</span> : null}
            </div>
            <form className="admin-add" onSubmit={addAdmin}>
              <input
                className="f-input"
                placeholder="输入 NAS 用户名，如 zhangsan"
                value={newAdmin}
                onChange={(e) => setNewAdmin(e.target.value)}
              />
              <button type="submit" className="btn btn-primary" disabled={busy}>添加管理员</button>
            </form>
          </>
        ) : null}

        {tab === "plans" || tab === "contract" ? (
          <>
            <div className="ana-uid-row">
              <label className="f-label">统计范围</label>
              <select className="f-input" value={anaUid} onChange={(e) => setAnaUid(e.target.value)}>
                <option value="">全部用户合计</option>
                {users.map((u) => <option key={u.uid} value={u.uid}>{u.uid}</option>)}
              </select>
            </div>

            {busy && !ana ? <div className="empty">加载中…</div> : null}

            {tab === "contract" && ana ? (
              <>
                <h3 className="admin-h3">自动统计（到期状态分布）</h3>
                <div className="ana-cards">
                  {[["总客户", ana.stats.total], ["已到期", ana.stats.expired], ["30天内", ana.stats.due30], ["60天内", ana.stats.due60], ["正常", ana.stats.normal], ["未设置", ana.stats.unset]].map(([l, v]) => (
                    <div className={"ana-card " + (v && (l === "已到期" || l === "30天内" || l === "60天内") ? "ana-card-warn" : "")} key={l}>
                      <div className="ana-num">{v}</div>
                      <div className="ana-label">{l}</div>
                    </div>
                  ))}
                </div>
                <h3 className="admin-h3">协议统计（未来 12 个月到期分布）</h3>
                <div className="ana-bars">
                  {ana.byMonth.map((m) => (
                    <div className="ana-bar-row" key={m.month}>
                      <span className="ana-bar-label">{m.month.replace("-", "/")}</span>
                      <div className="ana-bar-track"><div className="ana-bar" style={{ width: (m.count / maxMonth * 100) + "%" }} /></div>
                      <span className="ana-bar-num">{m.count}</span>
                    </div>
                  ))}
                </div>
                <p className="small-muted">
                  已过期（到期日早于今天）：<b className="num-warn">{ana.overdue}</b> 户 · 未设置到期日：<b>{ana.unset}</b> 户
                </p>
              </>
            ) : null}

            {tab === "plans" && ana ? (
              <>
                <h3 className="admin-h3">按套餐统计（客户数 / 费用 / 到期）</h3>
                {ana.byPlan.length === 0 ? (
                  <div className="empty">暂无数据</div>
                ) : (
                  <div className="admin-table-wrap">
                    <table className="admin-table">
                      <thead>
                        <tr><th>套餐名称</th><th>客户数</th><th>月费合计(元)</th><th>平均月费(元)</th><th>已到期</th></tr>
                      </thead>
                      <tbody>
                        {ana.byPlan.map((p, i) => (
                          <tr key={i}>
                            <td><b>{p.plan}</b></td>
                            <td>{p.count}</td>
                            <td>{p.feeTotal}</td>
                            <td>{p.feeAvg}</td>
                            <td className={p.expired ? "num-warn" : ""}>{p.expired}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            ) : null}
          </>
        ) : null}

        {tab === "library" ? (
          <>
            <div className="import-hint">
              管理<b>套餐业务库</b>与<b>小业务库</b>：内置项（标注「内置」）为四川省内常见资费参考，不可删除；
              没有的套餐 / 小业务可<b>自行添加</b>，添加后全库（正式客户、异网用户）表单均可选用。
            </div>
            <div className="lib-subtabs">
              <button className={"btn btn-sm " + (libSubTab === "plans" ? "btn-primary" : "btn-ghost")} onClick={() => setLibSubTab("plans")}>套餐库（{libPlans.length}）</button>
              <button className={"btn btn-sm " + (libSubTab === "addons" ? "btn-primary" : "btn-ghost")} onClick={() => setLibSubTab("addons")}>小业务库（{libAddons.length}）</button>
            </div>
            {libMsg ? <p className={"form-error " + (libMsg.ok ? "ok-line" : "")}>{libMsg.text}</p> : null}

            {libSubTab === "plans" ? (
              <>
                <form className="admin-add" onSubmit={addPlan}>
                  <input className="f-input" placeholder="套餐名称（必填）" value={planForm.name}
                    onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })} />
                  <select className="f-input f-select" value={planForm.category}
                    onChange={(e) => setPlanForm({ ...planForm, category: e.target.value })}>
                    {["家庭融合", "E家融合", "单卡"].map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <input className="f-input" placeholder="月费（元）" inputMode="decimal" value={planForm.fee}
                    onChange={(e) => setPlanForm({ ...planForm, fee: e.target.value })} />
                  <select className="f-input f-select" value={planForm.operator}
                    onChange={(e) => setPlanForm({ ...planForm, operator: e.target.value })}>
                    {OPERATORS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                  <button type="submit" className="btn btn-primary" disabled={libBusy}>添加套餐</button>
                </form>
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr><th>套餐名称</th><th>类别</th><th>月费（元）</th><th>运营商</th><th>来源</th><th>操作</th></tr>
                    </thead>
                    <tbody>
                      {libPlans.length === 0 ? (
                        <tr><td colSpan="6" className="empty">暂无套餐（首次使用会自动内置参考套餐）</td></tr>
                      ) : libPlans.map((p) => (
                        <tr key={p.id}>
                          <td>{p.name}</td>
                          <td>{p.category || "—"}</td>
                          <td>{p.fee != null ? p.fee : "—"}</td>
                          <td>{p.operator || "—"}</td>
                          <td>{p.builtin ? <span className="chip chip-gray">内置</span> : <span className="chip chip-green">自定义</span>}</td>
                          <td>{p.builtin ? <span className="small-muted">不可删</span> : <button className="btn btn-sm btn-danger-ghost" disabled={libBusy} onClick={() => delPlan(p.id, p.name)}>删除</button>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <>
                <form className="admin-add" onSubmit={addAddon}>
                  <input className="f-input" placeholder="小业务名称（必填），如：云盘、云监控、路由器" value={addonForm.name}
                    onChange={(e) => setAddonForm({ ...addonForm, name: e.target.value })} />
                  <select className="f-input f-select" value={addonForm.operator}
                    onChange={(e) => setAddonForm({ ...addonForm, operator: e.target.value })}>
                    {OPERATORS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                  <button type="submit" className="btn btn-primary" disabled={libBusy}>添加小业务</button>
                </form>
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr><th>小业务名称</th><th>运营商</th><th>来源</th><th>操作</th></tr>
                    </thead>
                    <tbody>
                      {libAddons.length === 0 ? (
                        <tr><td colSpan="4" className="empty">暂无小业务（首次使用会自动内置参考选项）</td></tr>
                      ) : libAddons.map((a) => (
                        <tr key={a.id}>
                          <td>{a.name}</td>
                          <td>{a.operator || "—"}</td>
                          <td>{a.builtin ? <span className="chip chip-gray">内置</span> : <span className="chip chip-green">自定义</span>}</td>
                          <td>{a.builtin ? <span className="small-muted">不可删</span> : <button className="btn btn-sm btn-danger-ghost" disabled={libBusy} onClick={() => delAddon(a.id, a.name)}>删除</button>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        ) : null}

        {(isSuper || isAdmin) && tab === "system" ? (
          <>
            {isSuper ? (
              <>
            <h3 className="admin-h3">⓪ 严格登录验证（所有用户需登录）</h3>
            <div className="import-hint">
              开启后：<b>所有用户（含管理员）都必须账号密码登录</b>才能访问，公网隧道/匿名一律 401 并弹登录框；
              管理员不再凭 NAS 身份自动放行，需由超管在「用户管理」添加管理员并创建登录账号。默认<b>开启</b>。
              关闭后回到兼容模式：NAS 用户自动识别、首个使用者自动成为管理员。
            </div>
            <div className="form-row">
              <button
                className={"btn " + (requireLogin ? "btn-primary" : "btn-ghost")}
                disabled={rlBusy || requireLogin == null}
                onClick={async () => {
                  setRlBusy(true);
                  setRlMsg(null);
                  try {
                    const r = await superSetRequireLogin(!requireLogin);
                    setRequireLogin(!!r.requireLogin);
                    setRlMsg({ ok: true, text: r.message + "（立即生效）" });
                  } catch (err) {
                    setRlMsg({ ok: false, text: err.message });
                  } finally {
                    setRlBusy(false);
                  }
                }}
              >
                {rlBusy ? "处理中…" : requireLogin ? "已开启严格登录（点击关闭）" : "已关闭（点击开启）"}
              </button>
              {rlMsg ? <p className={rlMsg.ok ? "ok-line" : "err-line"}>{rlMsg.text}</p> : null}
            </div>

            <h3 className="admin-h3">① 超级管理员（默认 admin）</h3>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>用户名</th><th>权限</th><th>初始密码</th><th>说明</th></tr></thead>
                <tbody>
                  <tr>
                    <td><b>admin</b></td>
                    <td>超级管理员（可删除管理员、管理临时访问用户、隧道访问指引）</td>
                    <td><code>admin</code></td>
                    <td>建议首次登录后立即修改</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <form onSubmit={async (e) => {
              e.preventDefault();
              setPwMsg(null);
              try {
                await superChangePassword(pwForm.old, pwForm.next);
                setPwMsg({ ok: true, text: "密码已更新（下次登录生效）" });
                setPwForm({ old: "", next: "" });
              } catch (err) {
                setPwMsg({ ok: false, text: err.message });
              }
            }}>
              <div className="form-row">
                <input className="f-input" type="password" placeholder="原密码" value={pwForm.old} onChange={(e) => setPwForm({ ...pwForm, old: e.target.value })} />
                <input className="f-input" type="password" placeholder="新密码（至少 6 位）" value={pwForm.next} onChange={(e) => setPwForm({ ...pwForm, next: e.target.value })} />
                <button className="btn btn-primary" type="submit">修改密码</button>
              </div>
              {pwMsg ? <p className={pwMsg.ok ? "ok-line" : "err-line"}>{pwMsg.text}</p> : null}
            </form>
              </>
            ) : null}

            <h3 className="admin-h3">② 正式登录用户（长期有效账号）</h3>
            <div className="import-hint">
              给员工 / 店员 / 家庭成员开<b>正式登录账号</b>（用户名 + 密码，长期有效），角色二选一：
              <b>管理员</b>（绑定数据 + 进入「管理」页跨用户操作）或
              <b>操作员</b>（只能增删改查、导入导出<b>自己绑定数据</b>的客户资料，不显示管理入口、无法跨用户/进管理）。
              所有用户登录验证模式下，员工均通过此类账号访问。
            </div>
            {luEdit ? (
              <div className="lu-edit">
                <p className="small-muted">编辑登录用户：<b>{luEdit.username}</b>（密码留空表示不修改）</p>
                <div className="form-row">
                  <input className="f-input" placeholder="绑定数据用户（NAS 用户名）" value={luEdit.uid} onChange={(e) => setLuEdit({ ...luEdit, uid: e.target.value })} />
                  <input className="f-input" type="password" placeholder="新密码（至少 6 位，留空不改）" value={luEdit.password || ""} onChange={(e) => setLuEdit({ ...luEdit, password: e.target.value })} />
                  <select className="f-input f-select" value={luEdit.role === "operator" ? "operator" : "admin"} onChange={(e) => setLuEdit({ ...luEdit, role: e.target.value })}>
                    <option value="admin">角色：管理员</option>
                    <option value="operator">角色：操作员</option>
                  </select>
                </div>
                <div className="form-row">
                  <input className="f-input" placeholder="备注" value={luEdit.note} onChange={(e) => setLuEdit({ ...luEdit, note: e.target.value })} />
                  <button className="btn btn-primary" disabled={luBusy} onClick={saveLuEdit}>{luBusy ? "保存中…" : "保存修改"}</button>
                  <button className="btn btn-ghost" onClick={() => setLuEdit(null)}>取消</button>
                </div>
                {luMsg ? <p className={luMsg.ok ? "ok-line" : "err-line"}>{luMsg.text}</p> : null}
              </div>
            ) : (
              <form onSubmit={saveLoginUser}>
                <div className="temp-grid">
                  <input className="f-input" placeholder="登录用户名（如 zhangsan）" value={luForm.username} onChange={(e) => setLuForm({ ...luForm, username: e.target.value })} />
                  <input className="f-input" placeholder="登录密码（至少 6 位）" value={luForm.password} onChange={(e) => setLuForm({ ...luForm, password: e.target.value })} />
                  <input className="f-input" placeholder="绑定数据用户（留空=同名）" value={luForm.uid} onChange={(e) => setLuForm({ ...luForm, uid: e.target.value })} />
                </div>
                <div className="form-row">
                  <select className="f-input f-select" value={luForm.role} onChange={(e) => setLuForm({ ...luForm, role: e.target.value })}>
                    <option value="admin">角色：管理员（可进管理页）</option>
                    <option value="operator">角色：操作员（仅本数据增删改查/导入导出）</option>
                  </select>
                  <input className="f-input" placeholder="备注（如：前台小李）" value={luForm.note} onChange={(e) => setLuForm({ ...luForm, note: e.target.value })} />
                  <button className="btn btn-primary" type="submit" disabled={luBusy}>{luBusy ? "创建中…" : "创建登录用户"}</button>
                </div>
                {luMsg ? <p className={luMsg.ok ? "ok-line" : "err-line"}>{luMsg.text}</p> : null}
              </form>
            )}
            {loginUsers.length === 0 ? (
              <div className="empty">暂无正式登录用户（员工将无法登录）</div>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead><tr><th>用户名</th><th>角色</th><th>绑定数据用户</th><th>备注</th><th>状态</th><th></th></tr></thead>
                  <tbody>
                    {loginUsers.map((u) => (
                      <tr key={u.username}>
                        <td><b>{u.username}</b></td>
                        <td>{u.role === "operator" ? <span className="chip chip-gray">操作员</span> : <span className="chip chip-green">管理员</span>}</td>
                        <td>{u.uid}</td>
                        <td>{u.note}</td>
                        <td>{u.disabled ? <span className="num-warn">已停用</span> : <span className="ok-line">正常</span>}</td>
                        <td className="row-actions">
                          <button className="btn btn-ghost" onClick={() => { setLuEdit({ username: u.username, uid: u.uid, note: u.note, password: "", role: u.role === "operator" ? "operator" : "admin" }); setLuMsg(null); }}>编辑</button>
                          <button className="btn btn-ghost" onClick={() => toggleLuDisabled(u)}>{u.disabled ? "启用" : "停用"}</button>
                          <button className="btn btn-danger" onClick={() => removeLoginUser(u)}>删除</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {isSuper ? (
              <>
            <h3 className="admin-h3">③ 临时访问用户（限时账号，到期自动失效）</h3>
            <div className="import-hint">
              给访客 / 外勤 / 合作方开一个<b>限时登录账号</b>：登录后只能看到<b>指定数据用户</b>的正式客户与异网用户，不能进入管理。到期自动失效并清理。
            </div>
            <form onSubmit={async (e) => {
              e.preventDefault();
              setTempMsg(null);
              if (!tempForm.username.trim() || !tempForm.password) { setTempMsg({ ok: false, text: "用户名与密码必填" }); return; }
              try {
                await superCreateTempUser({
                  username: tempForm.username.trim(),
                  password: tempForm.password,
                  uid: tempForm.uid.trim() || tempForm.username.trim(),
                  days: Number(tempForm.days) || 1,
                  note: tempForm.note.trim()
                });
                setTempMsg({ ok: true, text: "临时用户已创建（立即生效）" });
                setTempForm({ username: "", password: "", uid: "", days: 1, note: "" });
                loadTempUsers();
              } catch (err) {
                setTempMsg({ ok: false, text: err.message });
              }
            }}>
              <div className="temp-grid">
                <input className="f-input" placeholder="登录用户名（如 visit01）" value={tempForm.username} onChange={(e) => setTempForm({ ...tempForm, username: e.target.value })} />
                <input className="f-input" placeholder="登录密码（至少 4 位）" value={tempForm.password} onChange={(e) => setTempForm({ ...tempForm, password: e.target.value })} />
                <input className="f-input" placeholder="绑定数据用户（NAS 用户名，留空=同名）" value={tempForm.uid} onChange={(e) => setTempForm({ ...tempForm, uid: e.target.value })} />
                <input className="f-input" type="number" min="1" max="365" placeholder="有效期（天）" value={tempForm.days} onChange={(e) => setTempForm({ ...tempForm, days: e.target.value })} />
              </div>
              <div className="form-row">
                <input className="f-input" placeholder="备注（如：给王经理的临时查看账号）" value={tempForm.note} onChange={(e) => setTempForm({ ...tempForm, note: e.target.value })} />
                <button className="btn btn-primary" type="submit">创建临时用户</button>
              </div>
              {tempMsg ? <p className={tempMsg.ok ? "ok-line" : "err-line"}>{tempMsg.text}</p> : null}
            </form>
            {tempUsers.length === 0 ? (
              <div className="empty">暂无临时访问用户</div>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead><tr><th>用户名</th><th>绑定数据用户</th><th>到期时间</th><th>备注</th><th></th></tr></thead>
                  <tbody>
                    {tempUsers.map((t) => (
                      <tr key={t.username}>
                        <td><b>{t.username}</b></td>
                        <td>{t.uid}</td>
                        <td className="num-warn">{new Date(t.expireAt).toLocaleString()}</td>
                        <td>{t.note || "—"}</td>
                        <td>
                          <button className="btn btn-danger-ghost btn-sm" onClick={async () => {
                            if (!window.confirm("删除临时用户「" + t.username + "」？其账号立即失效。")) return;
                            try {
                              await superDeleteTempUser(t.username);
                              loadTempUsers();
                            } catch (err) { setError(err.message); }
                          }}>删除</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
              </>
            ) : null}

            <h3 className="admin-h3">④ 公网安全访问（隧道配置）</h3>
            <div className="import-hint">
              应用地址固定为 <code>/app/custdb</code>。隧道只需把公网域名/端口映射到 <b>NAS 内网 IP 的 5666 端口（HTTP 网关）</b>，外网访问形如 <code>https://你的域名/app/custdb</code>。
              也可在「设置」里配置<b>自定义服务端口</b>，把隧道直接映射到该端口（局域网直连用 <code>http://NAS内网IP:端口/app/custdb</code>）。
              应用默认开启<b>严格登录验证</b>，公网访客一律先登录；建议再<b>修改默认超管密码</b>。
            </div>
            <div className="tunnel-box">
              <div className="tunnel-name">frpc（frp 客户端）— frpc.ini</div>
              <pre className="tunnel-pre">{`[common]
server_addr = 你的frp服务器域名
server_port = 7000
token = 你的frp令牌

[custdb]
type = tcp
local_ip = 192.168.1.100
local_port = 5666
remote_port = 8000
# 外网访问：http://你的frp域名:8000/app/custdb`}</pre>
            </div>
            <div className="tunnel-box">
              <div className="tunnel-name">NPC（nps 客户端）— 命令行示例</div>
              <pre className="tunnel-pre">{`# nps 服务端先创建 TCP 隧道，得到 vkey
npc -server=你的nps服务器:8024 -vkey=服务端生成的KEY \\
     -type=tcp -local_type=tcp -local_addr=192.168.1.100:5666 \\
     -remote_port=8000
# 外网访问：http://你的nps域名:8000/app/custdb`}</pre>
            </div>
            <div className="tunnel-box">
              <div className="tunnel-name">cloudflared（Cloudflare Tunnel）— 快速隧道</div>
              <pre className="tunnel-pre">{`# 在 NAS 上运行（Docker 或二进制均可）
cloudflared tunnel --url http://192.168.1.100:5666
# 启动后输出 https://xxxx.trycloudflare.com
# 外网访问：https://xxxx.trycloudflare.com/app/custdb
# 正式使用建议用命名隧道 + 自有域名 + ingress 规则`}</pre>
            </div>
            <div className="tunnel-box">
              <div className="tunnel-name">节点小宝（飞牛应用商店）— 控制台添加服务</div>
              <pre className="tunnel-pre">{`1. 飞牛应用商店搜索安装「节点小宝」，登录并绑定 NAS
2. 打开小宝控制台 → 内网穿透 → 添加服务
3. 服务类型：网页
   中转设备：飞牛NAS（或局域网内可达设备）
   服务地址：http://192.168.1.100:5666
4. 生成外网域名后访问：https://你的域名/app/custdb
（也可用「异地组网」给手机/电脑装客户端后直连组网 IP）`}</pre>
            </div>
            <div className="import-hint">
              通用安全建议：① 应用启用后先登录 admin 修改默认密码；② 对外只开 HTTPS / 域名访问，不开应用数据端口直连；③ 访客一律用限时临时账号；④ 数据含身份证住址等敏感信息，隧道服务商选择可靠厂商并开启访问日志。
            </div>
          </>
        ) : null}

        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>取消</button>
        </div>
      </div>

      {addFor ? (
        <FormModal
          initial={null}
          onClose={() => setAddFor(null)}
          onSave={async (form) => {
            await saveNewCustomer(addFor.uid, form);
            setAddFor(null);
          }}
        />
      ) : null}
    </div>
  );
}

function LoginModal({ onClose, onSuccess }) {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const r = await login(u.trim(), p);
      saveLogin(r);
      onSuccess(r);
      onClose();
    } catch (ex) {
      setErr(ex.message || "登录失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mask">
      <div className="modal">
        <div className="modal-head">
          <h2>账号登录</h2>
          <button className="btn btn-ghost" onClick={onClose}>关闭</button>
        </div>
        <form onSubmit={submit}>
          <label className="f-label">用户名</label>
          <input className="f-input" value={u} onChange={(e) => setU(e.target.value)} placeholder="admin 或临时用户名" />
          <label className="f-label">密码</label>
          <input className="f-input" type="password" value={p} onChange={(e) => setP(e.target.value)} placeholder="密码" />
          {err ? <p className="form-error">{err}</p> : null}
          <div className="modal-foot">
            <button type="button" className="btn btn-ghost" onClick={onClose}>取消</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "登录中…" : "登录"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function App() {
  const [customers, setCustomers] = useState([]);
  const [stats, setStats] = useState({ total: 0, expired: 0, due30: 0, due60: 0, normal: 0 });
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("全部");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(null); // null | {editing: customer|null}
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false); // 手机端抽屉菜单
  const [connOk, setConnOk] = useState(null); // 连接状态：null=未知 true=在线 false=离线
  const [storageInfo, setStorageInfo] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSuper, setIsSuper] = useState(isSuperLocal());
  const [isOperator, setIsOperator] = useState(isOperatorLocal());
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginUser, setLoginUser] = useState(() => localStorage.getItem("custdb_user") || "");
  const [admins, setAdmins] = useState([]);
  const [viewUid, setViewUid] = useState(null); // 管理员视角：正在查看的 NAS 用户名（null=自己的数据）
  const [viewTab, setViewTab] = useState("normal"); // normal=正式客户 portin=异网用户
  const [portin, setPortin] = useState([]);
  const [portinStats, setPortinStats] = useState({ total: 0, feeSum: 0, hasDecider: 0 });
  const [portinQ, setPortinQ] = useState("");
  const [portinModal, setPortinModal] = useState(null); // null | {editing: portin|null}
  const [plans, setPlans] = useState([]);       // 套餐业务库（v0.0.23）
  const [addons, setAddons] = useState([]);     // 小业务库（v0.0.23）

  function doLogout() {
    logoutLocal();
    setLoginUser("");
    setIsSuper(false);
    setIsAdmin(false);
    setIsOperator(false);
    setViewUid(null);
    setAdmins([]);
    window.location.reload();
  }

  // 打印当前列表（管理员在线可用；打印样式见 styles.css @media print）
  function doPrint() {
    const title = viewTab === "portin" ? "异网用户名单" : "客户资料名单";
    const el = document.createElement("div");
    el.id = "print-title";
    el.textContent = title + "（" + new Date().toLocaleDateString("zh-CN") + "）";
    document.body.appendChild(el);
    window.print();
    document.body.removeChild(el);
  }

  async function checkConn() {
    try {
      const ok = await ping();
      setConnOk(ok);
      if (ok) setStorageInfo(await getSettings().catch(() => null));
    } catch (e) {
      setConnOk(false);
      setStorageInfo(null);
    }
  }

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      if (viewTab === "portin") {
        const [p, ps] = await Promise.all([listPortin(portinQ), getPortinStats()]);
        setPortin(p.portin);
        setPortinStats(ps);
      } else {
        const [c, s] = await Promise.all([listCustomers(q, filter), getStats()]);
        setCustomers(c.customers);
        setStats(s);
      }
      checkConn();
    } catch (err) {
      if (err && err.code === 401) {
        setLoginOpen(true);
      } else {
        setError(err.message || "加载失败");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [c, s, admin] = await Promise.all([listCustomers("", "全部"), getStats(), getAdminStatus()]);
        if (!alive) return;
        setCustomers(c.customers);
        setStats(s);
        setIsAdmin(!!admin.isAdmin);
        setIsSuper(!!admin.isSuper || isSuperLocal());
        setIsOperator(!!admin.isOperator || isOperatorLocal());
        setAdmins(admin.admins || []);
        if (admin.username) setLoginUser(admin.username);
        if (alive) checkConn();
        // 套餐业务库 / 小业务库（供表单下拉候选；失败不影响主流程）
        listPlans().then((r) => alive && setPlans(r.plans || [])).catch(() => {});
        listAddons().then((r) => alive && setAddons(r.addons || [])).catch(() => {});
      } catch (err) {
        if (alive) {
          if (err && err.code === 401) setLoginOpen(true);
          else setError(err.message || "加载失败");
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // 搜索输入防抖（管理员切换查看对象 / 视图切换时同样触发刷新）
  useEffect(() => {
    const t = setTimeout(() => refresh(), 300);
    return () => clearTimeout(t);
  }, [q, filter, viewUid, viewTab, portinQ]); // eslint-disable-line react-hooks/exhaustive-deps

  const dueTotal = stats.expired + stats.due30 + stats.due60;

  async function handleSave(form) {
    if (modal.editing) {
      await updateCustomer(modal.editing.id, form);
    } else {
      await createCustomer(form);
    }
    await refresh();
  }

  async function handleDelete(c) {
    if (!window.confirm("确定删除客户「" + c.name + "」？此操作不可恢复。")) return;
    try {
      await deleteCustomer(c.id);
      await refresh();
    } catch (err) {
      window.alert(err.message || "删除失败");
    }
  }

  async function handlePortinSave(form) {
    if (portinModal.editing) {
      await updatePortin(portinModal.editing.id, form);
    } else {
      await createPortin(form);
    }
    await refresh();
  }

  async function handlePortinDelete(p) {
    if (!window.confirm("确定删除异网用户「" + p.phone + "」？此操作不可恢复。")) return;
    try {
      await deletePortin(p.id);
      await refresh();
    } catch (err) {
      window.alert(err.message || "删除失败");
    }
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <div>
            <h1>通信客户资料库</h1>
            <p className="subtitle">客户档案 · 套餐管理 · 协议到期提醒</p>
          </div>
          <div className="head-btns">
            <span className={"conn-pill " + (connOk === false ? "conn-off" : "conn-on")}>
              {connOk === false ? "离线" : connOk ? "在线" : "检测中"}
            </span>
            {loginUser ? (
              <span className="user-pill head-user-pill" title="当前登录账号">{loginUser}{isSuper ? " · 超管" : ""}</span>
            ) : null}
            {isAdmin ? (
              <button className="btn btn-ghost-dark head-desktop" onClick={() => setAdminOpen(true)}>管理</button>
            ) : null}
            <button className="btn btn-ghost-dark head-desktop" onClick={() => setImportOpen(true)}>导入数据</button>
            <button className="btn btn-ghost-dark head-desktop" onClick={() => setExportOpen(true)}>导出数据</button>
            <button className="btn btn-ghost-dark head-desktop" onClick={doPrint}>打印</button>
            <button className="btn btn-ghost-dark head-desktop" onClick={() => setSettingsOpen(true)}>设置</button>
            {loginUser ? (
              <button className="btn btn-ghost-dark head-desktop" onClick={doLogout}>退出</button>
            ) : (
              <button className="btn btn-ghost-dark head-desktop" onClick={() => setLoginOpen(true)}>登录</button>
            )}
            <button
              className="btn btn-primary"
              onClick={() => (viewTab === "portin" ? setPortinModal({ editing: null }) : setModal({ editing: null }))}
            >
              {viewTab === "portin" ? "＋ 新增异网用户" : "＋ 新增客户"}
            </button>
          </div>
          <button className="menu-btn" onClick={() => setMenuOpen(true)} aria-label="菜单">☰ 菜单</button>
        </div>
        <div className="view-tabs">
          <button className={"view-tab " + (viewTab === "normal" ? "view-tab-active" : "")} onClick={() => setViewTab("normal")}>
            正式客户
          </button>
          <button className={"view-tab " + (viewTab === "portin" ? "view-tab-active" : "")} onClick={() => setViewTab("portin")}>
            异网用户
          </button>
        </div>
      </header>

      {menuOpen ? (
        <div className="drawer-mask" onClick={() => setMenuOpen(false)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <span>菜单</span>
              <button className="btn btn-sm btn-ghost" onClick={() => setMenuOpen(false)}>关闭</button>
            </div>
            {loginUser ? (
              <div className="drawer-user">当前账号：{loginUser}{isSuper ? "（超管）" : ""}{isAdmin ? "（管理员）" : ""}</div>
            ) : null}
            {isAdmin ? (
              <button className="drawer-item" onClick={() => { setMenuOpen(false); setAdminOpen(true); }}>管理</button>
            ) : null}
            <button className="drawer-item" onClick={() => { setMenuOpen(false); setImportOpen(true); }}>导入数据</button>
            <button className="drawer-item" onClick={() => { setMenuOpen(false); setExportOpen(true); }}>导出数据</button>
            <button className="drawer-item" onClick={() => { setMenuOpen(false); doPrint(); }}>打印</button>
            <button className="drawer-item" onClick={() => { setMenuOpen(false); setSettingsOpen(true); }}>设置</button>
            {loginUser ? (
              <button className="drawer-item drawer-item-danger" onClick={() => { setMenuOpen(false); doLogout(); }}>退出登录</button>
            ) : (
              <button className="drawer-item" onClick={() => { setMenuOpen(false); setLoginOpen(true); }}>登录</button>
            )}
          </div>
        </div>
      ) : null}

      <main className="main">
        {viewUid ? (
          <div className="banner banner-admin">
            <span>管理员视角：正在查看 <b>{viewUid}</b> 的数据（增删改/导入均作用于该用户）</span>
            <button className="btn btn-sm btn-ghost" onClick={() => { setViewUid(null); setFilter("全部"); setQ(""); setPortinQ(""); }}>返回我的数据</button>
          </div>
        ) : null}

        {viewTab === "normal" ? (
          <>
            <div className="stats">
              <StatCard label="全部客户" value={stats.total} onClick={() => setFilter("全部")} active={filter === "全部"} />
              <StatCard label="已到期" value={stats.expired} onClick={() => setFilter("已到期")} active={filter === "已到期"} />
              <StatCard label="30天内" value={stats.due30} onClick={() => setFilter("30天内到期")} active={filter === "30天内到期"} />
              <StatCard label="60天内" value={stats.due60} onClick={() => setFilter("60天内到期")} active={filter === "60天内到期"} />
            </div>

            {dueTotal > 0 ? (
              <div className="banner banner-warn">共 {dueTotal} 位客户协议即将到期或已到期，请及时安排续约外呼。</div>
            ) : null}

            <div className="toolbar">
              <input
                className="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜索姓名 / 电话 / 地址 / 套餐"
              />
            </div>

            <div className="chips">
              {FILTERS.map((f) => (
                <button
                  key={f}
                  className={"chip-btn " + (filter === f ? "chip-btn-active" : "")}
                  onClick={() => setFilter(f)}
                >
                  {f}
                </button>
              ))}
            </div>

            {error ? <div className="banner banner-error">{error}</div> : null}
            {loading && customers.length === 0 ? (
              <div className="empty">加载中…</div>
            ) : customers.length === 0 ? (
              <div className="empty">暂无符合条件的客户，点击右上角“新增客户”添加。</div>
            ) : (
              <div className="cards">
                {customers.map((c) => (
                  <CustomerCard key={c.id} c={c} onEdit={() => setModal({ editing: c })} onDelete={handleDelete} />
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="stats">
              <StatCard label="异网用户" value={portinStats.total} onClick={() => setPortinQ("")} active={portinQ === ""} />
              <div className="stat">
                <div className="stat-num">{portinStats.feeSum}</div>
                <div className="stat-label">月费合计(元)</div>
              </div>
              <div className="stat">
                <div className="stat-num">{portinStats.hasDecider}</div>
                <div className="stat-label">已标记决策人</div>
              </div>
            </div>

            <div className="banner banner-info">
              异网用户 = 使用其他运营商的潜在客户（策反目标）。记录联系电话、运营商、家庭住址、套餐费用、套餐名称、更换决策人与备注，便于外呼挖转。
            </div>

            <div className="toolbar">
              <input
                className="search"
                value={portinQ}
                onChange={(e) => setPortinQ(e.target.value)}
                placeholder="搜索电话 / 住址 / 套餐 / 决策人"
              />
            </div>

            {error ? <div className="banner banner-error">{error}</div> : null}
            {loading && portin.length === 0 ? (
              <div className="empty">加载中…</div>
            ) : portin.length === 0 ? (
              <div className="empty">暂无异网用户，点击右上角“新增异网用户”添加。</div>
            ) : (
              <div className="cards">
                {portin.map((p) => (
                  <PortinCard key={p.id} p={p} onEdit={() => setPortinModal({ editing: p })} onDelete={handlePortinDelete} />
                ))}
              </div>
            )}
          </>
        )}

        <footer className="footer">
          {storageInfo ? (
            <span>
              存储：SQLite 数据库 · 目录：{storageInfo.dataDir} ·{" "}
            </span>
          ) : null}
          数据保存在 NAS 数据目录（按 NAS 用户隔离），电脑与手机访问同一份数据；内置示例数据为虚构演示，可在页面中删除。含身份证住址等敏感信息，请妥善保管。
        </footer>
      </main>

      {modal ? (
        <FormModal initial={modal.editing} onClose={() => setModal(null)} onSave={handleSave} plans={plans} addons={addons} />
      ) : null}

      {portinModal ? (
        <PortinFormModal initial={portinModal.editing} onClose={() => setPortinModal(null)} onSave={handlePortinSave} plans={plans} addons={addons} />
      ) : null}

      {importOpen ? (
        <ImportModal onClose={() => setImportOpen(false)} onDone={refresh} />
      ) : null}

      {exportOpen ? (
        <ExportModal isAdmin={isAdmin} viewUid={viewUid} onClose={() => setExportOpen(false)} />
      ) : null}

      {settingsOpen ? (
        <SettingsModal onClose={() => setSettingsOpen(false)} onSaved={() => { setSettingsOpen(false); refresh(); }} />
      ) : null}

      {adminOpen ? (
        <AdminModal
          currentAdmins={admins}
          isSuper={isSuper}
          onClose={() => setAdminOpen(false)}
          onView={(uid) => { setViewUid(uid); setFilter("全部"); setQ(""); setPortinQ(""); }}
          onAdminsChanged={async () => {
            try {
              const a = await getAdminStatus();
              setAdmins(a.admins || []);
              setIsSuper(!!a.isSuper || isSuperLocal());
              setIsOperator(!!a.isOperator || isOperatorLocal());
            } catch (e) { /* 忽略 */ }
          }}
        />
      ) : null}

      {loginOpen ? (
        <LoginModal
          onClose={() => setLoginOpen(false)}
          onSuccess={async (r) => {
            setLoginUser(r.username);
            setIsSuper(!!r.isSuper);
            setIsOperator(!!r.isOperator);
            setViewUid(null);
            try {
              const a = await getAdminStatus();
              setIsAdmin(!!a.isAdmin);
              setIsSuper(!!a.isSuper || !!r.isSuper);
              setIsOperator(!!a.isOperator);
              setAdmins(a.admins || []);
            } catch (e) { setIsAdmin(false); }
            refresh();
            // 登录后加载套餐业务库 / 小业务库（供表单候选；失败不影响主流程）
            listPlans().then((x) => setPlans(x.plans || [])).catch(() => {});
            listAddons().then((x) => setAddons(x.addons || [])).catch(() => {});
          }}
        />
      ) : null}
    </div>
  );
}
