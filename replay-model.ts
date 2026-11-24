import { isPastEvent, newYorkDate, tenors, type CurvePoint, type MarketEvent } from "./model";
import { playbookFor } from "./playbooks";

export type ReplayReading = {
  label: string;
  valueText: string;
  num?: number;
  deltaText?: string;
};

export type HistoricalReplay = {
  date: string;
  prevDate: string;
  period: string;
  headline: string;
  readings: ReplayReading[];
  prevCurve: number[];
  curve: number[];
  shiftsBp: number[];
  real10Bp: number | null;
  be10Bp: number | null;
  regimeTag: string;
  regimeTone: "bear" | "bull" | "mixed";
  confounders: string[];
  sourceUrl: string;
  sourceName: string;
};

export type ReplaySeries = {
  key: string;
  name: string;
  methodology: string;
  items: HistoricalReplay[];
};

export type ReplayCatalog = {
  generatedAt: string;
  curveThrough: string;
  series: Record<string, ReplaySeries>;
};

export function selectReplayItems(series: ReplaySeries, throughDate?: string) {
  return series.items.filter(item => !throughDate || item.date <= throughDate).slice(0, 4);
}

export function eventCurveBase(
  event: MarketEvent,
  now: Date,
  points: CurvePoint[],
  series: ReplaySeries | undefined,
  latest: { values: number[]; label: string },
) {
  if (event.date > newYorkDate(now) || (event.time && !isPastEvent(event, now))) return latest;

  const replay = series?.items.find(item => item.date === event.date);
  const point = points.findLast(item => item.date < event.date && item.values.length === tenors.length);
  if (replay && replay.prevDate < event.date && replay.prevCurve.length === tenors.length &&
      (!point || replay.prevDate > point.date)) {
    return { values: replay.prevCurve, label: `事件前财政部日终 ${replay.prevDate}` };
  }
  return point
    ? { values: point.values, label: `事件前财政部日终 ${point.date}` }
    : { values: [], label: "缺少事件前的九期限曲线" };
}

const supportedMacro = new Set([
  "cpi", "eci", "pce", "ppi", "jobs", "claims", "jolts",
  "retail", "gdp", "policy", "minutes", "durables", "productivity",
]);

const libraryReplayFallback: Record<string, string> = {
  auction_front: "auction:2y-nominal",
  auction_belly: "auction:5y-nominal",
  auction_10y: "auction:10y-nominal",
  auction_20y: "auction:20y-nominal",
  auction_30y: "auction:30y-nominal",
  tips: "auction:10y-tips",
  bills: "auction:13w-bill",
};

export function replayKeyForEvent(event: MarketEvent): string | null {
  if (event.category === "auction" && event.auctionKey) return "auction:" + event.auctionKey;
  const pbKey = playbookFor(event).key;
  return supportedMacro.has(pbKey) ? pbKey : null;
}

export function replayKeyForLibrary(libraryKey: string): string | null {
  if (libraryReplayFallback[libraryKey]) return libraryReplayFallback[libraryKey];
  return supportedMacro.has(libraryKey) ? libraryKey : null;
}

export function focusTenorIndexForReplay(key: string): number {
  if (key === "auction:20y-nominal") return 7;
  if (key === "auction:30y-nominal" || key === "auction:30y-tips") return 8;
  if (key === "auction:10y-nominal" || key === "auction:10y-tips" || key === "gdp" || key === "retail" || key === "durables") return 6;
  if (key === "auction:5y-nominal" || key === "auction:5y-tips") return 4;
  if (key === "auction:7y-nominal") return 5;
  if (key === "auction:3y-nominal") return 3;
  if (key.endsWith("-bill") || key === "auction:2y-frn") return 0;
  return 2; // 2Y default for CPI, ECI, PCE, PPI, NFP, Claims, JOLTS, FOMC, 2Y Auction
}
