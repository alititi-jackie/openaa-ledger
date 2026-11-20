import { makeWorkbook } from "./workbook.js";

const kinds = ["expense", "income", "remittance"];
const app = "OpenAA Life Ledger";
const legacyApps = {
  expense: "OpenAA Expense Records",
  remittance: "OpenAA USD RMB Rate Records",
};
const maxBytes = 5 * 1024 * 1024;
function check(ok, message) {
  if (!ok) throw new Error(message);
}
function key(kind) {
  check(kinds.includes(kind), "未知账本。");
  return "openaa_life_ledger_v1_" + kind;
}
function positive(value, digits, label) {
  check(
    typeof value === "number" || (typeof value === "string" && value.trim()),
    "请输入" + label,
  );
  const n = Number(value);
  const scaled = Math.round((n + Number.EPSILON) * 10 ** digits);
  check(Number.isSafeInteger(scaled) && scaled > 0, label + "必须是有效正数。");
  return scaled / 10 ** digits;
}
export function normalize(kind, r) {
  key(kind);
  const date = r?.date;
  const parsed = new Date(date + "T12:00:00Z");
  check(
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      Number.isFinite(+parsed) &&
      parsed.toISOString().slice(0, 10) === date,
    "请输入有效日期。",
  );
  const id = String(r.id ?? crypto.randomUUID());
  check(id.length > 0 && id.length <= 200, "记录编号无效。");
  const note = r.note ?? "";
  check(typeof note === "string" && note.length <= 10000, "备注格式不正确。");
  const row = { id, date, amount: positive(r.amount, 2, "美元金额"), note };
  if (kind === "remittance") {
    row.rate = positive(r.rate, 3, "汇率");
    row.cny = positive(r.cny, 2, "人民币金额");
  } else {
    check(["cash", "card"].includes(r.method), "请选择现金或银行卡。");
    row.method = r.method;
    if (kind === "expense") {
      check(
        typeof r.category === "string" &&
          r.category.trim() &&
          r.category.length <= 100,
        "请选择开支分类。",
      );
      row.category = r.category;
    }
  }
  return row;
}
export function totals(kind, rows) {
  key(kind);
  let usd = 0,
    cny = 0,
    cash = 0,
    card = 0;
  for (const row of rows) {
    const cents = Math.round(row.amount * 100);
    usd += cents;
    if (row.method === "cash") cash += cents;
    if (row.method === "card") card += cents;
    if (kind === "remittance") cny += Math.round(row.cny * 100);
  }
  return {
    usd: usd / 100,
    cny: cny / 100,
    cash: cash / 100,
    card: card / 100,
    count: rows.length,
    rate: usd ? cny / usd : 0,
  };
}
function checked(kind, records) {
  check(
    Array.isArray(records) && records.length <= 10000,
    "每本账最多 10000 条记录。",
  );
  const rows = records.map((r) => normalize(kind, r));
  check(new Set(rows.map((r) => r.id)).size === rows.length, "记录编号重复。");
  return rows;
}
export function backup(kind, rows) {
  const data = {
    app,
    version: 1,
    kind,
    exportedAt: new Date().toISOString(),
    records: checked(kind, rows),
  };
  check(new Blob([JSON.stringify(data)]).size <= maxBytes, "备份超过 5 MB。");
  return data;
}
export function parseBackup(kind, input) {
  key(kind);
  const text = typeof input === "string" ? input : JSON.stringify(input);
  check(new Blob([text]).size <= maxBytes, "备份超过 5 MB。");
  const data = JSON.parse(text);
  if (data?.app === app) {
    check(data.kind === kind && data.version === 1, "备份账本或版本不匹配。");
    return { rows: checked(kind, data.records), legacy: false, skipped: 0 };
  }
  const bare = Array.isArray(data);
  check(
    kind !== "income" && (bare || data?.app === legacyApps[kind]),
    "请选择当前账本的备份。",
  );
  const records = bare ? data : data.records;
  check(Array.isArray(records) && records.length <= 10000, "备份格式无效。");
  let skipped = 0;
  const rows = [];
  for (const [index, r] of records.entries()) {
    check(r && typeof r === "object", "旧记录格式无效。");
    const id = r.id ?? "legacy-" + kind + "-" + index + "-" + r.date;
    if (kind === "expense") {
      rows.push({
        ...r,
        id,
        method: { 现金: "cash", 银行卡: "card" }[r.payment],
      });
    } else {
      check(r.usd != null && r.rate != null, "请选择汇款备份。");
      if (Number(r.usd) < 0 || r.type === "subtract") {
        skipped++;
        continue;
      }
      rows.push({
        ...r,
        id,
        amount: r.usd,
        cny: r.cny ?? Number(r.usd) * Number(r.rate),
      });
    }
  }
  return { rows: checked(kind, rows), legacy: true, skipped };
}
export function mergeRows(existing, incoming) {
  const ids = new Set(existing.map((r) => r.id));
  return [...existing, ...incoming.filter((r) => !ids.has(r.id))];
}
export function load(kind) {
  const raw = localStorage.getItem(key(kind));
  return raw === null ? [] : checked(kind, JSON.parse(raw));
}
export function save(kind, rows) {
  const records = backup(kind, rows).records;
  localStorage.setItem(key(kind), JSON.stringify(records));
  return records;
}
export function importRows(kind, rows, mode = "merge") {
  check(["merge", "replace"].includes(mode), "请选择合并或覆盖。");
  const old = load(kind);
  const next = mode === "merge" ? mergeRows(old, rows) : rows;
  const normalized = backup(kind, next).records;
  const snap = key(kind) + "_before_import";
  const prior = localStorage.getItem(snap);
  localStorage.setItem(snap, JSON.stringify(old));
  try {
    return save(kind, normalized);
  } catch (e) {
    if (prior === null) localStorage.removeItem(snap);
    else localStorage.setItem(snap, prior);
    throw e;
  }
}
export function restore(kind) {
  const snap = key(kind) + "_before_import";
  const raw = localStorage.getItem(snap);
  check(raw !== null, "没有可恢复的导入前记录。");
  const result = save(kind, JSON.parse(raw));
  localStorage.removeItem(snap);
  return result;
}
function table(kind, rows) {
  const fx = kind === "remittance",
    expense = kind === "expense";
  return [
    fx
      ? ["日期", "美元", "汇率", "人民币", "备注"]
      : ["日期", "美元", "收付方式", ...(expense ? ["分类"] : []), "备注"],
    ...[...rows]
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((r) =>
        fx
          ? [r.date, r.amount, r.rate, r.cny, r.note]
          : [
              r.date,
              r.amount,
              r.method === "cash" ? "现金" : "银行卡",
              ...(expense ? [r.category] : []),
              r.note,
            ],
      ),
  ];
}
function grouped(kind, rows, length) {
  const groups = new Map();
  for (const row of rows) {
    const period = row.date.slice(0, length);
    if (!groups.has(period)) groups.set(period, []);
    groups.get(period).push(row);
  }
  const fx = kind === "remittance";
  const sheets = [
    [
      length === 7 ? "月份" : "年度",
      "笔数",
      "美元",
      ...(fx ? ["人民币", "平均汇率"] : ["现金", "银行卡"]),
    ],
  ];
  for (const period of [...groups.keys()].sort().reverse()) {
    const t = totals(kind, groups.get(period));
    sheets.push([
      period,
      t.count,
      t.usd,
      ...(fx ? [t.cny, Number(t.rate.toFixed(3))] : [t.cash, t.card]),
    ]);
  }
  return sheets;
}
export function xlsx(kind, rows) {
  return makeWorkbook(
    table(kind, rows),
    grouped(kind, rows, 7),
    grouped(kind, rows, 4),
  );
}
export function csv(kind, rows) {
  function escape(value) {
    let s = String(value);
    if (typeof value === "string" && /^[=+@\-\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  }
  return (
    "\uFEFF" +
    table(kind, rows)
      .map((row) => row.map(escape).join(","))
      .join("\r\n")
  );
}
