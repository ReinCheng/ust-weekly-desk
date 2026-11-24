import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowDown, ArrowUp, BarChart3, ExternalLink, RefreshCw } from "lucide-react";
import { dateInZone, instruments, loadMarketQuotes, marketGroups, quoteRefreshMs, type MarketGroup, type Quote } from "./market-data";
import { alignMoves, correlation, historyAssets, summarizeMoves, type HistoryAsset, type MarketHistory } from "./market-stats";
import { tzIana, tzShortTag, type TzMode } from "./model";

const allInstruments = marketGroups.flatMap(group => instruments[group]);
const quoteLink = (symbol: string) => "https://www.cnbc.com/quotes/" + encodeURIComponent(symbol);
const windows = [20, 60, 120] as const;
const signed = (num: number, digits = 2) => (num > 0 ? "+" : "") + num.toFixed(digits);
const changeTone = (value: number | null) => value === null || value === 0 ? "" : value > 0 ? "market-up" : "market-down";
const movement = (value: number | null, unit: "%" | "bp") => value === null ? "—" : signed(value, unit === "bp" ? 1 : 2) + (unit === "bp" ? " bp" : "%");

function stamp(iso: string, tz: TzMode) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: tzIana(tz), month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(iso)) + " " + tzShortTag(tz);
}

function useRefresh<T>(load: (signal: AbortSignal) => Promise<T>, merge?: (previous: T | null, next: T) => T) {
  const [result, setResult] = useState<T | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const reload = useRef<() => void>(() => {});
  useEffect(() => {
    let controller: AbortController | undefined;
    const check = async () => {
      if (document.hidden) return;
      controller?.abort();
      const request = new AbortController();
      controller = request;
      setBusy(true);
      try {
        const next = await load(request.signal);
        if (request.signal.aborted) return;
        setResult(previous => merge ? merge(previous, next) : next);
        setCheckedAt(new Date().toISOString());
        setError(false);
      } catch {
        if (!request.signal.aborted) setError(true);
      } finally {
        if (!request.signal.aborted) setBusy(false);
      }
    };
    reload.current = () => void check();
    void check();
    const timer = window.setInterval(check, quoteRefreshMs);
    document.addEventListener("visibilitychange", check);
    return () => {
      controller?.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [load, merge]);
  return { result, busy, error, checkedAt, refresh: () => reload.current() };
}

type QuoteBook = { rows: Quote[]; received: string[] };
async function loadQuoteBook(signal: AbortSignal): Promise<QuoteBook> {
  const rows = await loadMarketQuotes(signal);
  if (!rows.length) throw new Error("No quotes");
  return { rows, received: rows.map(quote => quote.symbol) };
}

function mergeQuoteBook(previous: QuoteBook | null, next: QuoteBook): QuoteBook {
  const rows = new Map(previous?.rows.map(quote => [quote.symbol, quote]));
  for (const incoming of next.rows) {
    const old = rows.get(incoming.symbol);
    if (!old || incoming.tradingDate > old.tradingDate ||
        (incoming.tradingDate === old.tradingDate && (!incoming.dateOnly && incoming.asOf >= old.asOf || old.dateOnly))) {
      rows.set(incoming.symbol, incoming);
    }
  }
  return { rows: [...rows.values()], received: next.received };
}

export function MarketsView({ tz, onStatistics }: { tz: TzMode; onStatistics: () => void }) {
  const { result, busy, error, checkedAt, refresh } = useRefresh(loadQuoteBook, mergeQuoteBook);
  const [filter, setFilter] = useState<MarketGroup | "全部">("全部");
  const [order, setOrder] = useState("market");
  const bySymbol = new Map(result?.rows.map(quote => [quote.symbol, quote]));
  const received = new Set(error ? [] : result?.received);
  const now = new Date();
  const groups = filter === "全部" ? marketGroups : [filter];
  const rowsFor = (assets: typeof allInstruments) => assets.map(asset => {
    const quote = bySymbol.get(asset.symbol);
    const current = quote?.tradingDate === dateInZone(now, asset.zone);
    return { asset, quote, current, cached: Boolean(quote && !received.has(asset.symbol)) };
  });
  const currentRows = rowsFor(groups.flatMap(group => instruments[group]))
    .filter(row => row.current && !row.cached && row.quote?.change != null);
  const up = currentRows.filter(row => row.quote!.change! > 0).length;
  const down = currentRows.filter(row => row.quote!.change! < 0).length;
  const unchanged = currentRows.length - up - down;
  const coverage = result?.received.length ?? 0;
  const headlineSymbols = [".SPX", ".DXY", "US10Y", "@CL.1", "@GC.1"];
  const headline = rowsFor(headlineSymbols.map(symbol => allInstruments.find(asset => asset.symbol === symbol)!));

  return <div className="market-page">
    <section className="panel glass market-overview" aria-label="全球市场速览">
      <div className="market-section-head">
        <div><h2>全球市场速览</h2><p>按各市场当地日期标记当日行情。变动以来源的前收或结算为基准。</p></div>
        <div className="market-actions">
          <button type="button" className="action" onClick={onStatistics}><BarChart3 size={15} />相关性与统计</button>
          <button type="button" className="action" disabled={busy} onClick={refresh}><RefreshCw size={15} className={busy ? "spin" : ""} />刷新行情</button>
        </div>
      </div>
      <div className="market-headline">
        {headline.map(({ asset, quote, current, cached }) =>
          <div className="market-headline-tile" key={asset.symbol}>
            <span>{asset.name}</span>
            <strong className={changeTone(quote?.change ?? null)}>{movement(quote?.change ?? null, asset.unit === "%" ? "bp" : "%")}</strong>
            <small>{!quote ? "暂无报价" : cached ? "沿用上次" : current ? quote.delayed ? "当日 · 延时" : "当日" : "前次 · " + quote.tradingDate.slice(5)}</small>
          </div>)}
      </div>
      <div className="market-live-status" aria-live="polite">
        <span>{error ? "本次报价请求失败，保留本页已有报价。" : busy && !result ? "正在读取报价…" :
          "最近检查 " + (checkedAt ? stamp(checkedAt, tz) : "—") + " · 收到 " + coverage + "/" + allInstruments.length}</span>
        <span>页面可见时每 2 分钟检查 · <a href="https://www.cnbc.com/markets/" target="_blank" rel="noreferrer">CNBC 行情 <ExternalLink size={12} /></a></span>
      </div>
    </section>

    <section className="panel glass market-board" aria-label="跨资产行情">
      <div className="market-toolbar">
        <div className="chips" role="group" aria-label="资产类别">
          {(["全部", ...marketGroups] as const).map(group =>
            <button type="button" className="chip" key={group} aria-pressed={filter === group} onClick={() => setFilter(group)}>{group}</button>)}
        </div>
        <label>排序<select value={order} onChange={event => setOrder(event.target.value)}>
          <option value="market">市场顺序</option><option value="move">按组内涨跌排序</option>
        </select></label>
      </div>
      <div className="market-breadth">
        <span>本筛选 · 当地当日有变动数据 {currentRows.length} 项</span>
        <span className="market-up"><ArrowUp size={13} />上涨 {up}</span>
        <span className="market-down"><ArrowDown size={13} />下跌 {down}</span>
        <span>持平 {unchanged}</span>
      </div>
      {groups.map(group => {
        const rows = rowsFor(instruments[group]);
        const sections = group === "利率与波动率" ? [rows.filter(row => row.asset.unit === "%"), rows.filter(row => row.asset.unit !== "%")] : [rows];
        return <section key={group} className="market-group">
          <h3>{group}</h3>
          <div className="market-table-wrap">
            <table className="market-table">
              <thead><tr><th scope="col">品种</th><th scope="col">最新值</th><th scope="col">变动</th><th scope="col">报价时间</th></tr></thead>
              <tbody>{sections.flatMap(batch => {
                const ordered = order === "move" ? [...batch].sort((a, b) => (b.quote?.change ?? -Infinity) - (a.quote?.change ?? -Infinity)) : batch;
                const scale = Math.max(0.01, ...batch.map(row => Math.abs(row.quote?.change ?? 0)));
                return ordered.map(({ asset, quote, current, cached }) => {
                  const move = quote?.change ?? null;
                  const rate = asset.unit === "%";
                  return <tr key={asset.symbol} data-symbol={asset.symbol} className={quote && !current ? "market-prior" : undefined}>
                    <th scope="row"><a href={quoteLink(asset.symbol)} target="_blank" rel="noreferrer">{asset.name}</a>
                      <small>{asset.region}{quote?.contract ? " · " + quote.contract : ""}</small></th>
                    <td>{quote ? quote.last.toLocaleString("en-US", { minimumFractionDigits: asset.digits, maximumFractionDigits: asset.digits }) : "—"}
                      <small>{asset.unit}</small></td>
                    <td className={changeTone(move)}>
                      <strong>{movement(move, rate ? "bp" : "%")}</strong>
                      {move !== null && <span className="market-bar" aria-hidden="true"><i style={{ width: (Math.abs(move) / scale * 100) + "%" }} /></span>}
                    </td>
                    <td>{quote ? (quote.dateOnly ? quote.tradingDate : stamp(quote.asOf, tz)) : "暂无"}
                      {quote && <small>{[!current && "前次", cached && "沿用上次", quote.delayed && "延时", quote.dateOnly && "仅日期"].filter(Boolean).join(" · ") || "当日"}</small>}</td>
                  </tr>;
                });
              })}</tbody>
            </table>
          </div>
        </section>;
      })}
    </section>
  </div>;
}

async function loadHistory(signal: AbortSignal): Promise<MarketHistory> {
  const response = await fetch("./market-history.json", { signal, cache: "no-cache" });
  if (!response.ok) throw new Error("Market history unavailable");
  const history = await response.json() as MarketHistory;
  if (!history.series || !Number.isFinite(Date.parse(history.updatedAt))) throw new Error("Invalid market history");
  return history;
}

type Dot = [x: number, y: number];
function MarketChart({ points, kind, label, xLabel, yLabel, corrScale = false, accent }: {
  points: Dot[]; kind: "scatter" | "line"; label: string; xLabel: string; yLabel: string; corrScale?: boolean; accent?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || points.length < 2) return;
    const draw = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const width = canvas.clientWidth, height = canvas.clientHeight, ratio = window.devicePixelRatio || 1;
      if (!width || !height) return;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      ctx.scale(ratio, ratio);
      const colors = getComputedStyle(canvas);
      const grid = colors.getPropertyValue("--svg-grid").trim();
      const text = colors.getPropertyValue("--muted").trim();
      const foreground = accent ?? colors.getPropertyValue("--accent").trim();
      const left = 53, right = width - 14, top = 14, bottom = height - 43;
      const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
      const pad = (min: number, max: number) => Math.max((max - min) * 0.08, min === max ? Math.max(Math.abs(min) * 0.05, 0.1) : 0);
      const minX = Math.min(...xs), maxX = Math.max(...xs), dx = pad(minX, maxX);
      const minY = corrScale ? -1 : Math.min(...ys), maxY = corrScale ? 1 : Math.max(...ys);
      const dy = corrScale ? 0 : pad(minY, maxY);
      const x = (value: number) => left + (value - minX + dx) / (maxX - minX + 2 * dx) * (right - left);
      const y = (value: number) => bottom - (value - minY + dy) / (maxY - minY + 2 * dy) * (bottom - top);
      ctx.font = "11px system-ui";
      ctx.strokeStyle = grid;
      ctx.fillStyle = text;
      for (let i = 0; i <= 4; i++) {
        const value = minY - dy + i / 4 * (maxY - minY + 2 * dy);
        ctx.beginPath(); ctx.moveTo(left, y(value)); ctx.lineTo(right, y(value)); ctx.stroke();
        ctx.fillText(value.toFixed(1), 6, y(value) + 4);
      }
      if (kind === "scatter") {
        for (let i = 0; i <= 4; i++) {
          const value = minX - dx + i / 4 * (maxX - minX + 2 * dx);
          const tick = value.toFixed(1);
          const offset = i === 0 ? 0 : i === 4 ? ctx.measureText(tick).width : ctx.measureText(tick).width / 2;
          ctx.fillText(tick, x(value) - offset, bottom + 14);
        }
        if (minX < 0 && maxX > 0) { ctx.beginPath(); ctx.moveTo(x(0), top); ctx.lineTo(x(0), bottom); ctx.stroke(); }
      }
      if (minY < 0 && maxY > 0) { ctx.beginPath(); ctx.moveTo(left, y(0)); ctx.lineTo(right, y(0)); ctx.stroke(); }
      ctx.fillText(xLabel, left, height - 7);
      ctx.strokeStyle = foreground;
      ctx.fillStyle = foreground;
      if (kind === "scatter") {
        ctx.globalAlpha = 0.66;
        for (const [vx, vy] of points) { ctx.beginPath(); ctx.arc(x(vx), y(vy), 3.3, 0, 2 * Math.PI); ctx.fill(); }
        ctx.globalAlpha = 1;
      } else {
        ctx.lineWidth = 2;
        ctx.beginPath();
        points.forEach(([vx, vy], i) => i ? ctx.lineTo(x(vx), y(vy)) : ctx.moveTo(x(vx), y(vy)));
        ctx.stroke();
      }
    };
    draw();
    const size = new ResizeObserver(draw);
    size.observe(canvas);
    const theme = new MutationObserver(draw);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => { size.disconnect(); theme.disconnect(); };
  }, [points, kind, xLabel, yLabel, corrScale, accent]);
  return <figure className="market-chart">
    <figcaption>{yLabel}</figcaption>
    {points.length >= 2 ? <canvas ref={ref} role="img" aria-label={label} /> : <p>样本不足</p>}
  </figure>;
}

export function MarketStatistics({ tz }: { tz: TzMode }) {
  const { result, busy, error, refresh } = useRefresh(loadHistory);
  const [window, setWindow] = useState<number>(60);
  const [method, setMethod] = useState<"pearson" | "spearman">("pearson");
  const [selected, setSelected] = useState(["spx", "us10y"]);
  const [detail, setDetail] = useState("spx");
  const assets = useMemo(() => historyAssets.filter(asset => result?.series[asset.id]?.length), [result]);
  const x = assets.find(asset => asset.id === selected[0]);
  const y = assets.find(asset => asset.id === selected[1]);
  const active = assets.find(asset => asset.id === detail);
  const pair = (a: HistoryAsset, b: HistoryAsset, count = window) => alignMoves(result?.series[a.id] ?? [], result?.series[b.id] ?? [], count);
  const measure = (samples: ReturnType<typeof alignMoves>) => correlation(samples.map(row => row.x), samples.map(row => row.y), method);
  const extended = x && y ? pair(x, y, window + 19) : [];
  const matched = extended.slice(-window);
  const coefficient = measure(matched);
  const rolling: Dot[] = [];
  for (let i = 19; i < extended.length; i++) {
    const point = measure(extended.slice(i - 19, i + 1));
    if (point !== null) rolling.push([i, point]);
  }
  const summaries = assets.map(asset => ({ asset, stats: summarizeMoves(result!.series[asset.id], window, asset)! }));
  const report = summaries.find(row => row.asset.id === detail)?.stats;
  const latestDate = summaries.map(row => row.stats.end).sort().at(-1);
  return <div className="market-page">
    <section className="panel glass market-stats" aria-label="跨资产相关性">
      <div className="market-section-head">
        <div><h2>跨资产相关性</h2><p>每组只比较两个端点日期都一致的变化，不用缺失报价补零。</p></div>
        <button type="button" className="action" disabled={busy} onClick={refresh}><RefreshCw size={14} className={busy ? "spin" : ""} />更新日线快照</button>
      </div>
      {error && <p className="market-alert" role="status">{result ? "读取失败，保留上次日线快照。" : "暂时无法载入日线快照。"}</p>}
      {!result && busy && <p>正在读取日线快照…</p>}
      {result && <>
        <div className="market-toolbar">
          <div className="chips" role="group" aria-label="样本窗口">
            {windows.map(count => <button key={count} type="button" className="chip" aria-pressed={window === count} onClick={() => setWindow(count)}>{count} 个观测</button>)}
          </div>
          <label>相关系数<select value={method} onChange={event => setMethod(event.target.value as typeof method)}>
            <option value="pearson">Pearson · 线性</option><option value="spearman">Spearman · 秩</option>
          </select></label>
        </div>
        <p className="market-caption">日线快照 {stamp(result.updatedAt, tz)} · 最新观测 {latestDate ?? "—"} · {assets.length} 个序列 · 按日更新</p>
        <div className="market-matrix-scroll" tabIndex={0} aria-label="可横向滚动的相关性矩阵">
          <table className="market-matrix"><thead><tr><th scope="col">品种</th>{assets.map(asset => <th scope="col" key={asset.id}>{asset.short}</th>)}</tr></thead>
            <tbody>{assets.map(a => <tr key={a.id}><th scope="row">{a.short}</th>{assets.map(b => {
              const sample = pair(a, b);
              const value = measure(sample);
              const chosen = a.id === selected[0] && b.id === selected[1];
              const strength = value === null ? 0 : Math.round(Math.abs(value) * 65);
              return <td key={b.id}>
                <button type="button" disabled={value === null} aria-pressed={chosen}
                  aria-label={a.short + " 与 " + b.short + "，" + (value?.toFixed(2) ?? "样本不足") + "，样本 " + sample.length}
                  className={value !== null && value < 0 ? "market-heat negative" : "market-heat"}
                  style={{ backgroundColor: "color-mix(in srgb, var(--heat-color) " + strength + "%, var(--bg-b))" }}
                  onClick={() => setSelected([a.id, b.id])}>{value?.toFixed(2) ?? "—"}</button>
              </td>;
            })}</tr>)}</tbody></table>
        </div>
        <details className="study-details"><summary>怎么看这张表</summary><p>越接近 +1 表示同向变动越一致，越接近 −1 表示反向变动越一致。价格及指数用百分比变化，收益率用基点变化。不同市场的每日定盘时刻可能不同。每一对至少需要 12 个匹配观测，常数序列没有相关系数。商品日线用 EIA 现货，行情板显示前月期货。</p></details>
      </>}
    </section>
    {x && y && <section className="panel glass market-stats" aria-label="配对详情">
      <div className="market-section-head">
        <div><h2>{x.short} × {y.short}</h2><p>{method === "pearson" ? "Pearson" : "Spearman"} <b>{coefficient?.toFixed(3) ?? "—"}</b> · 匹配 {matched.length} / {window} · {matched[0]?.previous ?? "—"} 至 {matched.at(-1)?.date ?? "—"}</p></div>
        <div className="market-actions">
          {[x, y].map((asset, index) => <label key={index}>{index === 0 ? "横轴" : "纵轴"}<select value={asset.id} onChange={event => setSelected(keys => keys.map((key, i) => i === index ? event.target.value : key))}>
            {assets.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select></label>)}
        </div>
      </div>
      <div className="market-chart-grid">
        <MarketChart kind="scatter" points={matched.map(row => [row.x, row.y])} xLabel={x.short + " (" + x.unit + ")"} yLabel={y.short + " (" + y.unit + ") · 日变动散点"} label={x.short + " 与 " + y.short + "日变化散点"} />
        <MarketChart kind="line" points={rolling} corrScale xLabel={(extended[19]?.date ?? "—") + " 至 " + (extended.at(-1)?.date ?? "—")} yLabel="滚动 20 个匹配观测的相关系数" label="滚动二十个匹配观测的相关系数曲线" />
      </div>
      <div className="market-pair-sources">{[x, y].map((asset, index) => <a key={index} href={asset.url} target="_blank" rel="noreferrer">{asset.label} · {asset.source} <ExternalLink size={12} /></a>)}</div>
    </section>}
    {result && <section className="panel glass market-stats" aria-label="单项统计">
      <div className="market-section-head">
        <div><h2>单项日线统计</h2><p>收益率的累计变动以 bp 相加。价格及指数变化用复利，最大回撤以初始值与后续峰值为基准。</p></div>
        {active && <label>选择序列<select value={detail} onChange={event => setDetail(event.target.value)}>{assets.map(asset => <option key={asset.id} value={asset.id}>{asset.label}</option>)}</select></label>}
      </div>
      {active && report && <>
        <p className="market-caption">{active.label} · {report.start} 至 {report.end} · n = {report.count} · <a href={active.url} target="_blank" rel="noreferrer">{active.source}</a></p>
        <div className="market-metrics">
          <div><span>累计变动</span><strong className={changeTone(report.total)}>{movement(report.total, active.unit)}</strong></div>
          <div><span>日变动均值</span><strong>{movement(report.average, active.unit)}</strong></div>
          <div><span>日变动中位数</span><strong>{movement(report.median, active.unit)}</strong></div>
          <div><span>{active.unit === "%" ? "年化波动率" : "日变动标准差"}</span><strong>{report.volatility !== null ? report.volatility.toFixed(2) + "%" : report.deviation !== null ? report.deviation.toFixed(2) + " bp" : "—"}</strong></div>
          <div><span>最大回撤</span><strong>{report.drawdown === null ? "—" : report.drawdown.toFixed(2) + "%"}</strong></div>
          <div><span>上升日比例</span><strong>{report.positive.toFixed(1)}%</strong></div>
          <div><span>最弱 / 最强日</span><strong>{movement(report.lowest, active.unit)} / {movement(report.highest, active.unit)}</strong></div>
          <div><span>最新变化 Z 值</span><strong>{report.z === null ? "—" : signed(report.z)}</strong></div>
        </div>
        <MarketChart points={report.path.map((level, i) => [i, level])} kind="line"
          xLabel={report.start + " 至 " + report.end} yLabel={active.unit === "%" ? "起始值 = 100" : "相对起始收益率（bp）"}
          label={active.label + "选定窗口的累计变化"} />
        <details className="study-details"><summary>统计口径</summary><p>Z 值将最新一次变化与窗口内其余观测比较。年化波动率用日变动的样本标准差乘以 √252，BTC/USD 使用 √365。小样本、极端值和不同定盘时点均会影响结果。</p></details>
      </>}
      <details className="study-details">
        <summary>比较全部序列</summary>
        <div className="market-table-wrap"><table className="market-table">
          <thead><tr><th scope="col">日线序列</th><th scope="col">累计变动</th><th scope="col">最新 Z 值</th><th scope="col">截至 / 样本</th></tr></thead>
          <tbody>{summaries.map(({ asset, stats }) => <tr key={asset.id}>
            <th scope="row"><button type="button" className="market-series-button" aria-pressed={detail === asset.id} onClick={() => setDetail(asset.id)}>{asset.label}</button></th>
            <td className={changeTone(stats.total)}>{movement(stats.total, asset.unit)}</td>
            <td>{stats.z === null ? "—" : signed(stats.z)}</td>
            <td>{stats.end} <small>{stats.count} 个观测</small></td>
          </tr>)}</tbody>
        </table></div>
      </details>
    </section>}
  </div>;
}
