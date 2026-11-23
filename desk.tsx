import { useEffect, useMemo, useState } from "react";
import { Activity, ArrowDownUp, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Database,
  ExternalLink, LineChart, RefreshCw, Search, TrendingUp } from "lucide-react";
import { analysis, dimensions } from "./analysis";
import { addDays, categories, impactSort, impactText, isPastEvent, isWeek, newYorkDate, sourceIndex,
  tenors, timeSort, weekOf, type Calendar, type Category, type CurvePoint, type MarketEvent,
  type Reading, type SourceCheck } from "./model";
import { loadCalendars } from "./pages-data";
import { nowcastUrl } from "./releases";
import { actualFor, ruleFor, scenarioFor } from "./scenarios";
import { seedCalendar } from "./seed";

const short = (date: string) => date.slice(5).replace("-", "/");
const sign = (value: number, digits = 1) => (value > 0 ? "+" : "") + value.toFixed(digits);
const when = (stamp: string | null) => stamp ? new Intl.DateTimeFormat("zh-CN", { timeZone: "America/New_York",
  month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(stamp)) + " ET" : "暂无";
const eventTime = (event: MarketEvent) => event.time ?? (event.kind === "holiday" ? "全天" : "时间待定");
const readingText = (reading: Reading) => (reading.unit === "%" ? reading.value.toFixed(1) + "%" : reading.value + " 千人");
const stateText: Record<SourceCheck["state"], string> = { verified: "已核对", cached: "使用缓存", unavailable: "暂缺", reference: "参考" };
const anchors = [
  { id: "overview", title: "利率概览", icon: LineChart },
  { id: "scenarios", title: "情景分析", icon: Activity },
  { id: "calendar", title: "发布日历", icon: CalendarDays },
  { id: "sources", title: "数据来源", icon: Database },
];

function SourceLink({ url, label }: { url: string; label: string }) {
  return <a className="source-link" href={url} target="_blank" rel="noreferrer">{label}<ExternalLink size={13}/></a>;
}

function Curve({ points }: { points: CurvePoint[] }) {
  const latest = points.at(-1);
  const previous = points.at(-2);
  const [focus, setFocus] = useState<number | null>(null);
  const start = latest ? Math.min(...latest.values, ...previous?.values ?? []) - .09 : 0;
  const end = latest ? Math.max(...latest.values, ...previous?.values ?? []) + .09 : 1;
  const x = (index: number) => 37 + 68 * index;
  const y = (value: number) => 135 - 115 * (value - start) / (end - start);
  const path = (point: CurvePoint) => point.values.map((value, index) => x(index) + "," + y(value)).join(" ");
  return <section className="panel curve" aria-labelledby="curve-title">
    <div className="panel-header"><div><h2 id="curve-title">美债收益率曲线</h2><p>{latest ? latest.date + " · 财政部日终平价收益率" : "等待财政部日终数据"}</p></div>
      <SourceLink url={sourceIndex.curve.url} label="财政部" /></div>
    {latest ? <>
      <svg className="curve-chart" viewBox="0 0 480 174" role="img" aria-label="2 年至 30 年官方收益率曲线">
        {[0, 1, 2].map(i => { const value = start + (end - start) * i / 2; return <g key={i}>
          <line x1="37" x2="449" y1={y(value)} y2={y(value)} stroke="#e1e9e1" />
          <text x="31" y={y(value) + 4} textAnchor="end">{value.toFixed(2)}%</text></g>; })}
        {previous && <polyline fill="none" stroke="#a4b5ab" strokeWidth="2" strokeDasharray="4 4" points={path(previous)}/>}
        <polyline fill="none" stroke="#216352" strokeWidth="3" strokeLinejoin="round" points={path(latest)}/>
        {latest.values.map((value, i) => <g key={i} onMouseEnter={() => setFocus(i)} onMouseLeave={() => setFocus(null)}>
          <circle cx={x(i)} cy={y(value)} r={focus === i ? 6 : 4} fill="#216352" stroke="white" strokeWidth="1.5" />
          <circle cx={x(i)} cy={y(value)} r="15" fill="transparent"><title>{tenors[i] + " " + value.toFixed(2) + "%"}</title></circle>
          <text x={x(i)} y="158" textAnchor="middle">{tenors[i]}</text>
          {focus === i && <text x={x(i)} y={y(value) - 10} textAnchor="middle" className="chart-value">{value.toFixed(2)}%</text>}
        </g>)}
      </svg>
      <div className="curve-foot"><span><b>2s10s</b> {sign((latest.values[4] - latest.values[0]) * 100, 0)} bp</span>
        <span><b>5s30s</b> {sign((latest.values[6] - latest.values[2]) * 100, 0)} bp</span>
        {previous && <span className="legend">虚线 {short(previous.date)}</span>}</div>
    </> : <p className="empty">该日期之前暂无可用的曲线数据。</p>}
  </section>;
}

function RateCards({ points }: { points: CurvePoint[] }) {
  const latest = points.at(-1), previous = points.at(-2);
  return <div className="rate-grid" aria-label="主要期限收益率">{[0, 2, 4, 6].map(i => {
    const delta = latest && previous ? Math.round((latest.values[i] - previous.values[i]) * 100) : null;
    return <article className="rate-card" key={i}><span>{tenors[i]} 国债</span><strong>{latest ? latest.values[i].toFixed(2) + "%" : "—"}</strong>
      <small className={delta === null || delta === 0 ? "" : delta > 0 ? "rate-up" : "rate-down"}>{delta === null ? "暂无日变动" : sign(delta, 0) + " bp · 较上一观测日"}</small>
    </article>;
  })}</div>;
}

function FocusList({ events, select }: { events: MarketEvent[]; select: (event: MarketEvent) => void }) {
  return <section className="panel focus-panel"><div className="panel-header"><div><h2>接下来关注</h2><p>已确认的高影响发布 · 纽约时间</p></div><Activity size={20} /></div>
    {events.length ? <ul>{events.map(event => <li key={event.id}><button onClick={() => select(event)}>
      <time>{short(event.date)}<b>{eventTime(event)}</b></time><span><strong>{event.title}</strong>
      <small>{event.reference ? "核心月率模型 " + event.reference.value.toFixed(2) + "%" : event.detail}</small></span><ChevronRight size={16}/>
    </button></li>)}</ul> : <p className="empty">目前暂无已核对的高影响发布。</p>}
  </section>;
}

function LatestReleases({ events, select }: { events: MarketEvent[]; select: (event: MarketEvent) => void }) {
  return <section className="panel latest-panel" aria-labelledby="latest-title">
    <div className="panel-header"><div><h2 id="latest-title">最近公布</h2><p>官方经济数据与拍卖结果 · 纽约时间</p></div></div>
    {events.length ? <div className="latest-grid">{events.map(event => <button key={event.id} onClick={() => select(event)}>
      <time>{short(event.date)} {eventTime(event)}</time><strong>{event.title}</strong>
      <span>{event.readings?.[0] ? event.readings[0].label + " " + readingText(event.readings[0]) : event.actual}</span>
    </button>)}</div> : <p className="empty">尚无已抓取的官方结果。</p>}
  </section>;
}

function EventRow({ event, selectedEvents, expanded, toggle, choose }: { event: MarketEvent; selectedEvents: MarketEvent[];
  expanded: boolean; toggle: () => void; choose: () => void }) {
  const rule = ruleFor(event);
  const collided = selectedEvents.filter(item => item.id !== event.id && item.time && item.time === event.time && item.date === event.date && item.impact >= 3);
  const official = event.readings?.[0];
  return <article id={"event-" + event.id} className={"event-row" + (expanded ? " event-open" : "")}>
    <button className="event-line" type="button" aria-expanded={expanded} onClick={toggle}>
      <span className="event-clock">{eventTime(event)}</span>
      <span className="event-copy"><strong>{event.title}</strong><small>{event.detail}</small></span>
      {official && <span className="event-reading">{readingText(official)}</span>}
      <span className={"tag tag-" + event.category}>{event.status === "tentative" ? "暂定" : categories[event.category]}</span>
      <span className={"impact " + (event.impact >= 4 ? "high" : "")}>{event.impact >= 4 ? "高影响" : impactText(event.impact)}</span>
      <ChevronDown className="event-chevron" size={16} />
    </button>
    {expanded && <div className="event-detail">
      <div className="event-meta"><SourceLink url={event.url} label={sourceIndex[event.source].name.split(" · ")[0]} />
        {event.resultUrl && <SourceLink url={event.resultUrl} label="官方发布原文" />}
        <span>{event.status === "tentative" ? "暂定" : "已确认"}{event.officialDate ? " · 来源更新 " + event.officialDate : ""}</span>
      </div>
      {event.readings?.length ? <div className="reading-grid">{event.readings.map(reading =>
        <div key={reading.label}><span>{reading.label}</span><strong>{readingText(reading)}</strong></div>)}</div> :
        event.actual && <p className="evidence">{event.actual}</p>}
      {collided.length > 0 && <p className="evidence">同一时点还有 {collided.map(item => item.title).join("、")}。</p>}
      <p className="event-context">{analysis[event.kind][0]}</p>
      {rule ? <button type="button" className="action primary" onClick={choose}>分析高于和低于{event.category === "auction" ? " WI" : "预期"}</button> :
        <details className="more-analysis"><summary>查看利率与流动性观察项</summary>
          <dl>{dimensions.slice(1).map((label, i) => <div key={label}><dt>{label}</dt><dd>{analysis[event.kind][i + 1]}</dd></div>)}</dl>
        </details>}
    </div>}
  </article>;
}

function Scenario({ event, sameTime }: { event: MarketEvent; sameTime: MarketEvent[] }) {
  const rule = ruleFor(event)!;
  const official = actualFor(event, rule);
  const [expected, setExpected] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [components, setComponents] = useState("unknown");
  const isAuction = event.category === "auction";
  const useModel = expected.trim() === "" && event.reference?.value !== undefined;
  const expectedValue = expected.trim() === "" ? event.reference?.value : Number(expected);
  const actualValue = hypothesis.trim() === "" ? official : Number(hypothesis);
  const diff = expectedValue !== undefined && actualValue !== undefined && Number.isFinite(expectedValue) && Number.isFinite(actualValue)
    ? Number((actualValue - expectedValue).toFixed(6)) : null;
  const near = diff !== null && (useModel ? Math.abs(diff) < .05 : diff === 0);
  const verdict = diff === null || near ? null : diff > 0 ? "above" : "below";
  const mixed = components === "mixed";
  const confirmed = components === "aligned" && !sameTime.length;
  const comparator = isAuction ? "截标前 WI" : useModel ? "模型" : "预期";
  const positive = isAuction ? "高于 WI" : "高于预期";
  const negative = isAuction ? "低于 WI" : "低于预期";
  const resultLabel = hypothesis ? "假设值" : "官方值";
  const deltaValue = diff === null ? "" : isAuction ? sign(diff * 100, 1) + " bp" : rule.unit === "%" ? sign(diff, 2) + " 个百分点" : sign(diff, 0) + " 千人";
  return <>
    <div className="scenario-inputs">
      <label>{isAuction ? "截标前 WI 收益率" : "市场一致预期（手填）"} <span>{rule.unit}</span>
        <input type="number" step="any" value={expected} onChange={e => setExpected(e.target.value)} placeholder={event.reference ? "默认使用公开模型" : "暂无 · 可填写"} />
      </label>
      <label>假设发布值 <span>{rule.unit}</span>
        <input type="number" step="any" value={hypothesis} onChange={e => setHypothesis(e.target.value)} placeholder={official === undefined ? "填入假设值试算" : "默认官方值 " + official} />
      </label>
      <label>关键分项方向
        <select value={components} onChange={e => setComponents(e.target.value)}><option value="unknown">尚待验证</option>
          <option value="aligned">与主数据一致</option><option value="mixed">与主数据冲突</option></select>
      </label>
    </div>
    <div className="data-trail">
      <span><b>比较指标</b> {rule.metric}</span>
      {official !== undefined && <span><b>官方值</b> {official}{rule.unit === "千人" ? " 千人" : "%"}</span>}
      {event.reference && <span><b>模型参考</b> {event.reference.value.toFixed(2)}% · {event.reference.period} · {event.reference.asOf}
        {" "}<SourceLink url={nowcastUrl} label="Cleveland Fed" /></span>}
    </div>
    {diff !== null && <div className="verdict" aria-live="polite">
      <strong>{resultLabel}减{comparator} {deltaValue}</strong>
      <p>{near ? (useModel ? "差值小于 0.05 个百分点，接近官方月率的公布精度。先看分项。" : "符合输入预期，方向主要看分项、修订及同刻发布。") :
        mixed ? "分项冲突，方向判断降级。先看分项和发布后价格是否延续。" :
        scenarioFor(event, rule, verdict!).direction + (confirmed ? "。分项一致，仍需价格确认。" : "。暂作条件判断，等待分项和价格确认。")}</p>
    </div>}
    <div className="scenario-grid">{(["above", "below"] as const).map(comparison => {
      const scenario = scenarioFor(event, rule, comparison);
      return <article key={comparison} className={verdict === comparison && !mixed ? "matched" : undefined}>
        <span className={"scenario-tag " + comparison}>{comparison === "above" ? positive : negative}</span>
        <h3>{scenario.direction}</h3><p>{scenario.text}</p><p className="scenario-curve">{scenario.curve}</p>
      </article>;
    })}</div>
    <div className="scenario-notes"><div><h3>读数交叉核对</h3><ul>{rule.checks.map(check => <li key={check}>{check}</li>)}</ul></div>
      <div><h3>失效条件</h3><p>{rule.invalidate}</p>
        {sameTime.length > 0 && <p className="co-release">同刻发布 {sameTime.map(item => item.title).join("、")}。单凭本项难以归因。</p>}</div></div>
  </>;
}

export default function Desk() {
  const [now, setNow] = useState(() => new Date());
  const current = weekOf(newYorkDate(now));
  const [week, setWeek] = useState(() => {
    const requested = new URLSearchParams(location.search).get("week");
    return isWeek(requested) ? requested : weekOf(newYorkDate());
  });
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
  const upcoming = allEvents.filter(event => event.status === "confirmed" && event.impact >= 4 && !isPastEvent(event, now));
  const released = allEvents.filter(event => event.impact >= 3 && (event.readings?.length || event.actual) && isPastEvent(event, now));
  const latestReleases = [...released.filter(event => event.category === "macro").slice(-2),
    ...released.filter(event => event.category !== "macro").slice(-2)].sort(timeSort).reverse();
  const scenarioChoices = [...new Map([...calendar.events, ...upcoming.slice(0, 18), ...allEvents.filter(event => event.id === scenarioId)]
    .filter(event => ruleFor(event)).sort(timeSort).map(event => [event.id, event])).values()];
  const scenario = scenarioChoices.find(event => event.id === scenarioId) ?? scenarioChoices.find(event =>
    event.category === "macro" && !isPastEvent(event, now)) ?? scenarioChoices[0];
  const filtered = calendar.events.filter(event => (filter === "all" || event.category === filter)
    && (tentative || event.status === "confirmed") && (event.title + " " + event.detail).toLowerCase().includes(query.trim().toLowerCase()))
    .sort(byImpact ? impactSort : timeSort);
  const groups = byImpact ? [[null, filtered] as const] : [...new Set(filtered.map(event => event.date))].map(date =>
    [date, filtered.filter(event => event.date === date)] as const);
  const lastCovered = allWeeks.filter(value => value.week >= current && value.events.length > 0).at(-1);
  const dataChanged = allWeeks.map(value => value.refreshedAt).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;

  function selectWeek(date: string) {
    if (!isWeek(date)) return;
    setWeek(date); setExpanded(null);
    const url = new URL(location.href);
    url.searchParams.set("week", date);
    history.replaceState(null, "", url);
  }
  function openScenario(event: MarketEvent) {
    setScenarioId(event.id);
    document.getElementById("scenarios")?.scrollIntoView({ behavior: "smooth" });
  }
  function focusEvent(event: MarketEvent) {
    selectWeek(weekOf(event.date));
    setFilter("all"); setQuery(""); setExpanded(event.id);
    requestAnimationFrame(() => {
      document.getElementById("event-" + event.id)?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  }

  return <div className="shell">
    <aside className="sidebar"><a className="brand" href="#overview"><span><TrendingUp size={22}/></span>
      <b>UST Weekly Desk<small>美国国债数据</small></b></a>
      <nav aria-label="页面导航">{anchors.map(({ id, title, icon: Icon }) => <a href={"#" + id} key={id}><Icon size={17}/>{title}</a>)}</nav>
      <div className="sidebar-foot">纽约时间 · ET</div>
    </aside>
    <main className="main">
      <header className="topbar" id="overview">
        <div><h1>美国国债数据周报</h1><p>{points.length ? "收益率观测日 " + points.at(-1)!.date + " · 财政部日终数据" : "收益率、经济数据、国债拍卖和美联储日程"}</p></div>
        <div className="sync"><span>{failed ? "载入失败 · 保留上次可用数据" : "数据包更新 " + when(dataChanged)}</span>
          <button className="action" onClick={() => { setLoading(true); setReload(value => value + 1); }} disabled={loading}><RefreshCw size={15}/>{loading ? "载入中" : "重新载入"}</button></div>
      </header>

      <RateCards points={points}/>
      <div className="overview-grid">
        <Curve points={points}/>
        <FocusList select={focusEvent} events={upcoming.slice(0, 4)}/>
      </div>
      <LatestReleases events={latestReleases} select={focusEvent}/>

      <section className="panel" id="scenarios">
        <div className="panel-header scenarios-header"><div><h2>经济数据与拍卖情景</h2><p>根据意外方向、分项和同刻发布判断利率与曲线。模型估计单独标注。</p></div>
          {scenario && <select aria-label="选择情景事件" value={scenario.id} onChange={event => setScenarioId(event.target.value)}>
            {scenarioChoices.map(event => <option key={event.id} value={event.id}>{short(event.date)} · {event.title}</option>)}</select>}</div>
        {scenario ? <Scenario key={scenario.id} event={scenario} sameTime={allEvents.filter(event => event.id !== scenario.id
          && event.date === scenario.date && event.time && event.time === scenario.time && event.impact >= 3)}/> :
          <p className="empty">选取有经济数据或国债拍卖的一周查看情景。</p>}
      </section>

      <section className="panel calendar" id="calendar">
        <div className="panel-header calendar-header"><div><h2>发布日历</h2><p>{short(week)} – {short(weekEnd)} ET · {calendar.events.filter(event => event.status === "confirmed").length} 项已确认
          {lastCovered && " · 日程收录至 " + addDays(lastCovered.week, 6)}</p></div>
          <div className="week-control"><button className="icon-button" aria-label="上一周" onClick={() => selectWeek(addDays(week, -7))}><ChevronLeft size={18}/></button>
            <input aria-label="选择日期" type="date" value={week} onChange={event => { if (event.target.value) selectWeek(weekOf(event.target.value)); }}/>
            <button className="icon-button" aria-label="下一周" onClick={() => selectWeek(addDays(week, 7))}><ChevronRight size={18}/></button>
            <button className="action" onClick={() => selectWeek(current)} disabled={week === current}>本周</button>
          </div>
        </div>
        <div className="filters">
          <div className="chips">{([["all", "全部"], ...Object.entries(categories)] as [Category | "all", string][]).map(([key, title]) =>
            <button className="chip" type="button" key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{title}</button>)}</div>
          <label className="search"><Search size={16}/><input aria-label="搜索日程" placeholder="搜索本周" value={query} onChange={event => setQuery(event.target.value)}/></label>
          <label className="check"><input type="checkbox" checked={tentative} onChange={event => setTentative(event.target.checked)}/>显示暂定</label>
          <button className="chip" aria-pressed={byImpact} onClick={() => setByImpact(value => !value)}><ArrowDownUp size={14}/>按影响排序</button>
        </div>
        {filtered.length ? groups.map(([date, events]) => <div key={date ?? "rank"}>
          {date && <div className="day"><b>{new Intl.DateTimeFormat("zh-CN", { weekday: "long", timeZone: "UTC" }).format(new Date(date + "T12:00:00Z"))} {short(date)}</b><span>{events.length} 项</span></div>}
          {events.map(event => <EventRow key={event.id} event={event} selectedEvents={calendar.events} expanded={event.id === expanded}
            toggle={() => setExpanded(expanded === event.id ? null : event.id)} choose={() => openScenario(event)}/>)}
        </div>) : <p className="empty">{calendar.events.length ? "没有符合筛选条件的事件。" :
          week > current ? "这一周尚无已收录日程。官方日期公布后会自动补入。" : "这周暂无已收录的公开日程。"}</p>}
      </section>

      <section className="panel" id="sources">
        <div className="panel-header"><div><h2>数据来源与更新频率</h2>
          <p>工作日 08:07–16:52 ET 每 15 分钟尝试核对近端发布，周日补查未来八周。GitHub 排程和官方发布均可能延迟。</p></div></div>
        <div className="source-list">{calendar.sources.map(check => <article key={check.id}>
          <div><SourceLink url={sourceIndex[check.id].url} label={sourceIndex[check.id].name}/><p>{sourceIndex[check.id].detail}</p></div>
          <span className={"source-state " + check.state}>{stateText[check.state]}</span><time>{when(check.checkedAt)}</time>
        </article>)}</div>
        <p className="source-note">财政部收益率为日终数据。实时可成交报价和市场一致预期需要独立行情源。官方实际值抓取目前覆盖 CPI、PPI、非农、PCE、GDP 和已公告拍卖。{" "}
          <SourceLink url={nowcastUrl} label="Cleveland Fed 通胀模型" /></p>
      </section>
      <footer>UST Weekly Desk · 所有日程使用纽约时间</footer>
    </main>
  </div>;
}
