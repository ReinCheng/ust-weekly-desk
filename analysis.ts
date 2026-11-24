import { impactSort, type Calendar, type Kind, type Scenario } from "./model";

export const dimensions = ["美债收益率", "流动性", "电子报价", "RFQ 执行", "现券 / 期货对冲", "Passive vs Aggressive", "Long-end 风险"] as const;
const macro = [
  "冲击时 OTR 深度可能先降后回补。观察首笔成交后 30 秒至 5 分钟的盘口恢复。",
  "检查 cash 与 futures 的时间戳及 mid 偏差。跳价时用更短的 quote TTL，并按数据新鲜度恢复常态。",
  "分开看 outright 与 switch 的 fill rate。价格失效时复核 RFQ wiretime 和客户端有效窗口。",
  "按 key-rate DV01 匹配 TU/FV/TY 的可交易深度，检查 CTD、转换因子和 cash–futures basis。",
  "深度恢复、markout 稳定后评估挂单。残余 DV01 接近风控线时比较主动成交成本与继续暴露的风险。",
  "观察 5s30s 与 10s30s，分辨前端政策路径重定价与长端期限溢价/通胀补偿变化。",
];
const supply = [
  "截标前盯 WI concession 与盘口深度，结果后再观察 OTR 和邻券成交能否同步恢复。",
  "分开 WI、旧 OTR 和新 OTR 定价。校验新券映射、参考价时间戳和 cash–futures mid 偏差。",
  "跟踪该期限 outright 与 switch 的相对成交率、quote age 和 +30 秒 markout，避免把新旧券误作同一流动性桶。",
  "先按 key-rate DV01 估算期货覆盖，再复核 CTD 与转换因子，单独记录新旧券和邻券 basis 残差。",
  "用盘口恢复与 concession 持续性评估 passive。结果后风险超限时比较分批主动执行与一次性扫单。",
  "观察 10s30s、20s30s 和 10/20/30 fly，检查 long-end DV01 集中与相对价值脱节。",
];
const holiday = [
  "跨市场开闭市不同步时，深度、成交频率和恢复速度可能偏离普通交易日。",
  "按 venue/session 校验参考源和 stale 阈值。现券停盘期间标记上一可执行 mid 的时间。",
  "跟踪可报价 venue、时段和 RFQ timeout，区分无可执行报价与常规未成交。",
  "从 CME 核对所用合约的交易和重开时刻。用可执行的现券和期货价格评估 basis。",
  "深度不足时缩小单笔并比较等待成本。以实际可执行数量和剩余 DV01 约束主动成交。",
  "重开时观察 20Y/30Y 相对表现，避免用稀疏成交推断持久的 curve move。",
];
const withBase = (yieldText: string, base: string[], changes: Record<number, string> = {}) =>
  [yieldText, ...base].map((value, i) => changes[i] ?? value);

export const analysis: Record<Kind, string[]> = {
  inflation: withBase("优先核对未四舍五入精确值、Supercore、前月修订及对 Core PCE 的传导权重；鹰派期偏熊平，通胀失锚/财政期可转熊陡。", macro),
  ppi: withBase("跳过能源与贸易服务利润率噪音，优先核对医疗、机票、投管等 PCE 桥接分项与前月修订，防止 Headline 假信号反杀。", macro),
  jobs: withBase("非农新增、失业率（家庭调查）、前两月修订与时薪四维共振时趋势最清晰；冲突时拐点期优先盯失业率与修订。", macro),
  claims: withBase("方向与通胀相反（申领越高越利多美债）。重点盯非农调查周（含每月 12 日）、续请与四周均值，警惕节假日季调噪音。", macro),
  retail: withBase("核心看直接进 GDP 的对照组、餐饮服务与前两月修订，排除油价名义干扰；曲线斜率随高利率期（熊陡）或降息定价期（熊平）分叉。", macro, {
    3: "对比 08:30 的 RFQ 成交率与 +30 秒 markout。若同刻还有初请或物价数据，将该窗口标为混合冲击。",
  }),
  growth: withBase("区分初值与修正值、剥离库存与净出口噪音（进口大增常代表内需强），同时严防“弱增速 + 强价格分项”的滞胀反向行情。", macro),
  policy: withBase("分别记录 14:00 声明和 14:30 记者会前后的收益率。发布 SEP 的会议另查当年、次年和长期名义联邦基金利率点阵。", macro, {
    5: "分别评估 14:00 声明和 14:30 记者会窗口的执行成本。若盘口在两窗口之间恢复，再重估挂单胜率与剩余风险。",
  }),
  minutes: withBase("纪要滞后三周，须先扣除会后 CPI/非农已覆盖的旧信息，重点抓 QT 资产负债表路线图与人数词（most/many/a few）分歧。", macro, {
    3: "对比前一流动性窗口的 RFQ 基线。若同日 13:00 有 20Y 长债拍卖，必须拆开拍卖后和纪要后的 markout。",
    6: "若长端波动先于纪要或集中在 20Y，结合 WI 和 10s20s30s fly 核对供给归因。",
  }),
  speech: withBase("先看发言人权重（主席/核心委员 > 普通理事）并读官网原稿，再把讲稿与公开问答（Q&A）拆开评估边际措辞变化。", macro, {
    5: "把讲稿和公开问答作为独立窗口。只有事件触发与流动性条件同时满足时才重新评估执行方式。",
  }),
  technicalSpeech: withBase("主题偏监管、支付或技术时通常不构成利率驱动。仅在问答出现货币政策或 QT 增量表态时再检验期限反应。", macro, {
    2: "用行情跳价、数据时间戳和深度变化触发检查，维持对主题相关性的区分。",
  }),
  longAuction: withBase("核对 Stop vs WI、事前 Concession 深度与 Primary Dealer 兜底占比（30Y >20% 易发尾盘抛压；20Y 重点盯 10s20s30s fly）。", supply, {
    4: "以 20Y/30Y key-rate DV01 测算 TY、US 或 UB 的组合覆盖。盯 CTD/CF、basis 及仍留在 20Y fly 的风险。",
  }),
  coupon: withBase("按期限分层：2Y/3Y 锚定政策路径、外溢小；5Y/7Y Belly 敏感于交易商资产负债表与 7Y 尾险；10Y 为全球基准并定调次日 30Y。", supply, {
    6: "用 2s5s10s fly 和 2s10s/5s30s 检查 Belly 供给有没有向长端外溢。",
  }),
  tips: withBase("先看 Real Yield Stop 对 WI 的 tail，再用 TIPS 专属 Dealer 标尺（常规仅 5%–10%）核对承接，并拆分名义利率与 Breakeven。", supply, {
    4: "名义期货仅对冲名义利率 beta，会残留 Breakeven 敞口；需单独监控 real-rate 与通胀预期基差。",
    6: "观察 real-curve 斜率与名义 10s30s，核对是通胀补偿变化还是全曲线久期变化。",
  }),
  bills: withBase("T-bill 与 2Y FRN 久期近零，核心盯贴现率/折扣利差相对 SOFR/GC 资金面、TGA 结算抽水与季末流动性，不直接外推至长端。", supply, {
    2: "主要核对 bill 及前端报价源，观察 coupon mid 是否出现可验证的资金面外溢。",
    4: "先看资金与 carry；用 coupon 期货对冲前端利率时单独记录基差与期限错配。",
    6: "长端通常无直接暴露，需看到回购资金压力外溢和长端盘口变化再归因。",
  }),
  funding: withBase("周四 16:30 H.4.1 重点看准备金余额、TGA 与 ON RRP 缓冲垫消耗，结合 4 周趋势与 SOFR-IORB 利差预判 QT 终点。", supply),
  holiday: withBase("休市窗口的期货与海外变动会在现券重开首 15 分钟一次性跳空反映，用重开可执行报价与恢复深度确认方向。", holiday),
  earlyClose: withBase("提前收市压缩可执行窗口，尾盘稀疏盘口极易出现非基本面长影线，须缩减单笔并核对跨市场截点。", holiday),
  marketCheck: withBase("以官方合约时段为准；现券与期货时段错开时（如退伍军人节/感恩节）分别标记现券与期货报价观测时点。", holiday),
};

export function scenariosFor(calendar: Calendar): Scenario[] {
  const events = [...calendar.events].sort(impactSort);
  const chosen = new Set<string>();
  const result: Scenario[] = [];
  const add = (scenario: Scenario) => {
    result.push(scenario);
    scenario.events.forEach(id => chosen.add(id));
  };
  for (const long of events.filter(event => event.kind === "longAuction" && event.status === "confirmed")) {
    const minutes = events.find(event => event.kind === "minutes" && event.date === long.date);
    if (minutes) add({
      id: "supply-minutes-" + long.date, title: "长债供给与 FOMC 纪要的双重冲击", kind: "longAuction", impact: 5,
      detail: "按 13:00 截标后与 14:00 纪要后两个窗口拆分归因。前一窗口看 20Y/10s20s30s fly，后一窗口看 2Y/5Y 与 QT 措辞。",
      trigger: "20Y stop 高于截标前 WI 且 Dealer 获配偏高、fly 走阔；纪要若再释出鹰派/QT 增量，前端与长端形成接力。",
      invalidation: "20Y 相对弱势迅速回归，或纪要内容已被会后硬数据覆盖、2–5Y 无延续成交。",
      events: [long.id, minutes.id],
    });
  }
  for (const cpi of events.filter(event => event.title === "美国 CPI" && event.status === "confirmed")) {
    const auction = events.find(event => event.category === "auction" && event.impact >= 4 && event.date === cpi.date);
    if (auction) add({
      id: "cpi-supply-" + cpi.date, title: "CPI 与中长债拍卖同日双击风险", kind: "inflation", impact: 5,
      detail: "类似 2024-04-10：若早盘 CPI 超预期推高波动率，午后拍卖常因风险预算收缩而放大 Tail。",
      trigger: "08:30 Core CPI / Supercore 偏热导致盘中单边抛售，且 13:00 拍卖未获充分让价并出现 ≥2 bp Tail。",
      invalidation: "CPI 温和落地，或拍卖前已完成充分 Concession 并录得强终端 Stop-through。",
      events: [cpi.id, auction.id],
    });
  }
  const definitions: Partial<Record<Kind, [string, string, string, string]>> = {
    inflation: ["核心通胀意外", "区分未四舍五入精确值、Supercore 与 PCE 传导权重，并按当前周期判断熊平还是熊陡。", "精确核心月率与 Supercore 同向偏离预期，2–5Y 出现成交确认。", "仅由高权重住房 OER 或个别波动项引起，2Y 迅速回吐。"],
    ppi: ["PPI 对 Core PCE 的桥接修正", "跳过 Headline 噪音，直查医疗/机票/投管分项与前月修正。", "PCE 桥接服务分项与前月方向一致，实质改写投行 Core PCE 预测。", "Headline 偏热仅由能源或 Trade Services 驱动，或前月大幅下修抵消。"],
    jobs: ["非农与失业率改变降息路径", "企业调查（新增+修订+工时）与家庭调查（失业率+参与率）交叉核对。", "新增、失业率、修订与工资四维共振，2Y 引领曲线大幅重定价。", "新增与失业率/前两月修订冲突，拐点期优先跟随失业率与修订。"],
    retail: ["消费韧性与曲线斜率分叉", "先看进入 GDP 的对照组与餐饮服务，再按当前利率周期判断熊陡还是熊平。", "对照组与前两月修订同向，且剔除油价后真实消费走强。", "Headline 仅由汽车/汽油波动带动，或被同刻数据冲淡。"],
    minutes: ["纪要释放 QT 或鹰鸽增量", "先扣除三周内已被硬数据覆盖的旧表述，聚焦 QT 与人数词分歧。", "纪要披露 QT 节奏新信号或意外分歧，且成交持续。", "措辞完全落后于最新硬数据与主席讲话。"],
    policy: ["FOMC 声明与记者会的两段反应", "比较声明和问答各自对应的 2Y、5Y 和 10Y 变动。有 SEP 时同时记录点阵变化。", "记者会确认声明传递的政策路径，前端收益率延续首轮方向。", "问答改变市场对政策路径的理解，曲线回到决议前区间。"],
    longAuction: ["长端供给测试期限溢价", "结合事前让价深度、Stop vs WI 与 Primary Dealer 兜底占比综合评估。", "Tail ≥2 bp 且 Dealer 获配飙升（30Y >20%），5s30s/fly 持续走弱。", "事前让价充分且终端买盘强劲，邻券同步走稳。"],
    tips: ["TIPS 实际利率与 Breakeven 拆分", "用 TIPS 专属 Dealer 标尺（常规 5%–10%）区分真实利率抛压与通胀补偿变化。", "Real Yield 出现明显 Tail 且 Dealer >12%，名义债不完全跟随。", "TIPS 相对弱势在盘口恢复后收敛。"],
    holiday: ["休市与重开时段的跨市场错配", "逐一核对 SIFMA 现券、NYSE 美股与 CME Globex 期货截点及重开时刻。", "现券停盘期间期货单边变动，重开首 15 分钟跳空补价。", "双市场重开后深度与基差快速恢复常态。"],
    earlyClose: ["提前收市前的流动性压缩", "缩短窗口下缩减单笔、严防尾盘稀疏成交造成的非基本面假突破。", "报价源变少且可执行深度显著低于常态基线。", "剔除过期报价后跨市场深度维持正常。"],
  };
  for (const event of events) {
    if (result.length >= 5) break;
    const rule = definitions[event.kind];
    if (!rule || chosen.has(event.id) || result.some(item => item.kind === event.kind) || event.impact < 3) continue;
    add({ id: "scenario-" + event.id, title: rule[0], kind: event.kind, impact: event.impact, detail: rule[1],
      trigger: rule[2], invalidation: rule[3], events: [event.id] });
  }
  return result.sort((a, b) => b.impact - a.impact);
}
