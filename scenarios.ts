import type { MarketEvent, Reading } from "./model";

type Move = "up" | "down";
export type Rule = {
  metric: string;
  unit: Reading["unit"];
  above: Move;
  aboveNote: string;
  belowNote: string;
  aboveCurve: string;
  belowCurve: string;
  checks: string[];
  invalidate: string;
  channel: "policy" | "growth" | "supply";
  noise?: number;
  big?: number;
  qualitative?: boolean;
  aboveLabel?: string;
  belowLabel?: string;
};

const rules: Record<string, Rule> = {
  "美国 CPI": {
    metric: "核心 CPI 月率", unit: "%", above: "up", channel: "policy", noise: 0.05, big: 0.15,
    aboveNote: "未四舍五入精确值与 Supercore（剔除住房核心服务）同步偏热时，降息定价快速后撤，2Y/5Y 领涨。先查超预期是否仅来自住房 OER（CPI 权重约 36%，但 PCE 仅约 16%）。",
    belowNote: "精确值偏软且核心服务/住房同步降温时，2Y/5Y 易大幅下行。若市场空头仓位极度拥挤，5Y/10Y 回补幅度有时会大于 2Y（如 2022-11-10）。",
    aboveCurve: "加息/鹰派按兵不动期常走熊平（2s10s 走平）；若市场担心通胀失锚或财政赤字，10Y Breakeven 与期限溢价上升可转为熊陡。",
    belowCurve: "常规走牛陡（2s10s 走陡）；但当 5Y/10Y 空头极度拥挤时，曲线可能平行下移甚至微平。",
    checks: [
      "未四舍五入精确值（0.26% 与 0.34% 均报 0.3%，交易方向截然相反）",
      "Supercore（剔除住房核心服务）与能传导进 Core PCE 的机票/商品/服务分项",
      "5Y/10Y Breakeven 与实际利率拆分，以及同日下午是否叠加 10Y/30Y 国债拍卖",
    ],
    invalidate: "核心超预期仅由个别易波动项或纯 OER 造成（对 PCE 传导弱），或 2Y 在 15–30 分钟内全数回吐初动时，降低持续抛售判断。",
  },
  "PCE 物价 / 个人收支": {
    metric: "核心 PCE 月率", unit: "%", above: "up", channel: "policy", noise: 0.04, big: 0.12,
    aboveNote: "PCE 公布在 CPI/PPI 之后两周，当月数字已被高度预估。只有叠加前 1–3 个月上修，或同报告实际消费（Real PCE）同步强劲时，才会推动 2Y/5Y 持续上行。",
    belowNote: "核心 PCE 低于推算值或伴随前月下修与实际消费转弱时，2Y/5Y 稳步下行，巩固美联储降息路径。",
    aboveCurve: "纯通胀上修偏熊平；若由实际消费（Real PCE）强劲主导，5Y/10Y 同步走弱、斜率相对稳定。",
    belowCurve: "物价降温偏牛陡；若同时暴露消费失速，5Y/10Y 亦会加速下行。",
    checks: [
      "前 1–3 个月 Core PCE 是否上修/下修（往往比当月差 0.02% 影响更大）",
      "Market-based Core PCE vs 非市场化“投资组合管理费”（后者随美股涨跌机械波动，联储权重低）",
      "同报告的实际个人消费（Real PCE）月率、储蓄率，以及同刻 GDP 修正/初请信号",
    ],
    invalidate: "超预期主要来自随股市波动的投资组合管理费，或前一日 GDP 初值里的季度 Core PCE 已提前完成重定价时，避免追单。",
  },
  "美国 PPI": {
    metric: "最终需求 PPI 月率", unit: "%", above: "up", channel: "policy", noise: 0.05, big: 0.2,
    aboveNote: "切勿单按 Headline 追空！只有当医疗保健、航空客运、投资组合管理等 PCE 桥接分项同步偏热且前月未下修时，2Y/5Y 抛售才会延续。",
    belowNote: "若 PCE 桥接服务分项同步偏软，或前月被大幅下修（哪怕当月 Headline 偏热，如 2024-05-14），都会压低当月 Core PCE 追踪值并利多美债。",
    aboveCurve: "有效传导时略走熊平（-1~3 bp），弹性在“PPI 早于 CPI 公布”时显著大于“晚于 CPI 公布”。",
    belowCurve: "温和牛陡或平行下行；若前一日 CPI 已偏冷则强化涨势。",
    checks: [
      "PCE 桥接分项：医院服务、医师护理、航空客运、投资组合管理与保险",
      "前月 Final Demand PPI 是否大幅修正（历史上多次直接逆转当月 Headline 方向）",
      "剔除食品、能源与贸易服务（Trade Services）后的核心 PPI，以及公布顺序早于或晚于 CPI",
    ],
    invalidate: "Headline 偏热仅由能源或批发/零售利润率（Trade Services，不进 PCE）驱动，或前月大幅下修抵消当月意外时，往往走出反向行情。",
  },
  "美国非农就业": {
    metric: "非农新增就业", unit: "千人", above: "up", channel: "policy", noise: 15, big: 50,
    aboveNote: "需四维共振（新增强 + 失业率降/稳 + 前两月未大幅下修 + 时薪偏热）才会引爆 2Y/5Y 大幅抛售。若新增超预期但失业率意外跳升或前两月大下修，美债往往反转走强（如 2024-07-05）。",
    belowNote: "新增偏弱并伴随失业率跳升（尤其逼近/触发 Sahm Rule）、工时下降或前两月下修时，2Y 领跌、降息幅度和节奏快速提前。",
    aboveCurve: "四维偏强常触发剧烈熊平（2s10s -5~10 bp）；若市场已不定价加息、增长乐观主导，长端跟涨可缩小走平幅度。",
    belowCurve: "降息窗口期多走剧烈牛陡（2s10s +5~11 bp）；若陷入深衰退恐慌且避险买盘涌入长端，也可能转为牛平。",
    checks: [
      "失业率（家庭调查，精确至小数点后两位）与劳动参与率（区分供给增加 vs 真实裁员）",
      "前两月合计修订、平均每周工时（降 0.1h 相当于大幅收缩总工时）与私营部门广度",
      "平均时薪月率及是否受飓风/罢工等一次性扰动",
    ],
    invalidate: "新增与失业率/修订方向冲突（家庭调查与企业调查背离）时，拐点期债券市场通常优先跟随失业率与修订方向。",
  },
  "初请失业金": {
    metric: "初请失业金", unit: "千人", above: "down", channel: "policy", noise: 8, big: 22,
    aboveNote: "注意方向相反：申领人数高于预期 = 就业边际转弱 = 利多美债！需突破近期区间（≥20k）且续请同步上行，才会推动 2Y/5Y 实质下行。",
    belowNote: "申领人数低于预期 = 就业保持韧性 = 利空美债。在市场刚经历衰退恐慌的脆弱期（如 2024 年 8 月），哪怕小幅回落也能引发 2Y 显著反弹。",
    aboveCurve: "有效突破时温和牛陡或平行下行；常规周 ±10k 内波动通常仅 1–3 bp。",
    belowCurve: "有效回落时温和熊平；衰退焦虑期弹性放大。",
    checks: [
      "是否为非农调查周（含每月 12 日那一周，权重显著高于普通周）",
      "续请失业金（Continuing Claims）与四周移动均值是否同步验证趋势",
      "节假日（感恩/圣诞/独立日）季调噪音、极端天气、罢工及单一州异常申报",
    ],
    invalidate: "偏差仅出自节假日季调或单一州波动、续请反向，或同刻 08:30 有 CPI/PPI/GDP/零售等一级数据时，大幅降低初请权重。",
  },
  "美国零售销售": {
    metric: "零售销售对照组月率", unit: "%", above: "up", channel: "growth", noise: 0.1, big: 0.35,
    aboveNote: "对照组（直接进 GDP）与餐饮服务同步偏强且前值上修，证明消费极具韧性。不仅推高 5Y/10Y 增长定价，若市场原本押注激进降息，2Y 跌幅会更大。",
    belowNote: "对照组偏弱且前值下修时，市场下调当季 GDPNow 与需求预期，5Y/10Y 流畅下行。需对照同月 CPI 商品价格排除纯通缩/油价干扰。",
    aboveCurve: "曲线斜率随 Regime 分叉：高利率平台期走熊陡（如 2024-04-15，2s10s +8 bp）；衰退恐慌/激进降息定价期则由 2Y 领涨走熊平（如 2024-08-15，-5 bp）。",
    belowCurve: "常规温和牛平或平行下行；若强化降息空间则 2Y 同步跟跌走牛陡。",
    checks: [
      "对照组（剔除汽车、汽油、建材、餐饮）与前两月修订——直接决定 GDP 商品消费",
      "餐饮服务（Food Services）——报告中唯一的服务消费窗口",
      "名义金额陷阱：结合当月汽油与商品价格变化，辨别“量增”还是“涨价虚高”",
    ],
    invalidate: "Headline 意外完全来自汽车或汽油价格波动，或对照组与前两月修订方向相反时，弱化对消费趋势的判断。",
  },
  "美国 GDP": {
    metric: "实际 GDP 季环比折年率", unit: "%", above: "up", channel: "growth", noise: 0.2, big: 0.6,
    aboveNote: "先看私人国内最终销售（剔除库存与净出口噪音）与季度 Core PCE 价格指数。若 GDP Headline 已由 GDPNow 充分计价且季度 Core PCE 偏软，美债反而可能利空出尽走强（如 2023-10-26）。",
    belowNote: "高度警惕“滞胀陷阱”！若 GDP Headline 因进口大增（其实反映内需强）低于预期，但私人国内最终销售强且季度 Core PCE 超预期，2Y/10Y 反而会大涨（如 2024-04-25）！",
    aboveCurve: "纯内需增长驱动偏熊陡；若伴随季度 Core PCE 偏热则偏向熊平或全曲线上移。",
    belowCurve: "仅当内需与季度 Core PCE 同步偏软时才顺畅走牛；若遭遇滞胀组合（弱 GDP + 热 PCE），收益率将反向走高。",
    checks: [
      "区分版本：Advance 初值弹性最大，Second / Third 修正值高度滞后（大修除外）",
      "私人国内最终销售（剥离库存与净出口；高进口在公式里拖累 GDP，实则代表内需强）",
      "同报告的季度 Core PCE 价格折年率（初值会直接提前预告季末月度 PCE）",
    ],
    invalidate: "Headline 与私人国内最终销售反向、或季度 Core PCE 价格分项与增速反向，或结果已被 Atlanta Fed GDPNow 充分提前计价时，严禁机械按 Headline 下单。",
  },
  "JOLTS 职位空缺": {
    metric: "职位空缺", unit: "百万", above: "up", channel: "policy", noise: 0.15, big: 0.45,
    aboveNote: "空缺超预期且主动离职率（Quits Rate）同步走强时，打破劳动力降温叙事。注意在高利率平台期，热 JOLTS 往往重创 10Y/30Y 期限溢价（如 2023-10-03），而非仅打 2Y。",
    belowNote: "空缺回落且 Quits Rate 下降时，确认工资通胀压力降温，2Y 易领跌；若裁员率（Layoffs）稳定属温和软着陆，若裁员跳升则触发衰退加速下行。",
    aboveCurve: "加息博弈期略熊平；高利率平台/财政焦虑期可触发长端主导的熊陡（如 2023-10-03，2s10s +9 bp）。",
    belowCurve: "常规由 2Y 领跌走牛陡（如 2024-09-04，2s10s +5 bp）。",
    checks: [
      "主动离职率（Quits Rate，领先工资通胀 2–3 季度）与裁员率（区分软着陆 vs 裁员潮）",
      "滞后 1 个月 + 回复率仅 ~30–35% 带来的前月大幅修订",
      "同刻 10:00 ET 是否撞车 ISM 制造业 PMI 或消费者信心指数",
    ],
    invalidate: "单月空缺跳变缺乏 Quits/招聘率配合、前月反向大修，或同刻 ISM PMI 主导市场走势时，降低 JOLTS 权重。",
  },
  "就业成本指数（ECI）": {
    metric: "就业成本指数季率", unit: "%", above: "up", channel: "policy", noise: 0.05, big: 0.15,
    aboveNote: "作为美联储最看重的固定权重工资通胀基准，若总体与私营部门薪资季率双双超预期（尤其落在 FOMC 议息首日早盘，如 2024-04-30），2Y/5Y 会扎实上行且不易回吐。",
    belowNote: "私营薪资季率与 12 个月同比同步放缓，消除工资-物价螺旋担忧，利好 2Y/5Y 稳步下行。",
    aboveCurve: "小幅熊平或全曲线平行上移，直接抬高次日 FOMC 偏鹰门槛。",
    belowCurve: "小幅牛陡或全曲线温和下移。",
    checks: [
      "私营部门薪资（Private Wages & Salaries）季率 vs 福利（Benefits）一次性波动",
      "12 个月同比是否向 3.0%–3.5% 的目标兼容区间收敛",
      "是否恰逢 FOMC 会议第一天早盘 08:30 ET 发布",
    ],
    invalidate: "超预期完全由福利分项一次性波动驱动、私营薪资同步温和，或前端初动迅速回吐时，降低政策冲击判断。",
  },
  "耐用品订单初值": {
    metric: "耐用品订单月率", unit: "%", above: "up", channel: "growth", noise: 0.3, big: 1.5,
    aboveNote: "先剔除波音民用飞机等波动项，核心看「剔除国防与飞机的核心资本品订单」。若总体与核心资本品同强，指向企业设备投资韧性，温和推高 5Y/10Y。",
    belowNote: "耐用品与核心资本品订单同步走弱，提示制造业资本开支放缓，温和利多美债。节假日前夕常与 GDP/PCE/初请同刻公布，须先拆开归因。",
    aboveCurve: "温和熊陡或随同刻核心数据主导。",
    belowCurve: "温和下行；单独驱动通常仅 1–3 bp。",
    checks: ["核心资本品（Nondefense ex-aircraft）订单与出货——直接进 GDP 商业投资", "飞机/国防一次性大单噪音与前月修正", "同刻 08:30 是否与 GDP/PCE/初请撞车"],
    invalidate: "波幅全由民航飞机订单驱动，或被同刻 PCE/GDP 主导走势时，忽略单月 Headline。",
  },
  "新屋销售": {
    metric: "新屋销售月率", unit: "%", above: "up", channel: "growth", noise: 2.0, big: 8.0,
    aboveNote: "新屋销售月度样本小、统计误差带宽（常 ±10%），单月暴涨若伴随前月大幅下修，对美债影响多为脉冲；持续高于 70 万套折年则验证高按揭利率下地产韧性。",
    belowNote: "新屋销售显著下滑且库存月数攀升，提示高利率正压制利率敏感型地产部门，温和利多 5Y/10Y。",
    aboveCurve: "温和偏空（1–3 bp），长端略弱于短端。",
    belowCurve: "温和偏多（1–3 bp），5Y/10Y 小幅下行。",
    checks: ["前月修正值（经常出现上月大跌、本月大反弹的锯齿拉锯）", "折年总套数（SAAR）与中位房价走势", "同刻 10:00 ET 是否有 T-bill 拍卖或 ISM/消费者信心"],
    invalidate: "仅是前月大幅下修后的低基数反弹（如前月 -9.7% → 本月 +14.2%）时，勿过度外推地产过热。",
  },
  "FOMC 利率决议": {
    metric: "声明 / SEP 点阵图 / 记者会基调", unit: "%", above: "up", channel: "policy", qualitative: true,
    aboveLabel: "偏鹰（高于市场定价）", belowLabel: "偏鸽（低于市场定价）",
    aboveNote: "即使当次按预期降息，后续降息指引减少或记者会强调通胀风险，也可能推高 2Y 和 5Y 收益率。有 SEP 时核对次年利率点阵。",
    belowNote: "点阵图维持或增加降息、宣布放缓/停止 QT，或主席在 14:30 记者会强调就业下行风险与排除加息（如 2023-12-13 / 2024-05-01），2Y/5Y 易领跌全曲线。",
    aboveCurve: "近端路径上移时检验 2Y 和 5Y 是否领升。若长期名义政策利率点阵也上移，单独检查 10Y 和 30Y 是否跟随。",
    belowCurve: "政策拐点确立时走出剧烈牛陡（2s10s +5~11 bp）；若以 QT 放缓为主导，长端同样显著跑赢。",
    checks: [
      "14:00 声明逐词改动，有 SEP 时比较当年、次年及长期名义政策利率中位数",
      "是否调整 QT 缩表上限或 ON RRP / IORB 技术利率",
      "以 14:30 主席记者会前的报价为新基准，记录问答后首轮行情延续或回吐的幅度",
    ],
    invalidate: "14:00 声明与 14:30 记者会基调相反，或 2Y 在记者会结束后回到决议前区间时，按双向震荡处理。",
  },
  "FOMC 会议纪要": {
    metric: "纪要增量政策 / QT 信息", unit: "%", above: "up", channel: "policy", qualitative: true,
    aboveLabel: "偏鹰增量信息", belowLabel: "偏鸽增量信息",
    aboveNote: "纪要反映 3 周前讨论。只有披露更多官员担忧通胀停滞、提高降息门槛或讨论更积极缩表（QT）且未被会后数据证伪时，2Y/5Y 才会上行。",
    belowNote: "若纪要揭示委员会讨论放缓/停止 QT 缩表路线，或多数成员对劳动力降温表态明显偏鸽，利率与长端掉期利差将获支撑。",
    aboveCurve: "常规波幅仅 1–4 bp；若含 QT 鹰派增量，长端同步承压（如 2022-01-05）。",
    belowCurve: "政策鸽派偏微牛陡；QT 停止/放缓讨论则对长端支撑更强。",
    checks: [
      "人数词层级：most / many / several / a few / a couple 的分布变化",
      "资产负债表（QT 节奏、准备金充裕度、ON RRP）技术讨论——不受 3 周滞后削弱",
      "会后是否已公布改写叙事的 CPI/非农，以及同日 13:00 是否有 20Y 拍卖撞车",
    ],
    invalidate: "三周内的新 CPI/非农或主席最新讲话已使纪要内容过时，或长端波动实为同日 20Y 拍卖遗留效应时，切勿过度解读。",
  },
};

const auctionFront: Rule = {
  metric: "中标收益率", unit: "%", above: "up", channel: "supply", noise: 0.005, big: 0.02,
  aboveNote: "2Y/3Y 中标高于 WI 形成 Tail，短端相对 OIS/邻券小幅走弱。但因久期短且受政策利率强锚定，除非出现 ≥2 bp 罕见大 Tail，否则对 10Y/30Y 外溢极小。",
  belowNote: "2Y/3Y 录得 Stop-through 且一级交易商获配偏低（<12%），前期让价迅速回补，温和提振次日 Belly 拍卖情绪。",
  aboveCurve: "主要体现为 2Y/3Y 局部微弱承压（+1~4 bp），2s10s 略平 1–2 bp。",
  belowCurve: "2Y/3Y 小幅修复（-1~3 bp），2s10s 略陡 1–2 bp。",
  checks: ["13:00 截标前可成交 WI 与拍卖前 Concession 幅度", "Primary Dealer 获配占比（2Y/3Y 常规 ~10%–16%，>18% 偏弱）", "与 SOFR/OIS 隐含政策路径的相对价值"],
  invalidate: "WI 报价已过时、事前已大幅让价或全市场受宏观新闻同幅带动时，降低独立供给归因。",
};

const auctionBelly: Rule = {
  metric: "中标收益率", unit: "%", above: "up", channel: "supply", noise: 0.005, big: 0.02,
  aboveNote: "5Y/7Y Belly 拍卖对交易商资产负债表极敏感（尤其 7Y 流动性薄、易出大 Tail，如 2021-02-25）。若 Tail ≥1.5 bp 且 Dealer 获配 >18%，抛压极易外溢至 10Y。",
  belowNote: "Belly 录得 Stop-through 且终端买盘强劲，前期 Concession 快速收复，5Y/7Y 往往领跑邻券并收窄 2s5s10s Fly。",
  aboveCurve: "Belly 相对两翼走弱（2s5s10s Fly 上凸），大 Tail 时带动 2s10s 熊陡。",
  belowCurve: "5Y/7Y 跑赢两翼，2s5s10s Fly 收窄，缓解中长端供给担忧。",
  checks: ["截标前 WI、事前 Concession 与 2s5s10s Fly 相对位置", "Primary Dealer 获配占比（常规 ~10%–15%，>18% 为警示信号）", "是否临近月末再平衡或 MOVE 波动率高位窗口"],
  invalidate: "事前大幅让价后出现小幅波动，或邻券同步走动、Fly 迅速回归时，属宏观大盘而非独立供给冲击。",
};

const auction10y: Rule = {
  metric: "中标收益率", unit: "%", above: "up", channel: "supply", noise: 0.005, big: 0.02,
  aboveNote: "10Y 基准拍卖出现 Tail（尤其 ≥2 bp）且 Dealer 获配跳升至 >18%，不仅压制当日长端，更几乎必然迫使次日 30Y 拍卖提前加深让价（Concession）。",
  belowNote: "10Y 录得 Stop-through、终端（Indirect + Direct）需求充沛且 Dealer 占比压低至 ~10–12% 以下，能迅速扭转供给悲观情绪（如 2024-06-11）。",
  aboveCurve: "10Y 与 30Y 同步走弱，2s10s 倾向熊陡，并为次日 30Y 定下偏弱基调。",
  belowCurve: "10Y 领涨全曲线修复，2s10s 温和牛平，提振次日 30Y 承接预期。",
  checks: ["13:00 可成交 WI 与前 24–48 小时 Concession 充分度", "Primary Dealer 占比（核心弱拍标尺）+ Indirect/Direct 合计终端需求", "同日早盘是否刚经历 CPI/非农冲击（防“热数据 + 弱拍”双击）"],
  invalidate: "若仅因截标前 WI 剧烈跳动导致名义 Tail，且 10Y 相对 5Y/30Y 很快回归，按大盘噪音处理。",
};

const auction20y: Rule = {
  metric: "中标收益率", unit: "%", above: "up", channel: "supply", noise: 0.005, big: 0.02,
  aboveNote: "20Y 为曲线“孤儿点”、缺乏专属活跃期货对冲，出现 Tail 且 Dealer 获配高时易现局部流动性真空，20Y 相对 10Y/30Y 明显走弱。",
  belowNote: "因 20Y 长期折价，高绝对收益水平下险资/长线买盘常造就强劲 Stop-through，触发 10s20s30s Fly 快速收敛。",
  aboveCurve: "重点体现为 10s20s30s Fly 显著走阔（20Y 独立变便宜），对 10Y/30Y 外溢相对有限。",
  belowCurve: "10s20s30s Fly 收窄，温和提振 30Y 情绪。",
  checks: ["10s20s30s Fly（2×20Y − 10Y − 30Y）拍卖前后变化", "Primary Dealer 获配与事前让价深度", "同日 14:00 ET 是否重合 FOMC 会议纪要（必须拆开 13:00 与 14:00 窗口归因）"],
  invalidate: "20Y Fly 迅速均值回归，或 14:00 纪要主导后半段走势时，勿把局部折价误判为全曲线趋势。",
};

const auction30y: Rule = {
  metric: "中标收益率", unit: "%", above: "up", channel: "supply", noise: 0.005, big: 0.025,
  aboveNote: "30Y 单券 DV01 最高。若录得 ≥2–3 bp Tail 且 Primary Dealer 被迫接盘 >20%（如 2023-11-09 达 24.7%），Dealer 急抛对冲会瞬间引爆长端熊陡并波及权益市场！",
  belowNote: "30Y 录得 Stop-through 且终端（险资 LDI / 海外长线）积极承接，压低长期期限溢价，带动 5s30s/10s30s 走平。",
  aboveCurve: "5s30s 与 10s30s 急剧熊陡，长端实际利率与期限溢价同步走高。",
  belowCurve: "30Y 领涨，5s30s 与 10s30s 走平（牛平），缓解财政发债焦虑。",
  checks: ["High Yield vs 13:00 WI（≥3 bp 属高危弱拍）与前一日 10Y 拍卖传导", "Primary Dealer 获配占比（常规 ~11%–15%，>20% 往往触发持续尾盘抛压）", "Ultra Bond (UB) 期货成交深度与 5s30s / 10s30s 曲线变化"],
  invalidate: "WI 过时、邻券同步受宏观消息推动，或 30Y 相对 10Y 走势很快回到截标前区间时，弱化独立供给判断。",
};

const auctionTips: Rule = {
  metric: "中标实际收益率", unit: "%", above: "up", channel: "supply", noise: 0.005, big: 0.02,
  aboveNote: "TIPS 实际收益率高于 WI 形成 Tail。注意 TIPS 的一级交易商常规占比仅 5%–10%（远低于名义债！），若 Dealer >12%–15% 即属明显承接偏弱。",
  belowNote: "TIPS 实际收益率低于 WI（Stop-through）且终端买盘（通常占 85%–93%）充沛，通胀保值需求旺盛，往往同步推阔同期限 Breakeven。",
  aboveCurve: "同期限实际利率走高，若名义债不动则 Breakeven 被动收窄；对名义曲线斜率外溢温和。",
  belowCurve: "实际利率下行、Breakeven 往往走阔，验证通胀保护配置需求。",
  checks: ["截标前同券 TIPS 实际收益率 WI", "TIPS 专属 Dealer 标尺（常规仅 5%–10%，切忌套用名义债 15% 标准）", "同步拆分同期限名义国债与 Breakeven（Nominal − Real）变化"],
  invalidate: "油价或名义债同刻剧烈波动主导全市场，或 TIPS 流动性折价在盘口恢复后迅速收敛时，降低独立供给判断。",
};

export function ruleFor(event: MarketEvent): Rule | undefined {
  if (event.title === "美国 GDP") {
    const base = rules["美国 GDP"];
    const isRevision = /second|third/i.test(event.detail);
    return isRevision
      ? {
          ...base,
          aboveNote: "本次为 GDP 修正/终值（滞后 2–3 个月），常规波动极小（1–3 bp）。仅当私人国内最终销售或季度 Core PCE 价格指数出现大幅意外上修时，才推动 2Y/5Y 上行。",
          belowNote: "本次为 GDP 修正/终值，单靠 Headline 小幅下修难改趋势；仅当内需或季度 Core PCE 同步明显下修时才利多美债。同时注意同刻是否撞车 PCE/初请/耐用品。",
        }
      : base;
  }
  if (rules[event.title]) return rules[event.title];
  if (event.category === "auction" && !/\bFRN\b/.test(event.title) && ["longAuction", "coupon", "tips"].includes(event.kind)) {
    if (event.kind === "tips") return auctionTips;
    const key = event.auctionKey ?? "";
    if (/^(2|3)y-/.test(key) || /^[23]\s*年期/.test(event.title)) return auctionFront;
    if (/^(5|7)y-/.test(key) || /^[57]\s*年期/.test(event.title)) return auctionBelly;
    if (/^10y-/.test(key) || /^10\s*年期/.test(event.title)) return auction10y;
    if (/^20y-/.test(key) || /^20\s*年期/.test(event.title)) return auction20y;
    if (/^30y-/.test(key) || /^30\s*年期/.test(event.title)) return auction30y;
    return auction10y;
  }
  return undefined;
}

export function scenarioFor(event: MarketEvent, rule: Rule, comparison: "above" | "below") {
  const up = (comparison === "above") === (rule.above === "up");
  const yieldDir: Move = up ? "up" : "down";
  const direction = up ? "上行" : "下行";
  const curve = comparison === "above" ? rule.aboveCurve : rule.belowCurve;
  const text = comparison === "above" ? rule.aboveNote : rule.belowNote;

  if (rule.channel === "supply") {
    const label = event.kind === "tips" ? "该期限实际收益率" : "拍卖期限收益率";
    return { yieldDir, direction: label + "倾向" + direction, curve, text };
  }
  const bucket = event.title === "美国零售销售" || event.title === "美国 GDP"
    ? "5Y / 10Y（及 2Y 联动）"
    : "2Y / 5Y";
  return { yieldDir, direction: bucket + " 收益率倾向" + direction, curve, text };
}

export function actualFor(event: MarketEvent, rule: Rule) {
  const reading = event.readings?.find(value => value.label === rule.metric && value.unit === rule.unit);
  if (reading) return reading.value;
  if (rule.channel === "supply") {
    const rate = event.actual?.match(/中标(?:实际)?收益率\s+(-?\d+(?:\.\d+)?)%/)?.[1];
    if (rate !== undefined) return Number(rate);
  }
}

export function priorFor(event: MarketEvent, allEvents: MarketEvent[], rule: Rule): { date: string; value: number } | undefined {
  if (rule.qualitative) return undefined;
  const quarter = event.title === "美国 GDP" ? gdpQuarter(event.detail) : undefined;
  const previous = allEvents
    .filter(item => item.id !== event.id && item.date < event.date && (
      event.auctionKey ? item.auctionKey === event.auctionKey : item.title === event.title
    ) && (event.title !== "美国 GDP" || Boolean(quarter && quarter === gdpQuarter(item.detail))))
    .map(item => ({ date: item.date, value: actualFor(item, rule) }))
    .filter((item): item is { date: string; value: number } => item.value !== undefined);
  return previous.at(-1);
}

export type InstantAnalysis = {
  tone: "bearish" | "bullish" | "neutral";
  tag: string;
  summary: string;
};

/** Automatic post-release rates-desk interpretation once official readings / auction results arrive. */
export function instantAnalysisFor(event: MarketEvent, allEvents: MarketEvent[]): InstantAnalysis | null {
  const readings = event.readings ?? [];
  if (!readings.length && !event.actual) return null;

  // 1. Treasury Auctions (Coupons, TIPS, Bills)
  if (event.category === "auction") {
    const dealer = readings.find(r => r.label.includes("一级交易商"))?.value;
    const indirect = readings.find(r => r.label.includes("间接投标"))?.value;
    const direct = readings.find(r => r.label.includes("直接投标"))?.value;
    const btc = readings.find(r => r.label.includes("投标倍数"))?.value;
    const endUser = indirect !== undefined && direct !== undefined ? Number((indirect + direct).toFixed(1)) : undefined;

    if (event.kind === "bills") {
      const btcText = btc !== undefined ? `投标倍数 ${btc.toFixed(2)}×` : "";
      const tone: InstantAnalysis["tone"] = btc !== undefined && btc >= 2.85 ? "bullish" : btc !== undefined && btc <= 2.5 ? "bearish" : "neutral";
      const tag = tone === "bullish" ? "短债需求强" : tone === "bearish" ? "短债承接偏平" : "资金面平稳";
      return {
        tone,
        tag,
        summary: `${btcText}${dealer !== undefined ? ` · Dealer ${dealer.toFixed(1)}%` : ""}，属短端现金管理工具，主要反映资金面与 TGA 流动性，对中长端外溢有限。`,
      };
    }

    const isTips = event.kind === "tips";
    const is30y = /^30\s*年期/.test(event.title) || (event.auctionKey ?? "").startsWith("30y");
    const weakDealer = isTips ? 12 : is30y ? 19 : 16;
    const strongDealer = isTips ? 7 : 11;
    if (dealer !== undefined) {
      if (dealer <= strongDealer) {
        return {
          tone: "bullish",
          tag: "拍卖承接强劲 · 偏利多美债",
          summary: `一级交易商仅获配 ${dealer.toFixed(1)}%（显著低于常态），终端买盘高达 ${endUser ?? (100 - dealer).toFixed(1)}%${btc ? `（BTC ${btc.toFixed(2)}×）` : ""}；有利拍前让价回补与曲线修复。`,
        };
      }
      if (dealer >= weakDealer) {
        return {
          tone: "bearish",
          tag: "Dealer 兜底偏高 · 偏利空美债",
          summary: `一级交易商被迫接盘 ${dealer.toFixed(1)}%（高于警惕线 ${weakDealer}%）${btc ? `，BTC ${btc.toFixed(2)}×` : ""}；承销商库存对冲易压制该期限与长端。`,
        };
      }
      return {
        tone: "neutral",
        tag: "拍卖承接中性",
        summary: `Dealer 获配 ${dealer.toFixed(1)}%（常规区间），终端买盘 ${endUser ?? (100 - dealer).toFixed(1)}%${btc ? `，BTC ${btc.toFixed(2)}×` : ""}；以截标前 WI Tail 决定短线方向。`,
      };
    }
  }

  // 2. Macro Releases (compare against prior / Cleveland Fed model / internal sub-components)
  const rule = ruleFor(event);
  if (!rule) return null;
  const act = actualFor(event, rule);
  if (act === undefined) return null;

  if (event.title === "初请失业金") {
    const chg = readings.find(r => r.label.includes("较前周"))?.value;
    const cont = readings.find(r => r.label.includes("续请"))?.value;
    if (chg !== undefined && chg <= -10) {
      return {
        tone: "bearish",
        tag: "就业偏韧 · 偏利空美债",
        summary: `初请降至 ${act} 千人（较前周 ${chg} 千人${cont ? `，续请 ${cont} 千人` : ""}），劳动力市场维持韧性，温和推高 2Y/5Y（注意节假日季调噪音）。`,
      };
    }
    if (chg !== undefined && chg >= 15) {
      return {
        tone: "bullish",
        tag: "申领走高 · 偏利多美债",
        summary: `初请升至 ${act} 千人（较前周 +${chg} 千人${cont ? `，续请 ${cont} 千人` : ""}），边际降温利多 2Y/5Y，关注续请与四周均值验证。`,
      };
    }
    return {
      tone: "neutral",
      tag: "就业平稳 · 影响温和",
      summary: `初请 ${act} 千人${chg !== undefined ? `（较前周 ${chg > 0 ? "+" : ""}${chg} 千人）` : ""}，落在近期常规区间，单独对收益率冲击有限。`,
    };
  }

  if (event.title === "PCE 物价 / 个人收支") {
    const coreYoy = readings.find(r => r.label === "核心 PCE 同比")?.value;
    const realC = readings.find(r => r.label === "实际消费月率")?.value;
    if (act >= 0.3 || (coreYoy !== undefined && coreYoy >= 3.0)) {
      return {
        tone: "bearish",
        tag: "核心通胀偏粘 · 偏利空 2Y/5Y",
        summary: `核心 PCE 月率 ${act > 0 ? "+" : ""}${act.toFixed(1)}%${coreYoy !== undefined ? ` / 同比 ${coreYoy.toFixed(1)}%` : ""}${realC !== undefined ? `，实际消费 ${realC > 0 ? "+" : ""}${realC.toFixed(1)}%` : ""}；通胀粘性压制降息定价，2Y/5Y 偏承压。`,
      };
    }
    if (act <= 0.1) {
      return {
        tone: "bullish",
        tag: "核心通胀温和 · 偏利多美债",
        summary: `核心 PCE 月率仅 ${act > 0 ? "+" : ""}${act.toFixed(1)}%${coreYoy !== undefined ? `（同比 ${coreYoy.toFixed(1)}%）` : ""}，巩固降息路径，2Y/5Y 偏牛陡下行。`,
      };
    }
  }

  if (event.title === "美国 GDP") {
    const demand = readings.find(r => r.label.includes("私人国内"))?.value;
    const qPce = readings.find(r => r.label.includes("核心 PCE"))?.value;
    if (act >= 3.0 || (demand !== undefined && demand >= 3.5)) {
      return {
        tone: "bearish",
        tag: "内需增长强劲 · 偏利空美债",
        summary: `实际 GDP 折年 ${act > 0 ? "+" : ""}${act.toFixed(1)}%${demand !== undefined ? `，私人国内最终销售高达 +${demand.toFixed(1)}%` : ""}${qPce !== undefined ? `（季度核心 PCE +${qPce.toFixed(1)}%）` : ""}；高增长韧性支撑长端熊陡。`,
      };
    }
  }

  const prior = priorFor(event, allEvents, rule);
  const bench = event.reference?.value ?? prior?.value;
  const benchName = event.reference ? "Cleveland 模型" : prior ? "前值" : null;
  if (bench !== undefined && benchName) {
    const diff = act - bench;
    const noise = rule.noise ?? 0.05;
    if (Math.abs(diff) <= noise) {
      return {
        tone: "neutral",
        tag: "基本符合参考 · 影响中性",
        summary: `${rule.metric} 录得 ${act}${rule.unit}（${benchName} ${bench}${rule.unit}），偏差在常规噪音内，转向检查分项与前月修正。`,
      };
    }
    const above = diff > 0;
    const sc = scenarioFor(event, rule, above ? "above" : "below");
    return {
      tone: sc.yieldDir === "up" ? "bearish" : "bullish",
      tag: `${above ? "高于" : "低于"}${benchName} · ${sc.yieldDir === "up" ? "偏利空美债" : "偏利多美债"}`,
      summary: `${rule.metric} ${act}${rule.unit} vs ${benchName} ${bench}${rule.unit}；${sc.direction}（${sc.curve.slice(0, 46)}…）。`,
    };
  }

  // Fallback for standalone macro reading without stored prior (e.g., Census with embedded prior reading!)
  const prevR = readings.find(r => r.label.includes("前月"));
  const tone: InstantAnalysis["tone"] = (act > 0 && rule.above === "up") ? "bearish" : (act < 0 && rule.above === "up") ? "bullish" : "neutral";
  return {
    tone,
    tag: tone === "bearish" ? "读数偏强 · 温和偏空" : tone === "bullish" ? "读数偏弱 · 温和偏多" : "读数中性",
    summary: `${rule.metric} 录得 ${act > 0 ? "+" : ""}${act}${rule.unit}${prevR ? `（${prevR.label} ${prevR.value > 0 ? "+" : ""}${prevR.value}${prevR.unit}）` : ""}；${act >= 0 ? rule.aboveCurve : rule.belowCurve}`,
  };
}

function gdpQuarter(detail: string) {
  const match = detail.match(/\b(1st|2nd|3rd|4th|first|second|third|fourth) quarter(?: of)?\s+(20\d{2})\b/i);
  if (!match) return undefined;
  const name = match[1].toLowerCase();
  const ordinal: Record<string, string> = { first: "1st", second: "2nd", third: "3rd", fourth: "4th" };
  return (ordinal[name] ?? name) + " " + match[2];
}
