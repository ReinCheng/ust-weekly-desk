import { impactSort, type Calendar, type Kind, type Scenario } from "./model";

export const dimensions = ["美债收益率", "流动性", "电子报价", "RFQ 执行", "现券 / 期货对冲", "Passive vs Aggressive", "Long-end 风险"] as const;
const macro = [
  "冲击时 OTR 深度可能先降后回补。观察首笔成交后 30 秒至 5 分钟的盘口恢复。",
  "检查 cash 与 futures 的时间戳及 mid 偏差。跳价时用更短的 quote TTL，并按数据新鲜度恢复常态。",
  "分开看 outright 与 switch 的 fill rate。价格失效时复核 RFQ wiretime 和客户端有效窗口。",
  "按 key-rate DV01 匹配 TU/FV/TY 的可交易深度，检查 CTD、转换因子和 cash–futures basis。",
  "深度恢复、markout 稳定后评估挂单。残余 DV01 接近风控线时比较主动成交成本与继续暴露的风险。",
  "观察 5s30s 与 10s30s，分辨前端政策路径重定价和长端期限溢价。",
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
  inflation: withBase("核心通胀强于预期时，2–5Y 易先上行。偏弱时观察降息定价及 bull steepening 的持续性。", macro),
  ppi: withBase("优先看可传导到 core PCE 的分项。若 headline 主要由易波动成分带动，检查 2–5Y 初动能否延续。", macro),
  jobs: withBase("结合非农、失业率、薪资和前值修正。方向一致时，前端政策路径反应通常更清晰。", macro),
  claims: withBase("比较首申、续申和四周均值。节假日前后先检查季调和修订，再解释前端走势。", macro),
  retail: withBase("优先看 control group 和前值修正。强于预期时跟踪 2Y/5Y 是否主导，辨别 10Y 的增长因子。", macro, {
    3: "对比 08:30 的 RFQ 成交率与 +30 秒 markout。若同刻还有物价数据，将该窗口标为混合冲击。",
  }),
  growth: withBase("区分 headline、关键分项与修订。若多项同时发布，用 2s5s 与 5s30s 判断增长及政策预期的主导期限。", macro),
  policy: withBase("比较 statement、SEP（如发布）和发布会。跟踪 2Y 与 5Y 的路径重定价及二次反转。", macro, {
    5: "分别评估声明和记者会窗口的执行成本。若盘口在两个窗口之间恢复，可重估挂单胜率和剩余风险。",
  }),
  minutes: withBase("只有对政策分歧、通胀风险或资产负债表的新增信息才构成独立情景。用 2Y/5Y 与长端相对走势辨别渠道。", macro, {
    3: "对比前一流动性窗口的 RFQ 基线。若同日有长债拍卖，分别标注拍卖后和纪要后的 markout。",
    6: "若长端波动先于纪要或集中在 20Y，结合 WI 和曲线残差核对供给归因。",
  }),
  speech: withBase("优先查官方讲稿。新政策路径措辞可能带动 2–5Y，延续旧表述时以成交确认方向。", macro, {
    5: "把讲稿和公开问答作为独立窗口。只有事件触发与流动性条件同时满足时才重新评估执行方式。",
  }),
  technicalSpeech: withBase("主题偏监管、支付或技术时通常优先级较低。若出现货币政策或资产负债表的新信息，再检验期限反应。", macro, {
    2: "用行情跳价、数据时间戳和深度变化触发检查，维持对主题相关性的区分。",
  }),
  longAuction: withBase("用 stop yield 减截标前可成交 WI yield 衡量 tail。若 tail 扩大且 dealer 获配偏高，观察该期限相对邻券走弱。", supply, {
    4: "以 20Y/30Y key-rate DV01 测算 TY、US 或 UB 的组合覆盖。盯 CTD/CF、basis 及仍留在 20Y fly 的风险。",
  }),
  coupon: withBase("核对 stop 与截标前 WI 的差、bid-to-cover 及获配构成。强弱要结合拍卖前 concession。", supply, {
    6: "用 2s10s 和 5s30s 检查 belly/前端供给有没有传导至长端。",
  }),
  tips: withBase("先看 real yield stop 对 WI 的 tail，再比较名义 10Y 与 10Y breakeven，拆分真实利率和通胀补偿。", supply, {
    4: "名义期货可对冲部分利率 beta。单独记录 real-rate 与 breakeven 残差，检查相近久期的 TIPS 和名义券。",
    6: "观察 real-curve 斜率与名义 10s30s，核对是通胀补偿变化还是全曲线久期变化。",
  }),
  bills: withBase("关注 bill stop rate 与前端资金利率，结合结算日、供给规模与 SOFR/GC 验证资金影响。", supply, {
    2: "主要核对 bill 及前端报价源，观察 coupon mid 是否出现可验证的联动。",
    4: "先看资金与 carry；用 coupon 期货对冲前端利率时单独记录基差与期限错配。",
    6: "长端通常为间接暴露，需看到融资压力外溢和长端盘口变化再归因。",
  }),
  funding: withBase("看准备金、TGA 等组成和资金利率验证。单周变动可能来自结算时间差。", supply),
  holiday: withBase("休市窗口的期货变化可能在现券重开时一次体现。用重开可成交报价确认收益率变化。", holiday),
  earlyClose: withBase("提前收市压缩可执行窗口。尾盘收益率变化需结合深度和跨资产时段解释。", holiday),
  marketCheck: withBase("以官方合约时段为准。现金和期货时段错开时标记收益率与期货报价的观测时点。", holiday),
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
      detail: "按截标后和纪要后两个窗口拆分归因。前一窗口看 20Y 相对 10Y/30Y，后一窗口看 2Y/5Y 是否接力。",
      trigger: "20Y stop 高于截标前可成交 WI，且 20Y 相对邻券持续走弱。纪要后若 2–5Y 同向重新定价，另计政策因子。",
      invalidation: "20Y 相对弱势快速回归，或 2–5Y 在纪要前已同幅移动。用两个窗口的深度、basis 和 markout 验证。",
      events: [long.id, minutes.id],
    });
  }
  const definitions: Partial<Record<Kind, [string, string, string, string]>> = {
    inflation: ["核心通胀意外", "区分前端政策路径冲击和长端期限溢价，再看曲线是否继续变平。", "核心月率及关键分项同向超出事前预期，2–5Y 出现成交确认。", "前端初动迅速回吐，或只有 headline 偏离预期。"],
    ppi: ["PPI 对 core PCE 的传导", "关注可纳入 PCE 的服务分项，再判读前端和 belly 的反应。", "相关分项明显偏离事前预期，2Y/5Y 的价格和成交同步。", "变化集中于与 PCE 关联较弱的分项，或盘口修复后收益率回吐。"],
    jobs: ["就业数据改变政策路径", "用非农、失业率和工资三个维度对比市场事前预期。", "就业、工资及修订指向同一方向，2–5Y 延续初动。", "分项方向互相抵消，或首轮利率反应快速回撤。"],
    retail: ["消费韧性与 belly 重定价", "先看 control group 和前值修订，分辨名义销售与可持续的需求变化。", "control group 与修订同向，且 2Y/5Y 在首轮后维持移动。", "headline 主要由波动分项驱动，或同刻其他发布解释了初动。"],
    minutes: ["纪要释放新增政策信息", "先比较前次声明和发布会，再检查政策路径或资产负债表的新增措辞。", "纪要揭示新的分歧，且 2Y/5Y 的成交支持重定价。", "措辞已由前次沟通覆盖，或收益率变化在发布前完成。"],
    policy: ["决议与发布会带来二次定价", "分别记录 statement、SEP 和记者会的前后价格。", "政策路径或风险表述偏离已定价假设，前端成交持续。", "记者会消化首轮冲击，曲线回到声明前的区间。"],
    longAuction: ["长端供给需要更深 concession", "先看 WI 与相邻期限，再分离拍卖后的市场方向和相对价值。", "stop 高于截标前 WI，且 dealer 获配和相对弱势支持供给解释。", "邻券同步移动且该期限 fly 迅速回归。"],
    tips: ["实际收益率与 breakeven 分化", "用实际利率和名义曲线解释 TIPS 结果后的相对移动。", "TIPS tail 扩大并伴随 real yield 相对走弱，名义 10Y 不完全跟随。", "TIPS 相对弱势在深度恢复后消失。"],
    holiday: ["休市与重开时段的流动性错配", "以 SIFMA 现券建议、NYSE 交易时段和 CME 合约日历各自核对。", "现券深度低于同时间基线，同时期货仍可交易或先行重开。", "两个市场重开后同步恢复，basis 和深度回归常态。"],
    earlyClose: ["提前收市前的流动性压缩", "在窗口缩短时分别测量现券与期货深度、时间戳和跨市场 basis。", "报价来源变少且可执行数量低于正常交易日同时间基线。", "剔除过期报价后，跨市场可执行深度仍接近正常时段。"],
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
