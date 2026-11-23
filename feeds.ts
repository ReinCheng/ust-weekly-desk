import { cmeDataUrl, parseCme } from "./cme";
import { addDays, newYorkDate, realTenors, sourceIndex, tenors, type CurvePoint, type Kind, type MarketEvent, type Reading, type SourceId } from "./model";

export type PublicInputs = { pending?: unknown[]; results?: unknown[]; bls?: { month: string; html: string }[]; cme?: object };
export type Feed = { id: SourceId; events: MarketEvent[]; officialUpdate?: string; curve?: CurvePoint[]; partial?: boolean; unscheduled?: boolean };
export const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const headers = { "User-Agent": "Mozilla/5.0 (compatible; UST Weekly Desk public calendar)", Accept: "*/*" };
const pad = (value: string | number) => String(value).padStart(2, "0");
const iso = (year: string | number, month: string | number, date: string | number) => [year, pad(month), pad(date)].join("-");
export const textOf = (markup: string) => markup
  .replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&")
  .replace(/&#39;|&#x27;|&apos;/gi, "'").replace(/&rsquo;|&#8217;/gi, "’")
  .replace(/&ndash;|&#8211;/gi, "–").replace(/&mdash;|&#8212;/gi, "—").replace(/&quot;/g, '"')
  .replace(/\s+/g, " ").trim();
const contentOf = (html: string, pattern: RegExp) => textOf(html.match(pattern)?.[1] ?? "");
const slug = (str: string) => str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 110);
export const timeOf = (str: string) => {
  const match = str.match(/\b(\d{1,2}):(\d\d)\s*(a\.?m\.?|p\.?m\.?)?/i);
  if (!match) return null;
  const hours = +match[1];
  return pad(match[3] ? hours % 12 + (/^p/i.test(match[3]) ? 12 : 0) : hours) + ":" + match[2];
};
export function dateOf(str: string, fallback?: string) {
  const m = str.match(/\b([A-Z][a-z]+)\s+(\d{1,2})(?:,?\s+(20\d\d))?/);
  if (!m) return null;
  const month = months.findIndex(item => item === m[1] || item.slice(0, 3) === m[1]);
  return month >= 0 && (m[3] || fallback) ? iso(m[3] || fallback!, month + 1, m[2]) : null;
}
const cells = (row: string) => [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => textOf(cell[1]));
const rows = (html: string) => [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(item => item[1]);
const covered = (value: string, week: string) => value >= week && value <= addDays(week, 6);
const weekMonths = (week: string) => [...new Set([week.slice(0, 7), addDays(week, 6).slice(0, 7)])];
const weekYears = (week: string) => [...new Set([week.slice(0, 4), addDays(week, 6).slice(0, 4)])];

type PublicDocument = { html: string; modified?: string };
const documents = new Map<string, Promise<PublicDocument>>();

export function document(url: string): Promise<PublicDocument> {
  let request = documents.get(url);
  if (!request) {
    request = fetchDocument(url);
    documents.set(url, request);
  }
  return request;
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchDocument(url: string): Promise<PublicDocument> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(12000) });
      if (response.ok) {
        const modified = response.headers.get("Last-Modified");
        return { html: await response.text(), modified: modified ? newYorkDate(new Date(modified)) : undefined };
      }
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        throw new Error("Upstream HTTP " + response.status);
      }
      lastError = new Error("Upstream HTTP " + response.status);
    } catch (error) {
      lastError = error;
      if (error instanceof Error && /^Upstream HTTP 4\d\d$/.test(error.message) && !error.message.endsWith("429")) throw error;
    }
    if (attempt < 2) await pause(450 * (attempt + 1));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

const outcome = (kind: Kind, title: string, score: number) => ({ kind, title, score });
function classifyMacro(title: string) {
  if (/consumer price index|personal income and outlays/i.test(title)) return outcome("inflation", /consumer price/i.test(title) ? "美国 CPI" : "PCE 物价 / 个人收支", 5);
  if (/producer price index/i.test(title)) return outcome("ppi", "美国 PPI", 4);
  if (/employment situation/i.test(title)) return outcome("jobs", "美国非农就业", 5);
  if (/unemployment insurance weekly claims/i.test(title)) return outcome("claims", "初请失业金", 3);
  if (/job openings/i.test(title)) return outcome("jobs", "JOLTS 职位空缺", 4);
  if (/employment cost index/i.test(title)) return outcome("inflation", "就业成本指数（ECI）", 4);
  if (/advance monthly sales for retail/i.test(title)) return outcome("retail", "美国零售销售", 4);
  if (/^(?:real )?GDP\b|gross domestic product/i.test(title) && !/by county|by state|by metropolitan/i.test(title)) return outcome("growth", "美国 GDP", /advance/i.test(title) ? 4 : 3);
  if (/durable goods|new residential construction|new residential sales|international trade in goods and services|industrial production|advance economic indicators/i.test(title)) {
    const titleText = /durable goods/i.test(title) ? "耐用品订单初值" :
      /residential construction/i.test(title) ? "新屋开工与建筑许可" :
      /residential sales/i.test(title) ? "新屋销售" :
      /industrial production/i.test(title) ? "工业产出与产能利用率" :
      /advance economic indicators/i.test(title) ? "美国预估经济指标" : "美国商品和服务贸易";
    return outcome("growth", titleText, 3);
  }
  if (/import and export price/i.test(title)) return outcome("inflation", "美国进出口价格", 2);
  if (/productivity and costs/i.test(title)) return outcome("growth", "生产率与单位劳动成本", 3);
  if (/manufacturing and trade: inventories|monthly wholesale trade|state employment and unemployment/i.test(title)) {
    return outcome("growth", /wholesale/i.test(title) ? "批发销售与库存" : /state employment/i.test(title) ? "州就业与失业率" : "商业库存与销售", 2);
  }
  return null;
}

const buildMacro = (source: SourceId, date: string, time: string, detail: string, url: string, officialDate?: string) => {
  const item = classifyMacro(detail);
  if (!item) return null;
  const id = item.title === "美国商品和服务贸易"
    ? "macro-us-trade-" + date
    : [source, slug(item.title === "美国 GDP" ? detail.replace(/,?\s+(?:1st|2nd|3rd|4th) Quarter.*$/i, "") : detail), date].join("-");
  return { id, date, time, title: item.title, detail, category: "macro", kind: item.kind, impact: item.score,
    status: "confirmed", source, url, officialDate } satisfies MarketEvent;
};

export const blsUrl = (month: string) => "https://www.bls.gov/schedule/" + month.slice(0, 4) + "/" + month.slice(5) + "_sched_list.htm";
export function parseBls(html: string, month: string, week: string, url = blsUrl(month), modified?: string): Feed {
  const officialUpdate = dateOf(contentOf(html, /Last Modified Date:\s*(?:<[^>]+>\s*)*([^<]+)/i)) ?? modified;
  const events = rows(html).filter(row => row.includes("date-cell")).flatMap(row => {
    const [label, clock, detail] = cells(row);
    const date = dateOf(label ?? "");
    const time = timeOf(clock ?? "");
    const item = date && time && covered(date, week) && buildMacro("bls", date, time, detail, url, officialUpdate);
    return item ? [item] : [];
  });
  if (!html.includes("release-list") && !html.includes("date-cell")) throw new Error("Unrecognized BLS calendar");
  return { id: "bls", events, officialUpdate };
}
export const beaUrl = (year: string) => "https://www.bea.gov/news/schedule/full" + (year === newYorkDate().slice(0, 4) ? "" : "-" + year);
export function parseBea(html: string, year: string, week: string, modified?: string): Feed {
  const url = beaUrl(year);
  const update = contentOf(html, /Page last modified on ([^<]+)/i).match(/(\d+)\/(\d+)\/(\d{2,4})/);
  const officialUpdate = update ? iso(update[3].length === 2 ? "20" + update[3] : update[3], update[1], update[2]) : modified;
  if (!html.includes("release-schedule-table")) throw new Error("Unrecognized BEA calendar");
  const events = rows(html).filter(row => row.includes("release-date") && row.includes("release-title")).flatMap(row => {
    const [label, , detail] = cells(row);
    const date = dateOf(label ?? "", year);
    const time = timeOf(label ?? "");
    const item = date && time && covered(date, week) && buildMacro("bea", date, time, detail, url, officialUpdate);
    if (!item) return [];
    const article = row.match(/href="(\/news\/20\d\d\/[a-z0-9-]+)"/i)?.[1];
    return [{ ...item, resultUrl: article ? new URL(article, url).href : undefined }];
  });
  return { id: "bea", events, officialUpdate };
}
export const censusUrl = (year: string, suffix = true) => "https://www.census.gov/economic-indicators/calendar-listview" + (suffix ? "-" + year : "") + ".html";
export function parseCensus(html: string, year: string, week: string, modified?: string, url = censusUrl(year)): Feed {
  if (!html.includes('sorttable_customkey="' + year)) throw new Error("Census calendar year unavailable");
  const events = rows(html).filter(row => row.includes('sorttable_customkey="' + year)).flatMap(row => {
    const [name, label, clock, period] = cells(row);
    const date = dateOf(label ?? "");
    const time = timeOf(clock ?? "");
    const item = date && time && covered(date, week) && buildMacro("census", date, time, name + " · " + period, url, modified);
    return item ? [item] : [];
  });
  return { id: "census", events, officialUpdate: modified };
}

export const fedUrl = (month: string) => "https://www.federalreserve.gov/newsevents/" + month.slice(0, 4) + "-" + months[+month.slice(5) - 1].toLowerCase() + ".htm";
export function parseFed(html: string, month: string, week: string, modified?: string): Feed {
  const url = fedUrl(month);
  const sections = html.split(/<h4 class="col-md-12">\s*([^<]+)<\/h4>/gi);
  if (!html.includes("cal-nojs") || sections.length < 3) throw new Error("Unrecognized Federal Reserve calendar");
  const events: MarketEvent[] = [];
  for (let i = 1; i < sections.length; i += 2) {
    const section = sections[i].trim();
    if (!/Speeches|FOMC|Beige Book|Statistical Releases/i.test(section)) continue;
    const entries = sections[i + 1].matchAll(/<div class="col-xs-2">\s*<p[^>]*>([\s\S]*?)<\/p>\s*<\/div>\s*<div class="col-xs-7">([\s\S]*?)<\/div>\s*<div class="col-xs-3">\s*<p>([\s\S]*?)<\/p>/gi);
    for (const [, clock, body, dayString] of entries) {
      const time = timeOf(textOf(clock));
      const texts = [...body.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map(match => textOf(match[1])).filter(value => value && value !== "Watch Live");
      const name = texts[0];
      if (!name || !time || !/^\d{1,2}(\s*,\s*\d{1,2})*$/.test(textOf(dayString))) continue;
      for (const date of textOf(dayString).split(",").map(value => month + "-" + pad(value.trim()))) {
        if (!covered(date, week)) continue;
        if (/FOMC Press Conference/i.test(name)) {
          events.push({ id: "fed-press-conference-" + date, date, time, title: "FOMC 记者会", detail: "FOMC Press Conference · 关注政策阐释与问答",
            category: "fed", kind: "policy", impact: 4, status: "confirmed", source: "fed", url, officialDate: modified });
        } else if (/^FOMC Meeting$/i.test(name)) {
          events.push({ id: "fomc-decision-" + date, date, time, title: "FOMC 利率决议", detail: texts.slice(1).join(" · ") || "FOMC 政策声明",
            category: "fed", kind: "policy", impact: 5, status: "confirmed", source: "fed", url, officialDate: modified });
        } else if (/FOMC Minutes/i.test(name)) {
          events.push({ id: "fed-minutes-" + date, date, time, title: "FOMC 会议纪要", detail: texts.slice(1).join(" · ") || name,
            category: "fed", kind: "minutes", impact: 5, status: "confirmed", source: "fed", url, officialDate: modified });
        } else if (/Beige Book/i.test(name)) {
          events.push({ id: "fed-beige-" + date, date, time, title: "美联储褐皮书", detail: "Beige Book · 地区经济情况",
            category: "fed", kind: "speech", impact: 3, status: "confirmed", source: "fed", url, officialDate: modified });
        } else if (section === "Speeches") {
          const officialName = name.replace(/^(Speech|Discussion|Testimony|Remarks)\s*-\s*/i, "");
          const surname = officialName.trim().split(/\s+/).at(-1) ?? officialName;
          const topic = texts[1] ?? "";
          const policy = /economic outlook|U\.S\. economy|monetary policy|productivity|employment|inflation/i.test(topic) || /Chairman|^Chair /i.test(officialName);
          const speaker = officialName.replace(/^(Vice Chair for Supervision|Vice Chair|Chairman|Chair|Governor)\s+/i, "");
          events.push({ id: ["fed", slug(surname), date, time.replace(":", "")].join("-"), date, time, title: speaker + (/^Discussion/i.test(name) ? " 公开讨论" : " 公开讲话"),
            detail: topic ? topic + " · " + officialName : officialName, category: "fed", kind: policy ? "speech" : "technicalSpeech",
            impact: policy ? 3 : 2, status: "confirmed", source: "fed", url, officialDate: modified });
        } else if (/Industrial Production/i.test(name)) {
          const event = buildMacro("fed", date, time, name, url, modified);
          if (event) events.push(event);
        } else if (/H\.4\.1/.test(name)) {
          events.push({ id: "fed-h41-" + date, date, time, title: "美联储资产负债表 H.4.1", detail: "Factors Affecting Reserve Balances",
            category: "fed", kind: "funding", impact: 2, status: "confirmed", source: "fed", url, officialDate: modified });
        }
      }
    }
  }
  return { id: "fed", events, officialUpdate: modified };
}

export function parseFomc(html: string, week: string, modified?: string): Feed {
  const url = sourceIndex.fomc.url;
  const events: MarketEvent[] = [];
  const years = [...html.matchAll(/(20\d\d) FOMC Meetings\s*<\/a>/g)];
  if (!years.some(item => item[1] === week.slice(0, 4))) throw new Error("FOMC year unavailable");
  years.forEach((year, index) => {
    const section = html.slice(year.index, years[index + 1]?.index ?? html.length);
    for (const m of section.matchAll(/class="[^"]*fomc-meeting__month[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<div class="fomc-meeting__date[^"]*"[^>]*>([\s\S]*?)<\/div>/gi)) {
      const label = textOf(m[1]);
      const dateText = textOf(m[2]);
      const span = dateText.match(/^(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?(\*)?/);
      const month = months.indexOf(label);
      if (month < 0 || !span) continue;
      const start = iso(year[1], month + 1, span[1]);
      const end = iso(year[1], month + 1, span[2] ?? span[1]);
      const row = section.slice(m.index + m[0].length).split(/class="[^"]*fomc-meeting__month/)[0];
      const statement = row.match(/href="([^"]*\/pressreleases\/monetary\d{8}a\.htm)"/i)?.[1];
      const minutes = row.match(/\(Released\s+([A-Za-z]+\s+\d{1,2},\s+20\d\d)\)/);
      const minutesDate = minutes && dateOf(minutes[1]);
      const minutesHref = row.match(/href="([^"]*\/fomcminutes\d{8}\.htm)"/i)?.[1];
      if (covered(start, week) && start !== end) events.push({
        id: "fomc-start-" + start, date: start, time: null, title: "FOMC 政策会议开始", detail: "两天会议 · 决议发布日 " + end + (span[3] ? " · 含 SEP" : ""),
        category: "fed", kind: "policy", impact: 2, status: "confirmed", source: "fomc", url, officialDate: modified,
      });
      if (covered(end, week)) events.push({
        id: "fomc-decision-" + end, date: end, time: statement ? "14:00" : null, title: "FOMC 利率决议", detail: "政策声明" + (span[3] ? " · SEP 经济预测" : "") + " · 发布时刻以当月 Fed 日历为准",
        category: "fed", kind: "policy", impact: 5, status: "confirmed", source: "fomc", url: statement ? new URL(statement, url).href : url, officialDate: modified,
      });
      if (minutesDate && covered(minutesDate, week)) events.push({
        id: "fed-minutes-" + minutesDate, date: minutesDate, time: "14:00", title: "FOMC 会议纪要", detail: start + " 至 " + end + " 政策会议纪要",
        category: "fed", kind: "minutes", impact: 5, status: "confirmed", source: "fomc", url: minutesHref ? new URL(minutesHref, url).href : url, officialDate: modified,
      });
    }
  });
  return { id: "fomc", events, officialUpdate: modified };
}

const treasuryBase = "https://www.treasurydirect.gov/";
const treasuryPending = treasuryBase + "TA_WS/securities/pending?format=json";
const treasuryAuctioned = treasuryBase + "TA_WS/securities/auctioned?format=json&days=90";
export const tentativeXml = "https://home.treasury.gov/system/files/221/Tentative-Auction-Schedule.xml";
export const auctionNames = (term: string, type: string, tips = false, frn = false) => {
  const n = parseInt(term);
  const title = tips ? n + " 年期 TIPS 拍卖" : frn ? n + " 年期 FRN 拍卖" : type === "bill" ? n + " 周 T-bill 拍卖" : n + " 年期国债拍卖";
  const kind: Kind = tips ? "tips" : type === "bill" || frn ? "bills" : n >= 20 ? "longAuction" : "coupon";
  const score = tips ? 4 : type === "bill" || frn ? 2 : n >= 20 ? 5 : n >= 7 ? 4 : 3;
  const auctionKey = tips ? n + "y-tips" : frn ? n + "y-frn" : type === "bill" ? n + "w-bill" : n + "y-nominal";
  return { title, kind, score, auctionKey };
};

const pctShare = (part: unknown, total: number) => {
  const value = Number(part);
  if (!Number.isFinite(value) || value < 0 || !Number.isFinite(total) || total <= 0) return undefined;
  return Number(((value / total) * 100).toFixed(1));
};

export function parseTreasury(raw: unknown, week: string): Feed {
  if (!Array.isArray(raw) || (raw.length > 0 && !raw.some(item => item?.competitiveAuctionCloseDate))) throw new Error("Unrecognized TreasuryDirect auction feed");
  const events = new Map<string, MarketEvent>();
  let officialUpdate: string | undefined;
  for (const item of raw) {
    const date = String(item?.competitiveAuctionCloseDate ?? "").slice(0, 10);
    const time = timeOf(String(item.competitiveAuctionCloseTime ?? ""));
    const term = String(item.securityType === "Bill" ? item.securityTerm : item.originalSecurityTerm || item.securityTerm);
    if (!covered(date, week) || !time || !/^[0-9A-Z]{9}$/.test(item.cusip) || !/^\d+/.test(term)) continue;
    const officialDate = String(item.updatedTimestamp || item.announcementDate || "").slice(0, 10) || undefined;
    if (officialDate && (!officialUpdate || officialDate > officialUpdate)) officialUpdate = officialDate;
    const type = String(item.securityType).toLowerCase();
    const isTips = item.inflationProtected === "Yes";
    const isFrn = item.floatingRate === "Yes";
    const { title, kind, score, auctionKey } = auctionNames(term, type, isTips, isFrn);
    const amount = +item.offeringAmount / 1e9;
    const detail = [amount ? "$" + new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(amount) + "bn" : "", item.reopening === "Yes" ? "续发" : "新发", item.issueDate ? "结算 " + String(item.issueDate).slice(0, 10) : "", "CUSIP " + item.cusip].filter(Boolean).join(" · ");
    const announcement = /^A_[\d_]+\.pdf$/.test(item.treasuryOfferingAnnouncementPressReleaseFileName) ? item.treasuryOfferingAnnouncementPressReleaseFileName : "";
    const result = /^R_[\d_]+\.pdf$/.test(item.treasuryAuctionResultsPressReleaseFileName) ? item.treasuryAuctionResultsPressReleaseFileName : "";
    const pdf = (file: string) => treasuryBase + "instit/annceresult/press/preanre/" + file.slice(2, 6) + "/" + file;
    const stop = item.highYield || item.highDiscountMargin || item.highRate;
    const stopLabel = item.highDiscountMargin ? "最高折扣利差" : item.highRate ? "最高贴现率" : isTips ? "中标实际收益率" : "中标收益率";
    const stopNum = stop !== undefined && stop !== "" ? Number(stop) : NaN;
    const btcNum = item.bidToCoverRatio !== undefined && item.bidToCoverRatio !== "" ? Number(item.bidToCoverRatio) : NaN;
    const compTotal = Number(item.subtotalCompetitiveParAwardedInsideOfOfferingAmount || 0);
    const dealerShare = pctShare(item.primaryDealersCompetitiveParAwarded, compTotal);
    const indirectShare = pctShare(item.indirectBiddersCompetitiveParAwarded, compTotal);
    const directShare = pctShare(item.directBiddersCompetitiveParAwarded, compTotal);

    const readings: Reading[] | undefined = stop && result && Number.isFinite(stopNum) ? [
      { label: stopLabel, value: stopNum, unit: "%", digits: 3 },
      ...(Number.isFinite(btcNum) ? [{ label: "投标倍数", value: btcNum, unit: "×" as const, digits: 2 }] : []),
      ...(dealerShare !== undefined ? [{ label: "一级交易商", value: dealerShare, unit: "%" as const, digits: 1 }] : []),
      ...(indirectShare !== undefined ? [{ label: "间接投标", value: indirectShare, unit: "%" as const, digits: 1 }] : []),
      ...(directShare !== undefined ? [{ label: "直接投标", value: directShare, unit: "%" as const, digits: 1 }] : []),
    ] : undefined;

    const actual = stop && result ? [
      stopLabel + " " + stop + "%",
      item.bidToCoverRatio ? "投标倍数 " + item.bidToCoverRatio + "×" : "",
      dealerShare !== undefined && indirectShare !== undefined ? "Dealer " + dealerShare.toFixed(1) + "% / 间接 " + indirectShare.toFixed(1) + "%" : "",
    ].filter(Boolean).join(" · ") : undefined;
    const id = "tsy-" + auctionKey + "-" + date;
    const existing = events.get(id);
    if (!existing || actual || !existing.actual) events.set(id, { id, date, time, title, detail, category: "auction", kind, impact: score, status: "confirmed", source: "treasury",
      url: announcement ? pdf(announcement) : sourceIndex.treasury.url, officialDate, actual, readings, resultUrl: result ? pdf(result) : undefined, auctionKey });
  }
  return { id: "treasury", events: [...events.values()], officialUpdate };
}

const holidayNames: Record<string, string> = {
  "new year": "元旦", "martin luther king": "马丁·路德·金纪念日", "presidents": "总统日", "washington": "总统日",
  "good friday": "耶稣受难日", "memorial": "阵亡将士纪念日", "juneteenth": "六月节", "independence": "独立日",
  "labor": "劳动节", "columbus": "哥伦布日", "veterans": "退伍军人节", "thanksgiving": "感恩节", "christmas": "圣诞节",
};
export function holidayEvent(source: "sifma" | "nyse" | "cme", label: string, date: string, time: string | null, officialDate?: string): MarketEvent {
  const name = Object.entries(holidayNames).find(([key]) => label.toLowerCase().includes(key))?.[1] ?? label;
  const session = source === "sifma" ? "UST 现券" : source === "nyse" ? "NYSE" : "CME 利率期货";
  const kind = source === "cme" ? "marketCheck" : time ? "earlyClose" : "holiday";
  const sep = source === "nyse" ? " " : "";
  const title = source === "cme" ? "CME 利率期货节假日时段" : session + sep + (time ? "提前收市" : "休市");
  const detail = label + " · " + name + (source === "sifma" ? " · SIFMA 建议" : source === "nyse" ? " · 股票常规时段" : " · 合约截点待核对");
  return { id: source + "-" + date, date, time, title, detail, category: "market", kind, impact: source === "sifma" ? 4 : source === "cme" ? 3 : 2,
    status: source === "cme" ? "tentative" : "confirmed", source, url: sourceIndex[source].url, officialDate };
}
export function parseSifma(html: string, week: string, modified?: string): Feed {
  const section = html.split("U.S. Holiday Recommendations</h2>")[1]?.split("U.K. Holiday Recommendations</h2>")[0];
  if (!section || !section.includes("<h3")) throw new Error("SIFMA US calendar unavailable");
  const events: MarketEvent[] = [];
  for (const entry of section.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>\s*<span\b[^>]*>([\s\S]*?)<\/span>\s*<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const label = textOf(entry[1]);
    const date = dateOf(textOf(entry[2]));
    const early = textOf(entry[3]);
    const earlyDate = dateOf(early);
    if (date && covered(date, week)) events.push(holidayEvent("sifma", label, date, null, modified));
    const time = timeOf(early);
    if (earlyDate && time && covered(earlyDate, week)) events.push(holidayEvent("sifma", label, earlyDate, time, modified));
  }
  return { id: "sifma", events, officialUpdate: modified };
}
export function parseNyse(html: string, week: string, modified?: string): Feed {
  const table = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].find(match => /<th[^>]*>\s*(?:<[^>]+>\s*)*Holiday/.test(match[1]));
  if (!table) throw new Error("NYSE holiday table unavailable");
  const [head, ...body] = rows(table[1]).map(cells);
  const years = weekYears(week).filter(year => head.includes(year));
  if (!years.length) throw new Error("NYSE holiday year unavailable");
  const events: MarketEvent[] = [];
  for (const year of years) {
    for (const [label, ...dates] of body) {
      const date = dateOf(dates[head.indexOf(year) - 1] ?? "", year);
      if (date && covered(date, week)) events.push(holidayEvent("nyse", label, date, null, modified));
    }
  }
  const early = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(match => textOf(match[1])).filter(line => /Each market will close early at/.test(line));
  for (const line of early) {
    const time = timeOf(line);
    if (!time) continue;
    for (const match of line.matchAll(/\b([A-Z][a-z]+ \d{1,2}, 20\d\d)\b/g)) {
      const date = dateOf(match[1]);
      const label = /Thanksgiving/i.test(line) ? "Thanksgiving Day" : /Christmas|December/i.test(match[1]) ? "Christmas Day" : "Independence Day";
      if (date && covered(date, week)) events.push(holidayEvent("nyse", label, date, time, modified));
    }
  }
  return { id: "nyse", events, officialUpdate: modified };
}

const curveNames = ["3month", "1year", "2year", "3year", "5year", "7year", "10year", "20year", "30year"];
const realCurveNames = ["5year", "7year", "10year", "20year", "30year"];
export const curveUrl = (month: string) => sourceIndex.curve.url + "&field_tdr_date_value_month=" + month.replace("-", "");
export const realCurveUrl = (month: string) =>
  "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_real_yield_curve&field_tdr_date_value_month=" + month.replace("-", "");

export function parseCurve(html: string, week: string): CurvePoint[] {
  if (!html.includes("view-field-bc-10year-table-column")) throw new Error("Treasury yield curve table unavailable");
  return rows(html).flatMap(row => {
    const date = row.match(/<time datetime="(20\d\d-\d\d-\d\d)T/i)?.[1];
    if (!date || date < addDays(week, -7) || date > addDays(week, 6) || date > newYorkDate()) return [];
    const values = curveNames.map(tenor => {
      const value = contentOf(row, new RegExp('headers="view-field-bc-' + tenor + '-table-column"[^>]*>([^<]+)', "i"));
      return value ? Number(value) : NaN;
    });
    return values.length === tenors.length && values.every(Number.isFinite) ? [{ date, values }] : [];
  });
}

export function parseRealCurve(html: string, week: string): Map<string, number[]> {
  const result = new Map<string, number[]>();
  if (!html.includes("view-field-tc-10year-table-column")) return result;
  for (const row of rows(html)) {
    const date = row.match(/<time datetime="(20\d\d-\d\d-\d\d)T/i)?.[1];
    if (!date || date < addDays(week, -7) || date > addDays(week, 6) || date > newYorkDate()) continue;
    const values = realCurveNames.map(tenor => {
      const value = contentOf(row, new RegExp('headers="view-field-tc-' + tenor + '-table-column"[^>]*>([^<]+)', "i"));
      return value ? Number(value) : NaN;
    });
    if (values.length === realTenors.length && values.every(Number.isFinite)) result.set(date, values);
  }
  return result;
}

const combine = (id: SourceId, parts: Feed[]): Feed => ({
  id, events: parts.flatMap(part => part.events), officialUpdate: parts.map(part => part.officialUpdate ?? "").sort().at(-1) || undefined,
  curve: parts.flatMap(part => part.curve ?? []),
  unscheduled: parts.length > 0 && parts.every(part => part.unscheduled),
});
export const blsIcsUrl = "https://www.bls.gov/schedule/news_release/bls.ics";

export function parseBlsIcs(ics: string, week: string, modified?: string): Feed {
  if (!ics.includes("BEGIN:VCALENDAR") || !ics.includes("Bureau of Labor Statistics")) throw new Error("BLS calendar subscription unavailable");
  const events = ics.replace(/\r?\n[ \t]/g, "").split("BEGIN:VEVENT").flatMap(entry => {
    const dt = entry.match(/^DTSTART;TZID=(?:US-Eastern|America\/New_York):(20\d{2})(\d{2})(\d{2})T(\d{2})(\d{2})/m);
    const detail = entry.match(/^SUMMARY:(.+)$/m)?.[1]?.trim();
    if (!dt || !detail) return [];
    const date = iso(dt[1], dt[2], dt[3]);
    if (!covered(date, week)) return [];
    const event = buildMacro("bls", date, dt[4] + ":" + dt[5], detail, blsIcsUrl, modified);
    return event ? [event] : [];
  });
  return { id: "bls", events, officialUpdate: modified };
}

async function treasuryFeed(week: string, supplied?: PublicInputs) {
  const inputs = [supplied?.pending, supplied?.results];
  const feeds = await Promise.allSettled([treasuryPending, treasuryAuctioned].map((url, i) =>
    inputs[i] ? Promise.resolve(inputs[i]) : document(url).then(data => JSON.parse(data.html))));
  const tables = feeds.flatMap(part => part.status === "fulfilled" && Array.isArray(part.value) ? [part.value] : []);
  for (const failure of feeds) if (failure.status === "rejected") console.warn("TreasuryDirect source refresh", String(failure.reason));
  if (!tables.length) throw new Error("TreasuryDirect feeds unavailable");
  return { ...parseTreasury(tables.flat(), week), partial: tables.length < feeds.length };
}

export function publicFeeds(week: string, supplied?: PublicInputs): [SourceId, Promise<Feed>][] {
  const currentMonth = newYorkDate().slice(0, 7);
  const sifma = document(sourceIndex.sifma.url).then(data => parseSifma(data.html, week, data.modified));
  const monthCalendars = weekMonths(week).map(async month => {
    const input = supplied?.bls?.find(entry => entry.month === month);
    if (input) return parseBls(input.html, month, week);
    const data = await document(blsUrl(month));
    return parseBls(data.html, month, week, undefined, data.modified);
  });
  const allBlsSupplied = weekMonths(week).every(month => supplied?.bls?.some(entry => entry.month === month));
  const alternateBls = allBlsSupplied ? [] : [
    Promise.all(weekYears(week).map(year => {
      const url = "https://www.bls.gov/schedule/" + year + "/home.htm";
      return document(url).then(data => parseBls(data.html, year + "-01", week, url, data.modified));
    })).then(parts => combine("bls", parts)),
    document(blsIcsUrl).then(data => parseBlsIcs(data.html, week, data.modified)),
  ];
  return [
    ["treasury", treasuryFeed(week, supplied)],
    ["tentative", document(tentativeXml).then(data => parseTentative(data.html, week, data.modified))],
    ["bls", Promise.allSettled([
      Promise.all(monthCalendars).then(parts => combine("bls", parts)),
      ...alternateBls,
    ]).then(parts => {
      const success = parts.find(part => part.status === "fulfilled");
      if (!success || success.status !== "fulfilled") {
        for (const failure of parts) if (failure.status === "rejected") console.warn("BLS source refresh", String(failure.reason));
        throw new Error("BLS calendars unavailable");
      }
      return success.value;
    })],
    ["bea", Promise.all(weekYears(week).map(year => document(beaUrl(year)).then(data => parseBea(data.html, year, week, data.modified)))).then(parts => combine("bea", parts))],
    ["census", Promise.all(weekYears(week).map(async year => {
      try {
        const data = await document(censusUrl(year));
        return parseCensus(data.html, year, week, data.modified);
      } catch {
        const url = censusUrl(year, false);
        const data = await document(url);
        return parseCensus(data.html, year, week, data.modified, url);
      }
    })).then(parts => combine("census", parts))],
    ["fed", Promise.all(weekMonths(week).map(async month => {
      try {
        const data = await document(fedUrl(month));
        return parseFed(data.html, month, week, data.modified);
      } catch (error) {
        if (month > currentMonth) return { id: "fed" as const, events: [], unscheduled: true };
        throw error;
      }
    })).then(parts => combine("fed", parts))],
    ["fomc", document(sourceIndex.fomc.url).then(data => parseFomc(data.html, week, data.modified))],
    ["dol", document(dolUrl).then(data => parseDol(data.html, week, data.modified))],
    ["sifma", sifma],
    ["nyse", document(sourceIndex.nyse.url).then(data => parseNyse(data.html, week, data.modified))],
    ["cme", Promise.allSettled([
      sifma,
      supplied?.cme ? Promise.resolve({ html: JSON.stringify(supplied.cme), modified: undefined }) : document(cmeDataUrl(week, addDays(week, 6))),
    ]).then(([sifmaResult, cmeResult]) => {
      if (cmeResult.status !== "fulfilled") throw cmeResult.reason;
      const holidays = sifmaResult.status === "fulfilled" ? sifmaResult.value.events.filter(event => event.kind === "holiday").map(event => event.date) : [];
      const data = cmeResult.value;
      return parseCme(JSON.parse(data.html), week, addDays(week, 6), data.modified, holidays);
    })],
    ["curve", Promise.allSettled([...new Set([...weekMonths(week), addDays(week, -7).slice(0, 7)])].map(async month => {
      if (month > currentMonth) return { id: "curve" as const, events: [], curve: [] };
      const [nominalRes, realRes] = await Promise.allSettled([document(curveUrl(month)), document(realCurveUrl(month))]);
      if (nominalRes.status !== "fulfilled") throw nominalRes.reason;
      const realMap = realRes.status === "fulfilled" ? parseRealCurve(realRes.value.html, week) : new Map<string, number[]>();
      const curve = parseCurve(nominalRes.value.html, week).map(point => {
        const real = realMap.get(point.date);
        return real ? { ...point, real } : point;
      });
      return { id: "curve" as const, events: [], curve, officialUpdate: curve.at(-1)?.date };
    })).then(results => {
      const parts = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
      if (!parts.length) throw new Error("Treasury yield curve unavailable");
      return { ...combine("curve", parts), partial: parts.length < results.length };
    })],
  ];
}

export const dolUrl = sourceIndex.dol.url;
export function parseDol(html: string, week: string, modified?: string): Feed {
  if (!/Publication Schedule:[\s\S]{0,180}Thursday morning at 8:30am/i.test(html)) throw new Error("DOL claims schedule unavailable");
  const table = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].find(match => /Release Date[\s\S]*?Release Time/.test(match[1]));
  if (!table) throw new Error("DOL holiday exceptions unavailable");
  const exception = rows(table[1]).map(cells).map(([label, clock]) => ({ date: dateOf(label ?? ""), time: timeOf(clock ?? "") }))
    .find(item => item.date && covered(item.date, week));
  const date = exception?.date ?? addDays(week, 3);
  const time = exception?.time ?? "08:30";
  const officialUpdate = dateOf(contentOf(html, /Updated:\s*([^<]+)/i)) ?? modified;
  const event: MarketEvent = { id: "dol-claims-" + date, date, time, title: "初请失业金",
    detail: "Unemployment Insurance Weekly Claims" + (exception ? " · 节假日调整" : " · 劳工部每周日程"),
    category: "macro", kind: "claims", impact: 3, status: "confirmed", source: "dol", url: dolUrl, officialDate: officialUpdate };
  return { id: "dol", events: [event], officialUpdate };
}

export function parseTentative(xml: string, week: string, modified?: string): Feed {
  if (!xml.includes("<AuctionCalendarDate>")) throw new Error("Treasury tentative XML unavailable");
  const get = (block: string, key: string) => contentOf(block, new RegExp("<" + key + ">([^<]*)</" + key + ">"));
  const starts = get(xml, "StartDate");
  const ends = get(xml, "EndDate");
  if (!starts || !ends || addDays(week, 6) < starts || week > ends) throw new Error("Week outside the current tentative issue calendar");
  const events: MarketEvent[] = [];
  for (const [, block] of xml.matchAll(/<AuctionCalendarDate>([\s\S]*?)<\/AuctionCalendarDate>/g)) {
    const date = get(block, "AuctionDate");
    const term = get(block, "SecurityTermWeekYear");
    if (!covered(date, week) || !/^\d+/.test(term)) continue;
    const type = get(block, "SecurityType").toLowerCase();
    const { title, kind, score, auctionKey } = auctionNames(term, type, type === "tips" || get(block, "TIPS") === "Y", type === "frn" || get(block, "FloatingRate") === "Y");
    const announcement = get(block, "AnnouncementDate");
    const settle = get(block, "SettlementDate");
    const detail = ["财政部暂定表", announcement && "预计公告 " + announcement, settle && "预计结算 " + settle].filter(Boolean).join(" · ");
    events.push({ id: "tsy-" + auctionKey + "-" + date, date, time: null, title, detail, category: "auction", kind, impact: score,
      status: "tentative", source: "tentative", url: sourceIndex.tentative.url, officialDate: modified, auctionKey });
  }
  return { id: "tentative", events, officialUpdate: modified };
}
