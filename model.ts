export const categories = {
  macro: "经济数据",
  auction: "国债拍卖",
  fed: "美联储",
  market: "交易时段",
} as const;

export const sourceIndex = {
  treasury: { name: "TreasuryDirect", detail: "已公告拍卖、竞争性截标和官方结果", url: "https://www.treasurydirect.gov/auctions/upcoming/" },
  tentative: { name: "U.S. Treasury · 暂定拍卖", detail: "季度暂定发行表，正式公告后更新状态", url: "https://home.treasury.gov/system/files/221/Tentative-Auction-Schedule.pdf" },
  bls: { name: "BLS · 美国劳工统计局", detail: "CPI、PPI、非农、JOLTS、ECI 等", url: "https://www.bls.gov/schedule/" },
  bea: { name: "BEA · 美国经济分析局", detail: "GDP、PCE 与主要国民账户数据", url: "https://www.bea.gov/news/schedule" },
  census: { name: "U.S. Census Bureau", detail: "零售销售、住房、耐用品、贸易等", url: "https://www.census.gov/economic-indicators/calendar-listview.html" },
  fed: { name: "Federal Reserve Board", detail: "理事公开讲话、纪要、褐皮书、工业产出", url: "https://www.federalreserve.gov/newsevents/calendar.htm" },
  fomc: { name: "FOMC · 会议日历", detail: "政策会议、决议、纪要与记者会", url: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm" },
  dol: { name: "U.S. Department of Labor", detail: "失业救济申请发布记录", url: "https://oui.doleta.gov/unemploy/claims_arch.asp" },
  sifma: { name: "SIFMA · 美国固收", detail: "美元固收休市及提前收市建议", url: "https://www.sifma.org/resources/guidelines/holiday-schedule" },
  nyse: { name: "NYSE · 股票市场", detail: "股票常规交易时段、休市和提前收市", url: "https://www.nyse.com/trade/hours-calendars" },
  cme: { name: "CME Globex · 利率期货", detail: "按产品及日期查 Treasury futures 节假日时段", url: "https://www.cmegroup.com/trading-hours.html#trading-holiday-hours" },
  curve: { name: "U.S. Treasury · Par Yield Curve", detail: "官方日终平价收益率", url: "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve" },
} as const;

export type SourceId = keyof typeof sourceIndex;
export type Category = keyof typeof categories;
export type Kind = "inflation" | "ppi" | "jobs" | "claims" | "retail" | "growth" | "policy" | "minutes" | "speech" | "technicalSpeech" | "longAuction" | "tips" | "coupon" | "bills" | "holiday" | "earlyClose" | "marketCheck" | "funding";
export type Reading = { label: string; value: number; unit: "%" | "千人" };
export type Reference = { value: number; period: string; asOf: string };
export type MarketEvent = {
  id: string;
  date: string;
  time: string | null;
  title: string;
  detail: string;
  category: Category;
  kind: Kind;
  impact: number;
  status: "confirmed" | "tentative";
  source: SourceId;
  url: string;
  officialDate?: string;
  actual?: string;
  readings?: Reading[];
  reference?: Reference;
  resultUrl?: string;
  auctionKey?: string;
};

export type SourceCheck = {
  id: SourceId;
  state: "verified" | "cached" | "unavailable" | "reference";
  checkedAt: string | null;
  officialUpdate?: string;
  count: number;
};

export const tenors = ["2Y", "3Y", "5Y", "7Y", "10Y", "20Y", "30Y"] as const;
export type CurvePoint = { date: string; values: number[] };
export type Calendar = { week: string; refreshedAt: string | null; events: MarketEvent[]; sources: SourceCheck[]; curve: CurvePoint[] };
export type DeskItem = { id: string; kind: "star" | "task" | "note"; body: string; event: string | null; done: number; updated: string };
export type VersionSummary = { id: string; week: string; title: string; created: string };
export type Version = VersionSummary & { calendar: Calendar; items: DeskItem[]; scenarios?: Scenario[]; impactAnalysis?: Partial<Record<Kind, string[]>> };
export type Scenario = { id: string; title: string; impact: number; detail: string; trigger: string; invalidation: string; kind: Kind; events: string[] };

const day = 86400000;
export const newYorkDate = (date = new Date()) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
}).format(date);
export const newYorkTime = (date: Date) => new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
}).format(date);
export const addDays = (date: string, shift: number) => new Date(Date.parse(date + "T12:00:00Z") + day * shift).toISOString().slice(0, 10);
export const weekOf = (date: string) => addDays(date, -((new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7));
export const todayWeek = () => weekOf(newYorkDate());
export const isWeek = (date: unknown): date is string => {
  if (typeof date !== "string" || !/^20\d\d-\d\d-\d\d$/.test(date)) return false;
  const stamp = Date.parse(date + "T12:00:00Z");
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === date && weekOf(date) === date;
};
export const weekNumber = (date: string) => {
  const thursday = addDays(date, 3);
  return 1 + Math.floor((Date.parse(thursday) - Date.parse(thursday.slice(0, 4) + "-01-01")) / (7 * day));
};
export const timeSort = (a: MarketEvent, b: MarketEvent) => {
  const eventTime = (item: MarketEvent) => item.time ?? (item.kind === "holiday" || (item.source === "cme" && item.status === "confirmed") ? "00:00" : "99:99");
  return a.date.localeCompare(b.date) || eventTime(a).localeCompare(eventTime(b)) || b.impact - a.impact || a.title.localeCompare(b.title);
};
export const impactSort = (a: MarketEvent, b: MarketEvent) => b.impact - a.impact || timeSort(a, b);
export const impactText = (n: number) => n >= 4 ? "高影响" : n >= 3 ? "中影响" : "低影响";
export const sourceKeys = Object.keys(sourceIndex) as SourceId[];
export const isPastEvent = (item: MarketEvent, now = new Date()) => {
  const date = newYorkDate(now);
  return item.date < date || (item.date === date && item.time !== null && item.time <= newYorkTime(now));
};
