import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, AlertTriangle, ArrowDownUp, BarChart3, BookOpen, CalendarDays, CheckCircle2, ChevronLeft,
  ChevronRight, Clock, Database, ExternalLink, GitBranch, Globe, History, Layers, LineChart, Moon,
  Play, RefreshCw, RotateCcw, Search, SlidersHorizontal, Sparkles, Sun, TrendingUp, X,
} from "lucide-react";
import { analysis, dimensions, scenariosFor } from "./analysis";
import {
  addDays, categories, curveValue, formatEventClock, impactSort, impactText, isPastEvent,
  isWeek, legacyTenors, newYorkDate, newYorkInstant, realCurveValue, sourceIndex, tenors,
  timeSort, tzIana, tzLabel, tzShortTag, weekOf, type Calendar, type Category, type CurvePoint,
  type MarketEvent, type Reading, type SourceCheck, type Tenor, type TzMode,
} from "./model";
import { loadCalendars, loadLiveCurve, loadReplays, type LiveCurve } from "./pages-data";
import { playbookByKey, playbookFor, type Playbook } from "./playbooks";
import { coReleases, groupReleases, lessonFor, lessons } from "./learning";
import { CurveGuide, hasHistoricalPractice, HistoryPractice, LessonCard, LessonDirectory, ReleaseGroup } from "./learning-view";
import { projectionByKey, projectionFor, type EventProjectionSet } from "./projections";
import {
  eventCurveBase, focusTenorIndexForReplay, replayKeyForEvent, replayKeyForLibrary, selectReplayItems,
  type HistoricalReplay, type ReplayCatalog, type ReplaySeries,
} from "./replay-model";
import { nowcastUrl } from "./releases";
import { actualFor, priorFor, ruleFor, scenarioFor } from "./scenarios";
import { seedCalendar } from "./seed";
import { MarketsView, MarketStatistics } from "./markets-view";
import { AlphaPaperView } from "./alpha-paper-view";
import { AlphaExplainView } from "./alpha-explain-view";
import { AlphaBriefingView } from "./alpha-briefing-view";

type ViewId = "overview" | "calendar" | "scenarios" | "alpha" | "alpha-explain" | "alpha-briefing" | "sources" | "markets" | "market-stats";
type DrawerTab = "learn" | "scenario" | "replay";
type ThemeMode = "light" | "dark";
type BenchMode = "1D" | "1W" | "1M";
type Comparison = "manual" | "model" | "prior";
type SavedScenarioInput = { expected?: string; hypothesis?: string; components?: string; stance?: string; comparison?: Comparison };

const STORAGE_THEME = "ust-desk-theme";
const STORAGE_TZ = "ust-desk-tz";
const STORAGE_SCENARIOS = "ust-desk-scenarios-v1";

const validViews: ViewId[] = ["overview", "calendar", "scenarios", "alpha", "alpha-explain", "alpha-briefing", "sources", "markets", "market-stats"];
const short = (date: string) => date.slice(5).replace("-", "/");
const sign = (value: number, digits = 1) => (value > 0 ? "+" : "") + value.toFixed(digits);

function readViewFromUrl(): ViewId {
  const param = new URLSearchParams(location.search).get("view") as ViewId | null;
  if (param && validViews.includes(param)) return param;
  const hash = location.hash.replace(/^#/, "") as ViewId;
  if (validViews.includes(hash)) return hash;
  return "overview";
}

function formatStamp(stamp: string | null, tz: TzMode) {
  if (!stamp) return "暂无";
  const formatted = new Intl.DateTimeFormat("zh-CN", {
    timeZone: tzIana(tz), month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(stamp));
  return formatted + " " + tzShortTag(tz);
}

function formatClockSec(stamp: string | null, tz: TzMode) {
  if (!stamp) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tzIana(tz), hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).format(new Date(stamp)) + " " + tzShortTag(tz);
}

function readingText(reading: Reading) {
  const digits = reading.digits ?? (reading.unit === "千人" ? 0 : 1);
  const prefix = reading.signed && reading.value > 0 ? "+" : "";
  const num = prefix + reading.value.toFixed(digits);
  if (reading.unit === "%") return num + "%";
  if (reading.unit === "×") return num + "×";
  return num + " " + reading.unit;
}

function countdownText(event: MarketEvent, now: Date) {
  if (!event.time) {
    const today = newYorkDate(now);
    const days = Math.round((Date.parse(event.date + "T12:00:00Z") - Date.parse(today + "T12:00:00Z")) / 86400000);
    if (days <= 0) return "今日";
    if (days === 1) return "明日";
    return days + "天后";
  }
  const diffMin = Math.round((newYorkInstant(event.date, event.time).getTime() - now.getTime()) / 60000);
  if (diffMin <= 0) return "即将发布";
  if (diffMin < 60) return diffMin + "分钟后";
  const hours = Math.floor(diffMin / 60);
  if (hours < 24) return hours + "小时后";
  return Math.floor(hours / 24) + "天后";
}

function pickBenchmark(points: CurvePoint[], bench: BenchMode): CurvePoint | undefined {
  if (points.length < 2) return undefined;
  const latest = points.at(-1)!;
  if (bench === "1D") return points.at(-2);
  const target = addDays(latest.date, bench === "1W" ? -7 : -30);
  const prior = points.slice(0, -1);
  return prior.findLast(point => point.date <= target);
}

function loadSavedScenarios(): Record<string, SavedScenarioInput> {
  try {
    const raw = localStorage.getItem(STORAGE_SCENARIOS);
    return raw ? JSON.parse(raw) as Record<string, SavedScenarioInput> : {};
  } catch {
    return {};
  }
}

function saveScenarioInput(id: string, input: SavedScenarioInput) {
  try {
    const all = loadSavedScenarios();
    const empty = (!input.comparison || input.comparison === "manual") && !input.expected && !input.hypothesis && (!input.components || input.components === "unknown") && (!input.stance || input.stance === "none");
    if (empty) delete all[id];
    else all[id] = input;
    localStorage.setItem(STORAGE_SCENARIOS, JSON.stringify(all));
  } catch {
    // ignore storage errors
  }
}

const stateText: Record<SourceCheck["state"], string> = {
  verified: "已核对",
  cached: "使用缓存",
  unavailable: "暂缺",
  reference: "参考",
  unscheduled: "官网未排期",
};

const primaryNav: { id: ViewId; title: string; icon: typeof LineChart }[] = [
  { id: "overview", title: "利率总览", icon: LineChart },
  { id: "calendar", title: "发布日历", icon: CalendarDays },
  { id: "scenarios", title: "情景与历史", icon: Activity },
];

function SourceLink({ url, label }: { url: string; label: string }) {
  return <a className="source-link" href={url} target="_blank" rel="noreferrer">{label}<ExternalLink size={12.5} /></a>;
}

/* ---------- Overview Components ---------- */

function Curve({ points, live, showLive, canLive, onToggleLive, onLearn, tz }: {
  points: CurvePoint[];
  live: LiveCurve | null;
  showLive: boolean;
  canLive: boolean;
  onToggleLive: (useLive: boolean) => void;
  onLearn: () => void;
  tz: TzMode;
}) {
  const latestEod = points.at(-1);
  const usingLive = Boolean(showLive && canLive && live);
  const [bench, setBench] = useState<BenchMode>("1D");
  const [focus, setFocus] = useState<number | null>(null);
  const compareEod = pickBenchmark(points, bench);

  const activeTenors: readonly Tenor[] = usingLive
    ? tenors
    : latestEod && latestEod.values.length === tenors.length
      ? tenors
      : (legacyTenors as readonly Tenor[]);

  const latestVals = usingLive
    ? live!.values
    : latestEod ? activeTenors.map(t => curveValue(latestEod, t) ?? NaN) : [];

  const compareVals = usingLive && bench === "1D"
    ? live!.prevValues.map(v => v ?? NaN)
    : compareEod ? activeTenors.map(t => curveValue(compareEod, t) ?? NaN) : [];

  const hasCompare = compareVals.length === activeTenors.length && compareVals.every(Number.isFinite);
  const bpDigits = usingLive && bench === "1D" ? 1 : 0;
  const yDigits = usingLive ? 3 : 2;
  const deltasBp = activeTenors.map((_, i) =>
    hasCompare && Number.isFinite(latestVals[i])
      ? Number(((latestVals[i] - compareVals[i]) * 100).toFixed(bpDigits))
      : null
  );

  // Exact trading dates for solid & dashed lines
  const liveNyDate = usingLive ? newYorkDate(new Date(live!.asOf)) : null;
  const livePrevDate = liveNyDate
    ? (points.filter(p => p.date < liveNyDate).at(-1)?.date ?? latestEod?.date ?? null)
    : null;
  const solidLegend = usingLive
    ? `实时现券 ${liveNyDate} ${formatClockSec(live!.asOf, tz)} (${live!.exchange})`
    : latestEod ? `财政部日终 ${latestEod.date}` : "暂无数据";
  const dashedLegend = !hasCompare ? null
    : usingLive && bench === "1D"
      ? `昨收 ${livePrevDate ?? "上一交易日"} (${live!.exchange})`
      : compareEod
        ? `${bench === "1D" ? "上一观测日" : bench + " 基准"} ${compareEod.date} (财政部日终)`
        : null;
  const front = deltasBp[activeTenors.indexOf("2Y")];
  const back = deltasBp[activeTenors.indexOf("10Y")];
  const curveObservation = front != null && back != null && dashedLegend ? {
    front, back, window: dashedLegend + " → " + solidLegend, sameSource: !usingLive || bench === "1D",
  } : undefined;

  // Dual-pane vertically aligned SVG geometry: Top = Yield Curve, Bottom = Aligned Δbp Bars
  const validVals = [...latestVals, ...(hasCompare ? compareVals : [])].filter(Number.isFinite);
  const start = validVals.length ? Math.min(...validVals) - 0.1 : 0;
  const end = validVals.length ? Math.max(...validVals) + 0.12 : 1;
  const width = 560, height = hasCompare ? 300 : 196;
  const padL = 48, padR = 22;
  const x = (index: number) => activeTenors.length > 1
    ? padL + (width - padL - padR) * index / (activeTenors.length - 1)
    : width / 2;
  const y = (value: number) => 148 - 118 * (value - start) / Math.max(0.01, end - start);
  const linePath = (vals: number[]) => vals.map((v, i) => x(i).toFixed(1) + "," + y(v).toFixed(1)).join(" ");
  const areaPath = latestVals.length
    ? `M ${x(0).toFixed(1)},148 L ${latestVals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" L ")} L ${x(latestVals.length - 1).toFixed(1)},148 Z`
    : "";

  const maxAbsBp = Math.max(5, Math.ceil(Math.max(0, ...deltasBp.map(d => (d === null ? 0 : Math.abs(d))))));
  const zeroY = 226;
  const barY = (bp: number) => zeroY - (bp / maxAbsBp) * 32;
  const colW = activeTenors.length > 1 ? (width - padL - padR) / (activeTenors.length - 1) : 60;

  const valOf = (arr: number[], t: Tenor) => {
    const idx = activeTenors.indexOf(t);
    return idx >= 0 && Number.isFinite(arr[idx]) ? arr[idx] : undefined;
  };
  const spreadMetrics = useMemo(() => {
    const cur = latestVals, cmp = hasCompare ? compareVals : [];
    const build = (
      id: string, name: string, formula: string,
      calc: (arr: number[]) => number | undefined,
      posWord: string, negWord: string,
    ) => {
      const v = calc(cur);
      if (v === undefined) return null;
      const pv = hasCompare ? calc(cmp) : undefined;
      const d = pv !== undefined ? Number((v - pv).toFixed(bpDigits)) : null;
      return { id, name, formula, value: v, delta: d, trend: d === null || d === 0 ? "持平" : d > 0 ? posWord : negWord };
    };
    const r10 = realCurveValue(latestEod, "10Y");
    const eod10 = curveValue(latestEod, "10Y");
    const be10 = eod10 !== undefined && r10 !== undefined ? eod10 - r10 : undefined;
    const pr10 = realCurveValue(compareEod, "10Y");
    const peod10 = curveValue(compareEod, "10Y");
    const pbe10 = peod10 !== undefined && pr10 !== undefined ? peod10 - pr10 : undefined;
    const tipsCards = [
      r10 !== undefined ? {
        id: "r10", name: "10Y 实际利率", formula: "TIPS 日终",
        valueText: r10.toFixed(2) + "%",
        delta: pr10 !== undefined ? Math.round((r10 - pr10) * 100) : null,
        deltaDigits: 0,
        trend: pr10 !== undefined ? (r10 > pr10 ? "实际利率↑" : r10 < pr10 ? "实际利率↓" : "持平") : "财政部日终",
      } : null,
      be10 !== undefined ? {
        id: "be10", name: "10Y Breakeven", formula: "名义 − 实际 (日终)",
        valueText: be10.toFixed(2) + "%",
        delta: pbe10 !== undefined ? Math.round((be10 - pbe10) * 100) : null,
        deltaDigits: 0,
        trend: pbe10 !== undefined ? (be10 > pbe10 ? "通胀补偿↑" : be10 < pbe10 ? "通胀补偿↓" : "持平") : "财政部日终",
      } : null,
    ].filter((m): m is NonNullable<typeof m> => Boolean(m));

    const shapeCards = [
      build("2s10s", "2s10s", "10Y − 2Y", a => {
        const a2 = valOf(a, "2Y"), a10 = valOf(a, "10Y");
        return a2 !== undefined && a10 !== undefined ? (a10 - a2) * 100 : undefined;
      }, "走陡", "趋平"),
      build("5s30s", "5s30s", "30Y − 5Y", a => {
        const a5 = valOf(a, "5Y"), a30 = valOf(a, "30Y");
        return a5 !== undefined && a30 !== undefined ? (a30 - a5) * 100 : undefined;
      }, "走陡", "趋平"),
      build("2s5s10s", "2s5s10s Fly", "2×5Y − 2Y − 10Y", a => {
        const a2 = valOf(a, "2Y"), a5 = valOf(a, "5Y"), a10 = valOf(a, "10Y");
        return a2 !== undefined && a5 !== undefined && a10 !== undefined ? (2 * a5 - a2 - a10) * 100 : undefined;
      }, "Belly 走弱", "Belly 走强"),
      build("10s20s30s", "10/20/30 Fly", "2×20Y − 10Y − 30Y", a => {
        const a10 = valOf(a, "10Y"), a20 = valOf(a, "20Y"), a30 = valOf(a, "30Y");
        return a10 !== undefined && a20 !== undefined && a30 !== undefined ? (2 * a20 - a10 - a30) * 100 : undefined;
      }, "20Y 走弱", "20Y 走强"),
    ].filter((m): m is NonNullable<typeof m> => Boolean(m)).map(m => ({
      ...m,
      valueText: sign(m.value, bpDigits) + " bp",
      deltaDigits: bpDigits,
    }));

    return [...shapeCards, ...tipsCards];
  }, [latestVals, compareVals, hasCompare, bpDigits, activeTenors, latestEod, compareEod]);

  const focusedIdx = focus !== null && focus < activeTenors.length ? focus : null;

  return <section className="panel glass curve" aria-labelledby="curve-title">
    <div className="panel-header curve-header">
      <div>
        <div className="curve-title-row">
          <h2 id="curve-title">美债收益率曲线与基点变动</h2>
          {usingLive && <span className="live-badge"><i className="live-dot" />LIVE · {live!.exchange}</span>}
        </div>
        <p>{usingLive ? "每 30 秒自动刷新 · 上图为收益率曲线，下方同轴对齐为较基准基点变动" : "财政部官方日终平价曲线 · 下方同轴对齐为较基准基点变动"}</p>
      </div>
      <div className="curve-controls">
        {canLive && live && (
          <div className="segmented" role="group" aria-label="行情源">
            <button type="button" className={showLive ? "active" : ""} onClick={() => onToggleLive(true)}>实时</button>
            <button type="button" className={!showLive ? "active" : ""} onClick={() => onToggleLive(false)}>日终</button>
          </div>
        )}
        <div className="segmented" role="group" aria-label="对比基准">
          {(["1D", "1W", "1M"] as const).map(b => (
            <button key={b} type="button" className={bench === b ? "active" : ""} onClick={() => setBench(b)} disabled={points.length < 2 && !(usingLive && b === "1D")}>{b}</button>
          ))}
        </div>
      </div>
    </div>

    {latestVals.length > 0 ? <>
      <div className="curve-legend-bar" aria-label="曲线图例">
        <span className="legend-item">
          <i className="swatch swatch-solid" />
          <b>实线</b> {solidLegend}
        </span>
        {dashedLegend && <span className="legend-item">
          <i className="swatch swatch-dashed" />
          <b>虚线</b> {dashedLegend}
        </span>}
      </div>

      <svg className="curve-chart-dual" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="美债收益率曲线及各期限基点变动">
        <defs>
          <linearGradient id="curveArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {/* Top Pane: Yield Curve */}
        {[0, 1, 2, 3].map(i => {
          const value = start + (end - start) * i / 3;
          return <g key={i}>
            <line x1={padL} x2={width - padR} y1={y(value)} y2={y(value)} className="grid-line" />
            <text x={padL - 7} y={y(value) + 3.5} textAnchor="end">{value.toFixed(2)}%</text>
          </g>;
        })}
        <path d={areaPath} fill="url(#curveArea)" />
        {hasCompare && <polyline fill="none" className="compare-line" strokeWidth="1.8" strokeDasharray="4 4" points={linePath(compareVals)} />}
        <polyline fill="none" className="main-line" strokeWidth="2.8" strokeLinejoin="round" strokeLinecap="round" points={linePath(latestVals)} />

        {/* Bottom Pane: Aligned Δbp Histogram */}
        {hasCompare && <>
          <line x1={padL} x2={width - padR} y1="166" y2="166" className="pane-divider" />
          <text x={padL} y="180" className="pane-tag">较虚线变动 (bp)</text>
          <text x={width - padR} y="180" textAnchor="end" className="pane-hint">橙红 = 上行 · 翠绿 = 下行</text>
          <line x1={padL} x2={width - padR} y1={zeroY} y2={zeroY} className="zero-line" />
          <text x={padL - 7} y={zeroY + 3.5} textAnchor="end">0</text>
          <text x={padL - 7} y="198" textAnchor="end">+{maxAbsBp}</text>
          <text x={padL - 7} y="260" textAnchor="end">-{maxAbsBp}</text>
        </>}

        {/* Synchronized Interactive Columns for Every Tenor */}
        {latestVals.map((value, i) => {
          const active = focusedIdx === i;
          const d = deltasBp[i];
          const cx = x(i), cy = y(value);
          const tipX = Math.min(Math.max(cx, 84), width - 84);
          const tipY = cy < 50 ? cy + 28 : cy - 16;
          const barTop = d !== null ? (d >= 0 ? barY(d) : zeroY) : zeroY;
          const barH = d !== null ? Math.max(2.5, Math.abs(barY(d) - zeroY)) : 0;
          const bpLabelY = d !== null ? (d >= 0 ? barTop - 5 : barTop + barH + 11) : zeroY;
          const tenorY = hasCompare ? 288 : 176;

          return <g key={activeTenors[i]} className="curve-point"
            onPointerEnter={e => { if (e.pointerType === "mouse") setFocus(i); }}
            onPointerLeave={e => { if (e.pointerType === "mouse") setFocus(null); }}
            onClick={() => setFocus(prev => prev === i ? null : i)}>
            {active && <line x1={cx} x2={cx} y1="24" y2={hasCompare ? 272 : 154} className="focus-guide" />}
            <circle cx={cx} cy={cy} r={active ? 6 : 3.8} className="curve-dot" />
            {hasCompare && d !== null && <>
              <rect x={cx - 12} y={barTop} width="24" height={barH} rx="5"
                className={(d > 0 ? "bar-up" : d < 0 ? "bar-down" : "bar-flat") + (active ? " bar-active" : "")} />
              <text x={cx} y={bpLabelY} textAnchor="middle"
                className={"bp-val " + (d > 0 ? "bp-up" : d < 0 ? "bp-down" : "")}>{sign(d, bpDigits)}</text>
            </>}
            <text x={cx} y={tenorY} textAnchor="middle" className={"tenor-lbl" + (active ? " tenor-active" : "")}>{activeTenors[i]}</text>
            <rect x={cx - colW / 2} y="16" width={colW} height={height - 20} fill="transparent">
              <title>{activeTenors[i] + " " + value.toFixed(yDigits) + "%" + (d !== null ? " (" + sign(d, bpDigits) + " bp)" : "")}</title>
            </rect>
            {active && <g className="svg-callout">
              <rect x={tipX - 68} y={tipY - 15} width="136" height="22" rx="11" />
              <text x={tipX} y={tipY} textAnchor="middle" className="chart-value">
                {activeTenors[i]} {value.toFixed(yDigits)}%{d !== null ? " · " + sign(d, bpDigits) + "bp" : ""}
              </text>
            </g>}
          </g>;
        })}
      </svg>

      {/* Redesigned 6-Card Curve Structure & TIPS Grid */}
      {spreadMetrics.length > 0 && <div className="curve-metrics" aria-label="关键期限利差、蝶式结构与 TIPS 指标">
        {spreadMetrics.map(m => (
          <div className="cm-card" key={m.id}>
            <div className="cm-top">
              <strong>{m.name}</strong>
              <span>{m.formula}</span>
            </div>
            <div className="cm-val">{m.valueText}</div>
            <div className="cm-foot">
              {m.delta !== null ? <>
                <em className={m.delta > 0 ? "txt-up" : m.delta < 0 ? "txt-down" : "txt-muted"}>{sign(m.delta, m.deltaDigits)} bp</em>
                <span className="cm-trend">{m.trend}</span>
              </> : <span className="cm-trend">{m.trend}</span>}
            </div>
          </div>
        ))}
      </div>}
    </> : <p className="empty">该日期之前暂无可用的曲线数据。</p>}
    <CurveGuide observation={curveObservation} onLearn={onLearn} />
  </section>;
}

/* ---------- Interactive Animated UST Curve Projection Visualizer ---------- */

const fallbackBaseCurve = [4.30, 4.52, 4.65, 4.68, 4.74, 4.83, 4.95, 5.36, 5.32];

function focusTenorIndexFor(key: string, event?: MarketEvent): number {
  if (key === "auction_20y") return 7;
  if (key === "auction_30y") return 8;
  if (key === "auction_10y" || key === "tips" || key === "gdp" || key === "retail" || key === "durables") return 6;
  if (key === "auction_belly") return event?.auctionKey?.startsWith("5y") ? 4 : 5;
  if (key === "bills") return 0;
  return 2; // 2Y default for inflation/jobs/ECI/FOMC/front auction
}

function useAnimatedVector(target: number[], duration = 440, trigger = 0, resetKey = "") {
  const [current, setCurrent] = useState<number[]>(target);
  const currentRef = useRef<number[]>(target);
  const initializedRef = useRef(false);
  const prevResetKeyRef = useRef(resetKey);
  const prevTriggerRef = useRef(trigger);
  const targetKey = target.map(v => v.toFixed(3)).join(",");

  useEffect(() => {
    if (typeof window === "undefined" || typeof requestAnimationFrame === "undefined") {
      currentRef.current = target;
      setCurrent(target);
      return;
    }
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      currentRef.current = target;
      setCurrent(target);
      initializedRef.current = true;
      prevResetKeyRef.current = resetKey;
      prevTriggerRef.current = trigger;
      return;
    }

    const shouldStartFromZero = !initializedRef.current
      || prevResetKeyRef.current !== resetKey
      || prevTriggerRef.current !== trigger;
    initializedRef.current = true;
    prevResetKeyRef.current = resetKey;
    prevTriggerRef.current = trigger;

    const from = shouldStartFromZero || currentRef.current.length !== target.length
      ? target.map(() => 0)
      : [...currentRef.current];

    if (shouldStartFromZero) {
      currentRef.current = from;
      setCurrent(from);
    }

    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = target.map((endVal, i) => from[i] + (endVal - from[i]) * eased);
      currentRef.current = next;
      setCurrent(next);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [targetKey, duration, trigger, resetKey]);

  return current;
}

type RibbonSeg = { d: string; cls: "ribbon-up" | "ribbon-down" };

function buildSignedRibbon(
  xs: number[],
  baseYs: number[],
  projYs: number[],
  shifts: number[],
): RibbonSeg[] {
  const segs: RibbonSeg[] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const s0 = shifts[i] ?? 0, s1 = shifts[i + 1] ?? 0;
    if (Math.abs(s0) < 0.05 && Math.abs(s1) < 0.05) continue;
    const x0 = xs[i], x1 = xs[i + 1];
    const b0 = baseYs[i], b1 = baseYs[i + 1];
    const p0 = projYs[i], p1 = projYs[i + 1];

    // If the curve twists across the baseline between i and i+1, split cleanly at the crossing
    if ((s0 > 0 && s1 < 0) || (s0 < 0 && s1 > 0)) {
      const t = s0 / (s0 - s1);
      const xm = x0 + (x1 - x0) * t;
      const ym = b0 + (b1 - b0) * t;
      segs.push({
        d: `M ${x0.toFixed(1)},${b0.toFixed(1)} L ${xm.toFixed(1)},${ym.toFixed(1)} L ${x0.toFixed(1)},${p0.toFixed(1)} Z`,
        cls: s0 > 0 ? "ribbon-up" : "ribbon-down",
      });
      segs.push({
        d: `M ${xm.toFixed(1)},${ym.toFixed(1)} L ${x1.toFixed(1)},${b1.toFixed(1)} L ${x1.toFixed(1)},${p1.toFixed(1)} Z`,
        cls: s1 > 0 ? "ribbon-up" : "ribbon-down",
      });
    } else {
      segs.push({
        d: `M ${x0.toFixed(1)},${b0.toFixed(1)} L ${x1.toFixed(1)},${b1.toFixed(1)} L ${x1.toFixed(1)},${p1.toFixed(1)} L ${x0.toFixed(1)},${p0.toFixed(1)} Z`,
        cls: s0 + s1 >= 0 ? "ribbon-up" : "ribbon-down",
      });
    }
  }
  return segs;
}

type ProjKpi = { label: string; value: number; sub: string };

function buildProjectionKpis(key: string, base: number[], shifts: number[], real10Bp: number, be10Bp: number): ProjKpi[] {
  const [d3m, d1y, d2y, , d5y, d7y, d10y, d20y, d30y] = shifts;
  const slopeSub = (v: number) => Math.abs(v) < 0.4 ? "平行移动" : v > 0 ? "走陡" : "趋平";
  const flySub = (v: number, center: string) => Math.abs(v) < 0.4 ? "形态平稳" : v > 0 ? `${center} 走弱/上凸` : `${center} 走强/收敛`;
  const lvl = (idx: number, d: number) => `→ ${(base[idx] + d / 100).toFixed(2)}%`;

  if (key === "auction_20y") {
    const fly20 = Number((2 * d20y - d10y - d30y).toFixed(1));
    const d5s30s = Number((d30y - d5y).toFixed(1));
    return [
      { label: "20Y 孤儿点", value: d20y, sub: lvl(7, d20y) },
      { label: "10/20/30 Fly", value: fly20, sub: flySub(fly20, "20Y") },
      { label: "10Y 邻券", value: d10y, sub: lvl(6, d10y) },
      { label: "5s30s 斜率", value: d5s30s, sub: slopeSub(d5s30s) },
    ];
  }
  if (key === "auction_belly") {
    const fly5 = Number((2 * d5y - d2y - d10y).toFixed(1));
    const d2s10s = Number((d10y - d2y).toFixed(1));
    return [
      { label: "5Y Belly", value: d5y, sub: lvl(4, d5y) },
      { label: "7Y Belly", value: d7y, sub: lvl(5, d7y) },
      { label: "2s5s10s Fly", value: fly5, sub: flySub(fly5, "Belly") },
      { label: "2s10s 斜率", value: d2s10s, sub: slopeSub(d2s10s) },
    ];
  }
  if (key === "auction_30y") {
    const d5s30s = Number((d30y - d5y).toFixed(1));
    const d10s30s = Number((d30y - d10y).toFixed(1));
    return [
      { label: "30Y 超长债", value: d30y, sub: lvl(8, d30y) },
      { label: "10Y 基准", value: d10y, sub: lvl(6, d10y) },
      { label: "5s30s 斜率", value: d5s30s, sub: slopeSub(d5s30s) },
      { label: "10s30s 斜率", value: d10s30s, sub: slopeSub(d10s30s) },
    ];
  }
  if (key === "tips") {
    const d5s30s = Number((d30y - d5y).toFixed(1));
    return [
      { label: "10Y 实际利率", value: real10Bp, sub: real10Bp > 0.2 ? "TIPS 承压" : real10Bp < -0.2 ? "TIPS 走强" : "平稳" },
      { label: "10Y Breakeven", value: be10Bp, sub: be10Bp > 0.2 ? "通胀补偿走阔" : be10Bp < -0.2 ? "通胀补偿收窄" : "平稳" },
      { label: "10Y 名义联动", value: d10y, sub: lvl(6, d10y) },
      { label: "5s30s 斜率", value: d5s30s, sub: slopeSub(d5s30s) },
    ];
  }
  if (key === "bills") {
    const d3m10s = Number((d10y - d3m).toFixed(1));
    return [
      { label: "3M 国库券", value: d3m, sub: lvl(0, d3m) },
      { label: "1Y 短端", value: d1y, sub: lvl(1, d1y) },
      { label: "2Y 附息", value: d2y, sub: lvl(2, d2y) },
      { label: "3m10s 斜率", value: d3m10s, sub: slopeSub(d3m10s) },
    ];
  }

  const d2s10s = Number((d10y - d2y).toFixed(1));
  const d5s30s = Number((d30y - d5y).toFixed(1));
  return [
    { label: "2Y 收益率变动", value: d2y, sub: lvl(2, d2y) },
    { label: "10Y 收益率变动", value: d10y, sub: lvl(6, d10y) },
    { label: "2s10s 斜率", value: d2s10s, sub: slopeSub(d2s10s) },
    { label: "5s30s 斜率", value: d5s30s, sub: slopeSub(d5s30s) },
  ];
}

function CurveProjection({
  projectionSet,
  baseCurve,
  baseLabel,
  forcedSide,
  forcedScale,
  externalSide,
  externalNonce,
  onSelectSide,
  focusIndex,
}: {
  projectionSet: EventProjectionSet;
  baseCurve: number[];
  baseLabel: string;
  forcedSide?: "above" | "below" | null;
  forcedScale?: number | null;
  externalSide?: "above" | "below" | null;
  externalNonce?: number;
  onSelectSide?: (side: "above" | "below" | "alt") => void;
  focusIndex: number;
}) {
  const [selectedId, setSelectedId] = useState<string>(projectionSet.scenarios[0].id);
  const [scale, setScale] = useState<number>(1);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [replayNonce, setReplayNonce] = useState(0);

  // Reset when switching events/indicators
  useEffect(() => {
    setSelectedId(projectionSet.scenarios[0].id);
    setScale(1);
    setHoverIdx(null);
  }, [projectionSet.key]);

  // Auto-sync with ScenarioCalculator when user enters Expected & Hypothesis or picks Hawkish/Dovish
  useEffect(() => {
    if (!forcedSide) return;
    const matched = projectionSet.scenarios.find(s => s.side === forcedSide);
    if (matched) setSelectedId(matched.id);
    if (forcedScale && Number.isFinite(forcedScale)) {
      setScale(Number(Math.min(1.8, Math.max(0.5, forcedScale)).toFixed(2)));
    }
  }, [forcedSide, forcedScale, projectionSet]);

  // Bi-directional sync when user clicks a scenario card below
  useEffect(() => {
    if (!externalSide || !externalNonce) return;
    const matched = projectionSet.scenarios.find(s => s.side === externalSide);
    if (matched) setSelectedId(matched.id);
  }, [externalSide, externalNonce, projectionSet]);

  const active = projectionSet.scenarios.find(s => s.id === selectedId) ?? projectionSet.scenarios[0];
  const targetShifts = useMemo(
    () => active.shifts.map(bp => Number((bp * scale).toFixed(2))),
    [active, scale]
  );

  const animShifts = useAnimatedVector(targetShifts, 440, replayNonce, projectionSet.key);

  function selectScenario(sc: EventProjectionSet["scenarios"][number]) {
    setSelectedId(sc.id);
    onSelectSide?.(sc.side);
  }

  function replayMorph() {
    setReplayNonce(n => n + 1);
  }

  if (baseCurve.length !== tenors.length) return <p className="empty">{baseLabel}，暂缺情景点位。</p>;
  const base = baseCurve;
  const projected = base.map((yVal, i) => yVal + (animShifts[i] ?? 0) / 100);
  const avgShift = animShifts.reduce((a, b) => a + b, 0) / animShifts.length;
  const shiftTone = avgShift > 0.35 ? "up" : avgShift < -0.35 ? "down" : "mixed";

  // Fixed steady axis across all scenarios of this event so switching pills feels smooth & physical
  const maxScenarioDelta = Math.max(
    0.14,
    ...projectionSet.scenarios.flatMap(s => s.shifts.map(bp => Math.abs(bp * Math.max(1.2, scale)) / 100))
  );
  const minY = Math.min(...base) - maxScenarioDelta - 0.06;
  const maxY = Math.max(...base) + maxScenarioDelta + 0.08;

  const width = 540, height = 286, padL = 46, padR = 20;
  const x = (i: number) => padL + (width - padL - padR) * i / (tenors.length - 1);
  const y = (val: number) => 142 - 114 * (val - minY) / Math.max(0.05, maxY - minY);
  const colW = (width - padL - padR) / (tenors.length - 1);

  const xs = tenors.map((_, i) => x(i));
  const baseYs = base.map(v => y(v));
  const projYs = projected.map(v => y(v));
  const basePath = xs.map((cx, i) => `${cx.toFixed(1)},${baseYs[i].toFixed(1)}`).join(" ");
  const projPath = xs.map((cx, i) => `${cx.toFixed(1)},${projYs[i].toFixed(1)}`).join(" ");
  const ribbonSegments = buildSignedRibbon(xs, baseYs, projYs, animShifts);

  const maxBarBp = Math.max(
    8,
    Math.ceil(Math.max(...projectionSet.scenarios.flatMap(s => s.shifts.map(bp => Math.abs(bp * Math.max(1.1, scale))))))
  );
  const zeroY = 216;
  const barY = (bp: number) => zeroY - (bp / maxBarBp) * 30;

  const real10Bp = Number((active.realBe10y[0] * scale).toFixed(1));
  const be10Bp = Number((active.realBe10y[1] * scale).toFixed(1));
  const maxDriver = Math.max(4, Math.abs(real10Bp), Math.abs(be10Bp));
  const kpis = buildProjectionKpis(projectionSet.key, base, targetShifts, real10Bp, be10Bp);
  const isCalcSynced = Boolean(forcedSide && active.side === forcedSide);

  const driverBarStyle = (val: number) => {
    const pct = Math.min(50, (Math.abs(val) / maxDriver) * 50);
    return val >= 0
      ? { left: "50%", width: `${pct}%` }
      : { left: `${50 - pct}%`, width: `${pct}%` };
  };

  return <div className="proj-card" aria-label="曲线情景形变推演">
    <div className="proj-head">
      <div>
        <div className="proj-title-row">
          <h3>收益率曲线压力情景</h3>
          <span className={"proj-morph-tag tone-" + active.tone}>{active.tag}</span>
          {isCalcSynced && <span className="proj-sync-badge">试算联动</span>}
        </div>
        <p className="proj-sub">{projectionSet.headline}</p>
      </div>
      <button type="button" className="proj-replay" onClick={replayMorph} title="从基准曲线重播形变动画">
        <Play size={12} />重播形变
      </button>
    </div>

    <div className="proj-pills" role="tablist" aria-label="选择情景路径">
      {projectionSet.scenarios.map(sc => (
        <button key={sc.id} type="button" role="tab" aria-selected={sc.id === active.id}
          className={"proj-pill tone-" + sc.tone + (sc.id === active.id ? " active" : "")}
          onClick={() => selectScenario(sc)}>
          {sc.label}
        </button>
      ))}
    </div>

    <div className="proj-slider-row">
      <span className="proj-base-lbl"><i className="swatch swatch-dashed" />基准：{baseLabel}</span>
      <label className="proj-intensity">
        <span>意外强度 <b>{scale.toFixed(1)}×</b></span>
        <input type="range" min="0.5" max="1.8" step="0.1" value={scale} onChange={e => setScale(Number(e.target.value))} />
      </label>
    </div>

    <svg className="proj-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="基准曲线与预期情景曲线形变图">
      {/* Top Pane: Baseline vs Animated Projected Curve */}
      {[0, 1, 2, 3].map(i => {
        const val = minY + (maxY - minY) * i / 3;
        return <g key={i}>
          <line x1={padL} x2={width - padR} y1={y(val)} y2={y(val)} className="grid-line" />
          <text x={padL - 7} y={y(val) + 3.5} textAnchor="end">{val.toFixed(2)}%</text>
        </g>;
      })}

      {/* Per-Segment Signed Shaded Morph Ribbon (handles twists cleanly!) */}
      {ribbonSegments.map((seg, i) => (
        <path key={i} d={seg.d} className={"proj-ribbon " + seg.cls} />
      ))}
      <polyline fill="none" className="compare-line" strokeWidth="1.7" strokeDasharray="4 4" points={basePath} />
      <polyline fill="none" className={"proj-main-line proj-line-" + shiftTone} strokeWidth="2.8" strokeLinejoin="round" strokeLinecap="round" points={projPath} />

      {/* Bottom Pane: Aligned Projected Δbp Bars */}
      <line x1={padL} x2={width - padR} y1="158" y2="158" className="pane-divider" />
      <text x={padL} y="172" className="pane-tag">预期变动 (bp)</text>
      <text x={width - padR} y="172" textAnchor="end" className="pane-hint">点击期限对比前后利率</text>
      <line x1={padL} x2={width - padR} y1={zeroY} y2={zeroY} className="zero-line" />
      <text x={padL - 7} y={zeroY + 3.5} textAnchor="end">0</text>
      <text x={padL - 7} y="190" textAnchor="end">+{maxBarBp}</text>
      <text x={padL - 7} y="248" textAnchor="end">-{maxBarBp}</text>

      {tenors.map((tenor, i) => {
        const cx = xs[i];
        const by = baseYs[i];
        const py = projYs[i];
        const bp = animShifts[i] ?? 0;
        const isHovered = hoverIdx === i;
        const isKey = i === focusIndex;
        const bTop = bp >= 0 ? barY(bp) : zeroY;
        const bH = Math.max(2, Math.abs(barY(bp) - zeroY));
        const bpTextY = bp >= 0 ? bTop - 5 : bTop + bH + 11;
        const tipX = Math.min(Math.max(cx, 92), width - 92);
        const tipY = Math.min(by, py) < 46 ? Math.max(by, py) + 28 : Math.min(by, py) - 16;

        return <g key={tenor} className="curve-point"
          onPointerEnter={e => { if (e.pointerType === "mouse") setHoverIdx(i); }}
          onPointerLeave={e => { if (e.pointerType === "mouse") setHoverIdx(null); }}
          onClick={() => setHoverIdx(prev => prev === i ? null : i)}>
          {isHovered && <line x1={cx} x2={cx} y1="22" y2="260" className="focus-guide" />}
          {Math.abs(py - by) > 4 && (
            <line x1={cx} x2={cx} y1={by} y2={py} className={"shift-stem stem-" + (bp >= 0 ? "up" : "down")} />
          )}
          <circle cx={cx} cy={by} r="2.6" className="base-dot" />
          {isKey && <circle cx={cx} cy={py} r="8.5" className={"key-halo halo-" + (bp >= 0 ? "up" : "down")} />}
          <circle cx={cx} cy={py} r={isHovered || isKey ? 5.2 : 3.6} className={"proj-dot dot-" + (bp >= 0 ? "up" : "down")} />

          <rect x={cx - 11} y={bTop} width="22" height={bH} rx="4.5"
            className={(bp > 0.2 ? "bar-up" : bp < -0.2 ? "bar-down" : "bar-flat") + (isHovered ? " bar-active" : "")} />
          <text x={cx} y={bpTextY} textAnchor="middle"
            className={"bp-val " + (bp > 0.2 ? "bp-up" : bp < -0.2 ? "bp-down" : "")}>
            {Math.abs(bp) < 0.25 ? "0" : sign(bp, Math.abs(bp) < 10 ? 1 : 0)}
          </text>
          <text x={cx} y="276" textAnchor="middle" className={"tenor-lbl" + (isHovered || isKey ? " tenor-active" : "")}>{tenor}</text>
          <rect x={cx - colW / 2} y="16" width={colW} height="266" fill="transparent" />

          {isHovered && <g className="svg-callout">
            <rect x={tipX - 80} y={tipY - 15} width="160" height="22" rx="11" />
            <text x={tipX} y={tipY} textAnchor="middle" className="chart-value">
              {tenor} {base[i].toFixed(2)}%→{projected[i].toFixed(2)}% ({sign(bp, 1)}bp)
            </text>
          </g>}
        </g>;
      })}
    </svg>

    <div className="proj-kpis">
      {kpis.map(k => (
        <div className="pk-item" key={k.label}>
          <span>{k.label}</span>
          <strong className={k.value > 0.2 ? "txt-up" : k.value < -0.2 ? "txt-down" : ""}>{sign(k.value, 1)} bp</strong>
          <small>{k.sub}</small>
        </div>
      ))}
    </div>

    {(Math.abs(real10Bp) >= 0.3 || Math.abs(be10Bp) >= 0.3) && (
      <div className="proj-drivers" aria-label="10年期实际利率与通胀补偿拆解">
        <div className="driver-row">
          <span>10Y 实际利率</span>
          <div className="driver-track">
            <i className="driver-zero" />
            <div className={"driver-fill " + (real10Bp >= 0 ? "up" : "down")} style={driverBarStyle(real10Bp)} />
          </div>
          <strong className={real10Bp > 0.1 ? "txt-up" : real10Bp < -0.1 ? "txt-down" : ""}>{sign(real10Bp, 1)} bp</strong>
        </div>
        <div className="driver-row">
          <span>10Y Breakeven</span>
          <div className="driver-track">
            <i className="driver-zero" />
            <div className={"driver-fill " + (be10Bp >= 0 ? "up" : "down")} style={driverBarStyle(be10Bp)} />
          </div>
          <strong className={be10Bp > 0.1 ? "txt-up" : be10Bp < -0.1 ? "txt-down" : ""}>{sign(be10Bp, 1)} bp</strong>
        </div>
      </div>
    )}

    <p className="proj-note">{active.note}</p>
    <p className="proj-disclaimer">每档 bp 和 10Y 实际利率拆分均为手工设定。滑块按比例缩放这些假设，用于比较不同冲击下的曲线形态。</p>
  </div>;
}

/* ---------- Verified Official Historical Replay Workbench ---------- */

function replayKpiBucket(seriesKey: string): string {
  if (seriesKey === "auction:20y-nominal") return "auction_20y";
  if (seriesKey === "auction:30y-nominal") return "auction_30y";
  if (seriesKey === "auction:5y-nominal" || seriesKey === "auction:7y-nominal") return "auction_belly";
  if (seriesKey.includes("-tips")) return "tips";
  if (seriesKey.endsWith("-bill") || seriesKey === "auction:2y-frn") return "bills";
  return seriesKey;
}

function computeReplayStats(series: ReplaySeries, items: HistoricalReplay[]) {
  const focusIdx = focusTenorIndexForReplay(series.key);
  const focusTenor = tenors[focusIdx];
  const focusMoves = items.map(it => it.shiftsBp[focusIdx] ?? 0);
  const meanAbsFocus = focusMoves.reduce((s, v) => s + Math.abs(v), 0) / Math.max(1, items.length);
  const minFocus = Math.min(...focusMoves);
  const maxFocus = Math.max(...focusMoves);
  const meanAbs10 = items.reduce((s, it) => s + Math.abs(it.shiftsBp[6] ?? 0), 0) / Math.max(1, items.length);
  const cleanCount = items.filter(it => it.confounders.length === 0).length;

  const isAuction = series.key.startsWith("auction:");
  const btcs = items.map(it => it.readings.find(r => r.label === "投标倍数")?.num).filter((v): v is number => v !== undefined);
  const dealers = items.map(it => it.readings.find(r => r.label === "一级交易商")?.num).filter((v): v is number => v !== undefined);
  const avgBtc = btcs.length ? btcs.reduce((a, b) => a + b, 0) / btcs.length : null;
  const avgDealer = dealers.length ? dealers.reduce((a, b) => a + b, 0) / dealers.length : null;

  return { focusIdx, focusTenor, meanAbsFocus, minFocus, maxFocus, meanAbs10, cleanCount, isAuction, avgBtc, avgDealer };
}

function HistoricalReplayPanel({
  series,
  curveThrough,
  event,
  compact = false,
}: {
  series: ReplaySeries;
  curveThrough?: string;
  event?: MarketEvent;
  compact?: boolean;
}) {
  const items = useMemo(() => selectReplayItems(series, event?.date), [series, event?.date]);
  const [selectedDate, setSelectedDate] = useState<string>(() => items[0]?.date ?? "");
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [replayNonce, setReplayNonce] = useState(0);

  useEffect(() => {
    setSelectedDate(items[0]?.date ?? "");
    setHoverIdx(null);
  }, [series.key, event?.id, items[0]?.date]);

  const active = items.find(it => it.date === selectedDate) ?? items[0];
  const stats = useMemo(() => computeReplayStats(series, items), [series, items]);

  const targetShifts = useMemo(
    () => (active ? active.shiftsBp : tenors.map(() => 0)),
    [active]
  );
  const animShifts = useAnimatedVector(targetShifts, 440, replayNonce, `${series.key}:${active?.date ?? ""}`);

  if (!active) return <p className="empty">截至 {event?.date ?? curveThrough}，本库暂无该序列的日终回放。</p>;
  if (active.prevCurve.length !== tenors.length || active.curve.length !== tenors.length || active.shiftsBp.length !== tenors.length) {
    return <p className="empty">这一日的九期限曲线记录不完整。</p>;
  }

  const base = active.prevCurve;
  const actualCurve = base.map((v, i) => v + (animShifts[i] ?? 0) / 100);
  const avgShift = animShifts.reduce((a, b) => a + b, 0) / animShifts.length;
  const shiftTone = avgShift > 0.35 ? "up" : avgShift < -0.35 ? "down" : "mixed";

  // Keep SVG axis calibrated to the selected historical day's exact prev -> close curve
  const allCurveVals = [...base, ...active.curve];
  const padY = Math.max(0.1, (Math.max(...allCurveVals) - Math.min(...allCurveVals)) * 0.14);
  const minY = Math.min(...allCurveVals) - padY;
  const maxY = Math.max(...allCurveVals) + padY;

  const width = 540, height = 286, padL = 46, padR = 20;
  const x = (i: number) => padL + (width - padL - padR) * i / (tenors.length - 1);
  const y = (val: number) => 142 - 114 * (val - minY) / Math.max(0.05, maxY - minY);
  const colW = (width - padL - padR) / (tenors.length - 1);

  const xs = tenors.map((_, i) => x(i));
  const baseYs = base.map(v => y(v));
  const actYs = actualCurve.map(v => y(v));
  const basePath = xs.map((cx, i) => `${cx.toFixed(1)},${baseYs[i].toFixed(1)}`).join(" ");
  const actPath = xs.map((cx, i) => `${cx.toFixed(1)},${actYs[i].toFixed(1)}`).join(" ");
  const ribbonSegments = buildSignedRibbon(xs, baseYs, actYs, animShifts);

  const maxBarBp = Math.max(
    6,
    Math.ceil(Math.max(...items.flatMap(it => it.shiftsBp.map(bp => Math.abs(bp)))))
  );
  const zeroY = 216;
  const barY = (bp: number) => zeroY - (bp / maxBarBp) * 30;

  const kpiBucket = replayKpiBucket(series.key);
  const kpis = buildProjectionKpis(
    kpiBucket,
    base,
    active.shiftsBp,
    active.real10Bp ?? 0,
    active.be10Bp ?? 0
  );
  const hasRealDecomp = active.real10Bp !== null && active.be10Bp !== null
    && (Math.abs(active.real10Bp) >= 0.3 || Math.abs(active.be10Bp) >= 0.3);
  const maxDriver = Math.max(4, Math.abs(active.real10Bp ?? 0), Math.abs(active.be10Bp ?? 0));
  const driverBarStyle = (val: number) => {
    const pct = Math.min(50, (Math.abs(val) / maxDriver) * 50);
    return val >= 0
      ? { left: "50%", width: `${pct}%` }
      : { left: `${50 - pct}%`, width: `${pct}%` };
  };

  const eventInItems = Boolean(event && items.some(it => it.date === event.date));
  const showCompareRow = Boolean(event && !eventInItems);
  const currentSummary = event?.readings?.length
    ? event.readings.slice(0, 2).map(r => `${r.label} ${readingText(r)}`).join(" · ")
    : event?.reference
      ? `模型预测核心月率 ${event.reference.value.toFixed(2)}% (Cleveland Fed)`
      : event?.actual ?? "待公布 · 结合下方近次实测区间决策";

  return <div className={"replay-card" + (compact ? " compact" : "")} aria-label="官方历史实证回放">
    <div className="proj-head">
      <div>
        <div className="proj-title-row">
          <h3>近 {items.length} 次官方实证回放</h3>
          <span className={"proj-morph-tag tone-" + active.regimeTone}>{active.regimeTag}</span>
          {curveThrough && <span className="replay-asof">曲线截至 {short(curveThrough)}</span>}
        </div>
        <p className="proj-sub">{series.name} · 逐次复盘真实发布值与财政部官方曲线 T-1 → T 实测反应</p>
      </div>
      <button type="button" className="proj-replay" onClick={() => setReplayNonce(n => n + 1)} title="重播该发布日真实形变">
        <Play size={12} />重播实况
      </button>
    </div>

    {/* Empirical Summary Statistics Strip */}
    <div className="replay-stats">
      <div className="rs-chip">
        <span>|Δ{stats.focusTenor}| 均值</span>
        <b>{stats.meanAbsFocus.toFixed(1)} bp</b>
        <small>区间 {sign(stats.minFocus, 0)} ~ {sign(stats.maxFocus, 0)} bp</small>
      </div>
      {stats.isAuction && stats.avgBtc !== null ? (
        <div className="rs-chip">
          <span>近 {items.length} 次认购均值</span>
          <b>BTC {stats.avgBtc.toFixed(2)}×</b>
          <small>{stats.avgDealer !== null ? `Dealer 均值 ${stats.avgDealer.toFixed(1)}%` : `|Δ10Y| 均值 ${stats.meanAbs10.toFixed(1)} bp`}</small>
        </div>
      ) : (
        <div className="rs-chip">
          <span>|Δ10Y| 均值</span>
          <b>{stats.meanAbs10.toFixed(1)} bp</b>
          <small>收盘 T-1 → T</small>
        </div>
      )}
      <div className="rs-chip">
        <span>日历未标记同日叠加</span>
        <b>{stats.cleanCount} / {items.length} 次</b>
        <small>仅覆盖回放日历收录的事件</small>
      </div>
    </div>

    {/* Interactive Historical Release Timeline Pills */}
    <div className="replay-timeline" role="tablist" aria-label="选择历史发布日期">
      {items.map(it => {
        const focusBp = it.shiftsBp[stats.focusIdx] ?? 0;
        const isCurrent = event?.date === it.date;
        const isSelected = it.date === active.date;
        return <button key={it.date} type="button" role="tab" aria-selected={isSelected}
          className={"rt-pill" + (isSelected ? " active" : "") + (it.confounders.length ? " has-conf" : "")}
          onClick={() => { setSelectedDate(it.date); setHoverIdx(null); }}>
          <div className="rt-top">
            <time>{short(it.date)}</time>
            <span>{it.period}</span>
            {isCurrent && <em className="rt-cur-tag">本次实测</em>}
          </div>
          <div className="rt-mid">{it.headline}</div>
          <div className="rt-foot">
            <b className={focusBp > 0.2 ? "txt-up" : focusBp < -0.2 ? "txt-down" : "txt-muted"}>
              {stats.focusTenor} {sign(focusBp, 0)}bp
            </b>
            <span>{it.regimeTag}</span>
            {it.confounders.length > 0 && <AlertTriangle size={11} className="rt-warn-icon" aria-label="同日有叠加事件" />}
          </div>
        </button>;
      })}
    </div>

    {/* Scientific Confounder & Primary Source Verification Bar */}
    <div className={"replay-audit " + (active.confounders.length ? "audit-warn" : "audit-clean")}>
      <div className="audit-copy">
        {active.confounders.length > 0 ? <>
          <AlertTriangle size={13} />
          <span><b>同日叠加：</b>{active.confounders.join("、")}（日终收盘反映当日综合走势，并非本项单一净效应）</span>
        </> : <>
          <CheckCircle2 size={13} />
          <span><b>日历未标记同日叠加</b> · 财政部日终 {short(active.prevDate)} → {short(active.date)} 的变动包含整个观察窗口的影响。</span>
        </>}
      </div>
      <SourceLink url={active.sourceUrl} label={active.sourceName} />
    </div>

    {/* Complete As-Released Official Readings for Selected Historical Date */}
    <div className="replay-readings">
      {active.readings.map(r => (
        <div className="rr-item" key={r.label}>
          <span>{r.label}</span>
          <strong>{r.valueText}</strong>
          {r.deltaText && <small>{r.deltaText}</small>}
        </div>
      ))}
    </div>

    {/* Animated 9-Tenor Actual Historical Curve Replay SVG */}
    <svg className="proj-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${active.date} 官方美债收益率曲线 T-1 至 T 实测形变`}>
      {[0, 1, 2, 3].map(i => {
        const val = minY + (maxY - minY) * i / 3;
        return <g key={i}>
          <line x1={padL} x2={width - padR} y1={y(val)} y2={y(val)} className="grid-line" />
          <text x={padL - 7} y={y(val) + 3.5} textAnchor="end">{val.toFixed(2)}%</text>
        </g>;
      })}

      {ribbonSegments.map((seg, i) => (
        <path key={i} d={seg.d} className={"proj-ribbon " + seg.cls} />
      ))}
      <polyline fill="none" className="compare-line" strokeWidth="1.7" strokeDasharray="4 4" points={basePath} />
      <polyline fill="none" className={"proj-main-line proj-line-" + shiftTone} strokeWidth="2.8" strokeLinejoin="round" strokeLinecap="round" points={actPath} />

      <line x1={padL} x2={width - padR} y1="158" y2="158" className="pane-divider" />
      <text x={padL} y="172" className="pane-tag">实测变动 (bp) · 虚线 {short(active.prevDate)} → 实线 {short(active.date)}</text>
      <text x={width - padR} y="172" textAnchor="end" className="pane-hint">点击期限明细</text>
      <line x1={padL} x2={width - padR} y1={zeroY} y2={zeroY} className="zero-line" />
      <text x={padL - 7} y={zeroY + 3.5} textAnchor="end">0</text>
      <text x={padL - 7} y="190" textAnchor="end">+{maxBarBp}</text>
      <text x={padL - 7} y="248" textAnchor="end">-{maxBarBp}</text>

      {tenors.map((tenor, i) => {
        const cx = xs[i];
        const by = baseYs[i];
        const py = actYs[i];
        const bp = animShifts[i] ?? 0;
        const isHovered = hoverIdx === i;
        const isKey = i === stats.focusIdx;
        const bTop = bp >= 0 ? barY(bp) : zeroY;
        const bH = Math.max(2, Math.abs(barY(bp) - zeroY));
        const bpTextY = bp >= 0 ? bTop - 5 : bTop + bH + 11;
        const tipX = Math.min(Math.max(cx, 92), width - 92);
        const tipY = Math.min(by, py) < 46 ? Math.max(by, py) + 28 : Math.min(by, py) - 16;

        return <g key={tenor} className="curve-point"
          onPointerEnter={e => { if (e.pointerType === "mouse") setHoverIdx(i); }}
          onPointerLeave={e => { if (e.pointerType === "mouse") setHoverIdx(null); }}
          onClick={() => setHoverIdx(prev => prev === i ? null : i)}>
          {isHovered && <line x1={cx} x2={cx} y1="22" y2="260" className="focus-guide" />}
          {Math.abs(py - by) > 4 && (
            <line x1={cx} x2={cx} y1={by} y2={py} className={"shift-stem stem-" + (bp >= 0 ? "up" : "down")} />
          )}
          <circle cx={cx} cy={by} r="2.6" className="base-dot" />
          {isKey && <circle cx={cx} cy={py} r="8.5" className={"key-halo halo-" + (bp >= 0 ? "up" : "down")} />}
          <circle cx={cx} cy={py} r={isHovered || isKey ? 5.2 : 3.6} className={"proj-dot dot-" + (bp >= 0 ? "up" : "down")} />

          <rect x={cx - 11} y={bTop} width="22" height={bH} rx="4.5"
            className={(bp > 0.2 ? "bar-up" : bp < -0.2 ? "bar-down" : "bar-flat") + (isHovered ? " bar-active" : "")} />
          <text x={cx} y={bpTextY} textAnchor="middle"
            className={"bp-val " + (bp > 0.2 ? "bp-up" : bp < -0.2 ? "bp-down" : "")}>
            {Math.abs(bp) < 0.25 ? "0" : sign(bp, Math.abs(bp) < 10 ? 1 : 0)}
          </text>
          <text x={cx} y="276" textAnchor="middle" className={"tenor-lbl" + (isHovered || isKey ? " tenor-active" : "")}>{tenor}</text>
          <rect x={cx - colW / 2} y="16" width={colW} height="266" fill="transparent" />

          {isHovered && <g className="svg-callout">
            <rect x={tipX - 80} y={tipY - 15} width="160" height="22" rx="11" />
            <text x={tipX} y={tipY} textAnchor="middle" className="chart-value">
              {tenor} {base[i].toFixed(2)}%→{actualCurve[i].toFixed(2)}% ({sign(bp, 1)}bp)
            </text>
          </g>}
        </g>;
      })}
    </svg>

    {/* Actual Reaction KPIs */}
    <div className="proj-kpis">
      {kpis.map(k => (
        <div className="pk-item" key={k.label}>
          <span>{k.label}</span>
          <strong className={k.value > 0.2 ? "txt-up" : k.value < -0.2 ? "txt-down" : ""}>{sign(k.value, 1)} bp</strong>
          <small>{k.sub}</small>
        </div>
      ))}
    </div>

    {/* Actual Official TIPS Real vs Breakeven Driver Split */}
    {hasRealDecomp && (
      <div className="proj-drivers" aria-label="10年期实际利率与通胀补偿实测拆解">
        <div className="driver-row">
          <span>10Y 实际利率</span>
          <div className="driver-track">
            <i className="driver-zero" />
            <div className={"driver-fill " + (active.real10Bp! >= 0 ? "up" : "down")} style={driverBarStyle(active.real10Bp!)} />
          </div>
          <strong className={active.real10Bp! > 0.1 ? "txt-up" : active.real10Bp! < -0.1 ? "txt-down" : ""}>{sign(active.real10Bp!, 1)} bp</strong>
        </div>
        <div className="driver-row">
          <span>10Y Breakeven</span>
          <div className="driver-track">
            <i className="driver-zero" />
            <div className={"driver-fill " + (active.be10Bp! >= 0 ? "up" : "down")} style={driverBarStyle(active.be10Bp!)} />
          </div>
          <strong className={active.be10Bp! > 0.1 ? "txt-up" : active.be10Bp! < -0.1 ? "txt-down" : ""}>{sign(active.be10Bp!, 1)} bp</strong>
        </div>
      </div>
    )}

    {/* Side-by-Side Comparison Table (Compare Past 3-4 Releases vs Current Event!) */}
    <div className="replay-table-wrap">
      <div className="replay-table-title">横向对比（点击任意行切换上方回放曲线）</div>
      <div className="replay-table" role="table" aria-label="近次实证横向对比表">
        <div className="rtbl-head" role="row">
          <span role="columnheader">发布日 / 周期</span>
          <span role="columnheader">官方原始读数</span>
          <span role="columnheader">实测曲线反应</span>
        </div>
        {showCompareRow && event && (
          <div className="rtbl-row rtbl-current" role="row">
            <span className="rtbl-date" role="cell"><b>{short(event.date)}</b><em>本次对照</em></span>
            <span className="rtbl-read" role="cell">{currentSummary}</span>
            <span className="rtbl-react" role="cell"><em>{event.readings?.length ? "待收盘曲线" : "待公布"}</em></span>
          </div>
        )}
        {items.map(it => {
          const isSelected = it.date === active.date;
          const isCur = event?.date === it.date;
          const d2 = it.shiftsBp[2], d10 = it.shiftsBp[6], dFocus = it.shiftsBp[stats.focusIdx];
          return <button key={it.date} type="button" role="row"
            className={"rtbl-row rtbl-btn" + (isSelected ? " active" : "") + (isCur ? " rtbl-current" : "")}
            onClick={() => { setSelectedDate(it.date); setHoverIdx(null); }}>
            <span className="rtbl-date" role="cell">
              <b>{short(it.date)}</b>
              <small>{it.period}</small>
              {isCur && <em>本次实测</em>}
            </span>
            <span className="rtbl-read" role="cell">
              {it.headline}
              {it.confounders.length > 0 && <i className="rtbl-conf">叠加：{it.confounders.join("+")}</i>}
            </span>
            <span className="rtbl-react" role="cell">
              <strong className={dFocus > 0.2 ? "txt-up" : dFocus < -0.2 ? "txt-down" : "txt-muted"}>
                {stats.focusTenor} {sign(dFocus, 0)}bp
              </strong>
              <small>
                {stats.focusIdx === 2 ? `10Y ${sign(d10, 0)}bp` : `2Y ${sign(d2, 0)} · 10Y ${sign(d10, 0)}`} · {it.regimeTag}
              </small>
            </span>
          </button>;
        })}
      </div>
    </div>

    <p className="proj-disclaimer">{series.methodology}</p>
  </div>;
}

function FocusList({ events, tz, now, inspect }: { events: MarketEvent[]; tz: TzMode; now: Date; inspect: (event: MarketEvent, list: MarketEvent[]) => void }) {
  return <section className="panel glass focus-panel">
    <div className="panel-header">
      <div><h2>接下来关注</h2><p>查看指标、传导与当次情景 · {tzLabel(tz)}</p></div>
      <span className="header-icon"><Activity size={18} /></span>
    </div>
    {events.length ? <ul>{events.map(event => {
      const display = formatEventClock(event, tz);
      return <li key={event.id}><button onClick={() => inspect(event, events)}>
        <time>{short(display.date)}<b>{display.clock}</b></time>
        <span className="focus-copy">
          <span className="focus-title-row">
            <strong>{event.title}</strong>
            <em className="countdown-pill">{countdownText(event, now)}</em>
          </span>
          <small>{event.reference ? "核心月率模型 " + event.reference.value.toFixed(2) + "% (Cleveland Fed)" : event.detail}</small>
        </span>
        <ChevronRight size={16} />
      </button></li>;
    })}</ul> : <p className="empty">目前暂无已核对的高影响发布。</p>}
  </section>;
}

function LatestReleases({ events, tz, inspect }: { events: MarketEvent[]; tz: TzMode; inspect: (event: MarketEvent, list: MarketEvent[]) => void }) {
  return <section className="panel glass latest-panel" aria-labelledby="latest-title">
    <div className="panel-header">
      <div><h2 id="latest-title">最近公布</h2><p>点击直接查看实值、历史对照与交易台复盘 · {tzLabel(tz)}</p></div>
    </div>
    {events.length ? <div className="latest-grid">{events.map(event => {
      const display = formatEventClock(event, tz);
      const primary = event.readings?.[0];
      const secondary = event.readings?.slice(1, 3) ?? [];
      return <button className="latest-card" key={event.id} onClick={() => inspect(event, events)}>
        <time>{short(display.date)} {display.clock}</time>
        <strong>{event.title}</strong>
        <span className="latest-primary">{primary ? primary.label + " " + readingText(primary) : event.actual}</span>
        {secondary.length > 0 && <small className="latest-sub">{secondary.map(r => r.label + " " + readingText(r)).join(" · ")}</small>}
      </button>;
    })}</div> : <p className="empty">尚无已抓取的官方结果。</p>}
  </section>;
}

/* ---------- Playbook & Scenario Core Views ---------- */

function PlaybookView({ playbook, compact = false }: { playbook: Playbook; compact?: boolean }) {
  return <div className={"playbook-body" + (compact ? " compact" : "")}>
    <div className="pb-hero">
      <span className="vol-badge"><Activity size={13} />经验波动参考 · {playbook.volatility}</span>
      <p className="pb-summary">{playbook.summary}</p>
    </div>

    <div className="pb-block">
      <h3><Clock size={14} />发布后前 30 秒必看</h3>
      <ul className="pb-list">{playbook.first30s.map(item => <li key={item}>{item}</li>)}</ul>
    </div>

    <div className="pb-block">
      <h3><Layers size={14} />美债曲线与通胀补偿传导矩阵</h3>
      <div className="matrix-table" role="table" aria-label="传导矩阵">
        <div className="matrix-head" role="row">
          <span role="columnheader">维度</span>
          <span className="mh-hot" role="columnheader">{playbook.matrix.hotTitle}</span>
          <span className="mh-cold" role="columnheader">{playbook.matrix.coldTitle}</span>
        </div>
        {playbook.matrix.rows.map(row => (
          <div className="matrix-row" role="row" key={row.dim}>
            <strong role="cell">{row.dim}</strong>
            <span role="cell">{row.hot}</span>
            <span role="cell">{row.cold}</span>
          </div>
        ))}
      </div>
    </div>

    <div className="pb-regime">
      <h4>周期分叉（Regime Split）</h4>
      <p>{playbook.regimeSplit}</p>
    </div>

    <div className="pb-traps">
      <h4><AlertTriangle size={14} />常见误判与反向陷阱</h4>
      <ul>{playbook.traps.map(trap => <li key={trap}>{trap}</li>)}</ul>
    </div>

    <div className="pb-block">
      <h3><History size={14} />历史案例与传导解释</h3>
      <div className="history-list">
        {playbook.history.map(item => (
          <article className="history-card" key={item.date + item.title}>
            <div className="history-top">
              <time>{item.date}</time>
              <strong>{item.title}</strong>
            </div>
            <p className="history-surprise"><b>意外：</b>{item.surprise}</p>
            <div className="history-move">{item.ustMove}</div>
            <p className="history-lesson">{item.lesson}</p>
            {item.sources?.map(source => <SourceLink key={source.url} url={source.url} label={source.label} />)}
          </article>
        ))}
      </div>
    </div>
  </div>;
}

function releaseReference(event: MarketEvent, now: Date) {
  const model = event.reference;
  return model && Number.isFinite(model.value) && model.asOf < event.date && model.asOf <= newYorkDate(now)
    ? model : undefined;
}

function ReleaseEvidence({ event, related, now, archive }: {
  event: MarketEvent; related: MarketEvent[]; now: Date; archive?: HistoricalReplay;
}) {
  const released = isPastEvent(event, now);
  const model = releaseReference(event, now);
  const isAuction = event.category === "auction";
  const canCompare = event.category === "macro" || (isAuction && Boolean(ruleFor(event)));
  const readings = released && (event.readings?.length
    ? event.readings.map(reading => ({ label: reading.label, valueText: readingText(reading) }))
    : archive?.readings);
  return <div className="release-evidence">
    <div className="study-heading"><h4>本次发布</h4></div>
    <p>{event.detail}</p>
    {readings && readings.length ? <dl className="evidence-values">{readings.map(reading =>
      <div key={reading.label}><dt>{reading.label}</dt><dd>{reading.valueText}</dd></div>)}</dl> :
      <p>{released ? event.actual ?? "官方结构化读数暂缺" : "等待官方发布"}</p>}
    {model && <p>模型估计 {model.value.toFixed(2)}% · 报告期 {model.period} · 截至 {model.asOf}{" "}
      <SourceLink url={nowcastUrl} label="Cleveland Fed" /></p>}
    {canCompare && <p>{isAuction ? "截标前同券 WI 未接入" : "发布前市场调查预期未接入"}。可在情景试算中输入对应基准。</p>}
    {related.length > 0 && <p className="co-release">同刻发布 {related.map(item => item.title).join("、")}。比较该时段行情时共同考虑。</p>}
    {released && (event.resultUrl || archive) &&
      <SourceLink url={event.resultUrl ?? archive!.sourceUrl} label={event.resultUrl ? "官方发布原文" : archive!.sourceName} />}
  </div>;
}

function ScenarioCalculator({
  event, sameTime, allEvents, baseCurve, baseLabel, replaySeries, onOpenReplay, now,
}: {
  event: MarketEvent;
  sameTime: MarketEvent[];
  allEvents: MarketEvent[];
  baseCurve: number[];
  baseLabel: string;
  replaySeries?: ReplaySeries | null;
  onOpenReplay?: () => void;
  now: Date;
}) {
  const rule = ruleFor(event)!;
  const projSet = useMemo(() => projectionFor(event), [event]);
  const official = isPastEvent(event, now) ? actualFor(event, rule) : undefined;
  const model = releaseReference(event, now);
  const prior = useMemo(() => priorFor(event, allEvents, rule), [event, allEvents, rule]);
  const initialSaved = useMemo(() => loadSavedScenarios()[event.id] ?? {}, [event.id]);

  const [expected, setExpected] = useState(initialSaved.expected ?? "");
  const [comparison, setComparison] = useState<Comparison>(initialSaved.comparison ?? "manual");
  const [hypothesis, setHypothesis] = useState(initialSaved.hypothesis ?? "");
  const [components, setComponents] = useState(initialSaved.components ?? "unknown");
  const [stance, setStance] = useState(initialSaved.stance ?? "none");
  const [previewSide, setPreviewSide] = useState<"above" | "below" | "alt">("above");
  const [cardPick, setCardPick] = useState<{ side: "above" | "below" | null; nonce: number }>({ side: null, nonce: 0 });

  useEffect(() => {
    saveScenarioInput(event.id, { expected, hypothesis, components, stance, comparison });
  }, [event.id, expected, hypothesis, components, stance, comparison]);

  const hasCustomInput = Boolean(expected || hypothesis || components !== "unknown" || stance !== "none" || comparison !== "manual");
  const resetInputs = () => { setExpected(""); setHypothesis(""); setComponents("unknown"); setStance("none"); setComparison("manual"); };

  const isAuction = event.category === "auction";
  const isQual = Boolean(rule.qualitative);
  const effectiveComparison: Comparison = !isAuction && ((comparison === "model" && Boolean(model)) || (comparison === "prior" && Boolean(prior)))
    ? comparison
    : "manual";
  const useModel = effectiveComparison === "model";
  const usePrior = effectiveComparison === "prior";
  const expectedValue = useModel ? model?.value : usePrior ? prior?.value : expected.trim() ? Number(expected) : undefined;
  const actualValue = hypothesis.trim() === "" ? official : Number(hypothesis);
  const diff = !isQual && expectedValue !== undefined && actualValue !== undefined && Number.isFinite(expectedValue) && Number.isFinite(actualValue)
    ? Number((actualValue - expectedValue).toFixed(6)) : null;

  const noiseBand = useModel ? 0.05 : (rule.noise ?? 0);
  const bigBand = rule.big ?? Infinity;
  const absDiff = diff === null ? 0 : Math.abs(diff);
  const near = diff !== null && (noiseBand > 0 ? absDiff < noiseBand : diff === 0);
  const magnitude = diff === null ? null : useModel || usePrior ? null :
    near ? "接近基准" : absDiff >= bigBand ? "超出情景阈值" : "小幅偏离";

  const verdict: "above" | "below" | null = isQual
    ? (stance === "above" || stance === "below" ? stance : null)
    : (diff === null || near || useModel || usePrior ? null : diff > 0 ? "above" : "below");

  const forcedScale = isQual
    ? (verdict ? 1 : null)
    : diff !== null && !near && Number.isFinite(bigBand) && bigBand > 0
      ? Math.min(1.8, Math.max(0.5, Number((absDiff / bigBand * 1.15).toFixed(2))))
      : null;

  const mixed = components === "mixed";
  const confirmed = components === "aligned" && !sameTime.length;
  const comparator = isAuction ? "手动输入 WI" : useModel ? "模型估计" : usePrior ? "上次发布值" : "手动输入的调查预期";
  const positive = rule.aboveLabel ?? (isAuction ? "高于 WI (Tail)" : "高于预期");
  const negative = rule.belowLabel ?? (isAuction ? "低于 WI (Stop-through)" : "低于预期");
  const resultLabel = hypothesis.trim() ? "假设值" : "官方值";
  const deltaValue = diff === null ? "" : isAuction
    ? sign(diff * 100, 1) + " bp"
    : rule.unit === "%" ? sign(diff, 2) + " 个百分点"
    : rule.unit === "百万" ? sign(diff, 2) + " 百万"
    : sign(diff, Number.isInteger(diff) ? 0 : 2) + " 千人";

  const formatUnitVal = (v: number) =>
    rule.unit === "%" ? (isAuction ? v.toFixed(3) + "%" : v.toFixed(2).replace(/\.00$/, ".0") + "%")
    : rule.unit === "百万" ? v.toFixed(1) + " 百万"
    : v + " 千人";

  const today = newYorkDate(now);
  const replayCutoff = addDays(event.date < today ? event.date : today, -1);
  const replayItems = useMemo(
    () => (replaySeries ? selectReplayItems(replaySeries, replayCutoff) : []),
    [replaySeries, replayCutoff]
  );
  const replayStats = useMemo(
    () => (replaySeries && replayItems.length ? computeReplayStats(replaySeries, replayItems) : null),
    [replaySeries, replayItems]
  );

  return <div className="calc-wrap">
    <CurveProjection
      projectionSet={projSet}
      baseCurve={baseCurve}
      baseLabel={baseLabel}
      forcedSide={mixed || sameTime.length > 0 ? null : verdict}
      forcedScale={forcedScale}
      externalSide={cardPick.side}
      externalNonce={cardPick.nonce}
      onSelectSide={setPreviewSide}
      focusIndex={focusTenorIndexFor(projSet.key, event)}
    />
    {replayStats && replayItems[0] && onOpenReplay && (
      <button type="button" className="replay-teaser" onClick={onOpenReplay}>
        <span className="teaser-copy">
          <BarChart3 size={14} />
          <span>
            <b>事件前 {replayItems.length} 次日终观测：</b>
            |Δ{replayStats.focusTenor}| 均值 {replayStats.meanAbsFocus.toFixed(1)}bp · 最近 ({short(replayItems[0].date)}) {replayItems[0].headline} → {replayStats.focusTenor} {sign(replayItems[0].shiftsBp[replayStats.focusIdx], 0)}bp
          </span>
        </span>
        <span className="teaser-cta">逐次回放<ChevronRight size={14} /></span>
      </button>
    )}
    {isQual ? (
      <div className="scenario-inputs qual-inputs">
        <label>政策 / 纪要基调判断
          <div className="segmented full-seg" role="group" aria-label="选择政策基调">
            <button type="button" className={stance === "none" ? "active" : ""} onClick={() => setStance("none")}>待评估</button>
            <button type="button" className={stance === "above" ? "active seg-up" : ""} onClick={() => setStance("above")}>偏鹰</button>
            <button type="button" className={stance === "below" ? "active seg-down" : ""} onClick={() => setStance("below")}>偏鸽</button>
          </div>
        </label>
        <label>记者会 / 细项一致性
          <select value={components} onChange={e => setComponents(e.target.value)}>
            <option value="unknown">尚待验证</option>
            <option value="aligned">声明与问答/细项一致</option>
            <option value="mixed">声明与问答/细项冲突</option>
          </select>
        </label>
        <div className="reset-cell">
          <button type="button" className="action" onClick={resetInputs} disabled={!hasCustomInput}><RotateCcw size={14} />清空</button>
        </div>
      </div>
    ) : (
      <div className="scenario-inputs">
        <div className="study-comparison">
          {!isAuction && <label>比较基准
            <select value={effectiveComparison} onChange={e => setComparison(e.target.value as Comparison)}>
              <option value="manual">手动输入发布前调查预期</option>
              <option value="model" disabled={!model}>Cleveland Fed 模型估计</option>
              <option value="prior" disabled={!prior}>上次发布值（教学比较）</option>
            </select>
          </label>}
          {!useModel && !usePrior && <label>{isAuction ? "截标前同券 WI 收益率" : "发布前市场调查预期"} <span>{rule.unit}</span>
            <input type="number" step="any" value={expected} onChange={e => setExpected(e.target.value)} placeholder={isAuction ? "填入带时间戳的 WI" : "填入调查预期"} />
          </label>}
        </div>
        <label>假设发布值 <span>{rule.unit}</span>
          <input type="number" step="any" value={hypothesis} onChange={e => setHypothesis(e.target.value)}
            placeholder={official === undefined ? "填入假设值试算" : "默认官方 " + official} />
        </label>
        <label>关键分项方向
          <div className="select-with-reset">
            <select value={components} onChange={e => setComponents(e.target.value)}>
              <option value="unknown">尚待验证</option>
              <option value="aligned">与主数据一致</option>
              <option value="mixed">与主数据冲突</option>
            </select>
            {hasCustomInput && <button type="button" className="icon-button" title="清空当前试算" aria-label="清空当前试算" onClick={resetInputs}>
              <RotateCcw size={14} />
            </button>}
          </div>
        </label>
      </div>
    )}

    <div className="data-trail">
      <span><b>比较指标</b> {rule.metric}</span>
      {official !== undefined && <span><b>官方值</b> {formatUnitVal(official)}</span>}
      {prior && <span>
        <b>{event.title === "美国 GDP" ? "同季度上一版" : "上次发布值"}</b> {formatUnitVal(prior.value)} ({short(prior.date)})
      </span>}
      {model && <span><b>模型估计</b> {model.value.toFixed(2)}% · {model.period} · 截至 {model.asOf}{" "}
        <SourceLink url={nowcastUrl} label="Cleveland Fed" /></span>}
      {model && !useModel && actualValue !== undefined && Number.isFinite(actualValue) &&
        <span><b>{resultLabel}减模型估计</b> {sign(actualValue - model.value, 2)} 个百分点</span>}
    </div>

    {(diff !== null || (isQual && verdict !== null)) && <div className="verdict" aria-live="polite">
      <div className="verdict-head">
        <strong>{isQual ? (verdict === "above" ? positive : negative) : `${resultLabel}减${comparator} ${deltaValue}`}</strong>
        {magnitude && <em className={"mag-pill " + (near ? "mag-near" : absDiff >= bigBand ? "mag-big" : "mag-mid")}>{magnitude}</em>}
      </div>
      <p>{useModel || usePrior ? "该差值用于对照。要判断市场意外，请切换到发布前调查预期。"
        : near ? "处于接近所选基准的区间。继续核对分项、前值修订和同刻发布。" :
        sameTime.length ? "同刻发布可能共同驱动曲线，先比较各项读数及同一窗口的行情。"
        : mixed ? "分项或沟通出现冲突，方向判断降级。先观察发布后 15–30 分钟价格是否延续。" :
        scenarioFor(event, rule, verdict!).direction + (confirmed ? "。分项一致，仍需盘口成交确认。" : "。暂作条件判断，等待分项与价格确认。")}</p>
    </div>}

    <div className="scenario-grid">{(["above", "below"] as const).map(comparison => {
      const scenario = scenarioFor(event, rule, comparison);
      const isMatched = verdict === comparison && !mixed;
      const isPreviewed = !isMatched && (verdict === null || mixed) && previewSide === comparison;
      return <article key={comparison}
        role="button" tabIndex={0}
        className={(isMatched ? "matched " : isPreviewed ? "previewed " : "") + "scenario-card-interactive"}
        onClick={() => { setPreviewSide(comparison); setCardPick(prev => ({ side: comparison, nonce: prev.nonce + 1 })); }}
        onKeyDown={e => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setPreviewSide(comparison);
            setCardPick(prev => ({ side: comparison, nonce: prev.nonce + 1 }));
          }
        }}>
        <div className="scenario-card-top">
          <span className={"scenario-tag dir-" + scenario.yieldDir}>{comparison === "above" ? positive : negative}</span>
          <span className="scenario-preview-hint">{isMatched ? "当前命中" : isPreviewed ? "曲线预览中" : "点击切图"}</span>
        </div>
        <h3>{scenario.direction}</h3>
        <p>{scenario.text}</p>
        <p className="scenario-curve"><b>曲线：</b>{scenario.curve}</p>
      </article>;
    })}</div>

    <div className="scenario-notes">
      <div><h3>读数交叉核对</h3><ul>{rule.checks.map(check => <li key={check}>{check}</li>)}</ul></div>
      <div>
        <h3>失效与反转条件</h3>
        <p>{rule.invalidate}</p>
        {sameTime.length > 0 && <p className="co-release">同刻发布冲突：{sameTime.map(item => item.title).join("、")}。单凭本项难以独立归因。</p>}
      </div>
    </div>
  </div>;
}

function MicrostructureGrid({ kind }: { kind: MarketEvent["kind"] }) {
  return <div className="micro-panel">
    <p className="micro-lead">{analysis[kind][0]}</p>
    <dl className="micro-dl">
      {dimensions.slice(1).map((label, i) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{analysis[kind][i + 1]}</dd>
        </div>
      ))}
    </dl>
  </div>;
}

/* ---------- Unified Liquid Glass Slide-Over Inspector Drawer ---------- */

function EventDrawer({
  event, list, allEvents, baseCurve, baseLabel, replays, tz, now, currentView, onClose, onStep, onJumpWeek, onOpenFullScenario,
}: {
  event: MarketEvent;
  list: MarketEvent[];
  allEvents: MarketEvent[];
  baseCurve: number[];
  baseLabel: string;
  replays: ReplayCatalog | null;
  tz: TzMode;
  now: Date;
  currentView: ViewId;
  onClose: () => void;
  onStep: (next: MarketEvent) => void;
  onJumpWeek: (date: string) => void;
  onOpenFullScenario: (event: MarketEvent) => void;
}) {
  const rule = ruleFor(event);
  const playbook = playbookFor(event);
  const projSet = useMemo(() => projectionFor(event), [event]);
  const replaySeries = useMemo(() => {
    const key = replayKeyForEvent(event);
    const s = key ? replays?.series?.[key] ?? null : null;
    return s && s.items.length >= 2 ? s : null;
  }, [event, replays]);
  const [tab, setTab] = useState<DrawerTab>("learn");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTab("learn");
    scrollRef.current?.scrollTo({ top: 0 });
  }, [event.id]);

  const idx = list.findIndex(item => item.id === event.id);
  const prevEv = idx > 0 ? list[idx - 1] : null;
  const nextEv = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowLeft" && prevEv) onStep(prevEv);
      if (e.key === "ArrowRight" && nextEv) onStep(nextEv);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onStep, prevEv, nextEv]);

  const display = formatEventClock(event, tz);
  const past = isPastEvent(event, now);
  const sameTime = coReleases(event, allEvents);
  const lesson = lessonFor(playbook.key)!;
  const tagText = event.status === "tentative" ? categories[event.category] + " · 暂定" : categories[event.category];
  const impactLevel = event.impact >= 4 ? "high" : event.impact >= 3 ? "mid" : "low";

  return <div className="drawer-backdrop" onClick={onClose} role="presentation">
    <aside className="drawer glass-drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" onClick={e => e.stopPropagation()}>
      <header className="drawer-head">
        <div className="drawer-badges">
          <span className={"tag tag-" + event.category}>{tagText}</span>
          <span className={"impact " + impactLevel}>{impactText(event.impact)}</span>
          <span className="drawer-clock-pill">
            <Clock size={12} />{display.date} {display.clock}{display.dayShift > 0 ? " (+1日)" : display.dayShift < 0 ? " (-1日)" : ""} {tzShortTag(tz)}
          </span>
          {!past && <span className="countdown-pill">{countdownText(event, now)}</span>}
        </div>
        <button type="button" className="icon-button drawer-close" aria-label="关闭详情抽屉" onClick={onClose}><X size={17} /></button>
      </header>

      <div className="drawer-scroll" ref={scrollRef}>
        <div className="drawer-title-block">
          <h2 id="drawer-title">{event.title}</h2>
          <p>{event.detail}</p>
          <div className="event-meta">
            <SourceLink url={event.url} label={sourceIndex[event.source].name.split(" · ")[0]} />
            {event.resultUrl && <SourceLink url={event.resultUrl} label="官方发布原文" />}
            {tz !== "ET" && event.time && <span>纽约原时 {short(event.date)} {event.time} ET</span>}
            {event.officialDate && <span>来源更新 {event.officialDate}</span>}
          </div>


        </div>

        <div className="drawer-tabs">
          <div className="segmented full-seg" role="tablist" aria-label="事件分析视图">
            <button type="button" role="tab" aria-selected={tab === "learn"} className={tab === "learn" ? "active" : ""} onClick={() => setTab("learn")}>
              <BookOpen size={13} />指标与传导
            </button>
            <button type="button" role="tab" aria-selected={tab === "scenario"} className={tab === "scenario" ? "active" : ""} onClick={() => setTab("scenario")}>
              <SlidersHorizontal size={13} />情景推演
            </button>
            {replaySeries && <button type="button" role="tab" aria-selected={tab === "replay"} className={tab === "replay" ? "active" : ""} onClick={() => setTab("replay")}>
              <BarChart3 size={13} />实证回放
            </button>}

          </div>
        </div>

        <div className="drawer-body">
          {tab === "learn" && <>
            <LessonCard lesson={lesson} evidence={<ReleaseEvidence event={event} related={sameTime} now={now}
              archive={replaySeries?.items.find(item => item.date === event.date)} />} />
            <HistoryPractice key={event.id} course={playbook.key} beforeDate={event.date} />
            <details className="study-details"><summary>传导矩阵与案例</summary><PlaybookView playbook={playbook} compact /></details>
            <details className="study-details"><summary>进阶 · 盘口、RFQ 与对冲</summary><MicrostructureGrid kind={event.kind} /></details>
          </>}
          {tab === "scenario" && rule && (
            <ScenarioCalculator
              key={event.id}
              event={event}
              now={now}
              sameTime={sameTime}
              allEvents={allEvents}
              baseCurve={baseCurve}
              baseLabel={baseLabel}
              replaySeries={replaySeries}
              onOpenReplay={replaySeries ? () => { setTab("replay"); scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" }); } : undefined}
            />
          )}
          {tab === "scenario" && !rule &&
            <CurveProjection projectionSet={projSet} baseCurve={baseCurve} baseLabel={baseLabel} focusIndex={focusTenorIndexFor(projSet.key, event)} />}
          {tab === "replay" && replaySeries &&
            <HistoricalReplayPanel series={replaySeries} curveThrough={replays?.curveThrough} event={event} compact />}
        </div>
      </div>

      <footer className="drawer-foot">
        <div className="drawer-step">
          <button type="button" className="action" disabled={!prevEv} onClick={() => prevEv && onStep(prevEv)}>
            <ChevronLeft size={15} />上一项
          </button>
          <button type="button" className="action" disabled={!nextEv} onClick={() => nextEv && onStep(nextEv)}>
            下一项<ChevronRight size={15} />
          </button>
        </div>
        <div className="drawer-links">
          {currentView !== "calendar" && <button type="button" className="action" onClick={() => onJumpWeek(weekOf(event.date))}>
            <CalendarDays size={14} />看当周日历
          </button>}
          {rule && currentView !== "scenarios" && <button type="button" className="action primary" onClick={() => onOpenFullScenario(event)}>
            全屏推演室
          </button>}
        </div>
      </footer>
    </aside>
  </div>;
}

/* ---------- Main Desk App ---------- */

export default function Desk() {
  const [now, setNow] = useState(() => new Date());
  const current = weekOf(newYorkDate(now));
  const todayNy = newYorkDate(now);
  const [view, setView] = useState<ViewId>(readViewFromUrl);
  const [week, setWeek] = useState(() => {
    const requested = new URLSearchParams(location.search).get("week");
    return isWeek(requested) ? requested : weekOf(newYorkDate());
  });
  const [theme, setTheme] = useState<ThemeMode>(() => {
    try { return (localStorage.getItem(STORAGE_THEME) as ThemeMode) === "dark" ? "dark" : "light"; }
    catch { return "light"; }
  });
  const [tz, setTz] = useState<TzMode>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_TZ) as TzMode;
      return saved === "LDN" || saved === "TYO" || saved === "ET" ? saved : "ET";
    } catch { return "ET"; }
  });

  const [calendars, setCalendars] = useState<Record<string, Calendar>>({});
  const [replays, setReplays] = useState<ReplayCatalog | null>(null);
  const [liveCurve, setLiveCurve] = useState<LiveCurve | null>(null);
  const [liveFailed, setLiveFailed] = useState(false);
  const [preferLive, setPreferLive] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // Calendar filters
  const [filter, setFilter] = useState<Category | "all">("all");
  const [query, setQuery] = useState("");
  const [tentative, setTentative] = useState(true);
  const [byImpact, setByImpact] = useState(false);

  // Scenarios standalone page state
  const [scenarioMode, setScenarioMode] = useState<"event" | "library">(() =>
    new URLSearchParams(location.search).has("lesson") ? "library" : "event");
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const [libraryKey, setLibraryKey] = useState(() => lessonFor(new URLSearchParams(location.search).get("lesson") ?? "")?.key ?? "cpi");

  // Slide-over Inspector Drawer state (zero ping-pong!)
  const [inspected, setInspected] = useState<{ event: MarketEvent; list: MarketEvent[] } | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(STORAGE_THEME, theme); } catch { /* ignore */ }
  }, [theme]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_TZ, tz); } catch { /* ignore */ }
  }, [tz]);

  useEffect(() => {
    const onPop = () => {
      setView(readViewFromUrl());
      setInspected(null);
      const params = new URLSearchParams(location.search);
      const lesson = lessonFor(params.get("lesson") ?? "");
      setScenarioMode(lesson ? "library" : "event");
      if (lesson) setLibraryKey(lesson.key);
      const requested = params.get("week");
      if (isWeek(requested)) setWeek(requested);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  async function refreshAll(manual = false, signal?: AbortSignal) {
    if (manual) setRefreshing(true);
    const started = Date.now();
    const [calRes, liveRes, replayRes] = await Promise.allSettled([
      loadCalendars(signal),
      loadLiveCurve(signal),
      loadReplays(signal),
    ]);
    if (signal?.aborted) return;
    if (calRes.status === "fulfilled") {
      setCalendars(calRes.value);
      setFailed(false);
    } else {
      setFailed(true);
    }
    if (liveRes.status === "fulfilled") {
      setLiveCurve(liveRes.value);
      setLiveFailed(false);
    } else {
      setLiveFailed(true);
    }
    if (replayRes.status === "fulfilled") {
      setReplays(replayRes.value);
    }
    setNow(new Date());
    setLastSyncedAt(new Date().toISOString());
    setLoading(false);
    if (manual) {
      const wait = Math.max(0, 380 - (Date.now() - started));
      if (wait > 0) await new Promise(resolve => window.setTimeout(resolve, wait));
      if (!signal?.aborted) setRefreshing(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void refreshAll(false, controller.signal);

    // Auto-refresh live Tradeweb UST curve every 30s while tab is visible
    const liveTimer = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void loadLiveCurve(controller.signal).then(data => {
        if (!controller.signal.aborted) {
          setLiveCurve(data);
          setLiveFailed(false);
          setNow(new Date());
          setLastSyncedAt(new Date().toISOString());
        }
      }).catch(() => {
        if (!controller.signal.aborted) setLiveFailed(true);
      });
    }, 30000);

    // Refresh calendar.json every 2 minutes
    const calTimer = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void loadCalendars(controller.signal).then(data => {
        if (!controller.signal.aborted) { setCalendars(data); setFailed(false); }
      }).catch(() => {});
    }, 120000);

    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshAll(false, controller.signal);
    };
    document.addEventListener?.("visibilitychange", onVisible);
    return () => {
      controller.abort();
      window.clearInterval(liveTimer);
      window.clearInterval(calTimer);
      document.removeEventListener?.("visibilitychange", onVisible);
    };
  }, []);

  const allWeeks = useMemo(() => Object.values(calendars).sort((a, b) => a.week.localeCompare(b.week)), [calendars]);
  const weekEnd = addDays(week, 6);
  const calendar = calendars[week] ?? seedCalendar(week);
  const points = useMemo(() => [...new Map([...allWeeks.flatMap(value => value.curve), ...calendar.curve]
    .filter(point => point.date <= weekEnd).map(point => [point.date, point])).values()].sort((a, b) => a.date.localeCompare(b.date)),
    [allWeeks, calendar.curve, weekEnd]);
  const allEvents = useMemo(() => [...new Map([...allWeeks.flatMap(value => value.events), ...calendar.events]
    .map(event => [event.id, event])).values()].sort(timeSort), [allWeeks, calendar.events]);
  const upcoming = useMemo(() => allEvents.filter(event => event.status === "confirmed" && event.impact >= 4 && !isPastEvent(event, now)), [allEvents, now]);
  const released = useMemo(() => allEvents.filter(event => event.impact >= 3 && (event.readings?.length || event.actual) && isPastEvent(event, now)), [allEvents, now]);
  const latestReleases = useMemo(() => [
    ...released.filter(event => event.category === "macro").slice(-2),
    ...released.filter(event => event.category !== "macro").slice(-2),
  ].sort(timeSort).reverse(), [released]);

  const scenarioChoices = useMemo(() => [...new Map([
    ...calendar.events,
    ...upcoming.slice(0, 18),
    ...released.slice(-8),
    ...allEvents.filter(event => event.id === scenarioId),
  ].filter(event => ruleFor(event)).sort(timeSort).map(event => [event.id, event])).values()], [calendar.events, upcoming, released, allEvents, scenarioId]);

  const activeScenario = scenarioChoices.find(event => event.id === scenarioId)
    ?? scenarioChoices.find(event => (event.category === "macro" || event.kind === "policy") && !isPastEvent(event, now))
    ?? scenarioChoices[0];

  const weeklyPlaybooks = useMemo(() => scenariosFor(calendar).filter(item => item.events.length > 1 || item.kind === "holiday" || item.kind === "earlyClose").slice(0, 2), [calendar]);

  const filtered = useMemo(() => calendar.events.filter(event => (filter === "all" || event.category === filter)
    && (tentative || event.status === "confirmed")
    && (event.title + " " + event.detail).toLowerCase().includes(query.trim().toLowerCase()))
    .sort(byImpact ? impactSort : timeSort), [calendar.events, filter, tentative, query, byImpact]);

  const groups = byImpact ? [[null, filtered] as const] : [...new Set(filtered.map(event => event.date))].map(date =>
    [date, filtered.filter(event => event.date === date)] as const);
  const lastCovered = allWeeks.filter(value => value.week >= current && value.events.length > 0).at(-1);
  const dataChanged = allWeeks.map(value => value.refreshedAt).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;

  function syncUrl(nextView: ViewId, nextWeek: string, lessonKey?: string) {
    const url = new URL(location.href);
    url.searchParams.set("view", nextView);
    url.searchParams.set("week", nextWeek);
    if (lessonKey) url.searchParams.set("lesson", lessonKey);
    else url.searchParams.delete("lesson");
    url.hash = "";
    history.pushState(null, "", url);
  }

  function navigate(nextView: ViewId, nextWeek = week, lessonKey?: string) {
    setView(nextView);
    if (isWeek(nextWeek) && nextWeek !== week) setWeek(nextWeek);
    setInspected(null);
    syncUrl(nextView, isWeek(nextWeek) ? nextWeek : week, lessonKey);
    if (nextView === "scenarios") setScenarioMode(lessonKey ? "library" : "event");
    window.scrollTo?.({ top: 0, behavior: "instant" as ScrollBehavior });
  }

  function selectWeek(date: string) {
    if (!isWeek(date)) return;
    setWeek(date);
    syncUrl(view, date, view === "scenarios" && scenarioMode === "library" ? libraryKey : undefined);
  }

  function inspectEvent(event: MarketEvent, list: MarketEvent[]) {
    setInspected({ event, list });
  }

  function openLesson(key: string) {
    setLibraryKey(key);
    navigate("scenarios", week, key);
  }

  function canReplayLesson(key: string) {
    const series = replayKeyForLibrary(key);
    return Boolean(series && replays?.series[series]?.items.length);
  }

  const activeLibraryLesson = lessonFor(libraryKey)!;
  const activeLibraryPlaybook = playbookByKey(libraryKey) ?? playbookByKey("cpi")!;
  const activeLibraryProj = projectionByKey(libraryKey);
  const activeScenarioReplay = useMemo(() => {
    if (!activeScenario || !replays) return null;
    const key = replayKeyForEvent(activeScenario);
    const s = key ? replays.series[key] ?? null : null;
    return s && s.items.length >= 2 ? s : null;
  }, [activeScenario, replays]);
  const activeLibraryReplay = useMemo(() => {
    if (!replays) return null;
    const key = replayKeyForLibrary(libraryKey);
    const s = key ? replays.series[key] ?? null : null;
    return s && s.items.length >= 2 ? s : null;
  }, [libraryKey, replays]);
  const latestCurve9 = useMemo(() => {
    if (week >= current && preferLive && liveCurve) {
      return { values: liveCurve.values, label: `实时现券 (${liveCurve.exchange})` };
    }
    const last = points.at(-1);
    if (last && last.values.length === tenors.length) {
      return { values: last.values, label: `财政部日终 ${last.date}` };
    }
    return { values: fallbackBaseCurve, label: "手工示例曲线" };
  }, [week, current, preferLive, liveCurve, points]);

  function baseFor(event?: MarketEvent) {
    if (!event) return latestCurve9;
    const key = replayKeyForEvent(event);
    return eventCurveBase(event, now, points, key ? replays?.series[key] : undefined, latestCurve9);
  }
  const scenarioBase = baseFor(activeScenario);
  const drawerBase = baseFor(inspected?.event);

  return <>
    <div className="ambient-mesh" aria-hidden="true">
      <span className="orb orb-1" />
      <span className="orb orb-2" />
      <span className="orb orb-3" />
    </div>

    <div className="shell">
      <aside className="sidebar glass-rail">
        <div className="sidebar-top">
          <button type="button" className="brand brand-btn" onClick={() => navigate("overview")}>
            <span className="brand-badge"><TrendingUp size={20} /></span>
            <b>UST Weekly Desk<small>美债宏观与利率台</small></b>
          </button>
        </div>

        <nav className="nav-primary" aria-label="主功能导航">
          {primaryNav.map(({ id, title, icon: Icon }) => (
            <button type="button" key={id} className={view === id ? "active" : ""} aria-current={view === id ? "page" : undefined} onClick={() => navigate(id)}>
              <Icon size={16} />{title}
            </button>
          ))}
        </nav>

        <nav className="nav-secondary market-nav" aria-label="Alpha 策略">
          <span>Alpha 策略</span>
          <button type="button" className={view === "alpha" ? "active" : ""} aria-current={view === "alpha" ? "page" : undefined} onClick={() => navigate("alpha")}>
            <TrendingUp size={15} />Alpha 纸面交易
          </button>
          <button type="button" className={view === "alpha-explain" ? "active" : ""} aria-current={view === "alpha-explain" ? "page" : undefined} onClick={() => navigate("alpha-explain")}>
            <GitBranch size={15} />信号白盒拆解
          </button>
          <button type="button" className={view === "alpha-briefing" ? "active" : ""} aria-current={view === "alpha-briefing" ? "page" : undefined} onClick={() => navigate("alpha-briefing")}>
            <BookOpen size={15} />盘后复盘简报
          </button>
        </nav>

        <nav className="nav-secondary market-nav" aria-label="跨资产市场">
          <span>跨资产市场</span>
          <button type="button" className={view === "markets" ? "active" : ""} aria-current={view === "markets" ? "page" : undefined} onClick={() => navigate("markets")}>
            <Globe size={15} />全球市场
          </button>
          <button type="button" className={view === "market-stats" ? "active" : ""} aria-current={view === "market-stats" ? "page" : undefined} onClick={() => navigate("market-stats")}>
            <BarChart3 size={15} />相关性与统计
          </button>
        </nav>

        <div className="nav-secondary" aria-label="辅助页面">
          <button type="button" className={view === "sources" ? "active" : ""} aria-current={view === "sources" ? "page" : undefined} onClick={() => navigate("sources")}>
            <Database size={15} />数据来源与排程
          </button>
        </div>

        <div className="sidebar-controls">
          <div className="control-block">
            <span className="control-label"><Globe size={13} />交易中心时区</span>
            <div className="segmented full-seg" role="group" aria-label="选择交易中心时区">
              {([["ET", "纽约"], ["LDN", "伦敦"], ["TYO", "东京"]] as const).map(([key, label]) => (
                <button key={key} type="button" className={tz === key ? "active" : ""} onClick={() => setTz(key)}>{label}</button>
              ))}
            </div>
          </div>
          <div className="theme-corner">
            <button type="button" className="theme-mini" title={theme === "light" ? "切换深色模式" : "切换浅色模式"}
              aria-label={theme === "light" ? "切换深色模式" : "切换浅色模式"}
              onClick={() => setTheme(t => t === "light" ? "dark" : "light")}>
              {theme === "light" ? <><Moon size={13} /><span>深色</span></> : <><Sun size={13} /><span>浅色</span></>}
            </button>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <div className="eyebrow">
              <Sparkles size={13} />
              <span>US TREASURY MACRO &amp; RATES DESK</span>
              {week !== current && view !== "sources" && view !== "markets" && view !== "market-stats" && view !== "alpha" && view !== "alpha-explain" && view !== "alpha-briefing" && (
                <button type="button" className="history-pill" onClick={() => selectWeek(current)}>
                  当前周次 {short(week)}–{short(weekEnd)} · 返回本周
                </button>
              )}
            </div>
            <h1>
              {view === "overview" && "美国国债数据周报"}
              {view === "calendar" && "宏观、拍卖与美联储日历"}
              {view === "scenarios" && "经济数据情景与历史推演"}
              {view === "alpha" && "Core3 纯美债纸面交易与验证台"}
              {view === "alpha-explain" && "Core3 信号白盒拆解与经济学传导"}
              {view === "alpha-briefing" && "Core3 云端盘后复盘与研究简报"}
              {view === "sources" && "数据来源与自动排程"}
              {view === "markets" && "全球市场"}
              {view === "market-stats" && "相关性与统计"}
            </h1>
            <p>
              {view === "overview" && (week >= current && preferLive && liveCurve
                ? `Tradeweb 实时现券 ${formatClockSec(liveCurve.asOf, tz)} · 点击任意事件在右侧玻璃抽屉推演`
                : points.length ? "财政部日终观测 " + points.at(-1)!.date + " · 点击任意事件直接在右侧玻璃抽屉推演" : "收益率、经济数据、国债拍卖和美联储日程")}
              {view === "calendar" && `${short(week)} – ${short(weekEnd)} (${tzLabel(tz)}) · 点击任意行打开右侧详情与推演`}
              {view === "scenarios" && "比较宏观传导机制、不同政策环境与历史案例"}
              {view === "alpha" && "GitHub Actions 云端纯 Python 每日自动锁单与结算验证 · 支持 07:00–17:00 ET 下单与私密录单"}
              {view === "alpha-explain" && "零黑箱可视化拆解：从原始美债数据、3 大经济支柱系数、252 日风险平价、^MOVE 阻尼到每份期货合约目标手数"}
              {view === "alpha-briefing" && "100% 云端每日自动生成并归档（无需开个人电脑）· G6 锁箱三轨复盘 + 明日平仓倒计时 + 每日轮动新 Alpha 构想"}
              {view === "sources" && "Tradeweb 实时现券 + 12 个官方一级来源与跨资产日线快照的核验状态及自动排程说明"}
              {view === "markets" && "主要股指、外汇、国债收益率、商品期货与比特币"}
              {view === "market-stats" && "Cboe、Nasdaq、财政部、欧洲央行、EIA 与 Coinbase 日线相关性、波动率与回撤统计"}
            </p>
          </div>
          {view !== "markets" && view !== "market-stats" && view !== "alpha" && view !== "alpha-explain" && view !== "alpha-briefing" && <div className="sync">
            <span className={"sync-pill" + (week >= current && preferLive && liveCurve ? " sync-live" : "")}>
              {week >= current && preferLive && liveCurve ? <i className="live-dot" /> : <Clock size={13} />}
              {failed ? "日历载入失败 · 保留缓存" :
                liveCurve && week >= current && preferLive ? "实时 " + formatClockSec(liveCurve.asOf, tz) :
                lastSyncedAt ? "已同步 " + formatClockSec(lastSyncedAt, tz) :
                "更新 " + formatStamp(dataChanged, tz)}
            </span>
            <button type="button" className="action" onClick={() => { void refreshAll(true); }} disabled={loading || refreshing}>
              <RefreshCw size={14} className={loading || refreshing ? "spin" : ""} />{refreshing ? "刷新中" : loading ? "载入中" : "重新载入"}
            </button>
          </div>}
        </header>

        {view === "markets" && <MarketsView tz={tz} onStatistics={() => navigate("market-stats")} />}
        {view === "market-stats" && <MarketStatistics tz={tz} />}
        {view === "alpha" && <AlphaPaperView tz={tz} onExplain={() => navigate("alpha-explain")} onBriefing={() => navigate("alpha-briefing")} />}
        {view === "alpha-explain" && <AlphaExplainView onBackToPaper={() => navigate("alpha")} />}
        {view === "alpha-briefing" && <AlphaBriefingView tz={tz} onBackToPaper={() => navigate("alpha")} onExplain={() => navigate("alpha-explain")} />}

        {/* VIEW 1: OVERVIEW */}
        {view === "overview" && <>
          <div className="overview-grid">
            <Curve points={points} live={liveCurve} showLive={preferLive} canLive={week >= current} onToggleLive={setPreferLive} onLearn={() => openLesson("cpi")} tz={tz} />
            <FocusList inspect={inspectEvent} tz={tz} now={now} events={upcoming.slice(0, 6)} />
          </div>
          <LatestReleases events={latestReleases} tz={tz} inspect={inspectEvent} />

          {weeklyPlaybooks.length > 0 && <section className="panel glass">
            <div className="panel-header">
              <div><h2>本周结构提示</h2><p>跨事件共振与节假日流动性风险预警</p></div>
              <button type="button" className="action" onClick={() => navigate("scenarios")}>进入情景与历史推演</button>
            </div>
            <div className="playbook-strip">
              {weeklyPlaybooks.map(pb => <div className="playbook-card" key={pb.id}>
                <strong>{pb.title}</strong>
                <p>{pb.detail} <span>触发：{pb.trigger}</span></p>
              </div>)}
            </div>
          </section>}
        </>}

        {/* VIEW 2: CALENDAR */}
        {view === "calendar" && <section className="panel glass calendar">
          <div className="panel-header calendar-header">
            <div>
              <h2>周度发布列表</h2>
              <p>{short(week)} – {short(weekEnd)} ({tzLabel(tz)}) · {calendar.events.filter(event => event.status === "confirmed").length} 项已确认
                {lastCovered && " · 日程收录至 " + addDays(lastCovered.week, 6)}</p>
            </div>
            <div className="week-control">
              <button className="icon-button" aria-label="上一周" onClick={() => selectWeek(addDays(week, -7))}><ChevronLeft size={18} /></button>
              <input aria-label="选择日期" type="date" value={week} onChange={event => { if (event.target.value) selectWeek(weekOf(event.target.value)); }} />
              <button className="icon-button" aria-label="下一周" onClick={() => selectWeek(addDays(week, 7))}><ChevronRight size={18} /></button>
              <button className="action" onClick={() => selectWeek(current)} disabled={week === current}>本周</button>
            </div>
          </div>

          <div className="filters">
            <div className="chips">{([["all", "全部"], ...Object.entries(categories)] as [Category | "all", string][]).map(([key, title]) =>
              <button className="chip" type="button" key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{title}</button>)}</div>
            <label className="search"><Search size={15} /><input aria-label="搜索日程" placeholder="搜索本周" value={query} onChange={event => setQuery(event.target.value)} /></label>
            <label className="check"><input type="checkbox" checked={tentative} onChange={event => setTentative(event.target.checked)} />显示暂定</label>
            <button className="chip" aria-pressed={byImpact} onClick={() => setByImpact(value => !value)}><ArrowDownUp size={14} />按影响排序</button>
          </div>

          {filtered.length ? groups.map(([date, events]) => <div key={date ?? "rank"}>
            {date && <div className={"day" + (date === todayNy ? " day-today" : "")}>
              <b>
                {new Intl.DateTimeFormat("zh-CN", { weekday: "long", timeZone: "UTC" }).format(new Date(date + "T12:00:00Z"))} {short(date)}
                {date === todayNy && <em className="today-pill">今天 (NY)</em>}
              </b>
              <span>{events.length} 项</span>
            </div>}
            {groupReleases(events).map(batch => {
              const renderRow = (event: MarketEvent) => {
                const display = formatEventClock(event, tz);
                const past = isPastEvent(event, now);
                const official = past ? event.readings?.[0] : undefined;
                const secondaryBtc = event.category === "auction" ? event.readings?.find(r => r.label === "投标倍数") : undefined;
                const tagText = event.status === "tentative" ? categories[event.category] + " · 暂定" : categories[event.category];
                const impactLevel = event.impact >= 4 ? "high" : event.impact >= 3 ? "mid" : "low";
                const isSelected = inspected?.event.id === event.id;
                return <article key={event.id} className={"event-row impact-bar-" + impactLevel + (past ? " event-past" : "") + (isSelected ? " event-selected" : "")}>
                  <button className="event-line" type="button" onClick={() => inspectEvent(event, filtered)}>
                    <span className="event-clock">
                      {display.clock}
                      {display.dayShift !== 0 && <em className="day-shift">{display.dayShift > 0 ? "+1日" : "-1日"}</em>}
                    </span>
                    <span className="event-copy">
                      <span className="event-title-wrap">
                        <strong>{event.title}</strong>
                        {past && !official && !event.actual && <em className="past-pill">已过</em>}
                      </span>
                      <small>{event.detail}</small>
                      <span className="mobile-meta">
                        <span className={"tag tag-" + event.category}>{tagText}</span>
                        <span className={"impact " + impactLevel}>{impactText(event.impact)}</span>
                        {official && <span className="event-reading">{official.label} {readingText(official)}</span>}
                      </span>
                    </span>
                    {official && <span className="event-reading desktop-reading">
                      {readingText(official)}{secondaryBtc ? " · " + readingText(secondaryBtc) : ""}
                    </span>}
                    <span className={"tag desktop-meta tag-" + event.category}>{tagText}</span>
                    <span className={"impact desktop-meta " + impactLevel}>{impactText(event.impact)}</span>
                    <ChevronRight className="event-chevron" size={16} />
                  </button>
                </article>;
              };
              if (batch.length === 1) return renderRow(batch[0]);
              const display = formatEventClock(batch[0], tz);
              return <ReleaseGroup key={batch[0].id} events={batch} time={display.date + " " + display.clock + " " + tzShortTag(tz)}>
                {batch.map(renderRow)}
              </ReleaseGroup>;
            })}
          </div>) : <p className="empty">{calendar.events.length ? "没有符合筛选条件的事件。" :
            week > current ? "这一周尚无已收录日程。官方日期公布后会自动补入。" : "这周暂无已收录的公开日程。"}</p>}
        </section>}

        {/* VIEW 3: STANDALONE SCENARIOS & HISTORICAL PLAYBOOK LAB */}
        {view === "scenarios" && <div className="scenarios-page">
          <div className="panel glass mode-bar">
            <div className="segmented" role="tablist" aria-label="推演室模式">
              <button type="button" role="tab" aria-selected={scenarioMode === "event"} className={scenarioMode === "event" ? "active" : ""} onClick={() => navigate("scenarios")}>
                <SlidersHorizontal size={14} />按近期日程试算
              </button>
              <button type="button" role="tab" aria-selected={scenarioMode === "library"} className={scenarioMode === "library" ? "active" : ""} onClick={() => openLesson(libraryKey)}>
                <BookOpen size={14} />指标手册 ({lessons.length} 项)
              </button>
            </div>
            {scenarioMode === "event" && activeScenario && (
              <select aria-label="选择情景事件" value={activeScenario.id} onChange={e => setScenarioId(e.target.value)}>
                {scenarioChoices.map(ev => <option key={ev.id} value={ev.id}>{short(ev.date)} · {ev.title}</option>)}
              </select>
            )}
          </div>

          {scenarioMode === "event" ? (
            activeScenario ? <>
              <section className="panel glass">
                <div className="panel-header">
                  <div>
                    <h2>{short(activeScenario.date)} · {activeScenario.title}</h2>
                    <p>{activeScenario.detail}</p>
                  </div>
                  <div className="event-meta">
                    <SourceLink url={activeScenario.url} label={sourceIndex[activeScenario.source].name.split(" · ")[0]} />
                    {activeScenario.resultUrl && <SourceLink url={activeScenario.resultUrl} label="官方原文" />}
                  </div>
                </div>
                <div className="panel-pad">
                  <LessonCard lesson={lessonFor(playbookFor(activeScenario).key)!}
                    evidence={<ReleaseEvidence event={activeScenario} now={now} related={coReleases(activeScenario, allEvents)}
                      archive={activeScenarioReplay?.items.find(item => item.date === activeScenario.date)} />} />
                </div>
                <ScenarioCalculator
                  key={activeScenario.id}
                  now={now}
                  event={activeScenario}
                  allEvents={allEvents}
                  baseCurve={scenarioBase.values}
                  baseLabel={scenarioBase.label}
                  replaySeries={activeScenarioReplay}
                  onOpenReplay={activeScenarioReplay ? () => { document.getElementById("standalone-replay")?.scrollIntoView({ behavior: "smooth", block: "start" }); } : undefined}
                  sameTime={coReleases(activeScenario, allEvents)}
                />
              </section>

              {activeScenarioReplay && (
                <section id="standalone-replay" className="panel glass">
                  <div className="panel-pad replay-standalone-pad">
                    <HistoricalReplayPanel series={activeScenarioReplay} curveThrough={replays?.curveThrough} event={activeScenario} />
                  </div>
                </section>
              )}

              <section className="panel glass">
                <div className="panel-header">
                  <div>
                    <h2>历史实证与周期分叉 · {playbookFor(activeScenario).name}</h2>
                    <p>用财政部日终曲线核对案例中的期限变化，再检验传导解释</p>
                  </div>
                </div>
                <div className="panel-pad"><PlaybookView playbook={playbookFor(activeScenario)} /></div>
              </section>

              <section className="panel glass">
                <details className="study-details study-panel-details"><summary>进阶 · 盘口、RFQ 与对冲</summary><MicrostructureGrid kind={activeScenario.kind} /></details>
              </section>
            </> : <section className="panel glass"><p className="empty">当前没有可推演的经济数据、FOMC 或国债拍卖事件。</p></section>
          ) : (
            <section className="panel glass">
              <div className="panel-header">
                <div>
                  <h2>美债宏观指标手册</h2>
                  <p>学习如何读数据、推断影响期限，并用历史案例核对</p>
                </div>
              </div>
              <div className="lesson-layout panel-pad">
                <LessonDirectory selected={libraryKey} onSelect={openLesson}
                  canReplay={canReplayLesson} hasPractice={hasHistoricalPractice} />
                <div className="lesson-content">
                  <h2>{activeLibraryLesson.title}</h2>
                  <LessonCard lesson={activeLibraryLesson} />
                  <HistoryPractice key={libraryKey} course={libraryKey} />
                  <details className="study-details">
                    <summary>收益率曲线压力情景</summary>
                    <CurveProjection projectionSet={activeLibraryProj} baseCurve={latestCurve9.values}
                      baseLabel={latestCurve9.label} focusIndex={focusTenorIndexFor(libraryKey)} />
                  </details>
                  {activeLibraryReplay && <details className="study-details">
                    <summary>近期日终回放</summary>
                    <HistoricalReplayPanel series={activeLibraryReplay} curveThrough={replays?.curveThrough} />
                  </details>}
                  <details className="study-details">
                    <summary>传导矩阵与案例</summary><PlaybookView playbook={activeLibraryPlaybook} />
                  </details>
                </div>
              </div>
            </section>
          )}
        </div>}

        {/* VIEW 4: SEPARATED SOURCES PAGE */}
        {view === "sources" && <section className="panel glass">
          <div className="panel-header">
            <div>
              <h2>官方一级数据来源（{short(week)} – {short(weekEnd)}）</h2>
              <p>工作日 08:07–16:52 ET 每 15 分钟核对近端发布，17:25 / 18:25 ET 补抓日终名义与 TIPS 曲线，每日 06:25 ET 更新跨资产日线快照，周日 18:07 ET 刷新未来八周。</p>
            </div>
            <div className="week-control">
              <button className="icon-button" aria-label="上一周" onClick={() => selectWeek(addDays(week, -7))}><ChevronLeft size={18} /></button>
              <button className="action" onClick={() => selectWeek(current)} disabled={week === current}>本周</button>
              <button className="icon-button" aria-label="下一周" onClick={() => selectWeek(addDays(week, 7))}><ChevronRight size={18} /></button>
            </div>
          </div>
          <div className="source-list">
            <article>
              <div>
                <SourceLink url="https://www.cnbc.com/bonds/" label="Tradeweb / CNBC · 实时现券曲线" />
                <p>浏览器端直连 3M–30Y 全部 9 期限美债实时现券收益率，每 30 秒自动刷新（纽约/伦敦/东京盘全时段覆盖）</p>
              </div>
              <span className={"source-state " + (liveCurve ? "verified" : liveFailed ? "unavailable" : "cached")}>
                {liveCurve ? "实时在线" : liveFailed ? "已回退日终" : "连接中"}
              </span>
              <time>{liveCurve ? formatClockSec(liveCurve.asOf, tz) : "—"}</time>
            </article>
            {calendar.sources.map(check => <article key={check.id}>
              <div>
                <SourceLink url={sourceIndex[check.id].url} label={sourceIndex[check.id].name} />
                <p>{sourceIndex[check.id].detail}</p>
              </div>
              <span className={"source-state " + check.state}>{stateText[check.state]}</span>
              <time>{formatStamp(check.checkedAt, tz)}</time>
            </article>)}
          </div>
          <p className="source-note">财政部名义平价与 TIPS 实际收益率为日终数据。官方自动采集覆盖 CPI、PPI、非农、JOLTS、ECI、PCE、GDP、生产率/ULC 及国债拍卖结果，并结合 BLS/BEA/美联储原始发布存档与圣路易斯联储 ALFRED 发布日快照自动生成近次实证回放库（{replays ? `${Object.keys(replays.series).length} 个序列 · 截至 ${replays.curveThrough}` : "载入中"}）。{" "}
            <SourceLink url={nowcastUrl} label="Cleveland Fed 通胀模型" /></p>
        </section>}

        <footer>UST Weekly Desk · 原始日程按纽约时间校准 · 当前按 {tzLabel(tz)} 展示</footer>
      </main>
    </div>

    {/* Slide-over Liquid Glass Inspector Drawer */}
    {inspected && (
      <EventDrawer
        event={inspected.event}
        list={inspected.list}
        allEvents={allEvents}
        baseCurve={drawerBase.values}
        baseLabel={drawerBase.label}
        replays={replays}
        tz={tz}
        now={now}
        currentView={view}
        onClose={() => setInspected(null)}
        onStep={next => setInspected(prev => prev ? { ...prev, event: next } : null)}
        onJumpWeek={targetWeek => { navigate("calendar", targetWeek); }}
        onOpenFullScenario={ev => { setScenarioMode("event"); setScenarioId(ev.id); navigate("scenarios", weekOf(ev.date)); }}
      />
    )}
  </>;
}
