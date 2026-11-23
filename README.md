# UST Weekly Desk

美债收益率曲线、美国经济数据与拍卖日历。日程为纽约时间，收益率为美国财政部日终平价收益率。
经济数据情景同时显示超预期和低于预期的传导路径，可填写一致预期与假设发布值。部分通胀事件显示同口径的 Cleveland Fed 模型参考。
官方发布值目前自动采集 CPI、PPI、非农、PCE、GDP 和国债拍卖。缺失值保留为空。

GitHub Actions 工作日 08:07 至 16:52 ET 每 15 分钟尝试核对近端数据，周日 18:07 ET 同时查未来八周。官方来源尚未公布的日期按来源显示为暂无；部分更新失败时保留缓存。仅在数据有变化时自动发布。

本地环境需要 Node.js 24 和 pnpm 11。运行 `pnpm install --frozen-lockfile` 和 `pnpm run build`，使用静态 HTTP 服务器打开 `dist/`。
手工刷新用 `pnpm run refresh`，指定单个周次用 `pnpm run refresh YYYY-MM-DD`（周一）。
