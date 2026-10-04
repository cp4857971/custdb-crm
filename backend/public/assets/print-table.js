// print-table.js —— 打印视图表格化（v0.0.34）
(function () {
  "use strict";
  var STYLE_ID = "print-table-style";
  function labelText(el) { var l = el.querySelector && el.querySelector(".label"); return l ? (l.textContent || "").trim() : ""; }
  function valText(el) { var v = el.querySelector && el.querySelector(".val"); return v ? (v.textContent || "").trim() : ""; }
  function cardRows(card) {
    var out = [];
    if (!card.querySelectorAll) return out;
    Array.prototype.forEach.call(card.querySelectorAll(".card-rows .row"), function (r) {
      var k = labelText(r); if (k) out.push({ k: k, v: valText(r) || "—" });
    });
    return out;
  }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function buildTableHtml() {
    var cards = document.querySelectorAll(".card");
    if (!cards.length) return "";
    var isPortin = !!document.querySelector(".card.card-portin");
    var heads = isPortin ? [] : ["姓名", "状态", "剩余天数", "套餐"];
    cardRows(cards[0]).forEach(function (r) { if (heads.indexOf(r.k) < 0) heads.push(r.k); });
    var html = '<table class="print-table"><thead><tr>' + heads.map(function (h) { return "<th>" + esc(h) + "</th>"; }).join("") + "</tr></thead><tbody>";
    Array.prototype.forEach.call(cards, function (card) {
      var cells = {};
      if (!isPortin) {
        var nm = card.querySelector(".card-name"); var chip = card.querySelector(".chip"); var days = card.querySelector(".days"); var plan = card.querySelector(".plan");
        cells["姓名"] = nm ? nm.textContent.trim() : ""; cells["状态"] = chip ? chip.textContent.trim() : "";
        cells["剩余天数"] = days ? days.textContent.trim() : ""; cells["套餐"] = plan ? plan.textContent.trim() : "";
      }
      cardRows(card).forEach(function (r) { cells[r.k] = r.v; });
      html += "<tr>" + heads.map(function (h) { return "<td>" + esc(cells[h] || "—") + "</td>"; }).join("") + "</tr>";
    });
    html += "</tbody></table>";
    return html;
  }
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement("style"); st.id = STYLE_ID;
    st.textContent = "@media print{#print-table-wrap{display:block!important;margin-top:8px}.print-table{width:100%;border-collapse:collapse;font-size:12px;line-height:1.4}.print-table th,.print-table td{border:1px solid #999;padding:4px 6px;text-align:left;vertical-align:top;word-break:break-all}.print-table th{background:#eee;font-weight:700;white-space:nowrap}.cards,.card{display:none!important}}";
    document.head.appendChild(st);
  }
  function doPrint() {
    ensureStyle();
    var old = document.getElementById("print-table-wrap"); if (old && old.parentNode) old.parentNode.removeChild(old);
    var html = buildTableHtml(); if (!html) return;
    var wrap = document.createElement("div"); wrap.id = "print-table-wrap"; wrap.innerHTML = html;
    var title = document.getElementById("print-title");
    if (title && title.parentNode) title.parentNode.insertBefore(wrap, title.nextSibling); else document.body.appendChild(wrap);
  }
  function cleanup() { var w = document.getElementById("print-table-wrap"); if (w && w.parentNode) w.parentNode.removeChild(w); }
  if (window.addEventListener) { window.addEventListener("beforeprint", doPrint); window.addEventListener("afterprint", cleanup); }
})();
