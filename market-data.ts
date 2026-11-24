export const quoteEndpoint = "https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol";
export const quoteRefreshMs = 120_000;

export const marketGroups = ["股指", "外汇", "利率与波动率", "商品期货", "数字资产"] as const;
export type MarketGroup = typeof marketGroups[number];

type Instrument = { symbol: string; name: string; region: string; zone: string; unit: string; digits: number };
const ny = "America/New_York", london = "Europe/London", paris = "Europe/Paris", tokyo = "Asia/Tokyo";
const instrument = ([symbol, name, region, zone, unit = "点", digits = 2]: [string, string, string, string, string?, number?]): Instrument =>
  ({ symbol, name, region, zone, unit, digits });

export const instruments: Record<MarketGroup, Instrument[]> = {
  "股指": ([
    [".SPX", "标普 500", "美国", ny], [".NDX", "纳斯达克 100", "美国", ny],
    [".DJI", "道琼斯工业平均", "美国", ny], [".RUT", "罗素 2000", "美国", ny],
    [".STOXX50E", "欧洲斯托克 50", "欧元区", paris], [".STOXX", "斯托克欧洲 600", "欧洲", paris],
    [".GDAXI", "德国 DAX", "德国", "Europe/Berlin"], [".FTSE", "富时 100", "英国", london],
    [".FCHI", "法国 CAC 40", "法国", paris], [".N225", "日经 225", "日本", tokyo],
    [".HSI", "恒生指数", "香港", "Asia/Hong_Kong"], [".SSEC", "上证综指", "中国内地", "Asia/Shanghai"],
    [".KS11", "韩国 KOSPI", "韩国", "Asia/Seoul"], [".TWII", "台湾加权指数", "台湾", "Asia/Taipei"],
    [".AXJO", "澳洲 ASX 200", "澳大利亚", "Australia/Sydney"], [".NSEI", "印度 Nifty 50", "印度", "Asia/Kolkata"],
    [".BVSP", "巴西 Ibovespa", "巴西", "America/Sao_Paulo"],
  ] satisfies Parameters<typeof instrument>[0][]).map(instrument),
  "外汇": ([
    [".DXY", "美元指数 DXY", "美元篮子", ny, "点", 3],
    ["EUR=", "EUR/USD", "欧元兑美元", ny, "USD", 4], ["JPY=", "USD/JPY", "美元兑日元", ny, "JPY", 2],
    ["GBP=", "GBP/USD", "英镑兑美元", ny, "USD", 4], ["CNH=", "USD/CNH", "美元兑离岸人民币", ny, "CNH", 4],
    ["CNY=", "USD/CNY", "美元兑在岸人民币", ny, "CNY", 4], ["AUD=", "AUD/USD", "澳元兑美元", ny, "USD", 4],
    ["CHF=", "USD/CHF", "美元兑瑞郎", ny, "CHF", 4], ["CAD=", "USD/CAD", "美元兑加元", ny, "CAD", 4],
  ] satisfies Parameters<typeof instrument>[0][]).map(instrument),
  "利率与波动率": ([
    ["US2Y", "美债 2Y", "名义收益率", ny, "%", 3], ["US10Y", "美债 10Y", "名义收益率", ny, "%", 3],
    ["DE10Y", "德债 10Y", "名义收益率", "Europe/Berlin", "%", 3],
    ["GB10Y", "英债 10Y", "名义收益率", london, "%", 3],
    ["JP10Y", "日债 10Y", "名义收益率", tokyo, "%", 3],
    [".VIX", "Cboe VIX", "美国隐含波动率", ny], ["@TY.1", "美债 10Y 期货", "前月合约", ny, "点", 4],
  ] satisfies Parameters<typeof instrument>[0][]).map(instrument),
  "商品期货": ([
    ["@CL.1", "WTI 原油", "NYMEX 前月", ny, "USD/桶"],
    ["@LCO.1", "布伦特原油", "ICE 前月", london, "USD/桶"],
    ["@NG.1", "天然气", "NYMEX 前月", ny, "USD/MMBtu", 3],
    ["@GC.1", "黄金", "COMEX 前月", ny, "USD/盎司", 1],
    ["@SI.1", "白银", "COMEX 前月", ny, "USD/盎司", 3],
    ["@HG.1", "铜", "COMEX 前月", ny, "USD/磅", 4],
  ] satisfies Parameters<typeof instrument>[0][]).map(instrument),
  "数字资产": [instrument(["BTC.CM=", "比特币", "BTC/USD", "UTC", "USD"])],
};

export type Quote = {
  symbol: string;
  last: number;
  change: number | null;
  asOf: string;
  tradingDate: string;
  dateOnly: boolean;
  delayed: boolean;
  contract?: string;
};
type RawQuote = { symbol?: string; last?: string; previous_day_closing?: string; change?: string; last_time?: string; realTime?: string; altSymbol?: string };

export function marketNumber(raw?: string) {
  if (typeof raw !== "string" || !/^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?%?$/.test(raw.trim())) return null;
  const value = Number(raw.trim().replaceAll(",", "").replace("%", ""));
  return Number.isFinite(value) ? value : null;
}

export function dateInZone(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function parseQuote(raw: RawQuote, instrument: Instrument, now = new Date()): Quote | null {
  const last = marketNumber(raw.last);
  const stamp = raw.last_time;
  if (raw.symbol !== instrument.symbol || last === null || !stamp) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(stamp);
  if (!dateOnly && !/(?:Z|[+-]\d{2}:?\d{2})$/.test(stamp)) return null;
  const time = Date.parse(stamp);
  if (!Number.isFinite(time) || time > now.getTime() + 60_000) return null;
  if (dateOnly && new Date(time).toISOString().slice(0, 10) !== stamp) return null;
  const tradingDate = dateOnly ? stamp : dateInZone(new Date(time), instrument.zone);
  if (tradingDate > dateInZone(now, instrument.zone)) return null;
  const prev = marketNumber(raw.previous_day_closing);
  const stated = marketNumber(raw.change);
  const unchanged = raw.change?.trim().toUpperCase() === "UNCH";
  const delta = stated ?? (unchanged && !dateOnly ? 0 : (prev !== null && prev !== last ? last - prev : null));
  const base = delta !== null ? last - delta : null;
  const change = delta === null ? null : instrument.unit === "%" ? delta * 100 :
    base !== null && base > 0 && last > 0 ? delta / base * 100 : null;
  return {
    symbol: instrument.symbol, last, change,
    asOf: dateOnly ? stamp : new Date(time).toISOString(), tradingDate, dateOnly,
    delayed: raw.realTime !== "true", contract: instrument.symbol.startsWith("@") ? raw.altSymbol : undefined,
  };
}

export async function loadMarketQuotes(signal: AbortSignal) {
  const groups = Object.values(instruments);
  const fetched = await Promise.allSettled(groups.map(async group => {
    const url = new URL(quoteEndpoint);
    url.search = new URLSearchParams({
      symbols: group.map(asset => asset.symbol).join("|"), requestMethod: "itv",
      noform: "1", partnerId: "2", fund: "1", exthrs: "1", output: "json", _: String(Date.now()),
    }).toString();
    const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]), cache: "no-store" });
    if (!response.ok) throw new Error("Market quote " + response.status);
    const body = await response.json() as { FormattedQuoteResult?: { FormattedQuote?: RawQuote | RawQuote[] } };
    const list = body.FormattedQuoteResult?.FormattedQuote;
    const bySymbol = new Map((Array.isArray(list) ? list : list ? [list] : []).map(row => [row.symbol, row]));
    return group.flatMap(asset => {
      const raw = bySymbol.get(asset.symbol);
      const row = raw && parseQuote(raw, asset);
      return row ? [row] : [];
    });
  }));
  return fetched.flatMap(outcome => outcome.status === "fulfilled" ? outcome.value : []);
}
