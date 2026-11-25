import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, AlertTriangle, CheckCircle2, Cloud, CloudDownload, CloudUpload, Copy, Download,
  GitBranch, Lock, Plus, RefreshCw, ShieldCheck, SlidersHorizontal, Trash2, Upload, Zap,
} from "lucide-react";
import { tzIana, tzShortTag, type TzMode } from "./model";

export type AlphaMode = "ultra" | "enhanced";

export type ContractOrder = {
  leg: string;
  symbol: string;
  contractCode: string;
  rolledAheadOfFnd: boolean;
  refPrice: number;
  refDate: string;
  pointValueUsd: number;
  dv01PerLotUsd: number;
  targetLots: number;
  targetDv01Usd: number;
};

export type TicketSettlement = {
  settledAtUtc: string;
  cmeGrossUsd: number;
  cmeCostUsd: number;
  cmeNetUsd: number;
  cmeNetPct: number;
  etfOpenNetUsd: number | null;
  etfOpenNetPct: number | null;
  etfCloseNetUsd: number | null;
  etfCloseNetPct: number | null;
  legs: { symbol: string; leg: string; lots: number; entrySettle: number; exitSettle: number; exitDate: string; pnlUsd: number }[];
};

export type AlphaTicket = {
  mode: AlphaMode;
  venue: string;
  frozenAtUtc: string;
  panelSha256: string;
  g1Passed: boolean;
  riskNavUsd: number;
  signalAsOfDate: string;
  execDate: string;
  valuationEndDate: string;
  orderWindowEt: string;
  signals: {
    eom: number;
    eomBdaysLeftOnExec: number;
    preAuction: number;
    curve2s10s: number;
    curve5s30s: number;
    z2s10s: number | null;
    z5s30s: number | null;
    damper: number;
    move: number;
    calRollWindow: boolean;
  };
  rpWeights: Record<string, number>;
  contracts: ContractOrder[];
  netDv01Usd: number;
  grossDv01Usd: number;
  status: "PENDING" | "IN_SESSION" | "SETTLED_VERIFIED";
  settlement: TicketSettlement | null;
};

export type ForwardSummary = {
  totalSessionsLogged: number;
  settledSessions: number;
  g6TargetSessions: number;
  g6ProgressPct: number;
  g6Status: "PASS" | "IN_PROGRESS";
  cumCmeNetUsd: number;
  cumCmeNetPct: number;
  cumEtfOpenNetUsd: number;
  cumEtfCloseNetUsd: number;
  forwardSharpe: number | null;
  forwardMaxDdPct: number;
  forwardHitRatePct: number | null;
  equityCurve: { date: string; cmeCumUsd: number; etfOpenCumUsd: number; etfCloseCumUsd: number }[];
  ledgerRows: AlphaTicket[];
};

export type HistModelStats = {
  n: number;
  sharpe: number;
  cagr_pct: number;
  max_dd_pct: number;
  worst_day_pct: number;
  calmar: number;
  hac_t: number;
  r4Sr: number;
  posYears: number;
  totalYears: number;
  nEff: number;
  yearly: Record<string, { retPct: number; sr: number }>;
};

export type AlphaPaperBundle = {
  schemaVersion: string;
  generatedAtUtc: string;
  defaultMode: AlphaMode;
  freezeDate: string;
  panelAsOfDate: string;
  panelSha256: string;
  tradingDaysInHistory: number;
  auctionsTracked: number;
  g1Verification: { allPassed: boolean; passedCount: number; totalChecks: number; checks: Record<string, boolean> };
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
  todayTickets: Record<AlphaMode, AlphaTicket>;
  forward: Record<AlphaMode, ForwardSummary>;
  contractSettles: Record<string, { leg: string; pointValueUsd: number; ctdModDur: number; prices: Record<string, number> }>;
  historical10yOos: {
    sampleRange: string;
    models: Record<string, HistModelStats>;
    bootstraps: Record<string, { p05: number; p50: number; p95: number; prob_above_100: number }>;
    monthlyEquity: { date: string; ultra: number; enhanced: number; etfOpen: number; etfClose: number }[];
  };
};

type UserFill = {
  id: string;
  loggedAtUtc: string;
  execDate: string;
  execTimeEt: string;
  mode: AlphaMode;
  symbol: string;
  leg: string;
  lots: number;
  fillPrice: number;
  refSettlePrice: number | null;
  notes: string;
};

type GistConfig = { token: string; gistId: string };

const STORAGE_FILLS = "ust-alpha-fills-v1";
const STORAGE_NAV = "ust-alpha-risk-nav-v1";
const STORAGE_MODE = "ust-alpha-mode-v1";
const STORAGE_GIST = "ust-alpha-gist-sync-v1";

const fmtUsd = (v: number) => (v > 0 ? "+" : v < 0 ? "-" : "") + "$" + Math.abs(Math.round(v)).toLocaleString("en-US");
const fmtSigned = (v: number, d = 2) => (v > 0 ? "+" : "") + v.toFixed(d);
const statusLabel = (s: AlphaTicket["status"]) =>
  s === "SETTLED_VERIFIED" ? "已结算验证" : s === "IN_SESSION" ? "持仓中" : "已冻结 · 待开盘";

function formatTs(iso: string, tz: TzMode) {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: tzIana(tz), month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).format(new Date(iso)) + " " + tzShortTag(tz);
  } catch {
    return iso.slice(0, 16);
  }
}

function daysSinceIso(dateStr: string): number {
  const diff = Date.now() - Date.parse(dateStr + "T21:00:00Z");
  return Math.max(0, Math.floor(diff / 86400000));
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function computeFillMetrics(fill: UserFill, settles: AlphaPaperBundle["contractSettles"]) {
  const meta = settles[fill.symbol];
  const ptVal = meta?.pointValueUsd ?? (fill.leg === "TU" ? 2000 : 1000);
  const ctdDur = meta?.ctdModDur ?? 6.08;
  const prices = meta?.prices ?? {};
  const entryRef = prices[fill.execDate] ?? fill.refSettlePrice;
  // Positive slippage = worse than reference settle (paid higher to buy, sold lower to sell)
  let slippageBp: number | null = null;
  if (entryRef && entryRef > 0) {
    const dir = fill.lots >= 0 ? 1 : -1;
    const priceDiffPct = ((fill.fillPrice - entryRef) / entryRef) * dir;
    slippageBp = (priceDiffPct / ctdDur) * 10000;
  }
  const afterDates = Object.keys(prices).filter(d => d > fill.execDate).sort();
  let nextExitDate: string | null = null;
  let nextExitPx: number | null = null;
  let realizedUsd: number | null = null;
  if (afterDates.length > 0) {
    nextExitDate = afterDates[0];
    nextExitPx = prices[nextExitDate];
    realizedUsd = fill.lots * (nextExitPx - fill.fillPrice) * ptVal;
  }
  return { ptVal, entryRef, slippageBp, nextExitDate, nextExitPx, realizedUsd };
}

function EquityChart({
  tab,
  monthly,
  forwardCurve,
  navScale,
}: {
  tab: "hist" | "forward";
  monthly: AlphaPaperBundle["historical10yOos"]["monthlyEquity"];
  forwardCurve: ForwardSummary["equityCurve"];
  navScale: number;
}) {
  if (tab === "forward") {
    if (forwardCurve.length < 2) {
      return (
        <div className="alpha-empty-chart">
          <Zap size={22} />
          <div>
            <strong>前瞻锁箱已于 2026-11-25 正式冻结启动</strong>
            <p>GitHub Actions 每日 17:25 ET / 06:25 ET 自动追踪 H27 单月期货与零换月 ETF（09:30 早盘 / 16:00 收盘）。满 2 个已结算前瞻交易日后自动绘制实时净值曲线；可先切至右侧「10 年 OOS 基准」查看历史表现。</p>
          </div>
        </div>
      );
    }
    const W = 720, H = 220, padL = 56, padR = 16, padT = 18, padB = 28;
    const vals = forwardCurve.flatMap(p => [p.cmeCumUsd * navScale, p.etfOpenCumUsd * navScale, p.etfCloseCumUsd * navScale, 0]);
    const minV = Math.min(...vals), maxV = Math.max(...vals);
    const span = Math.max(100, maxV - minV);
    const sx = (i: number) => padL + (i / Math.max(1, forwardCurve.length - 1)) * (W - padL - padR);
    const sy = (v: number) => padT + ((maxV - v) / span) * (H - padT - padB);
    const pathFor = (fn: (p: typeof forwardCurve[0]) => number) =>
      forwardCurve.map((p, i) => `${i === 0 ? "M" : "L"}${sx(i).toFixed(1)},${sy(fn(p) * navScale).toFixed(1)}`).join(" ");
    return (
      <div className="alpha-chart-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} className="alpha-svg" role="img" aria-label="前瞻纸面累计净值曲线">
          <line x1={padL} x2={W - padR} y1={sy(0)} y2={sy(0)} stroke="currentColor" strokeOpacity="0.2" strokeDasharray="4 4" />
          <path d={pathFor(p => p.etfOpenCumUsd)} fill="none" stroke="#d97706" strokeWidth="1.9" />
          <path d={pathFor(p => p.etfCloseCumUsd)} fill="none" stroke="#0d9488" strokeWidth="2.0" />
          <path d={pathFor(p => p.cmeCumUsd)} fill="none" stroke="#2563eb" strokeWidth="2.6" />
          <text x={padL - 6} y={padT + 4} textAnchor="end" className="alpha-svg-lbl">{fmtUsd(maxV)}</text>
          <text x={padL - 6} y={H - padB} textAnchor="end" className="alpha-svg-lbl">{fmtUsd(minV)}</text>
          <text x={padL} y={H - 8} className="alpha-svg-lbl">{forwardCurve[0].date}</text>
          <text x={W - padR} y={H - 8} textAnchor="end" className="alpha-svg-lbl">{forwardCurve.at(-1)!.date}</text>
        </svg>
        <div className="alpha-legend">
          <span><i style={{ background: "#2563eb" }} />Auto CME 单月期货 (净值)</span>
          <span><i style={{ background: "#0d9488" }} />Auto 零换月 ETF 收盘 (16:00 ET)</span>
          <span><i style={{ background: "#d97706" }} />Auto 零换月 ETF 早盘 (09:30 ET)</span>
        </div>
      </div>
    );
  }

  const W = 720, H = 225, padL = 48, padR = 16, padT = 18, padB = 28;
  const vals = monthly.flatMap(p => [p.ultra, p.enhanced, p.etfOpen, p.etfClose, 1.0]);
  const minV = Math.min(...vals) * 0.98, maxV = Math.max(...vals) * 1.02;
  const span = Math.max(0.1, maxV - minV);
  const sx = (i: number) => padL + (i / Math.max(1, monthly.length - 1)) * (W - padL - padR);
  const sy = (v: number) => padT + ((maxV - v) / span) * (H - padT - padB);
  const pathFor = (fn: (p: typeof monthly[0]) => number) =>
    monthly.map((p, i) => `${i === 0 ? "M" : "L"}${sx(i).toFixed(1)},${sy(fn(p)).toFixed(1)}`).join(" ");
  const last = monthly.at(-1)!;
  return (
    <div className="alpha-chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="alpha-svg" role="img" aria-label="10年严格样本外净值曲线">
        <line x1={padL} x2={W - padR} y1={sy(1.0)} y2={sy(1.0)} stroke="currentColor" strokeOpacity="0.2" strokeDasharray="4 4" />
        <path d={pathFor(p => p.etfOpen)} fill="none" stroke="#d97706" strokeWidth="1.8" />
        <path d={pathFor(p => p.etfClose)} fill="none" stroke="#0d9488" strokeWidth="1.9" />
        <path d={pathFor(p => p.enhanced)} fill="none" stroke="#10b981" strokeWidth="2.1" />
        <path d={pathFor(p => p.ultra)} fill="none" stroke="#2563eb" strokeWidth="2.6" />
        <text x={padL - 6} y={padT + 4} textAnchor="end" className="alpha-svg-lbl">{maxV.toFixed(2)}x</text>
        <text x={padL - 6} y={sy(1.0) + 3} textAnchor="end" className="alpha-svg-lbl">1.00x</text>
        <text x={padL} y={H - 8} className="alpha-svg-lbl">{monthly[0].date.slice(0, 7)}</text>
        <text x={W / 2} y={H - 8} textAnchor="middle" className="alpha-svg-lbl">{monthly[Math.floor(monthly.length / 2)].date.slice(0, 7)}</text>
        <text x={W - padR} y={H - 8} textAnchor="end" className="alpha-svg-lbl">{last.date.slice(0, 7)}</text>
      </svg>
      <div className="alpha-legend">
        <span><i style={{ background: "#2563eb" }} />Core3 Ultra ({last.ultra.toFixed(2)}x)</span>
        <span><i style={{ background: "#10b981" }} />Core3 Enhanced ({last.enhanced.toFixed(2)}x)</span>
        <span><i style={{ background: "#0d9488" }} />零换月 ETF 16:00 收盘 ({last.etfClose.toFixed(2)}x)</span>
        <span><i style={{ background: "#d97706" }} />零换月 ETF 09:30 早盘 ({last.etfOpen.toFixed(2)}x)</span>
      </div>
    </div>
  );
}

export function AlphaPaperView({ tz, onExplain }: { tz: TzMode; onExplain?: () => void }) {
  const [data, setData] = useState<AlphaPaperBundle | null>(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<AlphaMode>(() => loadJson<AlphaMode>(STORAGE_MODE, "ultra"));
  const [riskNav, setRiskNav] = useState<number>(() => loadJson<number>(STORAGE_NAV, 10_000_000));
  const [chartTab, setChartTab] = useState<"hist" | "forward">("hist");
  const [fills, setFills] = useState<UserFill[]>(() => loadJson<UserFill[]>(STORAGE_FILLS, []));
  const [gistCfg, setGistCfg] = useState<GistConfig>(() => loadJson<GistConfig>(STORAGE_GIST, { token: "", gistId: "" }));
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);

  // Batch & single fill form state
  const [batchDraft, setBatchDraft] = useState<{ symbol: string; leg: string; lots: string; fillPrice: string; refPrice: number; timeEt: string; notes: string }[] | null>(null);
  const [singleForm, setSingleForm] = useState({ execDate: "", execTimeEt: "09:30", symbol: "", leg: "UXY", lots: "", fillPrice: "", notes: "" });
  const journalRef = useRef<HTMLElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadData = async () => {
    setBusy(true);
    setErr(null);
    try {
      const resp = await fetch("./alpha-paper.json?_=" + Date.now(), { cache: "no-store" });
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const json = (await resp.json()) as AlphaPaperBundle;
      setData(json);
      if (json.forward[mode]?.settledSessions >= 2) setChartTab("forward");
      const tk = json.todayTickets[mode];
      setSingleForm(prev => prev.execDate ? prev : {
        ...prev,
        execDate: tk.execDate,
        symbol: tk.contracts[0]?.symbol ?? "",
        leg: tk.contracts[0]?.leg ?? "TU",
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "载入失败");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { void loadData(); }, []);
  useEffect(() => { try { localStorage.setItem(STORAGE_MODE, JSON.stringify(mode)); } catch {} }, [mode]);
  useEffect(() => { try { localStorage.setItem(STORAGE_NAV, JSON.stringify(riskNav)); } catch {} }, [riskNav]);
  useEffect(() => { try { localStorage.setItem(STORAGE_FILLS, JSON.stringify(fills)); } catch {} }, [fills]);
  useEffect(() => { try { localStorage.setItem(STORAGE_GIST, JSON.stringify(gistCfg)); } catch {} }, [gistCfg]);

  const navScale = riskNav / 10_000_000;
  const ticket = data?.todayTickets[mode] ?? null;
  const fwd = data?.forward[mode] ?? null;

  const fillMetrics = useMemo(() => {
    if (!data) return { rows: [] as (UserFill & ReturnType<typeof computeFillMetrics>)[], meanSlipBp: null as number | null, totalRealizedUsd: 0, settledCount: 0 };
    const rows = fills.map(f => ({ ...f, ...computeFillMetrics(f, data.contractSettles) }));
    const slips = rows.map(r => r.slippageBp).filter((v): v is number => v !== null && Number.isFinite(v));
    const realized = rows.map(r => r.realizedUsd).filter((v): v is number => v !== null && Number.isFinite(v));
    return {
      rows,
      meanSlipBp: slips.length ? slips.reduce((a, b) => a + b, 0) / slips.length : null,
      totalRealizedUsd: realized.reduce((a, b) => a + b, 0),
      settledCount: realized.length,
    };
  }, [fills, data]);

  function openBatchFromTicket() {
    if (!ticket) return;
    const active = ticket.contracts
      .map(c => ({ ...c, scaledLots: Math.round(c.targetLots * navScale) }))
      .filter(c => c.scaledLots !== 0);
    const list = (active.length ? active : ticket.contracts.map(c => ({ ...c, scaledLots: Math.round(c.targetLots * navScale) }))).map(c => ({
      symbol: c.symbol,
      leg: c.leg,
      lots: String(c.scaledLots),
      fillPrice: String(c.refPrice),
      refPrice: c.refPrice,
      timeEt: "09:30",
      notes: `${mode.toUpperCase()} Core3`,
    }));
    setBatchDraft(list);
    journalRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function saveBatchDraft() {
    if (!batchDraft || !ticket) return;
    const nowIso = new Date().toISOString();
    const added: UserFill[] = [];
    for (const row of batchDraft) {
      const lots = Math.round(Number(row.lots));
      const px = Number(row.fillPrice);
      if (!lots || !Number.isFinite(px) || px <= 0) continue;
      added.push({
        id: `${ticket.execDate}-${row.symbol}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        loggedAtUtc: nowIso,
        execDate: ticket.execDate,
        execTimeEt: row.timeEt || "09:30",
        mode,
        symbol: row.symbol,
        leg: row.leg,
        lots,
        fillPrice: px,
        refSettlePrice: row.refPrice,
        notes: row.notes,
      });
    }
    if (added.length) {
      setFills(prev => [...added, ...prev]);
      setBatchDraft(null);
      setSyncMsg(`已保存 ${added.length} 笔成交到本地私密账本（绝未上传公开仓库）。`);
    }
  }

  function saveSingleFill(e: React.FormEvent) {
    e.preventDefault();
    const lots = Math.round(Number(singleForm.lots));
    const px = Number(singleForm.fillPrice);
    if (!singleForm.execDate || !singleForm.symbol || !lots || !Number.isFinite(px) || px <= 0) {
      setSyncMsg("请填写完整的执行日、合约代码、非零手数与成交价。");
      return;
    }
    const refPx = data?.contractSettles[singleForm.symbol.toUpperCase()]?.prices[singleForm.execDate] ?? null;
    const item: UserFill = {
      id: `${singleForm.execDate}-${singleForm.symbol.toUpperCase()}-${Date.now()}`,
      loggedAtUtc: new Date().toISOString(),
      execDate: singleForm.execDate,
      execTimeEt: singleForm.execTimeEt || "09:30",
      mode,
      symbol: singleForm.symbol.toUpperCase(),
      leg: singleForm.leg.toUpperCase(),
      lots,
      fillPrice: px,
      refSettlePrice: refPx,
      notes: singleForm.notes,
    };
    setFills(prev => [item, ...prev]);
    setSingleForm(prev => ({ ...prev, lots: "", fillPrice: "", notes: "" }));
    setSyncMsg(`已记录 ${item.symbol} ${item.lots > 0 ? "+" : ""}${item.lots} 手 @ ${item.fillPrice}。`);
  }

  function exportFillsJson() {
    const blob = new Blob([JSON.stringify({ exportedAtUtc: new Date().toISOString(), fills }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ust-alpha-private-fills-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importFillsJson(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const arr: UserFill[] = Array.isArray(parsed) ? parsed : Array.isArray(parsed.fills) ? parsed.fills : [];
        const byId = new Map(fills.map(f => [f.id, f]));
        for (const f of arr) if (f && f.id) byId.set(f.id, f);
        setFills([...byId.values()].sort((a, b) => b.loggedAtUtc.localeCompare(a.loggedAtUtc)));
        setSyncMsg(`已导入并去重合并 ${arr.length} 条记录。`);
      } catch {
        setSyncMsg("导入失败：JSON 格式无效。");
      }
    };
    reader.readAsText(file);
    ev.target.value = "";
  }

  async function createPrivateGist() {
    if (!gistCfg.token.trim()) { setSyncMsg("请先粘贴仅含 gist 权限的 GitHub Token。"); return; }
    setSyncBusy(true); setSyncMsg(null);
    try {
      const resp = await fetch("https://api.github.com/gists", {
        method: "POST",
        headers: { Authorization: `Bearer ${gistCfg.token.trim()}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
        body: JSON.stringify({
          description: "UST Core3 Private Paper Trading Fills (Secret — Do Not Share)",
          public: false,
          files: { "ust-alpha-private-fills.json": { content: JSON.stringify({ updatedAtUtc: new Date().toISOString(), fills }, null, 2) } },
        }),
      });
      if (!resp.ok) throw new Error("GitHub API HTTP " + resp.status);
      const body = await resp.json() as { id: string };
      setGistCfg(prev => ({ ...prev, gistId: body.id }));
      setSyncMsg(`已创建私密 Secret Gist (${body.id}) 并上传当前 ${fills.length} 条记录！把这个 ID 和 Token 填到另一台设备即可跨端私密同步。`);
    } catch (e) {
      setSyncMsg("创建私密 Gist 失败：" + (e instanceof Error ? e.message : "请检查 Token 是否勾选 gist 权限"));
    } finally { setSyncBusy(false); }
  }

  async function pushToPrivateGist() {
    if (!gistCfg.token.trim() || !gistCfg.gistId.trim()) { setSyncMsg("请填写 Token 与 Secret Gist ID。"); return; }
    setSyncBusy(true); setSyncMsg(null);
    try {
      const resp = await fetch(`https://api.github.com/gists/${encodeURIComponent(gistCfg.gistId.trim())}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${gistCfg.token.trim()}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
        body: JSON.stringify({
          files: { "ust-alpha-private-fills.json": { content: JSON.stringify({ updatedAtUtc: new Date().toISOString(), fills }, null, 2) } },
        }),
      });
      if (!resp.ok) throw new Error("GitHub API HTTP " + resp.status);
      setSyncMsg(`已私密上传 ${fills.length} 条成交至 Secret Gist (${gistCfg.gistId.slice(0, 8)}…)。`);
    } catch (e) {
      setSyncMsg("上传失败：" + (e instanceof Error ? e.message : "网络或权限错误"));
    } finally { setSyncBusy(false); }
  }

  async function pullFromPrivateGist() {
    if (!gistCfg.token.trim() || !gistCfg.gistId.trim()) { setSyncMsg("请填写 Token 与 Secret Gist ID。"); return; }
    setSyncBusy(true); setSyncMsg(null);
    try {
      const resp = await fetch(`https://api.github.com/gists/${encodeURIComponent(gistCfg.gistId.trim())}`, {
        headers: { Authorization: `Bearer ${gistCfg.token.trim()}`, Accept: "application/vnd.github+json" },
      });
      if (!resp.ok) throw new Error("GitHub API HTTP " + resp.status);
      const body = await resp.json() as { files?: Record<string, { content?: string }> };
      const raw = body.files?.["ust-alpha-private-fills.json"]?.content;
      if (!raw) throw new Error("Gist 中未找到 ust-alpha-private-fills.json");
      const parsed = JSON.parse(raw) as { fills?: UserFill[] };
      const incoming = Array.isArray(parsed.fills) ? parsed.fills : [];
      const byId = new Map(fills.map(f => [f.id, f]));
      for (const f of incoming) if (f && f.id) byId.set(f.id, f);
      const merged = [...byId.values()].sort((a, b) => b.loggedAtUtc.localeCompare(a.loggedAtUtc));
      setFills(merged);
      setSyncMsg(`已从私密 Secret Gist 拉取并合并，当前共 ${merged.length} 条成交记录。`);
    } catch (e) {
      setSyncMsg("拉取失败：" + (e instanceof Error ? e.message : "网络或权限错误"));
    } finally { setSyncBusy(false); }
  }

  if (busy && !data) {
    return <section className="panel glass"><div className="panel-pad"><p className="empty">正在载入 Python Core3 纸面交易数据…</p></div></section>;
  }
  if (err || !data || !ticket || !fwd) {
    return (
      <section className="panel glass">
        <div className="panel-pad">
          <p className="empty">暂时无法载入 `alpha-paper.json`（{err ?? "数据未生成"}）。</p>
          <button type="button" className="action" onClick={() => void loadData()}><RefreshCw size={14} />重试载入</button>
        </div>
      </section>
    );
  }

  const staleDays = daysSinceIso(data.panelAsOfDate);
  const isFresh = staleDays <= 4; // accounts for Fri->Mon + Thanksgiving Thu
  const histModel = data.historical10yOos.models[mode === "ultra" ? "ultra_50k" : "enhanced_50k"];
  const hist3x = data.historical10yOos.models[mode === "ultra" ? "ultra_3x" : "enhanced_3x"];
  const histBoot = data.historical10yOos.bootstraps[mode];

  return (
    <div className="alpha-page">
      {/* 1. HEADER & MODE / SCALE CONTROLS */}
      <section className="panel glass alpha-hero" aria-label="Core3 纯美债纸面交易控制栏">
        <div className="alpha-head-row">
          <div>
            <div className="alpha-badges">
              <span className={"alpha-badge " + (data.g1Verification.allPassed ? "ok" : "warn")}>
                <ShieldCheck size={13} />G1 零前视 {data.g1Verification.allPassed ? `PASS (${data.g1Verification.passedCount}/${data.g1Verification.totalChecks})` : "FAIL"}
              </span>
              <span className={"alpha-badge " + (isFresh ? "ok" : "warn")}>
                {isFresh ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
                数据截至 {data.panelAsOfDate} {isFresh ? "· 新鲜" : `· 滞后 ${staleDays} 天`}
              </span>
              <span className="alpha-badge neutral">100% 纯 Python 云端自动结算</span>
            </div>
            <h2>Core3 极简 3 支柱纯美债 · 云端纸面交易与 G6 验证台</h2>
            <p className="alpha-sub">
              零 FRED / 零跨资产 Ridge · 仅含 <b>月末延展 + 已公告拍前空头 + 2s10s/5s30s 曲线自身回归</b> + 单层 ^MOVE 波动阻尼。GitHub Actions 工作日 17:25 ET &amp; 06:25 ET 自动锁仓并核对盈亏，无需开个人电脑。
            </p>
          </div>
          <div className="alpha-btn-row">
            {onExplain && (
              <button type="button" className="action" onClick={onExplain}>
                <GitBranch size={14} />信号白盒拆解
              </button>
            )}
            <button type="button" className="action" disabled={busy} onClick={() => void loadData()}>
              <RefreshCw size={14} className={busy ? "spin" : ""} />刷新快照
            </button>
          </div>
        </div>

        <div className="alpha-controls">
          <div className="alpha-ctrl-group">
            <span className="alpha-ctrl-lbl">主力合约模式</span>
            <div className="segmented" role="tablist" aria-label="选择期货模式">
              <button type="button" role="tab" aria-selected={mode === "ultra"} className={mode === "ultra" ? "active" : ""} onClick={() => setMode("ultra")}>
                Ultra (TU/FV/UXY/WN · 默认)
              </button>
              <button type="button" role="tab" aria-selected={mode === "enhanced"} className={mode === "enhanced" ? "active" : ""} onClick={() => setMode("enhanced")}>
                Enhanced (TU/FV/TY/WN)
              </button>
            </div>
          </div>

          <div className="alpha-ctrl-group">
            <span className="alpha-ctrl-lbl"><SlidersHorizontal size={12} />风险资金缩放（纯展示缩放手数与 DV01）</span>
            <div className="chips">
              {[
                { nav: 200_000, label: "$200k (~1k DV01)" },
                { nav: 1_000_000, label: "$1M (~5k DV01)" },
                { nav: 10_000_000, label: "$10M (~50k DV01)" },
              ].map(opt => (
                <button key={opt.nav} type="button" className="chip" aria-pressed={riskNav === opt.nav} onClick={() => setRiskNav(opt.nav)}>
                  {opt.label}
                </button>
              ))}
              <label className="alpha-nav-input">
                <span>$</span>
                <input
                  type="number"
                  min={50000}
                  step={100000}
                  value={riskNav}
                  aria-label="自定义风险资本美元"
                  onChange={e => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 10000) setRiskNav(v); }}
                />
              </label>
            </div>
          </div>
        </div>
      </section>

      {/* 2. TODAY'S ACTIONABLE 07:00-17:00 ET ORDER TICKET */}
      <section className="panel glass" aria-label="今日交易指令单">
        <div className="panel-header">
          <div>
            <h2>今日可下单指令单 · {ticket.orderWindowEt}</h2>
            <p>
              信号截至 <b>{ticket.signalAsOfDate} 16:00 ET</b> · 精确估值结算区间 <b>{ticket.execDate} → {ticket.valuationEndDate}</b> · 状态：<b>{statusLabel(ticket.status)}</b>
            </p>
          </div>
          <div className="alpha-btn-row">
            {onExplain && (
              <button type="button" className="action" onClick={onExplain}>
                <GitBranch size={14} />今日怎么算的？
              </button>
            )}
            <button type="button" className="action alpha-primary-btn" onClick={openBatchFromTicket}>
              <Plus size={15} />一键按今日指令录入成交
            </button>
          </div>
        </div>

        <div className="panel-pad">
          {ticket.signals.calRollWindow && (
            <div className="alpha-callout">
              <Zap size={15} />
              <span>当前处于 CME 季度交割换月窗口（距第一通知日 ≤ 5 个交易日），以下单月合约代码已自动切换为下季主力 <b>H27</b>，无交割风险。</span>
            </div>
          )}

          {/* Live 3-Pillar Signal Status Strip */}
          <div className="alpha-signal-grid">
            <div className="alpha-sig-card">
              <span>P2 · 月末延展 (EOM)</span>
              <strong className={ticket.signals.eom > 0 ? "tone-long" : "tone-flat"}>
                {ticket.signals.eom > 0 ? "做多 +1" : "空仓 0"}
              </strong>
              <small>执行日距月末剩 {ticket.signals.eomBdaysLeftOnExec} 交易日</small>
            </div>
            <div className="alpha-sig-card">
              <span>P2 · 已公告拍前空头</span>
              <strong className={ticket.signals.preAuction < 0 ? "tone-short" : "tone-flat"}>
                {ticket.signals.preAuction < 0 ? "做空 -1" : "空仓 0"}
              </strong>
              <small>严格要求 announcementDate ≤ T-1</small>
            </div>
            <div className="alpha-sig-card">
              <span>P5a · 2s10s 自身回归</span>
              <strong className={ticket.signals.curve2s10s > 0 ? "tone-long" : ticket.signals.curve2s10s < 0 ? "tone-short" : "tone-flat"}>
                {ticket.signals.curve2s10s > 0 ? "做陡 +1" : ticket.signals.curve2s10s < 0 ? "做平 -1" : "死区空仓 0"}
              </strong>
              <small>Z = {ticket.signals.z2s10s !== null ? fmtSigned(ticket.signals.z2s10s) : "—"}（±1.25 进 / ±0.35 出）</small>
            </div>
            <div className="alpha-sig-card">
              <span>P5c · 5s30s 自身回归</span>
              <strong className={ticket.signals.curve5s30s > 0 ? "tone-long" : ticket.signals.curve5s30s < 0 ? "tone-short" : "tone-flat"}>
                {ticket.signals.curve5s30s > 0 ? "做陡 +1" : ticket.signals.curve5s30s < 0 ? "做平 -1" : "死区空仓 0"}
              </strong>
              <small>Z = {ticket.signals.z5s30s !== null ? fmtSigned(ticket.signals.z5s30s) : "—"}（±1.25 进 / ±0.35 出）</small>
            </div>
            <div className="alpha-sig-card">
              <span>单层 ^MOVE 波动阻尼</span>
              <strong className={ticket.signals.damper < 0.99 ? "tone-warn" : "tone-long"}>
                {ticket.signals.damper.toFixed(2)}×
              </strong>
              <small>^MOVE = {ticket.signals.move.toFixed(1)} · 仅减仓不加杠杆</small>
            </div>
          </div>

          {/* Aggregated Net Live Contract Orders Table */}
          <div className="alpha-table-wrap">
            <table className="alpha-table">
              <thead>
                <tr>
                  <th>真实 CME 合约</th>
                  <th>方向</th>
                  <th className="num">目标手数 ({riskNav >= 1_000_000 ? `$${(riskNav / 1_000_000).toFixed(1)}M` : `$${Math.round(riskNav / 1000)}k`})</th>
                  <th className="num">净 DV01</th>
                  <th className="num">参考结算价</th>
                  <th className="num">点值 / 单手 DV01</th>
                </tr>
              </thead>
              <tbody>
                {ticket.contracts.map(c => {
                  const scaledLots = Math.round(c.targetLots * navScale);
                  const scaledDv01 = c.targetDv01Usd * navScale;
                  const dir = scaledLots > 0 ? "long" : scaledLots < 0 ? "short" : "flat";
                  return (
                    <tr key={c.symbol}>
                      <td>
                        <strong>{c.symbol}</strong> <span className="alpha-muted">({c.leg})</span>
                        {c.rolledAheadOfFnd && <span className="alpha-roll-tag">H27</span>}
                      </td>
                      <td>
                        <span className={"alpha-dir-pill " + dir}>
                          {dir === "long" ? "做多 LONG" : dir === "short" ? "做空 SHORT" : "空仓 FLAT"}
                        </span>
                      </td>
                      <td className={"num alpha-lots " + dir}>{scaledLots > 0 ? `+${scaledLots}` : scaledLots} 手</td>
                      <td className="num">{fmtUsd(scaledDv01)}/bp</td>
                      <td className="num">{c.refPrice.toFixed(4)} <small className="alpha-muted">({c.refDate.slice(5)})</small></td>
                      <td className="num">${c.pointValueUsd.toLocaleString()} · ~${c.dv01PerLotUsd.toFixed(0)}/bp</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="alpha-ticket-foot">
            <span><b>净久期 DV01：</b>{fmtUsd(ticket.netDv01Usd * navScale)}/bp（毛腿 {fmtUsd(ticket.grossDv01Usd * navScale)}/bp · 合计 {ticket.contracts.reduce((s, c) => s + Math.abs(Math.round(c.targetLots * navScale)), 0)} 手）</span>
            <span className="alpha-muted">RP 权重: P2 {ticket.rpWeights.P2_Flow} / 2s10s {ticket.rpWeights.P5a_2s10s} / 5s30s {ticket.rpWeights.P5c_5s30s} · 2Y {data.marketSnapshot.ust2y}% / 10Y {data.marketSnapshot.ust10y}% / 30Y {data.marketSnapshot.ust30y}%</span>
          </div>
        </div>
      </section>

      {/* 3. AUTOMATIC CLOUD PAPER TRACKING & G6 FORWARD LOCKBOX */}
      <section className="panel glass" aria-label="云端全自动前瞻跟踪与G6锁箱">
        <div className="panel-header">
          <div>
            <h2>全自动前瞻跟踪与 G6 锁箱验证 · {mode === "ultra" ? "Core3 Ultra" : "Core3 Enhanced"}</h2>
            <p>自冻结日 <b>{data.freezeDate}</b> 起由 GitHub Actions 每日自动锁单并按真实单月期货 &amp; 零换月 ETF 双轨结算 · 最近云端更新：{formatTs(data.generatedAtUtc, tz)}</p>
          </div>
          <div className="segmented">
            <button type="button" className={chartTab === "forward" ? "active" : ""} onClick={() => setChartTab("forward")}>前瞻纸面曲线</button>
            <button type="button" className={chartTab === "hist" ? "active" : ""} onClick={() => setChartTab("hist")}>10 年 OOS 基准</button>
          </div>
        </div>

        <div className="panel-pad">
          {/* G6 Lockbox Progress Bar */}
          <div className="alpha-g6-bar">
            <div className="alpha-g6-head">
              <span><strong>G6 真实前瞻锁箱进度</strong>（G1–G5 已全部 PASS，需累积 ≥ {fwd.g6TargetSessions} 个冻结后已结算交易日）</span>
              <b>{fwd.settledSessions} / {fwd.g6TargetSessions} 天 ({fwd.g6ProgressPct}%)</b>
            </div>
            <div className="alpha-progress-track"><span style={{ width: `${Math.max(4, fwd.g6ProgressPct)}%` }} /></div>
          </div>

          {/* 4 Live Forward KPIs */}
          <div className="alpha-kpi-grid">
            <div className="alpha-kpi">
              <span>Auto CME 单月期货累计净盈亏</span>
              <strong className={fwd.cumCmeNetUsd > 0 ? "tone-long" : fwd.cumCmeNetUsd < 0 ? "tone-short" : ""}>
                {fmtUsd(fwd.cumCmeNetUsd * navScale)}
              </strong>
              <small>{fmtSigned(fwd.cumCmeNetPct, 2)}% · {fwd.settledSessions} 日已结算{fwd.forwardSharpe !== null ? ` · SR ${fmtSigned(fwd.forwardSharpe)}` : ""}</small>
            </div>
            <div className="alpha-kpi">
              <span>Auto 零换月 ETF 早盘 (09:30 ET)</span>
              <strong className={fwd.cumEtfOpenNetUsd > 0 ? "tone-long" : fwd.cumEtfOpenNetUsd < 0 ? "tone-short" : ""}>
                {fmtUsd(fwd.cumEtfOpenNetUsd * navScale)}
              </strong>
              <small>SHY/IEI/IEF/TLT - BIL · 零换月校验</small>
            </div>
            <div className="alpha-kpi">
              <span>Auto 零换月 ETF 收盘 (16:00 ET)</span>
              <strong className={fwd.cumEtfCloseNetUsd > 0 ? "tone-long" : fwd.cumEtfCloseNetUsd < 0 ? "tone-short" : ""}>
                {fmtUsd(fwd.cumEtfCloseNetUsd * navScale)}
              </strong>
              <small>与 CME H27 逐日交叉核验</small>
            </div>
            <div className="alpha-kpi">
              <span>我的私密实录盈亏 &amp; 平均滑点</span>
              <strong className={fillMetrics.totalRealizedUsd > 0 ? "tone-long" : fillMetrics.totalRealizedUsd < 0 ? "tone-short" : ""}>
                {fmtUsd(fillMetrics.totalRealizedUsd)}
              </strong>
              <small>
                {fills.length} 笔录单 · 均滑点 {fillMetrics.meanSlipBp !== null ? `${fmtSigned(fillMetrics.meanSlipBp, 3)} bp` : "—"}（预算 0.05bp）
              </small>
            </div>
          </div>

          <EquityChart tab={chartTab} monthly={data.historical10yOos.monthlyEquity} forwardCurve={fwd.equityCurve} navScale={navScale} />

          {/* Immutable Forward Daily Ledger */}
          <h3 className="alpha-subhead">云端不可篡改前瞻每日台账（共 {fwd.totalSessionsLogged} 个交易日已冻结）</h3>
          <div className="alpha-table-wrap">
            <table className="alpha-table">
              <thead>
                <tr>
                  <th>执行日 (ET)</th>
                  <th>估值区间</th>
                  <th>冻结时间</th>
                  <th>目标合约手数 (按当前规模)</th>
                  <th className="num">Auto CME 净盈亏</th>
                  <th className="num">Auto ETF 09:30</th>
                  <th>验证状态</th>
                </tr>
              </thead>
              <tbody>
                {fwd.ledgerRows.map(row => (
                  <tr key={`${row.execDate}-${row.mode}`}>
                    <td><strong>{row.execDate}</strong></td>
                    <td>{row.execDate.slice(5)} → {row.valuationEndDate.slice(5)}</td>
                    <td className="alpha-muted">{formatTs(row.frozenAtUtc, tz)}</td>
                    <td className="alpha-compact-lots">
                      {row.contracts.map(c => {
                        const l = Math.round(c.targetLots * navScale);
                        return l !== 0 ? (
                          <span key={c.symbol} className={"alpha-mini-leg " + (l > 0 ? "long" : "short")}>
                            {c.leg} {l > 0 ? `+${l}` : l}
                          </span>
                        ) : null;
                      })}
                    </td>
                    <td className={"num " + ((row.settlement?.cmeNetUsd ?? 0) > 0 ? "tone-long" : (row.settlement?.cmeNetUsd ?? 0) < 0 ? "tone-short" : "")}>
                      {row.settlement ? fmtUsd(row.settlement.cmeNetUsd * navScale) : "待结算"}
                    </td>
                    <td className="num">
                      {row.settlement?.etfOpenNetUsd != null ? fmtUsd(row.settlement.etfOpenNetUsd * navScale) : "—"}
                    </td>
                    <td><span className={"alpha-status-pill " + row.status.toLowerCase()}>{statusLabel(row.status)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* 4. PRIVATE MANUAL PAPER / FILL & SLIPPAGE JOURNAL */}
      <section ref={journalRef} className="panel glass" aria-label="私密纸面与实盘录单日志">
        <div className="panel-header">
          <div>
            <h2>我的私密 Paper / 实盘成交记录与滑点核对</h2>
            <p><Lock size={12} style={{ verticalAlign: "-1px" }} /> 仅保存在本机浏览器或你的私人 Secret Gist，<b>绝不会提交到公开 GitHub 仓库</b>。支持自动按 CME 官方结算价算滑点与次日盈亏。</p>
          </div>
          <div className="alpha-btn-row">
            <button type="button" className="action" onClick={openBatchFromTicket}><Copy size={14} />带入今日全部腿</button>
            <button type="button" className="action" onClick={exportFillsJson}><Download size={14} />导出 JSON</button>
            <button type="button" className="action" onClick={() => fileInputRef.current?.click()}><Upload size={14} />导入</button>
            <input ref={fileInputRef} type="file" accept="application/json" style={{ display: "none" }} onChange={importFillsJson} />
          </div>
        </div>

        <div className="panel-pad">
          {syncMsg && <div className="alpha-toast" role="status">{syncMsg}</div>}

          {/* One-Click Batch Fill Editor */}
          {batchDraft && (
            <div className="alpha-batch-box">
              <div className="alpha-batch-head">
                <strong>一键批量录入 · {ticket.execDate}（修改你看到的实际成交价与时间后一次保存）</strong>
                <button type="button" className="action" onClick={() => setBatchDraft(null)}>取消</button>
              </div>
              <div className="alpha-table-wrap">
                <table className="alpha-table">
                  <thead>
                    <tr>
                      <th>合约</th>
                      <th>成交时间 (ET)</th>
                      <th>手数 (+多/-空)</th>
                      <th>实际成交价</th>
                      <th>参考结算价</th>
                      <th>备注</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batchDraft.map((r, idx) => (
                      <tr key={r.symbol}>
                        <td><strong>{r.symbol}</strong> ({r.leg})</td>
                        <td><input className="alpha-in sm" value={r.timeEt} onChange={e => setBatchDraft(d => d!.map((x, i) => i === idx ? { ...x, timeEt: e.target.value } : x))} /></td>
                        <td><input className="alpha-in sm" type="number" value={r.lots} onChange={e => setBatchDraft(d => d!.map((x, i) => i === idx ? { ...x, lots: e.target.value } : x))} /></td>
                        <td><input className="alpha-in" type="number" step="0.0001" value={r.fillPrice} onChange={e => setBatchDraft(d => d!.map((x, i) => i === idx ? { ...x, fillPrice: e.target.value } : x))} /></td>
                        <td className="alpha-muted">{r.refPrice.toFixed(4)}</td>
                        <td><input className="alpha-in" value={r.notes} onChange={e => setBatchDraft(d => d!.map((x, i) => i === idx ? { ...x, notes: e.target.value } : x))} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="alpha-batch-foot">
                <button type="button" className="action alpha-primary-btn" onClick={saveBatchDraft}><CheckCircle2 size={15} />保存全部成交到私密账本</button>
              </div>
            </div>
          )}

          {/* Quick Single-Leg Manual Entry */}
          <form className="alpha-single-form" onSubmit={saveSingleFill}>
            <label>执行日<input type="date" value={singleForm.execDate} onChange={e => setSingleForm(s => ({ ...s, execDate: e.target.value }))} /></label>
            <label>时间(ET)<input type="text" placeholder="09:30" value={singleForm.execTimeEt} onChange={e => setSingleForm(s => ({ ...s, execTimeEt: e.target.value }))} /></label>
            <label>合约代码
              <select value={singleForm.symbol} onChange={e => {
                const sym = e.target.value;
                const leg = data.contractSettles[sym]?.leg ?? singleForm.leg;
                setSingleForm(s => ({ ...s, symbol: sym, leg }));
              }}>
                {Object.keys(data.contractSettles).map(sym => (
                  <option key={sym} value={sym}>{sym} ({data.contractSettles[sym].leg})</option>
                ))}
              </select>
            </label>
            <label>手数 (+多/-空)<input type="number" placeholder="+24" value={singleForm.lots} onChange={e => setSingleForm(s => ({ ...s, lots: e.target.value }))} /></label>
            <label>成交价<input type="number" step="0.0001" placeholder="108.3438" value={singleForm.fillPrice} onChange={e => setSingleForm(s => ({ ...s, fillPrice: e.target.value }))} /></label>
            <label>备注<input type="text" placeholder="可选" value={singleForm.notes} onChange={e => setSingleForm(s => ({ ...s, notes: e.target.value }))} /></label>
            <button type="submit" className="action"><Plus size={14} />录入单笔</button>
          </form>

          {/* Logged Fills Table */}
          {fillMetrics.rows.length > 0 ? (
            <div className="alpha-table-wrap">
              <table className="alpha-table">
                <thead>
                  <tr>
                    <th>执行日 / 时间</th>
                    <th>合约</th>
                    <th className="num">手数</th>
                    <th className="num">实录成交价</th>
                    <th className="num">参考结算 / 滑点</th>
                    <th className="num">次日结算 / 盈亏</th>
                    <th>备注</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {fillMetrics.rows.map(r => (
                    <tr key={r.id}>
                      <td><strong>{r.execDate}</strong> <small className="alpha-muted">{r.execTimeEt} ET</small></td>
                      <td><strong>{r.symbol}</strong> <span className="alpha-muted">({r.leg})</span></td>
                      <td className={"num " + (r.lots > 0 ? "tone-long" : "tone-short")}>{r.lots > 0 ? `+${r.lots}` : r.lots}</td>
                      <td className="num">{r.fillPrice.toFixed(4)}</td>
                      <td className="num">
                        {r.entryRef ? r.entryRef.toFixed(4) : "—"}
                        {r.slippageBp !== null && (
                          <span className={"alpha-slip " + (r.slippageBp > 0.08 ? "bad" : "good")}> ({fmtSigned(r.slippageBp, 2)} bp)</span>
                        )}
                      </td>
                      <td className={"num " + ((r.realizedUsd ?? 0) > 0 ? "tone-long" : (r.realizedUsd ?? 0) < 0 ? "tone-short" : "")}>
                        {r.realizedUsd !== null ? `${fmtUsd(r.realizedUsd)} (${r.nextExitDate?.slice(5)})` : "待次日结算"}
                      </td>
                      <td className="alpha-muted">{r.notes || "—"}</td>
                      <td>
                        <button type="button" className="icon-button" aria-label="删除记录" onClick={() => setFills(prev => prev.filter(x => x.id !== r.id))}>
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty">暂无手动录单。上班时可点击上方「一键按今日指令录入成交」，5 秒记录模拟/轻仓成交价并自动核算滑点。</p>
          )}

          {/* Optional Private GitHub Gist Cross-Device Sync */}
          <details className="study-details alpha-gist-details">
            <summary><Cloud size={14} style={{ verticalAlign: "-2px" }} /> 跨设备私密云同步（免费 Private GitHub Gist · 无需开家里电脑，外人完全不可见）</summary>
            <p className="alpha-gist-help">
              如需在公司手机与家里 Mac 之间同步手动录单：在 <a href="https://github.com/settings/tokens/new?scopes=gist&description=UST-Alpha-Private-Fills" target="_blank" rel="noreferrer">GitHub 生成一个仅勾选 <code>gist</code> 权限的 Token</a> 粘贴在下方（Token 仅保存在你当前浏览器 <code>localStorage</code>，绝不上传至本仓库），点击「自动新建私密 Gist」即可开启跨端加密同步。
            </p>
            <div className="alpha-gist-grid">
              <label>GitHub Gist Token（仅本地保存）
                <input type="password" placeholder="ghp_... 或 github_pat_..." value={gistCfg.token} onChange={e => setGistCfg(g => ({ ...g, token: e.target.value }))} />
              </label>
              <label>Secret Gist ID（新建后自动填入）
                <input type="text" placeholder="留空点新建，或粘贴已有 Secret Gist ID" value={gistCfg.gistId} onChange={e => setGistCfg(g => ({ ...g, gistId: e.target.value }))} />
              </label>
            </div>
            <div className="alpha-btn-row">
              <button type="button" className="action" disabled={syncBusy} onClick={() => void createPrivateGist()}><Lock size={14} />自动新建私密 Gist</button>
              <button type="button" className="action" disabled={syncBusy} onClick={() => void pushToPrivateGist()}><CloudUpload size={14} />上传到私密 Gist</button>
              <button type="button" className="action" disabled={syncBusy} onClick={() => void pullFromPrivateGist()}><CloudDownload size={14} />从私密 Gist 拉取合并</button>
            </div>
          </details>
        </div>
      </section>

      {/* 5. COLLAPSIBLE 10-YEAR PHASE 4 AUDIT BENCHMARK */}
      <section className="panel glass" aria-label="10年严格样本外审计参照">
        <div className="panel-pad">
          <details className="study-details">
            <summary><Activity size={14} style={{ verticalAlign: "-2px" }} /> Phase 4 严格样本外 10 年历史基准参照（{data.historical10yOos.sampleRange} · 净额整数手 · Politis-Romano 90% CI）</summary>
            <div className="alpha-table-wrap" style={{ marginTop: 12 }}>
              <table className="alpha-table">
                <thead>
                  <tr>
                    <th>历史验证组合（2017–2026 OOS）</th>
                    <th className="num">净夏普</th>
                    <th className="num">CAGR</th>
                    <th className="num">MaxDD</th>
                    <th className="num">最差单日</th>
                    <th className="num">HAC t</th>
                    <th className="num">N_eff</th>
                    <th className="num">正收益年</th>
                    <th className="num">2024–26 R4</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["ultra_50k", "Core3 Ultra (TU/FV/UXY/WN · 50k DV01)"],
                    ["enhanced_50k", "Core3 Enhanced (TU/FV/TY/WN · 50k DV01)"],
                    ["ultra_flat_roll", "Core3 Ultra 换月窗真归零 (0手)"],
                    ["ultra_3x", "Core3 Ultra 3倍极端成本 (0.15/0.30bp)"],
                    ["etf_close_50k", "零换月真 ETF 16:00 收盘 (SHY/IEI/IEF/TLT)"],
                    ["etf_open_50k", "零换月真 ETF 09:30 早盘 (SHY/IEI/IEF/TLT)"],
                  ].map(([k, lbl]) => {
                    const m = data.historical10yOos.models[k];
                    if (!m) return null;
                    return (
                      <tr key={k}>
                        <td><strong>{lbl}</strong></td>
                        <td className="num tone-long"><b>{fmtSigned(m.sharpe)}</b></td>
                        <td className="num">{fmtSigned(m.cagr_pct)}%</td>
                        <td className="num">{m.max_dd_pct.toFixed(1)}%</td>
                        <td className="num">{m.worst_day_pct.toFixed(2)}%</td>
                        <td className="num">{fmtSigned(m.hac_t)}</td>
                        <td className="num">{m.nEff.toFixed(2)}/3</td>
                        <td className="num">{m.posYears}/{m.totalYears}</td>
                        <td className="num">{fmtSigned(m.r4Sr)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="alpha-yearly-strip">
              {Object.entries(histModel.yearly).map(([yr, v]) => (
                <div key={yr} className={"alpha-yr-chip " + (v.retPct >= 0 ? "pos" : "neg")}>
                  <span>{yr}</span>
                  <strong>{fmtSigned(v.retPct, 1)}%</strong>
                  <small>SR {fmtSigned(v.sr, 2)}</small>
                </div>
              ))}
            </div>
            <p className="alpha-muted" style={{ marginTop: 10, fontSize: ".8rem" }}>
              Politis-Romano 随机块长 Stationary Bootstrap 90% CI ({mode.toUpperCase()}): [{fmtSigned(histBoot.p05)}, {fmtSigned(histBoot.p95)}] · P(SR ≥ 1.0) = {histBoot.prob_above_100}% · 3倍压力测试净夏普 = {fmtSigned(hist3x.sharpe)}。
            </p>
          </details>
        </div>
      </section>
    </div>
  );
}
