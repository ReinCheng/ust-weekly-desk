import type { MarketEvent, Reading } from "./model";

type Move = "up" | "down";
type Rule = {
  metric: string;
  unit: Reading["unit"];
  above: Move;
  aboveNote: string;
  belowNote: string;
  checks: string[];
  invalidate: string;
  channel: "policy" | "growth" | "supply";
};

const inflation = (metric: string, checks: string[], invalidate: string): Rule => ({
  metric, unit: "%", above: "up", channel: "policy",
  aboveNote: "持续性分项同步偏热时，市场可能推迟降息，先看 2Y 和 5Y 上行。若 30Y 比前端更弱，转查通胀补偿和期限溢价。",
  belowNote: "持续性分项同步放缓时，降息预期可能提前，2Y 和 5Y 易先下行。若长端同时受到避险买盘推动，曲线未必变陡。",
  checks, invalidate,
});
const rules: Record<string, Rule> = {
  "美国 CPI": inflation("核心 CPI 月率", ["核心服务、住房及核心商品是否同向", "整体 CPI 的油价贡献", "2Y 是否跟随 SOFR 期货隐含政策路径"],
    "若核心超预期主要来自个别波动分项，或 2Y 在 15–30 分钟内回到发布前区间，降低对持续抛售的判断。"),
  "PCE 物价 / 个人收支": inflation("核心 PCE 月率", ["核心 PCE 与收入、实际消费是否同向", "以前公布的 CPI/PPI 分项已经反映了多少", "若与 GDP 同时发布，分开处理需求和价格信号"],
    "核心 PCE 的偏差若已由先前数据反映，或实际消费与价格信号相反，优先观察发布后的净利率反应。"),
  "美国 PPI": {
    metric: "最终需求 PPI 月率", unit: "%", above: "up", channel: "policy",
    aboveNote: "若医疗、航空及金融服务等 PCE 相关分项也偏热，2Y/5Y 可能上行。只有能源或贸易服务利润率波动时，初动常缺少延续条件。",
    belowNote: "若与 PCE 相关的服务价格同步变软，2Y/5Y 可能下行。只有能源回落时，对核心通胀的解释力较弱。",
    checks: ["最终需求服务与商品构成", "传导至核心 PCE 的分项", "最近 CPI 是否给出同方向信号"],
    invalidate: "PPI headline 和 PCE 相关分项方向相反，或前端迅速回吐初动时，降低政策路径重定价的判断。",
  },
  "美国非农就业": {
    metric: "非农新增就业", unit: "千人", above: "up", channel: "policy",
    aboveNote: "新增偏强、失业率低于或符合预期、工资偏强且修订向上时，降息预期可能后移，2Y/5Y 易先上行。",
    belowNote: "新增偏弱且伴随失业率上升、工资降温或下修时，2Y/5Y 易先下行。若衰退担忧扩大，10Y/30Y 也可能快速下行。",
    checks: ["失业率和劳动参与率", "平均时薪月率", "前两月合计修订及新增就业的行业广度"],
    invalidate: "非农高出预期但修订抵消增量，或失业率与时薪指向明显降温时，按混合报告处理。",
  },
  "初请失业金": {
    metric: "初请失业金", unit: "千人", above: "down", channel: "policy",
    aboveNote: "申领人数偏高代表就业边际转弱。若续请和四周均值也上行，2Y/5Y 易下行，降息预期可能提前。",
    belowNote: "申领人数偏低代表就业更有韧性。若续请同步回落，2Y/5Y 可能上行，市场可能推迟降息。",
    checks: ["初请四周移动均值", "续请失业金和上周修订", "假日季调、天气、罢工等一次性因素"],
    invalidate: "偏差主要出自假日或个别州、续请反向，或同刻发布的通胀数据主导时，降低对初请的权重。",
  },
  "美国零售销售": {
    metric: "零售销售对照组月率", unit: "%", above: "up", channel: "growth",
    aboveNote: "对照组强且前值上修，市场可能上调真实需求假设。5Y/10Y 易上行，2Y 是否跟随取决于政策预期。",
    belowNote: "对照组偏弱且修订下调时，5Y/10Y 易下行。如果名义金额受价格变化主导，先核对销量和实际消费。",
    checks: ["对照组（剔除汽车、汽油、建材、餐饮）", "前两月修订", "同刻初请和进口价格等发布"],
    invalidate: "整体销售的意外只来自汽车或汽油，或对照组和修订方向相反时，弱化对核心消费的判断。",
  },
  "美国 GDP": {
    metric: "实际 GDP 季环比折年率", unit: "%", above: "up", channel: "growth",
    aboveNote: "若私人国内最终销售同步高于预期，5Y/10Y 易上行。若主要由库存或净出口驱动，持续性较弱。",
    belowNote: "若私人国内最终销售同步放缓，5Y/10Y 易下行。若价格指数反而偏强，2Y 可能企稳或反向上行。",
    checks: ["私人国内最终销售、消费和固定投资", "库存和净出口的贡献", "价格指数与同刻的核心 PCE"],
    invalidate: "内需和 headline 反向、价格分项反向，或修订和最新高频数据已经反映增速变化时，避免只按 headline 下结论。",
  },
  "JOLTS 职位空缺": {
    metric: "职位空缺", unit: "千人", above: "up", channel: "policy",
    aboveNote: "空缺偏高且招聘、主动离职同向改善时，2Y 易上行。单看空缺上跳，政策信号有限。",
    belowNote: "空缺偏低且招聘和离职同步走弱时，2Y 易下行。若裁员稳定，可能主要是劳动力供需恢复平衡。",
    checks: ["招聘率与离职率", "职位空缺对失业人数的比率", "调查误差和前值修订"],
    invalidate: "空缺大幅修订或与工资及非农方向相反时，优先权重给其他劳动力数据。",
  },
  "就业成本指数（ECI）": inflation("就业成本指数季率", ["工资与福利贡献", "私人部门与行业广度", "核心服务通胀与 2Y 政策路径"],
    "若加速只来自福利、工资分项没有同向变化，或前端反应没有延续，降低对工资通胀的判断。"),
};
const auction: Rule = {
  metric: "中标收益率", unit: "%", above: "up", channel: "supply",
  aboveNote: "中标收益率高于截标前 WI，形成 tail。若 dealer 获配偏高且该券比邻券走弱，说明承接偏弱。",
  belowNote: "中标收益率低于截标前 WI，形成 stop-through。若间接投标占比改善且该券相对邻券走强，说明需求较好。",
  checks: ["接近截标时刻、同一券且可成交的 WI", "投标倍数及一级交易商获配", "拍卖期限与相邻期限的相对变化"],
  invalidate: "WI 已过时、邻券同幅移动，或拍卖券相对走势很快回到截标前水平时，降低对独立供给冲击的判断。",
};

export function ruleFor(event: MarketEvent) {
  return rules[event.title] ?? (
    event.category === "auction" && !/\bFRN\b/.test(event.title) && ["longAuction", "coupon", "tips"].includes(event.kind)
      ? event.kind === "tips" ? { ...auction, metric: "中标实际收益率" } : auction
      : undefined
  );
}

export function scenarioFor(event: MarketEvent, rule: Rule, comparison: "above" | "below") {
  const up = (comparison === "above") === (rule.above === "up");
  const direction = up ? "上行" : "下行";
  const slope = up ? "趋平" : "趋陡";
  if (rule.channel === "supply") return {
    direction: (event.kind === "tips" ? "该期限实际收益率" : "拍卖期限相对收益率") + direction,
    curve: event.kind === "longAuction"
      ? "若长端独立波动，重点看 5s30s 和 10Y/20Y/30Y fly。长端走弱时 5s30s 可能变陡。"
      : "先看拍卖券相对邻券的表现。若 2Y 与长端同时移动，检查是否有共同的宏观或市场因素。",
    text: comparison === "above" ? rule.aboveNote : rule.belowNote,
  };
  return {
    direction: (rule.channel === "policy" ? "2Y / 5Y" : "5Y / 10Y") + " 收益率倾向" + direction,
    curve: rule.channel === "policy"
      ? "若 2Y 比 10Y 变动更大，2s10s 可能" + slope + "。长端供给或避险可改变斜率。"
      : "看 2Y 是否确认政策路径变化，再用 5s30s 区分需求冲击和长端期限溢价。",
    text: comparison === "above" ? rule.aboveNote : rule.belowNote,
  };
}

export function actualFor(event: MarketEvent, rule: Rule) {
  const reading = event.readings?.find(value => value.label === rule.metric && value.unit === rule.unit);
  if (reading) return reading.value;
  if (rule.channel === "supply") {
    const rate = event.actual?.match(/中标收益率\s+(-?\d+(?:\.\d+)?)%/)?.[1];
    if (rate !== undefined) return Number(rate);
  }
}
