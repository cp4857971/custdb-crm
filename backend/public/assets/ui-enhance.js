/* ui-enhance.js —— 全站视图统一优化（v0.0.41）
 * 覆盖：管理控制台（super.html）/ 授权导出中心（export-center.html）/ 主页（index.html 顶栏统计）
 * 方向：整体风格（渐变顶栏/卡片/按钮统一）· 信息密度（表格紧凑）· 关键信息突出（状态徽标/过期行）· 操作便捷（触控/反馈）
 * 注入式增强：仅追加样式与 DOM 增强，不改业务逻辑，与 view-enhance.js / print-table.js 互不影响。
 */
(function () {
  "use strict";
  var STYLE_ID = "ui-enhance-v041";
  var CSS = [
    ":root{--primary:#17365D;--primary-2:#2B5A8C;--primary-grad:linear-gradient(135deg,#17365D 0%,#2B5A8C 100%);--danger:#C0392B;--ok:#1E7D34;--orange:#E67E22;--yellow:#B45309;--line:#E9EEF4;--radius:12px;--shadow:0 2px 10px rgba(23,54,93,.08)}",
    ".topbar{background:var(--primary-grad)!important;box-shadow:0 2px 12px rgba(23,54,93,.22)}",
    ".topbar a,.topbar button{backdrop-filter:blur(4px)}",
    ".card{border-radius:var(--radius)!important;box-shadow:var(--shadow)!important;border:1px solid rgba(23,54,93,.05)}",
    ".card-hd{border-bottom-color:var(--line)!important}",
    ".btn{border-radius:8px!important;transition:all .15s ease}",
    ".btn:hover{transform:translateY(-1px);box-shadow:0 2px 6px rgba(23,54,93,.15)}",
    ".btn:active{transform:translateY(0) scale(.97)}",
    ".btn-pri{background:var(--primary-grad)!important;border-color:transparent!important;box-shadow:0 2px 8px rgba(23,54,93,.25)}",
    ".btn-pri:hover{opacity:.92!important;box-shadow:0 4px 12px rgba(23,54,93,.3)}",
    ".btn-danger{border-color:#E6B8B1!important}",
    ".tab{border-radius:8px!important;transition:all .15s ease}",
    ".tab.on{background:var(--primary-grad)!important}",
    "th{padding:7px 10px!important;background:#F4F7FB!important;position:sticky;top:0;z-index:1}",
    "td{padding:6px 10px!important;font-size:12.5px}",
    "tbody tr:nth-child(even) td{background:#FAFBFD}",
    "tr:hover td{background:#F2F7FC!important}",
    ".badge{font-weight:600;border-radius:999px!important;padding:2px 9px!important;border:1px solid transparent;box-shadow:0 1px 2px rgba(0,0,0,.06)}",
    ".badge-b{background:#E6EFFA!important;color:var(--primary)!important;border-color:#C9DDF2!important}",
    ".badge-r{background:#FDEAE7!important;color:var(--danger)!important;border-color:#F5C9C2!important}",
    ".badge-g{background:#E7F5EA!important;color:var(--ok)!important;border-color:#C4E6CC!important}",
    ".badge[data-status]:before{content:'';display:inline-block;width:6px;height:6px;border-radius:999px;margin-right:5px;vertical-align:1px}",
    '.badge[data-status="已到期"]:before{background:var(--danger)}',
    '.badge[data-status="30天内到期"]:before{background:var(--orange)}',
    '.badge[data-status="60天内到期"]:before{background:var(--yellow)}',
    '.badge[data-status="正常"]:before{background:var(--ok)}',
    "tr.expired td{background:#FEF6F5!important}",
    "tr.expired td:first-child{box-shadow:inset 3px 0 0 var(--danger)}",
    "tr.due30 td{background:#FEFBF3!important}",
    "tr.due30 td:first-child{box-shadow:inset 3px 0 0 var(--orange)}",
    "tbody td:first-child{font-weight:600;color:var(--primary)}",
    ".code-chip{background:#F2F6FB!important;padding:2px 10px!important;border-radius:6px!important;border:1px dashed #B9CEE7}",
    ".notice{border-radius:10px!important;box-shadow:0 1px 4px rgba(23,54,93,.06)}",
    ".stat-num,.stat{font-variant-numeric:tabular-nums}",
    "@media (max-width:639px){",
    "  th,td{padding:5px 8px!important;font-size:12px}",
    "  .btn{padding:8px 12px;min-height:36px}",
    "  .topbar{padding:10px 14px}",
    "  .filters{flex-wrap:nowrap;overflow-x:auto;padding:10px 14px}",
    "  .filters input{min-width:120px!important}",
    "  .filters::-webkit-scrollbar{display:none}",
    "}"
  ].join("");

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  function enhanceTables() {
    var tables = document.querySelectorAll("table");
    Array.prototype.forEach.call(tables, function (tb) {
      var rows = tb.querySelectorAll("tbody tr");
      Array.prototype.forEach.call(rows, function (r) {
        if (r.getAttribute("data-ui-enhanced") === "1") return;
        r.setAttribute("data-ui-enhanced", "1");
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
