"use strict";

const http = require("node:http");
const path = require("node:path");

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const API_KEY = process.env.THE_ODDS_API_KEY;
const ODDS_REGIONS = process.env.ODDS_REGIONS || "us";
const CORS_ORIGINS = (process.env.CORS_ORIGINS || "http://127.0.0.1:3000,http://localhost:3000")
  .split(",")
  .map(function (origin) { return origin.trim().replace(/\/+$/, ""); })
  .filter(Boolean);
const API_ROOT = "https://api.the-odds-api.com/v4";
const CACHE_MS = 15000;
const RATE_WINDOW_MS = 60000;
const RATE_LIMIT = 20;
const cache = new Map();
const requestCounts = new Map();
const fs = require("node:fs");
const publicFiles = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"],
  "/data.js": ["data.js", "text/javascript; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"]
};

function sendJson(response, status, data) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(data));
}

function setCorsHeaders(request, response) {
  const origin = request.headers.origin;
  if (!origin) {
    return true;
  }
  if (!CORS_ORIGINS.includes(origin.replace(/\/+$/, ""))) {
    return false;
  }
  response.setHeader("access-control-allow-origin", origin);
  response.setHeader("vary", "Origin");
  response.setHeader("access-control-allow-methods", "GET, OPTIONS");
  response.setHeader("access-control-allow-headers", "Content-Type");
  return true;
}

function providerUrl(endpoint, params) {
  const url = new URL(API_ROOT + endpoint);
  url.searchParams.set("apiKey", API_KEY);
  Object.keys(params).forEach(function (key) {
    url.searchParams.set(key, params[key]);
  });
  return url.toString();
}

async function providerJson(endpoint, params, cacheMs) {
  const url = providerUrl(endpoint, params);
  const existing = cache.get(url);
  if (existing && Date.now() - existing.createdAt < cacheMs) {
    return existing.data;
  }

  const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) {
    throw new Error("Sports data provider returned HTTP " + response.status + ".");
  }

  const data = await response.json();
  cache.set(url, { createdAt: Date.now(), data: data });
  return data;
}

function normalizeEvents(scores, odds) {
  const events = new Map();
  scores.forEach(function (item) {
    events.set(item.id, {
      id: item.id,
      homeTeam: item.home_team,
      awayTeam: item.away_team,
      commenceTime: item.commence_time,
      completed: Boolean(item.completed),
      inProgress: !item.completed && Array.isArray(item.scores) && item.scores.length > 0,
      scores: (item.scores || []).map(function (score) {
        return { name: score.name, score: score.score };
      }),
      bookmakers: []
    });
  });

  odds.forEach(function (item) {
    const event = events.get(item.id) || {
      id: item.id,
      homeTeam: item.home_team,
      awayTeam: item.away_team,
      commenceTime: item.commence_time,
      completed: false,
      inProgress: false,
      scores: [],
      bookmakers: []
    };
    event.bookmakers = (item.bookmakers || []).map(function (bookmaker) {
      return {
        title: bookmaker.title,
        markets: (bookmaker.markets || []).map(function (market) {
          return {
            key: market.key,
            outcomes: (market.outcomes || []).map(function (outcome) {
              return {
                name: outcome.name,
                price: outcome.price,
                point: outcome.point
              };
            })
          };
        })
      };
    });
    events.set(item.id, event);
  });

  return Array.from(events.values()).sort(function (a, b) {
    if (a.inProgress !== b.inProgress) {
      return a.inProgress ? -1 : 1;
    }
    return new Date(a.commenceTime) - new Date(b.commenceTime);
  });
}

function allowRequest(clientIp) {
  const now = Date.now();
  const record = requestCounts.get(clientIp);
  if (!record || now - record.startedAt >= RATE_WINDOW_MS) {
    requestCounts.set(clientIp, { startedAt: now, count: 1 });
    if (requestCounts.size > 2000) {
      requestCounts.forEach(function (item, ip) {
        if (now - item.startedAt >= RATE_WINDOW_MS) {
          requestCounts.delete(ip);
        }
      });
    }
    return true;
  }
  if (record.count >= RATE_LIMIT) {
    return false;
  }
  record.count += 1;
  return true;
}

async function handleApi(requestUrl, response) {
  if (requestUrl.pathname === "/api/status") {
    sendJson(response, 200, { provider: "The Odds API", configured: Boolean(API_KEY) });
    return;
  }

  if (!API_KEY) {
    sendJson(response, 503, {
      error: "Live data is not configured. Set THE_ODDS_API_KEY in the server environment and restart."
    });
    return;
  }

  if (requestUrl.pathname === "/api/sports") {
    const sports = await providerJson("/sports/", {}, 60000);
    sendJson(response, 200, {
      sports: sports.filter(function (sport) { return sport.active; }).map(function (sport) {
        return { key: sport.key, title: sport.title, group: sport.group };
      })
    });
    return;
  }

  if (requestUrl.pathname === "/api/events") {
    const sport = requestUrl.searchParams.get("sport") || "";
    const market = requestUrl.searchParams.get("market") || "h2h";
    if (!/^[a-zA-Z0-9_-]+$/.test(sport)) {
      sendJson(response, 400, { error: "Choose a valid sport from the available list." });
      return;
    }
    if (!["h2h", "spreads", "totals"].includes(market)) {
      sendJson(response, 400, { error: "Choose a supported odds market." });
      return;
    }

    const results = await Promise.allSettled([
      providerJson("/sports/" + sport + "/scores/", { daysFrom: "1" }, CACHE_MS),
      providerJson("/sports/" + sport + "/odds/", {
        regions: ODDS_REGIONS,
        markets: market,
        oddsFormat: "american",
        dateFormat: "iso"
      }, CACHE_MS)
    ]);
    if (results[0].status === "rejected" && results[1].status === "rejected") {
      throw new Error("The provider could not load scores or odds for this sport.");
    }
    const scores = results[0].status === "fulfilled" ? results[0].value : [];
    const odds = results[1].status === "fulfilled" ? results[1].value : [];
    const warnings = [];
    if (results[0].status === "rejected") {
      warnings.push("Live scores are unavailable for this sport from the provider.");
    }
    if (results[1].status === "rejected") {
      warnings.push("Odds are unavailable for this sport or market from the provider.");
    }
    sendJson(response, 200, {
      updatedAt: new Date().toISOString(),
      warnings: warnings,
      events: normalizeEvents(scores, odds)
    });
    return;
  }

  sendJson(response, 404, { error: "API route not found." });
}

function servePublicFile(requestUrl, response) {
  const file = publicFiles[requestUrl.pathname];
  if (!file) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const filename = path.join(__dirname, file[0]);
  fs.readFile(filename, function (error, contents) {
    if (error) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end("Could not read the app file.");
      return;
    }
    response.writeHead(200, {
      "content-type": file[1],
      "cache-control": "no-cache",
      "x-content-type-options": "nosniff"
    });
    response.end(contents);
  });
}

const server = http.createServer(function (request, response) {
  const requestUrl = new URL(request.url, "http://localhost");
  if (requestUrl.pathname.indexOf("/api/") === 0 && !setCorsHeaders(request, response)) {
    sendJson(response, 403, { error: "This website is not allowed to use the API." });
    return;
  }
  if (request.method === "OPTIONS" && requestUrl.pathname.indexOf("/api/") === 0) {
    response.writeHead(204);
    response.end();
    return;
  }
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Only GET requests are supported." });
    return;
  }

  if (requestUrl.pathname.indexOf("/api/") === 0) {
    if (!allowRequest(request.socket.remoteAddress || "unknown")) {
      sendJson(response, 429, { error: "Too many requests. Wait a minute before refreshing again." });
      return;
    }
    handleApi(requestUrl, response).catch(function (error) {
      sendJson(response, 502, { error: error.message || "Sports data provider request failed." });
    });
    return;
  }
  servePublicFile(requestUrl, response);
});

server.listen(PORT, HOST, function () {
  console.log("Pace & Pattern is available at http://127.0.0.1:" + PORT);
});
