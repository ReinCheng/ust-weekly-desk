import { dateOf, document, months, textOf } from "./feeds";
import { isPastEvent, newYorkDate, type MarketEvent, type Reading, type Reference } from "./model";

export const nowcastUrl = "https://www.clevelandfed.org/indicators-and-data/inflation-nowcasting";

const percent = (label: string, value: number | undefined, signed = false): Reading[] =>
  value === undefined ? [] : [{ label, value, unit: "%", ...(signed ? { signed: true } : {}) }];
const millions = (label: string, value: number | undefined): Reading[] =>
  value === undefined ? [] : [{ label, value, unit: "百万", digits: 1 }];
const figure = (value: string | undefined) => {
  if (!value) return undefined;
  const number = Number(value.replaceAll(",", ""));
  return Number.isFinite(number) ? number : undefined;
};
const signed = (verb: string | undefined, digits: string | undefined) => {
  const number = figure(digits);
  return number === undefined ? undefined : /decreased|declined|fell|dropped|down/i.test(verb ?? "") ? -Math.abs(number) : number;
};
const moveVerb = "(increased|rose|advanced|climbed|moved up|edged up|inched up|decreased|declined|fell|dropped|moved down|edged down|inched down)";
const moveRe = new RegExp("\\b" + moveVerb + "\\s+(?:by\\s+)?(?:at an annual rate of\\s+)?([+-]?\\d+(?:\\.\\d+)?)\\s*percent", "i");
const percentMove = (text: string, subject: RegExp) => {
  const clause = text.match(subject)?.[0];
  if (!clause) return undefined;
  const match = clause.match(moveRe);
  if (match) return signed(match[1], match[2]);
  if (/\b(?:was|were|remained)\s+unchanged\b/i.test(clause)) return 0;
  return undefined;
};
const sent = (prefix: string, length = 110) => new RegExp(prefix + "(?:[^.]|\\.\\d){0," + length + "}", "i");

export type BlsKind = "cpi" | "ppi" | "empsit" | "jolts" | "eci" | "prod2";

export function parseBlsReadings(kind: BlsKind, html: string): Reading[] {
  const release = html.match(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi)?.slice(0, 3).join(" ") ?? html;
  const intro = textOf(release).slice(0, 15500);
  if (kind === "cpi") {
    const coreYoy = percentMove(intro, /(?:The\s+)?all items less food and energy index\s+(?:[^.]|\.\d){0,75}?(?:12 months|over the (?:last )?year)/i);
    const headlineYoy = percentMove(intro, /Over the last 12 months,\s+the all items index\s+(?:[^.]|\.\d){0,75}/i)
      ?? percentMove(intro, /The all items index\s+(?:[^.]|\.\d){0,75}?(?:12 months|over the (?:last )?year)/i);
    return [
      ...percent("核心 CPI 月率", percentMove(intro, sent("The index for all items less food and energy", 75)), true),
      ...percent("整体 CPI 月率", percentMove(intro, sent("The Consumer Price Index for All Urban Consumers", 105)), true),
      ...percent("住房月率", percentMove(intro, sent("(?:The index for shelter|The shelter index)", 55)), true),
      ...percent("核心 CPI 同比", coreYoy),
      ...percent("整体 CPI 同比", headlineYoy),
    ];
  }
  if (kind === "ppi") {
    const headlineMom = percentMove(intro, sent("The Producer Price Index for final demand", 75));
    const coreMom = percentMove(intro, /(?:The index|Prices) for final demand less foods?, energy, and trade services\s+(?:[^.]|\.\d){0,65}?\bin\s+[A-Z][a-z]+/i);
    const headlineYoy = percentMove(intro, /the index for final demand\s+(?:[^.]|\.\d){0,55}?for the 12 months ended/i);
    const coreYoy = percentMove(intro, /For the 12 months ended\s+[A-Za-z\s]+,\s*(?:the index|prices) for final demand less foods?, energy, and trade services\s+(?:[^.]|\.\d){0,55}/i);
    return [
      ...percent("最终需求 PPI 月率", headlineMom, true),
      ...percent("剔除食能贸 PPI 月率", coreMom, true),
      ...percent("最终需求 PPI 同比", headlineYoy),
      ...percent("剔除食能贸 PPI 同比", coreYoy),
    ];
  }
  if (kind === "jolts") {
    const openings = figure(intro.match(/job openings[^.!?]{0,75}?(\d+(?:\.\d+)?)\s*million/i)?.[1]);
    const hires = figure(intro.match(/Hires[^.!?]{0,65}?(\d+(?:\.\d+)?)\s*million/i)?.[1]);
    const quits = figure(intro.match(/quits\s*\((\d+(?:\.\d+)?)\s*million\)|quits[^.!?]{0,55}?(\d+(?:\.\d+)?)\s*million/i)?.slice(1).find(Boolean));
    return [
      ...millions("职位空缺", openings),
      ...millions("招聘人数", hires),
      ...millions("主动离职", quits),
    ];
  }
  if (kind === "eci") {
    const qoq = percentMove(intro, /Compensation costs for civilian workers\s+(?:[^.]|\.\d){0,90}?for the 3-month period/i);
    const wagesQoq = percentMove(intro, /Wages and salaries\s+(?:[^.]|\.\d){0,75}?from\s+[A-Z][a-z]+\s+20\d\d/i);
    const yoy = percentMove(intro, /Compensation costs for civilian workers\s+(?:[^.]|\.\d){0,105}?for the 12-month period/i);
    return [
      ...percent("就业成本指数季率", qoq, true),
      ...percent("薪资季率", wagesQoq, true),
      ...percent("就业成本指数同比", yoy),
    ];
  }
  if (kind === "prod2") {
    const prod = percentMove(intro, sent("Nonfarm business sector labor productivity", 75));
    const ulc = percentMove(intro, sent("Unit labor costs in the nonfarm business sector", 75));
    return [
      ...percent("非农生产率折年率", prod, true),
      ...percent("单位劳动成本 ULC", ulc, true),
    ];
  }
  const lead = intro.slice(0, 1400);
  const payrollVerb = lead.match(/(?:Total )?nonfarm payroll employment\s+(increased|rose|advanced|climbed|moved up|edged up|decreased|declined|fell|dropped|moved down|edged down)\s+(?:by\s+)?([+-]?\d[\d,]*)/i);
  const payrollParen = lead.match(/(?:Total |Both )?nonfarm payroll employment\s*\(([+-]?\d[\d,]*)\)/i)
    ?? lead.match(/(?:Total )?nonfarm payroll employment\s+(?:was\s+)?(?:changed little|little changed)\s*\(([+-]?\d[\d,]*)\)/i);
  const flat = /(?:Total )?nonfarm payroll employment\s+(?:was|remained) unchanged\b/i.test(lead);
  const employment = flat ? 0 : payrollVerb ? signed(payrollVerb[1], payrollVerb[2]) : payrollParen ? figure(payrollParen[1]) : undefined;
  const unempMatch = lead.match(/the unemployment rate\s*(?:\((\d(?:\.\d+)?)\s*percent\)|,\s*at\s+(\d(?:\.\d+)?)\s*percent|(?:[^.!?]|\.\d){0,45}?(?:to|at|was|of)\s+(\d(?:\.\d+)?)\s*percent)/i);
  const unemployment = figure(unempMatch?.slice(1).find(Boolean));
  const wages = intro.match(/average hourly earnings for all employees(?:[^.]|\.\d){0,115}?(increased|rose|advanced|moved up|edged up|decreased|declined|fell|moved down|edged down)(?:[^.]|\.\d){0,75}?\bor\s+(\d+(?:\.\d+)?)\s*percent/i);
  const wagesFlat = /average hourly earnings for all employees(?:[^.]|\.\d){0,115}?(?:was|were|remained)\s+unchanged\b/i.test(intro);
  const wageMove = wages ? signed(wages[1], wages[2]) : wagesFlat ? 0 : undefined;
  const wageYoy = percentMove(intro, sent("Over the (?:year|past 12 months),\\s+average hourly earnings", 70));
  const revisions = [...intro.matchAll(/was revised (up|down) by ([\d,]+), from [+-]?[\d,]+ to [+-]?[\d,]+/gi)].slice(0, 2);
  const netChange = revisions.reduce((sum, match) => sum + (match[1].toLowerCase() === "down" ? -1 : 1) * Number(match[2].replaceAll(",", "")), 0);
  return [
    ...(employment === undefined ? [] : [{ label: "非农新增就业", value: employment / 1000, unit: "千人" as const, signed: true }]),
    ...percent("失业率", unemployment),
    ...percent("平均时薪月率", wageMove, true),
    ...percent("平均时薪同比", wageYoy),
    ...(revisions.length === 2 ? [{ label: "前两月非农合计修订", value: netChange / 1000, unit: "千人" as const, signed: true }] : []),
  ];
}

export function parseBeaReadings(kind: "pce" | "gdp", html: string): Reading[] {
  const paragraphs = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(match => textOf(match[1]));
  if (kind === "pce") {
    const monthly = paragraphs.find(p => /(?:from the (?:preceding|previous) month|from (?:[A-Z][a-z]+) to (?:[A-Z][a-z]+)),? the PCE price index/i.test(p)) ?? "";
    const yearly = paragraphs.find(p => /from the same month one year ago,? the PCE price index/i.test(p)) ?? "";
    const realPce = paragraphs.find(p => /^Real PCE\b/i.test(p)) ?? "";
    const realMatch = realPce.match(/^Real PCE\s+(increased|decreased|declined|fell|rose)[^()]{0,60}\(\s*(?:less than\s+)?(\d+(?:\.\d+)?)\s*percent/i);
    const realVal = realMatch
      ? (/less than\s+0\.1/i.test(realMatch[0]) ? 0 : signed(realMatch[1], realMatch[2]))
      : /\bunchanged\b/i.test(realPce) ? 0 : undefined;
    return [
      ...percent("核心 PCE 月率", percentMove(monthly, sent("Excluding food and energy, the PCE price index", 68)), true),
      ...percent("整体 PCE 月率", percentMove(monthly, sent("the PCE price index", 78)), true),
      ...percent("核心 PCE 同比", percentMove(yearly, sent("Excluding food and energy, the PCE price index", 68))),
      ...percent("整体 PCE 同比", percentMove(yearly, sent("the PCE price index", 78))),
      ...percent("实际消费月率", realVal, true),
    ];
  }
  const lead = paragraphs.find(p => /^Real gross domestic product \(GDP\)/i.test(p)) ?? "";
  const demand = paragraphs.find(p => /^Real final sales to private domestic purchasers/i.test(p)) ?? "";
  const prices = paragraphs.find(p => /PCE price index,?\s*excluding food and energy/i.test(p)) ?? "";
  return [
    ...percent("实际 GDP 季环比折年率", percentMove(lead, sent("Real gross domestic product", 110)), true),
    ...percent("私人国内最终销售折年率", percentMove(demand, sent("Real final sales to private domestic purchasers", 160)), true),
    ...percent("季度核心 PCE 折年率", percentMove(prices, sent("PCE price index,?\\s*excluding food and energy", 75)), true),
  ];
}

function blsType(event: MarketEvent): BlsKind | undefined {
  if (event.title === "美国 CPI") return "cpi";
  if (event.title === "美国 PPI") return "ppi";
  if (event.title === "美国非农就业") return "empsit";
  if (event.title === "JOLTS 职位空缺") return "jolts";
  if (event.title === "就业成本指数（ECI）") return "eci";
  if (event.title === "生产率与单位劳动成本") return "prod2";
}

function beaType(event: MarketEvent) {
  if (event.title.startsWith("PCE")) return "pce";
  if (event.title === "美国 GDP") return "gdp";
}

export function matchesBlsDate(html: string, expected: string) {
  const intro = textOf(html.match(/<pre\b[^>]*>([\s\S]*?)<\/pre>/i)?.[1] ?? html).slice(0, 2000);
  const stamp = intro.match(/\(ET\)\s+\w+,\s+([A-Z][a-z]+ \d{1,2}, 20\d\d)/)?.[1];
  return stamp && dateOf(stamp) === expected;
}

async function blsReadings(event: MarketEvent, kind: BlsKind) {
  const [year, month, day] = event.date.split("-");
  const base = "https://www.bls.gov/news.release/";
  const archive = base + "archives/" + kind + "_" + month + day + year + ".htm";
  for (const url of [archive, base + kind + ".nr0.htm"]) {
    const packet = await document(url).catch(() => null);
    if (!packet || !matchesBlsDate(packet.html, event.date)) continue;
    const readings = parseBlsReadings(kind, packet.html);
    if (readings.length) return { readings, resultUrl: url };
  }
  return {};
}

async function beaReadings(event: MarketEvent, kind: "pce" | "gdp") {
  const site = URL.parse(event.resultUrl ?? "");
  if (site?.origin !== "https://www.bea.gov" || !/^\/news\/20\d\d\//.test(site.pathname)) return {};
  const packet = await document(site.href).catch(() => null);
  const dateLine = packet?.html.match(/class="[^"]*field--name-field-release-date[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1];
  if (!packet || !dateLine || dateOf(textOf(dateLine)) !== event.date) return {};
  const readings = parseBeaReadings(kind, packet.html);
  return readings.length ? { readings } : {};
}

export type InflationModels = Map<string, { cpi?: Reference; pce?: Reference }>;

export function parseNowcasts(html: string, today: string): InflationModels {
  const section = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)]
    .find(table => /<caption>Inflation, month-over-month percent change<\/caption>/i.test(table[1]));
  const models: InflationModels = new Map();
  if (!section) return models;
  for (const match of section[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(item => textOf(item[1]));
    if (cells.length !== 6) continue;
    const position = labelPeriod(cells[0]);
    const update = cells[5].match(/^(\d{1,2})\/(\d{1,2})$/);
    if (!position || !update) continue;
    const suffix = update.slice(1).map(value => value.padStart(2, "0")).join("-");
    const year = Number(today.slice(0, 4));
    const asOf = (year + "-" + suffix > today ? year - 1 : year) + "-" + suffix;
    if (asOf < position + "-01") continue;
    const cpi = figure(cells[2]), pce = figure(cells[4]);
    models.set(position, {
      cpi: cpi === undefined ? undefined : { value: cpi, period: position, asOf },
      pce: pce === undefined ? undefined : { value: pce, period: position, asOf },
    });
  }
  return models;
}

function labelPeriod(detail: string) {
  const match = detail.match(/\b([A-Z][a-z]+)\s+(20\d\d)\b/);
  const index = months.indexOf(match?.[1] ?? "");
  return index < 0 ? null : match![2] + "-" + String(index + 1).padStart(2, "0");
}

export async function loadNowcasts() {
  return document(nowcastUrl).then(data => parseNowcasts(data.html, newYorkDate())).catch(() => new Map() as InflationModels);
}

export async function enrichRelease(event: MarketEvent, models: InflationModels): Promise<MarketEvent> {
  const bls = event.source === "bls" ? blsType(event) : undefined;
  const bea = event.source === "bea" ? beaType(event) : undefined;
  const period = labelPeriod(event.detail);
  const estimate = period ? (bls === "cpi" ? models.get(period)?.cpi : bea === "pce" ? models.get(period)?.pce : undefined) : undefined;
  const reference = estimate && estimate.asOf < event.date && (!event.reference || estimate.asOf >= event.reference.asOf) ? estimate : event.reference;
  const needsUpgrade = Boolean(event.readings?.length && (
    (bea === "pce" && !event.readings.some(r => r.label.includes("同比"))) ||
    ((bls === "cpi" || bls === "ppi" || bls === "empsit" || bea === "gdp") && !event.readings.some(r => r.signed))
  ));
  const published = isPastEvent(event) && event.time && (!event.readings?.length || needsUpgrade);
  const actual = !published ? {} : bls ? await blsReadings(event, bls) : bea ? await beaReadings(event, bea) : {};
  return { ...event, ...actual, reference };
}
