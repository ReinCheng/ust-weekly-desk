"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  Activity, ArrowDownUp, ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpRight, Bell, Bookmark, CalendarDays,
  Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, ClipboardList, Clock3, Database, FileText, Flag,
  Layers3, LineChart, ListFilter, Menu, Plus, RefreshCw, Search, Star, TrendingUp, X,
} from "lucide-react";
import { analysis, dimensions, scenariosFor } from "./analysis";
import {
  addDays, categories, impactSort, impactText, isPastEvent, isWeek, newYorkDate, sourceIndex,
  tenors, timeSort, weekNumber, type Calendar, type Category, type DeskItem, type MarketEvent, type Scenario,
  type Version, type VersionSummary,
} from "./model";
import { seedCalendar } from "./seed";
import { loadCalendar, editDeskItem, readDesk, readVersion, saveVersion } from "./pages-data";

type View = "outlook" | "review" | "archive" | "sources";
type Filter = "all" | Category | "starred";
type Status = "schedule" | "tentative" | "scenarios";
const weekDays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const nav = [
  { id: "outlook", label: "周度前瞻", icon: CalendarDays },
  { id: "review", label: "交易复盘", icon: FileText },
  { id: "archive", label: "周度归档", icon: Layers3 },
  { id: "sources", label: "数据来源", icon: Database },
] as const;
const categoryIcons = { macro: Activity, auction: Layers3, fed: Bell, market: Clock3 };
const filters = [
  { id: "all", text: "全部" }, { id: "macro", text: "经济数据" }, { id: "auction", text: "国债拍卖" },
  { id: "fed", text: "美联储" }, { id: "market", text: "交易时段" }, { id: "starred", text: "我的重点" },
] as const;
const reviews = [
  { id: "summary", title: "本周复盘", placeholder: "记录本周主要冲击、方向判断和需要带到下周的问题" },
  { id: "yields", title: "收益率与长端", placeholder: "2s10s、10s30s、20Y fly，区分政策、供给与期限溢价" },
  { id: "liquidity", title: "流动性与电子报价", placeholder: "OTR 深度、价差、quote age、mid 偏差与恢复时间" },
  { id: "execution", title: "RFQ 与执行", placeholder: "outright / switch、win rate、wiretime、markout，以及 passive 与 aggressive 的成本" },
  { id: "hedging", title: "现券与期货对冲", placeholder: "key-rate DV01、CTD/CF、cash–futures basis 和对冲残差" },
];

function dateShort(date: string) { return date.slice(5).replace("-", "/"); }
function periodText(week: string) { return dateShort(week) + " – " + dateShort(addDays(week, 6)); }
function dayIndex(date: string) { return (new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7; }
function dayText(date: string) { return weekDays[dayIndex(date)] + " " + dateShort(date); }
function humanTime(value: string | null) {
  if (!value) return "—";
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const part = (key: string) => parts.find(item => item.type === key)?.value ?? "";
  return part("month") + "/" + part("day") + " " + part("hour") + ":" + part("minute") + " ET";
}
function eventClock(event: MarketEvent) { return event.time ?? (event.kind === "holiday" || (event.source === "cme" && event.status === "confirmed") ? "全天" : "时间待定"); }
function sourceTitle(event: MarketEvent) { return sourceIndex[event.source].name.split(" · ")[0]; }
function eventHash(week: string, view: View) { return "?week=" + week + (view === "outlook" ? "" : "#" + view); }
const panel = (name: string) => nav.some(item => item.id === name) ? name as View : "outlook";

function Impact({ score }: { score: number }) {
  return <span className={"impact impact-" + (score >= 4 ? "high" : score >= 3 ? "medium" : "low")}><i />{impactText(score)}</span>;
}
function CategoryTag({ category }: { category: Category }) {
  const Icon = categoryIcons[category];
  return <span className={"category category-" + category}><Icon size={13} />{categories[category]}</span>;
}
function AnalysisGrid({ kind, saved }: { kind: MarketEvent["kind"]; saved?: string[] }) {
  return <dl className="analysis-grid">{dimensions.map((dimension, i) => (
    <div key={dimension}><dt>{dimension}</dt><dd>{(saved ?? analysis[kind])[i]}</dd></div>
  ))}</dl>;
}
function SourceLink({ href, children }: { href: string; children: ReactNode }) {
  return <a className="source-link" href={href} target="_blank" rel="noreferrer">{children}<ArrowUpRight size={14} /></a>;
}
function Empty({ icon = <CalendarDays size={23} />, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return <div className="empty"><div className="empty-icon">{icon}</div><strong>{title}</strong>{children && <p>{children}</p>}</div>;
}

function WeekCurve({ calendar, full = false }: { calendar: Calendar; full?: boolean }) {
  const history = calendar.curve.filter(point => point.date < calendar.week);
  const during = calendar.curve.filter(point => point.date >= calendar.week);
  const point = during.at(-1) ?? history.at(-1);
  const baseline = history.at(-1);
  const [selected, setSelected] = useState<number | null>(null);
  const focus = selected ?? 4;
  const width = 340;
  const height = 132;
  const left = 15;
  const right = 13;
  const top = 14;
  const bottom = 25;
  if (!point) return <div className="surface curve-panel">
    <div className="panel-head"><div><h2>收益率曲线</h2><p>美国财政部日度平价收益率</p></div><LineChart size={18} /></div>
    <Empty title="暂无本周曲线" icon={<LineChart size={22} />}>公开日度数据发布后可在此查看。</Empty>
    <div className="curve-footer"><SourceLink href={sourceIndex.curve.url}>美国财政部</SourceLink></div>
  </div>;
  const all = [...point.values, ...(baseline?.values ?? [])];
  const min = Math.min(...all) - 0.07;
  const max = Math.max(...all) + 0.08;
  const x = (i: number) => left + i * (width - left - right) / (tenors.length - 1);
  const y = (n: number) => top + (max - n) / (max - min) * (height - bottom - top);
  const line = (arr: number[]) => arr.map((value, i) => (i === 0 ? "M" : "L") + x(i) + "," + y(value)).join(" ");
  const area = line(point.values) + " L" + x(6) + "," + (height - bottom) + " L" + x(0) + "," + (height - bottom) + " Z";
  const delta = baseline && baseline.date !== point.date ? Math.round((point.values[focus] - baseline.values[focus]) * 100) : null;
  const spread = Math.round((point.values[4] - point.values[0]) * 100);
  const curveSource = calendar.sources.find(source => source.id === "curve");
  return <section className={"surface curve-panel" + (full ? " curve-full" : "")} aria-label="美国国债收益率曲线">
    <div className="panel-head"><div><h2>收益率曲线</h2><p>{during.length ? "本周最新公开收盘" : "上周收盘参考"} · {dateShort(point.date)} ET</p></div><LineChart size={18} /></div>
    <div className="curve-metrics">
      <div><span>{tenors[focus]} PAR YIELD</span><strong>{point.values[focus].toFixed(2)}<small>%</small></strong></div>
      <div className="curve-delta">{delta === null ? <span>2s10s {spread} bp</span> : <><b>{delta > 0 ? "+" : ""}{delta} bp</b><span>较上周末</span></>}</div>
    </div>
    <div className="curve-plot">
      <svg viewBox={"0 0 " + width + " " + height} role="img" aria-label={tenors.map((tenor, i) => tenor + " " + point.values[i].toFixed(2) + "%").join("，")}>
        <defs><linearGradient id={full ? "area-full" : "area-side"} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#abc38d" stopOpacity=".49" /><stop offset="1" stopColor="#abc38d" stopOpacity="0" /></linearGradient></defs>
        {[0, 1, 2, 3].map(i => <line key={i} x1={left} x2={width - right} y1={top + i * (height - bottom - top) / 3} y2={top + i * (height - bottom - top) / 3} stroke="#e4eae1" strokeDasharray="3 4" />)}
        <path d={area} fill={"url(#" + (full ? "area-full" : "area-side") + ")"} />
        {baseline && baseline.date !== point.date && <path d={line(baseline.values)} stroke="#a6ab9c" strokeDasharray="4 4" strokeWidth="1.4" fill="none" />}
        <path d={line(point.values)} stroke="#276247" strokeWidth="2.2" fill="none" strokeLinejoin="round" />
        {tenors.map((tenor, i) => <g key={tenor} onMouseEnter={() => setSelected(i)} onClick={() => setSelected(i)}>
          <title>{tenor + " " + point.values[i].toFixed(2) + "%"}</title>
          <circle cx={x(i)} cy={y(point.values[i])} r={i === focus ? 5 : 2.8} fill={i === focus ? "#d9eaa6" : "#276247"} stroke="#276247" strokeWidth={i === focus ? 1.6 : 1} />
          <rect x={x(i) - 13} y={0} width="26" height={height} fill="transparent" />
          <text x={x(i)} y={height - 4} textAnchor="middle" className="chart-axis">{tenor}</text>
        </g>)}
      </svg>
      <div className="chart-buttons" aria-label="选择期限">{tenors.map((tenor, i) => <button key={tenor} type="button" aria-label={tenor + " " + point.values[i].toFixed(2) + "%"} aria-pressed={focus === i} onFocus={() => setSelected(i)} onClick={() => setSelected(i)}>{tenor}</button>)}</div>
    </div>
    {full && <div className="curve-review-grid">
      <div><span>2s10s</span><strong>{spread} bp</strong></div>
      <div><span>10s30s</span><strong>{Math.round((point.values[6] - point.values[4]) * 100)} bp</strong></div>
      <div><span>20s30s</span><strong>{Math.round((point.values[6] - point.values[5]) * 100)} bp</strong></div>
      <div><span>10/20/30 fly</span><strong>{Math.round((2 * point.values[5] - point.values[4] - point.values[6]) * 100)} bp</strong></div>
    </div>}
    <div className="curve-footer"><SourceLink href={sourceIndex.curve.url}>美国财政部</SourceLink><span>核对 {humanTime(curveSource?.checkedAt ?? null)}</span></div>
  </section>;
}

function EventRow({ event, calendar, star, open, toggleOpen, toggleStar, addTask, addNote, readOnly, saved }: {
  event: MarketEvent; calendar: Calendar; star: boolean; open: boolean; toggleOpen: () => void;
  toggleStar: () => void; addTask: () => void; addNote: () => void; readOnly: boolean; saved?: string[];
}) {
  const check = calendar.sources.find(item => item.id === event.source);
  return <article className={"event-row" + (open ? " event-open" : "")} id={"event-" + event.id}>
    <div className="event-line">
      <button type="button" className="event-main" onClick={toggleOpen} aria-expanded={open} aria-label={event.title + (open ? " 收起影响分析" : " 展开影响分析")}>
        <span className="event-clock">{eventClock(event)}</span>
        <span className="event-text"><strong>{event.title}</strong><small>{event.detail}</small></span>
        <span className="event-category"><CategoryTag category={event.category} /></span>
        <span className="event-impact"><Impact score={event.impact} /></span>
        <ChevronDown className="event-chevron" size={17} />
      </button>
      <button type="button" disabled={readOnly} className={"icon-button event-star" + (star ? " starred" : "")} onClick={toggleStar}
        aria-label={star ? "取消重点 " + event.title : "标记重点 " + event.title} aria-pressed={star}><Star size={17} fill={star ? "currentColor" : "none"} /></button>
    </div>
    {open && <div className="event-detail">
      <div className="event-detail-meta">
        <span className={event.status === "tentative" ? "state-pill state-tentative" : "state-pill"}>{event.status === "tentative" ? "暂定 / 待核对" : "已确认日程"}</span>
        <SourceLink href={event.url}>{sourceTitle(event)}</SourceLink>
        {event.officialDate && <span>来源更新 {event.officialDate}</span>}
        <span>站点核对 {humanTime(check?.checkedAt ?? null)}</span>
      </div>
      <p className="event-full-detail">{event.detail}</p>
      {event.actual && <div className="official-result"><Check size={16} /><span><b>官方结果</b> {event.actual}</span>{event.resultUrl && <SourceLink href={event.resultUrl}>发布原文</SourceLink>}</div>}
      <div className="analysis-label"><TrendingUp size={15} /> 条件性交易影响</div>
      <AnalysisGrid kind={event.kind} saved={saved} />
      {!readOnly && <div className="detail-actions"><button className="button button-soft" onClick={addTask}><Plus size={15} />待确认事项</button>
        <button className="button button-soft" onClick={addNote}><FileText size={15} />事件复盘备注</button></div>}
    </div>}
  </article>;
}

function Dialog({ title, detail, close, children }: { title: string; detail?: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="dialog" onCancel={close} onClick={event => { if (event.target === ref.current) close(); }}>
    <div className="dialog-head"><div><h2>{title}</h2>{detail && <p>{detail}</p>}</div><button type="button" className="icon-button" onClick={close} aria-label="关闭"><X size={19} /></button></div>
    {children}
  </dialog>;
}

export default function Desk({ initial, currentWeek, renderedAt }: { initial: Calendar; currentWeek: string; renderedAt: string }) {
  const [week, setWeek] = useState(initial.week);
  const [calendar, setCalendar] = useState(initial);
  const [items, setItems] = useState<DeskItem[]>([]);
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [version, setVersion] = useState<Version | null>(null);
  const [view, setView] = useState<View>("outlook");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [status, setStatus] = useState<Status>("schedule");
  const [sort, setSort] = useState<"time" | "impact">("time");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [scenarioOpen, setScenarioOpen] = useState<string | null>(null);
  const [task, setTask] = useState("");
  const [form, setForm] = useState<{ type: "snapshot" | "task" | "note" | "week"; event?: MarketEvent; value: string } | null>(null);
  const [working, setWorking] = useState(false);
  const [refreshingWeek, setRefreshingWeek] = useState<string | null>(null);
  const [deskState, setDeskState] = useState<"loading" | "ready" | "error">("loading");
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const currentRef = useRef(week);
  const locks = useRef(new Set<string>());
  const requestCounter = useRef(0);
  const versionRequest = useRef(0);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const shown = version?.calendar ?? calendar;
  const records = version?.items ?? items;
  const stars = useMemo(() => new Set(records.filter(item => item.kind === "star").map(item => item.id)), [records]);
  const tasks = records.filter(item => item.kind === "task");
  const notes = records.filter(item => item.kind === "note");
  const events = shown.events;
  const confirmed = events.filter(event => event.status === "confirmed");
  const tentative = events.filter(event => event.status === "tentative");
  const scenarios = version?.scenarios ?? scenariosFor(shown);
  const critical = [...confirmed].sort(impactSort).filter(event => event.impact >= 4).slice(0, 3);
  const highCount = confirmed.filter(event => event.impact >= 4).length;
  const groupKey = shown.week;
  const activeRange = periodText(groupKey);
  const isArchive = Boolean(version);
  const deskReady = deskState === "ready" && !isArchive;
  const isRefreshing = refreshingWeek === week;

  function toast(message: string, error = false) {
    setNotice({ message, error });
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), error ? 7000 : 3800);
  }
  function goView(target: View) {
    setView(target); setMobileOpen(false);
    window.history.replaceState(null, "", eventHash(currentRef.current, target));
  }
  function goWeek(target: string) {
    if (!isWeek(target)) return;
    if (target === currentRef.current) {
      setVersion(null);
      return;
    }
    currentRef.current = target;
    versionRequest.current++;
    setWeek(target); setVersion(null); setCalendar(seedCalendar(target));
    setItems([]); setDeskState("loading"); setNoteDrafts({}); setTask("");
    setExpanded(null); setDay(null); setScenarioOpen(null); setFilter("all"); setStatus("schedule"); setQuery("");
    window.history.replaceState(null, "", eventHash(target, view));
  }
  async function refresh(target = currentRef.current) {
    if (locks.current.has("refresh-" + target)) return;
    locks.current.add("refresh-" + target);
    setRefreshingWeek(target);
    try {
      const result = await loadCalendar(target, true);
      if (target !== currentRef.current) return;
      setCalendar(result);
      toast(result.refreshedAt ? "已载入日程 · 核对于 " + humanTime(result.refreshedAt) : "该周暂无发布日程");
    } catch (error) {
      if (target === currentRef.current) toast((error as Error).message, true);
    } finally {
      locks.current.delete("refresh-" + target);
      setRefreshingWeek(value => value === target ? null : value);
    }
  }
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash) setView(panel(hash));
  }, []);
  useEffect(() => {
    const target = week;
    const generation = ++requestCounter.current;
    currentRef.current = target;
    loadCalendar(target).then(result => {
      if (generation !== requestCounter.current || target !== currentRef.current) return;
      setCalendar(result);
    }).catch(() => {});
    try {
      const result = readDesk(target);
      setItems(result.items); setVersions(result.versions); setDeskState("ready");
    } catch {
      setDeskState("error");
    }
  }, [week]);
  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current); }, []);

  async function write(item: Pick<DeskItem, "id" | "kind" | "body" | "event" | "done">, action = "put") {
    const target = currentRef.current;
    const key = [target, item.kind, item.id].join(":");
    if (locks.current.has(key)) return false;
    locks.current.add(key);
    try {
      const result = editDeskItem(target, item, action === "delete");
      if (target !== currentRef.current) return true;
      setItems(previous => {
        const rest = previous.filter(entry => entry.id !== item.id || entry.kind !== item.kind);
        return action === "delete" ? rest : [result, ...rest];
      });
      return true;
    } catch (error) {
      toast((error as Error).message, true);
      return false;
    } finally { locks.current.delete(key); }
  }
  function toggleStar(event: MarketEvent) {
    if (!deskReady) { if (!isArchive) toast("交易日志尚未连接，请重载后重试。", true); return; }
    const starred = stars.has(event.id);
    void write({ id: event.id, kind: "star", body: event.title, event: event.id, done: 0 }, starred ? "delete" : "put")
      .then(ok => { if (ok) toast(starred ? "已取消重点" : "已标记为重点"); });
  }
  async function addTask(event: FormEvent) {
    event.preventDefault();
    if (!task.trim() || !deskReady || working) return;
    setWorking(true);
    const ok = await write({ id: crypto.randomUUID(), kind: "task", body: task, event: null, done: 0 });
    setWorking(false);
    if (ok) { setTask(""); toast("已添加待确认事项"); }
  }
  function openSave() {
    setForm({ type: "snapshot", value: "W" + String(weekNumber(week)).padStart(2, "0") + " · " + periodText(week) + (view === "review" ? " 复盘" : " 前瞻") });
  }
  function openEventForm(type: "task" | "note", event: MarketEvent) {
    const value = type === "note" ? notes.find(item => item.id === "note-" + event.id)?.body ?? "" : "";
    setForm({ type, event, value });
  }
  async function submitDialog(event: FormEvent) {
    event.preventDefault();
    if (!form || !form.value.trim() || working) return;
    const { type, value, event: linked } = form;
    if (type === "week") {
      const monday = addDays(value, -dayIndex(value));
      if (isWeek(monday)) { goWeek(monday); setForm(null); }
      return;
    }
    setWorking(true);
    if (type === "snapshot") {
      try {
        const created = saveVersion(calendar, value);
        setVersions(list => [{ id: created.id, week: created.week, title: created.title, created: created.created }, ...list]);
        setForm(null); toast("已保存周度版本");
      } catch (error) { toast((error as Error).message, true); }
    } else {
      const id = type === "note" && linked ? "note-" + linked.id : crypto.randomUUID();
      const ok = await write({ id, kind: type, body: value, event: linked?.id ?? null, done: 0 });
      if (ok) { setForm(null); toast(type === "note" ? "已保存事件备注" : "已添加待确认事项"); }
    }
    setWorking(false);
  }
  async function viewVersion(id: string) {
    const request = ++versionRequest.current;
    try {
      const saved = readVersion(id);
      if (request !== versionRequest.current) return;
      setVersion(saved); setStatus("schedule"); setFilter("all"); setDay(null); setQuery(""); setExpanded(null);
      goView("outlook");
    } catch (error) { toast((error as Error).message, true); }
  }
  function reveal(event: MarketEvent) {
    if (view !== "outlook") goView("outlook");
    setStatus(event.status === "confirmed" ? "schedule" : "tentative"); setDay(null); setFilter("all"); setQuery(""); setExpanded(event.id);
    setTimeout(() => document.getElementById("event-" + event.id)?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 45);
  }
  function selectDay(date: string) {
    setDay(value => value === date ? null : date);
    setExpanded(null);
  }
  async function saveReview(id: string, body: string) {
    if (!deskReady) return;
    const ok = await write({ id, body, kind: "note", event: null, done: 0 }, body.trim() ? "put" : "delete");
    if (ok) toast("已保存复盘");
  }
  function exportVersion(saved: Version) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(saved, null, 2)], { type: "application/json;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = "ust-week-" + saved.week + "-" + saved.id.slice(0, 8) + ".json";
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const visible = (status === "tentative" ? tentative : confirmed)
    .filter(event => (!day || event.date === day) && (filter === "all" || (filter === "starred" ? stars.has(event.id) : event.category === filter)))
    .filter(event => !query || [event.title, event.detail, sourceTitle(event), event.date, event.time].join(" ").toLowerCase().includes(query.trim().toLowerCase()))
    .sort(sort === "impact" ? impactSort : timeSort);
  const byDay = sort === "time" ? [...new Set(visible.map(event => event.date))] : [];
  const latest = shown.sources.filter(source => source.state === "verified").length;
  const targetWeek = week === currentWeek ? addDays(week, 7) : currentWeek;
  const pendingCount = tasks.filter(item => !item.done).length;
  const clock = new Date(renderedAt);
  const todayET = newYorkDate(clock);
  const nextEvent = confirmed.filter(event => !isPastEvent(event, clock)).sort(timeSort)[0];

  function row(event: MarketEvent) {
    return <EventRow key={event.id} event={event} calendar={shown} star={stars.has(event.id)} open={expanded === event.id}
      toggleOpen={() => setExpanded(value => value === event.id ? null : event.id)} toggleStar={() => toggleStar(event)}
      addTask={() => openEventForm("task", event)} addNote={() => openEventForm("note", event)} readOnly={isArchive} saved={version?.impactAnalysis?.[event.kind]} />;
  }
  function scenarioCard(scenario: Scenario) {
    const isOpen = scenarioOpen === scenario.id;
    return <article className="scenario-row" key={scenario.id}>
      <button type="button" className="scenario-button" aria-expanded={isOpen} onClick={() => setScenarioOpen(isOpen ? null : scenario.id)}>
        <span className="scenario-icon"><Activity size={19} /></span><span><strong>{scenario.title}</strong><small>{scenario.detail}</small></span>
        <Impact score={scenario.impact} /><ChevronDown size={18} className={isOpen ? "up" : ""} />
      </button>
      {isOpen && <div className="scenario-detail">
        <div className="trigger-grid"><div><b>触发条件</b><p>{scenario.trigger}</p></div><div><b>失效条件</b><p>{scenario.invalidation}</p></div></div>
        <AnalysisGrid kind={scenario.kind} saved={version?.impactAnalysis?.[scenario.kind]} />
        <div className="linked-events">{scenario.events.map(id => events.find(event => event.id === id)).filter((item): item is MarketEvent => !!item).map(item => (
          <button key={item.id} className="button button-soft" onClick={() => reveal(item)}>{item.title}<ArrowUpRight size={14} /></button>
        ))}</div>
      </div>}
    </article>;
  }
  const pendingPanel = <section className="surface pending-panel" aria-label="待确认事项">
    <div className="panel-head"><div><h2>待确认事项</h2><p>{pendingCount} 项待核对</p></div><ClipboardList size={18} /></div>
    {tasks.length ? <ul className="task-list">{tasks.map(item => {
      const linked = events.find(event => event.id === item.event);
      return <li key={item.id}><button type="button" disabled={isArchive} onClick={() => void write({ ...item, done: item.done ? 0 : 1 })}
        className={"task-check" + (item.done ? " task-done" : "")} aria-label={(item.done ? "重新打开 " : "完成 ") + item.body}>{item.done ? <Check size={13} /> : null}</button>
        <div><span className={item.done ? "done-text" : ""}>{item.body}</span>{linked && <button className="text-button" onClick={() => reveal(linked)}>{linked.title}<ArrowUpRight size={11} /></button>}</div>
        {!isArchive && <button type="button" className="icon-button task-remove" onClick={() => void write(item, "delete")} aria-label={"删除 " + item.body}><X size={15} /></button>}
      </li>;
    })}</ul> : <p className="task-empty">还没有待核对的事项。</p>}
    {!isArchive && <form className="task-form" onSubmit={addTask}><input value={task} onChange={event => setTask(event.target.value)} aria-label="新增待确认事项" placeholder="新增待确认事项…" maxLength={220} /><button className="icon-button" aria-label="添加待确认事项" disabled={!deskReady || !task.trim() || working}><Plus size={18} /></button></form>}
  </section>;

  return <div className="app-shell">
    <aside className={"sidebar" + (mobileOpen ? " nav-open" : "")} aria-label="工作台导航">
      <button type="button" className="brand" onClick={() => { goView("outlook"); if (version) setVersion(null); }}>
        <span className="brand-icon"><TrendingUp size={23} strokeWidth={2.25} /></span>
        <span><b>UST Weekly Desk</b><small>美债系统化交易台</small></span>
      </button>
      <div className="nav-label">工作台</div>
      <nav>{nav.map(item => <button type="button" key={item.id} onClick={() => goView(item.id)} aria-label={item.label} aria-current={view === item.id ? "page" : undefined}
        className={"nav-item" + (view === item.id ? " nav-active" : "")}><item.icon size={19} /><span>{item.label}</span>{view === item.id && <span className="nav-indicator" />}</button>)}</nav>
      <div className="sidebar-bottom">
        <div className="timezone-mark"><Clock3 size={16} /><div><b>New York</b><span>Eastern Time · ET</span></div></div>
        <div className="workspace-status"><i />公开周报 · 记录存在本浏览器</div>
      </div>
    </aside>
    {mobileOpen && <button className="nav-overlay" aria-label="关闭导航" onClick={() => setMobileOpen(false)} />}
    <div className="main-area">
      <header className="topbar">
        <div className="breadcrumbs"><button className="icon-button menu-toggle" onClick={() => setMobileOpen(!mobileOpen)} aria-label="打开导航"><Menu size={22} /></button>
          <span className="breadcrumb-root">UST / RATES</span><ChevronRight size={13} /><strong>{nav.find(item => item.id === view)?.label}</strong></div>
        <div className="top-actions"><span className="top-zone"><Clock3 size={14} />纽约时间</span>
          <button className="button button-outline refresh-button" onClick={() => void refresh()} disabled={isRefreshing || isArchive} aria-label="重新载入已发布日程">
            <RefreshCw size={16} className={isRefreshing ? "spinning" : ""} /><span>{isRefreshing ? "更新中" : "刷新日程"}</span></button>
          <button className="button button-primary" onClick={isArchive && version ? () => exportVersion(version) : openSave} disabled={!isArchive && !deskReady}>
            {isArchive ? <ArrowDownToLine size={16} /> : <Bookmark size={16} />}<span>{isArchive ? "导出版本" : "保存版本"}</span></button></div>
      </header>
      <main className="workspace">
        <section className="page-heading">
          <div>
            <div className="heading-kicker"><span className="kicker-line" />{view === "outlook" ? "U.S. TREASURIES / WEEK AHEAD" : view === "review" ? "U.S. TREASURIES / WEEK IN REVIEW" : view === "archive" ? "WEEKLY SNAPSHOTS" : "PUBLIC CALENDARS"}</div>
            <h1>{view === "outlook" ? "美债周度前瞻" : view === "review" ? "美债交易复盘" : view === "archive" ? "周度归档" : "官方数据来源"}</h1>
            <p>{view === "outlook" ? "从宏观发布、国债供给到交易窗口，一周的 UST 事件与执行观察。" :
              view === "review" ? "用公开市场结果复核周前瞻，记录收益率、执行质量和对冲残差。" :
              view === "archive" ? "回看已保存的日程、交易情景与复盘记录。" :
              "查看每个公开来源的核对时间、官方更新日期和本周覆盖。"}</p>
          </div>
          {(view === "outlook" || view === "review" || view === "sources") && !isArchive && <div className="week-control" aria-label="选择周次">
            <button className="icon-button" type="button" aria-label="上一周" onClick={() => goWeek(addDays(week, -7))}><ChevronLeft size={18} /></button>
            <button className="week-date" type="button" aria-label="按日期选择周次" onClick={() => setForm({ type: "week", value: week })}><CalendarDays size={16} /><span>{periodText(week)}</span></button>
            <button className="icon-button" type="button" aria-label="下一周" onClick={() => goWeek(addDays(week, 7))}><ChevronRight size={18} /></button>
            <button className="week-shortcut" type="button" onClick={() => goWeek(targetWeek)}>{week === currentWeek ? "下周" : "回到本周"}</button>
          </div>}
        </section>

        {deskState === "error" && !isArchive && <div className="notice-banner"><CircleAlert size={16} /><span>浏览器存储不可用。允许此站点保存数据后，可记录重点与复盘。</span></div>}
        {version && <div className="archive-banner"><Bookmark size={17} /><span><strong>{version.title}</strong> · {humanTime(version.created)} 保存</span>
          <button className="text-button" onClick={() => { versionRequest.current++; setVersion(null); setDay(null); setExpanded(null); }}><ArrowLeft size={15} />返回当前日程</button></div>}

        {view === "outlook" && <>
          <section className="week-hero">
            <div className="hero-left">
              <div className="hero-kicker"><span className="hero-live-dot" />{groupKey.slice(0, 4)} / WEEK {String(weekNumber(groupKey)).padStart(2, "0")}<span className="hero-kicker-divider" />{groupKey === currentWeek ? "本周" : groupKey === addDays(currentWeek, 7) ? "下周" : groupKey < currentWeek ? "历史周" : "前瞻周"}</div>
              <div className="hero-date">{activeRange}<small> ET</small></div>
              <div className="hero-caption">{nextEvent ? "下一事件 · " + dayText(nextEvent.date) + " " + eventClock(nextEvent) + " " + nextEvent.title : "纽约时间 · 周一至周日"}</div>
              <div className="hero-stats">
                <div><strong>{confirmed.length}</strong><span>已确认</span></div><div><strong>{highCount}</strong><span>高影响</span></div>
                <div><strong>{tentative.length}</strong><span>暂定</span></div><div><strong>{stars.size}</strong><span>已标重点</span></div>
              </div>
            </div>
            <div className="hero-visual" aria-hidden="true">
              <svg viewBox="0 0 580 250" preserveAspectRatio="xMidYMid slice">
                <defs><pattern id="hero-grid" width="38" height="36" patternUnits="userSpaceOnUse"><path d="M 38 0 L 0 0 0 36" fill="none" stroke="#edf5d6" strokeOpacity=".105" /></pattern>
                  <linearGradient id="hero-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#c9e68a" stopOpacity=".23" /><stop offset="1" stopColor="#c9e68a" stopOpacity="0" /></linearGradient></defs>
                <rect width="580" height="250" fill="url(#hero-grid)" />
                <path d="M12,218 C72,221 87,184 131,186 C185,188 203,157 236,161 C285,168 300,111 349,111 C398,111 410,88 445,95 C503,106 522,56 581,47 L581 250 L12 250 Z" fill="url(#hero-fill)" />
                <path d="M12,218 C72,221 87,184 131,186 C185,188 203,157 236,161 C285,168 300,111 349,111 C398,111 410,88 445,95 C503,106 522,56 581,47" fill="none" stroke="#d8f09d" strokeWidth="2" />
                <path d="M16,227 C76,228 99,208 140,209 C191,211 214,179 249,182 C288,186 325,149 356,148 C399,148 432,118 476,120 C510,121 540,94 581,96" fill="none" stroke="#afcc9a" strokeOpacity=".54" strokeWidth="1.2" strokeDasharray="5 6" />
                <path d="M64 235 C142 237 157 226 195 228 C254 230 278 210 316 211 C358 212 395 184 438 189 C479 194 533 156 580 158" fill="none" stroke="#9fbe92" strokeOpacity=".44" strokeWidth="1.2" />
                {[ [131, 186], [236, 161], [349, 111], [445, 95] ].map(([x, y]) => <circle key={x} cx={x} cy={y} r="3" fill="#e7f6b8" />)}
              </svg>
            </div>
            <div className="hero-update"><Database size={13} />{shown.refreshedAt ? "日程核对 " + humanTime(shown.refreshedAt) : "本周日程待更新"}</div>
          </section>

          <section className="week-strip" aria-label="按星期筛选">
            {Array.from({ length: 7 }, (_, i) => {
              const date = addDays(groupKey, i);
              const count = (status === "tentative" ? tentative : confirmed).filter(event => event.date === date).length;
              const selected = date === day;
              const today = date === todayET;
              return <button key={date} type="button" disabled={status === "scenarios"} aria-pressed={selected} onClick={() => selectDay(date)}
                className={"day-button" + (selected ? " day-selected" : "") + (today ? " day-today" : "") + (i > 4 ? " weekend" : "")}>
                <span>{weekDays[i]} {today && <i />}</span><strong>{dateShort(date)}</strong><small>{count ? count + " 项" : "—"}</small></button>;
            })}
          </section>

          <div className="desk-grid">
            <section className="surface calendar-panel" aria-label="周度事件">
              <div className="calendar-heading"><div><h2>周度事件</h2><p>美国东部时间 · 潜在交易影响由工作台评估</p></div><button className="button button-outline sort-button" type="button" disabled={status === "scenarios"}
                onClick={() => setSort(value => value === "time" ? "impact" : "time")} aria-label="切换时间或影响排序"><ArrowDownUp size={15} />{sort === "time" ? "时间排序" : "影响排序"}</button></div>
              <div className="tabs" aria-label="日程类型">
                <button className={status === "schedule" ? "tab active-tab" : "tab"} aria-pressed={status === "schedule"} onClick={() => { setStatus("schedule"); setExpanded(null); }}>已确认日程 <span>{confirmed.length}</span></button>
                <button className={status === "tentative" ? "tab active-tab" : "tab"} aria-pressed={status === "tentative"} onClick={() => { setStatus("tentative"); setExpanded(null); }}>暂定 / 待核对 <span>{tentative.length}</span></button>
                <button className={status === "scenarios" ? "tab active-tab" : "tab"} aria-pressed={status === "scenarios"} onClick={() => { setStatus("scenarios"); setDay(null); }}>预测性判断 <span>{scenarios.length}</span></button>
              </div>
              {status !== "scenarios" ? <>
                <div className="filter-area">
                  <div className="filters" aria-label="事件筛选">{filters.map(item => <button key={item.id} aria-pressed={item.id === filter} className={"filter" + (item.id === filter ? " filter-active" : "")}
                    onClick={() => setFilter(item.id)}>{item.id === "starred" && <Star size={13} />}{item.text}</button>)}</div>
                  <label className="search"><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} aria-label="搜索事件" placeholder="搜索" />{query && <button type="button" className="icon-button" onClick={() => setQuery("")} aria-label="清空搜索"><X size={13} /></button>}</label>
                </div>
                {day && <div className="day-filter"><ListFilter size={14} />{dayText(day)}<button className="text-button" type="button" onClick={() => setDay(null)}>显示整周 <X size={13} /></button></div>}
                {status === "tentative" && <div className="filter-info"><CircleAlert size={15} />财政部暂定发行、待核对的发布时点和合约时段。</div>}
                {visible.length === 0 ? <Empty title="没有符合条件的事件">可以切换日期、类别或搜索词。</Empty> :
                  sort === "impact" ? <div className="impact-rows"><div className="day-label"><span>按潜在交易影响</span><span>{visible.length} 项</span></div>
                    {visible.map(event => <div className="impact-event" key={event.id}><span className="impact-date">{dayText(event.date)}</span>{row(event)}</div>)}</div> :
                    byDay.map(date => <div key={date}><div className="day-label"><span>{dayText(date)}</span><span>{visible.filter(event => event.date === date).length} 项</span></div>{visible.filter(event => event.date === date).map(row)}</div>)}
              </> : <>
                <div className="filter-info"><Activity size={16} />条件性情景 · 按潜在影响排序 · 每条附触发与失效条件</div>
                {scenarios.length ? scenarios.map(scenarioCard) : <Empty title="本周暂无已生成的情景" icon={<Activity size={23} />}>日程更新后会按可核对的公开事件生成。</Empty>}
              </>}
            </section>

            <aside className="insights">
              <section className="surface focus-panel" aria-label="高影响窗口">
                <div className="panel-head"><div><h2>高影响窗口</h2><p>按潜在交易影响</p></div><span className="focus-icon"><Flag size={16} /></span></div>
                {critical.length ? <ol className="focus-list">{critical.map(event => <li key={event.id}><button type="button" onClick={() => reveal(event)}>
                  <span className="focus-dot" /><span><b>{event.title}</b><small>{dayText(event.date)} · {eventClock(event)} ET</small></span><ArrowUpRight size={16} /></button></li>)}</ol> :
                  <div className="small-empty">本周暂无高影响的确认日程。</div>}
                <button className="panel-link" type="button" onClick={() => { setStatus("scenarios"); setDay(null); }}><span>查看交易情景</span><ArrowRight size={16} /></button>
              </section>
              <WeekCurve calendar={shown} />
              {pendingPanel}
            </aside>
          </div>
        </>}

        {view === "review" && <div className="review-layout">
          <div className="review-main">
            <section className="surface results-panel"><div className="panel-head"><div><h2>公开事件结果</h2><p>拍卖结果及已收录的经济数据发布</p></div><Activity size={18} /></div>
              {events.some(item => item.actual) ? <div className="results-list">{events.filter(item => item.actual).sort(timeSort).map(item =>
                <div key={item.id}><div><strong>{item.title}</strong><span>{dayText(item.date)} · {eventClock(item)} ET</span></div><p>{item.actual}</p>
                  <SourceLink href={item.resultUrl ?? item.url}>{sourceTitle(item)}</SourceLink></div>)}</div> :
                <Empty title="本周暂无已收录的结果" icon={<Activity size={24} />}>财政部公布结果后，刷新日程可获取已发布拍卖结果。</Empty>}
            </section>
            <section className="surface journal-panel"><div className="panel-head"><div><h2>周度复盘笔记</h2><p>按收益率、流动性、执行与对冲记录</p></div><FileText size={18} /></div>
              <div className="journal-fields">{reviews.map(review => {
                const saved = notes.find(item => item.id === review.id)?.body ?? "";
                const value = isArchive ? saved : noteDrafts[review.id] ?? saved;
                return <div className="journal-field" key={review.id}><label htmlFor={"review-" + review.id}>{review.title}</label>
                  <textarea id={"review-" + review.id} value={value} placeholder={review.placeholder} readOnly={isArchive} maxLength={5000}
                    onChange={event => setNoteDrafts(drafts => ({ ...drafts, [review.id]: event.target.value }))} />
                  {!isArchive && <button className="button button-outline" type="button" disabled={!deskReady || value === saved} onClick={() => void saveReview(review.id, value)}><Check size={15} />保存</button>}
                </div>;
              })}</div>
            </section>
            <section className="surface journal-panel"><div className="panel-head"><div><h2>事件复盘备注</h2><p>从周度事件的影响分析添加</p></div><Bookmark size={18} /></div>
              {notes.some(note => note.event) ? <div className="event-notes">{notes.filter(note => note.event).map(note => {
                const linked = events.find(item => item.id === note.event);
                return <article key={note.id}><div><strong>{linked?.title ?? "已记录事件"}</strong>{!isArchive && linked &&
                  <button className="text-button" onClick={() => openEventForm("note", linked)}>编辑</button>}</div><p>{note.body}</p></article>;
              })}</div> : <Empty title="暂无事件备注" icon={<FileText size={22} />}>可以在前瞻日历展开事件，记录实际反应与执行观察。</Empty>}
            </section>
          </div>
          <aside className="insights"><WeekCurve calendar={shown} full />{pendingPanel}</aside>
        </div>}

        {view === "archive" && <section className="surface archive-panel">
          <div className="panel-head"><div><h2>已保存的周度版本</h2><p>{versions.length} 个版本</p></div><Layers3 size={18} /></div>
          {versions.length ? <div className="archive-list">{versions.map(saved => <button type="button" key={saved.id} onClick={() => void viewVersion(saved.id)}>
            <span className="archive-icon"><Bookmark size={18} /></span><span><strong>{saved.title}</strong><small>{saved.week.slice(0, 4)} · W{weekNumber(saved.week)} · {periodText(saved.week)}</small></span>
            <span className="archive-time">{humanTime(saved.created)}</span><ChevronRight size={18} /></button>)}</div> :
            <Empty title="暂无已保存版本" icon={<Bookmark size={25} />}>用上方「保存版本」归档所选周的日程与记录。</Empty>}
        </section>}

        {view === "sources" && <section className="surface source-panel">
          <div className="panel-head"><div><h2>本周来源状态</h2><p>{periodText(groupKey)} · {latest} 个来源已在线核对 · 时间为 ET</p></div><Database size={18} /></div>
          <div className="source-grid">{shown.sources.map(item => {
            const info = sourceIndex[item.id];
            const state = item.state === "verified" ? "已核对" : item.state === "cached" ? "最近可用" : item.state === "reference" ? "官方入口 / 已收录资料" : "待核对";
            return <article key={item.id}><div className="source-card-title"><SourceLink href={info.url}>{info.name}</SourceLink>
              <span className={"state-pill" + (item.state === "unavailable" ? " state-tentative" : "")}>{state}</span></div>
              <p>{info.detail}</p><dl><div><dt>站点核对</dt><dd>{humanTime(item.checkedAt)}</dd></div>
                <div><dt>官方更新 / 数据日</dt><dd>{item.officialUpdate ?? "来源未注明"}</dd></div>
                {item.id !== "curve" && <div><dt>本周条目</dt><dd>{item.count}</dd></div>}</dl></article>;
          })}</div>
          <div className="source-note">交易时段以各机构为准。CME 结算时点与 Globex 合约交易时段分别列示。财政部日度平价收益率用于复盘对照。</div>
        </section>}

        <footer className="site-footer"><span>UST Weekly Desk</span><span>America/New_York · 公开市场信息</span></footer>
      </main>
    </div>
    {notice && <div className={"toast" + (notice.error ? " toast-error" : "")} role="status">{notice.error ? <CircleAlert size={17} /> : <Check size={17} />}{notice.message}<button className="icon-button" type="button" aria-label="关闭通知" onClick={() => setNotice(null)}><X size={15} /></button></div>}
    {form && <Dialog title={form.type === "snapshot" ? "保存周度版本" : form.type === "week" ? "选择周次" : form.type === "task" ? "添加待确认事项" : "事件复盘备注"}
      detail={form.event ? form.event.title : form.type === "snapshot" ? periodText(week) + " ET · 包含日程、情景、重点和日志" : form.type === "week" ? "选择日期后跳到该日期所在的一周。" : undefined}
      close={() => setForm(null)}>
      <form className="dialog-form" onSubmit={submitDialog}>
        {form.type === "week" ? <label>日期<input type="date" value={form.value} min="2020-01-01" max="2099-12-31" required onChange={event => setForm({ ...form, value: event.target.value })} autoFocus /></label> :
          form.type === "snapshot" ? <label>版本名称<input value={form.value} maxLength={100} required onChange={event => setForm({ ...form, value: event.target.value })} autoFocus /></label> :
            <label>{form.type === "task" ? "待核对内容" : "实际市场反应与执行观察"}<textarea value={form.value} maxLength={form.type === "task" ? 220 : 5000} required onChange={event => setForm({ ...form, value: event.target.value })} autoFocus /></label>}
        <div className="dialog-actions"><button className="button button-outline" type="button" onClick={() => setForm(null)}>取消</button>
          <button className="button button-primary" disabled={working || !form.value.trim() || (form.type !== "week" && !deskReady)}>{working ? "保存中" : form.type === "week" ? "查看该周" : "保存"}</button></div>
      </form>
    </Dialog>}
  </div>;
}
