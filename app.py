from __future__ import annotations

import json
import math
import os
import statistics
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
STATIC_ROOT = ROOT / "static"

YAHOO_CHART_BASE = "https://query1.finance.yahoo.com/v8/finance/chart"
CBOE_OPTIONS_BASE = "https://cdn.cboe.com/api/global/delayed_quotes/options"
HTTP_TIMEOUT = float(os.environ.get("SOURCE_TIMEOUT", "12"))
CACHE_TTL_SECONDS = int(os.environ.get("CACHE_TTL_SECONDS", "300"))
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/125.0 Safari/537.36"
)

_cache: dict[str, tuple[float, Any]] = {}


def cached_json(key: str, loader) -> Any:
    now = time.time()
    cached = _cache.get(key)
    if cached and now - cached[0] < CACHE_TTL_SECONDS:
        return cached[1]
    value = loader()
    _cache[key] = (now, value)
    return value


def fetch_json(url: str) -> dict[str, Any]:
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json,text/plain,*/*",
            "Accept-Language": "en-US,en;q=0.9",
            "User-Agent": USER_AGENT,
        },
    )
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as response:
        body = response.read().decode("utf-8", errors="replace")
    return json.loads(body)


def normalize_symbol(symbol: str) -> str:
    cleaned = "".join(ch for ch in symbol.strip().upper() if ch.isalnum() or ch in ".-")
    if not cleaned:
        raise ValueError("股票代码不能为空")
    return cleaned


def as_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        number = float(value)
        if not math.isfinite(number):
            return None
        return number
    except (TypeError, ValueError):
        return None


def stdev_annualized(log_returns: list[float], window: int) -> float | None:
    sample = log_returns[-window:]
    if len(sample) < max(5, min(window, 20)):
        return None
    return statistics.stdev(sample) * math.sqrt(252)


def iso_from_unix(timestamp: Any) -> str | None:
    try:
        if timestamp is None:
            return None
        return datetime.fromtimestamp(float(timestamp), tz=timezone.utc).isoformat()
    except (TypeError, ValueError, OSError):
        return None


def fetch_quote(symbol: str, data_range: str) -> dict[str, Any]:
    safe_range = data_range if data_range in {"6mo", "1y", "2y", "5y"} else "2y"
    query = urllib.parse.urlencode(
        {
            "range": safe_range,
            "interval": "1d",
            "includePrePost": "true",
            "events": "history|div|split",
            "includeAdjustedClose": "true",
        }
    )
    url = f"{YAHOO_CHART_BASE}/{urllib.parse.quote(symbol)}?{query}"
    payload = fetch_json(url)

    chart = payload.get("chart", {})
    if chart.get("error"):
        description = chart["error"].get("description") or str(chart["error"])
        raise RuntimeError(description)

    results = chart.get("result") or []
    if not results:
        raise RuntimeError(f"没有返回 {symbol} 的行情数据")

    result = results[0]
    meta = result.get("meta", {})
    timestamps = result.get("timestamp") or []
    quote_blocks = result.get("indicators", {}).get("quote") or []
    if not timestamps or not quote_blocks:
        raise RuntimeError(f"{symbol} 没有可用的日线 OHLCV 数据")

    quote = quote_blocks[0]
    adj_blocks = result.get("indicators", {}).get("adjclose") or []
    adjclose = adj_blocks[0].get("adjclose") if adj_blocks else []

    rows: list[dict[str, Any]] = []
    for index, ts in enumerate(timestamps):
        raw_close = as_float((quote.get("close") or [None])[index])
        adjusted_close = as_float(adjclose[index] if index < len(adjclose) else None)
        close = adjusted_close or raw_close
        if close is None:
            continue
        rows.append(
            {
                "date": datetime.fromtimestamp(ts, tz=timezone.utc).date().isoformat(),
                "open": as_float((quote.get("open") or [None])[index]),
                "high": as_float((quote.get("high") or [None])[index]),
                "low": as_float((quote.get("low") or [None])[index]),
                "close": close,
                "rawClose": raw_close,
                "volume": int((quote.get("volume") or [0])[index] or 0),
            }
        )

    rows.sort(key=lambda row: row["date"])
    closes = [row["close"] for row in rows if as_float(row.get("close")) is not None]
    log_returns = [
        math.log(closes[i] / closes[i - 1])
        for i in range(1, len(closes))
        if closes[i] and closes[i - 1] and closes[i] > 0 and closes[i - 1] > 0
    ]

    vol_windows = {str(window): stdev_annualized(log_returns, window) for window in (20, 30, 60, 120, 252)}

    latest_close = closes[-1] if closes else None
    latest_ts = timestamps[-1] if timestamps else None
    events = result.get("events", {})
    dividends = []
    for dividend in (events.get("dividends") or {}).values():
        amount = as_float(dividend.get("amount"))
        date_ts = dividend.get("date")
        if amount is None or date_ts is None:
            continue
        dividends.append({"amount": amount, "date": iso_from_unix(date_ts)})

    trailing_dividend = 0.0
    if latest_ts:
        cutoff = latest_ts - 365 * 24 * 60 * 60
        for dividend in (events.get("dividends") or {}).values():
            amount = as_float(dividend.get("amount"))
            date_ts = dividend.get("date")
            if amount is not None and date_ts and date_ts >= cutoff:
                trailing_dividend += amount

    dividend_yield = None
    if latest_close and latest_close > 0 and trailing_dividend > 0:
        dividend_yield = trailing_dividend / latest_close

    return {
        "ok": True,
        "symbol": meta.get("symbol") or symbol,
        "source": "Yahoo Finance chart",
        "range": safe_range,
        "fetchedAt": datetime.now(tz=timezone.utc).isoformat(),
        "marketTime": iso_from_unix(meta.get("regularMarketTime")),
        "price": {
            "currency": meta.get("currency"),
            "exchangeName": meta.get("exchangeName"),
            "regularMarketPrice": as_float(meta.get("regularMarketPrice")) or latest_close,
            "postMarketPrice": as_float(meta.get("postMarketPrice")),
            "preMarketPrice": as_float(meta.get("preMarketPrice")),
            "previousClose": as_float(meta.get("chartPreviousClose") or meta.get("previousClose")),
            "chartClose": latest_close,
            "lastDataDate": rows[-1]["date"] if rows else None,
        },
        "volatility": {
            "annualized": vol_windows,
            "returnCount": len(log_returns),
        },
        "dividend": {
            "trailing12mAmount": trailing_dividend if trailing_dividend > 0 else None,
            "estimatedYield": dividend_yield,
            "events": dividends[-8:],
        },
        "history": rows[-520:],
    }


def clean_occ_code(value: str) -> str:
    cleaned = "".join(ch for ch in value.strip().upper() if ch.isalnum() or ch in ".-")
    if not cleaned:
        raise ValueError("期权合约代码不能为空")
    return cleaned


def fetch_cboe_option(symbol: str, occ_code: str) -> dict[str, Any]:
    safe_symbol = normalize_symbol(symbol)
    safe_occ = clean_occ_code(occ_code)
    url = f"{CBOE_OPTIONS_BASE}/{urllib.parse.quote(safe_symbol)}.json"
    payload = fetch_json(url)
    data = payload.get("data") or {}
    options = data.get("options") or []
    match = next((option for option in options if clean_occ_code(str(option.get("option", ""))) == safe_occ), None)
    if not match:
        raise RuntimeError(f"Cboe 没有找到 {safe_occ} 的延迟报价")

    bid = as_float(match.get("bid"))
    ask = as_float(match.get("ask"))
    last = as_float(match.get("last_trade_price"))
    mid = None
    if bid is not None and ask is not None and bid > 0 and ask >= bid:
        mid = (bid + ask) / 2
    elif last is not None and last > 0:
        mid = last

    return {
        "ok": True,
        "source": "Cboe delayed quotes",
        "symbol": safe_symbol,
        "occ": safe_occ,
        "timestamp": payload.get("timestamp"),
        "underlying": {
            "currentPrice": as_float(data.get("current_price")),
            "bid": as_float(data.get("bid")),
            "ask": as_float(data.get("ask")),
        },
        "quote": {
            "bid": bid,
            "ask": ask,
            "mid": mid,
            "last": last,
            "lastTradeTime": match.get("last_trade_time"),
            "volume": as_float(match.get("volume")),
            "openInterest": as_float(match.get("open_interest")),
            "cboeIv": as_float(match.get("iv")),
            "theo": as_float(match.get("theo")),
            "delta": as_float(match.get("delta")),
            "gamma": as_float(match.get("gamma")),
            "vega": as_float(match.get("vega")),
            "theta": as_float(match.get("theta")),
        },
    }


class OptionPricerHandler(SimpleHTTPRequestHandler):
    server_version = "OptionPricer/1.0"
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
    }

    def translate_path(self, path: str) -> str:
        parsed = urllib.parse.urlparse(path)
        clean_path = urllib.parse.unquote(parsed.path).lstrip("/")
        if clean_path in {"", "index.html"}:
            return str(STATIC_ROOT / "index.html")
        candidate = (STATIC_ROOT / clean_path).resolve()
        if not str(candidate).startswith(str(STATIC_ROOT.resolve())):
            return str(STATIC_ROOT / "index.html")
        return str(candidate)

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/health":
            self.write_json({"ok": True, "service": "option-pricer", "cacheSeconds": CACHE_TTL_SECONDS})
            return
        if parsed.path.startswith("/api/quote/"):
            self.handle_quote(parsed)
            return
        if parsed.path.startswith("/api/option/"):
            self.handle_option(parsed)
            return
        super().do_GET()

    def handle_quote(self, parsed: urllib.parse.ParseResult) -> None:
        symbol = urllib.parse.unquote(parsed.path.removeprefix("/api/quote/"))
        params = urllib.parse.parse_qs(parsed.query)
        data_range = (params.get("range") or ["2y"])[0]
        try:
            normalized = normalize_symbol(symbol)
            key = f"quote:{normalized}:{data_range}"
            payload = cached_json(key, lambda: fetch_quote(normalized, data_range))
            self.write_json(payload)
        except Exception as exc:
            message = str(exc) or exc.__class__.__name__
            self.write_json({"ok": False, "error": message, "symbol": symbol}, status=HTTPStatus.BAD_GATEWAY)

    def handle_option(self, parsed: urllib.parse.ParseResult) -> None:
        symbol = urllib.parse.unquote(parsed.path.removeprefix("/api/option/"))
        params = urllib.parse.parse_qs(parsed.query)
        occ = (params.get("occ") or [""])[0]
        try:
            normalized = normalize_symbol(symbol)
            safe_occ = clean_occ_code(occ)
            key = f"option:{normalized}:{safe_occ}"
            payload = cached_json(key, lambda: fetch_cboe_option(normalized, safe_occ))
            self.write_json(payload)
        except Exception as exc:
            message = str(exc) or exc.__class__.__name__
            self.write_json({"ok": False, "error": message, "symbol": symbol, "occ": occ}, status=HTTPStatus.BAD_GATEWAY)

    def write_json(self, payload: object, status: int = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> int:
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8092"))
    server = ThreadingHTTPServer((host, port), OptionPricerHandler)
    print(f"美股期权定价工作台已启动: http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
