#!/usr/bin/env python3
"""Pure-Python Cloud Daily Post-Close Briefing & Curated Institutional R&D Alpha Spotlight.

Runs inside GitHub Actions (zero local Mac required, zero LLM API cost) to generate a daily
archived Chinese post-close briefing (`alpha-briefings.json`) covering:
  1. Auto-settled G6 forward PnL & CME H27 vs Zero-Roll ETF Open/Close reconciliation
  2. Live UST curve / ^MOVE regime diagnosis
  3. Next-session Action Verdict, Delta trades, and exact Unwind countdowns
  4. Rotating curated institutional R&D Alpha research spotlight (strictly isolated from G6 Core3)
"""

from __future__ import annotations

from datetime import date, datetime, timezone
import json
from pathlib import Path
from typing import Any

import pandas as pd

# 12 deeply researched, 100% public-data US Treasury / SOFR / Fed Funds / CME R&D Alpha candidates.
# Strictly R&D backlog (NEVER auto-enabled into Core3 during G6 20-day lockbox!).
CURATED_ALPHA_IDEAS: list[dict[str, Any]] = [
    {
        "id": "IDEA-001",
        "title": "月末周 5Y/7Y 拍卖腹部承压 × 2s5s10s 蝶式（Belly Fly）结构套利",
        "instruments": "CME TU / FV / UXY（DV01 中性 2s5s10s Fly）或 2Y/5Y/10Y OTR",
        "category": "拍卖供给 × 曲率",
        "horizon": "3–5 交易日",
        "priorConfidencePct": 58,
        "mechanism": "Core3 的 P2 只覆盖月中（8–13号）10Y/30Y 拍卖，忽略了每月第 4 周（21–28号）集中发行的 2Y/5Y/7Y 中期国债拍卖。一级交易商拍前承销 5Y/7Y 会将 5Y 腹部相对 2Y/10Y 两翼压出折价（2×5Y−2Y−10Y 走扩）；拍后空头回补叠加月末买盘推动腹部收敛。",
        "publicFeeds": "FiscalData 2Y/5Y/7Y 官方 announcementDate & auctionDate（严格 <= T-1）+ 财政部日终 2Y/5Y/10Y + CME TU/FV/UXY（SHY/IEI/IEF 零换月验证）。",
        "orthogonality": "交易曲线曲率（Curvature），数学上同时对久期水平（P2）和斜率（2s10s/5s30s）近似正交，预期与 Core3 相关性 |ρ| < 0.20。",
        "costAndFalsification": "3 腿蝶式 50k DV01 成本约 0.15bp（3× 压力 0.45bp），且 5Y/7Y 拍卖紧邻月末 EOM；最大证伪风险是 3 腿点差吞噬 2–4bp 的曲率振幅，需严格剥离 EOM 共线性并过 3× 成本门槛。",
        "validationPlan": "在 ust-macro-alpha 用 2015–2026 FiscalData 5Y/7Y 拍卖跑 A-3..A-1 空腹部 / A0..A+3 多腹部事件研究，加非拍卖周安慰剂检验与 Core3 残差回归（要求 HAC t >= 2.2）。",
    },
    {
        "id": "IDEA-002",
        "title": "FOMC 缄默期（Blackout Window）前端 SOFR 路径漂移与波动率收敛",
        "instruments": "CME 3M SOFR 期货（SR3 第 2–5 季）与 Fed Funds 期货（ZQ）",
        "category": "央行日程 × 前端定价",
        "horizon": "5–8 交易日",
        "priorConfidencePct": 54,
        "mechanism": "FOMC 议息前 10 个自然日进入美联储官员缄默期（Blackout），政策口风冲击骤降、市场逐步向基准共识收敛；历史上在非极端通胀冲击期，前端利率隐含风险溢价会在缄默期至议息日早盘前出现温和收窄（FOMC Pre-Drift）。",
        "publicFeeds": "美联储官网 FOMC 历史与未来排期表（已知提前 1 年公布，零前视）+ CME SR3/ZQ 日线与 2Y 美债曲线 + ^MOVE 门控过滤。",
        "orthogonality": "瞄准 3M–18M 货币政策前端路径，与 Core3 的长端/中端国债结构流几乎零重叠。",
        "costAndFalsification": "仅在 ^MOVE 未处于极端飙升区时有效；2022 激进加息周期里若缄默期遭遇超预期 CPI/WSJ 放风，单次尾损较大，必须加 CPI 公布日避险过滤与固定 1× 波动止损。",
        "validationPlan": "以 2014–2026 全部 ~100 次 FOMC 会议做严格事件研究，对比 CPI 撞期与非撞期子样本，检验净成本后 HAC t 与 2022–2026 近年稳健性。",
    },
    {
        "id": "IDEA-003",
        "title": "10Y/30Y 拍卖尾部超调（Auction Tail Reversal：A0 收盘 → A+2 反弹）",
        "instruments": "CME UXY / WN 或 10Y / 30Y OTR 现券",
        "category": "拍卖微观结构",
        "horizon": "1–2 交易日",
        "priorConfidencePct": 62,
        "mechanism": "与 Core3 拍前做空（A-4..A-2）正好对称：当 10Y/30Y 拍卖在 13:00 ET 落锤出现明显尾部折价（High Yield 显著高于市场预期，或一级交易商被迫接走过高比例）时，当天下午流动性冲击导致过度抛售，随后 1–2 个交易日真实买盘（Real Money）逢低承接修复。",
        "publicFeeds": "FiscalData 拍卖结果（primary_dealer_accepted_pct、bid_to_cover、high_yield，拍卖日 13:02 ET 官方公布，严格 T0 收盘后决策用于 T0→T+2）。",
        "orthogonality": "发生时段在 A0→A+2，与 Core3 拍前空头（A-4..A-2）时间完全错开，属于「先吃拍前承销折价、再挑惨烈尾部捡便宜」的无缝接力。",
        "costAndFalsification": "如果大尾部源于基本面信用/财政赤字恐慌（如 2023 年 10 月），接飞刀可能连跌 2 天；必须用 ^MOVE 与 5 日趋势过滤极端熊市抛压。",
        "validationPlan": "用 FiscalData 2014–2026 全部 10Y/30Y 拍卖的 Bid-to-Cover Z 值与 Primary Dealer 获配占比构造严格因果打分，验证 A0→A+2 零换月 ETF/CME 净夏普。",
    },
    {
        "id": "IDEA-004",
        "title": "20Y 期限流动性折价 × 10s20s30s 超长端蝶式均值回归",
        "instruments": "10Y / 20Y / 30Y OTR 现券（或 CME UXY / US / WN 组合逼近）",
        "category": "期限结构 × 流动性溢价",
        "horizon": "4–8 交易日",
        "priorConfidencePct": 56,
        "mechanism": "20Y 美债自 2020 年重启发行以来缺乏对应活跃期货合约，天然是全曲线流动性最弱的「孤儿期限」（常年显著高于 10Y–30Y 线性插值）。每逢 20Y 月度拍卖或机构去杠杆，20Y 会被过度砸深，随后保险与养老金 LDI 资金进场吃高息修复 10s20s30s Fly。",
        "publicFeeds": "美国财政部每日官方 10Y/20Y/30Y 平价曲线 + FiscalData 20Y 拍卖公告与发行额（100% 公开）。",
        "orthogonality": "专注超长端 20Y 孤儿点曲率，与 Core3 的 2s10s/5s30s 斜率几乎独立。",
        "costAndFalsification": "20Y 现券点差比 10Y/30Y 宽（50k DV01 约 0.08–0.12bp），且 2020 年前无 20Y 历史数据导致样本仅 ~6.5 年，统计功效受限，需严防过拟合。",
        "validationPlan": "基于 2020-05 至今财政部 10Y/20Y/30Y 曲线 + 20Y 拍卖日程检验 10s20s30s Fly 滞回回归与拍后修复，重点做 3× 现券滑点压测。",
    },
    {
        "id": "IDEA-005",
        "title": "SOFR 白/红/绿包曲率（White-Red-Green Pack Fly）过度定价均值回归",
        "instruments": "CME 3M SOFR 期货（SR3 第 1–12 季构建 Pack 1 / Pack 2 / Pack 3 蝶式）",
        "category": "前端利率 × 政策预期曲率",
        "horizon": "4–7 交易日",
        "priorConfidencePct": 60,
        "mechanism": "当宏观数据突发意外时，短线交易员往往集中猛砸或猛买「红包（第 5–8 季，1–2 年后政策利率）」，导致红包相对白包（近端锁定）与绿包（中性利率锚）出现过度弯曲；随后政策路径重新平滑，Pack Fly 均值回归。",
        "publicFeeds": "CME 公开 SOFR 期货曲线与美国财政部 1Y/2Y/3Y 曲线交叉验证（零公司专有数据）。",
        "orthogonality": "完全落在货币政策预期曲线内部，且 100% 规避长端财政供给与期限溢价噪音，是 Core3 最理想的第 4 支柱候选之一。",
        "costAndFalsification": "SOFR 期货点差极窄（约 0.25–0.5bp 价差、单腿成本 <0.02bp），但若美联储突然开启快速降息/加息转向，红包弯曲可能持续单边扩张，需设 10 日硬止损与滞回死区。",
        "validationPlan": "用 2019–2026（或 Eurodollar+SOFR 拼接 2014–2026）测试 1Y-2Y-3Y 前端蝶式 5 日 Z 回归（与 Core3 P5 同框架，严格零新增超参！）。",
    },
    {
        "id": "IDEA-006",
        "title": "10Y TIPS 实际利率 vs 名义利率 Breakeven 短期失衡回归",
        "instruments": "10Y OTR 名义美债 vs 10Y TIPS（或 TIP/IEF 公开代理研究）",
        "category": "通胀补偿 × 跨品种套利",
        "horizon": "5–10 交易日",
        "priorConfidencePct": 50,
        "mechanism": "油价剧烈波动或 TIPS 拍卖期间，TIPS 流动性远低于名义国债，会导致 10Y Breakeven（名义−实际）在 5 日内相对油价/名义利率出现流动性折价偏离，随后向均衡通胀补偿收敛。",
        "publicFeeds": "财政部官方日终名义曲线 + 官方日终 TIPS 实际收益率曲线 + NYMEX CL=F 结算价（全部 100% 公开且已采集）。",
        "orthogonality": "赚的是实际利率 vs 通胀补偿的相对定价，与 Core3 的纯名义期限结构低相关。",
        "costAndFalsification": "TIPS 现券交易成本明显高于名义 OTR（尤其 50k DV01 滑点可达 0.10–0.20bp），且通胀结构切换期（如 2021–2022）Breakeven 趋势很强，均值回归容易逆势扛单。",
        "validationPlan": "在本地 Python 检验 10Y Breakeven 相对 WTI 原油的 60 日滚动残差 Z 值，必须计入真实 TIPS 现券点差（0.15bp/leg 起步）做证伪测试。",
    },
    {
        "id": "IDEA-007",
        "title": "季末资产负债表窗口（GSIB Quarter-End Turn）前端 2Y 基差与久期溢价",
        "instruments": "CME TU (2Y) / 2Y OTR 与 Fed Funds 期货",
        "category": "监管日历 × 资产负债表约束",
        "horizon": "3–5 交易日（每季 4 次）",
        "priorConfidencePct": 57,
        "mechanism": "银行在季末（3/6/9/12 月底）受 GSIB 附加资本与 SLR 杠杆率考核约束，回购融资趋紧，主动压缩现券库存、转向轻资本的期货或短债，叠加季末养老金股债再平衡，造成季末前 3–5 日 2Y 期货强于常态且 2s10s 表现异于普通月末。",
        "publicFeeds": "SIFMA 季末日历 + NY Fed 每日官方 SOFR/TGCR/BGCR 公开回购利差 + CME TU。",
        "orthogonality": "已在 Phase 4 实证中发现季末 EOM TU 胜率高达 72.3%（普通月末仅 62.1%）；可研究是否结合 NY Fed 公开回购利差（SOFR − IORB）做季末增强或独立前端 Carry 策略。",
        "costAndFalsification": "一年仅 4 次季末事件，10 年仅 ~40 个样本点，单独成支柱统计样本偏小，更适合作为严格控制自由度的结构性验证课题。",
        "validationPlan": "采集 NY Fed Markets Data 公开 SOFR/TGCR/BGCR 与美联储 IORB 利差，验证回购融资趋紧时 2Y 期货与现金基差的季末规律。",
    },
    {
        "id": "IDEA-008",
        "title": "重磅宏观数据日（CPI / NFP）前夕曲线回归减仓过滤（Event-Risk Guard）",
        "instruments": "作为 Core3 P5a (2s10s) / P5c (5s30s) 的风险叠加层",
        "category": "事件风控 × 尾部保护",
        "horizon": "事件前 1 日（每月 2 次）",
        "priorConfidencePct": 64,
        "mechanism": "CPI 与非农（NFP）公布日早晨 08:30 ET 经常引发 10–20bp 瞬时跳空与范式切换，逆势均值回归策略在数据日往往承担不对称尾部跳跃风险（跳空止损滑点大，但平时收益却来自非数据日的平稳回归）。",
        "publicFeeds": "BLS 官方提前 1 年公布的 CPI / NFP 发布日历（已在 ust-weekly-desk 自动采集，零前视）。",
        "orthogonality": "不是新方向信号，而是专门检查是否能用极简 1 条规则（CPI/NFP 前夕不新开曲线逆势仓或降仓 50%）进一步压低 MaxDD 与 Worst Day。",
        "costAndFalsification": "风险在于数据日后大反弹本身也贡献部分回归利润，若盲目一刀切可能反而拉低夏普；必须严格做样本外分期对比，确认确实改善 Calmar 且非过拟合。",
        "validationPlan": "用 2017–2026 BLS 历史 CPI/NFP 发布日做 Core3 收益分解：比较「数据日 vs 非数据日」的 P5a/P5c 盈亏与最差单日，仅保留有压倒性样本外提升的机制。",
    },
    {
        "id": "IDEA-009",
        "title": "美联储季度 SEP 点阵图后「鹰鸽预期差」2Y/5Y 动量延续（Post-FOMC Drift）",
        "instruments": "CME TU / FV 或 SOFR 第 3–6 季期货",
        "category": "宏观行为金融 × 反应不足",
        "horizon": "3–5 交易日（每年 4 次 SEP 会议）",
        "priorConfidencePct": 52,
        "mechanism": "与日常均值回归不同，当 FOMC 季度 SEP 会议释放出超出市场定价的大幅意外（2Y 收益率在议息日单日变动超 ±1.5σ）时，大型机构资管与保险无法在当天下午 14:00–16:00 ET 调完仓，资金往往在随后 2–4 天沿意外方向继续慢步调仓（Post-Announcement Drift）。",
        "publicFeeds": "美联储 FOMC 排期表 + 财政部 2Y/5Y 日终收益率 + CME TU/FV（严格使用 FOMC 当日收盘确认意外方向，T+1 执行）。",
        "orthogonality": "顺势动量（Momentum）逻辑，与 Core3 的逆势回归（Mean Reversion）天然负相关，极端趋势市里正好充当对冲。",
        "costAndFalsification": "每年仅 4 次 SEP（8 次 FOMC），10 年大意外事件仅 15–25 次，小样本偶然性高；容易与近期高波动 whipsaw 混淆。",
        "validationPlan": "在 2014–2026 全部 FOMC 日测算议息日 2Y 变动 Z 值对 T+1..T+4 延续收益的预测力，并检验与 Core3 亏损日的对冲相关性。",
    },
    {
        "id": "IDEA-010",
        "title": "美债曲线「Carry + Roll-Down」跨期限相对价值排序（2Y–30Y 季度再平衡）",
        "instruments": "CME TU / FV / UXY / WN 或 2Y–30Y OTR 久期中性多空",
        "category": "经典固收因子 × 持有期收益",
        "horizon": "20–60 交易日（低换手）",
        "priorConfidencePct": 59,
        "mechanism": "收益率曲线上不同期限的「票息利差 + 骑乘下滑收益（Carry + Roll-Down per unit DV01）」差异显著：陡峭段骑乘丰厚、倒挂段骑乘为负。做多单位波动下 Carry+Roll 最高的期限、做空最低期限，属于百年机构固收最经典的低换手结构溢价。",
        "publicFeeds": "美国财政部每日 1M–30Y 完整官方平价曲线（直接计算精确 Roll-Down 与融资利差）+ CME 期货。",
        "orthogonality": "超低频（月度换手），与 Core3 的 3.7 天高频流/回归策略在持有周期和经济学来源上完全正交。",
        "costAndFalsification": "在曲线剧烈熊平或牛陡反转期（如 2022–2023 倒挂期）可能出现较长回撤；必须与动态波动率缩放配合，避免单一期限押注过重。",
        "validationPlan": "用 2014–2026 财政部官方全曲线精确构造各期限 3 个月预期 Carry+Roll 因子，在 CME 因果收益与零换月 ETF 上跑严格 OOS 验证。",
    },
    {
        "id": "IDEA-011",
        "title": "CFTC 杠杆基金 vs 资管持仓极端拥挤度反向指标（Weekly Positioning Extreme）",
        "instruments": "CME TU / FV / TY / WN",
        "category": "市场微观结构 × 持仓拥挤",
        "horizon": "10–20 交易日",
        "priorConfidencePct": 48,
        "mechanism": "当 CFTC 金融期货持仓报告显示杠杆基金（Leveraged Funds）空头或资管（Asset Managers）多头触及 3 年极端分位（>95% 或 <5%）时，增量跟风资金枯竭，一旦催化触发便引发剧烈踩踏（Short Squeeze / Crowded Unwind）。",
        "publicFeeds": "CFTC 官方每周五 15:30 ET 公布的 TFF 报告（严格周二截数、下周一执行，且剔除 2023-02 ION 网络攻击延迟期）。",
        "orthogonality": "周频/月频仓位拥挤因子，独立于日历资金流和 5 日短期曲线回归。",
        "costAndFalsification": "基差交易（Basis Trade）导致 2023–2026 杠杆基金期货空头结构性创历史新高，传统简单 Z 值会持续过早做多踩雷！必须用「杠杆基金净空头 − 资管净多头」残差或 52 周短窗变化率剥离基差交易漂移。",
        "validationPlan": "在本地 Python 中专门检验剥离基差交易漂移后的 CFTC 拥挤度指标，若在 2023–2026 仍失效则果断淘汰。",
    },
    {
        "id": "IDEA-012",
        "title": "跨时区流动性格局：欧盘收盘（11:30 ET）前 vs 美盘尾盘（15:00–16:00 ET）执行时钟优化",
        "instruments": "Core3 现有全套 CME H27（TU / FV / UXY / WN）执行升级",
        "category": "执行 Alpha × 降低真实滑点",
        "horizon": "日内执行窗口优化",
        "priorConfidencePct": 68,
        "mechanism": "同样一套 Core3 信号，如果在最优流动性与资金流窗口下单（例如拍前空头在拍卖前一日上午建仓、EOM 多头在伦敦定盘前后切入），哪怕每笔少付 0.02–0.03bp 滑点，按年化换手就能直接多赚 +0.3%～+0.5%/年无风险净收益——这是机构交易台最确定的「免费 Alpha」。",
        "publicFeeds": "你日常在私密录单台积累的真实下单时间 & 滑点 JSON（零公司专有数据）+ 零换月 ETF 09:30 Open vs 16:00 Close 公开对比。",
        "orthogonality": "零新增市场风险，直接提升现有 Core3 的净夏普与 Calmar。",
        "costAndFalsification": "必须积累至少 20–40 个真实前瞻交易日记录才有统计显著性，不能凭 2–3 天手感拍脑袋定规则。",
        "validationPlan": "待 G6 锁箱满 20 天后，将云端 ETF 09:30 Open vs 16:00 Close 差值 + 你导出的私密滑点日志合并做时段归因。",
    },
]


def _pick_daily_spotlight(as_of_iso: str) -> dict[str, Any]:
    """Deterministic daily rotation across all 12 institutional R&D ideas based on trading date."""
    d = date.fromisoformat(as_of_iso)
    # Deterministic index cycling cleanly across weekdays
    ordinal_idx = (d - date(2026, 11, 24)).days % len(CURATED_ALPHA_IDEAS)
    return CURATED_ALPHA_IDEAS[ordinal_idx]


def _diagnose_regime(panel: pd.DataFrame, paper: dict) -> dict[str, Any]:
    mkt = paper["marketSnapshot"]
    tk_u = paper["todayTickets"]["ultra"]
    dd = paper.get("explain", {}).get("modes", {}).get("ultra", {}).get("damper_details", {})
    move = float(mkt["move"])
    move_p75 = float(dd.get("move_p75", 85.0))
    damper = float(tk_u["signals"]["damper"])
    s2s = float(mkt["s2s10sBp"])
    s5s = float(mkt["s5s30sBp"])

    # 1-day curve moves from latest 2 rows of panel
    d2y_bp = round(float((panel["ust_2y"].iloc[-1] - panel["ust_2y"].iloc[-2]) * 100.0), 1) if len(panel) >= 2 else 0.0
    d10y_bp = round(float((panel["ust_10y"].iloc[-1] - panel["ust_10y"].iloc[-2]) * 100.0), 1) if len(panel) >= 2 else 0.0
    d30y_bp = round(float((panel["ust_30y"].iloc[-1] - panel["ust_30y"].iloc[-2]) * 100.0), 1) if len(panel) >= 2 else 0.0
    d2s10s_bp = round(d10y_bp - d2y_bp, 1)

    if damper <= 0.65:
        vol_regime = "高波动防御区"
        vol_tone = "warn"
        vol_note = f"^MOVE={move:.1f} 显著高于过去一年 75 分位 ({move_p75:.1f})，单层阻尼已收紧至 {damper:.2f}×，严格防 whipsaw。"
    elif damper < 0.99:
        vol_regime = "偏高波动温和降仓"
        vol_tone = "warn"
        vol_note = f"^MOVE={move:.1f} 高于 252d 75 分位 ({move_p75:.1f})，系统自动按 {damper:.2f}× 轻度降仓，兼顾收益与回撤控制。"
    else:
        vol_regime = "平稳波动满额运行"
        vol_tone = "ok"
        vol_note = f"^MOVE={move:.1f} 位于 252d 75 分位 ({move_p75:.1f}) 以下，阻尼 1.00× 全额释放目标风险预算。"

    curve_shape = "正斜率陡峭" if s2s >= 20 else ("微陡平坦" if s2s >= 0 else "倒挂区间")
    move_summary = (
        f"上一交易日美债收线：2Y {mkt['ust2y']:.2f}% ({d2y_bp:+.1f}bp) · "
        f"10Y {mkt['ust10y']:.2f}% ({d10y_bp:+.1f}bp) · "
        f"30Y {mkt['ust30y']:.2f}% ({d30y_bp:+.1f}bp)，"
        f"2s10s={s2s:+.1f}bp ({d2s10s_bp:+.1f}bp) / 5s30s={s5s:+.1f}bp（{curve_shape}）。"
    )
    return {
        "volRegime": vol_regime,
        "volTone": vol_tone,
        "volNote": vol_note,
        "curveShape": curve_shape,
        "dailyMoveSummary": move_summary,
        "d2yBp": d2y_bp,
        "d10yBp": d10y_bp,
        "d30yBp": d30y_bp,
    }


def _build_session_review(ledger: dict, paper: dict, mode: str) -> dict[str, Any]:
    fwd = paper["forward"][mode]
    hist_key = "ultra_50k" if mode == "ultra" else "enhanced_50k"
    hist = paper["historical10yOos"]["models"][hist_key]
    settled = [
        e for e in ledger.get("entries", [])
        if e.get("mode") == mode and e.get("status") == "SETTLED_VERIFIED" and e.get("settlement")
    ]
    settled.sort(key=lambda x: x["execDate"])

    if not settled:
        tk = paper["todayTickets"][mode]
        return {
            "hasSettlement": False,
            "summary": (
                f"前瞻锁箱已于 {paper['freezeDate']} 正式冻结启动（当前 0 / {fwd['g6TargetSessions']} 日已结算）。"
                f"首笔冻结单（执行日 {tk['execDate']} → 结算日 {tk['valuationEndDate']}）将在 {tk['valuationEndDate']} 收盘后"
                f"由云端自动完成首次 Auto CME H27 + 零换月 ETF 双轨结算。"
            ),
            "latestSettled": None,
            "cumCmeNetUsd": 0.0,
            "cumCmeNetPct": 0.0,
            "cumEtfOpenNetUsd": 0.0,
            "cumEtfCloseNetUsd": 0.0,
            "cmeVsEtfCloseUsd": None,
            "g6Settled": fwd["settledSessions"],
            "g6Target": fwd["g6TargetSessions"],
            "forwardSharpe": None,
            "forwardHitRatePct": None,
            "histBenchmarkSr": hist["sharpe"],
            "histBenchmarkMaxDd": hist["max_dd_pct"],
        }

    last = settled[-1]
    s = last["settlement"]
    legs = s.get("legs", [])
    best_leg = max(legs, key=lambda x: x["pnlUsd"]) if legs else None
    worst_leg = min(legs, key=lambda x: x["pnlUsd"]) if legs else None
    gap_usd = round(float(fwd["cumCmeNetUsd"] - fwd["cumEtfCloseNetUsd"]), 1)

    parts = [
        f"最新已结算前瞻期 {last['execDate']} → {last['valuationEndDate']}：Auto CME 净盈亏 {s['cmeNetUsd']:+,.0f} 美元（{s['cmeNetPct']:+.2f}%）"
    ]
    if s.get("etfOpenNetUsd") is not None and s.get("etfCloseNetUsd") is not None:
        parts.append(f"，同期零换月 ETF 早盘 {s['etfOpenNetUsd']:+,.0f} / 收盘 {s['etfCloseNetUsd']:+,.0f} 美元")
    if best_leg and worst_leg and len(legs) > 1:
        parts.append(f"。最佳腿 {best_leg['leg']}（{best_leg['pnlUsd']:+,.0f} 美元），拖累腿 {worst_leg['leg']}（{worst_leg['pnlUsd']:+,.0f} 美元）")
    parts.append(f"。累计 G6 进度 {fwd['settledSessions']} / {fwd['g6TargetSessions']} 天，累计净值 {fwd['cumCmeNetUsd']:+,.0f} 美元（{fwd['cumCmeNetPct']:+.2f}%）。")

    return {
        "hasSettlement": True,
        "summary": "".join(parts),
        "latestSettled": {
            "execDate": last["execDate"],
            "valuationEndDate": last["valuationEndDate"],
            "cmeNetUsd": s["cmeNetUsd"],
            "cmeNetPct": s["cmeNetPct"],
            "cmeCostUsd": s["cmeCostUsd"],
            "etfOpenNetUsd": s.get("etfOpenNetUsd"),
            "etfCloseNetUsd": s.get("etfCloseNetUsd"),
            "legs": legs,
        },
        "cumCmeNetUsd": fwd["cumCmeNetUsd"],
        "cumCmeNetPct": fwd["cumCmeNetPct"],
        "cumEtfOpenNetUsd": fwd["cumEtfOpenNetUsd"],
        "cumEtfCloseNetUsd": fwd["cumEtfCloseNetUsd"],
        "cmeVsEtfCloseUsd": gap_usd,
        "g6Settled": fwd["settledSessions"],
        "g6Target": fwd["g6TargetSessions"],
        "forwardSharpe": fwd["forwardSharpe"],
        "forwardHitRatePct": fwd["forwardHitRatePct"],
        "histBenchmarkSr": hist["sharpe"],
        "histBenchmarkMaxDd": hist["max_dd_pct"],
    }


def upsert_daily_briefing(
    briefings_path: Path,
    panel: pd.DataFrame,
    paper: dict,
    ledger: dict,
    max_entries: int = 90,
) -> dict:
    """Create or update today's archived post-close cloud briefing in `alpha-briefings.json`."""
    if briefings_path.exists():
        store = json.loads(briefings_path.read_text())
    else:
        store = {
            "schemaVersion": "1.0_cloud_daily_briefings",
            "entries": [],
        }

    as_of = paper["panelAsOfDate"]
    tk_u = paper["todayTickets"]["ultra"]
    tk_e = paper["todayTickets"]["enhanced"]
    regime = _diagnose_regime(panel, paper)
    spotlight = _pick_daily_spotlight(as_of)

    entry = {
        "asOfDate": as_of,
        "execDate": tk_u["execDate"],
        "valuationEndDate": tk_u["valuationEndDate"],
        "generatedAtUtc": datetime.now(timezone.utc).isoformat(),
        "g1AllPassed": bool(paper["g1Verification"]["allPassed"]),
        "g1Count": f"{paper['g1Verification']['passedCount']}/{paper['g1Verification']['totalChecks']}",
        "marketSnapshot": paper["marketSnapshot"],
        "regimeDiagnosis": regime,
        "reviews": {
            "ultra": _build_session_review(ledger, paper, "ultra"),
            "enhanced": _build_session_review(ledger, paper, "enhanced"),
        },
        "nextAction": {
            "ultra": {
                "actionSummary": tk_u.get("lifecycle", {}).get("actionSummary"),
                "pillars": tk_u.get("lifecycle", {}).get("pillars"),
                "netDv01Usd": tk_u["netDv01Usd"],
                "grossDv01Usd": tk_u["grossDv01Usd"],
                "contracts": tk_u["contracts"],
            },
            "enhanced": {
                "actionSummary": tk_e.get("lifecycle", {}).get("actionSummary"),
                "pillars": tk_e.get("lifecycle", {}).get("pillars"),
                "netDv01Usd": tk_e["netDv01Usd"],
                "grossDv01Usd": tk_e["grossDv01Usd"],
                "contracts": tk_e["contracts"],
            },
        },
        "researchSpotlight": spotlight,
        "pmConfidencePct": 86 if paper["forward"]["ultra"]["settledSessions"] < 20 else 90,
    }

    by_date = {e["asOfDate"]: e for e in store.get("entries", [])}
    by_date[as_of] = entry
    ordered = [by_date[k] for k in sorted(by_date.keys(), reverse=True)[:max_entries]]

    out = {
        "schemaVersion": "1.0_cloud_daily_briefings",
        "updatedAtUtc": datetime.now(timezone.utc).isoformat(),
        "totalCatalogIdeas": len(CURATED_ALPHA_IDEAS),
        "latestAsOfDate": ordered[0]["asOfDate"] if ordered else None,
        "entries": ordered,
        "ideaCatalog": CURATED_ALPHA_IDEAS,
    }
    briefings_path.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n")
    return out
