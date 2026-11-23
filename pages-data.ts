import { tenors, type Calendar } from "./model";
import type { ReplayCatalog } from "./replay-model";

export type LiveCurve = {
  values: number[];
  prevValues: (number | null)[];
  asOf: string;
  fetchedAt: string;
  exchange: string;
};

const liveSymbols = ["US3M", "US1Y", "US2Y", "US3Y", "US5Y", "US7Y", "US10Y", "US20Y", "US30Y"] as const;

type CnbcQuote = {
  symbol?: string;
  last?: string;
  previous_day_closing?: string;
  change?: string;
  last_time?: string;
  exchange?: string;
};

function parseYield(raw: string | undefined): number | null {
  if (!raw) return null;
  const num = Number(raw.replace(/[%\s,+]/g, ""));
  return Number.isFinite(num) && num > 0 && num < 20 ? num : null;
}

export async function loadCalendars(signal?: AbortSignal) {
  const response = await fetch("./calendar.json?_=" + Date.now(), { cache: "no-store", signal });
  if (!response.ok) throw new Error("暂时无法载入发布日历。");
  return await response.json() as Record<string, Calendar>;
}

export async function loadReplays(signal?: AbortSignal) {
  const response = await fetch("./replays.json?_=" + Date.now(), { cache: "no-store", signal });
  if (!response.ok) throw new Error("暂时无法载入历史回放数据。");
  return await response.json() as ReplayCatalog;
}

export async function loadLiveCurve(signal?: AbortSignal): Promise<LiveCurve> {
  // Simple CORS GET (no custom headers) with cache-buster query param; CNBC/Tradeweb returns ACAO: *
  const url =
    "https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=" +
    liveSymbols.join("%7C") +
    "&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&_=" +
    Date.now();
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("Live UST quote HTTP " + response.status);
  const body = await response.json() as { FormattedQuoteResult?: { FormattedQuote?: CnbcQuote | CnbcQuote[] } };
  const rawList = body?.FormattedQuoteResult?.FormattedQuote;
  const quotes = Array.isArray(rawList) ? rawList : rawList ? [rawList] : [];
  const bySymbol = new Map(quotes.map(q => [q.symbol, q]));

  const values: number[] = [];
  const prevValues: (number | null)[] = [];
  let latestMs = 0;
  let asOf = new Date().toISOString();
  let exchange = "Tradeweb";

  for (const sym of liveSymbols) {
    const q = bySymbol.get(sym);
    const val = parseYield(q?.last);
    if (val === null) throw new Error("Missing live yield for " + sym);
    values.push(val);
    let prev = parseYield(q?.previous_day_closing);
    if (prev === null && q?.change) {
      const chg = Number(q.change.replace(/[%\s,]/g, ""));
      if (Number.isFinite(chg)) prev = Number((val - chg).toFixed(4));
    }
    prevValues.push(prev);
    if (q?.exchange) exchange = q.exchange;
    if (q?.last_time) {
      const parsed = Date.parse(q.last_time);
      if (Number.isFinite(parsed) && parsed > latestMs) {
        latestMs = parsed;
        asOf = new Date(parsed).toISOString();
      }
    }
  }

  if (values.length !== tenors.length) throw new Error("Incomplete live curve");
  return { values, prevValues, asOf, fetchedAt: new Date().toISOString(), exchange };
}
