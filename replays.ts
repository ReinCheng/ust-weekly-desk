import { readFile, rename, writeFile } from "node:fs/promises";
import { auctionNames, dateOf, document, months, textOf } from "./feeds";
import { addDays, newYorkDate, type Reading } from "./model";
import { matchesBlsDate, parseBeaReadings, parseBlsReadings, type BlsKind } from "./releases";
import type { HistoricalReplay, ReplayCatalog, ReplayReading, ReplaySeries } from "./replay-model";

export type { HistoricalReplay, ReplayCatalog, ReplayReading, ReplaySeries } from "./replay-model";
export { focusTenorIndexForReplay, replayKeyForEvent, replayKeyForLibrary } from "./replay-model";

/* ---------- Official Primary-Source Historical Fetcher & Verifier ---------- */

const nomCsvUrl = (year: number) =>
  `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`;
const realCsvUrl = (year: number) =>
  `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all?type=daily_treasury_real_yield_curve&field_tdr_date_value=${year}&page&_format=csv`;
const treasuryAuctioned365 = "https://www.treasurydirect.gov/TA_WS/securities/auctioned?format=json&days=365";
const alfredUrl = (series: string, vintageDate: string) =>
  `https://alfred.stlouisfed.org/graph/alfredgraph.csv?id=${encodeURIComponent(series)}&vintage_date=${vintageDate}`;

type DailyCurves = {
  dates: string[];
  nominal: Map<string, number[]>;
  real10: Map<string, number>;
};

function parseUsDate(raw: string): string | null {
  const m = raw.trim().replace(/^"|"$/g, "").match(/^(\d{1,2})\/(\d{1,2})\/(20\d\d)$/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

function parseCsvLine(line: string): string[] {
  return line.split(",").map(s => s.trim().replace(/^"|"$/g, ""));
}

async function loadDailyTreasuryCurves(years: number[]): Promise<DailyCurves> {
  const nominal = new Map<string, number[]>();
  const real10 = new Map<string, number>();
  const wantNom = ["3 Mo", "1 Yr", "2 Yr", "3 Yr", "5 Yr", "7 Yr", "10 Yr", "20 Yr", "30 Yr"];

  await Promise.all(years.flatMap(year => [
    document(nomCsvUrl(year)).then(doc => {
      const lines = doc.html.trim().split(/\r?\n/);
      if (lines.length < 2) return;
      const head = parseCsvLine(lines[0]);
      const cols = wantNom.map(name => head.indexOf(name));
      if (cols.some(i => i < 0)) return;
      for (const line of lines.slice(1)) {
        const parts = parseCsvLine(line);
        const date = parseUsDate(parts[0] ?? "");
        if (!date) continue;
        const vals = cols.map(i => Number(parts[i]));
        if (vals.length === 9 && vals.every(v => Number.isFinite(v) && v > 0)) {
          nominal.set(date, vals);
        }
      }
    }).catch(() => {}),
    document(realCsvUrl(year)).then(doc => {
      const lines = doc.html.trim().split(/\r?\n/);
      if (lines.length < 2) return;
      const head = parseCsvLine(lines[0]);
      const idx10 = head.findIndex(h => /^10\s*YR$/i.test(h));
      if (idx10 < 0) return;
      for (const line of lines.slice(1)) {
        const parts = parseCsvLine(line);
        const date = parseUsDate(parts[0] ?? "");
        if (!date) continue;
        const val = Number(parts[idx10]);
        if (Number.isFinite(val)) real10.set(date, val);
      }
    }).catch(() => {}),
  ]));

  const dates = [...nominal.keys()].sort();
  return { dates, nominal, real10 };
}

function reactionOn(curves: DailyCurves, date: string) {
  const idx = curves.dates.indexOf(date);
  if (idx <= 0) return null;
  const prevDate = curves.dates[idx - 1];
  const gapDays = Math.round((Date.parse(date + "T12:00:00Z") - Date.parse(prevDate + "T12:00:00Z")) / 86400000);
  if (gapDays > 6) return null;
  const prevCurve = curves.nominal.get(prevDate);
  const curve = curves.nominal.get(date);
  if (!prevCurve || !curve) return null;
  const shiftsBp = curve.map((v, i) => Number(((v - prevCurve[i]) * 100).toFixed(1)));
  const rNow = curves.real10.get(date);
  const rPrev = curves.real10.get(prevDate);
  const real10Bp = rNow !== undefined && rPrev !== undefined ? Number(((rNow - rPrev) * 100).toFixed(1)) : null;
  const be10Bp = real10Bp !== null ? Number((shiftsBp[6] - real10Bp).toFixed(1)) : null;
  return { prevDate, prevCurve, curve, shiftsBp, real10Bp, be10Bp };
}

function classifyReaction(key: string, shiftsBp: number[], real10Bp: number | null, be10Bp: number | null): { tag: string; tone: "bear" | "bull" | "mixed" } {
  const [d3m, , d2, , d5, , d10, d20, d30] = shiftsBp;
  const d2s10s = Number((d10 - d2).toFixed(1));
  const dFly20 = Number((2 * d20 - d10 - d30).toFixed(1));

  if (key === "auction:20y-nominal" && Math.abs(dFly20) >= 2.5) {
    return {
      tag: dFly20 > 0 ? "20Y Fly 走阔" : "20Y Fly 收窄",
      tone: d20 >= 2 ? "bear" : d20 <= -2 ? "bull" : "mixed",
    };
  }
  if (key.includes("tips") && real10Bp !== null && be10Bp !== null) {
    if (Math.abs(real10Bp) < 1.5 && Math.abs(be10Bp) < 1.5) return { tag: "实际与 BE 平稳", tone: "mixed" };
    if (Math.abs(real10Bp) < 1.5) {
      return { tag: be10Bp > 0 ? "实际平 · BE 走阔" : "实际平 · BE 收窄", tone: "mixed" };
    }
    if (Math.abs(be10Bp) < 1.5) {
      return { tag: real10Bp > 0 ? "实际利率上行" : "实际利率下行", tone: real10Bp > 0 ? "bear" : "bull" };
    }
    if (real10Bp > 0 && be10Bp < 0) return { tag: "实际利率↑ · BE↓", tone: "bear" };
    if (real10Bp < 0 && be10Bp > 0) return { tag: "实际利率↓ · BE↑", tone: "bull" };
    if (real10Bp > 0 && be10Bp > 0) return { tag: "实际与 BE 同升", tone: "bear" };
    return { tag: "实际与 BE 同降", tone: "bull" };
  }
  if (key.endsWith("-bill") || key === "auction:2y-frn") {
    if (d3m >= 2) return { tag: "超短端上行", tone: "bear" };
    if (d3m <= -2) return { tag: "超短端下行", tone: "bull" };
    return { tag: "超短端平稳", tone: "mixed" };
  }
  if (Math.max(Math.abs(d2), Math.abs(d10), Math.abs(d30)) < 2.5) {
    return { tag: "窄幅震荡", tone: "mixed" };
  }
  if (d2 >= 1.5 && d10 >= 1.5) {
    if (d2s10s <= -1.5) return { tag: "熊平 Bear Flat", tone: "bear" };
    if (d2s10s >= 1.5) return { tag: "熊陡 Bear Steep", tone: "bear" };
    return { tag: "全线熊市上移", tone: "bear" };
  }
  if (d2 <= -1.5 && d10 <= -1.5) {
    if (d2s10s >= 1.5) return { tag: "牛陡 Bull Steep", tone: "bull" };
    if (d2s10s <= -1.5) return { tag: "牛平 Bull Flat", tone: "bull" };
    return { tag: "全线牛市下行", tone: "bull" };
  }
  if (d2s10s >= 2.5) return { tag: "曲线扭曲走陡", tone: "mixed" };
  if (d2s10s <= -2.5) return { tag: "曲线扭曲趋平", tone: "mixed" };
  return d2 + d10 > 0 ? { tag: "温和上行", tone: "bear" } : { tag: "温和下行", tone: "bull" };
}

function fmtReading(r: Reading): string {
  const digits = r.digits ?? (r.unit === "千人" ? 0 : 1);
  const pref = r.signed && r.value > 0 ? "+" : "";
  const num = pref + r.value.toFixed(digits);
  if (r.unit === "%" || r.unit === "×") return num + r.unit;
  return num + " " + r.unit;
}

function toReplayReadings(readings: Reading[]): ReplayReading[] {
  return readings.map(r => ({ label: r.label, valueText: fmtReading(r), num: r.value }));
}

function attachPriorDeltas(itemsNewestFirst: HistoricalReplay[], primaryLabel: string, unit: string, digits = 1) {
  for (let i = 0; i < itemsNewestFirst.length - 1; i++) {
    const cur = itemsNewestFirst[i].readings.find(r => r.label === primaryLabel);
    const prev = itemsNewestFirst[i + 1].readings.find(r => r.label === primaryLabel);
    if (cur?.num !== undefined && prev?.num !== undefined) {
      const diff = Number((cur.num - prev.num).toFixed(digits));
      const sign = diff > 0 ? "+" : "";
      cur.deltaText = diff === 0 ? "持平前次" : `较前次 ${sign}${diff.toFixed(digits)}${unit}`;
    }
  }
}

function chinesePeriod(detail: string): string {
  const qMap: Record<string, string> = { first: "Q1", "1st": "Q1", second: "Q2", "2nd": "Q2", third: "Q3", "3rd": "Q3", fourth: "Q4", "4th": "Q4" };
  const qMatch = detail.match(/\b(First|Second|Third|Fourth|1st|2nd|3rd|4th)\s+Quarter\s+(20\d\d)\b/i);
  if (qMatch) {
    const q = qMap[qMatch[1].toLowerCase()] ?? qMatch[1];
    const ed = /\(P\)|Advance/i.test(detail) ? "初值" : /\(R\)|Second Estimate/i.test(detail) ? "修正" : /Third Estimate/i.test(detail) ? "终值" : "";
    return `${qMatch[2]} ${q}${ed ? " " + ed : ""}`;
  }
  const mMatch = detail.match(/\b([A-Z][a-z]+)\s+(20\d\d)\b/);
  if (mMatch) {
    const mi = months.indexOf(mMatch[1]);
    if (mi >= 0) return `${mMatch[2]}年${mi + 1}月`;
  }
  return detail.slice(0, 28);
}

type RawCandidate = { date: string; detail: string; url?: string };

async function fetchBlsSchedule(years: number[]): Promise<RawCandidate[]> {
  const out: RawCandidate[] = [];
  for (const year of years) {
    const doc = await document(`https://www.bls.gov/schedule/${year}/home.htm`).catch(() => null);
    if (!doc) continue;
    for (const m of doc.html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      if (!m[1].includes("date-cell")) continue;
      const cells = [...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => textOf(c[1]));
      const date = dateOf(cells[0] ?? "");
      if (date && cells[2]) out.push({ date, detail: cells[2] });
    }
  }
  return out;
}

async function fetchBeaSchedule(years: number[], currentYear: number): Promise<RawCandidate[]> {
  const out: RawCandidate[] = [];
  for (const year of years) {
    const url = "https://www.bea.gov/news/schedule/full" + (year === currentYear ? "" : "-" + year);
    const doc = await document(url).catch(() => null);
    if (!doc) continue;
    for (const m of doc.html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      if (!m[1].includes("release-date") || !m[1].includes("release-title")) continue;
      const cells = [...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => textOf(c[1]));
      const date = dateOf(cells[0] ?? "", String(year));
      const href = m[1].match(/href="(\/news\/20\d\d\/[a-z0-9-]+)"/i)?.[1];
      if (date && cells[2]) out.push({ date, detail: cells[2], url: href ? "https://www.bea.gov" + href : undefined });
    }
  }
  return out;
}

async function fetchCensusSchedule(years: number[]): Promise<RawCandidate[]> {
  const out: RawCandidate[] = [];
  for (const year of years) {
    const doc = await document(`https://www.census.gov/economic-indicators/calendar-listview-${year}.html`).catch(() => null);
    if (!doc) continue;
    for (const m of doc.html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      if (!m[1].includes(`sorttable_customkey="${year}`)) continue;
      const cells = [...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => textOf(c[1]));
      const date = dateOf(cells[1] ?? "");
      if (date && cells[0]) out.push({ date, detail: `${cells[0]} · ${cells[3] ?? ""}` });
    }
  }
  return out;
}

function parseFracRate(raw: string): number | null {
  const s = raw.replace(/[\u2010-\u2015\u2212]/g, "-").trim();
  const mix = s.match(/^(\d+)-(\d)\/(\d)$/);
  if (mix) return Number(mix[1]) + Number(mix[2]) / Number(mix[3]);
  const frac = s.match(/^(\d)\/(\d)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const dec = Number(s);
  return Number.isFinite(dec) ? dec : null;
}

type AlfredObs = { obsDate: string; value: number };

async function fetchAlfredTail(seriesId: string, vintageDate: string): Promise<AlfredObs[]> {
  const doc = await document(alfredUrl(seriesId, vintageDate)).catch(() => null);
  if (!doc) return [];
  const rows: AlfredObs[] = [];
  for (const line of doc.html.trim().split(/\r?\n/).slice(1)) {
    const [d, v] = line.split(",");
    const num = Number(v);
    if (d && Number.isFinite(num)) rows.push({ obsDate: d.trim(), value: num });
  }
  return rows.slice(-4);
}

/** Strictly verifies that a NEW observation appeared on releaseDate (not present on releaseDate - 1). */
async function fetchVerifiedVintageMom(seriesId: string, releaseDate: string) {
  const [prevTail, relTail] = await Promise.all([
    fetchAlfredTail(seriesId, addDays(releaseDate, -1)),
    fetchAlfredTail(seriesId, releaseDate),
  ]);
  if (relTail.length < 2 || !prevTail.length) return null;
  const latest = relTail.at(-1)!;
  const prior = relTail.at(-2)!;
  const prevLatest = prevTail.at(-1)!;
  if (latest.obsDate <= prevLatest.obsDate) return null;
  if (prior.value <= 0) return null;
  const mom = Number((((latest.value - prior.value) / prior.value) * 100).toFixed(1));
  return { obsDate: latest.obsDate, mom, value: latest.value, priorValue: prior.value };
}

export async function buildReplayCatalog(now = new Date()): Promise<ReplayCatalog> {
  const today = newYorkDate(now);
  const currentYear = Number(today.slice(0, 4));
  const years = [currentYear - 1, currentYear];

  const [curves, blsSched, beaSched, censusSched, fomcDoc, tdDoc] = await Promise.all([
    loadDailyTreasuryCurves(years),
    fetchBlsSchedule(years),
    fetchBeaSchedule(years, currentYear),
    fetchCensusSchedule(years),
    document("https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm").catch(() => null),
    document(treasuryAuctioned365).catch(() => null),
  ]);

  const curveThrough = curves.dates.at(-1) ?? "";
  if (!curveThrough) throw new Error("US Treasury daily curve unavailable for historical replays");
  const eligible = (date: string) => date <= curveThrough && date < today;

  // Build master same-day confounder index across all Tier-1 macro, FOMC, and major coupon/TIPS auctions
  const confounderMap = new Map<string, Set<string>>();
  const addConfounder = (date: string, label: string) => {
    let set = confounderMap.get(date);
    if (!set) { set = new Set(); confounderMap.set(date, set); }
    set.add(label);
  };

  for (const row of blsSched) {
    if (/^Consumer Price Index\b/i.test(row.detail)) addConfounder(row.date, "美国 CPI");
    else if (/^Producer Price Index\b/i.test(row.detail)) addConfounder(row.date, "美国 PPI");
    else if (/^Employment Situation\b/i.test(row.detail)) addConfounder(row.date, "美国非农就业");
    else if (/^Job Openings and Labor Turnover\b/i.test(row.detail)) addConfounder(row.date, "JOLTS 职位空缺");
    else if (/^Employment Cost Index\b/i.test(row.detail)) addConfounder(row.date, "就业成本指数（ECI）");
    else if (/^Productivity and Costs\s*\(P\)/i.test(row.detail)) addConfounder(row.date, "生产率与 ULC 初值");
  }
  for (const row of beaSched) {
    if (/Personal Income and Outlays/i.test(row.detail)) addConfounder(row.date, "PCE 物价 / 个人收支");
    else if (/\bGDP\b|Gross Domestic Product/i.test(row.detail) && !/County|State|Industry|Metropolitan|Territor/i.test(row.detail)) {
      addConfounder(row.date, "美国 GDP");
    }
  }
  for (const row of censusSched) {
    if (/Advance Monthly Sales for Retail/i.test(row.detail)) addConfounder(row.date, "美国零售销售");
    else if (/Advance Report on Durable Goods/i.test(row.detail)) addConfounder(row.date, "耐用品订单初值");
  }

  // Parse FOMC calendar (decisions & minutes) for 2025-2026
  type FomcMeet = { date: string; start: string; sep: boolean; stmtUrl: string; minDate?: string; minUrl?: string };
  const fomcMeetings: FomcMeet[] = [];
  if (fomcDoc) {
    const html = fomcDoc.html;
    const yrMatches = [...html.matchAll(/(20\d\d) FOMC Meetings\s*<\/a>/g)];
    yrMatches.forEach((ym, i) => {
      const yr = Number(ym[1]);
      if (!years.includes(yr)) return;
      const section = html.slice(ym.index, yrMatches[i + 1]?.index ?? html.length);
      for (const m of section.matchAll(/class="[^"]*fomc-meeting__month[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<div class="fomc-meeting__date[^"]*"[^>]*>([\s\S]*?)<\/div>/gi)) {
        const monIdx = months.indexOf(textOf(m[1]));
        const span = textOf(m[2]).match(/^(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?(\*)?/);
        if (monIdx < 0 || !span) continue;
        const start = `${yr}-${String(monIdx + 1).padStart(2, "0")}-${span[1].padStart(2, "0")}`;
        const end = `${yr}-${String(monIdx + 1).padStart(2, "0")}-${(span[2] ?? span[1]).padStart(2, "0")}`;
        const row = section.slice(m.index + m[0].length).split(/class="[^"]*fomc-meeting__month/)[0];
        const stmt = row.match(/href="([^"]*\/pressreleases\/monetary\d{8}a\.htm)"/i)?.[1];
        const minRel = row.match(/\(Released\s+([A-Za-z]+\s+\d{1,2},\s+20\d\d)\)/)?.[1];
        const minDate = minRel ? dateOf(minRel) ?? undefined : undefined;
        const minHref = row.match(/href="([^"]*\/fomcminutes\d{8}\.htm)"/i)?.[1];
        addConfounder(end, "FOMC 利率决议");
        if (minDate) addConfounder(minDate, "FOMC 会议纪要");
        if (stmt) {
          fomcMeetings.push({
            date: end, start, sep: Boolean(span[3]),
            stmtUrl: new URL(stmt, "https://www.federalreserve.gov").href,
            minDate, minUrl: minHref ? new URL(minHref, "https://www.federalreserve.gov").href : undefined,
          });
        }
      }
    });
  }
  fomcMeetings.sort((a, b) => a.date.localeCompare(b.date));

  // Parse TreasuryDirect auctions & add major 10Y/20Y/30Y/TIPS auctions to confounder map
  type RawAuction = Record<string, unknown>;
  const tdRaw: RawAuction[] = tdDoc ? (JSON.parse(tdDoc.html) as RawAuction[]) : [];
  const auctionsByKey = new Map<string, {
    date: string; title: string; auctionKey: string; stopLabel: string; stopVal: number;
    btc: number; dealer?: number; indirect?: number; direct?: number;
    sizeBn?: number; reopening: boolean; pdfUrl: string;
  }[]>();

  for (const item of tdRaw) {
    const date = String(item?.competitiveAuctionCloseDate ?? "").slice(0, 10);
    const resultFile = String(item?.treasuryAuctionResultsPressReleaseFileName ?? "");
    const term = String(item?.securityType === "Bill" ? item.securityTerm : item.originalSecurityTerm || item.securityTerm);
    if (!date || !eligible(date) || !/^R_[\d_]+\.pdf$/.test(resultFile) || !/^\d+/.test(term)) continue;
    const type = String(item.securityType ?? "").toLowerCase();
    const isTips = item.inflationProtected === "Yes";
    const isFrn = item.floatingRate === "Yes";
    const { title, auctionKey, score } = auctionNames(term, type, isTips, isFrn);
    const stopRaw = item.highYield || item.highDiscountMargin || item.highRate;
    const stopVal = Number(stopRaw);
    const btc = Number(item.bidToCoverRatio);
    if (!Number.isFinite(stopVal) || !Number.isFinite(btc)) continue;
    const stopLabel = item.highDiscountMargin ? "最高折扣利差" : item.highRate ? "最高贴现率" : isTips ? "中标实际收益率" : "中标收益率";
    const compTotal = Number(item.subtotalCompetitiveParAwardedInsideOfOfferingAmount || 0);
    const share = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 && compTotal > 0 ? Number(((n / compTotal) * 100).toFixed(1)) : undefined;
    };
    const sizeBn = Number(item.offeringAmount) > 0 ? Number((Number(item.offeringAmount) / 1e9).toFixed(1)) : undefined;
    const pdfUrl = `https://www.treasurydirect.gov/instit/annceresult/press/preanre/${resultFile.slice(2, 6)}/${resultFile}`;
    if (score >= 4 && !isFrn && type !== "bill") addConfounder(date, title);

    const list = auctionsByKey.get(auctionKey) ?? [];
    if (!list.some(x => x.date === date)) {
      list.push({
        date, title, auctionKey, stopLabel, stopVal, btc,
        dealer: share(item.primaryDealersCompetitiveParAwarded),
        indirect: share(item.indirectBiddersCompetitiveParAwarded),
        direct: share(item.directBiddersCompetitiveParAwarded),
        sizeBn, reopening: item.reopening === "Yes", pdfUrl,
      });
      auctionsByKey.set(auctionKey, list);
    }
  }

  const getConfounders = (date: string, selfLabel: string) =>
    [...(confounderMap.get(date) ?? [])].filter(l => l !== selfLabel);

  const series: Record<string, ReplaySeries> = {};
  const MAX_ITEMS = 5;

  // 1. BLS Series: CPI, PPI, NFP, JOLTS, ECI, Productivity
  const blsSpecs: {
    key: string; kind: BlsKind; name: string; selfLabel: string; re: RegExp;
    primaryLabel: string; primaryUnit: string; digits?: number;
  }[] = [
    { key: "cpi", kind: "cpi", name: "美国 CPI", selfLabel: "美国 CPI", re: /^Consumer Price Index\b/i, primaryLabel: "核心 CPI 月率", primaryUnit: "pct" },
    { key: "ppi", kind: "ppi", name: "美国 PPI", selfLabel: "美国 PPI", re: /^Producer Price Index\b/i, primaryLabel: "最终需求 PPI 月率", primaryUnit: "pct" },
    { key: "jobs", kind: "empsit", name: "美国非农就业", selfLabel: "美国非农就业", re: /^Employment Situation\b/i, primaryLabel: "非农新增就业", primaryUnit: "千人", digits: 0 },
    { key: "jolts", kind: "jolts", name: "JOLTS 职位空缺", selfLabel: "JOLTS 职位空缺", re: /^Job Openings and Labor Turnover\b/i, primaryLabel: "职位空缺", primaryUnit: "百万" },
    { key: "eci", kind: "eci", name: "就业成本指数（ECI）", selfLabel: "就业成本指数（ECI）", re: /^Employment Cost Index\b/i, primaryLabel: "就业成本指数季率", primaryUnit: "pct" },
    { key: "productivity", kind: "prod2", name: "生产率与单位劳动成本", selfLabel: "生产率与 ULC 初值", re: /^Productivity and Costs\s*\([PR]\)/i, primaryLabel: "单位劳动成本 ULC", primaryUnit: "pct" },
  ];

  await Promise.all(blsSpecs.map(async spec => {
    const candidates = blsSched.filter(r => spec.re.test(r.detail) && eligible(r.date))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-(MAX_ITEMS + 2));
    const items: HistoricalReplay[] = [];
    for (const c of candidates.reverse()) {
      if (items.length >= MAX_ITEMS) break;
      const react = reactionOn(curves, c.date);
      if (!react) continue;
      const [y, m, d] = c.date.split("-");
      const url = `https://www.bls.gov/news.release/archives/${spec.kind}_${m}${d}${y}.htm`;
      const doc = await document(url).catch(() => null);
      if (!doc || !matchesBlsDate(doc.html, c.date)) continue;
      const parsed = parseBlsReadings(spec.kind, doc.html);
      if (!parsed.some(r => r.label === spec.primaryLabel)) continue;
      const rr = toReplayReadings(parsed);
      const { tag, tone } = classifyReaction(spec.key, react.shiftsBp, react.real10Bp, react.be10Bp);
      const headline = rr.slice(0, 2).map(r => `${r.label.replace(/最终需求 |就业成本指数|非农新增|单位劳动成本 /, "")} ${r.valueText}`).join(" · ");
      items.push({
        date: c.date,
        prevDate: react.prevDate,
        period: chinesePeriod(c.detail),
        headline,
        readings: rr,
        prevCurve: react.prevCurve,
        curve: react.curve,
        shiftsBp: react.shiftsBp,
        real10Bp: react.real10Bp,
        be10Bp: react.be10Bp,
        regimeTag: tag,
        regimeTone: tone,
        confounders: getConfounders(c.date, spec.selfLabel),
        sourceUrl: url,
        sourceName: "BLS 官方发布原文",
      });
    }
    if (items.length >= 2) {
      attachPriorDeltas(items, spec.primaryLabel, spec.primaryUnit, spec.digits ?? 1);
      series[spec.key] = {
        key: spec.key,
        name: spec.name,
        methodology: "数据采自 BLS 发布当日官方原始新闻稿（无事后修订偏差）；市场反应取美国财政部官方日终平价与 TIPS 曲线 T-1 → T 变动。",
        items,
      };
    }
  }));

  // 2. BEA Series: PCE & GDP
  const beaSpecs: {
    key: string; kind: "pce" | "gdp"; name: string; selfLabel: string;
    pred: (detail: string) => boolean; primaryLabel: string;
  }[] = [
    { key: "pce", kind: "pce", name: "PCE 物价 / 个人收支", selfLabel: "PCE 物价 / 个人收支", pred: d => /Personal Income and Outlays/i.test(d), primaryLabel: "核心 PCE 月率" },
    { key: "gdp", kind: "gdp", name: "美国 GDP", selfLabel: "美国 GDP", pred: d => /\bGDP\b|Gross Domestic Product/i.test(d) && !/County|State|Industry|Metropolitan|Territor/i.test(d), primaryLabel: "实际 GDP 季环比折年率" },
  ];

  await Promise.all(beaSpecs.map(async spec => {
    const candidates = beaSched.filter(r => spec.pred(r.detail) && r.url && eligible(r.date))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-(MAX_ITEMS + 2));
    const items: HistoricalReplay[] = [];
    for (const c of candidates.reverse()) {
      if (items.length >= MAX_ITEMS || !c.url) break;
      const react = reactionOn(curves, c.date);
      if (!react) continue;
      const doc = await document(c.url).catch(() => null);
      if (!doc) continue;
      const dateLine = doc.html.match(/class="[^"]*field--name-field-release-date[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1];
      if (!dateLine || dateOf(textOf(dateLine)) !== c.date) continue;
      const parsed = parseBeaReadings(spec.kind, doc.html);
      if (!parsed.some(r => r.label === spec.primaryLabel)) continue;
      const rr = toReplayReadings(parsed);
      const { tag, tone } = classifyReaction(spec.key, react.shiftsBp, react.real10Bp, react.be10Bp);
      const headline = rr.slice(0, 2).map(r => `${r.label.replace(/季环比折年率|折年率/, "").trim()} ${r.valueText}`).join(" · ");
      items.push({
        date: c.date,
        prevDate: react.prevDate,
        period: chinesePeriod(c.detail),
        headline,
        readings: rr,
        prevCurve: react.prevCurve,
        curve: react.curve,
        shiftsBp: react.shiftsBp,
        real10Bp: react.real10Bp,
        be10Bp: react.be10Bp,
        regimeTag: tag,
        regimeTone: tone,
        confounders: getConfounders(c.date, spec.selfLabel),
        sourceUrl: c.url,
        sourceName: "BEA 官方新闻稿",
      });
    }
    if (items.length >= 2) {
      attachPriorDeltas(items, spec.primaryLabel, "pct", 1);
      series[spec.key] = {
        key: spec.key,
        name: spec.name,
        methodology: "数据采自 BEA 发布当日官方原始新闻稿（保留初值/修正原始口径）；市场反应取美国财政部官方日终平价与 TIPS 曲线 T-1 → T 变动。",
        items,
      };
    }
  }));

  // 3. FOMC Decisions & FOMC Minutes
  {
    const pastMeets = fomcMeetings.filter(m => eligible(m.date)).slice(-(MAX_ITEMS + 1));
    const parsedMeets: { meet: FomcMeet; low: number; high: number; rangeText: string; dissent: string }[] = [];
    for (const meet of pastMeets) {
      const doc = await document(meet.stmtUrl).catch(() => null);
      if (!doc) continue;
      const txt = textOf(doc.html);
      const rangeMatch = txt.match(/target range for the federal funds rate[^.]{0,90}?\b(\d(?:[-–‑]\d\/\d)?)\s+to\s+(\d(?:[-–‑]\d\/\d)?)\s*percent/i);
      if (!rangeMatch) continue;
      const low = parseFracRate(rangeMatch[1]);
      const high = parseFracRate(rangeMatch[2]);
      if (low === null || high === null) continue;
      const dissentMatch = txt.match(/Voting against[^.]{0,220}\./i)?.[0];
      const dissent = dissentMatch ? "存在反对票" : "全票一致";
      parsedMeets.push({ meet, low, high, rangeText: `${low.toFixed(2)}%–${high.toFixed(2)}%`, dissent });
    }
    const items: HistoricalReplay[] = [];
    for (let i = parsedMeets.length - 1; i >= 0 && items.length < MAX_ITEMS; i--) {
      const cur = parsedMeets[i];
      const prev = parsedMeets[i - 1];
      const react = reactionOn(curves, cur.meet.date);
      if (!react) continue;
      const diffBp = prev ? Math.round((cur.low - prev.low) * 100) : null;
      const action = diffBp === null ? "政策决议" : diffBp === 0 ? "维持不变" : diffBp > 0 ? `加息 +${diffBp}bp` : `降息 ${diffBp}bp`;
      const { tag, tone } = classifyReaction("policy", react.shiftsBp, react.real10Bp, react.be10Bp);
      items.push({
        date: cur.meet.date,
        prevDate: react.prevDate,
        period: cur.meet.sep ? "含 SEP 点阵图" : "非点阵图会议",
        headline: `${action} · ${cur.rangeText}`,
        readings: [
          { label: "利率决策", valueText: action, num: diffBp ?? undefined },
          { label: "目标区间", valueText: cur.rangeText },
          { label: "SEP 点阵图", valueText: cur.meet.sep ? "有发布" : "无" },
          { label: "票委表决", valueText: cur.dissent },
        ],
        prevCurve: react.prevCurve,
        curve: react.curve,
        shiftsBp: react.shiftsBp,
        real10Bp: react.real10Bp,
        be10Bp: react.be10Bp,
        regimeTag: tag,
        regimeTone: tone,
        confounders: getConfounders(cur.meet.date, "FOMC 利率决议"),
        sourceUrl: cur.meet.stmtUrl,
        sourceName: "美联储 FOMC 官方声明",
      });
    }
    if (items.length >= 2) {
      series.policy = {
        key: "policy",
        name: "FOMC 利率决议",
        methodology: "决议区间与票委分歧采自美联储官方 FOMC 声明；市场反应取美国财政部官方日终平价与 TIPS 曲线 T-1 → T 变动。",
        items,
      };
    }

    const pastMins = fomcMeetings.filter(m => m.minDate && m.minUrl && eligible(m.minDate))
      .sort((a, b) => a.minDate!.localeCompare(b.minDate!))
      .slice(-MAX_ITEMS)
      .reverse();
    const minItems: HistoricalReplay[] = [];
    for (const m of pastMins) {
      const react = reactionOn(curves, m.minDate!);
      if (!react) continue;
      const { tag, tone } = classifyReaction("minutes", react.shiftsBp, react.real10Bp, react.be10Bp);
      minItems.push({
        date: m.minDate!,
        prevDate: react.prevDate,
        period: `${m.date.slice(0, 7)} 会议纪要`,
        headline: `${m.date.slice(5)} 会议纪要发布`,
        readings: [
          { label: "对应会议", valueText: `${m.start.slice(5)}–${m.date.slice(8)}` },
          { label: "原会议属性", valueText: m.sep ? "含 SEP 点阵图" : "常规会议" },
        ],
        prevCurve: react.prevCurve,
        curve: react.curve,
        shiftsBp: react.shiftsBp,
        real10Bp: react.real10Bp,
        be10Bp: react.be10Bp,
        regimeTag: tag,
        regimeTone: tone,
        confounders: getConfounders(m.minDate!, "FOMC 会议纪要"),
        sourceUrl: m.minUrl!,
        sourceName: "美联储 FOMC 纪要原文",
      });
    }
    if (minItems.length >= 2) {
      series.minutes = {
        key: "minutes",
        name: "FOMC 会议纪要",
        methodology: "纪要发布日与对应会议采自美联储官网日历；市场反应取美国财政部官方日终平价与 TIPS 曲线 T-1 → T 变动。",
        items: minItems,
      };
    }
  }

  // 4. ALFRED Strict-Vintage Macro Series: Retail Sales, Durable Goods, Initial Claims
  //    (ONLY accepted if ALFRED proves the new observation first appeared on that exact release date!)
  const retailDates = censusSched.filter(r => /Advance Monthly Sales for Retail/i.test(r.detail) && eligible(r.date))
    .sort((a, b) => a.date.localeCompare(b.date)).slice(-MAX_ITEMS).reverse();
  {
    const items: HistoricalReplay[] = [];
    for (const c of retailDates) {
      const react = reactionOn(curves, c.date);
      if (!react) continue;
      const [head, exAuto, food] = await Promise.all([
        fetchVerifiedVintageMom("RSAFS", c.date),
        fetchVerifiedVintageMom("RSFSXMV", c.date),
        fetchVerifiedVintageMom("RSFSDP", c.date),
      ]);
      if (!head) continue;
      const readings: ReplayReading[] = [
        { label: "整体零售月率", valueText: `${head.mom > 0 ? "+" : ""}${head.mom.toFixed(1)}%`, num: head.mom },
        ...(exAuto ? [{ label: "剔除汽车月率", valueText: `${exAuto.mom > 0 ? "+" : ""}${exAuto.mom.toFixed(1)}%`, num: exAuto.mom }] : []),
        ...(food ? [{ label: "餐饮服务月率", valueText: `${food.mom > 0 ? "+" : ""}${food.mom.toFixed(1)}%`, num: food.mom }] : []),
      ];
      const { tag, tone } = classifyReaction("retail", react.shiftsBp, react.real10Bp, react.be10Bp);
      items.push({
        date: c.date,
        prevDate: react.prevDate,
        period: chinesePeriod(c.detail),
        headline: readings.slice(0, 2).map(r => `${r.label.replace("月率", "")} ${r.valueText}`).join(" · "),
        readings,
        prevCurve: react.prevCurve,
        curve: react.curve,
        shiftsBp: react.shiftsBp,
        real10Bp: react.real10Bp,
        be10Bp: react.be10Bp,
        regimeTag: tag,
        regimeTone: tone,
        confounders: getConfounders(c.date, "美国零售销售"),
        sourceUrl: "https://www.census.gov/retail/index.html",
        sourceName: "Census / ALFRED 原始口径",
      });
    }
    if (items.length >= 2) {
      attachPriorDeltas(items, "整体零售月率", "pct", 1);
      series.retail = {
        key: "retail",
        name: "美国零售销售",
        methodology: "月率基于圣路易斯联储 ALFRED 发布当日原始快照（vintage_date = 发布日）计算，杜绝事后修订偏差；反应取财政部日终曲线 T-1 → T。",
        items,
      };
    }
  }

  const durableDates = censusSched.filter(r => /Advance Report on Durable Goods/i.test(r.detail) && eligible(r.date))
    .sort((a, b) => a.date.localeCompare(b.date)).slice(-MAX_ITEMS).reverse();
  {
    const items: HistoricalReplay[] = [];
    for (const c of durableDates) {
      const react = reactionOn(curves, c.date);
      if (!react) continue;
      const [head, coreCap] = await Promise.all([
        fetchVerifiedVintageMom("DGORDER", c.date),
        fetchVerifiedVintageMom("NEWORDER", c.date),
      ]);
      if (!head) continue;
      const readings: ReplayReading[] = [
        { label: "耐用品订单月率", valueText: `${head.mom > 0 ? "+" : ""}${head.mom.toFixed(1)}%`, num: head.mom },
        ...(coreCap ? [{ label: "核心资本品订单", valueText: `${coreCap.mom > 0 ? "+" : ""}${coreCap.mom.toFixed(1)}%`, num: coreCap.mom }] : []),
      ];
      const { tag, tone } = classifyReaction("durables", react.shiftsBp, react.real10Bp, react.be10Bp);
      items.push({
        date: c.date,
        prevDate: react.prevDate,
        period: chinesePeriod(c.detail),
        headline: readings.map(r => `${r.label.replace("订单月率", "").replace("订单", "")} ${r.valueText}`).join(" · "),
        readings,
        prevCurve: react.prevCurve,
        curve: react.curve,
        shiftsBp: react.shiftsBp,
        real10Bp: react.real10Bp,
        be10Bp: react.be10Bp,
        regimeTag: tag,
        regimeTone: tone,
        confounders: getConfounders(c.date, "耐用品订单初值"),
        sourceUrl: "https://www.census.gov/manufacturing/m3/index.html",
        sourceName: "Census / ALFRED 原始口径",
      });
    }
    if (items.length >= 2) {
      attachPriorDeltas(items, "核心资本品订单", "pct", 1);
      series.durables = {
        key: "durables",
        name: "耐用品订单初值",
        methodology: "月率基于圣路易斯联储 ALFRED 发布当日原始快照计算（核心资本品为剔除国防与飞机口径）；反应取财政部日终曲线 T-1 → T。",
        items,
      };
    }
  }

  // Initial Claims: check recent 7 Thursdays via strict ALFRED vintage gate
  {
    const thursdays: string[] = [];
    for (let back = 1; back <= 56 && thursdays.length < 7; back++) {
      const d = addDays(curveThrough, -back + 1);
      if (new Date(d + "T12:00:00Z").getUTCDay() === 4 && eligible(d)) thursdays.push(d);
    }
    const items: HistoricalReplay[] = [];
    for (const d of thursdays) {
      if (items.length >= MAX_ITEMS) break;
      const react = reactionOn(curves, d);
      if (!react) continue;
      const [prevIcsa, relIcsa, relCcsa] = await Promise.all([
        fetchAlfredTail("ICSA", addDays(d, -1)),
        fetchAlfredTail("ICSA", d),
        fetchAlfredTail("CCSA", d),
      ]);
      const latest = relIcsa.at(-1);
      const prior = relIcsa.at(-2);
      const prevLatest = prevIcsa.at(-1);
      if (!latest || !prior || !prevLatest || latest.obsDate <= prevLatest.obsDate) continue;
      const k = Math.round(latest.value / 1000);
      const diffK = Math.round((latest.value - prior.value) / 1000);
      const ccsaLatest = relCcsa.at(-1);
      const readings: ReplayReading[] = [
        { label: "初请失业金", valueText: `${k} 千人`, num: k, deltaText: diffK === 0 ? "持平前周" : `较前周 ${diffK > 0 ? "+" : ""}${diffK}千` },
        ...(ccsaLatest ? [{ label: "续请失业金", valueText: `${Math.round(ccsaLatest.value / 1000)} 千人`, num: Math.round(ccsaLatest.value / 1000) }] : []),
      ];
      const { tag, tone } = classifyReaction("claims", react.shiftsBp, react.real10Bp, react.be10Bp);
      items.push({
        date: d,
        prevDate: react.prevDate,
        period: `截至 ${latest.obsDate.slice(5)} 周`,
        headline: `初请 ${k}k (${diffK > 0 ? "+" : ""}${diffK}k)`,
        readings,
        prevCurve: react.prevCurve,
        curve: react.curve,
        shiftsBp: react.shiftsBp,
        real10Bp: react.real10Bp,
        be10Bp: react.be10Bp,
        regimeTag: tag,
        regimeTone: tone,
        confounders: getConfounders(d, "初请失业金"),
        sourceUrl: "https://www.dol.gov/ui/data.pdf",
        sourceName: "DOL / ALFRED 原始口径",
      });
    }
    if (items.length >= 2) {
      series.claims = {
        key: "claims",
        name: "初请失业金",
        methodology: "每周初请/续请均经 ALFRED 发布当日快照核验（严格剔除事后修正）；市场反应取美国财政部官方日终平价与 TIPS 曲线 T-1 → T 变动。",
        items,
      };
    }
  }

  // 5. All US Treasury Auctions (grouped by exact auctionKey: 2y/3y/5y/7y/10y/20y/30y, TIPS, FRN, T-bills)
  for (const [auctionKey, rawList] of auctionsByKey.entries()) {
    const sorted = rawList.sort((a, b) => b.date.localeCompare(a.date)).slice(0, MAX_ITEMS);
    const key = "auction:" + auctionKey;
    const validDeals = sorted.map(x => x.dealer).filter((v): v is number => v !== undefined);
    const avgDealer = validDeals.length >= 2 ? validDeals.reduce((a, b) => a + b, 0) / validDeals.length : undefined;
    const avgBtc = sorted.length >= 2 ? sorted.reduce((a, b) => a + b.btc, 0) / sorted.length : undefined;

    const items: HistoricalReplay[] = [];
    for (const a of sorted) {
      const react = reactionOn(curves, a.date);
      if (!react) continue;
      const { tag, tone } = classifyReaction(key, react.shiftsBp, react.real10Bp, react.be10Bp);
      const btcDiff = avgBtc !== undefined ? Number((a.btc - avgBtc).toFixed(2)) : null;
      const dlrDiff = avgDealer !== undefined && a.dealer !== undefined ? Number((a.dealer - avgDealer).toFixed(1)) : null;
      const readings: ReplayReading[] = [
        { label: a.stopLabel, valueText: a.stopVal.toFixed(3) + "%", num: a.stopVal },
        {
          label: "投标倍数", valueText: a.btc.toFixed(2) + "×", num: a.btc,
          ...(btcDiff !== null ? { deltaText: `较近${sorted.length}次均值 ${btcDiff > 0 ? "+" : ""}${btcDiff.toFixed(2)}×` } : {}),
        },
        ...(a.dealer !== undefined ? [{
          label: "一级交易商", valueText: a.dealer.toFixed(1) + "%", num: a.dealer,
          ...(dlrDiff !== null ? { deltaText: `较均值 ${dlrDiff > 0 ? "+" : ""}${dlrDiff.toFixed(1)}pct` } : {}),
        }] : []),
        ...(a.indirect !== undefined ? [{ label: "间接投标", valueText: a.indirect.toFixed(1) + "%", num: a.indirect }] : []),
        ...(a.direct !== undefined ? [{ label: "直接投标", valueText: a.direct.toFixed(1) + "%", num: a.direct }] : []),
      ];
      const period = [a.reopening ? "续发" : "新发", a.sizeBn ? `$${a.sizeBn}bn` : ""].filter(Boolean).join(" · ");
      const headline = `${a.stopVal.toFixed(3)}% · BTC ${a.btc.toFixed(2)}×${a.dealer !== undefined ? ` · Dealer ${a.dealer.toFixed(1)}%` : ""}`;
      items.push({
        date: a.date,
        prevDate: react.prevDate,
        period,
        headline,
        readings,
        prevCurve: react.prevCurve,
        curve: react.curve,
        shiftsBp: react.shiftsBp,
        real10Bp: react.real10Bp,
        be10Bp: react.be10Bp,
        regimeTag: tag,
        regimeTone: tone,
        confounders: getConfounders(a.date, a.title),
        sourceUrl: a.pdfUrl,
        sourceName: "TreasuryDirect 拍卖结果 PDF",
      });
    }
    if (items.length >= 2) {
      series[key] = {
        key,
        name: sorted[0].title,
        methodology: "中标收益率、投标倍数与一/二/三级获配占比直采 TreasuryDirect 官方拍卖结果；市场反应取财政部日终平价与 TIPS 曲线 T-1 → T 变动。",
        items,
      };
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    curveThrough,
    series: Object.fromEntries(Object.keys(series).sort().map(k => [k, series[k]])),
  };
}

export async function refreshReplaysFile(file = "replays.json") {
  const previous = await readFile(file, "utf8").then(raw => JSON.parse(raw) as ReplayCatalog).catch(() => null);
  const next = await buildReplayCatalog();
  const stripMeta = (cat: ReplayCatalog | null) =>
    cat ? JSON.stringify({ curveThrough: cat.curveThrough, series: cat.series }) : "";
  if (stripMeta(previous) === stripMeta(next)) return { changed: false, catalog: previous ?? next };
  await writeFile(file + ".tmp", JSON.stringify(next, null, 2) + "\n");
  await rename(file + ".tmp", file);
  return { changed: true, catalog: next };
}
