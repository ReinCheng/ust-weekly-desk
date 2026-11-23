# UST Weekly Desk

美国国债收益率曲线（3M–30Y 名义平价曲线 + TIPS 实际利率与 Breakeven）、美国宏观经济数据、国债拍卖日历与超预期情景分析。

- **多时区 & Liquid Glass 界面**：原始日程按纽约时间校准，支持一键切换纽约 / 北京 / 本地时间与浅色 / 深色 Liquid Glass 主题；情景输入自动保存在浏览器本地。
- **官方数据自动采集**：覆盖 CPI、PPI、非农、JOLTS、ECI、PCE（含同比与实际消费）、GDP 及国债拍卖结果（中标收益率/实际收益率、投标倍数、一级交易商/间接/直接获配占比）。
- **交易台微结构与情景推演**：同时支持数值型宏观/拍卖与 FOMC 决议/纪要情景，展示上期前值、Cleveland Fed 通胀模型参考、偏差幅度分级与 6 维微结构清单。
- **自动排程更新**：GitHub Actions 工作日 08:07–16:52 ET 每 15 分钟核对近端数据，17:25 / 18:25 ET 补抓日终曲线，周日 18:07 ET 同步未来八周，仅在数据有变化时发布。

本地开发需要 Node.js 24 和 pnpm 11：运行 `pnpm install --frozen-lockfile` 与 `pnpm run build`，用静态 HTTP 服务器打开 `dist/`。
手工刷新数据用 `pnpm run refresh`，刷新指定周次用 `pnpm run refresh YYYY-MM-DD`（周一）。
