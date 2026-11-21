import test from "node:test";
import assert from "node:assert/strict";
import {
  backup,
  parseBackup,
  normalize,
  totals,
  save,
  load,
  importRows,
  restore,
  xlsx,
  csv,
} from "../src/lib/ledger.js";
const expense = {
  id: "x",
  date: "2026-11-20",
  method: "cash",
  category: "餐饮",
  amount: 0.1,
  note: "午餐",
};
const remit = {
  id: "r",
  date: expense.date,
  amount: 100,
  rate: 7.155,
  cny: 715.47,
  note: "",
};
test("strict dates, cents, native routing and weighted exchange", () => {
  assert.throws(() => normalize("expense", { ...expense, date: "2026-02-30" }));
  assert.equal(
    totals("expense", [expense, { ...expense, amount: 0.2 }]).usd,
    0.3,
  );
  assert.throws(() => parseBackup("income", backup("expense", [expense])));
  assert.equal(
    parseBackup("expense", backup("expense", [expense])).rows[0].note,
    "午餐",
  );
  assert.equal(
    totals("remittance", [remit, { ...remit, amount: 200, cny: 1400 }]).rate,
    211547 / 30000,
  );
});
test("legacy currency conversion preserves actual CNY, omits deductions", () => {
  const parsed = parseBackup("remittance", {
    app: "OpenAA USD RMB Rate Records",
    records: [
      { id: "a", date: expense.date, usd: 100, rate: 7.155, cny: 715.47 },
      { id: "b", date: expense.date, usd: -5, rate: 7, type: "subtract" },
      { id: "c", date: expense.date, usd: 4, rate: 7 },
    ],
  });
  assert.equal(parsed.skipped, 1);
  assert.deepEqual(
    parsed.rows.map((r) => r.cny),
    [715.47, 28],
  );
  const old = { ...expense, payment: "银行卡" };
  assert.equal(parseBackup("expense", [old]).rows[0].method, "card");
  assert.throws(() => parseBackup("remittance", [old]));
});
test("merge, overwrite, undo, independent books", () => {
  const m = new Map();
  globalThis.localStorage = {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => m.set(k, v),
    removeItem: (k) => m.delete(k),
  };
  save("expense", [expense]);
  save("remittance", [remit]);
  importRows("expense", [expense, { ...expense, id: "y" }]);
  assert.equal(load("expense").length, 2);
  importRows("expense", [], "replace");
  assert.equal(load("expense").length, 0);
  assert.equal(restore("expense").length, 2);
  assert.equal(load("remittance").length, 1);
});
test("three-sheet XLSX and safe CSV", async () => {
  const data = await xlsx("expense", [expense]).arrayBuffer();
  assert.equal(new DataView(data).getUint32(0), 0x504b0304);
  assert.ok(new TextDecoder().decode(data).includes("年度记录"));
  assert.ok(
    csv("expense", [{ ...expense, note: "=SUM(A1)" }]).includes("'=SUM(A1)"),
  );
});

import {
  readBooks,
  balances,
  fullBackup,
  parseFullBackup,
  importBooks,
  clearBooks,
  reportXlsx,
} from "../src/lib/ledger.js";
test("full backup validates each book and bulk writes roll back failures", () => {
  const m = new Map();
  let fail = "";
  globalThis.localStorage = {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => {
      if (k === fail) throw Error("quota");
      m.set(k, v);
    },
    removeItem: (k) => m.delete(k),
  };
  const books = {
    income: [{ ...expense, id: "i", amount: 5000 }],
    expense: [{ ...expense, amount: 1800 }],
    remittance: [{ ...remit, amount: 1000, cny: 7200 }],
  };
  const normalized = parseFullBackup(JSON.stringify(fullBackup(books)));
  assert.deepEqual(balances(normalized), [5000, 1800, 3200, 1000, 2200, 7200]);
  assert.throws(() => parseFullBackup(backup("expense", books.expense)));
  fail = "openaa_life_ledger_v1_remittance";
  assert.throws(() => importBooks(books));
  assert.equal(m.size, 0);
  fail = "";
  importBooks(books);
  importBooks(books);
  assert.deepEqual(readBooks(), normalized);
  clearBooks(["expense"]);
  assert.equal(load("expense").length, 0);
  assert.equal(load("income").length, 1);
  assert.throws(() => restore("expense"));
  clearBooks(["income", "remittance"]);
  assert.equal(m.size, 0);
});
test("report scopes and 15-sheet full workbook", async () => {
  const books = { expense: [expense], income: [], remittance: [remit] };
  const xml = async (kind) =>
    new TextDecoder().decode(
      await reportXlsx(kind, books, "2025", "2025年").arrayBuffer(),
    );
  const summary = await xml("summary");
  assert.ok(!summary.includes("午餐"));
  assert.ok(summary.includes("全部年份"));
  assert.ok(summary.includes("<v>715.47</v>"));
  assert.equal((summary.match(/<sheet name=/g) || []).length, 1);
  const single = await xml("expense");
  assert.equal((single.match(/<sheet name=/g) || []).length, 4);
  const all = await xml("all");
  assert.equal((all.match(/<sheet name=/g) || []).length, 15);
  for (const name of ["开支", "收入", "汇款"])
    for (const suffix of ["汇总", "明细", "月度汇总", "年度汇总"])
      assert.ok(all.includes('sheet name="' + name + suffix + '"'));
  assert.ok(all.includes("2026-11"));
});
