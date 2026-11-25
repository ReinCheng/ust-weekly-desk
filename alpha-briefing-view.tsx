import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, BookOpen, CalendarDays, CheckCircle2, Cloud, Copy, GitBranch, Lightbulb,
  RefreshCw, ShieldCheck, Sparkles, TrendingUp,
} from "lucide-react";
import { tzIana, tzShortTag, type TzMode } from "./model";
import type { AlphaMode, ContractOrder, TicketLifecycle } from "./alpha-paper-view";

type AlphaIdea = {
  id: string;
  title: string;
  instruments: string;
  category: string;
  horizon: string;
  priorConfidencePct: number;
  mechanism: string;
  publicFeeds: string;
  orthogonality: string;
  costAndFalsification: string;
  validationPlan: string;
};

type ModeReview = {
  hasSettlement: boolean;
  summary: string;
  latestSettled: {
    execDate: string;
    valuationEndDate: string;
    cmeNetUsd: number;
    cmeNetPct: number;
    cmeCostUsd: number;
    etfOpenNetUsd: number | null;
    etfCloseNetUsd: number | null;
    legs: { symbol: string; leg: string; lots: number; entrySettle: number; exitSettle: number; exitDate: string; pnlUsd: number }[];
  } | null;
  cumCmeNetUsd: number;
  cumCmeNetPct: number;
  cumEtfOpenNetUsd: number;
  cumEtfCloseNetUsd: number;
  cmeVsEtfCloseUsd: number | null;
  g6Settled: number;
  g6Target: number;
  forwardSharpe: number | null;
  forwardHitRatePct: number | null;
  histBenchmarkSr: number;
  histBenchmarkMaxDd: number;
};

type BriefingEntry = {
  asOfDate: string;
  execDate: string;
  valuationEndDate: string;
  generatedAtUtc: string;
  g1AllPassed: boolean;
  g1Count: string;
  marketSnapshot: {
    date: string;
    ust2y: number;
    ust5y: number;
    ust10y: number;
    ust30y: number;
    s2s10sBp: number;
    s5s30sBp: number;
    move: number;
  };
  regimeDiagnosis: {
    volRegime: string;
    volTone: string;
    volNote: string;
    curveShape: string;
    dailyMoveSummary: string;
    d2yBp: number;
    d10yBp: number;
    d30yBp: number;
  };
  reviews: Record<AlphaMode, ModeReview>;
  nextAction: Record<AlphaMode, {
    actionSummary?: TicketLifecycle["actionSummary"];
    pillars?: TicketLifecycle["pillars"];
    netDv01Usd: number;
    grossDv01Usd: number;
    contracts: ContractOrder[];
  }>;
  researchSpotlight: AlphaIdea;
  pmConfidencePct: number;
};

type BriefingsBundle = {
  schemaVersion: string;
  updatedAtUtc: string;
  totalCatalogIdeas: number;
  latestAsOfDate: string;
  entries: BriefingEntry[];
  ideaCatalog: AlphaIdea[];
};

const STORAGE_MODE = "ust-alpha-mode-v1";
const STORAGE_NAV = "ust-alpha-risk-nav-v1";
const fmtUsd = (v: number) => (v > 0 ? "+" : v < 0 ? "-" : "") + "$" + Math.abs(Math.round(v)).toLocaleString("en-US");
const fmtSigned = (v: number, d = 2) => (v > 0 ? "+" : "") + v.toFixed(d);
const fmtLots = (v: number) => (v > 0 ? `+${v}` : `${v}`);

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function formatTs(iso: string, tz: TzMode) {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: tzIana(tz), month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).format(new Date(iso)) + " " + tzShortTag(tz);
  } catch {
    return iso.slice(0, 16);
  }
}

function buildMarkdownBrief(entry: BriefingEntry, mode: AlphaMode, navScale: number, riskNav: number): string {
  const rev = entry.reviews[mode];
  const nxt = entry.nextAction[mode];
  const sp = entry.researchSpotlight;
  const lines = [
    `# UST Core3 盘后复盘简报 · ${entry.asOfDate} (${mode === "ultra" ? "Ultra" : "Enhanced"} · 规模 $${riskNav.toLocaleString()})`,
    `> 云端自动生成 · G1 零前视 ${entry.g1AllPassed ? "PASS" : "FAIL"} (${entry.g1Count}) · G6 锁箱 ${rev.g6Settled}/${rev.g6Target} 天 · 下期执行日 ${entry.execDate} → ${entry.valuationEndDate}`,
    ``,
    `## ① 收盘复盘与 G6 验证`,
    `- ${rev.summary}`,
    `- 累计 Auto CME 净盈亏：${fmtUsd(rev.cumCmeNetUsd * navScale)} (${fmtSigned(rev.cumCmeNetPct)}%) ｜ 零换月 ETF 早盘 ${fmtUsd(rev.cumEtfOpenNetUsd * navScale)} / 收盘 ${fmtUsd(rev.cumEtfCloseNetUsd * navScale)}`,
    ``,
    `## ② 市场格局与明日动作`,
    `- ${entry.regimeDiagnosis.dailyMoveSummary}`,
    `- 波动体制：${entry.regimeDiagnosis.volRegime} — ${entry.regimeDiagnosis.volNote}`,
    `- 明日结论：${nxt.actionSummary?.headline ?? "见合约明细"}`,
    `- 下次预计平仓 (Unwind)：${nxt.actionSummary?.nextUnwindSummary ?? "—"}`,
    ...nxt.contracts.map(c => {
      const p = Math.round((c.prevTargetLots ?? 0) * navScale);
      const t = Math.round(c.targetLots * navScale);
      return `  - ${c.symbol} (${c.leg}): 昨 ${fmtLots(p)} → 今 ${fmtLots(t)} 手 (Δ${fmtLots(t - p)}) · ${fmtUsd(c.targetDv01Usd * navScale)}/bp · ${c.unwindHint ?? ""}`;
    }),
    ``,
    `## ③ 今日轮动新 Alpha 构想 (${sp.id} · R&D 隔离)`,
    `- **${sp.title}**（标的：${sp.instruments}｜先验信心 ${sp.priorConfidencePct}%）`,
    `- 机制：${sp.mechanism}`,
    `- 数据与正交性：${sp.publicFeeds} ｜ ${sp.orthogonality}`,
    `- 成本与证伪风险：${sp.costAndFalsification}`,
    ``,
    `> 诚实 PM 置信度：${entry.pmConfidencePct}% / 100%`,
  ];
  return lines.join("\n");
}

export function AlphaBriefingView({
  tz,
  onBackToPaper,
  onExplain,
}: {
  tz: TzMode;
  onBackToPaper: () => void;
  onExplain: () => void;
}) {
  const [data, setData] = useState<BriefingsBundle | null>(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<AlphaMode>(() => loadJson<AlphaMode>(STORAGE_MODE, "ultra"));
  const [riskNav] = useState<number>(() => loadJson<number>(STORAGE_NAV, 10_000_000));
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [copiedMsg, setCopiedMsg] = useState<string | null>(null);
  const [inspectedIdeaId, setInspectedIdeaId] = useState<string | null>(null);

  const loadData = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("./alpha-briefings.json?_=" + Date.now(), { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = (await r.json()) as BriefingsBundle;
      setData(j);
      setSelectedDate(prev => (prev && j.entries.some(e => e.asOfDate === prev) ? prev : (j.entries[0]?.asOfDate ?? "")));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "载入失败");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { void loadData(); }, []);
  useEffect(() => { try { localStorage.setItem(STORAGE_MODE, JSON.stringify(mode)); } catch {} }, [mode]);

  const entry = useMemo(() => {
    if (!data?.entries.length) return null;
    return data.entries.find(e => e.asOfDate === selectedDate) ?? data.entries[0];
  }, [data, selectedDate]);

  const navScale = riskNav / 10_000_000;

  async function copyMarkdown() {
    if (!entry) return;
    const md = buildMarkdownBrief(entry, mode, navScale, riskNav);
    try {
      await navigator.clipboard.writeText(md);
      setCopiedMsg("已复制完整 Markdown 简报到剪贴板。");
    } catch {
      setCopiedMsg("浏览器未授予剪贴板权限，可直接框选页面文字复制。");
    }
    setTimeout(() => setCopiedMsg(null), 3500);
  }

  if (busy && !data) {
    return <section className="panel glass"><div className="panel-pad"><p className="empty">正在载入云端盘后复盘简报…</p></div></section>;
  }
  if (err || !data || !entry) {
    return (
      <section className="panel glass">
        <div className="panel-pad">
          <p className="empty">暂时无法载入 `alpha-briefings.json`（{err ?? "数据未生成"}）。</p>
          <button type="button" className="action" onClick={() => void loadData()}><RefreshCw size={14} />重试</button>
        </div>
      </section>
    );
  }

  const rev = entry.reviews[mode];
  const nxt = entry.nextAction[mode];
  const reg = entry.regimeDiagnosis;
  const activeIdea = (inspectedIdeaId && data.ideaCatalog.find(i => i.id === inspectedIdeaId)) || entry.researchSpotlight;

  return (
    <div className="alpha-page">
      {/* HERO & ARCHIVE SWITCHER */}
      <section className="panel glass alpha-hero" aria-label="云端盘后复盘简报控制栏">
        <div className="alpha-head-row">
          <div>
            <div className="alpha-badges">
              <span className="alpha-badge ok"><Cloud size={13} />100% 云端自动生成 · 电脑关机一周照常更新</span>
              <span className={"alpha-badge " + (entry.g1AllPassed ? "ok" : "warn")}>
                <ShieldCheck size={13} />G1 零前视 {entry.g1AllPassed ? `PASS (${entry.g1Count})` : "FAIL"}
              </span>
              <span className="alpha-badge neutral">PM 置信度 {entry.pmConfidencePct}% / 100%</span>
            </div>
            <h2>Core3 每日云端盘后复盘与新 Alpha 研究简报 · {entry.asOfDate}</h2>
            <p className="alpha-sub">
              GitHub Actions 每个工作日 <b>17:25 / 18:25 ET（盘后结算）</b> 与 <b>06:25 ET（盘前检查）</b> 在微软云端自动运行纯 Python 引擎生成并永久归档，你在公司直接打开网页即可阅读当日战绩、明日动作与轮动研报构想。
            </p>
          </div>
          <div className="alpha-btn-row">
            <button type="button" className="action" onClick={copyMarkdown}><Copy size={14} />复制 Markdown</button>
            <button type="button" className="action" onClick={onExplain}><GitBranch size={14} />白盒拆解</button>
            <button type="button" className="action" onClick={onBackToPaper}><ArrowLeft size={14} />交易台</button>
            <button type="button" className="action" disabled={busy} onClick={() => void loadData()}>
              <RefreshCw size={14} className={busy ? "spin" : ""} />刷新
            </button>
          </div>
        </div>

        {copiedMsg && <div className="alpha-toast" style={{ marginTop: 10, marginBottom: 0 }}>{copiedMsg}</div>}

        <div className="alpha-controls">
          <div className="alpha-ctrl-group">
            <span className="alpha-ctrl-lbl"><CalendarDays size={12} />归档日期（已自动归档 {data.entries.length} 期 · 最近更新 {formatTs(data.updatedAtUtc, tz)}）</span>
            <div className="chips">
              {data.entries.slice(0, 10).map(e => (
                <button
                  key={e.asOfDate}
                  type="button"
                  className="chip"
                  aria-pressed={e.asOfDate === entry.asOfDate}
                  onClick={() => { setSelectedDate(e.asOfDate); setInspectedIdeaId(null); }}
                >
                  {e.asOfDate}{e.asOfDate === data.latestAsOfDate ? " (最新)" : ""}
                </button>
              ))}
            </div>
          </div>

          <div className="alpha-ctrl-group">
            <span className="alpha-ctrl-lbl">合约模式（展示按 ${riskNav.toLocaleString()} 规模缩放）</span>
            <div className="segmented" role="tablist">
              <button type="button" role="tab" aria-selected={mode === "ultra"} className={mode === "ultra" ? "active" : ""} onClick={() => setMode("ultra")}>
                Ultra (UXY)
              </button>
              <button type="button" role="tab" aria-selected={mode === "enhanced"} className={mode === "enhanced" ? "active" : ""} onClick={() => setMode("enhanced")}>
                Enhanced (TY)
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 1: POST-CLOSE SESSION REVIEW & G6 RECONCILIATION */}
      <section className="panel glass" aria-label="当日收盘复盘与G6三轨验真">
        <div className="panel-header">
          <div>
            <h2><TrendingUp size={17} style={{ verticalAlign: "-2px" }} /> ① 当日收盘复盘与 G6 前瞻锁箱三轨验真</h2>
            <p>自动比对真实 CME 单月期货（H27）vs 零换月实盘 ETF（09:30 早盘 &amp; 16:00 收盘），杜绝换月错觉</p>
          </div>
          <span className="alpha-badge ok"><CheckCircle2 size={13} />G6 进度 {rev.g6Settled} / {rev.g6Target} 天</span>
        </div>
        <div className="panel-pad">
          <div className="brief-summary-card">
            <p>{rev.summary}</p>
          </div>

          <div className="alpha-kpi-grid" style={{ marginTop: 12 }}>
            <div className="alpha-kpi">
              <span>累计 Auto CME 单月净盈亏</span>
              <strong className={rev.cumCmeNetUsd > 0 ? "tone-long" : rev.cumCmeNetUsd < 0 ? "tone-short" : ""}>
                {fmtUsd(rev.cumCmeNetUsd * navScale)}
              </strong>
              <small>{fmtSigned(rev.cumCmeNetPct)}% · {rev.g6Settled} 日已结算{rev.forwardSharpe !== null ? ` · 前瞻 SR ${fmtSigned(rev.forwardSharpe)}` : ""}</small>
            </div>
            <div className="alpha-kpi">
              <span>累计 零换月 ETF 早盘 (09:30)</span>
              <strong className={rev.cumEtfOpenNetUsd > 0 ? "tone-long" : rev.cumEtfOpenNetUsd < 0 ? "tone-short" : ""}>
                {fmtUsd(rev.cumEtfOpenNetUsd * navScale)}
              </strong>
              <small>检验美盘早间执行与隔夜跳空衰减</small>
            </div>
            <div className="alpha-kpi">
              <span>累计 零换月 ETF 收盘 (16:00)</span>
              <strong className={rev.cumEtfCloseNetUsd > 0 ? "tone-long" : rev.cumEtfCloseNetUsd < 0 ? "tone-short" : ""}>
                {fmtUsd(rev.cumEtfCloseNetUsd * navScale)}
              </strong>
              <small>{rev.cmeVsEtfCloseUsd !== null ? `CME−ETF 跟踪差：${fmtUsd(rev.cmeVsEtfCloseUsd * navScale)}` : "待首次结算后自动核对跟踪差"}</small>
            </div>
            <div className="alpha-kpi">
              <span>10 年 OOS 基准锚点</span>
              <strong>SR {fmtSigned(rev.histBenchmarkSr)}</strong>
              <small>历史 MaxDD {rev.histBenchmarkMaxDd}%{rev.forwardHitRatePct !== null ? ` · 前瞻胜率 ${rev.forwardHitRatePct}%` : " · G6 锁参数验真中"}</small>
            </div>
          </div>

          {rev.latestSettled && rev.latestSettled.legs.length > 0 && (
            <>
              <h3 className="alpha-subhead">最新结算期单腿盈亏拆解（{rev.latestSettled.execDate} → {rev.latestSettled.valuationEndDate}）</h3>
              <div className="alpha-table-wrap">
                <table className="alpha-table">
                  <thead>
                    <tr>
                      <th>合约</th>
                      <th className="num">执行手数</th>
                      <th className="num">入场结算价</th>
                      <th className="num">离场结算价</th>
                      <th className="num">单腿毛盈亏</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rev.latestSettled.legs.map(lg => (
                      <tr key={lg.symbol}>
                        <td><strong>{lg.symbol}</strong> <span className="alpha-muted">({lg.leg})</span></td>
                        <td className="num">{fmtLots(Math.round(lg.lots * navScale))} 手</td>
                        <td className="num">{lg.entrySettle.toFixed(4)}</td>
                        <td className="num">{lg.exitSettle.toFixed(4)} <small className="alpha-muted">({lg.exitDate.slice(5)})</small></td>
                        <td className={"num " + (lg.pnlUsd > 0 ? "tone-long" : lg.pnlUsd < 0 ? "tone-short" : "")}>
                          <b>{fmtUsd(lg.pnlUsd * navScale)}</b>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </section>

      {/* SECTION 2: REGIME DIAGNOSIS & NEXT-SESSION EXECUTION / UNWIND PLAN */}
      <section className="panel glass" aria-label="市场格局诊断与下一交易日清单">
        <div className="panel-header">
          <div>
            <h2><Sparkles size={17} style={{ verticalAlign: "-2px" }} /> ② 美债市场格局诊断 &amp; 下一交易日执行/平仓清单（{entry.execDate} → {entry.valuationEndDate}）</h2>
            <p>{reg.dailyMoveSummary}</p>
          </div>
          <span className={"alpha-badge " + (reg.volTone === "warn" ? "warn" : "ok")}>{reg.volRegime}</span>
        </div>
        <div className="panel-pad">
          <div className="brief-regime-grid">
            <div className="brief-mini-box">
              <span>波动阻尼体制</span>
              <strong>{reg.volRegime}</strong>
              <p>{reg.volNote}</p>
            </div>
            <div className="brief-mini-box">
              <span>明日动作判断 ({entry.execDate})</span>
              <strong>{nxt.actionSummary?.headline ?? "见下方合约明细"}</strong>
              <p>{nxt.actionSummary?.subtext ?? ""}</p>
            </div>
            <div className="brief-mini-box">
              <span>平仓 (Unwind) 时间表</span>
              <strong>{nxt.actionSummary?.optimalWindowEt ?? "08:30–11:30 ET"}</strong>
              <p>{nxt.actionSummary?.nextUnwindSummary ?? "无待平仓腿"}{nxt.actionSummary?.preHolidayNote ? ` · ${nxt.actionSummary.preHolidayNote}` : ""}</p>
            </div>
          </div>

          <div className="alpha-table-wrap" style={{ marginTop: 12 }}>
            <table className="alpha-table alpha-order-tbl">
              <thead>
                <tr>
                  <th>真实 CME 合约</th>
                  <th className="num">昨日目标</th>
                  <th className="num">明日目标</th>
                  <th className="num">净变动 (Δ)</th>
                  <th className="num">净 DV01</th>
                  <th>平仓 (Unwind) 倒计时与触发线</th>
                </tr>
              </thead>
              <tbody>
                {nxt.contracts.map(c => {
                  const p = Math.round((c.prevTargetLots ?? 0) * navScale);
                  const t = Math.round(c.targetLots * navScale);
                  const d = t - p;
                  return (
                    <tr key={c.symbol}>
                      <td><strong>{c.symbol}</strong> <span className="alpha-muted">({c.leg})</span></td>
                      <td className="num alpha-muted">{fmtLots(p)} 手</td>
                      <td className={"num alpha-lots " + (t > 0 ? "tone-long" : t < 0 ? "tone-short" : "")}>{fmtLots(t)} 手</td>
                      <td className="num">{fmtLots(d)} 手</td>
                      <td className="num">{fmtUsd(c.targetDv01Usd * navScale)}/bp</td>
                      <td className="alpha-unwind-cell">{c.unwindHint || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* SECTION 3: DAILY ROTATING INSTITUTIONAL R&D ALPHA SPOTLIGHT */}
      <section className="panel glass" aria-label="每日轮动新Alpha研究构想">
        <div className="panel-header">
          <div>
            <h2><Lightbulb size={17} style={{ verticalAlign: "-2px" }} /> ③ 今日新 Alpha 研报构想 · {activeIdea.id}（严格隔离于 G6 锁箱）</h2>
            <p>每天云端自动轮换 1 个面向 2Y–30Y OTR / SOFR / Fed Funds / CME 期货的机构级候选构想（仅作学习与 G6 后 R&amp;D 储备，绝不改动线上实盘 Core3）</p>
          </div>
          <span className="alpha-badge neutral">先验信心 {activeIdea.priorConfidencePct}% · {activeIdea.horizon}</span>
        </div>
        <div className="panel-pad">
          <div className="brief-idea-head">
            <div>
              <span className="brief-cat-pill">{activeIdea.category}</span>
              <h3>{activeIdea.title}</h3>
              <p className="alpha-muted" style={{ margin: "4px 0 0", fontSize: ".81rem" }}>
                <b>适用交易标的：</b>{activeIdea.instruments}
              </p>
            </div>
            {inspectedIdeaId && inspectedIdeaId !== entry.researchSpotlight.id && (
              <button type="button" className="action" onClick={() => setInspectedIdeaId(null)}>回到今日轮动 ({entry.researchSpotlight.id})</button>
            )}
          </div>

          <div className="brief-idea-grid">
            <div className="brief-idea-cell">
              <strong>1. 金融经济学机制（赚谁的钱）</strong>
              <p>{activeIdea.mechanism}</p>
            </div>
            <div className="brief-idea-cell">
              <strong>2. 100% 公开零泄密数据源</strong>
              <p>{activeIdea.publicFeeds}</p>
            </div>
            <div className="brief-idea-cell">
              <strong>3. 与 Core3 低相关性（正交性）</strong>
              <p>{activeIdea.orthogonality}</p>
            </div>
            <div className="brief-idea-cell">
              <strong>4. 交易成本与致命证伪风险</strong>
              <p>{activeIdea.costAndFalsification}</p>
            </div>
          </div>

          <div className="brief-plan-strip">
            <BookOpen size={15} />
            <span><b>待 G6 满 20 日后本地 Python 实验室验证方案：</b>{activeIdea.validationPlan}</span>
          </div>

          {/* Expandable Full 12-Idea Research Catalog */}
          <details className="study-details alpha-gist-details">
            <summary>浏览全部 {data.ideaCatalog.length} 个候选 Alpha 研究库（点击任意条切换精读）</summary>
            <div className="brief-catalog-list">
              {data.ideaCatalog.map(idea => {
                const isToday = idea.id === entry.researchSpotlight.id;
                const isSel = idea.id === activeIdea.id;
                return (
                  <button
                    key={idea.id}
                    type="button"
                    className={"brief-cat-btn" + (isSel ? " active" : "")}
                    onClick={() => setInspectedIdeaId(idea.id)}
                  >
                    <div>
                      <b>{idea.id}</b> · {idea.title}
                      {isToday && <span className="alpha-roll-tag">今日推荐</span>}
                    </div>
                    <small>{idea.category} · {idea.horizon} · 先验 {idea.priorConfidencePct}%</small>
                  </button>
                );
              })}
            </div>
          </details>
        </div>
      </section>
    </div>
  );
}
