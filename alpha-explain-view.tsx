import { useEffect, useMemo, useState } from "react";
import {
  Activity, ArrowLeft, BookOpen, Cpu, Gauge, GitBranch, Layers, RefreshCw, ShieldCheck, SlidersHorizontal,
} from "lucide-react";
import type { AlphaMode, AlphaPaperBundle } from "./alpha-paper-view";

export type CurveTrace = {
  latestLevelBp: number;
  move5dBp: number;
  mu60DailyBp: number;
  sd60DailyBp: number;
  expected5dSdBp: number;
  latestZ: number;
  activeState: number;
  entryThreshold: number;
  exitThreshold: number;
  maxHoldDays: number;
  history15d: { date: string; levelBp: number; move5dBp: number; z: number | null; stateNext: number }[];
};

export type ModeExplain = {
  legs: string[];
  vols_252_ann: number[];
  raw_w: number[];
  est_port_vol_ann: number;
  port_scale: number;
  damper: number;
  w_eff: number[];
  vol_scales: { leg2: number; leg10: number; c2s: number; c5s: number };
  inst_vols_60_ann: { leg2: number; leg10: number; c2s: number; c5s: number };
  pillar_leg_dv01: Record<string, number[]>;
  damper_details: {
    move: number;
    move_p75: number;
    move_ratio: number;
    rv10y_ann_pct: number;
    rv10y_p75_ann_pct: number;
    rv_ratio: number;
    damper: number;
  };
};

export type ExplainBundle = {
  curves: { s2s10s: CurveTrace; s5s30s: CurveTrace };
  auctionsWindow: {
    termYears: number;
    auctionDate: string;
    announcementDate: string | null;
    bdaysAheadFromExec: number;
    isAnnounced: boolean;
    triggersShort: boolean;
  }[];
  modes: Record<AlphaMode, ModeExplain>;
};

type PaperWithExplain = AlphaPaperBundle & { explain?: ExplainBundle };

const STORAGE_MODE = "ust-alpha-mode-v1";
const STORAGE_NAV = "ust-alpha-risk-nav-v1";
const fmtUsd = (v: number) => (v > 0 ? "+" : v < 0 ? "-" : "") + "$" + Math.abs(Math.round(v)).toLocaleString("en-US");
const fmtSigned = (v: number, d = 2) => (v > 0 ? "+" : "") + v.toFixed(d);

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function SignalFlowNetwork({
  data,
  mode,
  ex,
  navScale,
  focusPillar,
  onSelectPillar,
}: {
  data: PaperWithExplain;
  mode: AlphaMode;
  ex: ModeExplain;
  navScale: number;
  focusPillar: string | null;
  onSelectPillar: (p: string | null) => void;
}) {
  const tk = data.todayTickets[mode];
  const mkt = data.marketSnapshot;
  const sig = tk.signals;
  const dd = ex.damper_details;

  // 5-Layer Neural-Network Style Transparent Pipeline Coordinates (viewBox 980 x 374)
  const colX = [14, 204, 408, 588, 784];
  const colW = [154, 166, 144, 158, 180];

  const inputs = [
    { id: "in_cal", y: 38, title: "SIFMA 月末日历", val: `剩 ${sig.eomBdaysLeftOnExec} 交易日`, active: sig.eom !== 0 },
    { id: "in_auc", y: 122, title: "FiscalData 拍卖公告", val: sig.preAuction < 0 ? "拍前窗口触发" : "无拍前触发", active: sig.preAuction !== 0 },
    { id: "in_2s", y: 206, title: "UST 2s10s 利差", val: `${fmtSigned(mkt.s2s10sBp, 1)} bp`, active: sig.curve2s10s !== 0 },
    { id: "in_5s", y: 290, title: "UST 5s30s 利差", val: `${fmtSigned(mkt.s5s30sBp, 1)} bp`, active: sig.curve5s30s !== 0 },
  ];

  const pillars = [
    { id: "P2_EOM", y: 38, title: "P2 · 月末延展", val: sig.eom > 0 ? "做多 +1" : "空仓 0", state: sig.eom },
    { id: "P2_PreAuction", y: 122, title: "P2 · 拍前空头", val: sig.preAuction < 0 ? "做空 -1" : "空仓 0", state: sig.preAuction },
    { id: "P5a_2s10s", y: 206, title: "P5a · 2s10s 回归", val: sig.curve2s10s === 0 ? `死区 0 (Z=${sig.z2s10s})` : `${sig.curve2s10s > 0 ? "做陡 +1" : "做平 -1"} (Z=${sig.z2s10s})`, state: sig.curve2s10s },
    { id: "P5c_5s30s", y: 290, title: "P5c · 5s30s 回归", val: sig.curve5s30s === 0 ? `死区 0 (Z=${sig.z5s30s})` : `${sig.curve5s30s > 0 ? "做陡 +1" : "做平 -1"} (Z=${sig.z5s30s})`, state: sig.curve5s30s },
  ];

  const rpNodes = [
    { id: "rp_p2", y: 74, title: "P2 风险平价", val: `w=${(ex.raw_w[0] * 100).toFixed(0)}% · ×${ex.port_scale.toFixed(1)}`, active: sig.eom !== 0 || sig.preAuction !== 0 },
    { id: "rp_2s", y: 184, title: "2s10s 风险平价", val: `w=${(ex.raw_w[1] * 100).toFixed(0)}% · ×${ex.port_scale.toFixed(1)}`, active: sig.curve2s10s !== 0 },
    { id: "rp_5s", y: 288, title: "5s30s 风险平价", val: `w=${(ex.raw_w[2] * 100).toFixed(0)}% · ×${ex.port_scale.toFixed(1)}`, active: sig.curve5s30s !== 0 },
  ];

  const damperNode = { id: "damp", y: 162, h: 92, title: "单层 ^MOVE 阻尼", val: `× ${dd.damper.toFixed(2)}`, sub: `MOVE ${dd.move.toFixed(1)} vs p75 ${dd.move_p75.toFixed(1)}` };

  const legNodes = tk.contracts.map((c, idx) => {
    const lots = Math.round(c.targetLots * navScale);
    return {
      id: c.leg,
      idx,
      y: 38 + idx * 84,
      title: `${c.symbol} (${c.leg})`,
      val: `${lots > 0 ? "+" : ""}${lots} 手`,
      dv01: c.targetDv01Usd * navScale,
      lots,
    };
  });

  const curve = (x1: number, y1: number, x2: number, y2: number) => {
    const mx = (x1 + x2) / 2;
    return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
  };

  const nodeH = 62;
  const cy = (y: number, h = nodeH) => y + h / 2;

  // Build Pillar -> Contract attribution edges routed through RP & Damper
  const p2LegMap = [
    { pIdx: 0, rpIdx: 0, key: "P2_EOM" },
    { pIdx: 1, rpIdx: 0, key: "P2_PreAuction" },
    { pIdx: 2, rpIdx: 1, key: "P5a_2s10s" },
    { pIdx: 3, rpIdx: 2, key: "P5c_5s30s" },
  ];

  return (
    <div className="xai-flow-wrap">
      <div className="xai-flow-scroll">
        <div className="xai-flow-canvas">
          <div className="xai-col-headers">
            <span>Layer 1 · 公开输入</span>
            <span>Layer 2 · 3 大经济支柱</span>
            <span>Layer 3 · 252d 风险平价</span>
            <span>Layer 4 · 债市波动闸门</span>
            <span>Layer 5 · 净聚合实盘手数</span>
          </div>
          <svg viewBox="0 0 980 374" className="xai-svg" role="img" aria-label="Core3 信号白盒传导图">
        {/* Layer 1 -> Layer 2 edges */}
        {inputs.map((inp, i) => {
          const p = pillars[i];
          const active = p.state !== 0;
          const dimmed = focusPillar && focusPillar !== p.id;
          return (
            <path
              key={`e12-${i}`}
              d={curve(colX[0] + colW[0], cy(inp.y), colX[1], cy(p.y))}
              fill="none"
              stroke={active ? (p.state > 0 ? "#0c7559" : "#b5451e") : "currentColor"}
              strokeOpacity={dimmed ? 0.1 : active ? 0.8 : 0.16}
              strokeWidth={active ? 3 : 1.3}
              strokeDasharray={active ? undefined : "4 4"}
            />
          );
        })}

        {/* Layer 2 -> Layer 3 edges */}
        {p2LegMap.map(({ pIdx, rpIdx, key }) => {
          const p = pillars[pIdx];
          const r = rpNodes[rpIdx];
          const active = p.state !== 0;
          const dimmed = focusPillar && focusPillar !== key;
          return (
            <path
              key={`e23-${key}`}
              d={curve(colX[1] + colW[1], cy(p.y), colX[2], cy(r.y))}
              fill="none"
              stroke={active ? (p.state > 0 ? "#0c7559" : "#b5451e") : "currentColor"}
              strokeOpacity={dimmed ? 0.1 : active ? 0.8 : 0.16}
              strokeWidth={active ? 3 : 1.3}
              strokeDasharray={active ? undefined : "4 4"}
            />
          );
        })}

        {/* Layer 3 -> Layer 4 (Damper) edges */}
        {rpNodes.map((r, i) => {
          const active = r.active;
          return (
            <path
              key={`e34-${i}`}
              d={curve(colX[2] + colW[2], cy(r.y), colX[3], cy(damperNode.y, damperNode.h))}
              fill="none"
              stroke={active ? "#2563eb" : "currentColor"}
              strokeOpacity={active ? 0.72 : 0.16}
              strokeWidth={active ? 2.8 : 1.3}
              strokeDasharray={active ? undefined : "4 4"}
            />
          );
        })}

        {/* Layer 4 (Damper) -> Layer 5 (Contracts) weighted by actual leg DV01 */}
        {legNodes.map(ln => {
          // If a specific pillar is focused, show that pillar's exact DV01 contribution to this leg!
          const contribDv01 = focusPillar
            ? (ex.pillar_leg_dv01[focusPillar]?.[ln.idx] ?? 0) * navScale
            : ln.dv01;
          const active = Math.abs(contribDv01) >= 1;
          const w = active ? Math.min(6.5, Math.max(2.0, (Math.abs(contribDv01) / (4500 * Math.max(0.02, navScale))) * 5.0)) : 1.2;
          return (
            <path
              key={`e45-${ln.id}`}
              d={curve(colX[3] + colW[3], cy(damperNode.y, damperNode.h), colX[4], cy(ln.y))}
              fill="none"
              stroke={active ? (contribDv01 > 0 ? "#0c7559" : "#b5451e") : "currentColor"}
              strokeOpacity={active ? 0.85 : 0.14}
              strokeWidth={w}
              strokeDasharray={active ? undefined : "4 4"}
            />
          );
        })}

        {/* Draw Layer 1 Nodes */}
        {inputs.map(n => (
          <g key={n.id} transform={`translate(${colX[0]},${n.y})`}>
            <rect width={colW[0]} height={nodeH} rx="12" className={"xai-node " + (n.active ? "active" : "idle")} />
            <text x="12" y="23" className="xai-node-title">{n.title}</text>
            <text x="12" y="45" className="xai-node-val">{n.val}</text>
          </g>
        ))}

        {/* Draw Layer 2 Pillar Nodes (Interactive Click to Highlight!) */}
        {pillars.map(p => {
          const isSel = focusPillar === p.id;
          const cls = p.state > 0 ? "long" : p.state < 0 ? "short" : "idle";
          return (
            <g
              key={p.id}
              transform={`translate(${colX[1]},${p.y})`}
              style={{ cursor: "pointer" }}
              onClick={() => onSelectPillar(isSel ? null : p.id)}
            >
              <rect width={colW[1]} height={nodeH} rx="12" className={`xai-node ${cls} ${isSel ? "selected" : ""}`} />
              <text x="12" y="23" className="xai-node-title">{p.title}</text>
              <text x="12" y="45" className="xai-node-val">{p.val}</text>
            </g>
          );
        })}

        {/* Draw Layer 3 RP Nodes */}
        {rpNodes.map(r => (
          <g key={r.id} transform={`translate(${colX[2]},${r.y})`}>
            <rect width={colW[2]} height={nodeH} rx="12" className={"xai-node " + (r.active ? "rp" : "idle")} />
            <text x="12" y="23" className="xai-node-title">{r.title}</text>
            <text x="12" y="45" className="xai-node-val">{r.val}</text>
          </g>
        ))}

        {/* Draw Layer 4 Damper Node */}
        <g transform={`translate(${colX[3]},${damperNode.y})`}>
          <rect width={colW[3]} height={damperNode.h} rx="14" className="xai-node damper" />
          <text x="12" y="25" className="xai-node-title">{damperNode.title}</text>
          <text x="12" y="53" className="xai-node-big">{damperNode.val}</text>
          <text x="12" y="76" className="xai-node-sub">{damperNode.sub}</text>
        </g>

        {/* Draw Layer 5 Live Contract Output Nodes */}
        {legNodes.map(ln => {
          const cls = ln.lots > 0 ? "long" : ln.lots < 0 ? "short" : "idle";
          return (
            <g key={ln.id} transform={`translate(${colX[4]},${ln.y})`}>
              <rect width={colW[4]} height={nodeH} rx="12" className={`xai-node ${cls}`} />
              <text x="12" y="22" className="xai-node-title">{ln.title}</text>
              <text x="12" y="45" className="xai-node-val">{ln.val} · {fmtUsd(ln.dv01)}/bp</text>
            </g>
          );
        })}
      </svg>
        </div>
      </div>
      <p className="xai-hint">
        💡 点击 Layer 2 的任意经济支柱卡片，可单独高亮该支柱向 4 份合约传导的精确 DV01 路径（{focusPillar ? `当前高亮：${focusPillar}，再点一次取消` : "当前显示全部支柱净聚合"}）。绿色实线 = 做多 / 橙红色实线 = 做空 / 虚线 = 今日未触发。
      </p>
    </div>
  );
}

function describeCurveLiveStory(trace: CurveTrace, baseEcon: string): string {
  if (trace.activeState === 0) {
    return `${baseEcon} 当前最新 Z=${fmtSigned(trace.latestZ, 2)}（5日变动 ${fmtSigned(trace.move5dBp, 1)}bp），落在死区空仓内，需突破 ±${trace.entryThreshold.toFixed(2)} 才入场。`;
  }
  const dirLabel = trace.activeState > 0 ? "做陡 (+1)" : "做平 (-1)";
  // Find most recent entry transition in trailing 15-day history
  let entryRow: CurveTrace["history15d"][number] | null = null;
  for (let i = trace.history15d.length - 1; i >= 0; i--) {
    const cur = trace.history15d[i];
    const prevState = i > 0 ? trace.history15d[i - 1].stateNext : 0;
    if (cur.stateNext === trace.activeState && prevState !== trace.activeState) {
      entryRow = cur;
      break;
    }
  }
  if (entryRow && entryRow.z !== null) {
    return `${baseEcon} 于 ${entryRow.date.slice(5)} 触发 Z=${fmtSigned(entryRow.z, 2)} 入场${dirLabel}，最新 Z=${fmtSigned(trace.latestZ, 2)} 仍在滞回持仓区（回落至 ±${trace.exitThreshold.toFixed(2)} 内平仓）。`;
  }
  return `${baseEcon} 当前处于${dirLabel}持仓中（最新 Z=${fmtSigned(trace.latestZ, 2)}，回落至 ±${trace.exitThreshold.toFixed(2)} 内平仓）。`;
}

function DeadbandGauge({ title, trace, economicNote }: { title: string; trace: CurveTrace; economicNote: string }) {
  const clamp = (z: number) => Math.max(-2.5, Math.min(2.5, z));
  const pct = (z: number) => ((clamp(z) + 2.5) / 5.0) * 100;
  const hist = trace.history15d;
  const W = 360, H = 96, padL = 40, padR = 12, padT = 12, padB = 20;
  const sx = (i: number) => padL + (i / Math.max(1, hist.length - 1)) * (W - padL - padR);
  const sy = (z: number) => padT + ((2.5 - clamp(z)) / 5.0) * (H - padT - padB);
  const lineD = hist.map((p, i) => `${i === 0 ? "M" : "L"}${sx(i).toFixed(1)},${sy(p.z ?? 0).toFixed(1)}`).join(" ");

  return (
    <div className="xai-curve-card">
      <div className="xai-curve-head">
        <div>
          <h3>{title}</h3>
          <p>{economicNote}</p>
        </div>
        <span className={"alpha-dir-pill " + (trace.activeState > 0 ? "long" : trace.activeState < 0 ? "short" : "flat")}>
          {trace.activeState > 0 ? "做陡 +1" : trace.activeState < 0 ? "做平 -1" : "死区空仓 0"}
        </span>
      </div>

      {/* Exact Formula Calculation Readout */}
      <div className="xai-formula-box">
        <code>
          Z = -[(5日变化 {fmtSigned(trace.move5dBp, 1)}bp) - 5×({fmtSigned(trace.mu60DailyBp, 2)}bp/日)] / ({trace.sd60DailyBp.toFixed(2)}bp × √5) = <b>{fmtSigned(trace.latestZ, 2)}</b>
        </code>
      </div>

      {/* Horizontal Deadband Hysteresis Gauge (-2.5 .. +2.5) */}
      <div className="xai-gauge">
        <div className="xai-gauge-track">
          <div className="xai-zone short" style={{ left: "0%", width: `${pct(-1.25)}%` }} title="Z <= -1.25: 触发做平 (-1)" />
          <div className="xai-zone hold" style={{ left: `${pct(-1.25)}%`, width: `${pct(-0.35) - pct(-1.25)}%` }} title="滞回持仓区 (-1.25 .. -0.35)" />
          <div className="xai-zone flat" style={{ left: `${pct(-0.35)}%`, width: `${pct(0.35) - pct(-0.35)}%` }} title="死区空仓 (-0.35 .. +0.35)" />
          <div className="xai-zone hold" style={{ left: `${pct(0.35)}%`, width: `${pct(1.25) - pct(0.35)}%` }} title="滞回持仓区 (+0.35 .. +1.25)" />
          <div className="xai-zone long" style={{ left: `${pct(1.25)}%`, width: `${100 - pct(1.25)}%` }} title="Z >= +1.25: 触发做陡 (+1)" />
          <span className="xai-marker" style={{ left: `${pct(trace.latestZ)}%` }} title={`今日 Z = ${fmtSigned(trace.latestZ)}`}>
            <b>{fmtSigned(trace.latestZ)}</b>
          </span>
        </div>
        <div className="xai-gauge-ticks">
          <span>-2.5</span><span>-1.25 进空</span><span>-0.35 出</span><span>0</span><span>+0.35 出</span><span>+1.25 进多</span><span>+2.5</span>
        </div>
      </div>

      {/* Trailing 15-Day Z-Score & State Sparkline */}
      <svg viewBox={`0 0 ${W} ${H}`} className="xai-spark" role="img" aria-label={`${title} 过去15日Z值轨迹`}>
        <rect x={padL} y={sy(1.25)} width={W - padL - padR} height={sy(-1.25) - sy(1.25)} fill="currentColor" fillOpacity="0.05" />
        <line x1={padL} x2={W - padR} y1={sy(1.25)} y2={sy(1.25)} stroke="#0c7559" strokeDasharray="3 3" strokeOpacity="0.65" />
        <line x1={padL} x2={W - padR} y1={sy(-1.25)} y2={sy(-1.25)} stroke="#b5451e" strokeDasharray="3 3" strokeOpacity="0.65" />
        <line x1={padL} x2={W - padR} y1={sy(0)} y2={sy(0)} stroke="currentColor" strokeOpacity="0.2" />
        <path d={lineD} fill="none" stroke="#2563eb" strokeWidth="2" />
        {hist.map((p, i) => (
          <circle
            key={p.date}
            cx={sx(i)}
            cy={sy(p.z ?? 0)}
            r={i === hist.length - 1 ? 4.5 : 2.8}
            fill={p.stateNext > 0 ? "#0c7559" : p.stateNext < 0 ? "#b5451e" : "#64748b"}
          />
        ))}
        <text x={padL - 4} y={sy(1.25) + 3} textAnchor="end" className="alpha-svg-lbl">+1.25</text>
        <text x={padL - 4} y={sy(-1.25) + 3} textAnchor="end" className="alpha-svg-lbl">-1.25</text>
        <text x={padL} y={H - 4} className="alpha-svg-lbl">{hist[0]?.date.slice(5)}</text>
        <text x={W - padR} y={H - 4} textAnchor="end" className="alpha-svg-lbl">{hist.at(-1)?.date.slice(5)} (最新)</text>
      </svg>
      <p className="xai-mini-note">
        圆点颜色 = 次日执行仓位（绿=做陡 +1 / 橙红=做平 -1 / 灰=空仓 0）。滞回死区的作用：突破 ±1.25 才入场，回落到 ±0.35 内才平仓，避免在阈值附近反复洗盘浪费手续费。
      </p>
    </div>
  );
}

export function AlphaExplainView({ onBackToPaper }: { onBackToPaper: () => void }) {
  const [data, setData] = useState<PaperWithExplain | null>(null);
  const [busy, setBusy] = useState(true);
  const [mode, setMode] = useState<AlphaMode>(() => loadJson<AlphaMode>(STORAGE_MODE, "ultra"));
  const [riskNav] = useState<number>(() => loadJson<number>(STORAGE_NAV, 10_000_000));
  const [focusPillar, setFocusPillar] = useState<string | null>(null);

  // Interactive What-If Economic Sandbox state
  const [simEom, setSimEom] = useState(1);
  const [simAuc, setSimAuc] = useState(0);
  const [sim2s, setSim2s] = useState(0);
  const [sim5s, setSim5s] = useState(-1);
  const [simMove, setSimMove] = useState(99);

  const loadData = async () => {
    setBusy(true);
    try {
      const r = await fetch("./alpha-paper.json?_=" + Date.now(), { cache: "no-store" });
      const j = (await r.json()) as PaperWithExplain;
      setData(j);
      const tk = j.todayTickets[mode];
      setSimEom(tk.signals.eom);
      setSimAuc(tk.signals.preAuction);
      setSim2s(tk.signals.curve2s10s);
      setSim5s(tk.signals.curve5s30s);
      setSimMove(Math.round(tk.signals.move));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { void loadData(); }, []);
  useEffect(() => { try { localStorage.setItem(STORAGE_MODE, JSON.stringify(mode)); } catch {} }, [mode]);

  const navScale = riskNav / 10_000_000;
  const ex = data?.explain?.modes[mode] ?? null;
  const tk = data?.todayTickets[mode] ?? null;

  // Live What-If Sandbox computation using exact Python-exported coefficients (pure educational intuition!)
  const simResult = useMemo(() => {
    if (!ex || !tk) return null;
    const dd = ex.damper_details;
    const mvRatio = simMove > dd.move_p75 ? Math.pow(dd.move_p75 / simMove, 1.5) : 1.0;
    const damp = Math.max(0.35, Math.min(1.0, Math.sqrt(mvRatio * dd.rv_ratio)));
    const w = ex.raw_w.map(rw => rw * ex.port_scale * damp);
    const [wp2, w2s, w5s] = w;
    const vs = ex.vol_scales;
    const ctdDur = [1.67, 3.91, mode === "ultra" ? 8.12 : 6.08, 16.50];
    const baseDur = 6.08;
    const n2 = 0.5 * wp2 * simEom * vs.leg2 + (w2s * sim2s * vs.c2s) * (baseDur / ctdDur[0]);
    const n5 = (w5s * sim5s * vs.c5s) * (baseDur / ctdDur[1]);
    const n10 = wp2 * (0.5 * simEom + simAuc) * vs.leg10 - (w2s * sim2s * vs.c2s) * (baseDur / ctdDur[2]);
    const n30 = -(w5s * sim5s * vs.c5s) * (baseDur / ctdDur[3]);
    const nots = [n2, n5, n10, n30];
    const rows = tk.contracts.map((c, j) => {
      const lots = Math.round((nots[j] * riskNav) / (c.refPrice * c.pointValueUsd));
      const dv01 = lots * c.dv01PerLotUsd;
      return { leg: c.leg, symbol: c.symbol, lots, dv01 };
    });
    return { damp, rows, netDv01: rows.reduce((s, r) => s + r.dv01, 0) };
  }, [ex, tk, simEom, simAuc, sim2s, sim5s, simMove, mode, riskNav]);

  if (busy || !data || !data.explain || !ex || !tk) {
    return <section className="panel glass"><div className="panel-pad"><p className="empty">正在载入白盒信号拆解数据…</p></div></section>;
  }

  const dd = ex.damper_details;
  const curves = data.explain.curves;
  const pillarRows = [
    { key: "P2_EOM", name: "P2 · 月末久期延展 (EOM)", sig: tk.signals.eom > 0 ? "+1 做多" : "0 空仓", econ: "指数/养老金月末最后 3 日刚性补久期 → 50% TU + 50% 10Y" },
    { key: "P2_PreAuction", name: "P2 · 已公告拍前空头", sig: tk.signals.preAuction < 0 ? "-1 做空" : "0 空仓", econ: "10Y/30Y 拍卖前 3 日一级交易商对冲承销库存 → 10Y 供给折价" },
    { key: "P5a_2s10s", name: "P5a · 2s10s 曲线自身回归", sig: tk.signals.curve2s10s > 0 ? "+1 做陡" : tk.signals.curve2s10s < 0 ? "-1 做平" : "0 空仓", econ: "5 日极端走陡/走平超 1.25σ 后的微观均值回归（TU vs 10Y DV01 中性）" },
    { key: "P5c_5s30s", name: "P5c · 5s30s 曲线自身回归", sig: tk.signals.curve5s30s > 0 ? "+1 做陡" : tk.signals.curve5s30s < 0 ? "-1 做平" : "0 空仓", econ: "长端 5s30s 过度陡峭/平坦后的流动性回归（FV vs WN DV01 中性）" },
  ];

  return (
    <div className="alpha-page">
      {/* HEADER */}
      <section className="panel glass alpha-hero">
        <div className="alpha-head-row">
          <div>
            <div className="alpha-badges">
              <span className="alpha-badge ok"><ShieldCheck size={13} />0% 黑箱 · 全链路公式公开</span>
              <span className="alpha-badge neutral"><Cpu size={13} />Python 精确导出每一步系数</span>
              <span className="alpha-badge">数据日 {data.panelAsOfDate} → 执行日 {tk.execDate}</span>
            </div>
            <h2>信号白盒拆解：今天的仓位到底是怎么一步步算出来的？</h2>
            <p className="alpha-sub">
              Core3 没有任何不透明的神经网络或复杂黑箱机器学习——它由 <b>3 个有清晰金融经济学机制的独立支柱</b>、<b>252 日逆波动风险平价</b> 和 <b>单层 ^MOVE 风险闸门</b> 线性合成。下面每一张图和数字都来自今天 Python 引擎的真实计算过程。
            </p>
          </div>
          <div className="alpha-btn-row">
            <button type="button" className="action" onClick={onBackToPaper}><ArrowLeft size={14} />返回指令与录单台</button>
            <button type="button" className="action" onClick={() => void loadData()}><RefreshCw size={14} />刷新</button>
          </div>
        </div>

        <div className="alpha-controls">
          <div className="alpha-ctrl-group">
            <span className="alpha-ctrl-lbl">查看哪一套合约的传导拆解</span>
            <div className="segmented" role="tablist">
              <button type="button" role="tab" aria-selected={mode === "ultra"} className={mode === "ultra" ? "active" : ""} onClick={() => setMode("ultra")}>
                Ultra · TU/FV/UXY/WN
              </button>
              <button type="button" role="tab" aria-selected={mode === "enhanced"} className={mode === "enhanced" ? "active" : ""} onClick={() => setMode("enhanced")}>
                Enhanced · TU/FV/TY/WN
              </button>
            </div>
          </div>
          <span className="alpha-muted" style={{ fontSize: ".8rem" }}>
            当前展示资金规模：<b>${riskNav.toLocaleString()}</b>（可在「Alpha 纸面交易」页调整缩放）
          </span>
        </div>
      </section>

      {/* SECTION 1: 5-LAYER VISUAL NEURAL-NET / FLOW DIAGRAM */}
      <section className="panel glass" aria-label="5层信号传导可视化网络">
        <div className="panel-header">
          <div>
            <h2><GitBranch size={17} style={{ verticalAlign: "-2px" }} /> 全链路 5 层决策传导图（输入 → 经济支柱 → 风险平价 → 波动阻尼 → 实盘手数）</h2>
            <p>仿照神经网络结构可视化透明的经济学传导：你可以直观看到哪几条通路今日激活、每一层的真实系数是多少、以及最终汇入哪几份 H27 期货合约。</p>
          </div>
        </div>
        <div className="panel-pad">
          <SignalFlowNetwork
            data={data}
            mode={mode}
            ex={ex}
            navScale={navScale}
            focusPillar={focusPillar}
            onSelectPillar={setFocusPillar}
          />
        </div>
      </section>

      {/* SECTION 2: ECONOMIC INTUITION & DEADBAND GAUGES FOR P5a & P5c */}
      <section className="panel glass" aria-label="曲线均值回归死区拆解">
        <div className="panel-header">
          <div>
            <h2><Activity size={17} style={{ verticalAlign: "-2px" }} /> 支柱 B &amp; C 白盒：两条曲线今天为什么空仓 / 持仓？</h2>
            <p>纯美债曲线 5 日自身回归（零外部数据泄漏）：用过去 60 天（扣除最近 5 天）的日常波动率，衡量最近 5 天曲线是否被短线资金挤得过陡或过平。</p>
          </div>
        </div>
        <div className="panel-pad">
          <div className="xai-two-col">
            <DeadbandGauge
              title={`P5a · 2s10s 曲线 (当前 ${fmtSigned(curves.s2s10s.latestLevelBp, 1)}bp)`}
              trace={curves.s2s10s}
              economicNote={describeCurveLiveStory(
                curves.s2s10s,
                "短端受美联储定价驱动、长端受供给与期限溢价驱动，5日极端错位后呈现微观均值回归。",
              )}
            />
            <DeadbandGauge
              title={`P5c · 5s30s 曲线 (当前 ${fmtSigned(curves.s5s30s.latestLevelBp, 1)}bp)`}
              trace={curves.s5s30s}
              economicNote={describeCurveLiveStory(
                curves.s5s30s,
                "5Y 腹部与 30Y 超长端承接养老金与拍卖库存错位，5日极端拉伸后往往回归均值。",
              )}
            />
          </div>
        </div>
      </section>

      {/* SECTION 3: PILLAR A (EOM + AUCTION) + RISK PARITY + DAMPER MATH */}
      <section className="panel glass" aria-label="日历流、风险平价与波动阻尼拆解">
        <div className="panel-header">
          <div>
            <h2><Gauge size={17} style={{ verticalAlign: "-2px" }} /> 支柱 A 日历流 + 252 日风险平价 + 单层 ^MOVE 阻尼精确系数</h2>
            <p>所有权重与风控乘数 100% 仅读 T-1 以前已实现数据，不含任何未来信息。</p>
          </div>
        </div>
        <div className="panel-pad">
          <div className="xai-two-col">
            {/* Risk Parity & Vol Scaling Card */}
            <div className="xai-box">
              <h3><Layers size={15} style={{ verticalAlign: "-2px" }} /> 权重系数怎么算？（逆波动风险平价 × 目标 6% 波动）</h3>
              <p className="xai-desc">谁的历史波动越低、越稳，就给它更高的名义风险预算；再统一缩放至组合 6% 目标波动率，最后乘以单层阻尼。</p>
              <div className="alpha-table-wrap">
                <table className="alpha-table">
                  <thead>
                    <tr>
                      <th>支柱</th>
                      <th className="num">252d波动</th>
                      <th className="num">raw_w</th>
                      <th className="num">缩放</th>
                      <th className="num">阻尼</th>
                      <th className="num">w_eff</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ["P2 日历资金流", 0],
                      ["P5a 2s10s 回归", 1],
                      ["P5c 5s30s 回归", 2],
                    ].map(([nm, idx]) => {
                      const i = idx as number;
                      return (
                        <tr key={nm as string}>
                          <td><strong>{nm as string}</strong></td>
                          <td className="num">{ex.vols_252_ann[i].toFixed(2)}%</td>
                          <td className="num">{(ex.raw_w[i] * 100).toFixed(1)}%</td>
                          <td className="num">×{ex.port_scale.toFixed(2)}</td>
                          <td className="num">×{ex.damper.toFixed(2)}</td>
                          <td className="num"><b>{ex.w_eff[i].toFixed(3)}×</b></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="xai-mini-note" style={{ marginTop: 8 }}>
                工具层 60 日波动率缩放（6% / 工具年化波动）：{ex.legs[0]} {ex.inst_vols_60_ann.leg2}% → <b>{ex.vol_scales.leg2}×</b> ｜ {ex.legs[2]} {ex.inst_vols_60_ann.leg10}% → <b>{ex.vol_scales.leg10}×</b> ｜ 2s10s {ex.inst_vols_60_ann.c2s}% → <b>{ex.vol_scales.c2s}×</b> ｜ 5s30s {ex.inst_vols_60_ann.c5s}% → <b>{ex.vol_scales.c5s}×</b>。
              </p>
            </div>

            {/* Single-Layer ^MOVE Bond-Vol Damper Card */}
            <div className="xai-box">
              <h3><ShieldCheck size={15} style={{ verticalAlign: "-2px" }} /> ^MOVE 债市防崩盘阻尼怎么算？（仅减仓 ≤ 1.0×）</h3>
              <p className="xai-desc">当债市隐含波动率（^MOVE）或 10Y 实现波动率超过自身过去 252 日的 75% 分位时，自动按 1.5 次方温柔降仓，防止极端行情 whipsaw 回撤。</p>
              <div className="xai-damper-bars">
                <div className="xai-dbar">
                  <div className="xai-dbar-top">
                    <span><b>^MOVE 隐含波动</b>（当前 {dd.move} vs 252d 75分位 {dd.move_p75}）</span>
                    <b className={dd.move_ratio < 0.99 ? "tone-warn" : "tone-long"}>乘数 {dd.move_ratio.toFixed(3)}×</b>
                  </div>
                  <div className="alpha-progress-track"><span style={{ width: `${Math.min(100, (dd.move / 140) * 100)}%` }} /></div>
                </div>
                <div className="xai-dbar">
                  <div className="xai-dbar-top">
                    <span><b>10Y 实现波动率</b>（当前 {dd.rv10y_ann_pct}% vs 252d 75分位 {dd.rv10y_p75_ann_pct}%）</span>
                    <b className={dd.rv_ratio < 0.99 ? "tone-warn" : "tone-long"}>乘数 {dd.rv_ratio.toFixed(3)}×</b>
                  </div>
                  <div className="alpha-progress-track"><span style={{ width: `${Math.min(100, (dd.rv10y_ann_pct / 12) * 100)}%` }} /></div>
                </div>
              </div>
              <div className="xai-formula-box" style={{ marginTop: 10 }}>
                <code>Damper = √({dd.move_ratio.toFixed(3)} × {dd.rv_ratio.toFixed(3)}) = <b>{dd.damper.toFixed(3)}×</b>（下限 0.35×，永不加杠杆）</code>
              </div>
              <p className="xai-mini-note" style={{ marginTop: 8 }}>
                近期 10Y/30Y 拍卖公告追踪：{data.explain.auctionsWindow.length ? data.explain.auctionsWindow.slice(-3).map(a => `${a.termYears}Y 拍卖 ${a.auctionDate} (公告 ${a.announcementDate ?? "待定"})`).join(" · ") : "未来 4 日无已公告 10Y/30Y 拍卖"}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 4: EXACT 3-PILLAR x 4-CONTRACT ATTRIBUTION MATRIX */}
      <section className="panel glass" aria-label="支柱到合约精确DV01分解矩阵">
        <div className="panel-header">
          <div>
            <h2><BookOpen size={17} style={{ verticalAlign: "-2px" }} /> 精确账单：4 个子信号如何净额加总成每一份合约的目标手数？</h2>
            <p>跨支柱的同合约反向仓位会<b>先净额对冲、再取整数手</b>（大幅节省换手成本）。每一行相加即精确等于最终下单的净 DV01。</p>
          </div>
        </div>
        <div className="panel-pad">
          <div className="alpha-table-wrap">
            <table className="alpha-table xai-attr-table">
              <thead>
                <tr>
                  <th>信号支柱</th>
                  <th>方向</th>
                  {ex.legs.map(lg => <th key={lg} className="num">{lg} DV01</th>)}
                  <th>经济学机制</th>
                </tr>
              </thead>
              <tbody>
                {pillarRows.map(pr => {
                  const arr = ex.pillar_leg_dv01[pr.key] ?? [0, 0, 0, 0];
                  return (
                    <tr key={pr.key}>
                      <td><strong>{pr.name}</strong></td>
                      <td>{pr.sig}</td>
                      {arr.map((v, j) => {
                        const sv = v * navScale;
                        return (
                          <td key={j} className={"num " + (sv > 1 ? "tone-long" : sv < -1 ? "tone-short" : "alpha-muted")}>
                            {Math.abs(sv) < 1 ? "—" : `${fmtUsd(sv)}/bp`}
                          </td>
                        );
                      })}
                      <td className="alpha-muted xai-econ-cell">{pr.econ}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}><strong>净聚合目标手数</strong></td>
                  {tk.contracts.map(c => {
                    const lots = Math.round(c.targetLots * navScale);
                    return (
                      <td key={c.symbol} className={"num " + (lots > 0 ? "tone-long" : lots < 0 ? "tone-short" : "")}>
                        <b>{lots > 0 ? `+${lots}` : lots} 手</b><br /><small>{fmtUsd(c.targetDv01Usd * navScale)}/bp</small>
                      </td>
                    );
                  })}
                  <td className="alpha-muted xai-econ-cell">手数 = round(净名义本金 ÷ (昨结算价 × CME点值))</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </section>

      {/* SECTION 5: INTERACTIVE WHAT-IF ECONOMIC SANDBOX */}
      <section className="panel glass" aria-label="交互式经济学What-If沙盘">
        <div className="panel-header">
          <div>
            <h2><SlidersHorizontal size={17} style={{ verticalAlign: "-2px" }} /> 交互式学习沙盘：动手拨动宏观条件，看仓位如何联动（绝不影响实盘）</h2>
            <p>试着把「拍前空头」切到 -1，或者把「2s10s」切到 +1 做陡，观察 10Y 腿如何自动净额抵消；或者把 ^MOVE 拉到 130，看风控如何温柔降仓。</p>
          </div>
          <button type="button" className="action" onClick={() => {
            setSimEom(tk.signals.eom); setSimAuc(tk.signals.preAuction);
            setSim2s(tk.signals.curve2s10s); setSim5s(tk.signals.curve5s30s); setSimMove(Math.round(tk.signals.move));
          }}>重置为今日真实值</button>
        </div>
        <div className="panel-pad">
          <div className="xai-sim-controls">
            <label>月末 EOM 窗口
              <div className="segmented">
                <button type="button" className={simEom === 0 ? "active" : ""} onClick={() => setSimEom(0)}>非月末 (0)</button>
                <button type="button" className={simEom === 1 ? "active" : ""} onClick={() => setSimEom(1)}>EOM-3..1 (+1)</button>
              </div>
            </label>
            <label>10Y/30Y 已公告拍前
              <div className="segmented">
                <button type="button" className={simAuc === 0 ? "active" : ""} onClick={() => setSimAuc(0)}>无拍卖 (0)</button>
                <button type="button" className={simAuc === -1 ? "active" : ""} onClick={() => setSimAuc(-1)}>A-3..1 (-1)</button>
              </div>
            </label>
            <label>2s10s 死区状态
              <div className="segmented">
                <button type="button" className={sim2s === -1 ? "active" : ""} onClick={() => setSim2s(-1)}>做平 -1</button>
                <button type="button" className={sim2s === 0 ? "active" : ""} onClick={() => setSim2s(0)}>空仓 0</button>
                <button type="button" className={sim2s === 1 ? "active" : ""} onClick={() => setSim2s(1)}>做陡 +1</button>
              </div>
            </label>
            <label>5s30s 死区状态
              <div className="segmented">
                <button type="button" className={sim5s === -1 ? "active" : ""} onClick={() => setSim5s(-1)}>做平 -1</button>
                <button type="button" className={sim5s === 0 ? "active" : ""} onClick={() => setSim5s(0)}>空仓 0</button>
                <button type="button" className={sim5s === 1 ? "active" : ""} onClick={() => setSim5s(1)}>做陡 +1</button>
              </div>
            </label>
            <label>
              <span>^MOVE 指数：<b>{simMove}</b>（阻尼 <b>{simResult?.damp.toFixed(2)}×</b>）</span>
              <input type="range" min={60} max={150} step={1} value={simMove} onChange={e => setSimMove(Number(e.target.value))} />
            </label>
          </div>

          {simResult && (
            <div className="alpha-kpi-grid" style={{ marginTop: 14, marginBottom: 0 }}>
              {simResult.rows.map(r => (
                <div key={r.leg} className="alpha-kpi">
                  <span>模拟输出 · {r.symbol} ({r.leg})</span>
                  <strong className={r.lots > 0 ? "tone-long" : r.lots < 0 ? "tone-short" : "tone-flat"}>
                    {r.lots > 0 ? `+${r.lots}` : r.lots} 手
                  </strong>
                  <small>模拟 DV01 = {fmtUsd(r.dv01)}/bp</small>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
