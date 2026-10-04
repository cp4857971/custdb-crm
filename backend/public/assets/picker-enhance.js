// picker-enhance.js —— 套餐名称 / 小业务 下拉选择增强（v0.0.29）
// 需求：套餐名称（及小业务）需要"下拉选项，或者手动输入"。
// 原生 datalist 无可见下拉箭头、部分 WebView 不显示建议，现升级为：
//   输入框右侧可见下拉箭头 → 点击弹出选项列表（数据来自套餐/小业务业务库，随运营商过滤）
//   → 点击选项自动填入；仍可直接手动输入任意值。
// 说明：不修改业务 bundle；通过原生 value setter + input 事件与 React 受控组件状态同步。
(function () {
  "use strict";
  var BASE = (localStorage.getItem("custdb_base") || "/app/custdb").trim().replace(/\/+$/, "") || "/app/custdb";

  function token() { return localStorage.getItem("custdb_token") || ""; }

  function apiGet(path) {
    var t = token();
    return fetch(BASE + "/api" + path, { headers: t ? { Authorization: "Bearer " + t } : {} })
      .then(function (r) { return r.json().catch(function () { return null; }); })
      .catch(function () { return null; });
  }

  // React 受控组件兼容：调用原生 value setter 后派发 input/change 事件
  function setInputValue(input, val) {
    var proto = window.HTMLInputElement && window.HTMLInputElement.prototype;
    var desc = proto && Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(input, val); else input.value = val;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function closest(el, sel) {
    while (el && el.nodeType === 1) {
      if (el.matches && el.matches(sel)) return el;
      el = el.parentNode;
    }
    return null;
  }

  function currentOperator(input) {
    var form = closest(input, "form");
    if (!form) return "";
    var sels = form.querySelectorAll("select");
    for (var i = 0; i < sels.length; i++) {
      var v = sels[i].value;
      if (v && /移动|联通|电信/.test(v)) return v;
    }
    return "";
  }

  function buildPicker(input, opts) {
    var wrap = document.createElement("div");
    wrap.className = "cust-picker-wrap";
    wrap.style.cssText = "position:relative;display:block;width:100%;";
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cust-picker-arrow";
    btn.innerHTML = "▾";
    btn.setAttribute("aria-label", "下拉选择套餐");
    btn.style.cssText = "position:absolute;right:2px;top:50%;transform:translateY(-50%);width:32px;height:100%;border:0;background:transparent;color:#17365D;font-size:16px;cursor:pointer;outline:none;padding:0;";
    wrap.appendChild(btn);

    var panel = document.createElement("div");
    panel.className = "cust-picker-panel";
    panel.style.cssText = "position:absolute;left:0;right:0;top:100%;margin-top:2px;background:#fff;border:1px solid #cfd8e3;border-radius:8px;box-shadow:0 4px 16px rgba(23,54,93,.18);max-height:220px;overflow:auto;z-index:9999;display:none;-webkit-overflow-scrolling:touch;";
    wrap.appendChild(panel);

    var state = { open: false, list: [] };

    function render() {
      var op = currentOperator(input);
      var items = state.list.filter(function (p) {
        if (!p || !p.name) return false;
        if (op && p.operator && p.operator !== op) return false;
        return true;
      });
      panel.innerHTML = "";
      if (!items.length) {
        var e = document.createElement("div");
        e.style.cssText = "padding:10px 12px;color:#8a94a6;font-size:13px;";
        e.textContent = state.list.length ? "暂无匹配" + opts.kind + "（可手动输入）" : "加载中…";
        panel.appendChild(e);
        return;
      }
      items.forEach(function (p) {
        var d = document.createElement("div");
        d.className = "cust-picker-item";
        d.style.cssText = "padding:9px 12px;font-size:14px;cursor:pointer;border-bottom:1px solid #f0f3f8;display:flex;justify-content:space-between;align-items:center;gap:8px;";
        var name = document.createElement("span");
        name.textContent = p.name || "";
        var meta = document.createElement("span");
        meta.style.cssText = "color:#8a94a6;font-size:12px;white-space:nowrap;";
        meta.textContent = [p.fee != null ? p.fee + "元/月" : "", p.operator || ""].filter(Boolean).join(" · ");
        d.appendChild(name);
        d.appendChild(meta);
        d.addEventListener("pointerdown", function (ev) {
          ev.preventDefault();
          setInputValue(input, p.name || "");
          close();
        });
        panel.appendChild(d);
      });
    }

    function open() {
      if (state.open) return;
      state.open = true;
      panel.style.display = "block";
      if (!state.list.length) {
        apiGet(opts.endpoint).then(function (j) {
          var arr = (j && (j.plans || j.addons)) || [];
          state.list = arr.map(function (p) { return { name: p.name, fee: p.fee, operator: p.operator }; });
          render();
        });
      }
      render();
    }

    function close() {
      state.open = false;
      panel.style.display = "none";
    }

    btn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      if (state.open) close(); else open();
    });
    input.addEventListener("click", function (ev) {
      ev.stopPropagation();
      if (!state.open) open();
    });
    input.addEventListener("blur", function () { setTimeout(close, 160); });
    document.addEventListener("click", function (ev) {
      if (!wrap.contains(ev.target)) close();
    });

    // 供外部（运营商切换等）重渲染
    input._pickerRender = render;
    input._pickerClose = close;
    input.setAttribute("data-cust-picker", "1");
    // 自定义面板接管后移除原生 datalist，避免双份建议
    input.removeAttribute("list");
  }

  function bindFormChange(input) {
    var form = closest(input, "form");
    if (!form || form.getAttribute("data-picker-bound") === "1") return;
    form.setAttribute("data-picker-bound", "1");
    form.addEventListener("change", function () {
      form.querySelectorAll('input[data-cust-picker="1"]').forEach(function (x) {
        if (x._pickerRender) x._pickerRender();
      });
    });
  }

  function enhanceAll() {
    var inputs = document.querySelectorAll('input[list="cust-plan-list"], input[list="cust-addon-list"]');
    for (var i = 0; i < inputs.length; i++) {
      var inp = inputs[i];
      if (inp.getAttribute("data-cust-picker") === "1") continue;
      if (!inp.isConnected) continue;
      var isPlan = inp.getAttribute("list") === "cust-plan-list";
      buildPicker(inp, {
        endpoint: isPlan ? "/library/plans" : "/library/addons",
        kind: isPlan ? "套餐" : "小业务"
      });
      bindFormChange(inp);
    }
  }

  var tries = 0;
  var tm = setInterval(function () {
    tries++;
    enhanceAll();
    if (tries > 200) clearInterval(tm);
  }, 400);
})();
