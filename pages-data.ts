import { isPastEvent, newYorkDate, tenors, type Calendar, type MarketEvent } from "./model";
import { parseBeaReadings } from "./releases";
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

/**
 * Directly live-patches today/yesterday past-due BEA releases (PCE / GDP) from browser
 * via www.bea.gov (CORS Access-Control-Allow-Origin: *) whenever calendar.json lags behind.
 */
export async function patchLiveBeaReleases(
  calendars: Record<string, Calendar>,
  signal?: AbortSignal,
): Promise<{ calendars: Record<string, Calendar>; patchedCount: number }> {
  const now = new Date();
  const today = newYorkDate(now);
  const targets: { weekKey: string; event: MarketEvent; kind: "pce" | "gdp"; url: string }[] = [];
  for (const [weekKey, cal] of Object.entries(calendars)) {
    for (const ev of cal.events) {
      if (ev.source !== "bea" || !ev.time || !isPastEvent(ev, now)) continue;
      const kind = ev.title.startsWith("PCE") ? "pce" : ev.title === "美国 GDP" ? "gdp" : null;
      if (!kind) continue;
      const needsPatch = !ev.readings?.length || (kind === "gdp" && !ev.readings.some(r => r.label.includes("实际 GDP")));
      if (!needsPatch) continue;
      if (ev.date > today) continue;
      const url = ev.resultUrl;
      if (url && /^https:\/\/www\.bea\.gov\/news\/20\d\d\//.test(url)) {
        targets.push({ weekKey, event: ev, kind, url });
      }
    }
  }
  if (!targets.length) return { calendars, patchedCount: 0 };

  const updates = new Map<string, MarketEvent["readings"]>();
  await Promise.allSettled(targets.slice(0, 4).map(async t => {
    const resp = await fetch(t.url, { signal });
    if (!resp.ok) return;
    const html = await resp.text();
    const readings = parseBeaReadings(t.kind, html);
    if (readings.length) updates.set(t.event.id, readings);
  }));
  if (!updates.size) return { calendars, patchedCount: 0 };

  const next: Record<string, Calendar> = {};
  for (const [wk, cal] of Object.entries(calendars)) {
    let changed = false;
    const events = cal.events.map(ev => {
      const r = updates.get(ev.id);
      if (!r) return ev;
      changed = true;
      return { ...ev, readings: r };
    });
    next[wk] = changed ? { ...cal, events } : cal;
  }
  return { calendars: next, patchedCount: updates.size };
}

export const CLOUD_WORKFLOW_URL = "https://github.com/ReinCheng/ust-weekly-desk/actions/workflows/pages.yml";

export async function triggerCloudRefresh(token: string, near = true): Promise<void> {
  const resp = await fetch(
    "https://api.github.com/repos/ReinCheng/ust-weekly-desk/actions/workflows/pages.yml/dispatches",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.trim()}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main", inputs: { refresh: true, near, run_alpha: false } }),
    },
  );
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`HTTP ${resp.status}${txt ? ": " + txt.slice(0, 90) : ""}`);
  }
}

export async function pollLatestCloudRun(afterIso: string): Promise<{
  id: number;
  status: string;
  conclusion: string | null;
  htmlUrl: string;
} | null> {
  const resp = await fetch(
    "https://api.github.com/repos/ReinCheng/ust-weekly-desk/actions/workflows/pages.yml/runs?per_page=3&_=" + Date.now(),
    { cache: "no-store" },
  );
  if (!resp.ok) return null;
  const body = await resp.json() as { workflow_runs?: { id: number; status: string; conclusion: string | null; created_at: string; html_url: string }[] };
  const match = (body.workflow_runs ?? []).find(r => r.created_at >= afterIso);
  return match ? { id: match.id, status: match.status, conclusion: match.conclusion, htmlUrl: match.html_url } : null;
}
