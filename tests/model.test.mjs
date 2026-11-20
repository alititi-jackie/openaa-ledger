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
