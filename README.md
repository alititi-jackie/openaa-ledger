# OpenAA 生活收支账本

独立试用项目。开支、收入、汇款分开记，按月、按年或按全部历史查看美元结余和汇款人民币总额。

**接手开发先读 [开发记录](docs/开发记录.md)**。其中记载已确认的页面、计算口径、旧账导入、测试证据和迁移条件。

使用 Node 22.12 或更新版本，先执行 `npm ci`。日常开发执行 `npm start`；运行 `npm test` 检查数据层；执行 `npm run build` 生成 dist，再运行 `npm run dev -- --port 4173` 预览生产构建。入口为 /usa/life-ledger/。

生产预览运行期间可用 `npx playwright install chromium` 和 `npm run test:browser` 运行端到端验收。可通过 LEDGER_TEST_URL 指定预览地址，或用 CHROMIUM_PATH 指定本机 Chromium。
