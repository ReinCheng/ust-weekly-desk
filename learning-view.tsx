import { useState, type ReactNode } from "react";
import { BookOpen, ChevronRight, ExternalLink } from "lucide-react";
import { curveShape, lessonGroups, type Lesson } from "./learning";
import { sourceIndex, type MarketEvent } from "./model";

const treasuryUrl = sourceIndex.curve.url;
const fmt = (value: number) => (value > 0 ? "+" : "") + Number(value.toFixed(2));

export function CurveGuide({ observation, onLearn }: {
  observation?: { front: number; back: number; window: string; sameSource: boolean };
  onLearn: () => void;
}) {
  const shape = observation && curveShape(observation.front, observation.back);
  return <div className="curve-guide">
    <div className="study-heading"><BookOpen size={16} /><h3>如何读这条曲线</h3></div>
    {observation && <>
      <p data-testid="curve-observation">{observation.window} · 2Y {fmt(observation.front)} bp · 10Y {fmt(observation.back)} bp · 2s10s {fmt(observation.back - observation.front)} bp{observation.sameSource && shape ? "（" + shape + "）" : ""}</p>
      <p>{!observation.sameSource
        ? "现券报价与财政部日终平价曲线来自不同口径。切换到财政部日终可比较同源观测。"
        : observation.front > observation.back && observation.front > 0
          ? "若市场在上调近端政策路径，短端领升与这个解释相符。可用同窗口政策利率期货核对。"
          : observation.back > observation.front && observation.back > 0
            ? "若变化集中在长端，检查同窗口实际利率、通胀补偿，以及长债供给信息。"
            : "用同窗口政策利率期货核对短端，用实际利率和通胀补偿拆解长端。"}</p>
    </>}
    <div className="study-basics">
      <details><summary>bp 与债券价格</summary><p>1 bp 等于 0.01 个百分点。3.50% 升至 3.62% 是 +12 bp。同一只固定息债券的收益率上升时，价格下降。</p></details>
      <details><summary>2s10s 与牛熊陡平</summary><p>2s10s = 10Y − 2Y。两端都上升、斜率变小称为熊平。例如 10Y +5 bp、2Y +12 bp，斜率变化为 −7 bp。两端异向时直接描述期限和斜率。</p></details>
      <details><summary>实际利率、通胀补偿与期限溢价</summary><p>同一时点的 10Y 名义收益率减 TIPS 实际收益率，近似衡量 10Y 通胀补偿。也可以从未来短期利率预期加期限溢价解释长端。期限溢价需要模型估计。</p>
        <a href="https://www.newyorkfed.org/research/data_indicators/term-premia-tabs" target="_blank" rel="noreferrer">纽约联储期限溢价估计 <ExternalLink size={12} /></a>
      </details>
    </div>
    <button type="button" className="action" onClick={onLearn}>学习指标如何影响曲线 <ChevronRight size={14} /></button>
  </div>;
}

export function LessonCard({ lesson, evidence }: { lesson: Lesson; evidence?: ReactNode }) {
  return <section className="lesson-card" aria-label={lesson.title + "课程"}>
    <div className="study-heading"><BookOpen size={17} /><h3>从指标到收益率</h3></div>
    <dl className="lesson-steps">
      <div><dt>它衡量什么</dt><dd>{lesson.measures}</dd></div>
      <div><dt>本次要看什么</dt><dd>{lesson.read}</dd></div>
      <div><dt>如何传到曲线</dt><dd>{lesson.channel}</dd></div>
      <div><dt>怎样核对判断</dt><dd>{lesson.check}</dd></div>
    </dl>
    {evidence}
  </section>;
}

export function LessonDirectory({ selected, onSelect, canReplay, hasPractice }: {
  selected: string;
  onSelect: (key: string) => void;
  canReplay: (key: string) => boolean;
  hasPractice: (key: string) => boolean;
}) {
  const [query, setQuery] = useState("");
  const terms = query.trim().toLowerCase().split(/\s+/);
  const groups = lessonGroups.map(group => ({
    ...group, lessons: group.lessons.filter(item => terms.every(term =>
      (item.title + " " + item.terms + " " + group.name).toLowerCase().includes(term))),
  })).filter(group => group.lessons.length);
  return <div className="lesson-directory">
    <label>查找指标<input type="search" placeholder="例如 CPI、初请、TIPS" value={query} onChange={e => setQuery(e.target.value)} /></label>
    {groups.length === 0 && <p className="empty">没有找到匹配的指标。</p>}
    {groups.map(group => <section key={group.name}>
      <h3>{group.name}</h3>
      <div className="lesson-links">{group.lessons.map(item =>
        <button key={item.key} type="button" className="lesson-link" aria-pressed={selected === item.key} onClick={() => onSelect(item.key)}>
          <span>{item.title}</span>{(canReplay(item.key) || hasPractice(item.key)) &&
            <small>{[hasPractice(item.key) && "练习", canReplay(item.key) && "回放"].filter(Boolean).join(" · ")}</small>}<ChevronRight size={14} />
        </button>)}</div>
    </section>)}
  </div>;
}

export function ReleaseGroup({ events, time, children }: { events: MarketEvent[]; time: string; children: ReactNode }) {
  const priceAndGrowth = events.some(event => event.kind === "inflation" || event.kind === "ppi") &&
    events.some(event => event.kind === "growth" || event.kind === "retail" || event.kind === "claims");
  const question = priceAndGrowth
    ? "若通胀偏热、需求或就业转弱，哪段曲线最能帮助区分这两种信号？"
    : "这些指标各自提供哪些新信息？哪一项最可能影响市场对政策路径的判断？";
  return <details className="release-group">
    <summary>
      <span><b>{time}</b><strong>{events.length} 项经济数据同刻发布</strong></span>
      <span className="release-preview">{events.map(event => event.title).join(" · ")}</span>
    </summary>
    <p>{question} <span>展开逐项查看报告期与读数。</span></p>
    {children}
  </details>;
}

type Exercise = {
  date: string;
  prevDate: string;
  title: string;
  known: string;
  before: [number, number];
  after: [number, number];
  real?: [number, number];
  release: string;
  followUp: string;
};

const exercises: Record<string, Exercise[]> = {
  cpi: [
    {
      date: "2026-11-10", prevDate: "2026-11-09", title: "核心 CPI 与 10Y 拍卖同日",
      known: "10 月核心 CPI 月率 +0.3%，整体月率 +0.4%。同日还有 10Y 国债拍卖。",
      before: [4.56, 4.88], after: [4.73, 4.98], real: [2.66, 2.78],
      release: "https://www.bls.gov/news.release/archives/cpi_11102026.htm",
      followUp: "日终比较涵盖早盘 CPI 和午后拍卖。要确认政策路径变化或区分两场冲击，需要分别查看两个事件窗口的报价。",
    },
    {
      date: "2026-10-14", prevDate: "2026-10-13", title: "整体与核心 CPI 的读数不同",
      known: "9 月核心 CPI 月率 +0.3%，整体月率 +0.6%。",
      before: [4.79, 5.21], after: [4.82, 5.19],
      release: "https://www.bls.gov/news.release/archives/cpi_10142026.htm",
      followUp: "2Y 与 10Y 异向变动。可以描述斜率走平，再用同窗口的实际利率与政策路径报价核对原因。",
    },
  ],
  jobs: [{
    date: "2026-11-06", prevDate: "2026-11-05", title: "新增岗位与失业率怎么一起读",
    known: "10 月非农新增 165 千人，失业率为 4.1%。",
    before: [4.46, 4.84], after: [4.51, 4.86],
    release: "https://www.bls.gov/news.release/archives/empsit_11062026.htm",
    followUp: "新增岗位和失业率来自两项调查。结合时薪、前值修订及事前预期后，再检验政策利率定价是否发生变化。",
  }],
};

export const hasHistoricalPractice = (key: string) => Boolean(exercises[key]?.length);

export function HistoryPractice({ course, beforeDate }: { course: string; beforeDate?: string }) {
  const cases = (exercises[course] ?? []).filter(item => !beforeDate || item.date < beforeDate);
  const [selected, setSelected] = useState("");
  const active = cases.find(item => item.date === selected) ?? cases[0];
  if (!active) return null;
  return <section className="practice-card" aria-label="历史练习">
    <h3>历史练习</h3>
    {cases.length > 1 && <label>选择案例<select value={active.date} onChange={event => setSelected(event.target.value)}>
      {cases.map(item => <option key={item.date} value={item.date}>{item.date} · {item.title}</option>)}
    </select></label>}
    <PracticeQuestion key={active.date} item={active} />
  </section>;
}

function PracticeQuestion({ item }: { item: Exercise }) {
  const [answer, setAnswer] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<"answer" | "direct" | null>(null);
  const [front, back] = item.after.map((value, i) => Math.round((value - item.before[i]) * 100));
  const actual = back === front ? "持平" : back > front ? "走陡" : "走平";
  const real = item.real && Math.round((item.real[1] - item.real[0]) * 100);
  const month = item.date.slice(0, 7).replace("-", "");
  return <>
    <h4>{item.title}</h4>
    <p>{item.date} · {item.known} 本题缺少可核对的发布前调查预期。</p>
    {result === null ? <form onSubmit={event => { event.preventDefault(); setResult("answer"); }}>
      <label>你预计当日 2s10s 怎么变？
        <select value={answer} onChange={event => setAnswer(event.target.value)} required>
          <option value="">选择一个判断</option>
          {["走陡", "走平", "持平", "证据不足"].map(choice => <option key={choice}>{choice}</option>)}
        </select>
      </label>
      <label>写下理由或还需要的证据
        <textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={600} rows={2} required />
      </label>
      <div className="study-actions">
        <button type="submit" className="action primary" disabled={!answer || !reason.trim()}>提交并查看日终结果</button>
        <button type="button" className="action" onClick={() => setResult("direct")}>直接查看结果</button>
      </div>
    </form> : <div className="practice-result" aria-live="polite">
      <p><b>{item.prevDate} → {item.date} 财政部日终</b></p>
      <p>2Y {fmt(front)} bp · 10Y {fmt(back)} bp · 2s10s {fmt(back - front)} bp（{curveShape(front, back)}）</p>
      {real !== undefined && <p>10Y 实际收益率 {fmt(real)} bp · 隐含通胀补偿 {fmt(back - real)} bp</p>}
      {result === "answer" && <div>
        <p><b>你的判断</b> {answer} · {reason}</p>
        <p>{answer === "证据不足" ? "题面缺少事前预期，保留判断有依据。公布后的日终形态可用两端变动复算。"
          : answer === actual ? "方向与日终斜率一致。再检查你的理由需要什么数据支持。"
          : "日终斜率" + actual + "。先用 10Y 变动减去 2Y 变动，再回看你对传导渠道的假设。"}</p>
      </div>}
      <p>{item.followUp}</p>
      <div className="study-actions">
        <a href={item.release} target="_blank" rel="noreferrer">BLS 发布原文</a>
        <a href={treasuryUrl + "&field_tdr_date_value_month=" + month} target="_blank" rel="noreferrer">财政部名义曲线</a>
        {item.real && <a href={treasuryUrl.replace("daily_treasury_yield_curve", "daily_treasury_real_yield_curve") + "&field_tdr_date_value_month=" + month} target="_blank" rel="noreferrer">财政部实际曲线</a>}
        <button type="button" className="action" onClick={() => setResult(null)}>重新作答</button>
      </div>
    </div>}
  </>;
}
