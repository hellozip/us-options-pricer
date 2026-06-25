const $ = (id) => document.getElementById(id);

const els = {
  contractInput: $("contractInput"),
  parseBtn: $("parseBtn"),
  symbolInput: $("symbolInput"),
  typeInput: $("typeInput"),
  expiryInput: $("expiryInput"),
  strikeInput: $("strikeInput"),
  rangeInput: $("rangeInput"),
  fetchBtn: $("fetchBtn"),
  spotInput: $("spotInput"),
  afterHoursInput: $("afterHoursInput"),
  volWindowInput: $("volWindowInput"),
  volInput: $("volInput"),
  rateInput: $("rateInput"),
  dividendInput: $("dividendInput"),
  stepsInput: $("stepsInput"),
  contractSizeInput: $("contractSizeInput"),
  marketPriceInput: $("marketPriceInput"),
  bidInput: $("bidInput"),
  askInput: $("askInput"),
  lastInput: $("lastInput"),
  fetchOptionBtn: $("fetchOptionBtn"),
  optionQuoteMeta: $("optionQuoteMeta"),
  statusText: $("statusText"),
  regularPrice: $("regularPrice"),
  postPrice: $("postPrice"),
  vol60Value: $("vol60Value"),
  dividendValue: $("dividendValue"),
  americanIvValue: $("americanIvValue"),
  chartTitle: $("chartTitle"),
  dataMeta: $("dataMeta"),
  contractCode: $("contractCode"),
  modelMeta: $("modelMeta"),
  ivMarketPrice: $("ivMarketPrice"),
  euroIvValue: $("euroIvValue"),
  americanIvInlineValue: $("americanIvInlineValue"),
  cboeIvValue: $("cboeIvValue"),
  resultBody: $("resultBody"),
  greeksList: $("greeksList"),
  modelNote: $("modelNote"),
  priceCanvas: $("priceCanvas"),
};

let quoteData = null;
let optionQuoteData = null;
let dividendTouched = false;
let volTouched = false;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function numberValue(input, fallback = 0) {
  const value = Number.parseFloat(input.value);
  return Number.isFinite(value) ? value : fallback;
}

function money(value) {
  if (!Number.isFinite(value)) return "--";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

function numberFmt(value, digits = 2) {
  if (!Number.isFinite(value)) return "--";
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function pct(value, digits = 1) {
  if (!Number.isFinite(value)) return "--";
  return `${(value * 100).toFixed(digits)}%`;
}

function setStatus(text, tone = "") {
  els.statusText.textContent = text;
  els.statusText.className = `status-pill ${tone}`;
}

function parseDateParts(value) {
  const parts = value.split("-").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  return { year: parts[0], month: parts[1], day: parts[2] };
}

function dateFromYYMMDD(value) {
  const yy = Number.parseInt(value.slice(0, 2), 10);
  const year = yy >= 70 ? 1900 + yy : 2000 + yy;
  return `${year}-${value.slice(2, 4)}-${value.slice(4, 6)}`;
}

function parseOptionContract(raw) {
  const text = raw.trim().toUpperCase();
  const compact = text.replace(/\s+/g, "");
  const occMatch = compact.match(/^([A-Z][A-Z0-9.-]{0,9})(\d{6})([CP])(\d{8})$/);
  if (occMatch) {
    return {
      symbol: occMatch[1],
      expiry: dateFromYYMMDD(occMatch[2]),
      type: occMatch[3] === "C" ? "call" : "put",
      strike: Number.parseInt(occMatch[4], 10) / 1000,
    };
  }

  const symbolMatch = text.match(/^([A-Z][A-Z0-9.-]{0,9})\b/);
  const dateMatch = text.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/) || text.match(/\b(\d{6})\b/);
  const typeMatch = text.match(/\b(CALL|PUT|C|P)\b/) || text.match(/\d+(?:\.\d+)?\s*([CP])\b/);
  const strikeWithType = text.match(/\b(\d+(?:\.\d+)?)\s*[CP]\b/);
  const numericTokens = [...text.matchAll(/\b\d+(?:\.\d+)?\b/g)].map((item) => item[0]);

  if (!symbolMatch || !dateMatch || !typeMatch) {
    throw new Error("无法识别期权格式，请使用 OCC 代码或类似 AAPL 2027-01-15 300 C 的格式");
  }

  let expiry;
  if (dateMatch[0].length === 6 && /^\d{6}$/.test(dateMatch[0])) {
    expiry = dateFromYYMMDD(dateMatch[0]);
  } else {
    const year = dateMatch[1];
    const month = String(Number.parseInt(dateMatch[2], 10)).padStart(2, "0");
    const day = String(Number.parseInt(dateMatch[3], 10)).padStart(2, "0");
    expiry = `${year}-${month}-${day}`;
  }

  let strike = strikeWithType ? Number.parseFloat(strikeWithType[1]) : NaN;
  if (!Number.isFinite(strike)) {
    const filtered = numericTokens.filter((token) => !dateMatch[0].includes(token) && Number.parseFloat(token) > 0);
    strike = Number.parseFloat(filtered[filtered.length - 1]);
  }
  if (!Number.isFinite(strike)) throw new Error("没有识别到行权价");

  const typeText = typeMatch[1] || typeMatch[0];
  return {
    symbol: symbolMatch[1],
    expiry,
    type: typeText.startsWith("P") ? "put" : "call",
    strike,
  };
}

function buildOccCode(symbol, expiry, type, strike) {
  const parts = parseDateParts(expiry);
  if (!parts || !Number.isFinite(strike)) return "";
  const yy = String(parts.year % 100).padStart(2, "0");
  const mm = String(parts.month).padStart(2, "0");
  const dd = String(parts.day).padStart(2, "0");
  const cp = type === "put" ? "P" : "C";
  const strikeCode = String(Math.round(strike * 1000)).padStart(8, "0");
  return `${symbol.toUpperCase()}${yy}${mm}${dd}${cp}${strikeCode}`;
}

function refreshContractCode() {
  const code = buildOccCode(
    els.symbolInput.value.trim(),
    els.expiryInput.value,
    els.typeInput.value,
    numberValue(els.strikeInput, NaN),
  );
  els.contractCode.textContent = code || "--";
  return code;
}

function applyContract(contract) {
  els.symbolInput.value = contract.symbol;
  els.expiryInput.value = contract.expiry;
  els.typeInput.value = contract.type;
  els.strikeInput.value = contract.strike;
  optionQuoteData = null;
  els.optionQuoteMeta.textContent = "市场价优先使用 Bid/Ask 中间价，也可手动覆盖。";
  refreshContractCode();
  calculate();
}

function normPdf(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function erf(x) {
  const sign = x >= 0 ? 1 : -1;
  const abs = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * abs);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-abs * abs);
  return sign * y;
}

function normCdf(x) {
  return 0.5 * (1 + erf(x / Math.sqrt(2)));
}

function intrinsicValue(S, K, type) {
  return Math.max(type === "call" ? S - K : K - S, 0);
}

function yearsToExpiry(expiry) {
  const parts = parseDateParts(expiry);
  if (!parts) return 0;
  const expiryUtc = Date.UTC(parts.year, parts.month - 1, parts.day, 21, 0, 0);
  return Math.max((expiryUtc - Date.now()) / (365 * 24 * 60 * 60 * 1000), 0);
}

function blackScholes({ S, K, T, r, q, sigma, type }) {
  const intrinsic = intrinsicValue(S, K, type);
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) {
    return { price: intrinsic, delta: type === "call" ? (S > K ? 1 : 0) : (S < K ? -1 : 0), gamma: 0, theta: 0, vega: 0 };
  }
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const eqt = Math.exp(-q * T);
  const ert = Math.exp(-r * T);
  const price = type === "call"
    ? S * eqt * normCdf(d1) - K * ert * normCdf(d2)
    : K * ert * normCdf(-d2) - S * eqt * normCdf(-d1);
  const delta = type === "call" ? eqt * normCdf(d1) : eqt * (normCdf(d1) - 1);
  const gamma = (eqt * normPdf(d1)) / (S * sigma * sqrtT);
  const vega = S * eqt * normPdf(d1) * sqrtT / 100;
  const thetaAnnual = type === "call"
    ? (-S * eqt * normPdf(d1) * sigma / (2 * sqrtT)) - r * K * ert * normCdf(d2) + q * S * eqt * normCdf(d1)
    : (-S * eqt * normPdf(d1) * sigma / (2 * sqrtT)) + r * K * ert * normCdf(-d2) - q * S * eqt * normCdf(-d1);
  return { price: Math.max(price, intrinsic), delta, gamma, theta: thetaAnnual / 365, vega, d1, d2 };
}

function americanBinomial({ S, K, T, r, q, sigma, type, steps }) {
  const intrinsic = intrinsicValue(S, K, type);
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) return intrinsic;
  const n = clamp(Math.round(steps), 25, 1200);
  const dt = T / n;
  const u = Math.exp(sigma * Math.sqrt(dt));
  const d = 1 / u;
  const disc = Math.exp(-r * dt);
  const p = clamp((Math.exp((r - q) * dt) - d) / (u - d), 0, 1);

  const values = new Array(n + 1);
  for (let j = 0; j <= n; j += 1) {
    const spot = S * Math.pow(u, j) * Math.pow(d, n - j);
    values[j] = intrinsicValue(spot, K, type);
  }
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = 0; j <= i; j += 1) {
      const continuation = disc * (p * values[j + 1] + (1 - p) * values[j]);
      const spot = S * Math.pow(u, j) * Math.pow(d, i - j);
      values[j] = Math.max(continuation, intrinsicValue(spot, K, type));
    }
  }
  return values[0];
}

function impliedVolatility(targetPrice, params, model) {
  const intrinsic = intrinsicValue(params.S, params.K, params.type);
  if (!Number.isFinite(targetPrice) || targetPrice <= 0 || targetPrice + 0.000001 < intrinsic) {
    return { value: NaN, error: "市场价低于内在价值，无法反推有效IV" };
  }

  const priceAt = (sigma) => {
    const priced = model({ ...params, sigma });
    return typeof priced === "number" ? priced : priced.price;
  };

  let low = 0.0001;
  let high = 5;
  let highPrice = priceAt(high);
  while (highPrice < targetPrice && high < 10) {
    high *= 1.5;
    highPrice = priceAt(high);
  }
  if (highPrice < targetPrice) {
    return { value: NaN, error: "市场价过高，10倍年化波动率内仍无法匹配" };
  }

  for (let i = 0; i < 70; i += 1) {
    const mid = (low + high) / 2;
    if (priceAt(mid) > targetPrice) high = mid;
    else low = mid;
  }
  return { value: (low + high) / 2, error: null };
}

function marketOptionPrice() {
  const manual = numberValue(els.marketPriceInput, NaN);
  if (Number.isFinite(manual) && manual > 0) return manual;
  const bid = numberValue(els.bidInput, NaN);
  const ask = numberValue(els.askInput, NaN);
  const last = numberValue(els.lastInput, NaN);
  if (Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask >= bid) return (bid + ask) / 2;
  if (Number.isFinite(last) && last > 0) return last;
  return NaN;
}

function priceRange(params) {
  const lowSigma = Math.max(params.sigma * 0.85, 0.0001);
  const highSigma = Math.max(params.sigma * 1.15, lowSigma);
  const low = blackScholes({ ...params, sigma: lowSigma }).price;
  const high = blackScholes({ ...params, sigma: highSigma }).price;
  return [Math.min(low, high), Math.max(low, high)];
}

function updateGreeks(greeks) {
  const items = [
    ["Delta", numberFmt(greeks.delta, 4)],
    ["Gamma", numberFmt(greeks.gamma, 5)],
    ["Theta/日", money(greeks.theta)],
    ["Vega/1%", money(greeks.vega)],
  ];
  els.greeksList.innerHTML = items.map(([name, value]) => `<div><dt>${name}</dt><dd>${value}</dd></div>`).join("");
}

function scenarioRow(label, S, params, contractSize) {
  const euro = blackScholes({ ...params, S });
  const american = Math.max(americanBinomial({ ...params, S }), euro.price);
  const [rangeLow, rangeHigh] = priceRange({ ...params, S });
  const premium = american - euro.price;
  return {
    html: `
      <tr>
        <td>${label}</td>
        <td>${money(S)}</td>
        <td>${money(euro.price)}</td>
        <td>${money(american)}</td>
        <td class="${premium > 0.01 ? "positive" : ""}">${money(premium)}</td>
        <td>${money(rangeLow)} - ${money(rangeHigh)}</td>
        <td>${money(american * contractSize)}</td>
      </tr>
    `,
    euro,
    american,
  };
}

function calculate() {
  refreshContractCode();
  const S = numberValue(els.spotInput, NaN);
  const afterS = numberValue(els.afterHoursInput, NaN);
  const K = numberValue(els.strikeInput, NaN);
  const T = yearsToExpiry(els.expiryInput.value);
  const r = numberValue(els.rateInput, 0) / 100;
  const q = numberValue(els.dividendInput, 0) / 100;
  const sigma = numberValue(els.volInput, 0) / 100;
  const type = els.typeInput.value;
  const steps = numberValue(els.stepsInput, 400);
  const contractSize = numberValue(els.contractSizeInput, 100);

  if (![S, K, sigma].every((value) => Number.isFinite(value) && value > 0)) {
    els.resultBody.innerHTML = `<tr><td colspan="7" class="empty-cell">请填入现价、行权价和波动率</td></tr>`;
    els.modelMeta.textContent = "等待完整输入";
    els.ivMarketPrice.textContent = "--";
    els.euroIvValue.textContent = "--";
    els.americanIvInlineValue.textContent = "--";
    els.americanIvValue.textContent = "--";
    return;
  }

  const params = { S, K, T, r, q, sigma, type, steps };
  const rows = [];
  const base = scenarioRow("常规现价", S, params, contractSize);
  rows.push(base.html);
  if (Number.isFinite(afterS) && afterS > 0 && Math.abs(afterS - S) > 0.0001) {
    rows.push(scenarioRow("盘后/假设价", afterS, params, contractSize).html);
  }
  els.resultBody.innerHTML = rows.join("");
  updateGreeks(base.euro);

  const targetPrice = marketOptionPrice();
  const euroIv = Number.isFinite(targetPrice)
    ? impliedVolatility(targetPrice, params, blackScholes)
    : { value: NaN, error: null };
  const americanIv = Number.isFinite(targetPrice)
    ? impliedVolatility(targetPrice, params, (modelParams) => Math.max(americanBinomial(modelParams), blackScholes(modelParams).price))
    : { value: NaN, error: null };
  const cboeIv = optionQuoteData?.quote?.cboeIv;

  els.ivMarketPrice.textContent = money(targetPrice);
  els.euroIvValue.textContent = pct(euroIv.value, 2);
  els.americanIvInlineValue.textContent = pct(americanIv.value, 2);
  els.americanIvValue.textContent = pct(americanIv.value, 2);
  els.cboeIvValue.textContent = pct(cboeIv, 2);

  const ivText = Number.isFinite(americanIv.value) ? `，市场价反推美式IV ${pct(americanIv.value, 2)}` : "";
  els.modelMeta.textContent = `${type === "call" ? "Call" : "Put"}，剩余 ${Math.max(T * 365, 0).toFixed(1)} 天，定价波动率 ${pct(sigma)}，二叉树 ${Math.round(steps)} 步${ivText}`;

  const intrinsic = intrinsicValue(S, K, type);
  const timeValue = Math.max(base.american - intrinsic, 0);
  let note = `内在价值 ${money(intrinsic)}，当前定价波动率下的美式时间价值约 ${money(timeValue)}。`;
  if (Number.isFinite(targetPrice)) {
    if (Number.isFinite(americanIv.value)) {
      note += ` 期权市场价 ${money(targetPrice)} 反推的美式IV约为 ${pct(americanIv.value, 2)}，欧式IV约为 ${pct(euroIv.value, 2)}。`;
    } else {
      note += ` ${americanIv.error || euroIv.error || "当前市场价无法反推出有效IV"}。`;
    }
  } else {
    note += " 输入期权市场价，或拉取Cboe延迟报价后，可反推出隐含波动率。";
  }
  els.modelNote.textContent = note;
}

function setQuoteMetrics(data) {
  const price = data.price || {};
  const vol = data.volatility?.annualized || {};
  const div = data.dividend || {};

  els.regularPrice.textContent = money(price.regularMarketPrice);
  els.postPrice.textContent = money(price.postMarketPrice);
  els.vol60Value.textContent = pct(vol["60"]);
  els.dividendValue.textContent = pct(div.estimatedYield, 2);
  els.chartTitle.textContent = `${data.symbol} 价格与历史波动率`;
  els.dataMeta.textContent = `数据源 ${data.source}，最新日线 ${price.lastDataDate || "--"}，行情时间 ${data.marketTime ? new Date(data.marketTime).toLocaleString() : "--"}`;

  if (Number.isFinite(price.regularMarketPrice)) els.spotInput.value = price.regularMarketPrice.toFixed(2);
  if (Number.isFinite(price.postMarketPrice)) els.afterHoursInput.value = price.postMarketPrice.toFixed(2);
  if (!dividendTouched && Number.isFinite(div.estimatedYield)) els.dividendInput.value = (div.estimatedYield * 100).toFixed(2);
  applySelectedVol(false);
}

function applySelectedVol(force = true) {
  if (!quoteData) return;
  const selected = els.volWindowInput.value;
  const value = quoteData.volatility?.annualized?.[selected];
  if (Number.isFinite(value) && (force || !volTouched)) {
    els.volInput.value = (value * 100).toFixed(1);
    volTouched = false;
  }
  calculate();
}

async function fetchQuote() {
  const symbol = els.symbolInput.value.trim().toUpperCase();
  if (!symbol) {
    setStatus("请输入股票代码", "warning");
    return;
  }
  setStatus(`正在拉取 ${symbol} 行情...`);
  els.fetchBtn.disabled = true;
  try {
    const response = await fetch(`/api/quote/${encodeURIComponent(symbol)}?range=${encodeURIComponent(els.rangeInput.value)}`);
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "行情接口返回失败");
    quoteData = data;
    setQuoteMetrics(data);
    drawChart(data.history || []);
    setStatus(`${data.symbol} 行情已更新`, "positive");
    calculate();
  } catch (error) {
    setStatus(error.message, "negative");
    els.dataMeta.textContent = `行情拉取失败：${error.message}`;
  } finally {
    els.fetchBtn.disabled = false;
  }
}

async function fetchOptionQuote() {
  const symbol = els.symbolInput.value.trim().toUpperCase();
  const occ = refreshContractCode();
  if (!symbol || !occ) {
    setStatus("请先输入完整期权合约", "warning");
    return;
  }

  setStatus(`正在拉取 ${occ} 期权报价...`);
  els.fetchOptionBtn.disabled = true;
  try {
    const response = await fetch(`/api/option/${encodeURIComponent(symbol)}?occ=${encodeURIComponent(occ)}`);
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "期权报价接口返回失败");
    optionQuoteData = data;
    const q = data.quote || {};
    if (Number.isFinite(q.bid)) els.bidInput.value = q.bid.toFixed(2);
    if (Number.isFinite(q.ask)) els.askInput.value = q.ask.toFixed(2);
    if (Number.isFinite(q.last)) els.lastInput.value = q.last.toFixed(2);
    if (Number.isFinite(q.mid)) els.marketPriceInput.value = q.mid.toFixed(2);
    if (Number.isFinite(data.underlying?.currentPrice)) els.spotInput.value = data.underlying.currentPrice.toFixed(2);
    els.optionQuoteMeta.textContent = `${data.source}，${q.lastTradeTime ? `最后成交 ${new Date(q.lastTradeTime).toLocaleString()}，` : ""}OI ${numberFmt(q.openInterest, 0)}，成交量 ${numberFmt(q.volume, 0)}`;
    setStatus(`${occ} 期权报价已更新`, "positive");
    calculate();
  } catch (error) {
    setStatus(error.message, "negative");
    els.optionQuoteMeta.textContent = `期权报价拉取失败：${error.message}。仍可手动输入市场价反推IV。`;
  } finally {
    els.fetchOptionBtn.disabled = false;
  }
}

function drawChart(history) {
  const canvas = els.priceCanvas;
  const ctx = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  if (!history.length) {
    ctx.fillStyle = "#60707c";
    ctx.font = "14px Segoe UI";
    ctx.fillText("暂无价格数据", 22, 40);
    return;
  }

  const padding = { left: 56, right: 18, top: 18, bottom: 34 };
  const values = history.map((row) => row.close).filter(Number.isFinite);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, max * 0.02, 1);
  const xFor = (index) => padding.left + (index / Math.max(history.length - 1, 1)) * (width - padding.left - padding.right);
  const yFor = (value) => padding.top + (1 - (value - min) / span) * (height - padding.top - padding.bottom);

  ctx.strokeStyle = "#d9e0e5";
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i += 1) {
    const y = padding.top + (i / 3) * (height - padding.top - padding.bottom);
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
  }

  ctx.strokeStyle = "#1d66d1";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  history.forEach((row, index) => {
    const x = xFor(index);
    const y = yFor(row.close);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  const latest = history[history.length - 1];
  const first = history[0];
  ctx.fillStyle = "#182026";
  ctx.font = "12px Segoe UI";
  ctx.fillText(numberFmt(max, 2), 10, yFor(max) + 4);
  ctx.fillText(numberFmt(min, 2), 10, yFor(min) + 4);
  ctx.fillStyle = "#60707c";
  ctx.fillText(first.date, padding.left, height - 12);
  const latestText = `${latest.date}  ${money(latest.close)}`;
  const textWidth = ctx.measureText(latestText).width;
  ctx.fillText(latestText, Math.max(padding.left, width - padding.right - textWidth), height - 12);
}

function attachEvents() {
  els.parseBtn.addEventListener("click", () => {
    try {
      applyContract(parseOptionContract(els.contractInput.value));
      setStatus("合约已解析", "positive");
    } catch (error) {
      setStatus(error.message, "negative");
    }
  });
  els.fetchBtn.addEventListener("click", fetchQuote);
  els.fetchOptionBtn.addEventListener("click", fetchOptionQuote);
  els.volWindowInput.addEventListener("change", () => applySelectedVol(true));
  els.dividendInput.addEventListener("input", () => {
    dividendTouched = true;
    calculate();
  });
  els.volInput.addEventListener("input", () => {
    volTouched = true;
    calculate();
  });

  [
    els.symbolInput,
    els.typeInput,
    els.expiryInput,
    els.strikeInput,
    els.spotInput,
    els.afterHoursInput,
    els.rateInput,
    els.stepsInput,
    els.contractSizeInput,
    els.marketPriceInput,
    els.bidInput,
    els.askInput,
    els.lastInput,
  ].forEach((el) => el.addEventListener("input", calculate));

  window.addEventListener("resize", () => {
    if (quoteData) drawChart(quoteData.history || []);
  });
}

function init() {
  attachEvents();
  try {
    applyContract(parseOptionContract(els.contractInput.value));
  } catch {
    calculate();
  }
  fetchQuote();
}

init();
