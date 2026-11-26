"use strict";

const YAHOO_CHART_URL = "https://query2.finance.yahoo.com/v8/finance/chart/";
const YAHOO_SEARCH_URL = "https://query1.finance.yahoo.com/v1/finance/search";
const YAHOO_TRENDING_URL = "https://query1.finance.yahoo.com/v1/finance/trending/US";
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PASSWORD_ITERATIONS = 100000;
const DUMMY_PASSWORD_SALT = "7f2e8a4c1d9b6f305a7c2e8d4b1f6093";
const SYMBOL_PATTERN = /^[A-Z0-9.^=-]{1,12}$/;
const EMAIL_PATTERN = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;
const STOCK_CACHE_TTL_SECONDS = 3600;
const MARKET_MOVER_SYMBOLS = [
  "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA",
  "JPM", "V", "WMT", "XOM", "SPY", "QQQ"
];
const MARKET_MOVER_RANGE_COUNTS = { "1w": 5, "1m": 22, "3m": 65, "6m": 130, "1y": 260, "5y": 1300 };
const COMPARABLES = {
  AAPL: ["MSFT", "GOOGL", "QQQ"],
  MSFT: ["AAPL", "GOOGL", "QQQ"],
  NVDA: ["AMD", "AVGO", "QQQ"],
  AMD: ["NVDA", "AVGO", "QQQ"],
  AMZN: ["WMT", "TGT", "QQQ"],
  GOOGL: ["META", "MSFT", "QQQ"],
  META: ["GOOGL", "SNAP", "QQQ"],
  TSLA: ["GM", "F", "QQQ"],
  JPM: ["BAC", "WFC", "XLF"],
  V: ["MA", "AXP", "SPY"],
  WMT: ["COST", "TGT", "SPY"],
  XOM: ["CVX", "COP", "XLE"],
  SPY: ["QQQ", "DIA", "IWM"],
  QQQ: ["SPY", "DIA", "IWM"]
};

function accountsEnabled(env) {
  return env.ACCOUNTS_ENABLED === "true" && Boolean(env.DB);
}

function jsonResponse(data, status, origin) {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  };
  if (origin) {
    headers["access-control-allow-origin"] = origin;
    headers.vary = "Origin";
    headers["access-control-allow-methods"] = "GET, POST, PUT, DELETE, OPTIONS";
    headers["access-control-allow-headers"] = "Content-Type, Authorization";
  }
  return new Response(JSON.stringify(data), { status: status, headers: headers });
}

function jsonError(message, status) {
  return { body: { error: message }, status: status };
}

function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, function (byte) {
    return byte.toString(16).padStart(2, "0");
  }).join("");
}

async function hashValue(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), function (byte) {
    return byte.toString(16).padStart(2, "0");
  }).join("");
}

function bytesToHex(bytes) {
  return Array.from(bytes, function (byte) {
    return byte.toString(16).padStart(2, "0");
  }).join("");
}

function hexToBytes(value) {
  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function hashPassword(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    hash: "SHA-256",
    salt: hexToBytes(salt),
    iterations: iterations
  }, key, 256);
  return bytesToHex(new Uint8Array(bits));
}

function equalHexValues(left, right) {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    difference |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  }
  return difference === 0;
}

function validEmail(value) {
  return typeof value === "string" && value.length <= 254 && EMAIL_PATTERN.test(value);
}

function validPassword(value) {
  return typeof value === "string" && value.length >= 12 && value.length <= 128;
}

function validProfileField(value, maxLength) {
  return typeof value === "string" && value.trim().length <= maxLength;
}

function validRequiredProfileField(value, maxLength) {
  return validProfileField(value, maxLength) && value.trim().length > 0;
}

function validPhone(value) {
  return typeof value === "string" && /^\d{3}-\d{3}-\d{4}$/.test(value);
}

function validPostalCode(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9 -]{0,23}$/.test(value);
}

function randomSalt() {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
}

async function readJson(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 10000) {
    throw new Error("Request is too large.");
  }
  try {
    return await request.json();
  } catch (error) {
    throw new Error("Request body must be valid JSON.");
  }
}

async function allowAuthRequest(email, request, env, now) {
  const emailHash = await hashValue(email);
  const sourceIp = request.headers.get("CF-Connecting-IP") || "unknown";
  const ipHash = await hashValue(sourceIp);
  await env.DB.prepare("DELETE FROM auth_requests WHERE created_at < ?").bind(now - 3600000).run();
  const limits = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS count FROM auth_requests WHERE email_hash = ? AND created_at > ?")
      .bind(emailHash, now - 900000),
    env.DB.prepare("SELECT COUNT(*) AS count FROM auth_requests WHERE ip_hash = ? AND created_at > ?")
      .bind(ipHash, now - 900000)
  ]);
  if (limits[0].results[0].count >= 5 || limits[1].results[0].count >= 20) {
    return false;
  }
  await env.DB.prepare(
    "INSERT INTO auth_requests (email_hash, ip_hash, created_at) VALUES (?, ?, ?)"
  ).bind(emailHash, ipHash, now).run();
  return true;
}

async function createSession(userId, env, now) {
  const token = newToken();
  const expiresAt = now + TOKEN_TTL_MS;
  await env.DB.prepare(
    "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)"
  ).bind(await hashValue(token), userId, expiresAt, now).run();
  return { token: token, expiresAt: expiresAt };
}

async function getSession(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  const match = authorization.match(/^Bearer\s+([a-f0-9]{64})$/i);
  if (!match || !env.DB) {
    return null;
  }
  const tokenHash = await hashValue(match[1]);
  return env.DB.prepare(
    "SELECT users.id AS id, users.email AS email FROM sessions " +
    "JOIN users ON users.id = sessions.user_id " +
    "WHERE sessions.token_hash = ? AND sessions.expires_at > ?"
  ).bind(tokenHash, Date.now()).first();
}

async function fetchStockHistory(symbol) {
  const cacheKey = new Request("https://northstar-stock-cache-yahoo.invalid/" + encodeURIComponent(symbol));
  const cache = typeof caches !== "undefined" ? caches.default : null;
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      return cached.json();
    }
  }

  const url = new URL(encodeURIComponent(symbol), YAHOO_CHART_URL);
  url.searchParams.set("range", "5y");
  url.searchParams.set("interval", "1d");
  const response = await fetch(url.toString(), {
    headers: {
      "accept": "application/json",
      "user-agent": "Mozilla/5.0 (compatible; CrystalBallStocks market research)"
    }
  });
  if (!response.ok) {
    if (response.status === 429) {
      throw new Error("Yahoo Finance is rate-limiting stock data. Try again later.");
    }
    throw new Error("Yahoo Finance returned HTTP " + response.status + " for " + symbol + ".");
  }
  const payload = await response.json();
  const result = payload && payload.chart && payload.chart.result && payload.chart.result[0];
  if (payload && payload.chart && payload.chart.error) {
    throw new Error("Yahoo Finance could not find historical data for " + symbol + ".");
  }
  const timestamps = result && result.timestamp;
  const closes = result && result.indicators && result.indicators.quote &&
    result.indicators.quote[0] && result.indicators.quote[0].close;
  if (!Array.isArray(timestamps) || !Array.isArray(closes)) {
    throw new Error("Yahoo Finance returned no daily prices for " + symbol + ".");
  }
  const metadata = result.meta || {};
  const history = timestamps.map(function (timestamp, index) {
    const date = new Date(timestamp * 1000);
    const close = Number(closes[index]);
    return {
      date: Number.isFinite(timestamp) && Number.isFinite(date.getTime())
        ? date.toISOString().slice(0, 10)
        : "",
      close: close
    };
  }).filter(function (item) {
    return Number.isFinite(item.close) && item.close > 0 && /^\d{4}-\d{2}-\d{2}$/.test(item.date);
  });
  if (history.length < 30) {
    throw new Error("Not enough daily price history is available for " + symbol + ".");
  }
  const stock = {
    symbol: metadata.symbol || symbol,
    name: metadata.longName || metadata.shortName || symbol,
    currency: metadata.currency || "USD",
    history: history
  };
  if (cache) {
    await cache.put(cacheKey, new Response(JSON.stringify(stock), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=" + STOCK_CACHE_TTL_SECONDS
      }
    }));
  }
  return stock;
}

async function searchStocks(query) {
  const url = new URL(YAHOO_SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("quotesCount", "10");
  url.searchParams.set("newsCount", "0");
  const response = await fetch(url.toString(), {
    headers: {
      "accept": "application/json",
      "user-agent": "Mozilla/5.0 (compatible; CrystalBallStocks market research)"
    }
  });
  if (!response.ok) {
    throw new Error("Yahoo Finance search returned HTTP " + response.status + ".");
  }
  const payload = await response.json();
  const quotes = payload && Array.isArray(payload.quotes) ? payload.quotes : [];
  return quotes.filter(function (quote) {
    return quote && (quote.quoteType === "EQUITY" || quote.quoteType === "ETF") &&
      typeof quote.symbol === "string" && SYMBOL_PATTERN.test(quote.symbol);
  }).slice(0, 10).map(function (quote) {
    return {
      symbol: quote.symbol,
      name: typeof quote.longname === "string" ? quote.longname :
        typeof quote.shortname === "string" ? quote.shortname : quote.symbol
    };
  });
}

async function fetchMarketNews() {
  const url = new URL(YAHOO_SEARCH_URL);
  url.searchParams.set("q", "stock market");
  url.searchParams.set("quotesCount", "0");
  url.searchParams.set("newsCount", "15");
  const response = await fetch(url.toString(), {
    headers: {
      "accept": "application/json",
      "user-agent": "Mozilla/5.0 (compatible; CrystalBallStocks market research)"
    }
  });
  if (!response.ok) {
    throw new Error("Yahoo Finance news returned HTTP " + response.status + ".");
  }
  const payload = await response.json();
  const news = payload && Array.isArray(payload.news) ? payload.news : [];
  const stories = news.filter(function (story) {
    return story && typeof story.title === "string" && typeof story.link === "string" &&
      /^https?:\/\//i.test(story.link);
  }).slice(0, 15).map(function (story) {
    const published = Number.isFinite(story.providerPublishTime)
      ? new Date(story.providerPublishTime * 1000)
      : null;
    const resolutions = story.thumbnail && Array.isArray(story.thumbnail.resolutions)
      ? story.thumbnail.resolutions
      : [];
    const thumbnail = resolutions.slice().reverse().find(function (resolution) {
      if (!resolution || typeof resolution.url !== "string") {
        return false;
      }
      try {
        const imageUrl = new URL(resolution.url);
        return imageUrl.protocol === "https:" || imageUrl.protocol === "http:";
      } catch (error) {
        return false;
      }
    });
    return {
      title: story.title,
      publisher: typeof story.publisher === "string" ? story.publisher : "Yahoo Finance",
      link: story.link,
      imageUrl: thumbnail ? thumbnail.url : "",
      publishedAt: published && Number.isFinite(published.getTime())
        ? published.toISOString()
        : ""
    };
  });
  return stories;
}

async function fetchTrendingSymbols() {
  const url = new URL(YAHOO_TRENDING_URL);
  url.searchParams.set("count", "30");
  const response = await fetch(url.toString(), {
    headers: {
      "accept": "application/json",
      "user-agent": "Mozilla/5.0 (compatible; CrystalBallStocks market research)"
    }
  });
  if (!response.ok) {
    throw new Error("Yahoo Finance trending stocks returned HTTP " + response.status + ".");
  }
  const payload = await response.json();
  const results = payload && payload.finance && Array.isArray(payload.finance.result)
    ? payload.finance.result
    : [];
  const quotes = results[0] && Array.isArray(results[0].quotes) ? results[0].quotes : [];
  return Array.from(new Set(quotes.map(function (quote) {
    return quote && typeof quote.symbol === "string" ? quote.symbol.toUpperCase() : "";
  }).filter(function (symbol) {
    return SYMBOL_PATTERN.test(symbol);
  }))).slice(0, 20);
}

async function fetchSymbolHeadlines(symbol) {
  const url = new URL(YAHOO_SEARCH_URL);
  url.searchParams.set("q", symbol);
  url.searchParams.set("quotesCount", "0");
  url.searchParams.set("newsCount", "3");
  const response = await fetch(url.toString(), {
    headers: {
      "accept": "application/json",
      "user-agent": "Mozilla/5.0 (compatible; CrystalBallStocks market research)"
    }
  });
  if (!response.ok) {
    throw new Error("Yahoo Finance news returned HTTP " + response.status + " for " + symbol + ".");
  }
  const payload = await response.json();
  const news = payload && Array.isArray(payload.news) ? payload.news : [];
  return news.filter(function (story) {
    return story && typeof story.title === "string" && typeof story.link === "string" &&
      /^https?:\/\//i.test(story.link);
  }).slice(0, 2).map(function (story) {
    return {
      title: story.title,
      publisher: typeof story.publisher === "string" ? story.publisher : "Yahoo Finance",
      link: story.link
    };
  });
}

function mean(values) {
  return values.reduce(function (sum, value) { return sum + value; }, 0) / values.length;
}

function standardDeviation(values, average) {
  if (values.length < 2) {
    return 0;
  }
  const variance = values.reduce(function (sum, value) {
    return sum + Math.pow(value - average, 2);
  }, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function buildStockResponse(symbol, target, peerData) {
  const peerSeries = peerData.map(function (peer) {
    return {
      symbol: peer.symbol,
      name: peer.name,
      prices: new Map(peer.history.map(function (item) { return [item.date, item.close]; }))
    };
  });
  const targetPrices = new Map(target.history.map(function (item) { return [item.date, item.close]; }));
  const returns = [];
  for (let i = 1; i < target.history.length; i += 1) {
    const prior = target.history[i - 1];
    const current = target.history[i];
    const peerReturns = peerSeries.map(function (peer) {
      const previousClose = peer.prices.get(prior.date);
      const currentClose = peer.prices.get(current.date);
      return Number.isFinite(previousClose) && Number.isFinite(currentClose) && previousClose > 0
        ? currentClose / previousClose - 1
        : null;
    }).filter(function (value) { return value !== null; });
    if (peerReturns.length) {
      returns.push({
        date: current.date,
        target: current.close / prior.close - 1,
        peers: mean(peerReturns)
      });
    }
  }

  if (returns.length < 30) {
    throw new Error("There is not enough aligned history between this stock and its comparisons.");
  }

  const recent = returns.slice(-60);
  const modelReturns = recent.map(function (item) {
    return 0.6 * item.target + 0.4 * item.peers;
  });
  const dailyMean = mean(modelReturns);
  const dailyDeviation = standardDeviation(modelReturns, dailyMean);
  const currentPrice = target.history[target.history.length - 1].close;
  const forecast = [];
  for (let session = 1; session <= 2; session += 1) {
    const point = currentPrice * Math.pow(1 + dailyMean, session);
    const margin = 1.2816 * dailyDeviation * Math.sqrt(session);
    forecast.push({
      session: session,
      price: point,
      low: Math.max(0, point * (1 - margin)),
      high: point * (1 + margin)
    });
  }

  const comparableRows = peerSeries.map(function (peer) {
    const aligned = target.history.filter(function (item) { return peer.prices.has(item.date); });
    if (aligned.length < 2) {
      return null;
    }
    const start = aligned[Math.max(0, aligned.length - 21)];
    const end = aligned[aligned.length - 1];
    return {
      symbol: peer.symbol,
      name: peer.name,
      return: peer.prices.get(end.date) / peer.prices.get(start.date) - 1
    };
  }).filter(Boolean);

  const backtestStart = Math.max(59, returns.length - 62);
  let backtestCount = 0;
  let correctCount = 0;
  for (let end = backtestStart; end <= returns.length - 3; end += 1) {
    const window = returns.slice(end - 59, end + 1).map(function (item) {
      return 0.6 * item.target + 0.4 * item.peers;
    });
    const expected = Math.pow(1 + mean(window), 2) - 1;
    const startPrice = targetPrices.get(returns[end].date);
    const futurePrice = targetPrices.get(returns[end + 2].date);
    if (!Number.isFinite(startPrice) || !Number.isFinite(futurePrice)) {
      continue;
    }
    const realized = futurePrice / startPrice - 1;
    if (expected !== 0 && realized !== 0) {
      backtestCount += 1;
      if ((expected > 0) === (realized > 0)) {
        correctCount += 1;
      }
    }
  }

  const previousClose = target.history.length > 1
    ? target.history[target.history.length - 2].close
    : currentPrice;
  const selectedPeers = peerData.map(function (peer) { return peer.symbol; });
  return {
    symbol: symbol,
    name: target.name,
    currency: target.currency,
    price: currentPrice,
    change: currentPrice - previousClose,
    changePercent: currentPrice / previousClose - 1,
    priceDate: target.history[target.history.length - 1].date,
    updatedAt: new Date().toISOString(),
    history: target.history.slice(-1300),
    forecast: forecast,
    projectionPercent: Math.pow(1 + dailyMean, 2) - 1,
    comparables: comparableRows,
    model: {
      returnObservations: recent.length,
      comparables: selectedPeers,
      backtestCount: backtestCount,
      directionalAccuracy: backtestCount >= 10 ? correctCount / backtestCount : null
    }
  };
}

async function handleApi(request, url, env) {
  if (url.pathname === "/api/status" && request.method === "GET") {
    return {
      body: {
        provider: "Yahoo Finance",
        marketDataConfigured: true,
        accountsConfigured: accountsEnabled(env)
      },
      status: 200
    };
  }

  if (url.pathname === "/api/stocks" && request.method === "GET") {
    const symbol = (url.searchParams.get("symbol") || "").trim().toUpperCase();
    if (!SYMBOL_PATTERN.test(symbol)) {
      return jsonError("Enter a valid stock symbol using letters, numbers, dots, carets, or hyphens.", 400);
    }
    const peers = COMPARABLES[symbol] || ["SPY", "QQQ"];
    const results = await Promise.allSettled(
      [symbol].concat(peers).map(function (ticker) { return fetchStockHistory(ticker); })
    );
    if (results[0].status === "rejected") {
      return jsonError("Could not load " + symbol + ": " + results[0].reason.message, 502);
    }
    const peerData = results.slice(1).filter(function (result) {
      return result.status === "fulfilled";
    }).map(function (result) { return result.value; });
    if (!peerData.length) {
      return jsonError("Comparable market history is unavailable. Try again later.", 502);
    }
    const target = results[0].value;
    return { body: buildStockResponse(symbol, target, peerData), status: 200 };
  }

  if (url.pathname === "/api/news" && request.method === "GET") {
    return {
      body: { stories: await fetchMarketNews(), updatedAt: new Date().toISOString() },
      status: 200
    };
  }

  if (url.pathname === "/api/history" && request.method === "GET") {
    const symbol = (url.searchParams.get("symbol") || "").trim().toUpperCase();
    if (!SYMBOL_PATTERN.test(symbol)) {
      return jsonError("Enter a valid stock symbol.", 400);
    }
    const stock = await fetchStockHistory(symbol);
    return {
      body: { symbol: stock.symbol, name: stock.name, currency: stock.currency, history: stock.history },
      status: 200
    };
  }

  if (url.pathname === "/api/watchlist" && request.method === "GET") {
    const symbols = Array.from(new Set((url.searchParams.get("symbols") || "")
      .split(",").map(function (symbol) { return symbol.trim().toUpperCase(); }).filter(Boolean)));
    const period = url.searchParams.get("period") || "3m";
    if (!symbols.length || symbols.length > 8 || symbols.some(function (symbol) {
      return !SYMBOL_PATTERN.test(symbol);
    })) {
      return jsonError("Choose between 1 and 8 valid stock symbols.", 400);
    }
    if (!Object.prototype.hasOwnProperty.call(MARKET_MOVER_RANGE_COUNTS, period)) {
      return jsonError("Choose a supported watchlist timeframe.", 400);
    }
    const results = await Promise.allSettled(symbols.map(function (symbol) {
      return fetchStockHistory(symbol);
    }));
    const stocks = [];
    const unavailable = [];
    results.forEach(function (result, index) {
      if (result.status !== "fulfilled") {
        unavailable.push(symbols[index]);
        return;
      }
      const history = result.value.history;
      const recent = history.slice(-(MARKET_MOVER_RANGE_COUNTS[period] + 1));
      const start = recent[0];
      const latest = history[history.length - 1];
      const previous = history.length > 1 ? history[history.length - 2] : latest;
      stocks.push({
        symbol: result.value.symbol,
        name: result.value.name,
        currency: result.value.currency,
        price: latest.close,
        priceDate: latest.date,
        dailyChange: latest.close / previous.close - 1,
        periodReturn: latest.close / start.close - 1
      });
    });
    return {
      body: { stocks: stocks, unavailable: unavailable, updatedAt: new Date().toISOString() },
      status: 200
    };
  }

  if (url.pathname === "/api/stock-search" && request.method === "GET") {
    const query = (url.searchParams.get("q") || "").trim();
    if (query.length < 2 || query.length > 80) {
      return jsonError("Search with 2 to 80 characters.", 400);
    }
    return { body: { results: await searchStocks(query) }, status: 200 };
  }

  if (url.pathname === "/api/market-movers" && request.method === "GET") {
    const period = url.searchParams.get("period") || "3m";
    if (!Object.prototype.hasOwnProperty.call(MARKET_MOVER_RANGE_COUNTS, period)) {
      return jsonError("Choose a supported market timeframe.", 400);
    }
    const rangeCount = MARKET_MOVER_RANGE_COUNTS[period];
    const results = await Promise.allSettled(
      MARKET_MOVER_SYMBOLS.map(function (symbol) { return fetchStockHistory(symbol); })
    );
    const stocks = results.map(function (result) {
      return result.status === "fulfilled" ? result.value : null;
    }).filter(Boolean).map(function (stock) {
      const history = stock.history.slice(-(rangeCount + 1));
      const start = history[0];
      const end = history[history.length - 1];
      return {
        symbol: stock.symbol,
        name: stock.name,
        currency: stock.currency,
        price: end.close,
        periodReturn: end.close / start.close - 1,
        history: history
      };
    }).sort(function (left, right) {
      return right.periodReturn - left.periodReturn;
    });
    if (!stocks.length) {
      return jsonError("Popular stock history is unavailable. Try again later.", 502);
    }
    return {
      body: {
        period: period,
        updatedAt: new Date().toISOString(),
        stocks: stocks,
        unavailableCount: results.length - stocks.length
      },
      status: 200
    };
  }

  if (url.pathname === "/api/research-candidates" && request.method === "GET") {
    const period = url.searchParams.get("period") || "3m";
    if (!Object.prototype.hasOwnProperty.call(MARKET_MOVER_RANGE_COUNTS, period)) {
      return jsonError("Choose a supported research timeframe.", 400);
    }
    const symbols = await fetchTrendingSymbols();
    if (!symbols.length) {
      return jsonError("Yahoo Finance returned no currently trending stocks.", 502);
    }
    const historyResults = await Promise.allSettled(symbols.map(function (symbol) {
      return fetchStockHistory(symbol);
    }));
    const rangeCount = MARKET_MOVER_RANGE_COUNTS[period];
    const candidates = historyResults.map(function (result) {
      if (result.status !== "fulfilled") {
        return null;
      }
      const history = result.value.history.slice(-(rangeCount + 1));
      if (history.length < 2) {
        return null;
      }
      const first = history[0];
      const last = history[history.length - 1];
      const previous = result.value.history.length > 1
        ? result.value.history[result.value.history.length - 2]
        : last;
      return {
        symbol: result.value.symbol,
        name: result.value.name,
        currency: result.value.currency,
        price: last.close,
        priceDate: last.date,
        dailyChange: last.close / previous.close - 1,
        periodReturn: last.close / first.close - 1,
        history: history.map(function (item) {
          return { date: item.date, close: item.close };
        })
      };
    }).filter(Boolean).sort(function (left, right) {
      return Math.abs(right.periodReturn) - Math.abs(left.periodReturn);
    }).slice(0, 8);
    if (!candidates.length) {
      return jsonError("Historical trends are unavailable for trending stocks right now.", 502);
    }
    const headlineResults = await Promise.allSettled(candidates.map(function (stock) {
      return fetchSymbolHeadlines(stock.symbol);
    }));
    candidates.forEach(function (stock, index) {
      const result = headlineResults[index];
      stock.headlines = result.status === "fulfilled" ? result.value : [];
      stock.headlinesAvailable = result.status === "fulfilled";
    });
    return {
      body: {
        period: period,
        updatedAt: new Date().toISOString(),
        stocks: candidates,
        unavailableCount: historyResults.filter(function (result) {
          return result.status === "rejected";
        }).length
      },
      status: 200
    };
  }

  if (url.pathname === "/api/auth/register" && request.method === "POST") {
    if (!accountsEnabled(env)) {
      return jsonError("Accounts are not enabled for this deployment.", 503);
    }
    const body = await readJson(request);
    const emailInput = body && typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = body && body.password;
    if (!validEmail(emailInput)) {
      return jsonError("Enter a valid email address.", 400);
    }
    if (!validPassword(password)) {
      return jsonError("Use a password between 12 and 128 characters.", 400);
    }
    const profile = body && body.profile;
    const profileFields = [
      ["fullName", 120],
      ["phone", 40],
      ["streetAddress", 200],
      ["city", 100],
      ["region", 100],
      ["postalCode", 24],
      ["country", 100]
    ];
    if (!profile || typeof profile !== "object" || Array.isArray(profile) ||
      profileFields.some(function (field) {
        return !validRequiredProfileField(profile[field[0]], field[1]);
      }) || !validPhone(profile.phone) || !validPostalCode(profile.postalCode)) {
      return jsonError("Complete all required fields. Enter a valid phone number and postal code.", 400);
    }
    const now = Date.now();
    if (!await allowAuthRequest(emailInput, request, env, now)) {
      return jsonError("Too many account requests. Wait 15 minutes and try again.", 429);
    }
    const salt = randomSalt();
    const passwordHash = await hashPassword(password, salt, PASSWORD_ITERATIONS);
    const userId = crypto.randomUUID();
    const profileValues = profileFields.map(function (field) { return profile[field[0]].trim(); });
    const inserted = await env.DB.prepare(
      "INSERT INTO users (id, email, username, password_salt, password_hash, password_iterations, " +
      "full_name, phone, street_address, city, region, postal_code, country, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING"
    ).bind(
      userId, emailInput, emailInput, salt, passwordHash, PASSWORD_ITERATIONS,
      ...profileValues, now
    ).run();
    if (!inserted.meta || inserted.meta.changes !== 1) {
      return jsonError("An account already exists for that email address.", 409);
    }
    const session = await createSession(userId, env, now);
    return {
      body: { token: session.token, email: emailInput, expiresAt: session.expiresAt },
      status: 201
    };
  }

  if (url.pathname === "/api/auth/login" && request.method === "POST") {
    if (!accountsEnabled(env)) {
      return jsonError("Accounts are not enabled for this deployment.", 503);
    }
    const body = await readJson(request);
    const emailInput = body && typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = body && body.password;
    if (!validEmail(emailInput) || typeof password !== "string" || password.length > 128) {
      return jsonError("Enter a valid email address and password.", 400);
    }
    const now = Date.now();
    if (!await allowAuthRequest(emailInput, request, env, now)) {
      return jsonError("Too many sign-in attempts. Wait 15 minutes and try again.", 429);
    }
    const user = await env.DB.prepare(
      "SELECT id, email, password_salt, password_hash, password_iterations FROM users WHERE email = ?"
    ).bind(emailInput).first();
    const salt = user && /^[a-f0-9]{32}$/i.test(user.password_salt || "")
      ? user.password_salt
      : DUMMY_PASSWORD_SALT;
    const iterations = user && Number.isInteger(user.password_iterations) &&
      user.password_iterations >= 100000 && user.password_iterations <= 1000000
      ? user.password_iterations
      : PASSWORD_ITERATIONS;
    const passwordHash = await hashPassword(password, salt, iterations);
    if (!user || !user.password_hash || !equalHexValues(passwordHash, user.password_hash)) {
      return jsonError("Invalid email or password.", 401);
    }
    const session = await createSession(user.id, env, now);
    return {
      body: { token: session.token, email: user.email, expiresAt: session.expiresAt },
      status: 200
    };
  }

  if (url.pathname === "/api/auth/logout" && request.method === "POST") {
    if (env.DB) {
      const authorization = request.headers.get("Authorization") || "";
      const match = authorization.match(/^Bearer\s+([a-f0-9]{64})$/i);
      if (match) {
        await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
          .bind(await hashValue(match[1])).run();
      }
    }
    return { body: { loggedOut: true }, status: 200 };
  }

  if (url.pathname.indexOf("/api/") !== 0) {
    return jsonError("API route not found.", 404);
  }
  if (!accountsEnabled(env)) {
    return jsonError("Accounts are not enabled for this deployment.", 503);
  }
  const session = await getSession(request, env);
  if (!session) {
    return jsonError("Sign in to access your account.", 401);
  }
  if (url.pathname === "/api/me" && request.method === "GET") {
    const user = await env.DB.prepare(
      "SELECT email, full_name, phone, street_address, city, region, postal_code, country " +
      "FROM users WHERE id = ?"
    ).bind(session.id).first();
    if (!user) {
      return jsonError("Account not found.", 404);
    }
    return {
      body: {
        email: user.email,
        profile: {
          fullName: user.full_name || "",
          phone: user.phone || "",
          streetAddress: user.street_address || "",
          city: user.city || "",
          region: user.region || "",
          postalCode: user.postal_code || "",
          country: user.country || ""
        }
      },
      status: 200
    };
  }
  if (url.pathname === "/api/profile" && request.method === "PUT") {
    const body = await readJson(request);
    const profile = body && body.profile;
    const fields = [
      ["fullName", 120],
      ["phone", 40],
      ["streetAddress", 200],
      ["city", 100],
      ["region", 100],
      ["postalCode", 24],
      ["country", 100]
    ];
    if (!profile || typeof profile !== "object" || Array.isArray(profile) ||
      fields.some(function (field) {
        return !validProfileField(profile[field[0]], field[1]);
      }) || (profile.phone.trim() && !validPhone(profile.phone.trim())) ||
      (profile.postalCode.trim() && !validPostalCode(profile.postalCode.trim()))) {
      return jsonError("Check profile field lengths, phone number, and postal code.", 400);
    }
    const values = fields.map(function (field) { return profile[field[0]].trim() || null; });
    const update = env.DB.prepare(
      "UPDATE users SET full_name = ?, phone = ?, street_address = ?, city = ?, " +
      "region = ?, postal_code = ?, country = ? WHERE id = ?"
    );
    await update.bind(...values, session.id).run();
    return { body: { saved: true }, status: 200 };
  }
  if (url.pathname === "/api/account" && request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM auth_requests WHERE email_hash = ?")
      .bind(await hashValue(session.email)).run();
    await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(session.id).run();
    return { body: { deleted: true }, status: 200 };
  }
  return jsonError("API route not found.", 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const allowedOrigin = env.CORS_ORIGIN || "https://crystalballstocks.pages.dev";
    if (origin && origin !== allowedOrigin) {
      return jsonResponse({ error: "This website is not allowed to use the API." }, 403);
    }
    if (url.pathname.indexOf("/api/") !== 0) {
      return jsonResponse({ error: "API route not found." }, 404, origin);
    }
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": origin || allowedOrigin,
          "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
          "access-control-allow-headers": "Content-Type, Authorization",
          vary: "Origin"
        }
      });
    }
    try {
      const result = await handleApi(request, url, env);
      return jsonResponse(result.body, result.status, origin);
    } catch (error) {
      return jsonResponse({ error: error.message || "Request failed." }, 500, origin);
    }
  }
};
