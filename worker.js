"use strict";

const ALPHA_VANTAGE_QUERY_URL = "https://www.alphavantage.co/query";
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PASSWORD_ITERATIONS = 600000;
const DUMMY_PASSWORD_SALT = "7f2e8a4c1d9b6f305a7c2e8d4b1f6093";
const SYMBOL_PATTERN = /^[A-Z0-9.^=-]{1,12}$/;
const EMAIL_PATTERN = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;
const STOCK_CACHE_TTL_SECONDS = 3600;
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
    headers["access-control-allow-methods"] = "GET, POST, DELETE, OPTIONS";
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

async function workerSecret(env, name) {
  let value = env[name];
  if (value && typeof value.get === "function") {
    value = await value.get();
  }
  return typeof value === "string" ? value.trim() : "";
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

async function fetchStockHistory(symbol, apiKey) {
  const cacheKey = new Request("https://northstar-stock-cache.invalid/" + encodeURIComponent(symbol));
  const cache = typeof caches !== "undefined" ? caches.default : null;
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      return cached.json();
    }
  }

  const url = new URL(ALPHA_VANTAGE_QUERY_URL);
  url.searchParams.set("function", "TIME_SERIES_DAILY");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("outputsize", "compact");
  url.searchParams.set("apikey", apiKey);
  const response = await fetch(url.toString(), { headers: { "accept": "application/json" } });
  if (!response.ok) {
    throw new Error("Market data provider returned HTTP " + response.status + " for " + symbol + ".");
  }
  const payload = await response.json();
  if (payload && (payload.Note || payload.Information)) {
    throw new Error("Alpha Vantage request limit or access restriction reached. Try again later.");
  }
  if (payload && payload["Error Message"]) {
    throw new Error("Alpha Vantage could not find historical data for " + symbol + ".");
  }
  const series = payload && payload["Time Series (Daily)"];
  if (!series || typeof series !== "object") {
    throw new Error("Alpha Vantage returned no daily prices for " + symbol + ".");
  }
  const history = Object.keys(series).sort().map(function (date) {
    const close = Number(series[date]["4. close"]);
    return { date: date, close: close };
  }).filter(function (item) {
    return Number.isFinite(item.close) && item.close > 0;
  });
  if (history.length < 30) {
    throw new Error("Not enough daily price history is available for " + symbol + ".");
  }
  const stock = {
    symbol: symbol,
    name: symbol,
    currency: "USD",
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
    history: target.history.slice(-65),
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
    const apiKey = await workerSecret(env, "ALPHA_VANTAGE_API_KEY");
    return {
      body: {
        provider: "Alpha Vantage",
        marketDataConfigured: Boolean(apiKey),
        accountsConfigured: accountsEnabled(env)
      },
      status: 200
    };
  }

  if (url.pathname === "/api/stocks" && request.method === "GET") {
    const apiKey = await workerSecret(env, "ALPHA_VANTAGE_API_KEY");
    if (!apiKey) {
      return jsonError("Stock market data is not configured. Add ALPHA_VANTAGE_API_KEY as a Worker secret.", 503);
    }
    const symbol = (url.searchParams.get("symbol") || "").trim().toUpperCase();
    if (!SYMBOL_PATTERN.test(symbol)) {
      return jsonError("Enter a valid stock symbol using letters, numbers, dots, carets, or hyphens.", 400);
    }
    const peers = COMPARABLES[symbol] || ["SPY", "QQQ"];
    const results = await Promise.allSettled(
      [symbol].concat(peers).map(function (ticker) { return fetchStockHistory(ticker, apiKey); })
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
    const now = Date.now();
    if (!await allowAuthRequest(emailInput, request, env, now)) {
      return jsonError("Too many account requests. Wait 15 minutes and try again.", 429);
    }
    const salt = randomSalt();
    const passwordHash = await hashPassword(password, salt, PASSWORD_ITERATIONS);
    const userId = crypto.randomUUID();
    const inserted = await env.DB.prepare(
      "INSERT INTO users (id, email, username, password_salt, password_hash, password_iterations, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING"
    ).bind(userId, emailInput, emailInput, salt, passwordHash, PASSWORD_ITERATIONS, now).run();
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
    return { body: { email: session.email }, status: 200 };
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
    const allowedOrigin = env.CORS_ORIGIN || "https://morgagemypyarlay.pages.dev";
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
          "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
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
