"""Pure-Python Minimalist 3-Pillar Pure-Treasury Core Engine (v4.0 Production).

100% Pure Python using established scientific libraries (numpy, pandas, scipy, statsmodels).
Zero FRED / Zero Cross-Asset / Zero Ridge dependencies in Core3 signals:
  - Pillar A (P2_Calendar_Flow) : Exact EOM-3..EOM-1 (50% 2Y + 50% 10Y) + Pre-Auction Short A-3..A-1
                                  STRICTLY gated by official FiscalData `announcementDate <= decision_date`!
  - Pillar B (P5a_2s10s_SelfRev): Pure 5-day 2s10s curve self-reversion + Deadband (1.25 / 0.35 / 10d)
  - Pillar C (P5c_5s30s_SelfRev): Pure 5-day 5s30s curve self-reversion + Deadband (1.25 / 0.35 / 10d)
  - Single-Layer Risk Overlay   : Causal portfolio-level ^MOVE + Realized Rate-Vol Damper (<= 1.0x)

Triple-Venue Verification:
  - Real Exchange-Traded US Treasury ETFs (SHY/IEI/IEF/TLT - BIL, ZERO roll masks!):
      * 16:00 ET Close-to-Close & 09:30 ET Next-Morning Open-to-Open
  - Strictly Causal CME Futures Continuous Proxy (trailing-252d MAD, bit-for-bit truncation invariant!)
  - Live Active Individual CME Contract Months (auto-rolled ahead of FND, exact $2,000/$1,000 point values!)
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
import hashlib
import io
import json
import re
import time

import numpy as np
import pandas as pd
import requests
from scipy import stats
import statsmodels.api as sm

START_YEAR = 2014
START_DATE = "2014-01-01"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; ust-weekly-desk-alpha/4.0)"}

DESK_COST_TIERS = {
    "DESK_SMALL_10K": {"2Y": 0.02, "5Y": 0.02, "10Y": 0.02, "30Y": 0.03, "2s10s": 0.04, "5s30s": 0.05},
    "DESK_50K_DV01": {"2Y": 0.05, "5Y": 0.05, "10Y": 0.05, "30Y": 0.06, "2s10s": 0.10, "5s30s": 0.11},
    "STRESSED_3X_50K": {"2Y": 0.15, "5Y": 0.15, "10Y": 0.15, "30Y": 0.18, "2s10s": 0.30, "5s30s": 0.33},
    "LEGACY_WIDE_CASH": {"2Y": 0.25, "5Y": 0.30, "10Y": 0.35, "30Y": 0.50, "2s10s": 0.60, "5s30s": 0.80},
}

CME_POINT_VALUE = {"TU": 2000.0, "FV": 1000.0, "TY": 1000.0, "UXY": 1000.0, "US": 1000.0, "WN": 1000.0}
CME_CTD_MOD_DUR = {"TU": 1.67, "FV": 3.91, "TY": 6.08, "UXY": 8.12, "US": 12.22, "WN": 16.50}
ETF_MOD_DUR = {"ETF_2Y": 1.69, "ETF_5Y": 4.25, "ETF_10Y": 7.55, "ETF_30Y": 17.51}


# ---------------------------------------------------------------------------
# 1. Deterministic SIFMA US Bond Market Business-Day Calendar (Zero Lookahead!)
# ---------------------------------------------------------------------------

def _easter_sunday(year: int) -> date:
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = ((h + l - 7 * m + 114) % 31) + 1
    return date(year, month, day)


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    if n > 0:
        first = date(year, month, 1)
        return first + timedelta(days=((weekday - first.weekday()) % 7) + (n - 1) * 7)
    nxt = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    last = nxt - timedelta(days=1)
    return last - timedelta(days=(last.weekday() - weekday) % 7)


def _observed_fixed(year: int, month: int, day: int) -> date:
    dt = date(year, month, day)
    if dt.weekday() == 5:
        return dt - timedelta(days=1)
    if dt.weekday() == 6:
        return dt + timedelta(days=1)
    return dt


@lru_cache(maxsize=64)
def _sifma_holidays(year: int) -> frozenset[date]:
    hols = {
        _observed_fixed(year, 1, 1),
        _nth_weekday(year, 1, 0, 3),
        _nth_weekday(year, 2, 0, 3),
        _easter_sunday(year) - timedelta(days=2),
        _nth_weekday(year, 5, 0, -1),
        _observed_fixed(year, 7, 4),
        _nth_weekday(year, 9, 0, 1),
        _nth_weekday(year, 10, 0, 2),
        _observed_fixed(year, 11, 11),
        _nth_weekday(year, 11, 3, 4),
        _observed_fixed(year, 12, 25),
    }
    if year >= 2022:
        hols.add(_observed_fixed(year, 6, 19))
    nxt_ny = _observed_fixed(year + 1, 1, 1)
    if nxt_ny.year == year:
        hols.add(nxt_ny)
    return frozenset(hols)


def is_sifma_bday(d: date) -> bool:
    return d.weekday() < 5 and d not in _sifma_holidays(d.year)


def next_sifma_bday(d: date) -> date:
    cur = d + timedelta(days=1)
    while not is_sifma_bday(cur):
        cur += timedelta(days=1)
    return cur


def prev_sifma_bday(d: date) -> date:
    cur = d - timedelta(days=1)
    while not is_sifma_bday(cur):
        cur -= timedelta(days=1)
    return cur


def add_sifma_bdays(d: date, n: int) -> date:
    cur = d
    step = 1 if n >= 0 else -1
    rem = abs(n)
    while rem > 0:
        cur += timedelta(days=step)
        if is_sifma_bday(cur):
            rem -= 1
    return cur


def last_sifma_bday_of_month(d: date) -> date:
    nxt = date(d.year + 1, 1, 1) if d.month == 12 else date(d.year, d.month + 1, 1)
    cur = nxt - timedelta(days=1)
    while not is_sifma_bday(cur):
        cur -= timedelta(days=1)
    return cur


def remaining_sifma_days_in_month(d: date) -> int:
    nxt = date(d.year + 1, 1, 1) if d.month == 12 else date(d.year, d.month + 1, 1)
    cur = d + timedelta(days=1)
    cnt = 0
    while cur < nxt:
        if is_sifma_bday(cur):
            cnt += 1
        cur += timedelta(days=1)
    return cnt


def sifma_bdays_ahead(a: date, b: date) -> int:
    if b <= a:
        return 0
    if (b - a).days > 15:
        return (b - a).days
    cnt = 0
    cur = a + timedelta(days=1)
    while cur <= b:
        if is_sifma_bday(cur):
            cnt += 1
        cur += timedelta(days=1)
    return cnt


def cme_calendar_roll_mask(index: pd.DatetimeIndex) -> pd.Series:
    return pd.Series(
        [(ts.month in (2, 5, 8, 11)) and (remaining_sifma_days_in_month(ts.date()) <= 2) for ts in index],
        index=index,
        dtype=bool,
    )


# ---------------------------------------------------------------------------
# 2. Public Primary Data Fetchers (Zero Proprietary / Zero FRED Dependencies)
# ---------------------------------------------------------------------------

def _http_get_text(url: str, label: str, retries: int = 2) -> str:
    last_err = None
    for attempt in range(retries + 1):
        try:
            r = requests.get(url, headers=HEADERS, timeout=25)
            r.raise_for_status()
            return r.text
        except Exception as exc:
            last_err = exc
            if attempt < retries:
                time.sleep(0.5 * (attempt + 1))
    raise RuntimeError(f"Failed fetching {label}: {last_err}")


def _http_get_json(url: str, label: str, retries: int = 2):
    return json.loads(_http_get_text(url, label, retries))


def fetch_treasury_nominal() -> pd.DataFrame:
    end_yr = datetime.now(timezone.utc).year
    def _one_year(year: int) -> pd.DataFrame:
        url = (
            f"https://home.treasury.gov/resource-center/data-chart-center/interest-rates/"
            f"daily-treasury-rates.csv/{year}/all?type=daily_treasury_yield_curve"
            f"&field_tdr_date_value={year}&page&_format=csv"
        )
        txt = _http_get_text(url, f"UST_{year}")
        df = pd.read_csv(io.StringIO(txt))
        df.columns = [c.strip().lower() for c in df.columns]
        if "date" not in df.columns:
            return pd.DataFrame()
        df["date"] = pd.to_datetime(df["date"], format="%m/%d/%Y", errors="coerce")
        df = df.dropna(subset=["date"]).set_index("date")
        rename = {
            "2 yr": "ust_2y", "2 year": "ust_2y",
            "5 yr": "ust_5y", "5 year": "ust_5y",
            "7 yr": "ust_7y", "7 year": "ust_7y",
            "10 yr": "ust_10y", "10 year": "ust_10y",
            "30 yr": "ust_30y", "30 year": "ust_30y",
        }
        df = df.rename(columns=rename)
        keep = [c for c in ["ust_2y", "ust_5y", "ust_7y", "ust_10y", "ust_30y"] if c in df.columns]
        return df[keep].apply(pd.to_numeric, errors="coerce")

    with ThreadPoolExecutor(max_workers=8) as ex:
        frames = list(ex.map(_one_year, range(START_YEAR, end_yr + 1)))
    out = pd.concat([f for f in frames if not f.empty]).sort_index()
    out = out[~out.index.duplicated(keep="last")]
    return out.dropna(subset=["ust_2y", "ust_5y", "ust_10y", "ust_30y"])


def fetch_yahoo_close(symbol: str) -> pd.Series:
    enc = requests.utils.quote(symbol)
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{enc}?period1=1388534400&period2=1900000000&interval=1d"
    j = _http_get_json(url, f"YAHOO_{symbol}")
    res = j["chart"]["result"][0]
    ts = res.get("timestamp", [])
    closes = res["indicators"]["quote"][0].get("close", [])
    idx = pd.to_datetime(ts, unit="s", utc=True).tz_convert("America/New_York").normalize().tz_localize(None)
    s = pd.Series(pd.to_numeric(closes, errors="coerce"), index=idx).dropna()
    s = s[(s > 0) & (s.index >= START_DATE)].sort_index()
    return s[~s.index.duplicated(keep="last")]


def fetch_yahoo_etf_ohlc(symbol: str) -> dict[str, pd.Series]:
    enc = requests.utils.quote(symbol)
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{enc}?period1=1388534400&period2=1900000000&interval=1d"
    j = _http_get_json(url, f"YAHOO_ETF_{symbol}")
    res = j["chart"]["result"][0]
    ts = res.get("timestamp", [])
    q = res["indicators"]["quote"][0]
    adj = res["indicators"]["adjclose"][0]["adjclose"]
    idx = pd.to_datetime(ts, unit="s", utc=True).tz_convert("America/New_York").normalize().tz_localize(None)
    df = pd.DataFrame({
        "open": pd.to_numeric(q.get("open", []), errors="coerce"),
        "close": pd.to_numeric(q.get("close", []), errors="coerce"),
        "adj": pd.to_numeric(adj, errors="coerce"),
    }, index=idx).dropna()
    df = df[(df["close"] > 0) & (df["open"] > 0) & (df["adj"] > 0) & (df.index >= START_DATE)].sort_index()
    df = df[~df.index.duplicated(keep="last")]
    fac = df["adj"] / df["close"]
    return {f"etf_{symbol.lower()}_adj": df["adj"], f"etf_{symbol.lower()}_adj_open": df["open"] * fac}


def _parse_term_years(s: str | None) -> int | None:
    if not s:
        return None
    m = re.match(r"^(\d+)-Year", str(s), re.I)
    return int(m.group(1)) if m else None


def fetch_auctions() -> list[dict]:
    all_rows = []
    page, total_pages = 1, 1
    while page <= total_pages:
        url = (
            f"https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query"
            f"?filter=security_type:in:(Note,Bond),record_date:gte:{START_DATE}&sort=issue_date&page[size]=1000&page[number]={page}"
        )
        j = _http_get_json(url, f"FISCALDATA_P{page}")
        total_pages = int(j.get("meta", {}).get("total-pages", 1))
        for r in j.get("data", []):
            if r.get("inflation_index_security") == "Yes" or r.get("floating_rate") == "Yes":
                continue
            a_date = r.get("auction_date") if r.get("auction_date") not in (None, "null", "") else r.get("record_date")
            if not a_date or not re.match(r"^\d{4}-\d{2}-\d{2}$", a_date):
                continue
            ann = r.get("announcemt_date")
            ann = ann if (ann and re.match(r"^\d{4}-\d{2}-\d{2}$", str(ann))) else None
            term = _parse_term_years(r.get("original_security_term")) or _parse_term_years(r.get("security_term"))
            if term not in (10, 30):
                continue
            all_rows.append({"announcementDate": ann, "auctionDate": a_date, "termYears": term})
        page += 1

    # Also pull upcoming announced auctions from TreasuryDirect so pre-auction alerts work live!
    cutoff = all_rows[-1]["auctionDate"] if all_rows else START_DATE
    for sec_type in ("Note", "Bond"):
        try:
            td_url = f"https://www.treasurydirect.gov/TA_WS/securities/search?format=json&pagesize=40&type={sec_type}&dateFieldName=issueDate&startDate={cutoff}"
            for r in _http_get_json(td_url, f"TD_{sec_type}", retries=1):
                if r.get("inflationProtected") == "Yes" or r.get("floatingRate") == "Yes":
                    continue
                a_date = (r.get("competitiveAuctionCloseDate") or "")[:10]
                ann = (r.get("announcementDate") or "")[:10]
                if not re.match(r"^\d{4}-\d{2}-\d{2}$", a_date):
                    continue
                term = _parse_term_years(r.get("originalSecurityTerm")) or _parse_term_years(r.get("securityTerm"))
                if term not in (10, 30):
                    continue
                all_rows.append({
                    "announcementDate": ann if re.match(r"^\d{4}-\d{2}-\d{2}$", ann) else None,
                    "auctionDate": a_date,
                    "termYears": term,
                })
        except Exception:
            pass

    dedup = {}
    for row in all_rows:
        k = (row["auctionDate"], row["termYears"])
        if k not in dedup or (dedup[k]["announcementDate"] is None and row["announcementDate"] is not None):
            dedup[k] = row
    return sorted(dedup.values(), key=lambda x: (x["auctionDate"], x["termYears"]))


def fetch_active_cme_contracts(as_of: date) -> dict[str, dict]:
    q_months = [(3, "H"), (6, "M"), (9, "U"), (12, "Z")]
    cands = []
    yr = as_of.year
    for _ in range(2):
        for m, code in q_months:
            if (yr > as_of.year) or (yr == as_of.year and m >= as_of.month):
                cands.append(f"{code}{str(yr)[-2:]}")
        yr += 1
    front_code, next_code = cands[0], cands[1]
    roots = {"TU": "ZT", "FV": "ZF", "TY": "ZN", "UXY": "TN", "US": "ZB", "WN": "UB"}
    out = {}
    for leg, root in roots.items():
        out[leg] = {}
        for slot, ccode in [("front", front_code), ("next", next_code)]:
            sym = f"{root}{ccode}.CBT"
            try:
                url = f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range=3mo&interval=1d"
                j = _http_get_json(url, f"LIVE_{sym}", retries=1)
                res = j["chart"]["result"][0]
                ts = res.get("timestamp", [])
                closes = res["indicators"]["quote"][0].get("close", [])
                hist = {}
                for t, c in zip(ts, closes):
                    if c is not None and c > 0:
                        d_iso = pd.to_datetime(t, unit="s", utc=True).tz_convert("America/New_York").strftime("%Y-%m-%d")
                        hist[d_iso] = round(float(c), 6)
                if hist:
                    last_d = max(hist.keys())
                    out[leg][slot] = {
                        "symbol": sym,
                        "contract_code": f"{leg}{ccode}",
                        "last_date": last_d,
                        "close": hist[last_d],
                        "history": hist,
                    }
            except Exception as exc:
                out[leg][slot] = {"symbol": sym, "error": str(exc)}
    return out


def fetch_all_core3_data() -> tuple[pd.DataFrame, list[dict], dict, str]:
    tasks = {
        "ust": fetch_treasury_nominal,
        "auctions": fetch_auctions,
        "move": lambda: fetch_yahoo_close("^MOVE"),
        "fut_tu": lambda: fetch_yahoo_close("ZT=F"),
        "fut_fv": lambda: fetch_yahoo_close("ZF=F"),
        "fut_ty": lambda: fetch_yahoo_close("ZN=F"),
        "fut_uxy": lambda: fetch_yahoo_close("TN=F"),
        "fut_us": lambda: fetch_yahoo_close("ZB=F"),
        "fut_wn": lambda: fetch_yahoo_close("UB=F"),
        "etf_shy": lambda: fetch_yahoo_etf_ohlc("SHY"),
        "etf_iei": lambda: fetch_yahoo_etf_ohlc("IEI"),
        "etf_ief": lambda: fetch_yahoo_etf_ohlc("IEF"),
        "etf_tlt": lambda: fetch_yahoo_etf_ohlc("TLT"),
        "etf_bil": lambda: fetch_yahoo_etf_ohlc("BIL"),
    }
    res = {}
    with ThreadPoolExecutor(max_workers=10) as ex:
        futs = {k: ex.submit(fn) for k, fn in tasks.items()}
        for k, f in futs.items():
            res[k] = f.result()

    panel = res["ust"].copy()
    idx = panel.index

    def _asof(s: pd.Series, max_days: int = 7) -> pd.Series:
        s = s.dropna().sort_index()
        s = s[~s.index.duplicated(keep="last")]
        m = pd.merge_asof(pd.DataFrame({"date": idx}), pd.DataFrame({"date": s.index, "v": s.values}),
                          on="date", direction="backward", tolerance=pd.Timedelta(days=max_days))
        return pd.Series(m["v"].values, index=idx)

    for k in ("move", "fut_tu", "fut_fv", "fut_ty", "fut_uxy", "fut_us", "fut_wn"):
        panel[k] = _asof(res[k], 7)
    for grp in ("etf_shy", "etf_iei", "etf_ief", "etf_tlt", "etf_bil"):
        for col, s in res[grp].items():
            panel[col] = s.reindex(idx)

    panel["s2s10s"] = (panel["ust_10y"] - panel["ust_2y"]).round(4)
    panel["s5s30s"] = (panel["ust_30y"] - panel["ust_5y"]).round(4)

    active_cme = fetch_active_cme_contracts(idx[-1].date())
    raw_sig = f"{idx[-1].strftime('%Y-%m-%d')}:{len(panel)}:{panel['ust_10y'].iloc[-1]:.2f}:{panel['move'].iloc[-1]:.2f}"
    panel_sha = hashlib.sha256(raw_sig.encode()).hexdigest()[:16]
    return panel, res["auctions"], active_cme, panel_sha


# ---------------------------------------------------------------------------
# 3. Strictly Causal Return Builders (Zero-Roll ETFs & Causal Trailing-MAD CME)
# ---------------------------------------------------------------------------

def build_etf_targets(panel: pd.DataFrame, cost_tier: str = "DESK_50K_DV01", execution: str = "close") -> dict[str, dict]:
    costs = DESK_COST_TIERS[cost_tier]
    idx = panel.index
    suf = "adj_open" if execution == "open" else "adj"

    def _sret(px: pd.Series) -> pd.Series:
        v = px.dropna()
        r = (v.shift(-1) / v - 1.0).reindex(idx).fillna(0.0)
        r.iloc[-1] = np.nan
        return r

    bil_r = _sret(panel[f"etf_bil_{suf}"].astype(float))
    specs = {
        "ETF_2Y": (f"etf_shy_{suf}", ETF_MOD_DUR["ETF_2Y"], costs["2Y"]),
        "ETF_5Y": (f"etf_iei_{suf}", ETF_MOD_DUR["ETF_5Y"], costs["5Y"]),
        "ETF_10Y": (f"etf_ief_{suf}", ETF_MOD_DUR["ETF_10Y"], costs["10Y"]),
        "ETF_30Y": (f"etf_tlt_{suf}", ETF_MOD_DUR["ETF_30Y"], costs["30Y"]),
    }
    out = {}
    for eid, (col, dur, cbp) in specs.items():
        r = _sret(panel[col].astype(float)) - bil_r
        r.iloc[-1] = np.nan
        ds = pd.Series(dur, index=idx)
        out[eid] = {"er": r, "dur": ds, "unit_cost": ds * cbp * 1e-4, "cost_bp": cbp, "roll_days_masked": 0}

    ief_d = out["ETF_10Y"]["dur"]
    for cid, s_id, l_id, ck in [("ETF_2s10s", "ETF_2Y", "ETF_10Y", "2s10s"), ("ETF_5s30s", "ETF_5Y", "ETF_30Y", "5s30s")]:
        out[cid] = {
            "er": (ief_d / out[s_id]["dur"]) * out[s_id]["er"] - (ief_d / out[l_id]["dur"]) * out[l_id]["er"],
            "dur": ief_d.copy(),
            "unit_cost": ief_d * costs[ck] * 1e-4,
            "cost_bp": costs[ck],
            "roll_days_masked": 0,
        }
    return out


def build_causal_cme_targets(panel: pd.DataFrame, cost_tier: str = "DESK_50K_DV01") -> dict[str, dict]:
    costs = DESK_COST_TIERS[cost_tier]
    idx = panel.index
    roll_months = {2, 3, 5, 6, 8, 9, 11, 12}
    specs = {
        "CME_TU": ("fut_tu", "ust_2y", CME_CTD_MOD_DUR["TU"], costs["2Y"]),
        "CME_FV": ("fut_fv", "ust_5y", CME_CTD_MOD_DUR["FV"], costs["5Y"]),
        "CME_TY": ("fut_ty", "ust_10y", CME_CTD_MOD_DUR["TY"], costs["10Y"]),
        "CME_UXY": ("fut_uxy", "ust_10y", CME_CTD_MOD_DUR["UXY"], costs["10Y"]),
        "CME_US": ("fut_us", "ust_30y", CME_CTD_MOD_DUR["US"], costs["30Y"]),
        "CME_WN": ("fut_wn", "ust_30y", CME_CTD_MOD_DUR["WN"], costs["30Y"]),
    }
    out = {}
    for cid, (fcol, ycol, ctd_dur, cbp) in specs.items():
        px = panel[fcol].astype(float)
        rf = px.shift(-1) / px - 1.0
        dy = (panel[ycol].shift(-1) - panel[ycol]) * 0.01
        resid = (rf - (-ctd_dur * dy)).abs()
        # STRICTLY CAUSAL trailing-252d rolling MAD over ALREADY-COMPLETED intervals (shift(1))!
        causal_mad = resid.shift(1).rolling(252, min_periods=40).median().fillna(resid.shift(1).expanding(min_periods=10).median()).fillna(0.0010)
        thresh = np.maximum(0.0030, 6.5 * 1.4826 * causal_mad)
        is_roll = resid.gt(thresh) & idx.month.isin(roll_months)
        rf_clean = rf.where(~is_roll, 0.0)
        rf_clean.iloc[-1] = np.nan
        ds = pd.Series(ctd_dur, index=idx)
        out[cid] = {
            "er": rf_clean,
            "px": px,
            "dur": ds,
            "unit_cost": ds * cbp * 1e-4,
            "cost_bp": cbp,
            "roll_mask": is_roll.fillna(False),
            "roll_days_masked": int(is_roll.sum()),
        }

    ty_d = out["CME_TY"]["dur"]
    for cid, s_id, l_id, ck in [
        ("CME_TUT_2s10s", "CME_TU", "CME_TY", "2s10s"),
        ("CME_TUT_UXY_2s10s", "CME_TU", "CME_UXY", "2s10s"),
        ("CME_FOB_WN_5s30s", "CME_FV", "CME_WN", "5s30s"),
    ]:
        out[cid] = {
            "er": (ty_d / out[s_id]["dur"]) * out[s_id]["er"] - (ty_d / out[l_id]["dur"]) * out[l_id]["er"],
            "dur": ty_d.copy(),
            "unit_cost": ty_d * costs[ck] * 1e-4,
            "cost_bp": costs[ck],
            "roll_mask": out[s_id]["roll_mask"] | out[l_id]["roll_mask"],
        }
    return out


# ---------------------------------------------------------------------------
# 4. Pure-Treasury Core3 Signals & Unified Netted Integer-Lot Engine
# ---------------------------------------------------------------------------

def build_eom_signal(index: pd.DatetimeIndex) -> pd.Series:
    return pd.Series([1.0 if 1 <= remaining_sifma_days_in_month(ts.date()) <= 3 else 0.0 for ts in index], index=index)


def build_pre_auction_signal(index: pd.DatetimeIndex, auctions: list[dict], prev_day_ann: bool = False) -> pd.Series:
    sched = sorted(
        [(date.fromisoformat(a["auctionDate"]), date.fromisoformat(a["announcementDate"]) if a.get("announcementDate") else None)
         for a in auctions if a.get("termYears") in (10, 30)],
        key=lambda x: x[0],
    )
    vals = np.zeros(len(index), dtype=float)
    for i, ts in enumerate(index):
        d = ts.date()
        cutoff_d = index[i - 1].date() if (prev_day_ann and i > 0) else d
        for a_dt, ann_dt in sched:
            if a_dt <= d:
                continue
            ahead = sifma_bdays_ahead(d, a_dt)
            if 2 <= ahead <= 4:
                if ann_dt is not None and ann_dt <= cutoff_d:
                    vals[i] = -1.0
                    break
            if ahead > 4:
                break
    return pd.Series(vals, index=index)


def build_self_rev_z(spread: pd.Series, train_win: int = 60, hold_win: int = 5) -> pd.Series:
    dy = spread.diff(1)
    mu = dy.shift(hold_win).rolling(train_win, min_periods=35).mean()
    sd = dy.shift(hold_win).rolling(train_win, min_periods=35).std(ddof=1).replace(0.0, np.nan)
    return -((dy.rolling(hold_win, min_periods=hold_win).sum() - hold_win * mu) / (sd * np.sqrt(hold_win)))


def build_deadband_signal(z_series: pd.Series, entry_z: float = 1.25, exit_z: float = 0.35, max_hold: int = 10) -> pd.Series:
    z_arr = z_series.to_numpy(dtype=float)
    out = np.zeros(len(z_arr), dtype=float)
    state, held = 0.0, 0
    for d in range(1, len(z_arr)):
        z = z_arr[d - 1]
        if not np.isfinite(z):
            state, held = 0.0, 0
        elif state == 0.0:
            if z >= entry_z:
                state, held = 1.0, 1
            elif z <= -entry_z:
                state, held = -1.0, 1
        elif state == 1.0:
            if z <= -entry_z:
                state, held = -1.0, 1
            elif z <= exit_z or held >= max_hold:
                state, held = 0.0, 0
            else:
                held += 1
        else:
            if z >= entry_z:
                state, held = 1.0, 1
            elif z >= -exit_z or held >= max_hold:
                state, held = 0.0, 0
            else:
                held += 1
        out[d] = state
    return pd.Series(out, index=z_series.index)


def build_single_layer_damper_details(panel: pd.DataFrame, eval_idx: pd.DatetimeIndex) -> dict[str, pd.Series]:
    dy10 = panel["ust_10y"].diff(1) * 0.01
    rv = (-7.5 * dy10).rolling(60, min_periods=42).std(ddof=1).reindex(eval_idx)
    mv = panel["move"].reindex(eval_idx)
    mv_lag, rv_lag = mv.shift(1), rv.shift(1)
    mv_p75 = mv_lag.rolling(252, min_periods=120).quantile(0.75)
    rv_p75 = rv_lag.rolling(252, min_periods=120).quantile(0.75)
    mv_r = pd.Series(np.where(mv_lag > mv_p75, (mv_p75 / mv_lag) ** 1.5, 1.0), index=eval_idx)
    rv_r = pd.Series(np.where(rv_lag > rv_p75, (rv_p75 / rv_lag) ** 1.5, 1.0), index=eval_idx)
    damp = np.sqrt(mv_r * rv_r)
    damp = pd.Series(np.where(np.isfinite(damp), np.clip(damp, 0.35, 1.0), 1.0), index=eval_idx)
    return {
        "damper": damp,
        "mv_lag": mv_lag,
        "mv_p75": mv_p75,
        "mv_ratio": mv_r,
        "rv_lag_ann": rv_lag * np.sqrt(252.0),
        "rv_p75_ann": rv_p75 * np.sqrt(252.0),
        "rv_ratio": rv_r,
    }


def build_single_layer_damper(panel: pd.DataFrame, eval_idx: pd.DatetimeIndex) -> pd.Series:
    return build_single_layer_damper_details(panel, eval_idx)["damper"]


def _vol_scale(v60: pd.Series, tid: str) -> pd.Series:
    max_lev = 8.0 if tid in ("CME_TU", "ETF_2Y") else (4.0 if tid in ("CME_FV", "ETF_5Y") else 2.5)
    ann_vol = (v60 * np.sqrt(252.0)).clip(lower=0.008)
    return (0.06 / ann_vol).clip(0.1, max_lev)


def _sim_warm(tgt: dict, tid: str, sig: pd.Series, v60: pd.Series, start: str) -> pd.Series:
    vs = _vol_scale(v60, tid).shift(1)
    df = pd.DataFrame({"sig": sig.fillna(0.0), "vs": vs, "er": tgt["er"], "uc": tgt["unit_cost"]}).loc[start:].dropna(subset=["er", "uc"])
    notional = (df["sig"] * df["vs"]).fillna(0.0)
    to = (notional - notional.shift(1).fillna(0.0)).abs()
    return notional * df["er"] - to * df["uc"]


def run_core3_engine(
    panel: pd.DataFrame,
    auctions: list[dict],
    venue: str = "cme_ultra",
    cost_tier: str = "DESK_50K_DV01",
    risk_nav: float = 10_000_000.0,
    damp_mode: str = "port_only",
    integer_lots: bool = True,
    flat_calendar_roll: bool = False,
    oos_start: str = "2017-01-03",
    include_next_live_day: bool = False,
) -> dict:
    is_cme = venue.startswith("cme_")
    if venue == "cme_ultra":
        tgts = build_causal_cme_targets(panel, cost_tier)
        legs = ["CME_TU", "CME_FV", "CME_UXY", "CME_WN"]
        leg2, leg5, leg10, leg30, c2s, c5s = "CME_TU", "CME_FV", "CME_UXY", "CME_WN", "CME_TUT_UXY_2s10s", "CME_FOB_WN_5s30s"
        base_dur, vol_extra, warm_start = CME_CTD_MOD_DUR["TY"], 0, "2016-04-01"
    elif venue == "cme_enhanced":
        tgts = build_causal_cme_targets(panel, cost_tier)
        legs = ["CME_TU", "CME_FV", "CME_TY", "CME_WN"]
        leg2, leg5, leg10, leg30, c2s, c5s = "CME_TU", "CME_FV", "CME_TY", "CME_WN", "CME_TUT_2s10s", "CME_FOB_WN_5s30s"
        base_dur, vol_extra, warm_start = CME_CTD_MOD_DUR["TY"], 0, "2015-01-02"
    elif venue in ("etf_close", "etf_open"):
        tgts = build_etf_targets(panel, cost_tier, execution="open" if venue == "etf_open" else "close")
        legs = ["ETF_2Y", "ETF_5Y", "ETF_10Y", "ETF_30Y"]
        leg2, leg5, leg10, leg30, c2s, c5s = "ETF_2Y", "ETF_5Y", "ETF_10Y", "ETF_30Y", "ETF_2s10s", "ETF_5s30s"
        base_dur, vol_extra, warm_start = ETF_MOD_DUR["ETF_10Y"], (1 if venue == "etf_open" else 0), "2015-01-02"
    else:
        raise ValueError(venue)

    eval_idx = panel.index.append(pd.DatetimeIndex([pd.Timestamp(next_sifma_bday(panel.index[-1].date()))])) if include_next_live_day else panel.index

    def _v60(tid: str) -> pd.Series:
        er = tgts[tid]["er"]
        if include_next_live_day:
            er = pd.concat([er, pd.Series([np.nan], index=[eval_idx[-1]])])
        return er.shift(1 + vol_extra).rolling(60, min_periods=42).std(ddof=1)

    vol_map = {k: _v60(k) for k in (leg2, leg5, leg10, leg30, c2s, c5s)}
    sig_eom = build_eom_signal(eval_idx)
    # ALWAYS require announcementDate <= T_{d-1} so backtest & live blotter are 100% identical & ready at 07:00 ET!
    sig_auc = build_pre_auction_signal(eval_idx, auctions, prev_day_ann=True)

    z_2s = build_self_rev_z(panel["s2s10s"]).reindex(eval_idx)
    z_5s = build_self_rev_z(panel["s5s30s"]).reindex(eval_idx)
    sig_2s = build_deadband_signal(z_2s)
    sig_5s = build_deadband_signal(z_5s)
    damp_info = build_single_layer_damper_details(panel, eval_idx)
    damper = damp_info["damper"]

    # Strictly causal warm returns for 252d inverse-vol RP
    w_eom2 = _sim_warm(tgts[leg2], leg2, sig_eom.reindex(panel.index), vol_map[leg2].reindex(panel.index), warm_start)
    w_eom10 = _sim_warm(tgts[leg10], leg10, sig_eom.reindex(panel.index), vol_map[leg10].reindex(panel.index), warm_start)
    w_auc10 = _sim_warm(tgts[leg10], leg10, sig_auc.reindex(panel.index), vol_map[leg10].reindex(panel.index), warm_start)
    w_p2 = (0.5 * w_eom2 + 0.5 * w_eom10 + w_auc10).rename("P2_Flow")
    w_2s = _sim_warm(tgts[c2s], c2s, sig_2s.reindex(panel.index), vol_map[c2s].reindex(panel.index), warm_start).rename("P5a_2s10s")
    w_5s = _sim_warm(tgts[c5s], c5s, sig_5s.reindex(panel.index), vol_map[c5s].reindex(panel.index), warm_start).rename("P5c_5s30s")
    warm_list = [w_p2, w_2s, w_5s]

    oos_all = eval_idx[eval_idx >= pd.Timestamp(oos_start)]
    oos_idx = oos_all if include_next_live_day else oos_all.intersection(tgts[leg10]["er"].dropna().index)

    vs_2 = _vol_scale(vol_map[leg2], leg2).shift(1).reindex(oos_idx).fillna(0.0).to_numpy()
    vs_10 = _vol_scale(vol_map[leg10], leg10).shift(1).reindex(oos_idx).fillna(0.0).to_numpy()
    vs_2s = _vol_scale(vol_map[c2s], c2s).shift(1).reindex(oos_idx).fillna(0.0).to_numpy()
    vs_5s = _vol_scale(vol_map[c5s], c5s).shift(1).reindex(oos_idx).fillna(0.0).to_numpy()

    s_eom = sig_eom.reindex(oos_idx).fillna(0.0).to_numpy()
    s_auc = sig_auc.reindex(oos_idx).fillna(0.0).to_numpy()
    s_2s = sig_2s.reindex(oos_idx).fillna(0.0).to_numpy()
    s_5s = sig_5s.reindex(oos_idx).fillna(0.0).to_numpy()
    d_arr = damper.reindex(oos_idx).fillna(1.0).to_numpy()

    warm_mat = np.column_stack([w.reindex(eval_idx).fillna(0.0).to_numpy(dtype=float) for w in warm_list])
    pos_in_full = eval_idx.get_indexer(oos_idx)

    dur_2 = tgts[leg2]["dur"].reindex(oos_idx).ffill().to_numpy(dtype=float)
    dur_5 = tgts[leg5]["dur"].reindex(oos_idx).ffill().to_numpy(dtype=float)
    dur_10 = tgts[leg10]["dur"].reindex(oos_idx).ffill().to_numpy(dtype=float)
    dur_30 = tgts[leg30]["dur"].reindex(oos_idx).ffill().to_numpy(dtype=float)
    base_d = np.full(len(oos_idx), base_dur, dtype=float)
    cal_roll = cme_calendar_roll_mask(oos_idx).to_numpy(dtype=bool)

    n = len(oos_idx)
    net_not = np.zeros((n, 4), dtype=float)
    rp_w = np.zeros((n, 3), dtype=float)
    last_diag: dict = {}

    for i in range(n):
        fi = pos_in_full[i]
        hist_end = max(0, fi - 1)
        hist = warm_mat[max(0, hist_end - 252) : hist_end]
        vols = np.maximum(0.015, hist.std(axis=0, ddof=1) * np.sqrt(252.0)) if len(hist) >= 60 else np.full(3, 0.04)
        inv = 1.0 / vols
        raw_w = np.clip(inv / inv.mean(), 0.35, 1.8) / 3.0
        est_vol = max(0.02, float((hist @ raw_w).std(ddof=1) * np.sqrt(252.0))) if len(hist) >= 60 else 0.06
        port_scale = float(np.clip(0.06 / est_vol, 0.5, 2.0))
        w = raw_w * port_scale
        if damp_mode == "port_only":
            w = w * float(d_arr[i])
        rp_w[i] = w

        wp2, w2s, w5s = w[0], w[1], w[2]
        n_p2_eom_2 = 0.5 * wp2 * s_eom[i] * vs_2[i]
        n_p2_eom_10 = 0.5 * wp2 * s_eom[i] * vs_10[i]
        n_p2_auc_10 = wp2 * s_auc[i] * vs_10[i]
        n_p2_10 = n_p2_eom_10 + n_p2_auc_10
        n_2s = w2s * s_2s[i] * vs_2s[i]
        n_5s = w5s * s_5s[i] * vs_5s[i]
        net_not[i] = [
            n_p2_eom_2 + n_2s * (base_d[i] / dur_2[i]),
            n_5s * (base_d[i] / dur_5[i]),
            n_p2_10 - n_2s * (base_d[i] / dur_10[i]),
            -n_5s * (base_d[i] / dur_30[i]),
        ]
        if i == n - 1:
            last_diag = {
                "vols_252_ann": [round(float(x * 100.0), 2) for x in vols],
                "raw_w": [round(float(x), 4) for x in raw_w],
                "est_port_vol_ann": round(float(est_vol * 100.0), 2),
                "port_scale": round(port_scale, 3),
                "damper": round(float(d_arr[i]), 3),
                "w_eff": [round(float(x), 4) for x in w],
                "vol_scales": {
                    "leg2": round(float(vs_2[i]), 3),
                    "leg10": round(float(vs_10[i]), 3),
                    "c2s": round(float(vs_2s[i]), 3),
                    "c5s": round(float(vs_5s[i]), 3),
                },
                "inst_vols_60_ann": {
                    "leg2": round(float(vol_map[leg2].shift(1).reindex(oos_idx).iloc[-1] * np.sqrt(252.0) * 100.0), 2),
                    "leg10": round(float(vol_map[leg10].shift(1).reindex(oos_idx).iloc[-1] * np.sqrt(252.0) * 100.0), 2),
                    "c2s": round(float(vol_map[c2s].shift(1).reindex(oos_idx).iloc[-1] * np.sqrt(252.0) * 100.0), 2),
                    "c5s": round(float(vol_map[c5s].shift(1).reindex(oos_idx).iloc[-1] * np.sqrt(252.0) * 100.0), 2),
                },
                "pillar_leg_dv01": {
                    "P2_EOM": [
                        round(float(n_p2_eom_2 * dur_2[i] * risk_nav * 1e-4), 1),
                        0.0,
                        round(float(n_p2_eom_10 * dur_10[i] * risk_nav * 1e-4), 1),
                        0.0,
                    ],
                    "P2_PreAuction": [
                        0.0,
                        0.0,
                        round(float(n_p2_auc_10 * dur_10[i] * risk_nav * 1e-4), 1),
                        0.0,
                    ],
                    "P5a_2s10s": [
                        round(float(n_2s * base_d[i] * risk_nav * 1e-4), 1),
                        0.0,
                        round(float(-n_2s * base_d[i] * risk_nav * 1e-4), 1),
                        0.0,
                    ],
                    "P5c_5s30s": [
                        0.0,
                        round(float(n_5s * base_d[i] * risk_nav * 1e-4), 1),
                        0.0,
                        round(float(-n_5s * base_d[i] * risk_nav * 1e-4), 1),
                    ],
                },
            }

    if flat_calendar_roll:
        net_not[cal_roll, :] = 0.0

    leg_short = [l.replace("CME_", "").replace("ETF_", "") for l in legs]
    lots_mat = np.zeros((n, 4), dtype=int)
    px_mat = np.zeros((n, 4), dtype=float)
    if is_cme:
        for j, (lid, sname) in enumerate(zip(legs, leg_short)):
            # Strictly lagged T_{d-1} close price for lot sizing (100% known at 07:00 ET & matches live blotter!)
            px_ext = tgts[lid]["px"].reindex(eval_idx)
            px_s = px_ext.shift(1).reindex(oos_idx).ffill().to_numpy(dtype=float)
            px_mat[:, j] = px_s
            ct_not = px_s * CME_POINT_VALUE[sname]
            lots_mat[:, j] = np.rint((net_not[:, j] * risk_nav) / ct_not).astype(int)
        if flat_calendar_roll:
            lots_mat[cal_roll, :] = 0

    eff_not = net_not.copy()
    if is_cme and integer_lots:
        for j, sname in enumerate(leg_short):
            eff_not[:, j] = (lots_mat[:, j] * px_mat[:, j] * CME_POINT_VALUE[sname]) / risk_nav

    er_legs = np.column_stack([tgts[l]["er"].reindex(oos_idx).to_numpy(dtype=float) for l in legs])
    uc_legs = np.column_stack([tgts[l]["unit_cost"].reindex(oos_idx).ffill().to_numpy(dtype=float) for l in legs])
    dur_legs = np.column_stack([dur_2, dur_5, dur_10, dur_30])
    to_legs = np.abs(eff_not - np.vstack([np.zeros((1, 4)), eff_not[:-1]]))
    gross = (eff_not * er_legs).sum(axis=1)
    cost = (to_legs * uc_legs).sum(axis=1)
    net = gross - cost
    realized = np.isfinite(gross)

    daily = pd.DataFrame({"gross": gross, "cost": cost, "net": net, "cal_roll": cal_roll}, index=oos_idx)
    return {
        "legs": leg_short,
        "daily": daily.loc[realized],
        "daily_all": daily,
        "notional_df": pd.DataFrame(eff_not, index=oos_idx, columns=leg_short),
        "dv01_df": pd.DataFrame(eff_not * dur_legs * risk_nav * 1e-4, index=oos_idx, columns=leg_short),
        "lots_df": pd.DataFrame(lots_mat, index=oos_idx, columns=leg_short) if is_cme else None,
        "rp_df": pd.DataFrame(rp_w, index=oos_idx, columns=["P2_Flow", "P5a_2s10s", "P5c_5s30s"]),
        "signals_df": pd.DataFrame({
            "eom": s_eom,
            "auc": s_auc,
            "c2s": s_2s,
            "c5s": s_5s,
            "z_2s": z_2s.shift(1).reindex(oos_idx).to_numpy(),
            "z_5s": z_5s.shift(1).reindex(oos_idx).to_numpy(),
            "damper": d_arr,
        }, index=oos_idx),
        "warm_df": pd.concat(warm_list, axis=1),
        "latest_explain": {
            **last_diag,
            "damper_details": {
                "move": round(float(damp_info["mv_lag"].iloc[-1]), 2),
                "move_p75": round(float(damp_info["mv_p75"].iloc[-1]), 2),
                "move_ratio": round(float(damp_info["mv_ratio"].iloc[-1]), 3),
                "rv10y_ann_pct": round(float(damp_info["rv_lag_ann"].iloc[-1] * 100.0), 2),
                "rv10y_p75_ann_pct": round(float(damp_info["rv_p75_ann"].iloc[-1] * 100.0), 2),
                "rv_ratio": round(float(damp_info["rv_ratio"].iloc[-1]), 3),
                "damper": round(float(damp_info["damper"].iloc[-1]), 3),
            },
        },
    }


# ---------------------------------------------------------------------------
# 5. Library-First Econometric Stats & Dynamic G1 Verification Suite
# ---------------------------------------------------------------------------

def perf_stats(rets: pd.Series | np.ndarray) -> dict:
    y = np.asarray(rets, dtype=float)
    y = y[np.isfinite(y)]
    n = len(y)
    if n < 5:
        return {"n": n, "sharpe": 0.0, "cagr_pct": 0.0, "max_dd_pct": 0.0, "worst_day_pct": 0.0, "calmar": 0.0, "hac_t": 0.0}
    sd = float(np.std(y, ddof=1))
    sr = (float(np.mean(y)) / sd) * np.sqrt(252.0) if sd > 1e-12 else 0.0
    eq = np.cumprod(np.maximum(0.01, 1.0 + y))
    dd = eq / np.maximum.accumulate(eq) - 1.0
    mdd = float(np.min(dd))
    cagr = float(eq[-1] ** (252.0 / n) - 1.0)
    calmar = cagr / abs(mdd) if abs(mdd) > 1e-12 else 0.0
    L = min(n - 2, max(1, 10))
    nw = sm.OLS(y, np.ones((n, 1))).fit(cov_type="HAC", cov_kwds={"maxlags": L})
    return {
        "n": n,
        "sharpe": round(sr, 2),
        "cagr_pct": round(cagr * 100.0, 2),
        "max_dd_pct": round(mdd * 100.0, 1),
        "worst_day_pct": round(float(np.min(y)) * 100.0, 2),
        "calmar": round(calmar, 2),
        "hac_t": round(float(nw.tvalues[0]), 2),
    }


def politis_romano_ci(rets: pd.Series | np.ndarray, block_len: int = 20, n_iter: int = 800, seed: int = 42) -> dict:
    y = np.asarray(rets, dtype=float)
    y = y[np.isfinite(y)]
    n = len(y)
    rng = np.random.default_rng(seed)
    p = 1.0 / float(block_len)
    starts = rng.integers(0, n, size=(n_iter, n))
    jumps = rng.random(size=(n_iter, n)) < p
    idx = np.empty((n_iter, n), dtype=np.int64)
    idx[:, 0] = starts[:, 0]
    for t in range(1, n):
        idx[:, t] = np.where(jumps[:, t], starts[:, t], (idx[:, t - 1] + 1) % n)
    samp = y[idx]
    stds = samp.std(axis=1, ddof=1)
    srs = np.where(stds > 1e-12, (samp.mean(axis=1) / stds) * np.sqrt(252.0), 0.0)
    return {
        "p05": round(float(np.percentile(srs, 5)), 2),
        "p50": round(float(np.percentile(srs, 50)), 2),
        "p95": round(float(np.percentile(srs, 95)), 2),
        "prob_above_100": round(float(np.mean(srs >= 1.0) * 100.0), 1),
    }


def n_eff_diversity(warm_df: pd.DataFrame) -> float:
    corr = warm_df.dropna().corr().to_numpy(dtype=float)
    corr = np.nan_to_num(corr, nan=0.0)
    np.fill_diagonal(corr, 1.0)
    ev = np.maximum(0.0, np.linalg.eigvalsh(corr))
    return round(float((ev.sum() ** 2) / np.sum(ev ** 2)), 2)


def run_g1_verification_suite(panel: pd.DataFrame, auctions: list[dict]) -> dict:
    checks = {}
    # 1. Auction announcementDate causality
    fake = [{"announcementDate": "2024-06-15", "auctionDate": "2024-06-12", "termYears": 10}]
    assert float(build_pre_auction_signal(panel.index, fake).abs().sum()) == 0.0
    checks["auction_announcement_causality"] = True

    # 2. CME truncation invariance (ZERO full-sample MAD lookahead!)
    full_cme = build_causal_cme_targets(panel)
    for cut in ("2019-12-31", "2022-10-14"):
        p_tr = panel.loc[:cut].copy()
        tr_cme = build_causal_cme_targets(p_tr)
        end_i = len(p_tr) - 1
        for cid in ("CME_TU", "CME_FV", "CME_TY", "CME_UXY", "CME_WN"):
            a, b = full_cme[cid]["er"].iloc[:end_i].to_numpy(), tr_cme[cid]["er"].iloc[:end_i].to_numpy()
            assert np.all((a == b) | (np.isnan(a) & np.isnan(b))), f"CME lookahead in {cid}@{cut}"
    checks["cme_truncation_invariance"] = True

    # 3. Unified engine causality across ETF Open & CME Ultra + post-netting flat_calendar_roll
    for venue in ("etf_open", "cme_ultra"):
        full_e = run_core3_engine(panel, auctions, venue=venue, integer_lots=venue.startswith("cme_"))
        p_tr = panel.loc[:"2022-10-14"].copy()
        aucs_tr = [a for a in auctions if a["announcementDate"] and a["announcementDate"] <= "2022-10-14"]
        tr_e = run_core3_engine(p_tr, aucs_tr, venue=venue, integer_lots=venue.startswith("cme_"))
        assert np.allclose(full_e["daily"]["net"].reindex(tr_e["daily"].index).to_numpy(), tr_e["daily"]["net"].to_numpy(), atol=1e-12)
    flat_e = run_core3_engine(panel, auctions, venue="cme_ultra", integer_lots=True, flat_calendar_roll=True)
    rm = flat_e["daily_all"]["cal_roll"].to_numpy(dtype=bool)
    assert np.all(flat_e["lots_df"].to_numpy()[rm] == 0)
    checks["unified_engine_causality_and_flat_roll"] = True

    # 4. Exact Backtest <-> Live Blotter reconciliation
    full_u = run_core3_engine(panel, auctions, venue="cme_ultra", integer_lots=True)
    for t_str in ("2024-08-05", "2025-05-06", "2026-11-23"):
        if pd.Timestamp(t_str) not in panel.index:
            continue
        pos = int(panel.index.searchsorted(pd.Timestamp(t_str)))
        prev_iso = panel.index[pos - 1].strftime("%Y-%m-%d")
        aucs_sub = [a for a in auctions if a["announcementDate"] and a["announcementDate"] <= prev_iso]
        live_u = run_core3_engine(panel.iloc[:pos].copy(), aucs_sub, venue="cme_ultra", integer_lots=True, include_next_live_day=True)
        assert np.array_equal(live_u["lots_df"].iloc[-1].to_numpy(), full_u["lots_df"].loc[pd.Timestamp(t_str)].to_numpy())
    checks["backtest_blotter_exact_parity"] = True

    return {
        "allPassed": all(checks.values()),
        "passedCount": sum(checks.values()),
        "totalChecks": len(checks),
        "checks": checks,
    }


def select_live_contract(exec_date: date, active_cme: dict, leg: str, as_of_iso: str | None = None) -> dict:
    info = active_cme.get(leg, {})
    near_fnd = (exec_date.month in (2, 5, 8, 11)) and (remaining_sifma_days_in_month(exec_date) <= 5)
    slot = "next" if (near_fnd and "next" in info and "close" in info["next"]) else "front"
    chosen = info.get(slot, info.get("front", {}))
    raw_hist = chosen.get("history", {})
    # Strictly cap reference settle price at <= signalAsOfDate (never leak overnight Globex T+0 ticks!)
    capped = {d: v for d, v in raw_hist.items() if (not as_of_iso) or d <= as_of_iso}
    if capped:
        ref_d = max(capped.keys())
        ref_px = capped[ref_d]
    else:
        ref_d = chosen.get("last_date")
        ref_px = chosen.get("close")
    return {
        "slot": slot,
        "rolledAheadOfFnd": near_fnd,
        "symbol": chosen.get("symbol", f"{leg}_ACTIVE"),
        "contractCode": chosen.get("contract_code", leg),
        "refPrice": ref_px,
        "refDate": ref_d,
        "history": raw_hist,
    }
