export type HistoryMove = [date: string, previous: string, move: number];
export type MarketHistory = { updatedAt: string; series: Record<string, HistoryMove[]> };
export type HistoryAsset = { id: string; label: string; short: string; unit: "%" | "bp"; source: string; url: string; calendarDays?: boolean };
const cboe = "https://cdn.cboe.com/api/global/us_indices/daily_prices/";
const treasury = "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve";
const fx = "https://data.ecb.europa.eu/data/datasets/EXR";

export const historyAssets: HistoryAsset[] = [
  { id: "spx", label: "标普 500", short: "标普", unit: "%", source: "Cboe", url: cboe + "SPX_History.csv" },
  { id: "ndx", label: "纳斯达克 100", short: "纳指", unit: "%", source: "Nasdaq", url: "https://www.nasdaq.com/market-activity/index/ndx/historical" },
  { id: "rut", label: "罗素 2000", short: "罗素", unit: "%", source: "Cboe", url: cboe + "RUT_History.csv" },
  { id: "vix", label: "Cboe VIX", short: "VIX", unit: "%", source: "Cboe", url: "https://www.cboe.com/tradable_products/vix/vix_historical_data/" },
  { id: "us2y", label: "美债 2Y 平价收益率", short: "美债 2Y", unit: "bp", source: "美国财政部", url: treasury },
  { id: "us10y", label: "美债 10Y 平价收益率", short: "美债 10Y", unit: "bp", source: "美国财政部", url: treasury },
  { id: "eur", label: "EUR/USD（参考汇率）", short: "EUR/USD", unit: "%", source: "欧洲央行", url: fx },
  { id: "jpy", label: "USD/JPY（参考汇率）", short: "USD/JPY", unit: "%", source: "欧洲央行", url: fx },
  { id: "gbp", label: "GBP/USD（参考汇率）", short: "GBP/USD", unit: "%", source: "欧洲央行", url: fx },
  { id: "cny", label: "USD/CNY（参考汇率）", short: "USD/CNY", unit: "%", source: "欧洲央行", url: fx },
  { id: "aud", label: "AUD/USD（参考汇率）", short: "AUD/USD", unit: "%", source: "欧洲央行", url: fx },
  { id: "chf", label: "USD/CHF（参考汇率）", short: "USD/CHF", unit: "%", source: "欧洲央行", url: fx },
  { id: "wti", label: "WTI 原油现货", short: "WTI 现货", unit: "%", source: "美国 EIA", url: "https://www.eia.gov/dnav/pet/hist/rwtcD.htm" },
  { id: "brent", label: "布伦特原油现货", short: "布伦特现货", unit: "%", source: "美国 EIA", url: "https://www.eia.gov/dnav/pet/hist/rbrteD.htm" },
  { id: "gas", label: "Henry Hub 天然气现货", short: "天然气现货", unit: "%", source: "美国 EIA", url: "https://www.eia.gov/dnav/ng/hist/rngwhhdD.htm" },
  { id: "btc", label: "比特币 BTC/USD", short: "BTC", unit: "%", source: "Coinbase Exchange", url: "https://docs.cdp.coinbase.com/exchange/reference/exchangerestapi_getproductcandles", calendarDays: true },
];

export function dailyMoves(levels: [string, number][], unit: HistoryAsset["unit"]): HistoryMove[] {
  const sorted = [...new Map(levels.filter(([, value]) => Number.isFinite(value))).entries()].sort(([a], [b]) => a.localeCompare(b));
  return sorted.slice(1).flatMap(([date, value], i) => {
    const [previous, base] = sorted[i];
    if (unit === "%" && (value <= 0 || base <= 0)) return [];
    const move = unit === "bp" ? (value - base) * 100 : (value / base - 1) * 100;
    return [[date, previous, Number(move.toFixed(6))] satisfies HistoryMove];
  });
}

export function alignMoves(x: HistoryMove[], y: HistoryMove[], limit: number) {
  const byInterval = new Map(y.map(([date, previous, move]) => [date + "/" + previous, move]));
  return x.flatMap(([date, previous, move]) => {
    const match = byInterval.get(date + "/" + previous);
    return match === undefined ? [] : [{ date, previous, x: move, y: match }];
  }).slice(-limit);
}

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
function std(values: number[]) {
  if (values.length < 2) return null;
  const center = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - center) ** 2, 0) / (values.length - 1));
}

function ranks(values: number[]) {
  const ordered = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const result: number[] = [];
  for (let first = 0; first < ordered.length;) {
    let end = first + 1;
    while (end < ordered.length && ordered[end].value === ordered[first].value) end++;
    const rank = (first + 1 + end) / 2;
    for (let i = first; i < end; i++) result[ordered[i].index] = rank;
    first = end;
  }
  return result;
}

export function correlation(left: number[], right: number[], method: "pearson" | "spearman" = "pearson", min = 12) {
  if (left.length !== right.length || left.length < Math.max(min, 2)) return null;
  const x = method === "spearman" ? ranks(left) : left;
  const y = method === "spearman" ? ranks(right) : right;
  const mx = mean(x), my = mean(y);
  const xx = x.reduce((sum, value) => sum + (value - mx) ** 2, 0);
  const yy = y.reduce((sum, value) => sum + (value - my) ** 2, 0);
  if (xx === 0 || yy === 0) return null;
  const value = x.reduce((sum, point, i) => sum + (point - mx) * (y[i] - my), 0) / Math.sqrt(xx * yy);
  return Math.min(1, Math.max(-1, value));
}

export function summarizeMoves(rows: HistoryMove[], count: number, asset: HistoryAsset) {
  const sample = rows.slice(-count);
  if (!sample.length) return null;
  const values = sample.map(row => row[2]);
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const deviation = std(values);
  const latest = values.at(-1)!;
  const prior = values.slice(0, -1);
  const baseline = std(prior);
  let level = asset.unit === "%" ? 100 : 0;
  let peak = level;
  let drawdown = 0;
  const path = [level];
  for (const value of values) {
    level = asset.unit === "%" ? level * (1 + value / 100) : level + value;
    path.push(level);
    peak = Math.max(peak, level);
    if (asset.unit === "%") drawdown = Math.min(drawdown, (level / peak - 1) * 100);
  }
  return {
    count: sample.length, start: sample[0][1], end: sample.at(-1)![0], latest, path,
    total: asset.unit === "%" ? level - 100 : level,
    average: mean(values),
    median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    deviation, volatility: asset.unit === "%" && deviation !== null ? deviation * Math.sqrt(asset.calendarDays ? 365 : 252) : null,
    positive: values.filter(value => value > 0).length / values.length * 100,
    lowest: sorted[0], highest: sorted.at(-1)!,
    z: baseline ? (latest - mean(prior)) / baseline : null,
    drawdown: asset.unit === "%" ? drawdown : null,
  };
}
