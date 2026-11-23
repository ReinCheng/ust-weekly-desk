import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, ArrowDownUp, BarChart3, CalendarDays, ChevronDown, ChevronLeft, ChevronRight,
  Clock, Database, ExternalLink, Globe, LineChart, Moon, RefreshCw, RotateCcw, Search,
  Sparkles, Sun, TrendingUp,
} from "lucide-react";
import { analysis, dimensions, scenariosFor } from "./analysis";
import {
  addDays, categories, curveValue, formatEventClock, impactSort, impactText, isPastEvent,
  isWeek, legacyTenors, newYorkDate, newYorkInstant, realCurveValue, sourceIndex, tenors,
  timeSort, tzIana, tzLabel, tzShortTag, weekOf, type Calendar, type Category, type CurvePoint,
  type MarketEvent, type Reading, type SourceCheck, type Tenor, type TzMode,
} from "./model";
import { loadCalendars } from "./pages-data";
import { nowcastUrl } from "./releases";
import { actualFor, priorFor, ruleFor, scenarioFor } from "./scenarios";
import { seedCalendar } from "./seed";

type ThemeMode = "light" | "dark";
type CurveMode = "curve" | "change";
type BenchMode = "1D" | "1W" | "1M";
type SavedScenarioInput = { expected?: string; hypothesis?: string; components?: string; stance?: string };

const STORAGE_THEME = "ust-desk-theme";
const STORAGE_TZ = "ust-desk-tz";
const STORAGE_SCENARIOS = "ust-desk-scenarios-v1";

const short = (date: string) => date.slice(5).replace("-", "/");
const sign = (value: number, digits = 1) => (value > 0 ? "+" : "") + value.toFixed(digits);

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
  const days = Math.floor(hours / 24);
  return days + "天后";
}

function pickBenchmark(points: CurvePoint[], bench: BenchMode): CurvePoint | undefined {
  if (points.length < 2) return undefined;
  const latest = points.at(-1)!;
  if (bench === "1D") return points.at(-2);
  const shiftDays = bench === "1W" ? -7 : -30;
  const target = addDays(latest.date, shiftDays);
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
    // ignore storage quota / privacy mode errors
  }
}

const stateText: Record<SourceCheck["state"], string> = {
  verified: "已核对",
  cached: "使用缓存",
  unavailable: "暂缺",
  reference: "参考",
  unscheduled: "官网未排期",
};

const anchors = [
  { id: "overview", title: "利率概览", icon: LineChart },
  { id: "scenarios", title: "情景分析", icon: Activity },
  { id: "calendar", title: "发布日历", icon: CalendarDays },
  { id: "sources", title: "数据来源", icon: Database },
];

function SourceLink({ url, label }: { url: string; label: string }) {
  return <a className="source-link" href={url} target="_blank" rel="noreferrer">{label}<ExternalLink size={12.5} /></a>;
}

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
            <button key={b} type="button" className={bench === b ? "active" : ""} onClick={() => setBench(b)} disabled={points.length < 2}>
              {b}
            </button>
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

  const y3m = curveValue(latest, "3M");
  const y2 = curveValue(latest, "2Y");
  const y5 = curveValue(latest, "5Y");
  const y10 = curveValue(latest, "10Y");
  const y20 = curveValue(latest, "20Y");
  const y30 = curveValue(latest, "30Y");
  const r10 = realCurveValue(latest, "10Y");
  const be10 = y10 !== undefined && r10 !== undefined ? y10 - r10 : undefined;

  const p3m = curveValue(prev1d, "3M");
  const p2 = curveValue(prev1d, "2Y");
  const p5 = curveValue(prev1d, "5Y");
  const p10 = curveValue(prev1d, "10Y");
  const p20 = curveValue(prev1d, "20Y");
  const p30 = curveValue(prev1d, "30Y");
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
        const d1 = val !== undefined && curveValue(prev1d, tenor) !== undefined
          ? Math.round((val - curveValue(prev1d, tenor)!) * 100) : null;
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

function FocusList({ events, tz, now, select }: { events: MarketEvent[]; tz: TzMode; now: Date; select: (event: MarketEvent) => void }) {
  return <section className="panel glass focus-panel">
    <div className="panel-header">
      <div><h2>接下来关注</h2><p>已确认的高影响发布 · {tzLabel(tz)}</p></div>
      <span className="header-icon"><Activity size={18} /></span>
    </div>
    {events.length ? <ul>{events.map(event => {
      const display = formatEventClock(event, tz);
      return <li key={event.id}><button onClick={() => select(event)}>
        <time>
          {short(display.date)}
          <b>{display.clock}</b>
        </time>
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

function LatestReleases({ events, tz, select }: { events: MarketEvent[]; tz: TzMode; select: (event: MarketEvent) => void }) {
  return <section className="panel glass latest-panel" aria-labelledby="latest-title">
    <div className="panel-header">
      <div><h2 id="latest-title">最近公布</h2><p>官方经济数据与国债拍卖结果 · {tzLabel(tz)}</p></div>
    </div>
    {events.length ? <div className="latest-grid">{events.map(event => {
      const display = formatEventClock(event, tz);
      const primary = event.readings?.[0];
      const secondary = event.readings?.slice(1, 3) ?? [];
      return <button className="latest-card" key={event.id} onClick={() => select(event)}>
        <time>{short(display.date)} {display.clock}</time>
        <strong>{event.title}</strong>
        <span className="latest-primary">{primary ? primary.label + " " + readingText(primary) : event.actual}</span>
        {secondary.length > 0 && <small className="latest-sub">{secondary.map(r => r.label.replace(/月率|季率|同比/, m => m) + " " + readingText(r)).join(" · ")}</small>}
      </button>;
    })}</div> : <p className="empty">尚无已抓取的官方结果。</p>}
  </section>;
}

function MicrostructureDrawer({ kind, openLabel = "查看利率交易台 6 维微结构观察" }: { kind: MarketEvent["kind"]; openLabel?: string }) {
  return <details className="more-analysis">
    <summary>{openLabel}</summary>
    <dl>{dimensions.slice(1).map((label, i) => <div key={label}><dt>{label}</dt><dd>{analysis[kind][i + 1]}</dd></div>)}</dl>
  </details>;
}

function EventRow({ event, selectedEvents, tz, now, expanded, toggle, choose }: {
  event: MarketEvent; selectedEvents: MarketEvent[]; tz: TzMode; now: Date;
  expanded: boolean; toggle: () => void; choose: () => void;
}) {
  const rule = ruleFor(event);
  const past = isPastEvent(event, now);
  const display = formatEventClock(event, tz);
  const collided = selectedEvents.filter(item => item.id !== event.id && item.time && item.time === event.time && item.date === event.date && item.impact >= 3);
  const official = event.readings?.[0];
  const secondaryBtc = event.category === "auction" ? event.readings?.find(r => r.label === "投标倍数") : undefined;
  const tagText = event.status === "tentative" ? categories[event.category] + " · 暂定" : categories[event.category];
  const impactLevel = event.impact >= 4 ? "high" : event.impact >= 3 ? "mid" : "low";

  return <article id={"event-" + event.id} className={"event-row impact-bar-" + impactLevel + (expanded ? " event-open" : "") + (past ? " event-past" : "")}>
    <button className="event-line" type="button" aria-expanded={expanded} onClick={toggle}>
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
      <ChevronDown className="event-chevron" size={16} />
    </button>
    {expanded && <div className="event-detail">
      <div className="event-meta">
        <SourceLink url={event.url} label={sourceIndex[event.source].name.split(" · ")[0]} />
        {event.resultUrl && <SourceLink url={event.resultUrl} label="官方发布原文" />}
        <span>{event.status === "tentative" ? "暂定" : "已确认"}{event.officialDate ? " · 来源更新 " + event.officialDate : ""}</span>
        {tz !== "ET" && event.time && <span>纽约原时 {short(event.date)} {event.time} ET</span>}
      </div>
      {event.readings?.length ? <div className="reading-grid">{event.readings.map(reading =>
        <div key={reading.label}><span>{reading.label}</span><strong>{readingText(reading)}</strong></div>)}</div> :
        event.actual && <p className="evidence">{event.actual}</p>}
      {collided.length > 0 && <p className="evidence warn-note">同刻发布冲突：{collided.map(item => item.title).join("、")}。</p>}
      <p className="event-context">{analysis[event.kind][0]}</p>
      <div className="event-actions">
        {rule && <button type="button" className="action primary" onClick={choose}>
          {rule.qualitative ? "打开鹰/鸽情景推演" : "分析高于和低于" + (event.category === "auction" ? " WI" : "预期")}
        </button>}
      </div>
      <MicrostructureDrawer kind={event.kind} />
    </div>}
  </article>;
}

function Scenario({ event, sameTime, allEvents }: { event: MarketEvent; sameTime: MarketEvent[]; allEvents: MarketEvent[] }) {
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

  return <>
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
          <button type="button" className="action" onClick={resetInputs} disabled={!hasCustomInput}><RotateCcw size={14} />清空试算</button>
        </div>
      </div>
    ) : (
      <div className="scenario-inputs">
        <label>{isAuction ? "截标前 WI 收益率" : "市场一致预期（自动保存）"} <span>{rule.unit}</span>
          <input type="number" step="any" value={expected} onChange={e => setExpected(e.target.value)}
            placeholder={event.reference ? "默认模型 " + event.reference.value.toFixed(2) : "填入一致预期"} />
        </label>
        <label>假设发布值 <span>{rule.unit}</span>
          <input type="number" step="any" value={hypothesis} onChange={e => setHypothesis(e.target.value)}
            placeholder={official === undefined ? "填入假设值试算" : "默认官方值 " + official} />
        </label>
        <label>关键分项方向
          <div className="select-with-reset">
            <select value={components} onChange={e => setComponents(e.target.value)}>
              <option value="unknown">尚待验证</option>
              <option value="aligned">与主数据一致</option>
              <option value="mixed">与主数据冲突</option>
            </select>
            {hasCustomInput && <button type="button" className="icon-button" title="清空当前事件试算" aria-label="清空当前事件试算" onClick={resetInputs}>
              <RotateCcw size={15} />
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
      {event.reference && <span><b>模型参考</b> {event.reference.value.toFixed(2)}% · {event.reference.period} · {event.reference.asOf}{" "}
        <SourceLink url={nowcastUrl} label="Cleveland Fed" /></span>}
    </div>

    {(diff !== null || (isQual && verdict !== null)) && <div className="verdict" aria-live="polite">
      <div className="verdict-head">
        <strong>{isQual ? (verdict === "above" ? positive : negative) : `${resultLabel}减${comparator} ${deltaValue}`}</strong>
        {magnitude && <em className={"mag-pill " + (near ? "mag-near" : absDiff >= bigBand ? "mag-big" : "mag-mid")}>{magnitude}</em>}
      </div>
      <p>{near ? (useModel ? "差值小于 0.05 个百分点，接近官方月率精度。优先看分项与初动延续性。" : "处于噪音/符合预期区间，利率方向主要看分项、前值修订及同刻发布。") :
        mixed ? "分项或沟通出现冲突，方向判断降级。先观察发布后 15–30 分钟价格是否延续。" :
        scenarioFor(event, rule, verdict!).direction + (confirmed ? "。分项一致，仍需盘口成交确认。" : "。暂作条件判断，等待分项与价格确认。")}</p>
    </div>}

    <div className="scenario-grid">{(["above", "below"] as const).map(comparison => {
      const scenario = scenarioFor(event, rule, comparison);
      return <article key={comparison} className={verdict === comparison && !mixed ? "matched" : undefined}>
        <span className={"scenario-tag dir-" + scenario.yieldDir}>{comparison === "above" ? positive : negative}</span>
        <h3>{scenario.direction}</h3>
        <p>{scenario.text}</p>
        <p className="scenario-curve">{scenario.curve}</p>
      </article>;
    })}</div>

    <div className="scenario-notes">
      <div><h3>读数交叉核对</h3><ul>{rule.checks.map(check => <li key={check}>{check}</li>)}</ul></div>
      <div>
        <h3>失效条件</h3>
        <p>{rule.invalidate}</p>
        {sameTime.length > 0 && <p className="co-release">同刻发布：{sameTime.map(item => item.title).join("、")}。单凭本项难以独立归因。</p>}
      </div>
    </div>

    <div className="scenario-micro">
      <MicrostructureDrawer kind={event.kind} openLabel="展开利率交易台 6 维微结构与对冲清单" />
    </div>
  </>;
}

export default function Desk() {
  const [now, setNow] = useState(() => new Date());
  const current = weekOf(newYorkDate(now));
  const todayNy = newYorkDate(now);
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
  const [activeNav, setActiveNav] = useState("overview");
  const [calendars, setCalendars] = useState<Record<string, Calendar>>({});
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [filter, setFilter] = useState<Category | "all">("all");
  const [query, setQuery] = useState("");
  const [tentative, setTentative] = useState(true);
  const [byImpact, setByImpact] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const pendingScrollId = useRef<string | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(STORAGE_THEME, theme); } catch { /* ignore */ }
  }, [theme]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_TZ, tz); } catch { /* ignore */ }
  }, [tz]);

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

  useEffect(() => {
    const sections = anchors.map(a => document.getElementById(a.id)).filter((el): el is HTMLElement => Boolean(el));
    if (!sections.length || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => {
      const visible = entries.filter(e => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) setActiveNav(visible.target.id);
    }, { rootMargin: "-18% 0px -62% 0px", threshold: [0.05, 0.25, 0.5] });
    sections.forEach(sec => observer.observe(sec));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!pendingScrollId.current) return;
    const target = document.getElementById("event-" + pendingScrollId.current);
    if (target) {
      pendingScrollId.current = null;
      target.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, [week, expanded, filter, tentative]);

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
    ...allEvents.filter(event => event.id === scenarioId),
  ].filter(event => ruleFor(event)).sort(timeSort).map(event => [event.id, event])).values()], [calendar.events, upcoming, allEvents, scenarioId]);

  const scenario = scenarioChoices.find(event => event.id === scenarioId)
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

  function selectWeek(date: string) {
    if (!isWeek(date)) return;
    setWeek(date);
    setExpanded(null);
    const url = new URL(location.href);
    url.searchParams.set("week", date);
    history.replaceState(null, "", url);
  }
  function openScenario(event: MarketEvent) {
    setScenarioId(event.id);
    document.getElementById("scenarios")?.scrollIntoView({ behavior: "smooth" });
  }
  function focusEvent(event: MarketEvent) {
    pendingScrollId.current = event.id;
    selectWeek(weekOf(event.date));
    setFilter("all");
    setQuery("");
    if (event.status === "tentative") setTentative(true);
    setExpanded(event.id);
  }

  return <>
    <div className="ambient-mesh" aria-hidden="true">
      <span className="orb orb-1" />
      <span className="orb orb-2" />
      <span className="orb orb-3" />
    </div>
    <div className="shell">
      <aside className="sidebar glass-rail">
        <div className="sidebar-top">
          <a className="brand" href="#overview">
            <span className="brand-badge"><TrendingUp size={20} /></span>
            <b>UST Weekly Desk<small>美债宏观与利率台</small></b>
          </a>
          <button type="button" className="icon-button mobile-theme-btn" aria-label="切换明暗液态玻璃"
            onClick={() => setTheme(t => t === "light" ? "dark" : "light")}>
            {theme === "light" ? <Moon size={15} /> : <Sun size={15} />}
          </button>
        </div>

        <nav aria-label="页面导航">
          {anchors.map(({ id, title, icon: Icon }) => (
            <a href={"#" + id} key={id} className={activeNav === id ? "active" : ""}>
              <Icon size={16} />{title}
            </a>
          ))}
        </nav>

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
        <header className="topbar" id="overview">
          <div>
            <div className="eyebrow">
              <Sparkles size={13} />
              <span>US TREASURY MACRO &amp; RATES DESK</span>
              {week !== current && <button type="button" className="history-pill" onClick={() => selectWeek(current)}>
                查看周次 {short(week)}–{short(weekEnd)} · 返回本周
              </button>}
            </div>
            <h1>美国国债数据周报</h1>
            <p>{points.length ? "收益率观测日 " + points.at(-1)!.date + " · 财政部日终名义与 TIPS 实际曲线" : "收益率、经济数据、国债拍卖和美联储日程"}</p>
          </div>
          <div className="sync">
            <span className="sync-pill"><Clock size={13} />{failed ? "载入失败 · 保留缓存" : "更新 " + formatStamp(dataChanged, tz)}</span>
            <button className="action" onClick={() => { setLoading(true); setReload(value => value + 1); }} disabled={loading}>
              <RefreshCw size={14} className={loading ? "spin" : ""} />{loading ? "载入中" : "重新载入"}
            </button>
          </div>
        </header>

        <RateCards points={points} />
        <div className="overview-grid">
          <Curve points={points} />
          <FocusList select={focusEvent} tz={tz} now={now} events={upcoming.slice(0, 4)} />
        </div>
        <LatestReleases events={latestReleases} tz={tz} select={focusEvent} />

        <section className="panel glass" id="scenarios">
          <div className="panel-header scenarios-header">
            <div>
              <h2>经济数据、FOMC 与拍卖情景</h2>
              <p>按意外幅度、分项一致性与同刻发布判断利率与曲线；输入自动保存于本地浏览器。</p>
            </div>
            {scenario && <select aria-label="选择情景事件" value={scenario.id} onChange={event => setScenarioId(event.target.value)}>
              {scenarioChoices.map(event => <option key={event.id} value={event.id}>{short(event.date)} · {event.title}</option>)}
            </select>}
          </div>
          {weeklyPlaybooks.length > 0 && <div className="playbook-strip">
            {weeklyPlaybooks.map(pb => <div className="playbook-card" key={pb.id}>
              <strong>本周结构提示 · {pb.title}</strong>
              <p>{pb.detail} <span>触发：{pb.trigger}</span></p>
            </div>)}
          </div>}
          {scenario ? <Scenario key={scenario.id} event={scenario} allEvents={allEvents} sameTime={allEvents.filter(event => event.id !== scenario.id
            && event.date === scenario.date && event.time && event.time === scenario.time && event.impact >= 3)} /> :
            <p className="empty">选取有经济数据、FOMC 或国债拍卖的一周查看情景。</p>}
        </section>

        <section className="panel glass calendar" id="calendar">
          <div className="panel-header calendar-header">
            <div>
              <h2>发布日历</h2>
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
            {events.map(event => <EventRow key={event.id} event={event} selectedEvents={calendar.events} tz={tz} now={now}
              expanded={event.id === expanded}
              toggle={() => setExpanded(expanded === event.id ? null : event.id)}
              choose={() => openScenario(event)} />)}
          </div>) : <p className="empty">{calendar.events.length ? "没有符合筛选条件的事件。" :
            week > current ? "这一周尚无已收录日程。官方日期公布后会自动补入。" : "这周暂无已收录的公开日程。"}</p>}
        </section>

        <section className="panel glass" id="sources">
          <div className="panel-header">
            <div>
              <h2>数据来源与更新频率</h2>
              <p>工作日 08:07–16:52 ET 每 15 分钟核对近端发布，17:25 / 18:25 ET 补抓日终收益率曲线，周日 18:07 ET 刷新未来八周。</p>
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
          <p className="source-note">财政部名义平价与 TIPS 实际收益率为日终数据。官方自动采集覆盖 CPI、PPI、非农、JOLTS、ECI、PCE、GDP 及国债拍卖结果（含一级交易商与间接/直接获配占比）。{" "}
            <SourceLink url={nowcastUrl} label="Cleveland Fed 通胀模型" /></p>
        </section>

        <footer>UST Weekly Desk · 原始日程按纽约时间校准 · 当前按 {tzLabel(tz)} 展示</footer>
      </main>
    </div>
  </>;
}
