import {
  normalize,
  totals,
  backup,
  parseBackup,
  load,
  save,
  importRows,
  restore,
  xlsx,
} from "../lib/ledger.js";
import { FX_FIELDS, calculateFxTarget, roundFx } from "../lib/fx-calculator.js";
import { showFeedback, copyText, showCopyResult } from "../lib/feedback.js";
import { shareFileOrDownload } from "../lib/share-file.js";

const root = document.querySelector("#ledger");
const names = {
  expense: "开支",
  income: "收入",
  remittance: "汇款",
  summary: "汇总",
};
const actions = { form: "记一笔", view: "查看", export: "导出／分享" };
const categories = ["购物", "餐饮", "交通", "房屋", "账单", "其它"];
const periods = { month: "月份", year: "年度", all: "汇总" };
const fxNames = { usd: "美元金额", rate: "汇率", cny: "人民币金额" };
const icons = {
  form: '<path d="M12 5v14M5 12h14"/>',
  view: '<path d="M4 5h16v15H4zM4 10h16M8 2v5m8-5v5"/>',
  export: '<path d="M12 15V3m-5 5 5-5 5 5M4 14v6h16v-6"/>',
};
const escape = (v) =>
  String(v ?? "").replace(
    /[<>&"']/g,
    (c) =>
      ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const money = (n, p = "$") =>
  p +
  n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const today = () => {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
};
let kind = "expense",
  page = "home",
  editing = null,
  preview = null,
  target = "cny",
  lastManual = "rate";
const filters = Object.fromEntries(
  Object.keys(names).map((k) => [
    k,
    { mode: "month", month: today().slice(0, 7), year: today().slice(0, 4) },
  ]),
);
const filter = () => filters[kind];
const prefix = () => (filter().mode === "all" ? "" : filter()[filter().mode]);
const selected = (k) =>
  load(k)
    .filter((r) => r.date.startsWith(prefix()))
    .sort((a, b) => b.date.localeCompare(a.date));
const periodName = () =>
  filter().mode === "all"
    ? "全部"
    : prefix().replace("-", " 年 ") +
      (filter().mode === "month" ? " 月" : " 年");
const button = (action, label, more = "") =>
  `<button type="button" data-action="${action}" ${more}>${label}</button>`;
function nav(labels, attr, current, title) {
  return `<nav class="${attr}" aria-label="${title}">${Object.entries(labels)
    .map(
      ([k, v]) =>
        `<button type="button" data-${attr}="${k}" aria-current="${k === current ? "page" : "false"}">${v}</button>`,
    )
    .join("")}</nav>`;
}
function home() {
  const subtitles = {
    form:
      kind === "remittance"
        ? "记录美元、汇率和人民币"
        : kind === "expense"
          ? "记录金额、支付方式和分类"
          : "记录金额和收款方式",
    view: "按月份、年度查看明细",
    export: "Excel 表格、备份和汇总",
  };
  return `<h1>${names[kind]}账本</h1><div class="home-cards">${Object.entries(
    actions,
  )
    .map(
      ([k, v]) =>
        `<button class="home-card" data-page="${k}"><span class="icon ${k}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">${icons[k]}</svg></span><span><strong>${v}</strong><small>${subtitles[k]}</small></span><span class="chev" aria-hidden="true">›</span></button>`,
    )
    .join("")}</div>`;
}
const input = (name, label, type, value, extra = "") =>
  `<label>${label}<input name="${name}" type="${type}" value="${escape(value)}" ${extra}></label>`;
function radios(name, label, values, current) {
  return `<fieldset data-choice><legend>${label}</legend><div class="choices">${Object.entries(
    values,
  )
    .map(
      ([v, l]) =>
        `<label><input type="radio" name="${name}" aria-describedby="error-${name}" value="${escape(v)}" ${current === v ? "checked" : ""} required><span>${escape(l)}</span></label>`,
    )
    .join("")}</div><small id="error-${name}" class="choice-error" role="alert"></small></fieldset>`;
}
function form() {
  const r = editing || {};
  const decimal = (name, label, val, step) =>
    input(
      name,
      label,
      "number",
      val,
      `inputmode="decimal" step="${step}" min="${step}" required`,
    );
  return `<h1>${editing ? "编辑" : "记一笔"}${names[kind]}</h1><form class="panel">
 ${input("date", "日期", "date", r.date || today(), "required")}
 ${decimal("usd", "美元金额（USD）", r.amount ?? "", 0.01)}
 ${kind === "remittance" ? decimal("rate", "汇率（1 美元兑换人民币）", r.rate?.toFixed(3) ?? "", 0.001) + decimal("cny", "人民币金额（CNY）", r.cny ?? "", 0.01) + `<fieldset><legend>计算哪一项</legend><div class="calc">${FX_FIELDS.map((k) => button("target", fxNames[k], `data-field="${k}"`)).join("")}</div></fieldset>` : radios("method", kind === "income" ? "收款方式" : "支付方式", { cash: "现金", card: "银行卡" }, r.method)}
 ${kind === "expense" ? radios("category", "开支分类", Object.fromEntries([...new Set([...categories, r.category].filter(Boolean))].map((x) => [x, x])), r.category) : ""}
 ${kind !== "income" ? `<label>备注（选填）<textarea name="note" maxlength="10000" rows="2">${escape(r.note)}</textarea></label>` : ""}
 <div class="controls">${button("cancel", "取消")}<button class="primary" type="submit">保存</button></div></form>`;
}
function picker() {
  const f = filter();
  const rows =
    kind === "summary"
      ? Object.keys(names)
          .filter((k) => k !== "summary")
          .flatMap(load)
      : load(kind);
  const years = [
    ...new Set([
      today().slice(0, 4),
      f.year,
      ...rows.map((r) => r.date.slice(0, 4)),
    ]),
  ]
    .sort()
    .reverse();
  return (
    nav(periods, "period", f.mode, "查看范围") +
    (f.mode === "month"
      ? input("month", "选择月份", "month", f.month, "required")
      : f.mode === "year"
        ? `<label>选择年份<select name="year">${years.map((y) => `<option ${y === f.year ? "selected" : ""}>${y}</option>`).join("")}</select></label>`
        : "")
  );
}
function stats(k, rows) {
  const t = totals(k, rows);
  return k === "remittance"
    ? [
        ["汇出美元", money(t.usd)],
        ["折合人民币", money(t.cny, "¥")],
        ["平均汇率", t.count ? t.rate.toFixed(3) : "—"],
        ["汇款笔数", t.count + " 笔"],
      ]
    : [
        [names[k] + "总额", money(t.usd)],
        ["现金", money(t.cash)],
        ["银行卡", money(t.card)],
        ["记录笔数", t.count + " 笔"],
      ];
}
const statGrid = (pairs) =>
  `<dl class="stats">${pairs.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>`;
function details(rows) {
  return rows
    .map(
      (r) =>
        `<article class="record"><div><b>${escape(r.category || (kind === "remittance" ? "汇款" : r.method === "cash" ? "现金收入" : "银行卡收入"))}</b><span>${money(r.amount)}</span></div><small>${escape(r.date)} · ${kind === "remittance" ? money(r.cny, "¥") + " · 汇率 " + r.rate.toFixed(3) : r.method === "cash" ? "现金" : "银行卡"}</small>${r.note ? `<p>${escape(r.note)}</p>` : ""}<footer>${button("edit", "编辑", `data-id="${escape(r.id)}"`)}${button("delete", "删除", `data-id="${escape(r.id)}"`)}</footer></article>`,
    )
    .join("");
}
function view() {
  const rows = selected(kind),
    groups = new Map();
  const month = filter().mode === "month";
  for (const row of rows) {
    const key = row.date.slice(0, filter().mode === "year" ? 7 : 4);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return `<h1>${names[kind]}记录</h1>${picker()}${statGrid(stats(kind, rows))}<h2>${periodName()}${names[kind]}明细</h2><section class="panel list">${!rows.length ? '<p class="empty">这个时段暂无记录</p>' : month ? details(rows) : [...groups].map(([group, items]) => `<details><summary>${group} · ${items.length} 笔 <b>${money(totals(kind, items).usd)}</b></summary>${details(items)}</details>`).join("")}</section>`;
}
function summary() {
  const income = totals("income", selected("income")).usd,
    expense = totals("expense", selected("expense")).usd,
    fx = totals("remittance", selected("remittance"));
  const first = (Math.round(income * 100) - Math.round(expense * 100)) / 100;
  const net = (Math.round(first * 100) - Math.round(fx.usd * 100)) / 100;
  const span = { month: "本月", year: "本年", all: "累计" }[filter().mode];
  return `<h1>收支总览</h1>${picker()}<h2>${periodName()}收支</h2><dl class="panel balance">${[
    ["收入", money(income)],
    ["生活开支", "−" + money(expense)],
    ["扣除开支后剩余", money(first)],
    ["汇出美元", "−" + money(fx.usd)],
    [span + "结余", money(net)],
    ["汇款折合人民币", money(fx.cny, "¥")],
  ]
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
    .join("")}</dl>`;
}
function exportsPage() {
  const title = names[kind];
  return `<h1>${title}导出／分享</h1><section class="panel"><h2>汇总文字</h2>${button("copy", "复制" + periodName() + title + "汇总")}</section>
 <section class="panel"><h2>全部${title} · Excel</h2><div class="controls">${button("excel", "下载 Excel")}${button("shareExcel", "分享 Excel")}</div></section>
 <section class="panel"><h2>全部${title} · 数据备份</h2><p>账目保存在当前浏览器。换设备前，请下载备份。</p><div class="controls">${button("backup", "下载备份")}${button("shareBackup", "分享备份")}</div><label class="file">导入数据备份<input type="file" name="file" accept=".json,application/json"></label>${button("restore", "恢复导入前的记录")}</section>${preview ? importPanel() : ""}`;
}
function importPanel() {
  const pick = preview.legacy && kind === "remittance";
  return `<section class="panel" id="import-preview"><h2>导入预览</h2><p>可导入 ${preview.rows.length} 笔。${preview.skipped ? "已排除 " + preview.skipped + " 笔减去记录。" : ""}</p>${pick ? "<p>勾选确实属于汇款的记录。</p>" : ""}<div class="preview-list">${preview.rows.map((r, i) => `<label>${pick ? `<input type="checkbox" data-import="${i}">` : ""}${escape(r.date)} · ${money(r.amount)} ${escape(r.note)}</label>`).join("")}</div><div class="controls">${button("merge", "合并导入")}${button("replace", "覆盖导入")}${button("abort", "取消")}</div></section>`;
}
function render() {
  root.innerHTML =
    nav(names, "book", kind, "账本导航") +
    `<div class="ledger-content">${kind !== "summary" && page !== "home" ? button("back", "‹ 返回" + names[kind] + "账本", 'class="back"') : ""}${kind === "summary" ? summary() : { home, view, form, export: exportsPage }[page]()}</div><output id="site-status" role="status" aria-live="polite"></output>`;
  if (page === "form") markTarget();
}
function markTarget() {
  root
    .querySelectorAll("[data-field]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.field === target)),
    );
}
function calc(form) {
  const values = Object.fromEntries(
    FX_FIELDS.map((k) => [k, form.elements[k].value]),
  );
  const n = calculateFxTarget(target, values);
  if (n !== null) form.elements[target].value = n;
  markTarget();
}
// Native required groups prevent submission; show a visible reminder beside each missing group.
root.addEventListener("invalid", (event) => {
  const group = event.target.closest("[data-choice]");
  if (group && event.target.validity.valueMissing) {
    const message = group.querySelector(".choice-error");
    if (!message.textContent) message.textContent = "请选择" + group.querySelector("legend").textContent;
  }
}, true);
root.addEventListener("change", (event) => {
  const group = event.target.closest("[data-choice]");
  if (group) group.querySelector(".choice-error").textContent = "";
});
root.addEventListener("input", (e) => {
  if (kind !== "remittance" || !FX_FIELDS.includes(e.target.name)) return;
  const field = e.target.name,
    form = e.target.form,
    filled = FX_FIELDS.filter((k) => form.elements[k].value !== "");
  if (!e.target.value) target = field;
  else if (filled.length === 2) {
    target = FX_FIELDS.find((k) => !filled.includes(k));
    calc(form);
  } else if (filled.length === 3) {
    if (field === target)
      target =
        lastManual !== field
          ? lastManual
          : { usd: "cny", rate: "cny", cny: "rate" }[field];
    calc(form);
  }
  lastManual = field;
  markTarget();
});
root.addEventListener("focusout", (e) => {
  if (
    kind !== "remittance" ||
    !FX_FIELDS.includes(e.target.name) ||
    !e.target.value
  )
    return;
  const digits = e.target.name === "rate" ? 3 : 2;
  const v = roundFx(Number(e.target.value), digits);
  if (Number.isFinite(v)) {
    e.target.value = v.toFixed(digits);
    if (e.target.name !== target) calc(e.target.form);
  }
});
function go(next, top = true) {
  page = next;
  preview = null;
  render();
  if (top) window.scrollTo(0, 0);
}
function download(blob, name) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function guarded(fn) {
  return async (e) => {
    try {
      await fn(e);
    } catch (error) {
      alert(error.message || "操作未完成，请重试。");
    }
  };
}
root.addEventListener(
  "submit",
  guarded((e) => {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.target));
    const rows = load(kind);
    const row = normalize(kind, {
      ...values,
      id: editing?.id,
      amount: values.usd,
    });
    const unusualExpense =
      kind === "expense" && (row.amount < 1 || row.amount > 10000);
    const unusualTransfer =
      kind === "remittance" &&
      (row.amount < 20 || row.amount > 100000 || row.rate < 5 || row.rate > 10);
    if (
      (unusualExpense || unusualTransfer) &&
      !confirm("金额或汇率超出常用范围，是否仍然保存？")
    )
      return;
    if (editing && !rows.some((r) => r.id === editing.id))
      throw new Error("此记录已删除，请重新打开查看。");
    save(
      kind,
      editing
        ? rows.map((r) => (r.id === editing.id ? row : r))
        : [...rows, row],
    );
    const dest = editing ? "view" : "home";
    editing = null;
    go(dest);
    showFeedback("已保存");
  }),
);
root.addEventListener(
  "change",
  guarded(async (e) => {
    const field = e.target;
    if (["month", "year"].includes(field.name) && field.value) {
      filter()[field.name] = field.value;
      render();
    }
    if (field.name === "file" && field.files[0]) {
      const current = kind,
        file = field.files[0];
      if (file.size > 5 * 1024 * 1024) throw new Error("备份超过 5 MB。");
      const parsed = parseBackup(kind, await file.text());
      if (current !== kind || page !== "export") return;
      preview = parsed;
      render();
      root.querySelector("#import-preview").scrollIntoView();
    }
  }),
);
root.addEventListener(
  "click",
  guarded(async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.book) {
      kind = b.dataset.book;
      editing = null;
      go("home");
      return;
    }
    if (b.dataset.period) {
      filter().mode = b.dataset.period;
      render();
      return;
    }
    if (b.dataset.page) {
      editing = null;
      target = "cny";
      lastManual = "rate";
      go(b.dataset.page);
      return;
    }
    const a = b.dataset.action,
      id = b.dataset.id;
    if (a === "back" || a === "cancel") {
      const dest = editing ? "view" : "home";
      editing = null;
      go(dest);
      return;
    }
    if (a === "target") {
      target = b.dataset.field;
      calc(root.querySelector("form"));
      return;
    }
    if (a === "edit") {
      editing = load(kind).find((r) => r.id === id);
      target = "cny";
      lastManual = "rate";
      go("form");
      return;
    }
    if (a === "delete" && confirm("删除这笔" + names[kind] + "？")) {
      save(
        kind,
        load(kind).filter((r) => r.id !== id),
      );
      render();
      showFeedback("已删除");
      return;
    }
    if (a === "copy") {
      const label = periodName() + names[kind] + "汇总";
      const text = [
        label,
        ...stats(kind, selected(kind)).map(([k, v]) => k + "　" + v),
      ].join("\n");
      showCopyResult(await copyText(text), text, label);
      return;
    }
    if (["excel", "backup", "shareExcel", "shareBackup"].includes(a)) {
      const sheet = a.toLowerCase().includes("excel"),
        rows = load(kind);
      const blob = sheet
        ? xlsx(kind, rows)
        : new Blob([JSON.stringify(backup(kind, rows), null, 2)], {
            type: "application/json",
          });
      const filename =
        "OpenAA-" + names[kind] + "-" + today() + (sheet ? ".xlsx" : ".json");
      if (a.startsWith("share"))
        await shareFileOrDownload(blob, filename, names[kind], download);
      else {
        download(blob, filename);
        showFeedback("已开始下载");
      }
      return;
    }
    if (a === "restore" && confirm("将当前账本恢复到上次导入前？")) {
      restore(kind);
      render();
      showFeedback("已恢复");
      return;
    }
    if (a === "abort") {
      preview = null;
      render();
      return;
    }
    if (a === "merge" || a === "replace") {
      let rows = preview.rows;
      if (preview.legacy && kind === "remittance") {
        rows = [...root.querySelectorAll("[data-import]:checked")].map(
          (c) => rows[Number(c.dataset.import)],
        );
        if (!rows.length) throw new Error("请先勾选要导入的汇款。");
      }
      if (
        a === "replace" &&
        !confirm("用所选备份覆盖当前全部" + names[kind] + "记录？")
      )
        return;
      importRows(kind, rows, a);
      preview = null;
      render();
      showFeedback("已完成导入");
    }
  }),
);
window.addEventListener("storage", () => {
  if (kind === "summary" || page === "view") render();
});
render();
