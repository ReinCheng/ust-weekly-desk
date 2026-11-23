import { dateOf, document, months, textOf } from "./feeds";
import { isPastEvent, newYorkDate, type MarketEvent, type Reading, type Reference } from "./model";

export const nowcastUrl = "https://www.clevelandfed.org/indicators-and-data/inflation-nowcasting";

const percent = (label: string, value: number | undefined): Reading[] =>
  value === undefined ? [] : [{ label, value, unit: "%" }];
const figure = (value: string | undefined) => {
  if (!value) return undefined;
  const number = Number(value.replaceAll(",", ""));
  return Number.isFinite(number) ? number : undefined;
};
const signed = (verb: string | undefined, digits: string | undefined) => {
  const number = figure(digits);
  return number === undefined ? undefined : /decreased|declined|fell|down|dropped/i.test(verb ?? "") ? -Math.abs(number) : number;
};
const percentMove = (text: string, subject: RegExp) => {
  const clause = text.match(subject)?.[0];
  if (!clause) return undefined;
  const match = clause.match(/\b(increased|rose|advanced|decreased|declined|fell|dropped|edged up|edged down)\s+(?:by\s+)?(?:at an annual rate of\s+)?([+-]?\d+(?:\.\d+)?)\s*percent/i);
  return match ? signed(match[1], match[2]) : /\b(?:was|were|remained)\s+unchanged\b/i.test(clause) ? 0 : undefined;
};
const clause = (prefix: string, length = 110) => new RegExp(prefix + ".{0," + length + "}", "i");

export function parseBlsReadings(kind: "cpi" | "ppi" | "empsit", html: string): Reading[] {
  const release = html.match(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi)?.slice(0, 3).join(" ") ?? html;
  const intro = textOf(release).slice(0, 15500);
  if (kind === "cpi") {
    return [
      ...percent("核心 CPI 月率", percentMove(intro, clause("The index for all items less food and energy", 85))),
      ...percent("整体 CPI 月率", percentMove(intro, clause("The Consumer Price Index for All Urban Consumers", 115))),
      ...percent("住房月率", percentMove(intro, clause("The index for shelter", 50))),
    ];
  }
  if (kind === "ppi") {
    return [
      ...percent("最终需求 PPI 月率", percentMove(intro, clause("The Producer Price Index for final demand", 65))),
      ...percent("剔除食品、能源和贸易服务月率", percentMove(intro, clause("The index for final demand less foods?, energy, and trade services", 65))),
    ];
  }
  const payroll = intro.match(/Total nonfarm payroll employment\s+(rose|increased|fell|declined|decreased|edged up|edged down)\s+(?:by\s+)?([+-]?\d[\d,]*)/i);
  const flat = /Total nonfarm payroll employment (?:was|remained) unchanged\b/i.test(intro);
  const employment = flat ? 0 : signed(payroll?.[1], payroll?.[2]);
  const unemployment = figure(intro.match(/the unemployment rate [^.!?]{0,65}?(?:to|at|was|of)\s+(\d(?:\.\d+)?)\s*percent/i)?.[1]);
  const wages = intro.match(/average hourly earnings for all employees[^\d]{0,105}?(increased|rose|declined|decreased|fell)[^.]{0,75}?\bor\s+(\d+(?:\.\d+)?)\s*percent/i);
  const revisions = [...intro.matchAll(/was revised (up|down) by ([\d,]+), from [+-]?[\d,]+ to [+-]?[\d,]+/gi)].slice(0, 2);
  const netChange = revisions.reduce((sum, match) => sum + (match[1].toLowerCase() === "down" ? -1 : 1) * Number(match[2].replaceAll(",", "")), 0);
  return [
    ...(employment === undefined ? [] : [{ label: "非农新增就业", value: employment / 1000, unit: "千人" as const }]),
    ...percent("失业率", unemployment),
    ...percent("平均时薪月率", signed(wages?.[1], wages?.[2])),
    ...(revisions.length === 2 ? [{ label: "前两月非农合计修订", value: netChange / 1000, unit: "千人" as const }] : []),
  ];
}

export function parseBeaReadings(kind: "pce" | "gdp", html: string): Reading[] {
  const paragraphs = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(match => textOf(match[1]));
  if (kind === "pce") {
    const monthly = paragraphs.find(p => /(?:from the (?:preceding|previous) month|from (?:[A-Z][a-z]+) to (?:[A-Z][a-z]+)),? the PCE price index/i.test(p)) ?? "";
    return [
      ...percent("核心 PCE 月率", percentMove(monthly, clause("Excluding food and energy, the PCE price index", 68))),
      ...percent("整体 PCE 月率", percentMove(monthly, clause("the PCE price index", 78))),
    ];
  }
  const lead = paragraphs.find(p => /^Real gross domestic product \(GDP\)/i.test(p)) ?? "";
  const demand = paragraphs.find(p => /^Real final sales to private domestic purchasers/i.test(p)) ?? "";
  return [
    ...percent("实际 GDP 季环比折年率", percentMove(lead, clause("Real gross domestic product", 110))),
    ...percent("私人国内最终销售折年率", percentMove(demand, clause("Real final sales to private domestic purchasers", 170))),
  ];
}

function blsType(event: MarketEvent) {
  if (event.title === "美国 CPI") return "cpi";
  if (event.title === "美国 PPI") return "ppi";
  if (event.title === "美国非农就业") return "empsit";
}

function beaType(event: MarketEvent) {
  if (event.title.startsWith("PCE")) return "pce";
  if (event.title === "美国 GDP") return "gdp";
}

function matchesBlsDate(html: string, expected: string) {
  const intro = textOf(html.match(/<pre\b[^>]*>([\s\S]*?)<\/pre>/i)?.[1] ?? html).slice(0, 2000);
  const stamp = intro.match(/\(ET\)\s+\w+,\s+([A-Z][a-z]+ \d{1,2}, 20\d\d)/)?.[1];
  return stamp && dateOf(stamp) === expected;
}

async function blsReadings(event: MarketEvent, kind: "cpi" | "ppi" | "empsit") {
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
  const published = isPastEvent(event) && event.time && !event.readings?.length;
  const actual = !published ? {} : bls ? await blsReadings(event, bls) : bea ? await beaReadings(event, bea) : {};
  return { ...event, ...actual, reference };
}
