import { test, expect, chromium } from "@playwright/test";
const origin = process.env.LEDGER_TEST_URL || "http://127.0.0.1:4173";
test("手机端录入、跨年查看、编辑、备份、汇款、汇总与离线重开", async () => {
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {},
  );
  try {
    const context = await browser.newContext({
      viewport: { width: 375, height: 720 },
      acceptDownloads: true,
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.accept());
    const click = (action) =>
      page.locator('[data-action="' + action + '"]').click();
    const book = (k) => page.locator('[data-book="' + k + '"]').click();
    const section = (k) => page.locator('[data-page="' + k + '"]').click();
    const period = (k) => page.locator('[data-period="' + k + '"]').click();
    const field = (k) => page.locator('[name="' + k + '"]');
    await page.goto(origin);
    await expect(page.locator(".home-card")).toHaveCount(3);
    for (const [kind, value, date] of [
      ["expense", "1800", "2025-12-31"],
      ["income", "5000", "2025-12-31"],
      ["remittance", "1000", "2025-12-31"],
      ["income", "12", "2026-01-01"],
    ]) {
      await book(kind);
      await section("form");
      await field("date").fill(date);
      await field("usd").fill(value);
      const rect = await field("date").boundingBox();
      expect(rect.x + rect.width).toBeLessThanOrEqual(375);
      if (kind !== "remittance") {
        await expect(page.locator('input[type="radio"]:checked')).toHaveCount(0);
        await page.getByRole("button", {name: "保存", exact: true}).click();
        await expect(page.locator("#error-method")).toHaveText(kind === "income" ? "请选择收款方式" : "请选择支付方式");
        await page.getByText("银行卡", {exact: true}).click();
        if (kind === "expense") {
          await page.getByRole("button", {name: "保存", exact: true}).click();
          await expect(page.locator("#error-category")).toHaveText("请选择开支分类");
          await page.getByText("餐饮", {exact: true}).click();
        }
      }
      if (kind === "remittance") {
        await field("rate").fill("7.2");
        await expect(field("cny")).toHaveValue("7200.00");
        await field("cny").fill("7100");
        await expect(field("rate")).toHaveValue("7.100");
        await field("cny").fill("7200");
      }
      await page.getByRole("button", { name: "保存", exact: true }).click();
      await expect(page.locator(".home-card")).toHaveCount(3);
    }
    await book("summary");
    await field("month").fill("2025-12");
    await expect(page.locator(".balance")).toContainText("$2,200.00");
    await expect(page.locator(".balance")).toContainText("¥7,200.00");
    await period("year");
    await field("year").selectOption("2026");
    await expect(page.locator(".balance")).toContainText("$12.00");
    await period("all");
    await expect(page.locator(".balance")).toContainText("$2,212.00");
    await book("expense");
    await section("view");
    await period("year");
    await field("year").selectOption("2025");
    await page.locator("summary").click();
    await click("edit");
    await expect(page.getByRole("radio", {name:"银行卡"})).toBeChecked();
    await expect(page.getByRole("radio", {name:"餐饮"})).toBeChecked();
    await field("usd").fill("1801");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(field("year")).toHaveValue("2025");
    await expect(page.locator(".stats")).toContainText("$1,801.00");
    await click("back");
    await section("export");
    await click("copy");
    await expect(page.locator("#site-status")).toContainText("已复制");
    const downloaded = page.waitForEvent("download");
    await click("backup");
    const backup = await downloaded;
    const path = await backup.path();
    await page.getByText("导入备份", {exact:true}).click();
    await field("file").setInputFiles(path);
    await click("merge");
    await click("back");
    await section("view");
    await page.locator("summary").click();
    await click("delete");
    await expect(page.locator(".stats")).toContainText("0 笔");
    await click("back");
    await section("export");
    await page.getByText("导入备份", {exact:true}).click();
    await click("restore");
    await click("back");
    await section("view");
    await expect(page.locator(".stats")).toContainText("$1,801.00");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await context.setOffline(true);
    await page.reload();
    await section("view");
    await period("all");
    await expect(page.locator(".stats")).toContainText("$1,801.00");
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
});

test("三种显示版本、刷新记忆和导入范围不受隐藏导航影响", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await page.goto(origin);
  const modes = page.locator(".ledger-mode [data-display-mode]");
  await expect(modes).toHaveCount(3);
  await expect(page.locator('[data-display-mode="full"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".book [data-book]")).toHaveCount(4);
  const widths = await modes.evaluateAll(elements => elements.map(el => el.getBoundingClientRect()));
  expect(widths[0].top).toBe(widths[1].top);
  expect(widths[1].top).toBe(widths[2].top);
  expect(widths[2].right).toBeLessThanOrEqual(375);
  await page.locator('[data-display-mode="expense"]').click();
  await expect(page.locator(".book")).toHaveCount(0);
  await expect(page.locator(".ledger-content h1")).toHaveText("开支账本");
  await page.reload();
  await expect(page.locator('[data-display-mode="expense"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator('[data-display-mode="remittance"]').click();
  await expect(page.locator(".ledger-content h1")).toHaveText("汇款账本");
  await page.locator('[data-page="export"]').click();
  await expect(page.getByText("导入备份", { exact: true })).toBeVisible();
  await page.locator('[data-action="back"]').click();
  await page.locator('[data-display-mode="full"]').click();
  await expect(page.locator(".book [data-book]")).toHaveCount(4);
  await expect(page.locator(".ledger-content h1")).toHaveText("汇款账本");
  await expect(page.getByRole("heading", { name: "常见问题" })).toBeVisible();
});
