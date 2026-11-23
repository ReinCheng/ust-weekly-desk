import { useEffect, useMemo, useState } from "react";
import {
  Activity, AlertTriangle, ArrowDownUp, BarChart3, BookOpen, CalendarDays, ChevronLeft,
  ChevronRight, Clock, Database, ExternalLink, Globe, History, Layers, LineChart, Moon,
  RefreshCw, RotateCcw, Search, SlidersHorizontal, Sparkles, Sun, TrendingUp, X,
} from "lucide-react";
import { analysis, dimensions, scenariosFor } from "./analysis";
import {
  addDays, categories, curveValue, formatEventClock, impactSort, impactText, isPastEvent,
  isWeek, legacyTenors, newYorkDate, newYorkInstant, realCurveValue, sourceIndex, tenors,
  timeSort, tzIana, tzLabel, tzShortTag, weekOf, type Calendar, type Category, type CurvePoint,
  type MarketEvent, type Reading, type SourceCheck, type Tenor, type TzMode,
} from "./model";
import { loadCalendars } from "./pages-data";
import { featuredPlaybookKeys, playbookByKey, playbookFor, type Playbook } from "./playbooks";
import { nowcastUrl } from "./releases";
import { actualFor, priorFor, ruleFor, scenarioFor } from "./scenarios";
import { seedCalendar } from "./seed";

type ViewId = "overview" | "calendar" | "scenarios" | "sources";
type DrawerTab = "scenario" | "history" | "micro";
type ThemeMode = "light" | "dark";
type CurveMode = "curve" | "change";
type BenchMode = "1D" | "1W" | "1M";
type SavedScenarioInput = { expected?: string; hypothesis?: string; components?: string; stance?: string };

const STORAGE_THEME = "ust-desk-theme";
const STORAGE_TZ = "ust-desk-tz";
const STORAGE_SCENARIOS = "ust-desk-scenarios-v1";

const validViews: ViewId[] = ["overview", "calendar", "scenarios", "sources"];
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
  let best = prior[0];
  for (const pt of prior) {
    if (pt.date <= target) best = pt;
    else break;
  }
  return best;
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
    const empty = !input.expected && !input.hypothesis && (!input.components || input.components === "unknown") && (!input.stance || input.stance === "none");
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

function Curve({ points }: { points: CurvePoint[] }) {
  const latest = points.at(-1);
  const [mode, setMode] = useState<CurveMode>("curve");
  const [bench, setBench] = useState<BenchMode>("1D");
  const [focus, setFocus] = useState<number | null>(null);
  const compare = pickBenchmark(points, bench);

  const activeTenors: readonly Tenor[] = latest && latest.values.length === tenors.length
    ? tenors
    : (legacyTenors as readonly Tenor[]);
  const latestVals = latest ? activeTenors.map(t => curveValue(latest, t) ?? NaN) : [];
  const compareVals = compare ? activeTenors.map(t => curveValue(compare, t) ?? NaN) : [];
  const hasCompare = Boolean(compare && compareVals.every(Number.isFinite));
  const deltasBp = activeTenors.map((_, i) =>
    hasCompare && Number.isFinite(latestVals[i]) ? Math.round((latestVals[i] - compareVals[i]) * 100) : null
  );

  const validVals = [...latestVals, ...(hasCompare ? compareVals : [])].filter(Number.isFinite);
  const start = validVals.length ? Math.min(...validVals) - 0.1 : 0;
  const end = validVals.length ? Math.max(...validVals) + 0.12 : 1;
  const padL = 44, padR = 20, width = 520, height = 198;
  const x = (index: number) => activeTenors.length > 1
    ? padL + (width - padL - padR) * index / (activeTenors.length - 1)
    : width / 2;
  const y = (value: number) => 152 - 122 * (value - start) / Math.max(0.01, end - start);
  const linePath = (vals: number[]) => vals.map((v, i) => x(i).toFixed(1) + "," + y(v).toFixed(1)).join(" ");
  const areaPath = latestVals.length
    ? `M ${x(0).toFixed(1)},152 L ${latestVals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" L ")} L ${x(latestVals.length - 1).toFixed(1)},152 Z`
    : "";

  const maxAbsBp = Math.max(8, ...deltasBp.map(d => (d === null ? 0 : Math.abs(d))));
  const zeroY = 92;
  const barY = (bp: number) => zeroY - (bp / maxAbsBp) * 58;

  const y2 = curveValue(latest, "2Y");
  const y5 = curveValue(latest, "5Y");
  const y10 = curveValue(latest, "10Y");
  const y20 = curveValue(latest, "20Y");
  const y30 = curveValue(latest, "30Y");
  const fly102030 = y10 !== undefined && y20 !== undefined && y30 !== undefined ? Math.round((2 * y20 - y10 - y30) * 100) : null;
  const fly2510 = y2 !== undefined && y5 !== undefined && y10 !== undefined ? Math.round((2 * y5 - y2 - y10) * 100) : null;
  const focusedIdx = focus !== null && focus < activeTenors.length ? focus : null;

  return <section className="panel glass curve" aria-labelledby="curve-title">
    <div className="panel-header curve-header">
      <div>
        <h2 id="curve-title">美债收益率曲线</h2>
        <p>{latest ? latest.date + " · 财政部日终平价曲线" : "等待财政部日终数据"}</p>
      </div>
      <div className="curve-controls">
        <div className="segmented" role="group" aria-label="图表视图">
          <button type="button" className={mode === "curve" ? "active" : ""} onClick={() => setMode("curve")}>
            <LineChart size={13} />曲线
          </button>
          <button type="button" className={mode === "change" ? "active" : ""} onClick={() => setMode("change")} disabled={!hasCompare}>
            <BarChart3 size={13} />变动 bp
          </button>
        </div>
        <div className="segmented" role="group" aria-label="对比基准">
          {(["1D", "1W", "1M"] as const).map(b => (
            <button key={b} type="button" className={bench === b ? "active" : ""} onClick={() => setBench(b)} disabled={points.length < 2}>{b}</button>
          ))}
        </div>
        <SourceLink url={sourceIndex.curve.url} label="财政部" />
      </div>
    </div>

    {latest ? <>
      {mode === "curve" ? (
        <svg className="curve-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="美债官方平价收益率曲线">
          <defs>
            <linearGradient id="curveArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.24" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.01" />
            </linearGradient>
          </defs>
          {[0, 1, 2, 3].map(i => {
            const value = start + (end - start) * i / 3;
            return <g key={i}>
              <line x1={padL} x2={width - padR} y1={y(value)} y2={y(value)} className="grid-line" />
              <text x={padL - 7} y={y(value) + 3.5} textAnchor="end">{value.toFixed(2)}%</text>
            </g>;
          })}
          <path d={areaPath} fill="url(#curveArea)" />
          {hasCompare && <polyline fill="none" className="compare-line" strokeWidth="1.9" strokeDasharray="4 4" points={linePath(compareVals)} />}
          <polyline fill="none" className="main-line" strokeWidth="2.8" strokeLinejoin="round" strokeLinecap="round" points={linePath(latestVals)} />
          {latestVals.map((value, i) => {
            const active = focusedIdx === i;
            const d = deltasBp[i];
            const cx = x(i), cy = y(value);
            const tipX = Math.min(Math.max(cx, 78), width - 78);
            const tipY = cy < 52 ? cy + 28 : cy - 16;
            return <g key={activeTenors[i]} className="curve-point" onMouseEnter={() => setFocus(i)} onMouseLeave={() => setFocus(null)}
              onClick={() => setFocus(prev => prev === i ? null : i)}>
              {active && <line x1={cx} x2={cx} y1="26" y2="152" className="focus-guide" />}
              <circle cx={cx} cy={cy} r={active ? 6 : 3.8} className="curve-dot" />
              <circle cx={cx} cy={cy} r="17" fill="transparent">
                <title>{activeTenors[i] + " " + value.toFixed(2) + "%" + (d !== null ? " (" + sign(d, 0) + " bp)" : "")}</title>
              </circle>
              <text x={cx} y="176" textAnchor="middle" className={active ? "tenor-active" : ""}>{activeTenors[i]}</text>
              {active && <g className="svg-callout">
                <rect x={tipX - 58} y={tipY - 15} width="116" height="22" rx="11" />
                <text x={tipX} y={tipY} textAnchor="middle" className="chart-value">
                  {activeTenors[i]} {value.toFixed(2)}%{d !== null ? " · " + sign(d, 0) + "bp" : ""}
                </text>
              </g>}
            </g>;
          })}
        </svg>
      ) : (
        <svg className="curve-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="各期限收益率变动基点">
          <line x1={padL} x2={width - padR} y1={zeroY} y2={zeroY} className="zero-line" />
          <text x={padL - 7} y={zeroY + 3.5} textAnchor="end">0bp</text>
          <text x={padL - 7} y="38" textAnchor="end">+{maxAbsBp}</text>
          <text x={padL - 7} y="152" textAnchor="end">-{maxAbsBp}</text>
          {deltasBp.map((bp, i) => {
            if (bp === null) return null;
            const cx = x(i);
            const yTop = bp >= 0 ? barY(bp) : zeroY;
            const barH = Math.max(2, Math.abs(barY(bp) - zeroY));
            const labelY = bp >= 0 ? yTop - 6 : yTop + barH + 12;
            return <g key={activeTenors[i]}>
              <rect x={cx - 13} y={yTop} width="26" height={barH} rx="6" className={bp > 0 ? "bar-up" : bp < 0 ? "bar-down" : "bar-flat"} />
              <text x={cx} y={labelY} textAnchor="middle" className={bp > 0 ? "bp-up" : bp < 0 ? "bp-down" : ""}>{sign(bp, 0)}</text>
              <text x={cx} y="178" textAnchor="middle">{activeTenors[i]}</text>
            </g>;
          })}
        </svg>
      )}
      <div className="curve-foot">
        {y2 !== undefined && y10 !== undefined && <span><b>2s10s</b> {sign((y10 - y2) * 100, 0)} bp</span>}
        {y5 !== undefined && y30 !== undefined && <span><b>5s30s</b> {sign((y30 - y5) * 100, 0)} bp</span>}
        {fly2510 !== null && <span><b>2s5s10s</b> {sign(fly2510, 0)} bp</span>}
        {fly102030 !== null && <span><b>10/20/30 fly</b> {sign(fly102030, 0)} bp</span>}
        {hasCompare && compare && <span className="legend">虚线 / 基准 {short(compare.date)} ({bench})</span>}
      </div>
    </> : <p className="empty">该日期之前暂无可用的曲线数据。</p>}
  </section>;
}

function RateCards({ points }: { points: CurvePoint[] }) {
  const latest = points.at(-1);
  const prev1d = pickBenchmark(points, "1D");
  const prev1w = pickBenchmark(points, "1W");
  const heroTenors: Tenor[] = ["2Y", "5Y", "10Y", "30Y"];

  const y3m = curveValue(latest, "3M"), y2 = curveValue(latest, "2Y"), y5 = curveValue(latest, "5Y");
  const y10 = curveValue(latest, "10Y"), y20 = curveValue(latest, "20Y"), y30 = curveValue(latest, "30Y");
  const r10 = realCurveValue(latest, "10Y");
  const be10 = y10 !== undefined && r10 !== undefined ? y10 - r10 : undefined;

  const p3m = curveValue(prev1d, "3M"), p2 = curveValue(prev1d, "2Y"), p5 = curveValue(prev1d, "5Y");
  const p10 = curveValue(prev1d, "10Y"), p20 = curveValue(prev1d, "20Y"), p30 = curveValue(prev1d, "30Y");
  const pr10 = realCurveValue(prev1d, "10Y");
  const pbe10 = p10 !== undefined && pr10 !== undefined ? p10 - pr10 : undefined;

  const ribbon = [
    y3m !== undefined ? { label: "3M 短端", value: y3m.toFixed(2) + "%", delta: p3m !== undefined ? Math.round((y3m - p3m) * 100) : null } : null,
    y3m !== undefined && y10 !== undefined ? { label: "3m10s", value: sign((y10 - y3m) * 100, 0) + " bp", delta: p3m !== undefined && p10 !== undefined ? Math.round(((y10 - y3m) - (p10 - p3m)) * 100) : null } : null,
    y2 !== undefined && y10 !== undefined ? { label: "2s10s", value: sign((y10 - y2) * 100, 0) + " bp", delta: p2 !== undefined && p10 !== undefined ? Math.round(((y10 - y2) - (p10 - p2)) * 100) : null } : null,
    y5 !== undefined && y30 !== undefined ? { label: "5s30s", value: sign((y30 - y5) * 100, 0) + " bp", delta: p5 !== undefined && p30 !== undefined ? Math.round(((y30 - y5) - (p30 - p5)) * 100) : null } : null,
    y10 !== undefined && y20 !== undefined && y30 !== undefined ? { label: "10/20/30 Fly", value: sign((2 * y20 - y10 - y30) * 100, 0) + " bp", delta: p10 !== undefined && p20 !== undefined && p30 !== undefined ? Math.round(((2 * y20 - y10 - y30) - (2 * p20 - p10 - p30)) * 100) : null } : null,
    r10 !== undefined ? { label: "10Y 实际利率", value: r10.toFixed(2) + "%", delta: pr10 !== undefined ? Math.round((r10 - pr10) * 100) : null } : null,
    be10 !== undefined ? { label: "10Y Breakeven", value: be10.toFixed(2) + "%", delta: pbe10 !== undefined ? Math.round((be10 - pbe10) * 100) : null } : null,
  ].filter((item): item is { label: string; value: string; delta: number | null } => Boolean(item));

  return <div className="rates-wrap">
    <div className="rate-grid" aria-label="主要期限收益率">
      {heroTenors.map(tenor => {
        const val = curveValue(latest, tenor);
        const d1 = val !== undefined && curveValue(prev1d, tenor) !== undefined ? Math.round((val - curveValue(prev1d, tenor)!) * 100) : null;
        const d1w = val !== undefined && curveValue(prev1w, tenor) !== undefined && prev1w?.date !== prev1d?.date
          ? Math.round((val - curveValue(prev1w, tenor)!) * 100) : null;
        return <article className="rate-card glass-hero" key={tenor}>
          <div className="rate-head">
            <span>{tenor} 国债</span>
            {d1 !== null && <em className={"delta-pill " + (d1 > 0 ? "up" : d1 < 0 ? "down" : "flat")}>{sign(d1, 0)} bp</em>}
          </div>
          <strong>{val !== undefined ? val.toFixed(2) + "%" : "—"}</strong>
          <small>
            {d1 === null ? "暂无日变动" : "较上日"}
            {d1w !== null && <> · 1W <b className={d1w > 0 ? "txt-up" : d1w < 0 ? "txt-down" : ""}>{sign(d1w, 0)} bp</b></>}
          </small>
        </article>;
      })}
    </div>
    {ribbon.length > 0 && <div className="spread-ribbon glass" aria-label="利差与通胀预期指标">
      {ribbon.map(item => <div className="spread-chip" key={item.label}>
        <span>{item.label}</span>
        <strong>{item.value}</strong>
        {item.delta !== null && <em className={item.delta > 0 ? "txt-up" : item.delta < 0 ? "txt-down" : "txt-muted"}>{sign(item.delta, 0)}</em>}
      </div>)}
    </div>}
  </div>;
}

function FocusList({ events, tz, now, inspect }: { events: MarketEvent[]; tz: TzMode; now: Date; inspect: (event: MarketEvent, list: MarketEvent[]) => void }) {
  return <section className="panel glass focus-panel">
    <div className="panel-header">
      <div><h2>接下来关注</h2><p>点击任意事件直接右侧推演 · {tzLabel(tz)}</p></div>
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
      <span className="vol-badge"><Activity size={13} />典型波动：{playbook.volatility}</span>
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
      <h3><History size={14} />官方财政部历史实证案例</h3>
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
          </article>
        ))}
      </div>
    </div>
  </div>;
}

function ScenarioCalculator({ event, sameTime, allEvents }: { event: MarketEvent; sameTime: MarketEvent[]; allEvents: MarketEvent[] }) {
  const rule = ruleFor(event)!;
  const official = actualFor(event, rule);
  const prior = useMemo(() => priorFor(event, allEvents, rule), [event, allEvents, rule]);
  const initialSaved = useMemo(() => loadSavedScenarios()[event.id] ?? {}, [event.id]);

  const [expected, setExpected] = useState(initialSaved.expected ?? "");
  const [hypothesis, setHypothesis] = useState(initialSaved.hypothesis ?? "");
  const [components, setComponents] = useState(initialSaved.components ?? "unknown");
  const [stance, setStance] = useState(initialSaved.stance ?? "none");

  useEffect(() => {
    saveScenarioInput(event.id, { expected, hypothesis, components, stance });
  }, [event.id, expected, hypothesis, components, stance]);

  const hasCustomInput = Boolean(expected || hypothesis || components !== "unknown" || stance !== "none");
  const resetInputs = () => { setExpected(""); setHypothesis(""); setComponents("unknown"); setStance("none"); };

  const isAuction = event.category === "auction";
  const isQual = Boolean(rule.qualitative);
  const useModel = !isQual && expected.trim() === "" && event.reference?.value !== undefined;
  const expectedValue = expected.trim() === "" ? event.reference?.value : Number(expected);
  const actualValue = hypothesis.trim() === "" ? official : Number(hypothesis);
  const diff = !isQual && expectedValue !== undefined && actualValue !== undefined && Number.isFinite(expectedValue) && Number.isFinite(actualValue)
    ? Number((actualValue - expectedValue).toFixed(6)) : null;

  const noiseBand = useModel ? 0.05 : (rule.noise ?? 0);
  const bigBand = rule.big ?? Infinity;
  const absDiff = diff === null ? 0 : Math.abs(diff);
  const near = diff !== null && (noiseBand > 0 ? absDiff < noiseBand : diff === 0);
  const magnitude = diff === null ? null : near ? "噪音/符合预期" : absDiff >= bigBand ? "显著意外" : "小幅偏离";

  const verdict: "above" | "below" | null = isQual
    ? (stance === "above" || stance === "below" ? stance : null)
    : (diff === null || near ? null : diff > 0 ? "above" : "below");

  const mixed = components === "mixed";
  const confirmed = components === "aligned" && !sameTime.length;
  const comparator = isAuction ? "截标前 WI" : useModel ? "模型" : "预期";
  const positive = rule.aboveLabel ?? (isAuction ? "高于 WI (Tail)" : "高于预期");
  const negative = rule.belowLabel ?? (isAuction ? "低于 WI (Stop-through)" : "低于预期");
  const resultLabel = hypothesis ? "假设值" : "官方值";
  const deltaValue = diff === null ? "" : isAuction
    ? sign(diff * 100, 1) + " bp"
    : rule.unit === "%" ? sign(diff, 2) + " 个百分点"
    : rule.unit === "百万" ? sign(diff, 2) + " 百万"
    : sign(diff, 0) + " 千人";

  const formatUnitVal = (v: number) =>
    rule.unit === "%" ? (isAuction ? v.toFixed(3) + "%" : v.toFixed(2).replace(/\.00$/, ".0") + "%")
    : rule.unit === "百万" ? v.toFixed(1) + " 百万"
    : v + " 千人";

  return <div className="calc-wrap">
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
        <label>{isAuction ? "截标前 WI 收益率" : "市场一致预期"} <span>{rule.unit}</span>
          <input type="number" step="any" value={expected} onChange={e => setExpected(e.target.value)}
            placeholder={event.reference ? "默认模型 " + event.reference.value.toFixed(2) : "填入预期"} />
        </label>
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
        <b>前值</b> {formatUnitVal(prior.value)} ({short(prior.date)})
        {!isQual && expected === "" && <button type="button" className="inline-fill" onClick={() => setExpected(String(prior.value))}>填入预期</button>}
      </span>}
      {event.reference && <span><b>模型参考</b> {event.reference.value.toFixed(2)}% ({event.reference.period}){" "}
        <SourceLink url={nowcastUrl} label="Cleveland Fed" /></span>}
    </div>

    {(diff !== null || (isQual && verdict !== null)) && <div className="verdict" aria-live="polite">
      <div className="verdict-head">
        <strong>{isQual ? (verdict === "above" ? positive : negative) : `${resultLabel}减${comparator} ${deltaValue}`}</strong>
        {magnitude && <em className={"mag-pill " + (near ? "mag-near" : absDiff >= bigBand ? "mag-big" : "mag-mid")}>{magnitude}</em>}
      </div>
      <p>{near ? (useModel ? "差值小于 0.05 个百分点，接近官方月率精度。优先核对未四舍五入精确值与分项。" : "处于噪音/符合预期区间，利率方向主要看分项、前值修订及同刻发布。") :
        mixed ? "分项或沟通出现冲突，方向判断降级。先观察发布后 15–30 分钟价格是否延续。" :
        scenarioFor(event, rule, verdict!).direction + (confirmed ? "。分项一致，仍需盘口成交确认。" : "。暂作条件判断，等待分项与价格确认。")}</p>
    </div>}

    <div className="scenario-grid">{(["above", "below"] as const).map(comparison => {
      const scenario = scenarioFor(event, rule, comparison);
      return <article key={comparison} className={verdict === comparison && !mixed ? "matched" : undefined}>
        <span className={"scenario-tag dir-" + scenario.yieldDir}>{comparison === "above" ? positive : negative}</span>
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
  event, list, allEvents, tz, now, currentView, onClose, onStep, onJumpWeek, onOpenFullScenario,
}: {
  event: MarketEvent;
  list: MarketEvent[];
  allEvents: MarketEvent[];
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
  const [tab, setTab] = useState<DrawerTab>(() => (rule ? "scenario" : "history"));

  useEffect(() => {
    setTab(rule ? "scenario" : "history");
  }, [event.id, Boolean(rule)]);

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
  const sameTime = allEvents.filter(item => item.id !== event.id && item.date === event.date && item.time && item.time === event.time && item.impact >= 3);
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

      <div className="drawer-title-block">
        <h2 id="drawer-title">{event.title}</h2>
        <p>{event.detail}</p>
        <div className="event-meta">
          <SourceLink url={event.url} label={sourceIndex[event.source].name.split(" · ")[0]} />
          {event.resultUrl && <SourceLink url={event.resultUrl} label="官方发布原文" />}
          {tz !== "ET" && event.time && <span>纽约原时 {short(event.date)} {event.time} ET</span>}
          {event.officialDate && <span>来源更新 {event.officialDate}</span>}
        </div>

        {event.readings?.length ? <div className="reading-grid">{event.readings.map(reading =>
          <div key={reading.label}><span>{reading.label}</span><strong>{readingText(reading)}</strong></div>)}</div> :
          event.actual && <p className="evidence">{event.actual}</p>}

        {sameTime.length > 0 && <p className="evidence warn-note">同刻发布冲突：{sameTime.map(item => item.title).join("、")}。</p>}
      </div>

      <div className="drawer-tabs">
        <div className="segmented full-seg" role="tablist" aria-label="事件分析视图">
          {rule && <button type="button" role="tab" aria-selected={tab === "scenario"} className={tab === "scenario" ? "active" : ""} onClick={() => setTab("scenario")}>
            <SlidersHorizontal size={13} />情景推演
          </button>}
          <button type="button" role="tab" aria-selected={tab === "history"} className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>
            <History size={13} />历史与机制
          </button>
          <button type="button" role="tab" aria-selected={tab === "micro"} className={tab === "micro" ? "active" : ""} onClick={() => setTab("micro")}>
            <Layers size={13} />交易台微结构
          </button>
        </div>
      </div>

      <div className="drawer-scroll">
        {tab === "scenario" && rule && <ScenarioCalculator key={event.id} event={event} sameTime={sameTime} allEvents={allEvents} />}
        {tab === "history" && <PlaybookView playbook={playbook} compact />}
        {tab === "micro" && <MicrostructureGrid kind={event.kind} />}
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
      return saved === "BJ" || saved === "LOCAL" || saved === "ET" ? saved : "ET";
    } catch { return "ET"; }
  });

  const [calendars, setCalendars] = useState<Record<string, Calendar>>({});
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);

  // Calendar filters
  const [filter, setFilter] = useState<Category | "all">("all");
  const [query, setQuery] = useState("");
  const [tentative, setTentative] = useState(true);
  const [byImpact, setByImpact] = useState(false);

  // Scenarios standalone page state
  const [scenarioMode, setScenarioMode] = useState<"event" | "library">("event");
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const [libraryKey, setLibraryKey] = useState<string>("cpi");

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
      const requested = new URLSearchParams(location.search).get("week");
      if (isWeek(requested)) setWeek(requested);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function read() {
      try {
        const data = await loadCalendars(controller.signal);
        if (!controller.signal.aborted) { setCalendars(data); setFailed(false); }
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      } finally {
        if (!controller.signal.aborted) { setNow(new Date()); setLoading(false); }
      }
    }
    void read();
    const timer = window.setInterval(read, 120000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [reload]);

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

  function syncUrl(nextView: ViewId, nextWeek: string) {
    const url = new URL(location.href);
    url.searchParams.set("view", nextView);
    url.searchParams.set("week", nextWeek);
    url.hash = "";
    history.pushState(null, "", url);
  }

  function navigate(nextView: ViewId, nextWeek = week) {
    setView(nextView);
    if (isWeek(nextWeek) && nextWeek !== week) setWeek(nextWeek);
    setInspected(null);
    syncUrl(nextView, isWeek(nextWeek) ? nextWeek : week);
    window.scrollTo?.({ top: 0, behavior: "instant" as ScrollBehavior });
  }

  function selectWeek(date: string) {
    if (!isWeek(date)) return;
    setWeek(date);
    syncUrl(view, date);
  }

  function inspectEvent(event: MarketEvent, list: MarketEvent[]) {
    setInspected({ event, list });
  }

  const activeLibraryPlaybook = playbookByKey(libraryKey) ?? playbookByKey("cpi")!;

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
          <button type="button" className="icon-button mobile-theme-btn" aria-label="切换明暗液态玻璃"
            onClick={() => setTheme(t => t === "light" ? "dark" : "light")}>
            {theme === "light" ? <Moon size={15} /> : <Sun size={15} />}
          </button>
        </div>

        <nav className="nav-primary" aria-label="主功能导航">
          {primaryNav.map(({ id, title, icon: Icon }) => (
            <button type="button" key={id} className={view === id ? "active" : ""} onClick={() => navigate(id)}>
              <Icon size={16} />{title}
            </button>
          ))}
        </nav>

        <div className="nav-secondary" aria-label="辅助页面">
          <button type="button" className={view === "sources" ? "active" : ""} onClick={() => navigate("sources")}>
            <Database size={15} />数据来源与排程
          </button>
        </div>

        <div className="sidebar-controls">
          <div className="control-block">
            <span className="control-label"><Globe size={13} />显示时区</span>
            <div className="segmented full-seg" role="group" aria-label="选择时区">
              {([["ET", "纽约"], ["BJ", "北京"], ["LOCAL", "本地"]] as const).map(([key, label]) => (
                <button key={key} type="button" className={tz === key ? "active" : ""} onClick={() => setTz(key)}>{label}</button>
              ))}
            </div>
          </div>
          <button type="button" className="theme-toggle" onClick={() => setTheme(t => t === "light" ? "dark" : "light")}>
            {theme === "light" ? <><Moon size={15} />切换深色玻璃</> : <><Sun size={15} />切换浅色玻璃</>}
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <div className="eyebrow">
              <Sparkles size={13} />
              <span>US TREASURY MACRO &amp; RATES DESK</span>
              {week !== current && view !== "sources" && (
                <button type="button" className="history-pill" onClick={() => selectWeek(current)}>
                  当前周次 {short(week)}–{short(weekEnd)} · 返回本周
                </button>
              )}
            </div>
            <h1>
              {view === "overview" && "美国国债数据周报"}
              {view === "calendar" && "宏观、拍卖与美联储日历"}
              {view === "scenarios" && "经济数据情景与历史推演"}
              {view === "sources" && "数据来源与自动排程"}
            </h1>
            <p>
              {view === "overview" && (points.length ? "收益率观测日 " + points.at(-1)!.date + " · 点击任意事件直接在右侧玻璃抽屉推演，不再跳来跳去" : "收益率、经济数据、国债拍卖和美联储日程")}
              {view === "calendar" && `${short(week)} – ${short(weekEnd)} (${tzLabel(tz)}) · 点击任意行打开右侧详情与推演`}
              {view === "scenarios" && "核对核心传导机制、周期分叉、常见反向陷阱与官方财政部历史实证案例"}
              {view === "sources" && "12 个官方一级来源的核验状态、日内及日终自动刷新排程说明"}
            </p>
          </div>
          <div className="sync">
            <span className="sync-pill"><Clock size={13} />{failed ? "载入失败 · 保留缓存" : "更新 " + formatStamp(dataChanged, tz)}</span>
            <button className="action" onClick={() => { setLoading(true); setReload(value => value + 1); }} disabled={loading}>
              <RefreshCw size={14} className={loading ? "spin" : ""} />{loading ? "载入中" : "重新载入"}
            </button>
          </div>
        </header>

        {/* VIEW 1: OVERVIEW */}
        {view === "overview" && <>
          <RateCards points={points} />
          <div className="overview-grid">
            <Curve points={points} />
            <FocusList inspect={inspectEvent} tz={tz} now={now} events={upcoming.slice(0, 5)} />
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
            {events.map(event => {
              const display = formatEventClock(event, tz);
              const past = isPastEvent(event, now);
              const official = event.readings?.[0];
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
                      {official && <span className="event-reading">{readingText(official)}</span>}
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
            })}
          </div>) : <p className="empty">{calendar.events.length ? "没有符合筛选条件的事件。" :
            week > current ? "这一周尚无已收录日程。官方日期公布后会自动补入。" : "这周暂无已收录的公开日程。"}</p>}
        </section>}

        {/* VIEW 3: STANDALONE SCENARIOS & HISTORICAL PLAYBOOK LAB */}
        {view === "scenarios" && <div className="scenarios-page">
          <div className="panel glass mode-bar">
            <div className="segmented" role="tablist" aria-label="推演室模式">
              <button type="button" role="tab" aria-selected={scenarioMode === "event"} className={scenarioMode === "event" ? "active" : ""} onClick={() => setScenarioMode("event")}>
                <SlidersHorizontal size={14} />按近期日程试算
              </button>
              <button type="button" role="tab" aria-selected={scenarioMode === "library"} className={scenarioMode === "library" ? "active" : ""} onClick={() => setScenarioMode("library")}>
                <BookOpen size={14} />全指标历史影响手册 (16项)
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
                <ScenarioCalculator
                  key={activeScenario.id}
                  event={activeScenario}
                  allEvents={allEvents}
                  sameTime={allEvents.filter(ev => ev.id !== activeScenario.id && ev.date === activeScenario.date && ev.time && ev.time === activeScenario.time && ev.impact >= 3)}
                />
              </section>

              <section className="panel glass">
                <div className="panel-header">
                  <div>
                    <h2>历史实证与周期分叉 · {playbookFor(activeScenario).name}</h2>
                    <p>基于美国财政部官方日终收益率曲线核对的传导规律与典型案例</p>
                  </div>
                </div>
                <div className="panel-pad"><PlaybookView playbook={playbookFor(activeScenario)} /></div>
              </section>

              <section className="panel glass">
                <div className="panel-header">
                  <div><h2>交易台 6 维微结构清单</h2><p>流动性、电子报价、RFQ 与现券/期货对冲检查项</p></div>
                </div>
                <div className="panel-pad"><MicrostructureGrid kind={activeScenario.kind} /></div>
              </section>
            </> : <section className="panel glass"><p className="empty">当前没有可推演的经济数据、FOMC 或国债拍卖事件。</p></section>
          ) : (
            <section className="panel glass">
              <div className="panel-header">
                <div>
                  <h2>UST 宏观与拍卖历史影响全手册</h2>
                  <p>覆盖核心通胀、就业、增长、FOMC 与各期限拍卖的实证波幅、周期分叉与反向陷阱</p>
                </div>
              </div>
              <div className="library-chips">
                {featuredPlaybookKeys.map(key => {
                  const pb = playbookByKey(key)!;
                  return <button key={key} type="button" className="chip" aria-pressed={libraryKey === key} onClick={() => setLibraryKey(key)}>
                    {pb.name.split("（")[0]}
                  </button>;
                })}
              </div>
              <div className="panel-pad"><PlaybookView playbook={activeLibraryPlaybook} /></div>
            </section>
          )}
        </div>}

        {/* VIEW 4: SEPARATED SOURCES PAGE */}
        {view === "sources" && <section className="panel glass">
          <div className="panel-header">
            <div>
              <h2>官方一级数据来源（{short(week)} – {short(weekEnd)}）</h2>
              <p>工作日 08:07–16:52 ET 每 15 分钟核对近端发布，17:25 / 18:25 ET 补抓日终名义与 TIPS 曲线，周日 18:07 ET 刷新未来八周。</p>
            </div>
            <div className="week-control">
              <button className="icon-button" aria-label="上一周" onClick={() => selectWeek(addDays(week, -7))}><ChevronLeft size={18} /></button>
              <button className="action" onClick={() => selectWeek(current)} disabled={week === current}>本周</button>
              <button className="icon-button" aria-label="下一周" onClick={() => selectWeek(addDays(week, 7))}><ChevronRight size={18} /></button>
            </div>
          </div>
          <div className="source-list">{calendar.sources.map(check => <article key={check.id}>
            <div>
              <SourceLink url={sourceIndex[check.id].url} label={sourceIndex[check.id].name} />
              <p>{sourceIndex[check.id].detail}</p>
            </div>
            <span className={"source-state " + check.state}>{stateText[check.state]}</span>
            <time>{formatStamp(check.checkedAt, tz)}</time>
          </article>)}</div>
          <p className="source-note">财政部名义平价与 TIPS 实际收益率为日终数据。官方自动采集覆盖 CPI、PPI、非农、JOLTS、ECI、PCE（含同比与实际消费）、GDP 及国债拍卖结果（含一级交易商与间接/直接获配占比）。{" "}
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
