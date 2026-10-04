/* ui-enhance.js —— 全站视图统一优化（v0.0.41）+ 视图再优化（v0.0.42）
 * 覆盖：管理控制台（super.html）/ 授权导出中心（export-center.html）/ 主页（index.html 顶栏统计）
 * v0.0.41 方向：整体风格（渐变顶栏/卡片/按钮统一）· 信息密度（表格紧凑）· 关键信息突出（状态徽标/过期行）· 操作便捷（触控/反馈）
 * v0.0.42 追加：登录页精致化 · 输入框/选择框焦点态统一 · 弹窗与提示条层次 · 统计数字卡突出 · 滚动条/空状态/页面背景
 * 注入式增强：仅追加样式与 DOM 增强，不改业务逻辑，与 view-enhance.js / print-table.js 互不影响。
 */
(function () {
  "use strict";
  var STYLE_ID = "ui-enhance-v042";
  var CSS = [
    /* ---------- 整体风格：统一设计变量 ---------- */
    ":root{--primary:#17365D;--primary-2:#2B5A8C;--primary-grad:linear-gradient(135deg,#17365D 0%,#2B5A8C 100%);--danger:#C0392B;--ok:#1E7D34;--orange:#E67E22;--yellow:#B45309;--line:#E9EEF4;--radius:12px;--shadow:0 2px 10px rgba(23,54,93,.08)}",
    /* 顶栏渐变 + 阴影 */
    ".topbar{background:var(--primary-grad)!important;box-shadow:0 2px 12px rgba(23,54,93,.22)}",
    ".topbar a,.topbar button{backdrop-filter:blur(4px)}",
    /* 卡片升级 */
    ".card{border-radius:var(--radius)!important;box-shadow:var(--shadow)!important;border:1px solid rgba(23,54,93,.05)}",
    ".card-hd{border-bottom-color:var(--line)!important}",
    /* 按钮统一：主按钮渐变 + 阴影 + 交互反馈 */
    ".btn{border-radius:8px!important;transition:all .15s ease}",
    ".btn:hover{transform:translateY(-1px);box-shadow:0 2px 6px rgba(23,54,93,.15)}",
    ".btn:active{transform:translateY(0) scale(.97)}",
    ".btn-pri{background:var(--primary-grad)!important;border-color:transparent!important;box-shadow:0 2px 8px rgba(23,54,93,.25)}",
    ".btn-pri:hover{opacity:.92!important;box-shadow:0 4px 12px rgba(23,54,93,.3)}",
    ".btn-danger{border-color:#E6B8B1!important}",
    /* 页签 */
    ".tab{border-radius:8px!important;transition:all .15s ease}",
    ".tab.on{background:var(--primary-grad)!important}",
    /* ---------- 信息密度：表格紧凑 + 表头吸顶 + 斑马纹 ---------- */
    "th{padding:7px 10px!important;background:#F4F7FB!important;position:sticky;top:0;z-index:1}",
    "td{padding:6px 10px!important;font-size:12.5px}",
    "tbody tr:nth-child(even) td{background:#FAFBFD}",
    "tr:hover td{background:#F2F7FC!important}",
    /* ---------- 关键信息突出：徽标立体化 ---------- */
    ".badge{font-weight:600;border-radius:999px!important;padding:2px 9px!important;border:1px solid transparent;box-shadow:0 1px 2px rgba(0,0,0,.06)}",
    ".badge-b{background:#E6EFFA!important;color:var(--primary)!important;border-color:#C9DDF2!important}",
    ".badge-r{background:#FDEAE7!important;color:var(--danger)!important;border-color:#F5C9C2!important}",
    ".badge-g{background:#E7F5EA!important;color:var(--ok)!important;border-color:#C4E6CC!important}",
    /* 状态徽标图标点（到期类） */
    ".badge[data-status]:before{content:'';display:inline-block;width:6px;height:6px;border-radius:999px;margin-right:5px;vertical-align:1px}",
    '.badge[data-status="已到期"]:before{background:var(--danger)}',
    '.badge[data-status="30天内到期"]:before{background:var(--orange)}',
    '.badge[data-status="60天内到期"]:before{background:var(--yellow)}',
    '.badge[data-status="正常"]:before{background:var(--ok)}',
    /* 过期行整行浅红底 */
    "tr.expired td{background:#FEF6F5!important}",
    "tr.expired td:first-child{box-shadow:inset 3px 0 0 var(--danger)}",
    "tr.due30 td{background:#FEFBF3!important}",
    "tr.due30 td:first-child{box-shadow:inset 3px 0 0 var(--orange)}",
    /* 关键列加粗 */
    "tbody td:first-child{font-weight:600;color:var(--primary)}",
    /* 授权码芯片 */
    ".code-chip{background:#F2F6FB!important;padding:2px 10px!important;border-radius:6px!important;border:1px dashed #B9CEE7}",
    /* 提示条 */
    ".notice{border-radius:10px!important;box-shadow:0 1px 4px rgba(23,54,93,.06)}",
    /* 顶栏统计数字卡（主页） */
    ".stat-num,.stat{font-variant-numeric:tabular-nums}",
    /* ---------- 操作便捷：移动端触控 ---------- */
    "@media (max-width:639px){",
    "  th,td{padding:5px 8px!important;font-size:12px}",
    "  .btn{padding:8px 12px;min-height:36px}",
    "  .topbar{padding:10px 14px}",
    "  .filters{flex-wrap:nowrap;overflow-x:auto;padding:10px 14px}",
    "  .filters input{min-width:120px!important}",
    "  .filters::-webkit-scrollbar{display:none}",
    "}",
    /* ================= v0.0.42 追加 ================= */
    /* ---------- 页面背景统一 ---------- */
    "body{background:#F4F7FB!important;background-image:radial-gradient(circle at 20% 0%,rgba(43,90,140,.06),transparent 45%),radial-gradient(circle at 90% 10%,rgba(230,239,250,.5),transparent 40%)!important}",
    /* ---------- 登录页精致化 ---------- */
    ".login-card{border-radius:18px!important;box-shadow:0 12px 40px rgba(23,54,93,.22)!important;border:1px solid rgba(255,255,255,.7)!important;background:#fff!important}",
    ".login-card .card-hd{background:var(--primary-grad)!important;color:#fff!important;border-radius:18px 18px 0 0!important;padding:18px 20px!important;border-bottom:none!important}",
    ".login-card .card-hd h2{margin:0;letter-spacing:.5px;font-size:17px}",
    ".login-card form{padding:22px 24px 26px!important}",
    ".login-card label{font-size:13px;color:#4B5563;font-weight:600;margin-bottom:4px;display:block}",
    ".login-card input{margin-bottom:12px}",
    ".login-hint{color:#8294A9!important;font-size:12.5px!important}",
    ".login-card .btn{width:100%;padding:11px!important;font-size:14px;border-radius:10px!important;margin-top:6px}",
    ".login-card .err{margin-top:8px}",
    "@media (max-width:639px){.login-card{margin:40px 16px!important;max-width:100%!important}}",
    /* ---------- 输入框/选择框/文本域统一焦点态 ---------- */
    "input,select,textarea{background:#fff!important;border:1px solid #CCD7E4!important;border-radius:8px!important;transition:border-color .15s ease,box-shadow .15s ease}",
    "input:focus,select:focus,textarea:focus{border-color:var(--primary-2)!important;box-shadow:0 0 0 3px rgba(43,90,140,.14)!important;outline:none!important}",
    "input::placeholder,textarea::placeholder{color:#A6B4C4!important}",
    ".filters input,.filters select{min-height:34px;border-radius:8px!important}",
    /* ---------- 弹窗/模态框层次 ---------- */
    ".modal,.modal-box,.dialog{background:#fff!important;border-radius:14px!important;box-shadow:0 16px 50px rgba(23,54,93,.28)!important;border:1px solid rgba(23,54,93,.06)!important;max-height:88vh!important;overflow:auto}",
    ".modal h3,.modal .modal-title,.dialog h3{background:var(--primary-grad)!important;color:#fff!important;margin:0!important;padding:13px 18px!important;border-radius:14px 14px 0 0!important;font-size:15px}",
    ".modal-bd,.modal .modal-body{padding:16px 18px!important}",
    /* ---------- 提示条/Toast ---------- */
    ".toast{border-radius:10px!important;box-shadow:0 6px 20px rgba(23,54,93,.22)!important;animation:uiToastIn .25s ease}",
    "@keyframes uiToastIn{from{transform:translate(-50%,-8px);opacity:0}to{transform:translate(-50%,0);opacity:1}}",
    /* ---------- 卡片标题与间距 ---------- */
    ".card-hd{font-weight:700!important;font-size:14.5px;padding:14px 18px!important}",
    ".card-hd .sub{font-weight:400!important;font-size:12px;color:#8294A9!important}",
    /* ---------- 表格容器包裹 ---------- */
    ".table-wrap{border:1px solid rgba(23,54,93,.07);border-radius:10px!important;background:#fff;margin:0 16px 16px!important;box-shadow:0 1px 4px rgba(23,54,93,.06)}",
    ".table-wrap table{border-radius:10px}",
    "th{color:#3B4A5C!important;font-weight:700!important;letter-spacing:.2px;border-bottom:2px solid #E4EBF3!important}",
    /* ---------- 统计数字卡（主页/控制台） ---------- */
    ".stat,.stat-num,.stat-card{background:var(--primary-grad)!important;border-radius:12px!important;box-shadow:0 4px 14px rgba(23,54,93,.18)!important;padding:14px 16px!important}",
    ".stat b,.stat-num b,.stat-card b{font-size:26px!important;color:#fff!important;display:block;font-weight:800!important;text-shadow:0 1px 2px rgba(0,0,0,.15)}",
    ".stat span,.stat-num span,.stat-card span{color:rgba(255,255,255,.85)!important;font-size:12px}",
    /* ---------- 空状态 ---------- */
    ".empty{color:#8B9AAC!important;font-size:13.5px!important;padding:48px 20px!important}",
    ".empty:before{content:'◌';display:block;font-size:34px;color:#C6D3E2;margin-bottom:10px;line-height:1}",
    /* ---------- 顶栏用户区与操作区 ---------- */
    ".topbar .who{background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.22);border-radius:999px;padding:3px 12px!important;font-size:12px;backdrop-filter:blur(4px)}",
    ".topbar .ops{display:flex;gap:6px;align-items:center}",
    /* ---------- 滚动条美化 ---------- */
    "::-webkit-scrollbar{width:9px;height:9px}",
    "::-webkit-scrollbar-track{background:transparent}",
    "::-webkit-scrollbar-thumb{background:rgba(43,90,140,.28);border-radius:9px;border:2px solid #F4F7FB}",
    "::-webkit-scrollbar-thumb:hover{background:rgba(43,90,140,.45)}",
    "::-webkit-scrollbar-corner{background:transparent}",
    /* 打印时隐藏背景 */
    "@media print{body{background:#fff!important}}"
  ].join("");

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  /* 表格状态行增强：按徽标文本给整行加状态类（行级幂等，全量处理） */
  function enhanceTables() {
    var tables = document.querySelectorAll("table");
    Array.prototype.forEach.call(tables, function (tb) {
      var rows = tb.querySelectorAll("tbody tr");
      Array.prototype.forEach.call(rows, function (r) {
        // 行级幂等：已处理的行跳过
        if (r.getAttribute("data-ui-enhanced") === "1") return;
        r.setAttribute("data-ui-enhanced", "1");
        // 状态徽标优先匹配含状态文本的徽标（避免误匹配创建人等普通徽标）
        var badges = r.querySelectorAll(".badge, .badge-r, .badge-g");
        var status = "";
        var b = null;
        Array.prototype.forEach.call(badges, function (x) {
          var t = x.textContent.trim();
          if (t.indexOf("已到期") >= 0) { status = "已到期"; b = x; }
          else if (t.indexOf("30天内") >= 0) { status = "30天内到期"; b = x; }
          else if (t.indexOf("60天内") >= 0) { status = "60天内到期"; b = x; }
          else if (t.indexOf("正常") >= 0) { status = "正常"; b = x; }
        });
        if (status === "已到期") r.classList.add("expired");
        else if (status === "30天内到期") r.classList.add("due30");
        if (b) b.setAttribute("data-status", status);
      });
    });
  }

  function init() {
    ensureStyle();
    enhanceTables();
    // 动态渲染（控制台/导出中心均为 JS 渲染）完成后补增强
    var root = document.getElementById("view-root");
    if (root && window.MutationObserver) {
      var ob = new MutationObserver(function () { enhanceTables(); });
      ob.observe(root, { childList: true, subtree: true });
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        ensureStyle();
        enhanceTables();
      });
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
