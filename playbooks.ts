import type { Kind, MarketEvent } from "./model";

export type HistoricalCase = {
  date: string;
  title: string;
  surprise: string;
  ustMove: string;
  lesson: string;
};

export type TransmissionMatrix = {
  hotTitle: string;
  coldTitle: string;
  rows: {
    dim: string;
    hot: string;
    cold: string;
  }[];
};

export type Playbook = {
  key: string;
  name: string;
  volatility: string;
  summary: string;
  first30s: string[];
  regimeSplit: string;
  traps: string[];
  matrix: TransmissionMatrix;
  history: HistoricalCase[];
};

const playbooks: Record<string, Playbook> = {
  cpi: {
    key: "cpi",
    name: "美国 CPI（消费者物价指数）",
    volatility: "2Y ±10–27 bp · 10Y ±8–30 bp（仅次于非农/FOMC 的头号波动源）",
    summary: "美债对 CPI 的交易核心不是表面 Headline，而是未四舍五入的 Core CPI 精确值、Supercore（剔除住房核心服务）以及能真正传导进美联储目标 Core PCE 的分项。",
    first30s: [
      "Core CPI MoM 未四舍五入精确值（0.26% 与 0.34% 均四舍五入为 0.3%，但 2Y 方向可截然相反）",
      "Supercore（剔除住房的核心服务）与 OER / 租金增速是否同步加速",
      "CPI → PCE 桥接差异：住房在 CPI 占 ~36%，在 PCE 仅占 ~16%；医疗在 PCE 用 PPI 口径而非 CPI",
    ],
    regimeSplit: "在加息/鹰派按兵不动周期，热 CPI 通常引发 2Y 领涨、2s10s 剧烈熊平（如 2022-09-13，30Y 甚至微跌）；但在财政赤字担忧或通胀预期失锚期，热 CPI 会推高 10Y Breakeven 与期限溢价，转为整条曲线熊陡。极度一致的空头仓位遇冷 CPI 时，5Y/10Y 反弹幅度常超过 2Y（如 2022-11-10）。",
    traps: [
      "只看四舍五入后的 0.3%：0.34% 是偏热、0.26% 是偏冷，公布后 30 秒交易台已用指数原值算到小数点后两位。",
      "把“住房单一项超预期”等同于 Core PCE 暴涨：由于权重差一倍，纯 OER 跳升对美联储决策的实际杀伤远小于机票/核心商品/服务全面偏热。",
      "忽略同日长债拍卖叠加：若热 CPI 撞上同日下午 10Y/30Y 拍卖（如 2024-04-10），供给尾部会把单日抛售再放大一截。",
    ],
    matrix: {
      hotTitle: "偏热（Core / Supercore 超预期）",
      coldTitle: "偏冷（Core / Supercore 低于预期）",
      rows: [
        { dim: "前端 2Y", hot: "迅速削减降息定价，大幅上行（+10~25 bp）", cold: "降息提前定价，显著下行（-10~27 bp）" },
        { dim: "长端 10Y–30Y", hot: "鹰派周期涨幅小于 2Y；通胀失锚/财政期与 2Y 同涨甚至更弱", cold: "空头回补叠加久期买盘，5Y/10Y 往往同步大涨（收益率下行）" },
        { dim: "曲线斜率", hot: "常规熊平（2s10s 走平）；若市场担心央行落后于曲线则熊陡", cold: "常规牛陡（2s10s 走陡）；极端拥挤空头回补时可平移甚至微平" },
        { dim: "实际利率 / BE", hot: "Breakeven 先跳升；若央行表态强硬，实际利率同步飙升", cold: "Breakeven 回落，实际利率随降息预期同步下行" },
      ],
    },
    history: [
      {
        date: "2022-09-13",
        title: "2022 年 8 月 CPI 偏热（加息周期极端熊平）",
        surprise: "Core CPI 环比 +0.6%（预期 +0.3%）",
        ustMove: "2Y +17 bp (3.75%) · 10Y +5 bp (3.42%) · 30Y -2 bp · 2s10s -12 bp",
        lesson: "美联储坚决加息期，热 CPI 重创前端但压低长期增长与通胀预期，30Y 反而收涨（收益率微跌），呈教科书级极端熊平。",
      },
      {
        date: "2022-11-10",
        title: "2022 年 10 月 CPI 意外转冷（空头回补暴涨）",
        surprise: "Core CPI 环比 +0.3%（预期 +0.5%），同比回落至 7.7%",
        ustMove: "2Y -27 bp (4.34%) · 5Y -32 bp · 10Y -30 bp (3.82%) · 2s10s -3 bp",
        lesson: "并非所有冷 CPI 都走牛陡：当市场在 5Y/10Y 积累极重空头时，Belly 与长端回补幅度反而大于 2Y。",
      },
      {
        date: "2024-04-10",
        title: "2024 年 3 月 CPI 三连热 + 10Y 拍卖双击",
        surprise: "Core CPI 环比 +0.4%（精确 0.36%，预期 +0.3%），Supercore 加速",
        ustMove: "2Y +23 bp (4.97%) · 5Y +24 bp · 10Y +19 bp (4.55%) · 2s10s -4 bp",
        lesson: "连续超预期彻底改写全年降息路径，且同日下午 10Y 拍卖录得 3.1 bp 大 tail，Belly 与长端同步重挫。",
      },
    ],
  },

  pce: {
    key: "pce",
    name: "PCE 物价 / 个人收支（Personal Income & Outlays）",
    volatility: "2Y ±2–12 bp · 10Y ±2–8 bp（单月意外小，但修正+消费组合威力大）",
    summary: "PCE 是美联储官方通胀锚，但发布在同月 CPI 与 PPI 全部落地约两周后，华尔街已能将其倒算至 ±0.02 个百分点精度。真正驱动美债的是前月修正、市场化核心 PCE 及同报告的实际消费支出（Real PCE）。",
    first30s: [
      "前 1–3 个月 Core PCE 是否出现上修/下修（往往比当月差 0.02% 更改变 3M/6M 年化趋势）",
      "Market-based Core PCE vs 非市场化“投资组合管理费”（后者随美股涨跌机械波动，联储权重低）",
      "同报告的 Real PCE（实际个人消费月率）与个人储蓄率——决定增长因子方向",
    ],
    regimeSplit: "若 Core PCE 落入 CPI/PPI 推算区间，美债常只动 2–4 bp；真正出现 8–12 bp 大行情几乎都是“Core PCE 超预期 + 前月上修 + Real Spending 同步偏强”三击，或与同刻发布的 GDP/耐用品/初请形成合力。",
    traps: [
      "把 PCE 当第二个 CPI 来交易：由于 CPI+PPI 已经提前泄题，常规月份按 Headline 赌大波动胜率很低。",
      "忽略非市场化分项：当月美股大涨推高 Portfolio Management 费用导致的 Core PCE 小幅超预期，利率初动常在 30 分钟内回吐。",
      "只盯物价不看消费：若 Core PCE 符合预期但 Real Spending 意外转负，5Y/10Y 会按增长降温主导下行。",
    ],
    matrix: {
      hotTitle: "核心 PCE 偏热 / 上修 / 实际消费强劲",
      coldTitle: "核心 PCE 偏冷 / 下修 / 实际消费走弱",
      rows: [
        { dim: "前端 2Y", hot: "若伴随前月上修，推迟降息定价（+6~12 bp）；仅差 0.02% 反应温和", cold: "确认反通胀延续，巩固降息路径（-4~10 bp）" },
        { dim: "长端 10Y–30Y", hot: "若 Real Spending 同步强劲，5Y/10Y 跟随增长预期上行", cold: "实际消费走弱叠加物价降温，5Y/10Y 温和下行" },
        { dim: "曲线斜率", hot: "纯通胀上修偏熊平；消费驱动则 5Y/10Y 跟涨、斜率偏稳", cold: "物价冷偏牛陡；消费失速担忧扩大时全曲线下移" },
        { dim: "实际利率 / BE", hot: "实际利率主导上行（通胀大头此前已由 CPI 计入 BE）", cold: "实际利率与 BE 温和同步回落" },
      ],
    },
    history: [
      {
        date: "2023-02-24",
        title: "2023 年 1 月 PCE（物价 + 消费 + 上修三击）",
        surprise: "Core PCE 环比 +0.6%（预期 +0.4%），12 月上修，实际消费激增 +1.1%",
        ustMove: "2Y +12 bp (4.78%) · 5Y +10 bp · 10Y +7 bp (3.95%) · 2s10s -5 bp",
        lesson: "打破“PCE 波动小”常态的典型条件：物价超预期、前月上修与真实消费暴涨三者共振。",
      },
      {
        date: "2024-04-26",
        title: "2024 年 3 月 PCE（前一日 GDP 提前泄题）",
        surprise: "Core PCE 环比 +0.3% 符合预期，但前一日 Q1 GDP 季度 PCE 已提前引爆抛售",
        ustMove: "2Y 0 bp (4.96%) · 5Y -2 bp · 10Y -3 bp (4.67%) · 30Y -4 bp（前一日 2Y 已先涨 +7 bp）",
        lesson: "季末月份的 PCE 必须先核对前一天 GDP 初值里的季度 Core PCE，避免把已计价信息重复交易。",
      },
    ],
  },

  ppi: {
    key: "ppi",
    name: "美国 PPI（生产者物价指数）",
    volatility: "2Y ±3–10 bp · 10Y ±3–8 bp（早于 CPI 公布时弹性更大）",
    summary: "美债交易台不按 Headline PPI 做方向，而是把 PPI 当作“Core PCE 拼图”——重点盯能直接映射进 Core PCE 的医疗保健、航空客运、投资组合管理与保险分项，以及前月修订。",
    first30s: [
      "PCE 桥接分项：医院门诊/住院、医师服务、航空客运、投资组合管理费是否偏热",
      "前月 Final Demand PPI 是否被大幅上修或下修（经常完全抵消当月意外）",
      "公布顺序：早于 CPI 公布时市场会预演次日 CPI；晚于 CPI 公布时纯看对 Core PCE 的边际修正",
    ],
    regimeSplit: "由于 Headline PPI 受能源和 Trade Services（零售/批发毛利率，不进 PCE）干扰极大，经常出现“Headline 暴涨但 PCE 桥接分项偏冷 + 前月下修 → 美债先跌后大幅反涨”的经典反转。",
    traps: [
      "按 Headline PPI 追单：能源或 Trade Services 利润率推高的 Headline PPI 对 Core PCE 毫无传导，是最容易被反杀的假信号。",
      "忽略前月修订：BLS 对 PPI 前月修订幅度远大于 CPI，2024-05-14 就是前月从 +0.2% 下修至 -0.1% 直接逆转全天走势。",
      "晚于 CPI 公布却高估冲击：若前一天 CPI 已经定调，PPI 只有大幅改写投行 Core PCE 预测（≥0.05pp）才能掀起持续波动。",
    ],
    matrix: {
      hotTitle: "PCE 映射服务分项偏热 + 未下修",
      coldTitle: "PCE 映射服务分项偏软 / 前月大幅下修",
      rows: [
        { dim: "前端 2Y", hot: "抬升当月 Core PCE 预期，2Y 上行 +4~9 bp", cold: "压低 Core PCE 追踪值，2Y 回落 -3~8 bp" },
        { dim: "长端 10Y–30Y", hot: "温和跟涨，幅度通常小于前端", cold: "温和下行；若前一日 CPI 已偏冷则强化涨势" },
        { dim: "曲线斜率", hot: "轻微熊平（-1~3 bp）", cold: "轻微牛陡或平移" },
        { dim: "实际利率 / BE", hot: "以实际利率微升为主（政策路径小幅重估）", cold: "实际利率微降" },
      ],
    },
    history: [
      {
        date: "2024-05-14",
        title: "2024 年 4 月 PPI（Headline 热、前月下修大反转）",
        surprise: "Headline PPI +0.5%（预期 +0.3%），但 3 月由 +0.2% 大幅下修至 -0.1%，且机票/医疗温和",
        ustMove: "初动 10Y 跳升，随后全数回吐并收跌：2Y -4 bp (4.81%) · 10Y -3 bp (4.45%)",
        lesson: "教科书级“Headline 陷阱”：必须同步检查前月修订与 PCE 桥接分项，切忌 08:30 秒追 Headline。",
      },
      {
        date: "2024-02-16",
        title: "2024 年 1 月 PPI（服务分项全面偏热）",
        surprise: "Headline +0.3%（预期 +0.1%），医疗与投管等 Core Services +0.6% 全面走高",
        ustMove: "2Y +8 bp (4.64%) · 5Y +7 bp · 10Y +6 bp (4.30%) · 2s10s -2 bp",
        lesson: "当 PPI 的 PCE 映射服务项与前几天偏热的 CPI 形成共振时，前端抛售会干净延续。",
      },
    ],
  },

  jobs: {
    key: "jobs",
    name: "美国非农就业（Employment Situation / NFP）",
    volatility: "2Y ±10–28 bp · 10Y ±8–20 bp（月度最大单日波动催化剂之一）",
    summary: "非农包含企业调查（新增就业、前两月修订、时薪、工时）与家庭调查（失业率、劳动参与率）两套并行体系。近年美债往往对“失业率跳升 + 前两月下修”赋予比单月新增更高的权重。",
    first30s: [
      "四维共振核对：新增就业、失业率（精确到小数点后两位）、前两月合计修订、平均时薪月率",
      "结构质量：私营部门新增 vs 政府/医疗集中度、平均每周工时（降 0.1h 相当于数十万就业收缩）",
      "失业率上升原因：劳动参与率（LFPR）上升带来的良性供给增加，还是永久裁员上升引发的需求转弱",
    ],
    regimeSplit: "处于降息或利率峰值期时，失业率意外跳升（尤其逼近/触发 Sahm Rule）会引爆 2Y 暴跌、2s10s 剧烈牛陡（如 2024-08-02）；反之四维偏强触发 2Y 暴涨、2s10s 熊平（如 2024-10-04）。但在深度衰退恐慌且长端避险盘汹涌时，弱非农也可能走牛平。",
    traps: [
      "只看新增 Headline 忽略下修与失业率：2024-07-05 新增 206k 略超预期，但前两月下修 -111k + 失业率升至 4.1%，2Y 当日大跌 11 bp。",
      "忽视“非农强但失业率升”冲突：两者分属不同调查样本，在周期拐点期，债券市场通常优先相信失业率上行信号。",
      "把一次性扰动当趋势：飓风、大型罢工（如波音/港口）或极寒天气会导致工时与新增失真，常在下月大幅回补。",
    ],
    matrix: {
      hotTitle: "四维偏强（新增强 + 失业率降/稳 + 薪资热 + 上修）",
      coldTitle: "就业转弱（新增弱 + 失业率升 + 下修 / 工时降）",
      rows: [
        { dim: "前端 2Y", hot: "降息定价大幅回撤，领涨全曲线（+15~25 bp）", cold: "快速计入 25→50 bp 降息，领跌全曲线（-12~28 bp）" },
        { dim: "长端 10Y–30Y", hot: "显著上行（+8~15 bp），但通常小于 2Y", cold: "随衰退担忧下行（-8~19 bp），避险情绪升温" },
        { dim: "曲线斜率", hot: "典型熊平（2s10s 走平 -5~10 bp）", cold: "常规剧烈牛陡（2s10s 走陡 +5~11 bp）；深衰退恐慌期可转平" },
        { dim: "实际利率 / BE", hot: "实际利率大幅走高主导名义收益率上行", cold: "实际利率领跌，若伴随油价/风险资产暴跌则 BE 同步压缩" },
      ],
    },
    history: [
      {
        date: "2024-08-02",
        title: "2024 年 7 月非农（失业率 4.3% 触发 Sahm Rule）",
        surprise: "新增仅 114k（预期 175k），失业率由 4.1% 跳升至 4.3%",
        ustMove: "2Y -28 bp (3.88%) · 5Y -22 bp · 10Y -19 bp (3.80%) · 2s10s +9 bp",
        lesson: "失业率非线性跳升叠加降息窗口打开，触发教科书级极端牛陡行情。",
      },
      {
        date: "2024-10-04",
        title: "2024 年 9 月非农（四维共振大超预期）",
        surprise: "新增 254k（预期 150k）+ 前两月上修 72k + 失业率降至 4.1% + 时薪 +0.4%",
        ustMove: "2Y +23 bp (3.93%) · 5Y +19 bp · 10Y +13 bp (3.98%) · 2s10s -10 bp",
        lesson: "当新增、修订、失业率、工资四维同向共振，50 bp 降息定价瞬间出清，呈剧烈熊平。",
      },
      {
        date: "2024-07-05",
        title: "2024 年 6 月非农（Headline 超预期但下修+失业率反转）",
        surprise: "新增 206k 略超预期，但前两月大幅下修 -111k 且失业率升至 4.1%",
        ustMove: "2Y -11 bp (4.60%) · 5Y -11 bp · 10Y -8 bp (4.28%) · 2s10s +3 bp",
        lesson: "绝不能只看当月新增数字——修订与失业率经常彻底翻转方向。",
      },
    ],
  },

  claims: {
    key: "claims",
    name: "初请失业金（Initial Jobless Claims）",
    volatility: "常规周 ±1–3 bp · 衰退焦虑期或突破区间 ±4–10 bp",
    summary: "美国最高频的就业晴雨表（每周四 08:30 ET）。常态下噪音大、弹性低，但处于衰退担忧窗口或**非农调查周（含每月 12 日那周）**时，市场敏感度会成倍放大。",
    first30s: [
      "初请人数是否突破近月区间（一般偏离预期 ≥20–25k 才具持续信号），同步核对四周均值",
      "续请失业金（Continuing Claims，滞后一周）是否同步走高——反映失业者再就业难度",
      "是否为非农调查周（Survey Week）以及是否受假日（感恩/圣诞/独立日）、天气或单一州季调扭曲",
    ],
    regimeSplit: "注意方向与通胀/非农相反：**初请高于预期 = 就业转弱 = 美债利多（收益率下行）**。经济平稳期市场多忽略小幅噪音；一旦非农刚引发衰退恐慌（如 2024 年 8 月），哪怕 7–10k 的回落也能触发显著回调。",
    traps: [
      "方向看反：高于预期是债市利多（收益率下行），低于预期是债市利空（收益率上行）。",
      "节假日季调假突破：感恩节、新年、复活节、独立日前后经常出现 ±20k 的季调噪音，次周即回撤。",
      "忽略同刻 08:30 主数据：当周四同刻发布 CPI、PPI、GDP 或零售销售时，初请几乎完全被主数据淹没。",
    ],
    matrix: {
      hotTitle: "初请高于预期（申领上升 = 就业转弱）",
      coldTitle: "初请低于预期（申领下降 = 就业韧性）",
      rows: [
        { dim: "前端 2Y", hot: "若续请同步上升且突破区间，降息定价提前，2Y 下行 -3~8 bp", cold: "打消裁员加速担忧，2Y 上行 +3~7 bp" },
        { dim: "长端 10Y–30Y", hot: "小幅跟跌；衰退担忧期长端同步下行", cold: "小幅上行，幅度通常略小于或接近 2Y" },
        { dim: "曲线斜率", hot: "温和牛陡或平移", cold: "温和熊平" },
        { dim: "实际利率 / BE", hot: "以实际利率下行主导", cold: "以实际利率回升主导" },
      ],
    },
    history: [
      {
        date: "2024-08-08",
        title: "衰退恐慌后首周初请回落（Regime 放大弹性）",
        surprise: "初请报 233k（预期 240k，较前周回落 17k），打破就业失速恐慌",
        ustMove: "2Y +4 bp (4.04%) · 5Y +4 bp · 10Y +3 bp (3.99%)（盘中一度急涨 ~8 bp）",
        lesson: "初请的弹性取决于市场心理 Regime：在非农刚吓坏市场后，一次普通周度回落即可引发剧烈盘中波动。",
      },
      {
        date: "2023-06-08",
        title: "初请跳升至 261k（近两年高点但含州级噪音）",
        surprise: "初请意外跳升至 261k（预期 235k）",
        ustMove: "2Y -4 bp (4.52%) · 5Y -6 bp · 10Y -6 bp (3.73%)",
        lesson: "单周大跳水先看续请与分州明细，2023 年 6 月部分受假期季调与俄亥俄州异常申领干扰，两周内趋势消退。",
      },
    ],
  },

  jolts: {
    key: "jolts",
    name: "JOLTS 职位空缺与劳动力流动",
    volatility: "2Y ±5–12 bp · 10Y ±5–12 bp（常与同刻 10:00 ISM 叠加）",
    summary: "JOLTS 滞后非农约一个月且调查回复率仅 ~30–35%，但包含**主动离职率（Quits Rate，领先工资通胀）**与**裁员率（Layoffs）**两大核心结构指标，是判断“软着陆再平衡”还是“真实裁员潮”的关键。",
    first30s: [
      "职位空缺数（百万）+ 前月修订 + 职位空缺/失业人数比（V/U Ratio）",
      "主动离职率（Quits Rate，领先 ECI/薪资约 2–3 季度）与裁员率（Layoffs Rate）是否背离",
      "核对同刻 10:00 ET 是否同时公布 ISM 制造业 PMI 或消费者信心——切勿错误归因",
    ],
    regimeSplit: "高利率平台期（政策已定、市场聚焦长端期限溢价）时，意外飙升的 JOLTS 可引发长端主导的**熊陡**（如 2023-10-03，30Y +14 bp > 2Y +3 bp）；而在降息预期博弈期，JOLTS 大降则由 **2Y 领跌走牛陡**（如 2024-09-04）。",
    traps: [
      "把 JOLTS 当成纯前端政策数据：2023-10-03 历史表明，在“Higher for Longer”环境下，热 JOLTS 对 10Y/30Y 的杀伤反而远大于 2Y。",
      "忽略低回复率带来的大幅修订：单月空缺跳变经常在下月被修掉 20–40 万，需要 Quits 与招聘率交叉确认。",
      "不区分“空缺降+裁员稳”与“裁员跳升”：前者是美联储乐见的良性降温，后者才会引爆深衰退交易。",
    ],
    matrix: {
      hotTitle: "职位空缺与离职率偏强（劳动力仍紧）",
      coldTitle: "职位空缺与离职率走弱（需求降温）",
      rows: [
        { dim: "前端 2Y", hot: "降息预期后移，上行 +3~10 bp", cold: "降息/幅度预期升温，领跌 -8~12 bp" },
        { dim: "长端 10Y–30Y", hot: "利率平台期易触发 Higher-for-Longer 熊陡（+8~14 bp）", cold: "随增长与通胀降温下行（-6~8 bp）" },
        { dim: "曲线斜率", hot: "加息期熊平；高利率平台/财政期可剧烈熊陡", cold: "常规牛陡（2s10s +3~5 bp）" },
        { dim: "实际利率 / BE", hot: "实际利率走高主导", cold: "实际利率下行主导" },
      ],
    },
    history: [
      {
        date: "2023-10-03",
        title: "2023 年 8 月 JOLTS 暴涨（引爆长端熊陡）",
        surprise: "职位空缺飙升至 961 万（预期 880 万），打破劳动力降温共识",
        ustMove: "2Y +3 bp (5.15%) · 10Y +12 bp (4.81%) · 30Y +14 bp · 2s10s +9 bp",
        lesson: "打破“劳动力数据只打 2Y”的刻板印象：政策利率封顶期，热劳动力数据通过推升中性利率与期限溢价重创长端。",
      },
      {
        date: "2024-09-04",
        title: "2024 年 7 月 JOLTS 跌破 770 万（曲线逼近解除倒挂）",
        surprise: "职位空缺降至 767 万（预期 810 万）且前月下修",
        ustMove: "2Y -12 bp (3.76%) · 5Y -9 bp · 10Y -7 bp (3.77%) · 2s10s +5 bp",
        lesson: "降息周期启动前夕，冷 JOLTS 迅速强化 50 bp 降息押注，2Y 领跌推动 2s10s 结束长期倒挂。",
      },
    ],
  },

  eci: {
    key: "eci",
    name: "就业成本指数（ECI, Employment Cost Index）",
    volatility: "2Y ±4–9 bp · 10Y ±3–7 bp（落于 FOMC 首日早盘时权重倍增）",
    summary: "美联储（尤其是主席历次记者会）最看重的**工资通胀“黄金标准”**。相比非农平均时薪易受低薪/高薪行业就业占比变化扭曲，ECI 采用固定权重，能纯净反映工资与福利成本压力。",
    first30s: [
      "总体季率（QoQ）及私营部门薪资（Private Wages & Salaries）季率——比福利分项更具政策指导性",
      "12 个月同比是否继续向 3.0%–3.5% 的“与 2% 通胀兼容区间”靠拢",
      "是否恰逢 FOMC 议息会议首日早盘 08:30 ET 发布（直接影响次日声明与记者会措辞）",
    ],
    regimeSplit: "ECI 属于低频季度数据，单日绝对幅度通常小于 CPI/非农，但趋势信号极硬、回吐概率低，尤其容易在 FOMC 会议周改写政策基调预期。",
    traps: [
      "把福利分项（Benefits）一次性波动误当成薪资螺旋：联储更关注 Private Wages & Salaries 是否同步加速。",
      "忽略时间节点：若非 FOMC 周且此前 CPI/非农刚落地，影响较温和；若正好撞在 FOMC 第一天早晨（如 2024-04-30），市场会立刻重定价次日决议。",
    ],
    matrix: {
      hotTitle: "ECI 及私营薪资季率高于预期",
      coldTitle: "ECI 及私营薪资季率低于预期",
      rows: [
        { dim: "前端 2Y", hot: "巩固高利率久持预期，2Y 扎实上行 +5~8 bp", cold: "验证工资-物价螺旋消退，2Y 下行 -4~7 bp" },
        { dim: "长端 10Y–30Y", hot: "随 2Y/5Y 温和上行 +4~6 bp", cold: "温和下行 -3~6 bp" },
        { dim: "曲线斜率", hot: "小幅熊平或平行上移", cold: "小幅牛陡或平行下移" },
        { dim: "实际利率 / BE", hot: "实际利率与服务通胀补偿同步微升", cold: "实际利率主导温和回落" },
      ],
    },
    history: [
      {
        date: "2024-04-30",
        title: "2024 年 Q1 ECI 加速（恰逢 5 月 FOMC 首日）",
        surprise: "ECI 季率升至 +1.2%（预期 +1.0%，前值 +0.9%）",
        ustMove: "2Y +7 bp (5.04%) · 5Y +7 bp · 10Y +6 bp (4.69%) · 2s10s -1 bp",
        lesson: "FOMC 议息首日早晨的偏热 ECI 直接把 2Y 推破 5.0% 大关，迅速锁死了次日会议的偏鹰基调。",
      },
    ],
  },

  retail: {
    key: "retail",
    name: "美国零售销售（Advance Monthly Retail Sales）",
    volatility: "2Y ±5–14 bp · 10Y ±5–13 bp",
    summary: "衡量美国居民商品消费韧性的核心月度指标。交易台真正盯的是直接进入 GDP 核算的**对照组（Control Group）**、反映服务消费的**餐饮服务**以及前两月修订，同时需警惕“名义价格通胀虚高”陷阱。",
    first30s: [
      "Control Group（剔除汽车、汽油、建材、餐饮）月率 + 前两月修订（直接改写 Atlanta Fed GDPNow）",
      "餐饮服务（Food Services）——报告中唯一的服务消费窗口",
      "核对名义与实际：结合当月 CPI 商品/汽油涨幅，辨别是“销量真强”还是“涨价虚高”",
    ],
    regimeSplit: "**曲线斜率高度依赖当前 Regime**！在通胀黏性/不降息预期期，强零售主要由增长与期限溢价驱动 **5Y/10Y/30Y 熊陡**（如 2024-04-15，2s10s +8 bp）；而在衰退恐慌/激进降息定价期，强零售直接砍掉 50 bp 降息预期，引发 **2Y 领涨熊平**（如 2024-08-15，2s10s -5 bp）！",
    traps: [
      "把“汽车或汽油涨价”带动的 Headline 当作消费过热：这两项波动大且不进 GDP 对照组。",
      "僵化假设“强零售=熊陡”或“强零售=熊平”：2024 年 4 月（+8 bp 熊陡）与 8 月（-5 bp 熊平）给出了完全相反的曲线形态。",
      "忽略同刻 08:30 初请失业金或进口价格的叠加共振。",
    ],
    matrix: {
      hotTitle: "对照组与前值修订强劲（消费具韧性）",
      coldTitle: "对照组与餐饮走弱 / 前值下修",
      rows: [
        { dim: "前端 2Y", hot: "若市场原定价激进降息，2Y 剧烈回调（+10~14 bp）；若已少降息则涨幅温和（+5 bp）", cold: "强化降息预期，2Y 下行 -5~10 bp" },
        { dim: "长端 10Y–30Y", hot: "上调实际增长假设，5Y/10Y 显著上行（+8~13 bp）", cold: "下调名义与实际增速预期，5Y/10Y 领跌" },
        { dim: "曲线斜率", hot: "高利率平台期走熊陡；激进降息定价期走熊平", cold: "常规牛平或牛陡（视 2Y 降息空间而定）" },
        { dim: "实际利率 / BE", hot: "实际利率显著走高主导", cold: "实际利率领跌" },
      ],
    },
    history: [
      {
        date: "2024-04-15",
        title: "2024 年 3 月零售强劲（高利率期走熊陡）",
        surprise: "对照组环比 +1.1%（预期 +0.4%）且 2 月上修",
        ustMove: "2Y +5 bp (4.93%) · 5Y +11 bp · 10Y +13 bp (4.63%) · 30Y +13 bp · 2s10s +8 bp",
        lesson: "当时 2Y 已近 5% 难以再大幅计价加息，强劲消费直接推升 10Y/30Y 增长与期限溢价，走出典型的 8 bp 熊陡。",
      },
      {
        date: "2024-08-15",
        title: "2024 年 7 月零售 + 低初请（衰退恐慌期走熊平）",
        surprise: "Headline +1.0%（预期 +0.3%）、对照组 +0.3%，叠加低初请打消硬着陆担忧",
        ustMove: "2Y +14 bp (4.08%) · 5Y +12 bp · 10Y +9 bp (3.92%) · 2s10s -5 bp",
        lesson: "同一类“强消费”意外，在市场原本定价 50 bp 降息时，反过来由 2Y 领涨走出 5 bp 熊平。",
      },
    ],
  },

  gdp: {
    key: "gdp",
    name: "美国 GDP（初值 Advance / 修正 Second / 终值 Third）",
    volatility: "Advance 初值 ±5–10 bp · Second/Third 修正值通常 ±1–3 bp",
    summary: "GDP 的三大交易纪律：① 只有**初值（Advance）**具备高弹性，二/三修高度滞后；② 永远优先看**私人国内最终销售**（剔除库存与净出口噪音）；③ 高度警惕**季度 Core PCE 价格指数**带来的滞胀反向行情！",
    first30s: [
      "先分版本：Advance 初值权重最高；Second / Third 除非内需或 Core PCE 价格大幅修正，否则波幅有限",
      "剥离库存与净出口：进口激增在 GDP 公式中是减项，但实则代表内需旺盛，核心看 Final Sales to Private Domestic Purchasers",
      "同步核对季度 Core PCE 物价折年率（Advance 初值往往直接提前预告次日/同日公布的季末月度 PCE！）",
    ],
    regimeSplit: "最危险的“教科书反向行情”是**滞胀组合（弱 GDP Headline + 强季度 Core PCE）**——此时不能因为 GDP 低于预期就做多美债，2Y/10Y 往往集体上行（如 2024-04-25）。反之若 GDP 极强但已被 GDPNow 充分计价且 Core PCE 偏软，反而利空出尽走牛（如 2023-10-26）。",
    traps: [
      "把“进口大增拖累 GDP Headline”误读为经济衰退：净出口负贡献常常是因为美国消费者买爆了进口商品，真实内需极强。",
      "无视季度 Core PCE 价格指数：GDP 报告里杀伤美债的头号因子往往不是增速，而是价格平减指数超预期。",
      "高估 Second / Third Estimate 的影响力：二修/三修反映 2–3 个月前的历史，且常与同刻 PCE/初请/耐用品撞车。",
    ],
    matrix: {
      hotTitle: "内需强劲 / 季度 Core PCE 偏热",
      coldTitle: "内需放缓 + 季度 Core PCE 偏软",
      rows: [
        { dim: "前端 2Y", hot: "若季度 Core PCE 偏热（即使 Headline 偏弱），2Y 仍显著上行（+6~10 bp）", cold: "物价与内需同步偏软，2Y 下行（-5~8 bp）" },
        { dim: "长端 10Y–30Y", hot: "内需强叠加通胀黏性推升 5Y/10Y；若 GDPNow 已充分定价则反应受限", cold: "若同时伴随软 PCE 价格分项，5Y/10Y 下行流畅（-6~10 bp）" },
        { dim: "曲线斜率", hot: "价格驱动偏熊平；纯内需增长驱动偏熊陡", cold: "价格冷+增速已定价时 5Y/10Y 领跌（微牛平）；衰退信号则牛陡" },
        { dim: "实际利率 / BE", hot: "滞胀组合推高 BE 与实际利率；纯增长推高实际利率", cold: "实际利率与 BE 同步温和回落" },
      ],
    },
    history: [
      {
        date: "2024-04-25",
        title: "2024 Q1 GDP 初值（经典滞胀陷阱：GDP 大幅低于预期，美债反而大跌！）",
        surprise: "实际 GDP 仅 +1.6%（预期 ~2.5%，被进口拖累），但私人国内最终销售 +3.1% 且季度 Core PCE 飙至 3.7%",
        ustMove: "2Y +7 bp (4.96%) · 5Y +6 bp · 10Y +5 bp (4.70%) · 2s10s -2 bp",
        lesson: "最经典的反直觉案例：表面 GDP 远低于预期，但内需强 + 季度 Core PCE 过热令美债全面抛售。",
      },
      {
        date: "2023-10-26",
        title: "2023 Q3 GDP 初值（4.9% 极强但 GDPNow 已计价 + 价格偏软）",
        surprise: "实际 GDP +4.9% 极高，但市场已由 GDPNow 充分计价且 Core PCE 2.4% 略低于预期",
        ustMove: "2Y -6 bp (5.02%) · 5Y -10 bp · 10Y -9 bp (4.86%) · 2s10s -3 bp",
        lesson: "GDP 因为追踪模型（GDPNow）透明度极高，Headline 往往提前计价，真正决定方向的常是价格分项与仓位。",
      },
    ],
  },

  policy: {
    key: "policy",
    name: "FOMC 利率决议、SEP 点阵图与主席记者会",
    volatility: "2Y ±8–30 bp · 10Y ±6–18 bp（存在 14:00 vs 14:30 两段式反转）",
    summary: "FOMC 交易日永远分两场：**14:00 ET 声明与 SEP 点阵图**（机器与短线定价近端路径与长期中性利率 r*）以及 **14:30 ET 主席记者会**（历史上超半数会议在问答阶段修正甚至反转首轮走势）。",
    first30s: [
      "14:00 ET：政策决议 + 声明逐词改动 + 季末 SEP 点阵图（今年/明年中位数决定 2Y/5Y，Longer-run r* 锚定 10Y/30Y）",
      "14:00 ET：是否调整 QT（国债/MBS 缩表上限）或 ON RRP / IORB 技术利率",
      "14:30 ET：主席记者会问答对“下一步加息门槛、就业下行风险、政策限制性程度”的口风校准",
    ],
    regimeSplit: "“鹰派降息（Hawkish Cut）”与“鸽派按兵不动（Dovish Hold）”是美债最常见的反直觉走势：单次利率决定往往早已 95%+ 计价，真正引发 10–30 bp 波动的是点阵图斜率、中性利率 r* 与记者会预期管理。",
    traps: [
      "只看当次是否降息/加息：2024-12-18 明明降息 25 bp，但因 2025 点阵图从 4 次砍半至 2 次，5Y 暴涨 14 bp、10Y 冲破 4.50%。",
      "14:05 盲目追单不等 14:30 记者会：2024-05-01 声明偏鹰，但主席在记者会排除加息并配合 QT 放缓，2Y 盘中反转大跌 8 bp。",
      "忽略 Longer-run 点阵（r*）上移：哪怕当年降息不变，中性利率中位数抬升也会系统性抬高 10Y/30Y 的估值底。",
    ],
    matrix: {
      hotTitle: "偏鹰（点阵图上移 / r* 上调 / 记者会淡化宽松）",
      coldTitle: "偏鸽（点阵图超预期降息 / 放缓 QT / 强调就业风险）",
      rows: [
        { dim: "前端 2Y", hot: "降息次数削减，2Y/5Y 快速重定价上行（+8~18 bp）", cold: "宽松路径提前，2Y 领跌（-8~27 bp）" },
        { dim: "长端 10Y–30Y", hot: "若 Longer-run r* 上移或上调通胀预期，5Y/10Y 同步重挫", cold: "QT 放缓或明确转向鸽派时，10Y/30Y 同步下行（-6~16 bp）" },
        { dim: "曲线斜率", hot: "常规熊平；若 5Y 反映明年点阵削减，5Y 往往跌幅最深（hump 上凸）", cold: "经典牛陡（2s10s +5~11 bp）" },
        { dim: "实际利率 / BE", hot: "实际利率主导大幅走高", cold: "实际利率大幅下行，BE 趋稳或微升（再通胀预期）" },
      ],
    },
    history: [
      {
        date: "2023-12-13",
        title: "2023 年 12 月 FOMC（鸽派转向 Pivot）",
        surprise: "SEP 暗示 2024 年 3 次降息，且记者会承认委员会已开始讨论降息",
        ustMove: "2Y -27 bp (4.46%) · 5Y -23 bp · 10Y -16 bp (4.04%) · 2s10s +11 bp",
        lesson: "政策周期拐点确认时，前端引领全曲线剧烈牛陡。",
      },
      {
        date: "2024-12-18",
        title: "2024 年 12 月 FOMC（经典“鹰派降息”）",
        surprise: "如期降息 25 bp，但 SEP 将 2025 年降息预期从 4 次砍至 2 次并上调通胀预测",
        ustMove: "2Y +10 bp (4.35%) · 5Y +14 bp · 10Y +10 bp (4.50%) · 30Y +6 bp",
        lesson: "点阵图改写 1–3 年政策路径时，Belly（5Y）往往比 2Y 承受更大抛压。",
      },
      {
        date: "2024-05-01",
        title: "2024 年 5 月 FOMC（QT 缩表减速 + 记者会排除加息）",
        surprise: "美债 QT 上限从 600 亿大幅降至 250 亿美元/月，主席称下一步不太可能加息",
        ustMove: "2Y -8 bp (4.96%) · 5Y -8 bp · 10Y -6 bp (4.63%) · 2s10s +2 bp",
        lesson: "QT 放缓与记者会定调可以完全扭转偏鹰声明造成的紧张情绪。",
      },
    ],
  },

  minutes: {
    key: "minutes",
    name: "FOMC 会议纪要（Minutes）",
    volatility: "常规 ±1–4 bp · 若含 QT/缩表或重大鹰鸽增量分歧 ±5–8 bp",
    summary: "纪要发布在会议结束三周后，核心局限是**时间滞后（可能已被会后 CPI/非农覆盖）**。美债真正交易的是两类未曾披露的增量信息：**QT 资产负债表路线图**，以及委员会内部的**人数词层级分歧**。",
    first30s: [
      "核对人数词分布：most / many / several / a few / a couple 对通胀风险、就业风险与宽松门槛的表态比例",
      "搜索 Balance Sheet / QT / Reserve Balances / ON RRP 段落，排查缩表减速或停止信号",
      "检查同日 13:00 ET 是否恰有 20Y 国债拍卖（高频撞车，需拆开 13:00 与 14:00 两段窗口归因）",
    ],
    regimeSplit: "如果这三周内刚出过改写预期的热 CPI 或冷非农，纪要里的旧政策表述往往很快被市场忽略；但涉及 QT 缩表节奏、准备金充足度或金融稳定评估的技术讨论不受三周滞后削弱。",
    traps: [
      "忽略“已过时风险”：用三周前的鹰/鸽讨论去押注大行情，往往在 15 分钟内回归原位。",
      "把同日 13:00 的 20Y 国债拍卖波动错算到 14:00 纪要头上。",
    ],
    matrix: {
      hotTitle: "偏鹰增量（多人担忧通胀黏性 / 提前缩表）",
      coldTitle: "偏鸽增量（讨论放缓/停止 QT / 多数担忧就业）",
      rows: [
        { dim: "前端 2Y", hot: "若未过时，小幅上行 +3~6 bp", cold: "小幅下行 -2~5 bp" },
        { dim: "长端 10Y–30Y", hot: "若涉及提前/加速 QT，长端同步承压（+4~6 bp）", cold: "QT 放缓/停止讨论直接利好长端与掉期利差" },
        { dim: "曲线斜率", hot: "略偏平或平行上移", cold: "QT 鸽派利好长端，可略牛平；政策鸽派则微牛陡" },
        { dim: "实际利率 / BE", hot: "实际利率微升", cold: "实际利率微降" },
      ],
    },
    history: [
      {
        date: "2022-01-05",
        title: "2021 年 12 月纪要（意外提前讨论 QT 缩表）",
        surprise: "纪要揭示官员已在讨论加息后很快启动缩表，远早于市场预期",
        ustMove: "2Y +6 bp (0.83%) · 5Y +6 bp · 10Y +5 bp (1.71%)（并触发美股科技股重挫）",
        lesson: "资产负债表（QT）增量信息是纪要最容易制造超预期冲击的通道。",
      },
    ],
  },

  auction_front: {
    key: "auction_front",
    name: "2Y / 3Y 短端国债拍卖",
    volatility: "拍卖期限 ±1–4 bp · 对长端外溢通常极小",
    summary: "2Y/3Y 紧贴政策利率路径锚定、单券 DV01 较低，一级市场承接通常稳健。交易重点在于**截标前 Concession（让价）程度**、**Stop vs WI** 及与 OIS/SOFR 隐含路径的相对价值。",
    first30s: [
      "High Yield 减 13:00 截标前可成交 WI（Tail / Stop-through，±0.5 bp 内多属常态）",
      "一级交易商（Primary Dealer）获配占比（2Y/3Y 常规约 10%–16%，>18% 说明终端买盘偏弱）",
      "核对拍卖前是否已出现明显让价（Concession），避免脱离事前走势孤立解读 0.5 bp 尾差",
    ],
    regimeSplit: "除非恰逢 FOMC/CPI 前夕流动性极差且出现 ≥2 bp 罕见大 Tail，2Y/3Y 拍卖很少改变全曲线大方向，更多体现为短端相对邻券与期货基差的局部重估。",
    traps: [
      "拿长债（30Y）的波动模板套 2Y/3Y：短端拍卖几乎不会单靠自身拖垮 10Y/30Y。",
      "把 Indirect（间接投标）直接等同于“外国央行”：Indirect 同时包含大量通过一级交易商代投的美国本土基金/资管，真正衡量买盘疲软的最硬指标是 **Primary Dealer 被迫接盘占比**。",
    ],
    matrix: {
      hotTitle: "Tail（中标收益率 > WI）+ Dealer 占比高",
      coldTitle: "Stop-through（中标收益率 < WI）+ 终端买盘强",
      rows: [
        { dim: "前端 2Y", hot: "拍卖期限小幅走弱 +1~4 bp，Dealer 需二级市场消化库存", cold: "短端企稳走强 -1~3 bp，前期让价快速回补" },
        { dim: "长端 10Y–30Y", hot: "外溢微弱（除非宏观本身偏空）", cold: "外溢微弱，略提振次日 5Y/7Y 拍卖情绪" },
        { dim: "曲线斜率", hot: "短端局部承压，2s10s 略平 1–2 bp", cold: "2s10s 略陡 1–2 bp" },
        { dim: "实际利率 / BE", hot: "以短端名义/实际利率微调为主", cold: "同上，主要为相对价值回归" },
      ],
    },
    history: [
      {
        date: "2024-05-28",
        title: "2Y + 5Y 同日双拍承接偏弱（假日后首日）",
        surprise: "阵亡将士纪念日次日连续两场拍卖均现 Tail，Dealer 获配偏高",
        ustMove: "2Y +1 bp (4.94%) · 5Y +3 bp · 10Y +8 bp (4.54%) · 30Y +9 bp",
        lesson: "2Y 自身波动极小，但在节假日后流动性薄弱且同日 2Y+5Y 双拍均弱时，供给担忧迅速传导至长端走熊陡。",
      },
    ],
  },

  auction_belly: {
    key: "auction_belly",
    name: "5Y / 7Y 中端（Belly）国债拍卖",
    volatility: "常规 ±2–6 bp · 极端 7Y Tail 可引爆全市场 ±10–21 bp",
    summary: "5Y/7Y 处于曲线 Belly（腹部），对**一级交易商资产负债表压力、月末再平衡及利率波动率**高度敏感。尤其是 **7Y 国债**，因缺乏专属活跃期货对冲且终端自然买家相对窄，历史上多次出现极端 Tail！",
    first30s: [
      "Stop Yield 减截标前 WI（≥1.5 bp Tail 需高度警惕 Belly 连锁抛压）",
      "Primary Dealer 获配占比（常规约 10%–15%，若跳升至 >18%–20% 意味着终端需求明显缺席）",
      "观察 5Y/7Y 相对 2Y 与 10Y 的 Belly Fly（2s5s10s / 5s7s10s）是否同步走弱",
    ],
    regimeSplit: "当利率波动率（MOVE 指数）高企且一级交易商月末资产负债表吃紧时，一场糟糕的 7Y 拍卖极易触发期货止损与凸性对冲踩踏，把冲击传导至整个 5Y–10Y 甚至美股。",
    traps: [
      "低估 7Y 拍卖的尾部风险：7Y 是历史上最容易出流动性断层与超大 Tail 的期限之一。",
      "忽略拍卖前让价（Concession）：若拍卖前已提前下跌让价 10+ bp，即便仅小幅 Stop-through 也常引发剧烈空头回补。",
    ],
    matrix: {
      hotTitle: "Tail（中标收益率 > WI）+ Dealer 获配飙升",
      coldTitle: "Stop-through（中标收益率 < WI）+ 终端承接强",
      rows: [
        { dim: "前端 2Y", hot: "温和跟涨 +2~5 bp", cold: "温和回落 -1~4 bp" },
        { dim: "长端 10Y–30Y", hot: "5Y/7Y 领跌并明显外溢至 10Y（+4~16 bp）", cold: "Belly 领涨带动 10Y 修复（-3~7 bp）" },
        { dim: "曲线斜率", hot: "2s5s10s Fly 上凸（Belly 相对最弱），2s10s 往往熊陡", cold: "Belly 跑赢两翼，2s5s10s Fly 收窄" },
        { dim: "实际利率 / BE", hot: "实际利率走高（久期风险溢价抬升）", cold: "实际利率回落" },
      ],
    },
    history: [
      {
        date: "2021-02-25",
        title: "2021 年 2 月 7Y 国债拍卖惨案（历史级 Tail 闪崩）",
        surprise: "录得 4.4 bp 罕见巨幅 Tail，投标倍数跌至 2.04× 历史低位",
        ustMove: "7Y +21 bp · 5Y +19 bp · 10Y +16 bp (1.54%) · 2Y +5 bp · 2s10s +11 bp",
        lesson: "7Y Belly 拍卖在低流动性+高波动环境下足以引爆跨资产闪崩，绝不可按“中等期限”轻视。",
      },
    ],
  },

  auction_10y: {
    key: "auction_10y",
    name: "10 年期基准国债拍卖",
    volatility: "常规 ±2–6 bp · 大 Tail 或叠加宏观冲击 ±8–15 bp",
    summary: "全球无风险定价基准（尤其 2/5/8/11 月季度再融资新发）。10Y 拍卖不仅直接影响当日长端，更几乎总是为**次日 30Y 超长债拍卖**定调。",
    first30s: [
      "High Yield vs 13:00 截标前 WI（≥2 bp Tail 为显著弱拍，≤-1.5 bp 为强劲 Stop-through）",
      "Primary Dealer 获配（常规 ~10%–15%，>18% 为警示信号）+ Indirect + Direct 合计终端买盘占比",
      "回看拍卖前 24–48 小时是否已有充分 Concession，以及同日早盘是否刚经历 CPI/非农冲击",
    ],
    regimeSplit: "若同日早盘刚出热通胀（如 2024-04-10），机构不敢在截标前接飞刀，极易演化为“热数据 + 大 Tail”双击；反之在重磅数据前夕若收益率已具吸引力，海外与资管逢高锁定票息常造就强劲 Stop-through（如 2024-06-11）。",
    traps: [
      "把 Indirect 高直接解读成“央行大买”：须同时看 Dealer 占比是否压低至 ~10–12% 以下来确认真实终端需求。",
      "忘了 10Y → 30Y 的跨日传导：10Y 大 Tail 后，次日 30Y 往往需要更深的盘前 Concession 才能平稳落地。",
    ],
    matrix: {
      hotTitle: "Tail（> WI）+ Dealer 兜底偏高",
      coldTitle: "Stop-through（< WI）+ 终端需求强劲",
      rows: [
        { dim: "前端 2Y", hot: "温和跟涨，涨幅明显小于 10Y", cold: "温和回落，风险偏好改善" },
        { dim: "长端 10Y–30Y", hot: "10Y 与 30Y 同步抛售（+5~12 bp），压制次日 30Y 情绪", cold: "10Y 领涨（收益率下行 -4~8 bp），缓解供给焦虑" },
        { dim: "曲线斜率", hot: "2s10s 熊陡，提前定价次日 30Y 让价", cold: "2s10s 略牛平或全曲线修复" },
        { dim: "实际利率 / BE", hot: "长端实际利率与期限溢价同步走高", cold: "期限溢价回落，实际利率下行" },
      ],
    },
    history: [
      {
        date: "2024-04-10",
        title: "2024 年 4 月 10Y 拍卖（热 CPI 后 3.1 bp 大 Tail）",
        surprise: "$39bn 10Y 中标 4.560% vs WI 4.529%（3.1 bp Tail），投标倍数降至 2.34×",
        ustMove: "叠加早盘热 CPI，当日 10Y +19 bp (4.55%) · 5Y +24 bp · 30Y +14 bp",
        lesson: "高波动宏观冲击日午后的 10Y 拍卖，风险预算收缩常使 Tail 显著放大。",
      },
      {
        date: "2024-06-11",
        title: "2024 年 6 月 10Y 拍卖（重磅数据前强势 2.0 bp Stop-through）",
        surprise: "录得 2.0 bp Stop-through、Indirect 高达 74.6%、Dealer 仅 11.6%",
        ustMove: "10Y -8 bp (4.39%) · 5Y -7 bp · 2Y -6 bp",
        lesson: "在前期已充分让价后，强终端需求能迅速扭转市场对美债供给过剩的悲观情绪。",
      },
    ],
  },

  auction_20y: {
    key: "auction_20y",
    name: "20 年期国债拍卖（曲线孤儿点）",
    volatility: "20Y 独立波动 ±3–10 bp · 重点体现于 10s20s30s Fly",
    summary: "20Y 是 2020 年重启的“曲线孤儿点”：既非全球基准（10Y），也非险资久期基准（30Y），且缺乏直接活跃期货锚定，导致流动性最薄、收益率常高于 30Y（曲线倒挂鼓包）。",
    first30s: [
      "Stop Yield 减截标前 WI，同步检查 **10s20s30s Fly**（2×20Y − 10Y − 30Y）是否进一步走阔",
      "Primary Dealer 获配占比（20Y 因自然终端买家较窄，对 Dealer 承接尤为敏感）",
      "注意高频与同日 14:00 ET FOMC 会议纪要重合：13:00 窗口归因给 20Y 供给，14:00 再看政策",
    ],
    regimeSplit: "因为 20Y 长期折价（高收益率），当绝对收益率具吸引力时，险资/海外买盘偶尔也会造就惊人的 Stop-through 并触发 10s20s30s Fly 剧烈回缩；反之弱拍极易出现局部流动性真空。",
    traps: [
      "把 20Y 的独立走弱直接外推成“美债全面崩盘”：很多时候只是 20Y Fly 局部廉价，10Y 与 30Y 反应远温和。",
      "忽视与同日 14:00 FOMC 纪要的窗口拆分。",
    ],
    matrix: {
      hotTitle: "20Y Tail + Dealer 获配偏高",
      coldTitle: "20Y Stop-through + 终端逢高锁定",
      rows: [
        { dim: "前端 2Y", hot: "几乎无直接影响", cold: "几乎无直接影响" },
        { dim: "长端 10Y–30Y", hot: "20Y 显著领跌，轻微拖累 10Y/30Y（+2~6 bp）", cold: "20Y 领涨（收益率下行），温和提振 30Y" },
        { dim: "曲线斜率", hot: "10s20s30s Fly 显著走阔（20Y 更便宜），5s30s 略陡", cold: "10s20s30s Fly 快速收窄（20Y 相对修复）" },
        { dim: "实际利率 / BE", hot: "长端流动性与期限溢价小幅走高", cold: "20Y 流动性折价收敛" },
      ],
    },
    history: [
      {
        date: "2023-11-20",
        title: "2023 年 11 月 20Y 拍卖（30Y 惨案后逢高抢筹 Stop-through）",
        surprise: "在 11/09 30Y 惨案把长端推高后，20Y 录得 ~1 bp Stop-through 与强劲终端需求",
        ustMove: "20Y -6 bp · 10Y -2 bp (4.42%) · 30Y -2 bp · 10/20/30 Fly 单日大收窄 -8 bp",
        lesson: "教科书级 20Y 独立行情：10Y/30Y 仅微动 -2 bp，而 20Y 独自大涨把 10/20/30 Fly 砸低 8 bp。",
      },
    ],
  },

  auction_30y: {
    key: "auction_30y",
    name: "30 年期超长债拍卖（Long Bond）",
    volatility: "常规 ±3–7 bp · 大 Tail 时 30Y/10Y 可单日暴涨 +10–16 bp",
    summary: "单券久期最长、DV01 集中度最高，是市场检验**财政赤字消化能力与长期期限溢价**的终极试金石。一场 ≥3 bp 的大 Tail 足以瞬间引爆长端熊陡并波及全球风险资产。",
    first30s: [
      "High Yield vs 13:00 WI（≥2 bp Tail 属弱拍，≥3.5 bp 往往触发跨资产抛售）",
      "Primary Dealer 获配占比（常规 ~11%–15%，一旦 >20% 属于终端买家罢工信号，Dealer 抛压持续至收盘）",
      "对照前一日 10Y 拍卖表现与截标前 Concession 幅度",
    ],
    regimeSplit: "在财政发债放量、赤字担忧升温的宏观背景下，30Y 拍卖从“例行事件”升级为“一级市场风险事件”；反之若降息周期确立、险资（LDI）积极拉久期，30Y 强拍能压平 5s30s。",
    traps: [
      "低估 Dealer 拿货后的二次抛压：30Y 单笔 DV01 约为 2Y 的 10 倍，Dealer 被迫接盘 >20% 后必须用 Ultra Bond（UB）期货或二级市场急抛对冲。",
      "把 Indirect 偏低单独看：需同时结合 Direct（本土养老金/保险直投）与 Dealer 占比综合判断终端承接。",
    ],
    matrix: {
      hotTitle: "大 Tail（≥2 bp）+ Dealer 占比飙升",
      coldTitle: "Stop-through + 险资/长线终端积极承接",
      rows: [
        { dim: "前端 2Y", hot: "间接小幅跟涨，但明显跑赢长端", cold: "变化温和" },
        { dim: "长端 10Y–30Y", hot: "30Y 剧烈抛售（+6~16 bp），拖累 10Y 与科技股", cold: "30Y 领涨（收益率下行 -4~9 bp），期限溢价回落" },
        { dim: "曲线斜率", hot: "5s30s 与 10s30s 急剧熊陡", cold: "5s30s 与 10s30s 走平（牛平）" },
        { dim: "实际利率 / BE", hot: "长端实际利率与期限溢价大幅走高", cold: "长端实际利率回落" },
      ],
    },
    history: [
      {
        date: "2023-11-09",
        title: "2023 年 11 月 30Y 拍卖惨案（5.3 bp 巨幅 Tail）",
        surprise: "$24bn 30Y 中标 4.769% vs WI ~4.716%（5.3 bp Tail），BTC 2.24×，Dealer 被迫兜底 24.7%",
        ustMove: "30Y +13 bp · 10Y +13 bp (4.62%) · 5Y +14 bp · 2Y +10 bp · 2s10s +3 bp",
        lesson: "30Y 拍卖中一旦 Primary Dealer 被迫吃进近四分之一发行量，会瞬间触发全曲线与权益市场的剧烈抛售。",
      },
    ],
  },

  tips: {
    key: "tips",
    name: "TIPS 通胀保值国债拍卖（5Y / 10Y / 30Y）",
    volatility: "实际利率 ±2–6 bp · 联动同期限 Breakeven ±2–5 bp",
    summary: "TIPS 拍卖标的是**实际收益率（Real Yield）**而非名义利率。交易核心在于把拍卖后的变化拆成两层：**实际利率独立走弱/走强**，以及由此引发的 **Breakeven（盈亏平衡通胀）拉伸或压缩**。",
    first30s: [
      "Real Yield Stop 减截标前 TIPS WI（注意是实际收益率）",
      "同步盯同期限名义国债与 Breakeven（Nominal − Real）：若 TIPS Tail 但名义债不动，即 Breakeven 被动收窄",
      "Dealer 占比基准显著低于名义债！TIPS 终端（基金/海外）占比通常高达 85%–93%，Dealer 常规仅 5%–10%（>12% 即属偏弱）",
    ],
    regimeSplit: "当油价飙升或通胀预期抬头时，基金涌入 TIPS 往往造就强 Stop-through 并推高 Breakeven；当实际利率高企但油价大跌时，TIPS 流动性折价容易扩大。",
    traps: [
      "拿名义国债 12%–15% 的 Dealer 正常值套 TIPS：对 10Y TIPS 而言，Dealer 拿 6%–8% 才是常态，超过 12%–15% 已算承接偏弱！",
      "忘记用名义期货对冲 TIPS 会残留 Breakeven 敞口（油价或 CPI 预期突变时基差风险大）。",
    ],
    matrix: {
      hotTitle: "实际收益率 Tail（> WI）",
      coldTitle: "实际收益率 Stop-through（< WI）",
      rows: [
        { dim: "前端 2Y", hot: "影响微弱（5Y TIPS 略联动前端实际利率）", cold: "影响微弱" },
        { dim: "长端 10Y–30Y", hot: "同期限实际利率走高，名义债仅部分跟随", cold: "实际利率走低，提振通胀保护买盘" },
        { dim: "曲线斜率", hot: "Real Curve 局部走弱，对名义斜率传导温和", cold: "Real Curve 修复" },
        { dim: "实际利率 / BE", hot: "Real Yield ↑，Breakeven 往往收窄", cold: "Real Yield ↓，Breakeven 往往走阔" },
      ],
    },
    history: [
      {
        date: "2024-07-18",
        title: "2024 年 7 月 10Y TIPS 拍卖（名义与实际利率分化）",
        surprise: "实际收益率处 1.89% 附近高位，终端承接强劲，而当日名义债整体偏弱",
        ustMove: "10Y 实际利率 -1 bp (1.89%) · 10Y 名义 +4 bp (4.20%) · 10Y Breakeven 走阔 +5 bp (2.31%)",
        lesson: "完美体现 TIPS 拆分的必要性：名义 10Y 收益率上行 4 bp，但 TIPS 强劲承接使实际利率反跌 1 bp，直接推阔 10Y Breakeven 5 bp。",
      },
    ],
  },

  bills: {
    key: "bills",
    name: "T-bill 国库券与 2Y FRN 浮息债拍卖",
    volatility: "短端资金利率/国库券 ±1–3 bp · 对 2Y–30Y 附息曲线几乎无直接冲击",
    summary: "T-bill 与 2Y FRN（按 13 周 T-bill 浮息定价，久期近零）属于货币市场与流动性管理品种，主要反映 **SOFR / GC 回购资金面、财政部 TGA 账户余额、ON RRP 消耗及近期 FOMC 会议定价**。",
    first30s: [
      "T-bill 看最高贴现率（High Rate）相对 OIS/同期限资金成本；2Y FRN 看最高折扣利差（High Discount Margin）",
      "核对结算日是否撞上季末/月末/缴税日（Tax Date）或债务上限（X-date）敏感窗口",
      "除非出现债务上限违约定价或资金面剧烈抽水（SOFR 飙升），否则无需外推至 10Y/30Y",
    ],
    regimeSplit: "常规周期属于低影响资金面指标；仅在财政部大幅增发 Bill 抽离银行准备金、季末 Repo 紧张或债务上限博弈期才跃升为核心风险点。",
    traps: [
      "把 2Y FRN 当成 2Y 固定利率国债：FRN 久期接近 0，其价格与利率路径几乎解耦，只反映短期资金利差。",
    ],
    matrix: {
      hotTitle: "贴现率/折扣利差高于预期（资金面偏紧）",
      coldTitle: "贴现率/折扣利差低于预期（货币基金买盘充裕）",
      rows: [
        { dim: "前端 2Y", hot: "短端 Bill 走弱，仅在资金紧张外溢时微扰 2Y", cold: "Bill 收益率下行，货币基金/RRP 承接顺畅" },
        { dim: "长端 10Y–30Y", hot: "无直接影响", cold: "无直接影响" },
        { dim: "曲线斜率", hot: "仅影响 3M/6M 与 2Y 的超短端利差", cold: "超短端资金利差平稳" },
        { dim: "实际利率 / BE", hot: "无直接影响", cold: "无直接影响" },
      ],
    },
    history: [
      {
        date: "2023-05-24",
        title: "2023 年债务上限 X-date 窗口 T-bill 畸形溢价",
        surprise: "到期日落在 6 月初的 4W T-bill 贴现率一度飙破 6%–7%，显著高于相邻期限",
        ustMove: "高度集中于特定到期日 Bill，10Y 附息国债受避险支撑反而相对克制",
        lesson: "Bill 拍卖异常几乎总是资金面/结算日/债务上限的局部流动性问题，而非长期通胀或增长定价。",
      },
    ],
  },

  durables: {
    key: "durables",
    name: "耐用品订单初值（Durable Goods Orders）",
    volatility: "5Y/10Y ±1–4 bp",
    summary: "Headline 极度受波音民航飞机与国防订单巨幅波动干扰，美债交易台真正盯的是**剔除国防与飞机的核心资本品订单与出货（Core Capital Goods Orders & Shipments）**——后者直接进入 GDP 设备投资分项。",
    first30s: [
      "忽略被飞机订单扭曲的 Headline，直接看 Non-defense Capital Goods ex-Aircraft 订单及出货",
      "核对前月修订及同刻 08:30 ET 是否有 GDP / PCE / 初请撞车",
    ],
    regimeSplit: "单靠耐用品订单极少改变 2Y 政策路径，主要通过修正当季 GDP 追踪值（GDPNow）温和影响 5Y/10Y。",
    traps: [
      "被单月波音大额订单造成的 Headline +8% 或 -6% 假象误导。",
    ],
    matrix: {
      hotTitle: "核心资本品订单与出货同步超预期",
      coldTitle: "核心资本品走弱 / 前月下修",
      rows: [
        { dim: "前端 2Y", hot: "反应温和（+1~2 bp）", cold: "反应温和（-1~2 bp）" },
        { dim: "长端 10Y–30Y", hot: "小幅上调企业投资/GDP 预期，5Y/10Y +2~4 bp", cold: "5Y/10Y 小幅下行 -2~4 bp" },
        { dim: "曲线斜率", hot: "略偏熊陡", cold: "略偏牛平" },
        { dim: "实际利率 / BE", hot: "实际利率微升", cold: "实际利率微降" },
      ],
    },
    history: [
      {
        date: "2024-04-24",
        title: "常规核心资本品温和波动（单日影响受控）",
        surprise: "Headline 因飞机订单跳涨 +2.6%，但核心资本品仅 +0.2% 符合预期",
        ustMove: "美债反应极平淡（±1–2 bp），市场迅速忽略 Headline 噪音",
        lesson: "交易耐用品订单的第一铁律是跳过 Headline、只读核心资本品与出货。",
      },
    ],
  },

  productivity: {
    key: "productivity",
    name: "非农生产率与单位劳动成本（Productivity & ULC）",
    volatility: "2Y/5Y ±2–5 bp",
    summary: "常被误解的宝藏通胀指标！**高生产率 = 压低单位劳动成本（ULC）= 利好反通胀与美债（收益率下行）**；反之低生产率 + 高工资推升 ULC，对美债偏空。",
    first30s: [
      "Unit Labor Costs（单位劳动成本折年率）——直接衡量每单位产出的真实工资通胀压力",
      "非农劳动生产率（Output per hour）——高增长若由高生产率驱动，属于“非通胀性增长”",
    ],
    regimeSplit: "注意反直觉方向：**生产率超预期强，通常是利多美债（压低通胀压力）**，而非像普通增长数据那样利空美债！",
    traps: [
      "把“生产率高于预期”当成普通经济过热去做空美债：生产率提升恰好能抵消高工资、帮助软着陆。",
    ],
    matrix: {
      hotTitle: "ULC 偏热 / 生产率偏弱（工资通胀压力上升）",
      coldTitle: "生产率超预期强 / ULC 显著回落",
      rows: [
        { dim: "前端 2Y", hot: "强化粘性工资通胀担忧，2Y 微升 +2~5 bp", cold: "利好软着陆与降息空间，2Y 下行 -2~4 bp" },
        { dim: "长端 10Y–30Y", hot: "温和跟涨", cold: "温和下行" },
        { dim: "曲线斜率", hot: "略熊平", cold: "略牛陡" },
        { dim: "实际利率 / BE", hot: "BE 与实际利率微升", cold: "通胀担忧缓和，BE 微降" },
      ],
    },
    history: [
      {
        date: "2023-11-02",
        title: "2023 Q3 生产率飙升 +4.7% 且 ULC 意外转负 -0.8%",
        surprise: "生产率大超预期、单位劳动成本意外下降，配合前一日 FOMC 与温和发债指引",
        ustMove: "10Y -10 bp (4.67%) · 20Y -14 bp · 30Y -14 bp（2Y +3 bp，曲线显著牛平）",
        lesson: "高生产率压低 ULC 是美债长端最喜欢的“非通胀性增长”组合，往往压低期限溢价与通胀担忧。",
      },
    ],
  },

  growth_secondary: {
    key: "growth_secondary",
    name: "二级增长与住房 / 贸易 / 工业数据",
    volatility: "5Y/10Y ±1–3 bp（主要用于动态修正当季 GDPNow）",
    summary: "包括工业产出（G.17）、新屋开工/建筑许可、新屋销售、国际贸易（FT-900）及预估经济指标。单次发布通常不改变美联储路径，但会持续改写 GDPNow 并验证高利率对实体（尤其是利率敏感的房地产/制造业）的传导滞后。",
    first30s: [
      "住房数据优先看独栋住宅（Single-family Starts & Permits）与库存去化月数，对按揭利率极敏感",
      "贸易逆差扩大（尤其进口走强）虽然拉低当季 GDP 净出口项，但需与消费/库存数据结合判断内需强弱",
      "工业产出看制造业产出分项与产能利用率，剔除公用事业（受天气温度影响大）",
    ],
    regimeSplit: "单个指标很少走出 >4 bp 独立行情；但若连续多项住房、制造业与库存数据同向转弱，会在非农/CPI 前提前积蓄降息交易仓位。",
    traps: [
      "忽略工业产出里 Utilities（水电暖）受异常冷暖天气驱动的假波动。",
      "把贸易逆差扩大机械等同于经济走弱（高进口往往对应强内需）。",
    ],
    matrix: {
      hotTitle: "分项显著超预期（上修 GDPNow）",
      coldTitle: "分项显著走弱（实体受高利率压制）",
      rows: [
        { dim: "前端 2Y", hot: "微幅上行 +0~2 bp", cold: "微幅下行 -0~2 bp" },
        { dim: "长端 10Y–30Y", hot: "小幅上行 +1~3 bp", cold: "小幅下行 -1~3 bp" },
        { dim: "曲线斜率", hot: "略熊陡", cold: "略牛平" },
        { dim: "实际利率 / BE", hot: "实际利率微动", cold: "实际利率微动" },
      ],
    },
    history: [
      {
        date: "2024-06-20",
        title: "2024 年 5 月新屋开工与许可跌至四年低位",
        surprise: "新屋开工降至 127.7 万户（远低于预期），显示高按揭利率持续压制地产",
        ustMove: "当日市场受其他因素主导，2Y +1 bp (4.70%) · 10Y +3 bp (4.25%)",
        lesson: "典型印证二级数据权重：单次住房数据大幅不及预期也难对抗大盘，更适合作为中周期趋势与 GDPNow 拼图。",
      },
    ],
  },

  speech: {
    key: "speech",
    name: "美联储主席 / 理事讲话与褐皮书",
    volatility: "主席/核心投票委员 ±3–12 bp · 一般理事/技术主题 ±0–3 bp",
    summary: "核心区分**发言人权重（主席 / 纽约联储主席 / 副主席 > 普通理事）**、**是否处于静默期前最后窗口**，以及是否释放相对市场定价的新增政策表态；褐皮书（Beige Book）则在硬数据空窗期或拐点期提供 12 辖区一线体感。",
    first30s: [
      "优先读官网正式讲稿原文，辨别“延续旧口径”还是“新增转向/门槛措辞”",
      "把正式讲稿与随后的公开问答（Q&A）分开看——真正动盘的常是 Q&A 的即兴回答",
      "褐皮书重点看“物价转嫁能力、招聘放缓、消费者对价格敏感度”的辖区数量变化",
    ],
    regimeSplit: "同一句话由联储主席或核心人物在 FOMC 静默期前讲出（例如 2023-11-28 Waller 偏鸽讲话），可单日撼动 2Y 超 10 bp；而监管/支付/AI 等技术主题讲话通常无利率影响。",
    traps: [
      "只看媒体断章取义的标题，未对照官网原文上下文。",
      "高估无投票权或非政策主题演讲的持续性。",
    ],
    matrix: {
      hotTitle: "核心官员释放偏鹰新信号（淡化降息 / 警惕再通胀）",
      coldTitle: "核心官员释放偏鸽新信号（认可降息条件成熟）",
      rows: [
        { dim: "前端 2Y", hot: "快速重定价近期会议概率（+3~10 bp）", cold: "降息概率迅速抬升（-4~12 bp）" },
        { dim: "长端 10Y–30Y", hot: "温和跟随", cold: "温和跟随" },
        { dim: "曲线斜率", hot: "偏熊平", cold: "偏牛陡" },
        { dim: "实际利率 / BE", hot: "实际利率走高", cold: "实际利率回落" },
      ],
    },
    history: [
      {
        date: "2023-11-28",
        title: "理事 Waller 罕见表态通胀回落数月即可降息",
        surprise: "著名鹰派理事公开谈及“若反通胀持续 3–5 个月可纯因通胀下降而降息”",
        ustMove: "2Y -11 bp (4.73%) · 5Y -9 bp · 10Y -5 bp (4.34%) · 2s10s +6 bp",
        lesson: "“鹰派转鸽”或“鸽派转鹰”的边际反差，往往比常规立场发言具有数倍市场冲击力，并由前端领跌走牛陡。",
      },
    ],
  },

  funding: {
    key: "funding",
    name: "美联储资产负债表 H.4.1（周四 16:30 ET）",
    volatility: "对国债现券日内无直接跳价，但决定季度资金面与 Swap Spreads 趋势",
    summary: "每周披露美联储总资产、银行准备金（Reserve Balances）、财政部 TGA 账户及 ON RRP 余额，是判断银行体系流动性是否逼近“充裕下限”与 QT 何时结束的核心窗口。",
    first30s: [
      "银行准备金余额是否逼近 GDP ~10%–11%（约 3 万亿美元附近）敏感区",
      "TGA 账户激增（缴税/发债回笼）或 ON RRP 耗尽是否正直接抽走银行准备金",
      "单周波动常受国债大额结算日时点错位影响，需结合 4 周趋势与 SOFR-IORB 利差交叉验证",
    ],
    regimeSplit: "平时几乎不引发 16:30 秒级行情，但一旦准备金快速跌向警戒区并叠加季末 SOFR 跳升，会触发市场对“美联储被迫提前停止 QT”的交易，直接提振长端与掉期利差。",
    traps: [
      "把缴税周 TGA 短期冲高误判成永久性流动性危机。",
    ],
    matrix: {
      hotTitle: "准备金超预期下滑 / 资金面抽水加速",
      coldTitle: "流动性充裕 / 准备金回升",
      rows: [
        { dim: "前端 2Y", hot: "Repo/SOFR 利差走阔，压制短端融资", cold: "资金利率贴近政策下沿，套息环境稳定" },
        { dim: "长端 10Y–30Y", hot: "若倒逼提前结束 QT，反而形成中期利好", cold: "中性" },
        { dim: "曲线斜率", hot: "主要体现于 Swap Spreads 与短端基差", cold: "中性" },
        { dim: "实际利率 / BE", hot: "无直接影响", cold: "无直接影响" },
      ],
    },
    history: [
      {
        date: "2019-09-17",
        title: "2019 年 9 月回购危机（准备金跌破充裕线）",
        surprise: "缴税与国债结算叠加导致准备金过度消耗，SOFR 飙破 5%",
        ustMove: "迫使美联储紧急重启隔夜回购操作并扩表买 T-bill",
        lesson: "H.4.1 的价值在于提前数周预警“准备金 + ON RRP 缓冲垫耗尽”，防范回购利率突发性失控。",
      },
    ],
  },

  market: {
    key: "market",
    name: "美债现券 / 期货 / 美股休市与提前收市",
    volatility: "常规波动收窄，但重开窗口或稀疏盘口易出跳空与基差错位",
    summary: "美国固收现券（SIFMA 建议）、股票（NYSE）与利率期货（CME Globex）在节假日经常**不同步开闭市**（如哥伦布日/退伍军人节债市休市但股市开盘，感恩节次日 13:00/13:15/14:00 阶梯收市）。",
    first30s: [
      "逐一核对 SIFMA 现券、CME Globex 期货与 NYSE 美股的截点与重开时刻",
      "现券休市但期货/海外交易时，所有海外或宏观变动会在现券重开首 15 分钟集中一次性反映",
      "提前收市日尾盘深度稀薄，大单执行成本与滑点成倍上升",
    ],
    regimeSplit: "节假日清淡市中最容易出现“假突破”或被单笔机构调仓砸出的非基本面长影线，重开后需等待正常成交深度恢复再确认趋势。",
    traps: [
      "在退伍军人节/哥伦布日以为全市场休市（其实股市与 CME 期货仍在交易，且次日早盘现券会一次性跳空补齐）。",
      "把提前收市最后 30 分钟稀疏盘口的价格当作有效趋势信号。",
    ],
    matrix: {
      hotTitle: "休市期间期货大跌 / 海外抛售",
      coldTitle: "休市期间期货大涨 / 避险买盘",
      rows: [
        { dim: "前端 2Y", hot: "现券重开直接跳空上行，检查与期货隐含基差", cold: "现券重开跳空下行，注意初期点差偏宽" },
        { dim: "长端 10Y–30Y", hot: "20Y/30Y 稀疏成交放大波动，勿盲目追单", cold: "同上，等待欧美盘深度回补确认" },
        { dim: "曲线斜率", hot: "节前调仓常引发非基本面斜率扭曲", cold: "节后常有部分均值回归" },
        { dim: "实际利率 / BE", hot: "TIPS 在清淡市流动性最薄，点差显著扩大", cold: "同上" },
      ],
    },
    history: [
      {
        date: "2023-04-07",
        title: "耶稣受难日（Good Friday）发布非农就业",
        surprise: "美股休市、SIFMA 美债现券仅开半日至 12:00 ET，08:30 非农稳健",
        ustMove: "极薄流动性下 2Y +15 bp (3.97%) · 5Y +12 bp · 10Y +9 bp (3.39%)",
        lesson: "当重磅数据撞上节假日半日市，盘口滑点与瞬时跳价幅度会被显著放大，风控须提前缩减单笔规模。",
      },
    ],
  },
};

export function playbookFor(event: MarketEvent): Playbook {
  if (event.title === "美国 CPI") return playbooks.cpi;
  if (event.title.startsWith("PCE")) return playbooks.pce;
  if (event.title === "美国 PPI") return playbooks.ppi;
  if (event.title === "美国非农就业") return playbooks.jobs;
  if (event.title === "初请失业金") return playbooks.claims;
  if (event.title === "JOLTS 职位空缺") return playbooks.jolts;
  if (event.title === "就业成本指数（ECI）") return playbooks.eci;
  if (event.title === "美国零售销售") return playbooks.retail;
  if (event.title === "美国 GDP") return playbooks.gdp;
  if (event.title === "耐用品订单初值") return playbooks.durables;
  if (event.title === "生产率与单位劳动成本") return playbooks.productivity;
  if (event.title === "FOMC 利率决议" || event.title === "FOMC 记者会" || event.title === "FOMC 政策会议开始") return playbooks.policy;
  if (event.title === "FOMC 会议纪要") return playbooks.minutes;

  if (event.category === "auction") {
    if (event.kind === "tips") return playbooks.tips;
    if (event.kind === "bills" || /\bFRN\b/.test(event.title)) return playbooks.bills;
    const key = event.auctionKey ?? "";
    if (/^(2|3)y-/.test(key) || /^[23]\s*年期/.test(event.title)) return playbooks.auction_front;
    if (/^(5|7)y-/.test(key) || /^[57]\s*年期/.test(event.title)) return playbooks.auction_belly;
    if (/^10y-/.test(key) || /^10\s*年期/.test(event.title)) return playbooks.auction_10y;
    if (/^20y-/.test(key) || /^20\s*年期/.test(event.title)) return playbooks.auction_20y;
    if (/^30y-/.test(key) || /^30\s*年期/.test(event.title)) return playbooks.auction_30y;
    return playbooks.auction_10y;
  }

  const byKind: Record<Kind, Playbook> = {
    inflation: playbooks.cpi,
    ppi: playbooks.ppi,
    jobs: playbooks.jobs,
    claims: playbooks.claims,
    retail: playbooks.retail,
    growth: playbooks.growth_secondary,
    policy: playbooks.policy,
    minutes: playbooks.minutes,
    speech: playbooks.speech,
    technicalSpeech: playbooks.speech,
    longAuction: playbooks.auction_30y,
    tips: playbooks.tips,
    coupon: playbooks.auction_10y,
    bills: playbooks.bills,
    funding: playbooks.funding,
    holiday: playbooks.market,
    earlyClose: playbooks.market,
    marketCheck: playbooks.market,
  };
  return byKind[event.kind];
}

export const featuredPlaybookKeys = [
  "cpi", "jobs", "pce", "ppi", "retail", "gdp", "policy", "minutes",
  "jolts", "eci", "claims", "auction_10y", "auction_30y", "auction_belly", "auction_20y", "tips",
] as const;

export function playbookByKey(key: string): Playbook | undefined {
  return playbooks[key];
}
