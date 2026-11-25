#!/usr/bin/env python3
"""Cloud & Local Pure-Python Orchestrator for Automated Core3 Forward Paper Trading & Verification.

Runs automatically in GitHub Actions (17:25 / 18:25 ET post-close & 06:25 ET pre-open) or locally:
  1. Fetches primary public feeds (UST curve, announced auctions, ^MOVE, real ETFs, active CME H27 contracts)
  2. Executes live G1 Causality & Reconciliation Verification Suite
  3. Appends immutable frozen next-session tickets (Ultra & Enhanced) to `alpha-ledger.json`
  4. Auto-settles & verifies every completed forward session across:
       - Actual Individual CME Contracts (exact $2,000 / $1,000 point values)
       - Real Zero-Roll ETFs @ 09:30 ET Open-to-Open
       - Real Zero-Roll ETFs @ 16:00 ET Close-to-Close
  5. Exports compact display bundle `alpha-paper.json` for GitHub Pages React UI.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
import json
from pathlib import Path
import time

import numpy as np
import pandas as pd

from core3_engine import (
    CME_CTD_MOD_DUR,
    CME_POINT_VALUE,
    DESK_COST_TIERS,
    ETF_MOD_DUR,
    add_sifma_bdays,
    build_deadband_signal,
    build_etf_targets,
    build_self_rev_z,
    fetch_all_core3_data,
    last_sifma_bday_of_month,
    n_eff_diversity,
    next_sifma_bday,
    perf_stats,
    politis_romano_ci,
    prev_sifma_bday,
    remaining_sifma_days_in_month,
    run_core3_engine,
    run_g1_verification_suite,
    select_live_contract,
    sifma_bdays_ahead,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
LEDGER_PATH = REPO_ROOT / "alpha-ledger.json"
OUTPUT_PATH = REPO_ROOT / "alpha-paper.json"
BASE_RISK_NAV = 10_000_000.0
G6_TARGET_SESSIONS = 20


def _classify_leg_action(prev_lots: int, target_lots: int) -> str:
    delta = target_lots - prev_lots
    if prev_lots == 0 and target_lots == 0:
        return "FLAT"
    if prev_lots == 0 and target_lots > 0:
        return "NEW_LONG"
    if prev_lots == 0 and target_lots < 0:
        return "NEW_SHORT"
    if prev_lots != 0 and target_lots == 0:
        return "UNWIND"
    if prev_lots * target_lots < 0:
        return "FLIP"
    # Same direction: distinguish tiny vol/damper drift (<= 10% or <= 1 lot) from meaningful add/trim
    noise_band = max(1, round(0.10 * abs(prev_lots)))
    if abs(delta) <= noise_band:
        return "HOLD_NOISE"
    return "ADD" if abs(target_lots) > abs(prev_lots) else "TRIM"


def _spell_days_and_entry(sig_series: pd.Series) -> tuple[int, str | None]:
    """Count exact consecutive active days on the final row of sig_series and return entry date."""
    cur_val = int(round(float(sig_series.iloc[-1])))
    if cur_val == 0:
        return 0, None
    days = 0
    entry_ts = sig_series.index[-1]
    for i in range(len(sig_series) - 1, -1, -1):
        if int(round(float(sig_series.iloc[i]))) == cur_val:
            days += 1
            entry_ts = sig_series.index[i]
        else:
            break
    return days, entry_ts.strftime("%Y-%m-%d")


def _curve_bp_gap_to_exit(panel: pd.DataFrame, col: str, active_state: int) -> dict:
    """Compute exact bp move needed on 5d spread change to cross the ±0.35 deadband exit."""
    s = panel[col].dropna()
    dy = s.diff(1)
    mu60 = float(dy.shift(5).rolling(60, min_periods=35).mean().iloc[-1]) * 100.0
    sd60 = float(dy.shift(5).rolling(60, min_periods=35).std(ddof=1).iloc[-1]) * 100.0
    move5d = float(dy.rolling(5, min_periods=5).sum().iloc[-1]) * 100.0
    if active_state == 0 or not np.isfinite(sd60) or sd60 <= 0:
        return {"move5dBp": round(move5d, 1), "bpGapToExit": None, "exitDirection": None}
    # Z = -(move5d - 5*mu60) / (sd60 * sqrt(5))
    # Flattener (state=-1, Z < -0.35): unwinds when Z >= -0.35 => move5d <= 5*mu60 + 0.35*sd60*sqrt(5)
    # Steepener (state=+1, Z > +0.35): unwinds when Z <= +0.35 => move5d >= 5*mu60 - 0.35*sd60*sqrt(5)
    if active_state < 0:
        target_move5d = 5.0 * mu60 + 0.35 * sd60 * np.sqrt(5.0)
        gap = target_move5d - move5d  # negative = needs to flatten by |gap| bp
        return {"move5dBp": round(move5d, 1), "bpGapToExit": round(float(gap), 1), "exitDirection": "flatten"}
    target_move5d = 5.0 * mu60 - 0.35 * sd60 * np.sqrt(5.0)
    gap = target_move5d - move5d  # positive = needs to steepen by gap bp
    return {"move5dBp": round(move5d, 1), "bpGapToExit": round(float(gap), 1), "exitDirection": "steepen"}


def _build_ticket_lifecycle(
    panel: pd.DataFrame,
    auctions: list[dict],
    eng: dict,
    exec_dt: date,
    val_end: date,
    contracts: list[dict],
) -> dict:
    sig_df = eng["signals_df"]
    sig = sig_df.iloc[-1]
    sig_as_of_dt = panel.index[-1].date()

    # 1. P2 EOM lifecycle
    eom_state = int(sig["eom"])
    eom_rem = remaining_sifma_days_in_month(exec_dt)
    eom_days_held, eom_entry = _spell_days_and_entry(sig_df["eom"])
    eom_unwind = last_sifma_bday_of_month(exec_dt).isoformat() if eom_state != 0 else None

    # 2. P2 Pre-Auction lifecycle
    auc_state = int(sig["auc"])
    auc_days_held, auc_entry = _spell_days_and_entry(sig_df["auc"])
    active_auc_dates = []
    upcoming_auc_dates = []
    for a in auctions:
        if a.get("termYears") not in (10, 30):
            continue
        a_dt = date.fromisoformat(a["auctionDate"])
        ann_dt = date.fromisoformat(a["announcementDate"]) if a.get("announcementDate") else None
        if a_dt > exec_dt:
            ahead = sifma_bdays_ahead(exec_dt, a_dt)
            if 2 <= ahead <= 4 and ann_dt is not None and ann_dt <= sig_as_of_dt:
                active_auc_dates.append(a_dt)
            elif ann_dt is not None and ann_dt <= sig_as_of_dt:
                upcoming_auc_dates.append((a_dt, a["termYears"]))
    auc_unwind = prev_sifma_bday(max(active_auc_dates)).isoformat() if active_auc_dates else None
    next_auc_note = (
        f"下次已公告拍卖：{upcoming_auc_dates[0][1]}Y ({upcoming_auc_dates[0][0].isoformat()})"
        if upcoming_auc_dates
        else "通常每月 8–13 号 10Y/30Y 拍卖，公告后自动进入 A-4..A-2 做空"
    )

    # 3. Curve pillars (2s10s & 5s30s) lifecycle
    c2_state = int(sig["c2s"])
    c2_days, c2_entry = _spell_days_and_entry(sig_df["c2s"])
    c2_stop = add_sifma_bdays(exec_dt, max(0, 10 - c2_days) + 1).isoformat() if c2_state != 0 else None
    c2_gap = _curve_bp_gap_to_exit(panel, "s2s10s", c2_state)

    c5_state = int(sig["c5s"])
    c5_days, c5_entry = _spell_days_and_entry(sig_df["c5s"])
    c5_stop = add_sifma_bdays(exec_dt, max(0, 10 - c5_days) + 1).isoformat() if c5_state != 0 else None
    c5_gap = _curve_bp_gap_to_exit(panel, "s5s30s", c5_state)

    pillars = {
        "eom": {
            "active": eom_state != 0,
            "state": eom_state,
            "daysHeld": eom_days_held,
            "maxDays": 3,
            "entryDate": eom_entry,
            "expectedUnwindDate": eom_unwind,
            "unwindText": (
                f"第 {eom_days_held}/3 天 · 预计 {eom_unwind} (07:00-17:00 ET) 平仓"
                if eom_state != 0
                else f"非月末窗口（距月末剩 {eom_rem} 交易日 · 最后 3 日自动触发）"
            ),
        },
        "preAuction": {
            "active": auc_state != 0,
            "state": auc_state,
            "daysHeld": auc_days_held,
            "maxDays": 3,
            "entryDate": auc_entry,
            "expectedUnwindDate": auc_unwind,
            "unwindText": (
                f"第 {auc_days_held}/3 天 · 预计 {auc_unwind} (拍卖前一日) 平仓"
                if auc_state != 0
                else next_auc_note
            ),
        },
        "curve2s10s": {
            "active": c2_state != 0,
            "state": c2_state,
            "daysHeld": c2_days,
            "maxDays": 10,
            "entryDate": c2_entry,
            "hardStopDate": c2_stop,
            **c2_gap,
            "unwindText": (
                f"已持第 {c2_days}/10 天 ({c2_entry[5:]}入场) · Z回±0.35（再{'趋平' if c2_gap['exitDirection']=='flatten' else '走陡'}~{abs(c2_gap['bpGapToExit']):.1f}bp）或最晚 {c2_stop[5:]} 硬止损"
                if c2_state != 0 and c2_gap["bpGapToExit"] is not None
                else "Z 在死区内（需突破 ±1.25 入场）"
            ),
        },
        "curve5s30s": {
            "active": c5_state != 0,
            "state": c5_state,
            "daysHeld": c5_days,
            "maxDays": 10,
            "entryDate": c5_entry,
            "hardStopDate": c5_stop,
            **c5_gap,
            "unwindText": (
                f"已持第 {c5_days}/10 天 ({c5_entry[5:]}入场) · Z回±0.35（再{'趋平' if c5_gap['exitDirection']=='flatten' else '走陡'}~{abs(c5_gap['bpGapToExit']):.1f}bp）或最晚 {c5_stop[5:]} 硬止损"
                if c5_state != 0 and c5_gap["bpGapToExit"] is not None
                else "Z 在死区内（需突破 ±1.25 入场）"
            ),
        },
    }

    # Build per-contract owner & unwind hint
    p_dv01 = eng["latest_explain"]["pillar_leg_dv01"]
    p_labels = {
        "P2_EOM": ("EOM", f"EOM 第{eom_days_held}/3天 · {eom_unwind[5:]}平仓" if eom_unwind else ""),
        "P2_PreAuction": ("拍前空头", f"拍前 第{auc_days_held}/3天 · {auc_unwind[5:]}平仓" if auc_unwind else ""),
        "P5a_2s10s": ("2s10s", f"2s10s 第{c2_days}/10天 · Z回±0.35或{c2_stop[5:]}平" if c2_stop else ""),
        "P5c_5s30s": ("5s30s", f"5s30s 第{c5_days}/10天 · Z回±0.35或{c5_stop[5:]}平" if c5_stop else ""),
    }
    for idx_j, c in enumerate(contracts):
        owners = []
        hints = []
        for pk, (short_nm, h_txt) in p_labels.items():
            if abs(p_dv01.get(pk, [0, 0, 0, 0])[idx_j]) >= 1.0:
                owners.append(short_nm)
                if h_txt:
                    hints.append(h_txt)
        c["owners"] = owners
        c["unwindHint"] = " + ".join(hints) if hints else "当前无活跃支柱（空仓）"

    # Overall action verdict for busy desk trader at 07:30 ET
    codes = [c["actionCode"] for c in contracts]
    has_major_trade = any(cd in ("NEW_LONG", "NEW_SHORT", "UNWIND", "FLIP", "ADD", "TRIM") for cd in codes)
    all_flat = all(cd == "FLAT" for cd in codes)
    total_abs_delta = sum(abs(c["deltaLots"]) for c in contracts)
    active_names = []
    if eom_state != 0:
        active_names.append(f"EOM 做多(第{eom_days_held}/3天)")
    if auc_state != 0:
        active_names.append(f"拍前空头(第{auc_days_held}/3天)")
    if c2_state != 0:
        active_names.append(f"2s10s {'做陡' if c2_state > 0 else '做平'}(第{c2_days}/10天)")
    if c5_state != 0:
        active_names.append(f"5s30s {'做陡' if c5_state > 0 else '做平'}(第{c5_days}/10天)")

    if all_flat:
        verdict = "FLAT"
        headline = "今日全部信号空仓（0 手）· 耐心休息"
        subtext = "未触发月末、拍前或曲线极端偏离，今日零敞口观望，不强行交易。"
    elif has_major_trade:
        verdict = "TRADE_REQUIRED"
        major_parts = [f"{c['leg']} {c['deltaLots']:+d}手" for c in contracts if c["actionCode"] not in ("FLAT", "HOLD_NOISE")]
        headline = f"今日需调仓执行（变动：{' / '.join(major_parts)}）"
        subtext = f"活跃支柱：{' + '.join(active_names)}。请于纽约盘 08:30–11:30 ET 流动性充裕时段按下方「今日动作」列完成调仓。"
    else:
        verdict = "HOLD_MOSTLY"
        headline = f"续持为主（仅微调 {total_abs_delta} 手，已在仓可忽略省点差）"
        subtext = f"活跃支柱延续：{' + '.join(active_names)}。如果你昨日已在仓，今日可按兵不动；若今天首次建仓，直接按「今日目标」列下单。"

    # Detect pre-holiday thin liquidity (Mon-Thu where next SIFMA bday skips >= 1 weekday holiday)
    is_pre_holiday = (exec_dt.weekday() < 4) and ((val_end - exec_dt).days >= 2)
    next_unwinds = []
    if eom_unwind:
        next_unwinds.append(f"EOM → {eom_unwind} 平仓")
    if auc_unwind:
        next_unwinds.append(f"拍前空头 → {auc_unwind} 平仓")
    if c2_stop:
        next_unwinds.append(f"2s10s → Z回±0.35 或最晚 {c2_stop}")
    if c5_stop:
        next_unwinds.append(f"5s30s → Z回±0.35 或最晚 {c5_stop}")

    return {
        "actionSummary": {
            "verdict": verdict,
            "headline": headline,
            "subtext": subtext,
            "totalAbsDeltaLots": int(total_abs_delta),
            "optimalWindowEt": "08:30–11:30 ET（早盘数据消化后、午盘前）",
            "isPreHolidayThin": is_pre_holiday,
            "preHolidayNote": (
                f"节假日前夕流动性提示：次日休市，本笔估值跨至 {val_end.isoformat()}，午后盘口易变薄，建议上午 08:30–11:30 ET 观察或执行。"
                if is_pre_holiday
                else None
            ),
            "nextUnwindSummary": " ｜ ".join(next_unwinds) if next_unwinds else "当前无持仓待平仓",
        },
        "pillars": pillars,
    }


def _build_live_ticket(
    mode: str,
    panel: pd.DataFrame,
    auctions: list[dict],
    active_cme: dict,
    panel_sha: str,
    g1_passed: bool,
) -> dict:
    venue = "cme_ultra" if mode == "ultra" else "cme_enhanced"
    eng = run_core3_engine(panel, auctions, venue=venue, cost_tier="DESK_50K_DV01", risk_nav=BASE_RISK_NAV,
                           damp_mode="port_only", integer_lots=True, include_next_live_day=True)
    # Also compute aligned ETF leg notionals for zero-roll open/close auto-verification
    eng_etf_o = run_core3_engine(panel, auctions, venue="etf_open", cost_tier="DESK_50K_DV01", risk_nav=BASE_RISK_NAV,
                                 damp_mode="port_only", integer_lots=False, include_next_live_day=True)
    eng_etf_c = run_core3_engine(panel, auctions, venue="etf_close", cost_tier="DESK_50K_DV01", risk_nav=BASE_RISK_NAV,
                                 damp_mode="port_only", integer_lots=False, include_next_live_day=True)

    sig_as_of = panel.index[-1]
    sig_as_of_iso = sig_as_of.strftime("%Y-%m-%d")
    exec_ts = eng["notional_df"].index[-1]
    val_end = next_sifma_bday(exec_ts.date())
    sig = eng["signals_df"].iloc[-1]
    lots = eng["lots_df"].iloc[-1]
    prev_lots = eng["lots_df"].iloc[-2] if len(eng["lots_df"]) >= 2 else pd.Series(0, index=lots.index)
    dv01 = eng["dv01_df"].iloc[-1]
    rp = eng["rp_df"].iloc[-1]

    contracts = []
    for leg in eng["legs"]:
        cm = select_live_contract(exec_ts.date(), active_cme, leg, as_of_iso=sig_as_of_iso)
        px = cm["refPrice"] if cm["refPrice"] is not None else float(panel[f"fut_{leg.lower()}"].iloc[-1])
        pt = CME_POINT_VALUE[leg]
        dv01_lot = px * pt * CME_CTD_MOD_DUR[leg] * 1e-4
        tgt_i = int(lots[leg])
        prv_i = int(prev_lots[leg])
        contracts.append({
            "leg": leg,
            "symbol": cm["symbol"],
            "contractCode": cm["contractCode"],
            "rolledAheadOfFnd": cm["rolledAheadOfFnd"],
            "refPrice": round(float(px), 6),
            "refDate": cm["refDate"] or sig_as_of_iso,
            "pointValueUsd": pt,
            "dv01PerLotUsd": round(float(dv01_lot), 2),
            "prevTargetLots": prv_i,
            "targetLots": tgt_i,
            "deltaLots": tgt_i - prv_i,
            "actionCode": _classify_leg_action(prv_i, tgt_i),
            "targetDv01Usd": round(float(dv01[leg]), 1),
        })

    lifecycle = _build_ticket_lifecycle(panel, auctions, eng, exec_ts.date(), val_end, contracts)
    etf_open_not = {k: round(float(v), 5) for k, v in eng_etf_o["notional_df"].iloc[-1].items()}
    etf_close_not = {k: round(float(v), 5) for k, v in eng_etf_c["notional_df"].iloc[-1].items()}

    return {
        "mode": mode,
        "venue": venue,
        "frozenAtUtc": datetime.now(timezone.utc).isoformat(),
        "panelSha256": panel_sha,
        "g1Passed": g1_passed,
        "riskNavUsd": BASE_RISK_NAV,
        "signalAsOfDate": sig_as_of_iso,
        "execDate": exec_ts.strftime("%Y-%m-%d"),
        "valuationEndDate": val_end.isoformat(),
        "orderWindowEt": f"{exec_ts.strftime('%Y-%m-%d')} 07:00-17:00 ET",
        "signals": {
            "eom": int(sig["eom"]),
            "eomBdaysLeftOnExec": remaining_sifma_days_in_month(exec_ts.date()),
            "preAuction": int(sig["auc"]),
            "curve2s10s": int(sig["c2s"]),
            "curve5s30s": int(sig["c5s"]),
            "z2s10s": round(float(sig["z_2s"]), 2) if np.isfinite(sig["z_2s"]) else None,
            "z5s30s": round(float(sig["z_5s"]), 2) if np.isfinite(sig["z_5s"]) else None,
            "damper": round(float(sig["damper"]), 3),
            "move": round(float(panel["move"].iloc[-1]), 2),
            "calRollWindow": bool(eng["daily_all"]["cal_roll"].iloc[-1]),
        },
        "rpWeights": {k: round(float(v), 3) for k, v in rp.items()},
        "contracts": contracts,
        "lifecycle": lifecycle,
        "etfOpenNotional": etf_open_not,
        "etfCloseNotional": etf_close_not,
        "netDv01Usd": round(float(dv01.sum()), 1),
        "grossDv01Usd": round(float(dv01.abs().sum()), 1),
        "status": "PENDING",
        "settlement": None,
    }


def _settle_ledger(ledger: dict, panel: pd.DataFrame, active_cme: dict) -> dict:
    """Auto-settle and verify all frozen forward sessions whose execDate & valuationEndDate have settled."""
    # Build complete individual CME contract price lookup: symbol -> {date: close}
    cme_hist: dict[str, dict[str, float]] = {}
    for leg_info in active_cme.values():
        for slot_info in leg_info.values():
            sym = slot_info.get("symbol")
            if sym and "history" in slot_info:
                cme_hist[sym] = slot_info["history"]

    # Build ETF session return lookups (exec_date -> er[exec_date])
    etf_open_tgts = build_etf_targets(panel, "DESK_50K_DV01", execution="open")
    etf_close_tgts = build_etf_targets(panel, "DESK_50K_DV01", execution="close")
    etf_map = {"2Y": "ETF_2Y", "5Y": "ETF_5Y", "10Y": "ETF_10Y", "30Y": "ETF_30Y"}
    cost_50k = DESK_COST_TIERS["DESK_50K_DV01"]
    leg_cost_key = {"TU": "2Y", "FV": "5Y", "TY": "10Y", "UXY": "10Y", "US": "30Y", "WN": "30Y"}

    # Track previous session lots per mode for exact turnover cost deduction
    entries_by_mode: dict[str, list[dict]] = {"ultra": [], "enhanced": []}
    for row in ledger["entries"]:
        entries_by_mode.setdefault(row["mode"], []).append(row)

    last_panel_date = panel.index[-1].strftime("%Y-%m-%d")

    for mode, rows in entries_by_mode.items():
        rows.sort(key=lambda r: r["execDate"])
        prev_lots: dict[str, int] = {}
        prev_etf_o: dict[str, float] = {}
        prev_etf_c: dict[str, float] = {}

        for row in rows:
            ed = row["execDate"]
            ve = row["valuationEndDate"]
            nav = float(row.get("riskNavUsd", BASE_RISK_NAV))
            cur_lots = {c["leg"]: int(c["targetLots"]) for c in row["contracts"]}
            cur_etf_o = row.get("etfOpenNotional", {})
            cur_etf_c = row.get("etfCloseNotional", {})

            # Check if CME individual contract settlements exist for BOTH ed and >= ve
            cme_gross_usd = 0.0
            cme_cost_usd = 0.0
            cme_leg_details = []
            cme_settled_all = True

            for c in row["contracts"]:
                leg = c["leg"]
                sym = c["symbol"]
                lots = int(c["targetLots"])
                dlots = abs(lots - prev_lots.get(leg, 0))
                hist = cme_hist.get(sym, {})
                after_dates = sorted(d for d in hist.keys() if d >= ve)
                if ed in hist and after_dates:
                    p0 = hist[ed]
                    p1 = hist[after_dates[0]]
                    pt = float(c["pointValueUsd"])
                    pnl = lots * (p1 - p0) * pt
                    dv01_lot = p0 * pt * CME_CTD_MOD_DUR[leg] * 1e-4
                    cost = dlots * dv01_lot * cost_50k[leg_cost_key[leg]]
                    cme_gross_usd += pnl
                    cme_cost_usd += cost
                    cme_leg_details.append({"symbol": sym, "leg": leg, "lots": lots, "entrySettle": p0, "exitSettle": p1, "exitDate": after_dates[0], "pnlUsd": round(pnl, 1)})
                else:
                    if lots != 0:
                        cme_settled_all = False

            # Check Zero-Roll ETF Open & Close settlements
            etf_open_net_usd = None
            etf_close_net_usd = None
            ed_ts = pd.Timestamp(ed)
            if ed_ts in panel.index and last_panel_date >= ve:
                eo_g, eo_c, ec_g, ec_c = 0.0, 0.0, 0.0, 0.0
                etf_ok = True
                for k_short, eid in etf_map.items():
                    er_o = etf_open_tgts[eid]["er"].loc[ed_ts]
                    er_c = etf_close_tgts[eid]["er"].loc[ed_ts]
                    if pd.isna(er_o) or pd.isna(er_c):
                        etf_ok = False
                        break
                    no = float(cur_etf_o.get(k_short, 0.0))
                    nc = float(cur_etf_c.get(k_short, 0.0))
                    uc = float(etf_close_tgts[eid]["unit_cost"].loc[ed_ts])
                    eo_g += no * float(er_o) * nav
                    eo_c += abs(no - float(prev_etf_o.get(k_short, 0.0))) * uc * nav
                    ec_g += nc * float(er_c) * nav
                    ec_c += abs(nc - float(prev_etf_c.get(k_short, 0.0))) * uc * nav
                if etf_ok:
                    etf_open_net_usd = round(eo_g - eo_c, 1)
                    etf_close_net_usd = round(ec_g - ec_c, 1)

            if cme_settled_all and len(cme_leg_details) > 0:
                cme_net = round(cme_gross_usd - cme_cost_usd, 1)
                row["status"] = "SETTLED_VERIFIED"
                row["settlement"] = {
                    "settledAtUtc": (row.get("settlement") or {}).get("settledAtUtc") or datetime.now(timezone.utc).isoformat(),
                    "cmeGrossUsd": round(cme_gross_usd, 1),
                    "cmeCostUsd": round(cme_cost_usd, 1),
                    "cmeNetUsd": cme_net,
                    "cmeNetPct": round((cme_net / nav) * 100.0, 4),
                    "etfOpenNetUsd": etf_open_net_usd,
                    "etfOpenNetPct": round((etf_open_net_usd / nav) * 100.0, 4) if etf_open_net_usd is not None else None,
                    "etfCloseNetUsd": etf_close_net_usd,
                    "etfCloseNetPct": round((etf_close_net_usd / nav) * 100.0, 4) if etf_close_net_usd is not None else None,
                    "legs": cme_leg_details,
                }
            elif last_panel_date >= ed:
                row["status"] = "IN_SESSION"
            else:
                row["status"] = "PENDING"

            prev_lots = cur_lots
            prev_etf_o = cur_etf_o
            prev_etf_c = cur_etf_c

    return ledger


def _summarize_forward_mode(entries: list[dict], mode: str) -> dict:
    rows = sorted([r for r in entries if r["mode"] == mode], key=lambda r: r["execDate"])
    settled = [r for r in rows if r["status"] == "SETTLED_VERIFIED" and r.get("settlement")]
    cme_rets = [r["settlement"]["cmeNetPct"] / 100.0 for r in settled]
    etf_o_rets = [r["settlement"]["etfOpenNetPct"] / 100.0 for r in settled if r["settlement"].get("etfOpenNetPct") is not None]
    etf_c_rets = [r["settlement"]["etfCloseNetPct"] / 100.0 for r in settled if r["settlement"].get("etfCloseNetPct") is not None]

    cum_cme_usd = round(sum(r["settlement"]["cmeNetUsd"] for r in settled), 1)
    cum_etf_o_usd = round(sum(r["settlement"]["etfOpenNetUsd"] for r in settled if r["settlement"].get("etfOpenNetUsd") is not None), 1)
    cum_etf_c_usd = round(sum(r["settlement"]["etfCloseNetUsd"] for r in settled if r["settlement"].get("etfCloseNetUsd") is not None), 1)

    eq_curve = []
    run_cme, run_eo, run_ec = 0.0, 0.0, 0.0
    for r in settled:
        s = r["settlement"]
        run_cme += s["cmeNetUsd"]
        run_eo += s["etfOpenNetUsd"] or 0.0
        run_ec += s["etfCloseNetUsd"] or 0.0
        eq_curve.append({
            "date": r["execDate"],
            "cmeCumUsd": round(run_cme, 1),
            "etfOpenCumUsd": round(run_eo, 1),
            "etfCloseCumUsd": round(run_ec, 1),
        })

    sr_cme = perf_stats(cme_rets)["sharpe"] if len(cme_rets) >= 5 else None
    dd_cme = perf_stats(cme_rets)["max_dd_pct"] if len(cme_rets) >= 2 else 0.0
    hit_pct = round(float(np.mean([x > 0 for x in cme_rets]) * 100.0), 1) if cme_rets else None

    return {
        "totalSessionsLogged": len(rows),
        "settledSessions": len(settled),
        "g6TargetSessions": G6_TARGET_SESSIONS,
        "g6ProgressPct": min(100, round(len(settled) / G6_TARGET_SESSIONS * 100)),
        "g6Status": "PASS" if (len(settled) >= G6_TARGET_SESSIONS and cum_cme_usd > 0) else "IN_PROGRESS",
        "cumCmeNetUsd": cum_cme_usd,
        "cumCmeNetPct": round((cum_cme_usd / BASE_RISK_NAV) * 100.0, 3),
        "cumEtfOpenNetUsd": cum_etf_o_usd,
        "cumEtfCloseNetUsd": cum_etf_c_usd,
        "forwardSharpe": sr_cme,
        "forwardMaxDdPct": dd_cme,
        "forwardHitRatePct": hit_pct,
        "equityCurve": eq_curve,
        "ledgerRows": list(reversed(rows)),  # newest first for UI
    }


def _build_historical_summary(panel: pd.DataFrame, auctions: list[dict]) -> dict:
    runs = {
        "ultra_50k": run_core3_engine(panel, auctions, "cme_ultra", "DESK_50K_DV01", integer_lots=True),
        "enhanced_50k": run_core3_engine(panel, auctions, "cme_enhanced", "DESK_50K_DV01", integer_lots=True),
        "ultra_3x": run_core3_engine(panel, auctions, "cme_ultra", "STRESSED_3X_50K", integer_lots=True),
        "enhanced_3x": run_core3_engine(panel, auctions, "cme_enhanced", "STRESSED_3X_50K", integer_lots=True),
        "ultra_flat_roll": run_core3_engine(panel, auctions, "cme_ultra", "DESK_50K_DV01", integer_lots=True, flat_calendar_roll=True),
        "etf_close_50k": run_core3_engine(panel, auctions, "etf_close", "DESK_50K_DV01", integer_lots=False),
        "etf_open_50k": run_core3_engine(panel, auctions, "etf_open", "DESK_50K_DV01", integer_lots=False),
    }

    def _pack(key: str) -> dict:
        s = runs[key]["daily"]["net"]
        st = perf_stats(s)
        r4 = perf_stats(s.loc["2024-01-01":])["sharpe"]
        yearly = {
            str(yr): {
                "retPct": round(float(((1.0 + g).prod() - 1.0) * 100.0), 2),
                "sr": perf_stats(g)["sharpe"],
            }
            for yr, g in s.groupby(s.index.year)
        }
        return {
            **st,
            "r4Sr": r4,
            "posYears": sum(1 for v in yearly.values() if v["retPct"] > 0),
            "totalYears": len(yearly),
            "yearly": yearly,
            "nEff": n_eff_diversity(runs[key]["warm_df"].loc["2017-01-03":]),
        }

    # Monthly sampled 10-year equity series for fast, crisp SVG rendering (~120 points)
    idx = runs["ultra_50k"]["daily"].index
    eq_df = pd.DataFrame({
        "ultra": (1.0 + runs["ultra_50k"]["daily"]["net"]).cumprod(),
        "enhanced": (1.0 + runs["enhanced_50k"]["daily"]["net"]).cumprod(),
        "etfOpen": (1.0 + runs["etf_open_50k"]["daily"]["net"].reindex(idx).fillna(0.0)).cumprod(),
        "etfClose": (1.0 + runs["etf_close_50k"]["daily"]["net"].reindex(idx).fillna(0.0)).cumprod(),
    }, index=idx)
    monthly = eq_df.resample("ME").last().dropna()
    # Ensure exact last date is included
    if monthly.index[-1] != eq_df.index[-1]:
        monthly = pd.concat([monthly, eq_df.iloc[[-1]]])

    return {
        "sampleRange": f"{idx[0].strftime('%Y-%m-%d')} -> {panel.index[-1].strftime('%Y-%m-%d')} (T→T+1 结算)",
        "models": {k: _pack(k) for k in runs.keys()},
        "bootstraps": {
            "ultra": politis_romano_ci(runs["ultra_50k"]["daily"]["net"], 20, 800, 42),
            "enhanced": politis_romano_ci(runs["enhanced_50k"]["daily"]["net"], 20, 800, 42),
            "etfOpen": politis_romano_ci(runs["etf_open_50k"]["daily"]["net"], 20, 800, 42),
        },
        "monthlyEquity": [
            {
                "date": d.strftime("%Y-%m-%d"),
                "ultra": round(float(r["ultra"]), 4),
                "enhanced": round(float(r["enhanced"]), 4),
                "etfOpen": round(float(r["etfOpen"]), 4),
                "etfClose": round(float(r["etfClose"]), 4),
            }
            for d, r in monthly.iterrows()
        ],
    }


def _build_explain_bundle(panel: pd.DataFrame, auctions: list[dict]) -> dict:
    """Export 100% transparent, Python-computed 5-layer Glass-Box decomposition for UI visualization."""
    eng_u = run_core3_engine(panel, auctions, venue="cme_ultra", cost_tier="DESK_50K_DV01", risk_nav=BASE_RISK_NAV,
                             damp_mode="port_only", integer_lots=True, include_next_live_day=True)
    eng_e = run_core3_engine(panel, auctions, venue="cme_enhanced", cost_tier="DESK_50K_DV01", risk_nav=BASE_RISK_NAV,
                             damp_mode="port_only", integer_lots=True, include_next_live_day=True)

    def _curve_trace(col: str) -> dict:
        s = panel[col]
        dy = s.diff(1)
        mu60 = dy.shift(5).rolling(60, min_periods=35).mean()
        sd60 = dy.shift(5).rolling(60, min_periods=35).std(ddof=1)
        cum5 = dy.rolling(5, min_periods=5).sum()
        z = build_self_rev_z(s)
        # Include T_next so state aligns with next-session exec
        t_next = pd.Timestamp(next_sifma_bday(panel.index[-1].date()))
        z_ext = z.reindex(panel.index.append(pd.DatetimeIndex([t_next])))
        st = build_deadband_signal(z_ext)
        tail_idx = panel.index[-15:]
        history = []
        for ts in tail_idx:
            # Active position triggered on next day using ts close
            nxt_pos_idx = z_ext.index.get_loc(ts) + 1
            history.append({
                "date": ts.strftime("%Y-%m-%d"),
                "levelBp": round(float(s.loc[ts] * 100.0), 1),
                "move5dBp": round(float(cum5.loc[ts] * 100.0), 1),
                "z": round(float(z.loc[ts]), 2) if pd.notna(z.loc[ts]) else None,
                "stateNext": int(st.iloc[nxt_pos_idx]),
            })
        return {
            "latestLevelBp": round(float(s.iloc[-1] * 100.0), 1),
            "move5dBp": round(float(cum5.iloc[-1] * 100.0), 1),
            "mu60DailyBp": round(float(mu60.iloc[-1] * 100.0), 3),
            "sd60DailyBp": round(float(sd60.iloc[-1] * 100.0), 2),
            "expected5dSdBp": round(float(sd60.iloc[-1] * np.sqrt(5.0) * 100.0), 2),
            "latestZ": round(float(z.iloc[-1]), 2),
            "activeState": int(st.iloc[-1]),
            "entryThreshold": 1.25,
            "exitThreshold": 0.35,
            "maxHoldDays": 10,
            "history15d": history,
        }

    exec_dt = next_sifma_bday(panel.index[-1].date())
    last_dt = panel.index[-1].date()
    recent_aucs = []
    for a in auctions:
        a_dt = date.fromisoformat(a["auctionDate"])
        if (a_dt - last_dt).days >= -15:
            ann_dt = date.fromisoformat(a["announcementDate"]) if a.get("announcementDate") else None
            ahead = sifma_bdays_ahead(exec_dt, a_dt) if a_dt > exec_dt else 0
            recent_aucs.append({
                "termYears": a["termYears"],
                "auctionDate": a["auctionDate"],
                "announcementDate": a.get("announcementDate"),
                "bdaysAheadFromExec": ahead,
                "isAnnounced": bool(ann_dt is not None and ann_dt <= last_dt),
                "triggersShort": bool(2 <= ahead <= 4 and ann_dt is not None and ann_dt <= last_dt),
            })

    return {
        "curves": {
            "s2s10s": _curve_trace("s2s10s"),
            "s5s30s": _curve_trace("s5s30s"),
        },
        "auctionsWindow": recent_aucs[-6:],
        "modes": {
            "ultra": {
                "legs": eng_u["legs"],
                **eng_u["latest_explain"],
            },
            "enhanced": {
                "legs": eng_e["legs"],
                **eng_e["latest_explain"],
            },
        },
    }


def main() -> None:
    t0 = time.time()
    print("[alpha/update_paper.py] Fetching primary public Treasury, ETF & Active CME Contract data...")
    panel, auctions, active_cme, panel_sha = fetch_all_core3_data()

    print("[alpha/update_paper.py] Running G1 Automated Causality & Reconciliation Verification...")
    g1 = run_g1_verification_suite(panel, auctions)
    if not g1["allPassed"]:
        raise RuntimeError(f"G1 Verification FAILED: {g1}")
    print(f"  G1 PASS ({g1['passedCount']}/{g1['totalChecks']} checks verified)")

    # Load or initialize immutable append-only forward ledger
    if LEDGER_PATH.exists():
        ledger = json.loads(LEDGER_PATH.read_text())
    else:
        ledger = {
            "schemaVersion": "4.0_append_only_forward_ledger",
            "freezeDate": "2026-11-25",
            "entries": [],
        }

    # Build today's tickets for BOTH ultra (default) and enhanced
    tickets = {}
    existing_keys = {(e["execDate"], e["mode"]) for e in ledger["entries"]}
    appended = 0
    for mode in ("ultra", "enhanced"):
        tk = _build_live_ticket(mode, panel, auctions, active_cme, panel_sha, g1["allPassed"])
        tickets[mode] = tk
        key = (tk["execDate"], mode)
        if key not in existing_keys:
            ledger["entries"].append(tk)
            existing_keys.add(key)
            appended += 1
        else:
            # Preserve originally frozen target lots/signals in ledger (NEVER mutate frozen targets!),
            # while enriching the live UI display view with lifecycle/delta/unwind metadata + T-1 capped refPrice.
            orig = next(e for e in ledger["entries"] if e["execDate"] == tk["execDate"] and e["mode"] == mode)
            tk_by_leg = {c["leg"]: c for c in tk["contracts"]}
            merged_contracts = []
            for oc in orig["contracts"]:
                nc = tk_by_leg.get(oc["leg"], {})
                merged_contracts.append({
                    **oc,
                    "refPrice": nc.get("refPrice", oc["refPrice"]),
                    "refDate": nc.get("refDate", oc["refDate"]),
                    "prevTargetLots": nc.get("prevTargetLots", 0),
                    "deltaLots": oc["targetLots"] - nc.get("prevTargetLots", 0),
                    "actionCode": _classify_leg_action(nc.get("prevTargetLots", 0), oc["targetLots"]),
                    "owners": nc.get("owners", []),
                    "unwindHint": nc.get("unwindHint", ""),
                })
            tickets[mode] = {
                **orig,
                "contracts": merged_contracts,
                "lifecycle": tk["lifecycle"],
            }

    # Auto-settle & verify all completed forward sessions
    ledger = _settle_ledger(ledger, panel, active_cme)
    ledger["updatedAtUtc"] = datetime.now(timezone.utc).isoformat()
    LEDGER_PATH.write_text(json.dumps(ledger, indent=2) + "\n")

    # Export compact contract settle history (last 20 sessions per active symbol) for frontend fill slippage audit
    contract_settles = {}
    for leg, slots in active_cme.items():
        for slot_info in slots.values():
            sym = slot_info.get("symbol")
            if sym and "history" in slot_info:
                items = sorted(slot_info["history"].items())[-25:]
                contract_settles[sym] = {
                    "leg": leg,
                    "pointValueUsd": CME_POINT_VALUE[leg],
                    "ctdModDur": CME_CTD_MOD_DUR[leg],
                    "prices": dict(items),
                }

    hist_summary = _build_historical_summary(panel, auctions)
    explain_bundle = _build_explain_bundle(panel, auctions)
    last_mkt = panel.iloc[-1]
    bundle = {
        "schemaVersion": "4.1_web_paper_glassbox",
        "generatedAtUtc": datetime.now(timezone.utc).isoformat(),
        "defaultMode": "ultra",
        "freezeDate": ledger["freezeDate"],
        "panelAsOfDate": panel.index[-1].strftime("%Y-%m-%d"),
        "panelSha256": panel_sha,
        "tradingDaysInHistory": len(panel),
        "auctionsTracked": len(auctions),
        "g1Verification": g1,
        "marketSnapshot": {
            "date": panel.index[-1].strftime("%Y-%m-%d"),
            "ust2y": round(float(last_mkt["ust_2y"]), 2),
            "ust5y": round(float(last_mkt["ust_5y"]), 2),
            "ust10y": round(float(last_mkt["ust_10y"]), 2),
            "ust30y": round(float(last_mkt["ust_30y"]), 2),
            "s2s10sBp": round(float(last_mkt["s2s10s"] * 100.0), 1),
            "s5s30sBp": round(float(last_mkt["s5s30s"] * 100.0), 1),
            "move": round(float(last_mkt["move"]), 2),
        },
        "todayTickets": tickets,
        "explain": explain_bundle,
        "forward": {
            "ultra": _summarize_forward_mode(ledger["entries"], "ultra"),
            "enhanced": _summarize_forward_mode(ledger["entries"], "enhanced"),
        },
        "contractSettles": contract_settles,
        "historical10yOos": hist_summary,
    }
    OUTPUT_PATH.write_text(json.dumps(bundle, indent=2) + "\n")
    print(f"[alpha/update_paper.py] Done in {time.time() - t0:.2f}s | Appended {appended} frozen tickets | Ultra settled={bundle['forward']['ultra']['settledSessions']}/{G6_TARGET_SESSIONS}")
    print(f"  Ultra Today ({tickets['ultra']['execDate']}): {[(c['symbol'], c['targetLots']) for c in tickets['ultra']['contracts']]} | Net DV01 = ${tickets['ultra']['netDv01Usd']:+,.0f}/bp")
    print(f"  Enh   Today ({tickets['enhanced']['execDate']}): {[(c['symbol'], c['targetLots']) for c in tickets['enhanced']['contracts']]} | Net DV01 = ${tickets['enhanced']['netDv01Usd']:+,.0f}/bp")


if __name__ == "__main__":
    main()
