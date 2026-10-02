const BASE = "http://127.0.0.1:5099/app/custdb/api";
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("PASS", name); }
  else { fail++; console.log("FAIL", name, extra || ""); }
}
(async () => {
  const login = await fetch(BASE + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin" }) });
  const lj = await login.json();
  check("登录 admin/admin", login.status === 200 && lj.token, lj.error);
  const H = { "Content-Type": "application/json", "Authorization": "Bearer " + lj.token };

  const plans = await (await fetch(BASE + "/library/plans", { headers: H })).json();
  check("套餐库 33 条", plans.plans && plans.plans.length === 33, plans.plans && plans.plans.length);
  const cats = {};
  plans.plans.forEach(p => cats[p.category] = (cats[p.category] || 0) + 1);
  check("类别含 E家融合 5 条", cats["E家融合"] === 5, JSON.stringify(cats));
  check("移动套餐 12 条", plans.plans.filter(p => p.operator === "中国移动").length === 12);

  const addons = await (await fetch(BASE + "/library/addons", { headers: H })).json();
  check("小业务库 21 条", addons.addons && addons.addons.length === 21, addons.addons && addons.addons.length);
  const addOp = {};
  addons.addons.forEach(a => addOp[a.operator] = (addOp[a.operator] || 0) + 1);
  check("小业务三家各 7 条", addOp["中国移动"] === 7 && addOp["中国联通"] === 7 && addOp["中国电信"] === 7, JSON.stringify(addOp));

  const d1 = await (await fetch(BASE + "/detect-operator?phone=13812345678", { headers: H })).json();
  const d2 = await (await fetch(BASE + "/detect-operator?phone=13012345678", { headers: H })).json();
  const d3 = await (await fetch(BASE + "/detect-operator?phone=18912345678", { headers: H })).json();
  const d4 = await (await fetch(BASE + "/detect-operator?phone=19912345678", { headers: H })).json();
  const d5 = await (await fetch(BASE + "/detect-operator?phone=12345", { headers: H })).json();
  check("138→移动", d1.operator === "中国移动", d1.operator);
  check("130→联通", d2.operator === "中国联通", d2.operator);
  check("189→电信", d3.operator === "中国电信", d3.operator);
  check("199→电信", d4.operator === "中国电信", d4.operator);
  check("非法→空", d5.operator === "", d5.operator);

  const np = await fetch(BASE + "/library/plans", { method: "POST", headers: H, body: JSON.stringify({ name: "测试自定套餐", category: "家庭融合", fee: 88, operator: "中国移动" }) });
  const npj = await np.json();
  check("新增套餐成功", np.status === 200 && npj.id, npj.error);
  const dp = await fetch(BASE + "/library/plans/" + npj.id, { method: "DELETE", headers: H });
  check("删除自定义套餐成功", dp.status === 200);
  const dp2 = await fetch(BASE + "/library/plans/" + plans.plans[0].id, { method: "DELETE", headers: H });
  check("内置套餐不可删(403)", dp2.status === 403);

  const na = await fetch(BASE + "/library/addons", { method: "POST", headers: H, body: JSON.stringify({ name: "测试小业务", operator: "中国电信" }) });
  const naj = await na.json();
  check("新增小业务成功", na.status === 200 && naj.id, naj.error);
  const da = await fetch(BASE + "/library/addons/" + naj.id, { method: "DELETE", headers: H });
  check("删除小业务成功", da.status === 200);
  const da2 = await fetch(BASE + "/library/addons/" + addons.addons[0].id, { method: "DELETE", headers: H });
  check("内置小业务不可删(403)", da2.status === 403);

  const nc = await fetch(BASE + "/customers", { method: "POST", headers: H, body: JSON.stringify({ name: "测试客户", phone: "13866668888", planName: "全家享融合套餐 99元", planFee: 99, discount: "8折" }) });
  const ncj = await nc.json();
  check("创建客户成功", nc.status === 200, ncj.error);
  check("客户运营商自动识别为移动", ncj.customer.operator === "中国移动", ncj.customer.operator);
  check("客户折扣字段 8折", ncj.customer.discount === "8折", ncj.customer.discount);
  const uc = await fetch(BASE + "/customers/" + ncj.customer.id, { method: "PUT", headers: H, body: JSON.stringify({ discount: "95折" }) });
  const ucj = await uc.json();
  check("更新折扣 95折", ucj.customer.discount === "95折", ucj.customer.discount);

  const npo = await fetch(BASE + "/portin", { method: "POST", headers: H, body: JSON.stringify({ phone: "18966668888", familyAddress: "泸州", planName: "E家融合套餐 99元", planFee: 99, discount: "免月租" }) });
  const npoj = await npo.json();
  check("异网用户创建成功", npo.status === 200, npoj.error);
  check("异网运营商自动识别为电信", npoj.portin.operator === "中国电信", npoj.portin.operator);
  check("异网折扣字段", npoj.portin.discount === "免月租", npoj.portin.discount);

  const exp = await fetch(BASE + "/export?format=csv&type=customers", { headers: H });
  const txt = await exp.text();
  check("导出 CSV 含折扣列", exp.status === 200 && txt.includes("折扣"), txt.slice(0, 100));
  const expP = await fetch(BASE + "/export?format=csv&type=portin", { headers: H });
  const txtP = await expP.text();
  check("异网导出含折扣列", txtP.includes("折扣"));

  const opf = await (await fetch(BASE + "/library/plans?operator=中国电信", { headers: H })).json();
  check("套餐按运营商过滤", opf.plans.every(p => p.operator === "中国电信") && opf.plans.length > 0, opf.plans.length);

  await fetch(BASE + "/customers/" + ncj.customer.id, { method: "DELETE", headers: H });
  await fetch(BASE + "/portin/" + npoj.portin.id, { method: "DELETE", headers: H });
  const rem = await (await fetch(BASE + "/customers", { headers: H })).json();
  check("测试客户已清理", !rem.customers.some(c => c.name === "测试客户"));

  console.log("\n结果: " + pass + " 通过 / " + fail + " 失败");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("异常:", e.message); process.exit(1); });
