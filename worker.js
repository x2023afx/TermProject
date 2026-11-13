"use strict";

const API_ROOT = "https://api.the-odds-api.com/v4";
const ALLOWED_MARKETS = new Set(["h2h", "spreads", "totals"]);
const SPORT_KEY_PATTERN = /^[a-zA-Z0-9_-]+$/;

function jsonResponse(data, status, origin) {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  };
  if (origin) {
    headers["access-control-allow-origin"] = origin;
    headers.vary = "Origin";
    headers["access-control-allow-methods"] = "GET, OPTIONS";
    headers["access-control-allow-headers"] = "Content-Type";
  }
  return new Response(JSON.stringify(data), { status: status, headers: headers });
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

async function providerJson(endpoint, params, apiKey, env) {
  const url = new URL(API_ROOT + endpoint);
  url.searchParams.set("apiKey", apiKey);
  Object.keys(params).forEach(function (key) {
    url.searchParams.set(key, params[key]);
  });

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error("Sports data provider returned HTTP " + response.status + ".");
  }
  return response.json();
}

async function handleApi(url, env, apiKey) {
  if (url.pathname === "/api/status") {
    return { body: { provider: "The Odds API", configured: Boolean(apiKey) }, status: 200 };
  }

  if (!apiKey) {
    return {
      body: { error: "The server has not configured its sports data provider key." },
      status: 503
    };
  }

  if (url.pathname === "/api/sports") {
    const sports = await providerJson("/sports/", {}, apiKey, env);
    return {
      body: {
        sports: sports.filter(function (sport) { return sport.active; }).map(function (sport) {
          return { key: sport.key, title: sport.title, group: sport.group };
        })
      },
      status: 200
    };
  }

  if (url.pathname === "/api/events") {
    const sport = url.searchParams.get("sport") || "";
    const market = url.searchParams.get("market") || "h2h";
    if (!SPORT_KEY_PATTERN.test(sport)) {
      return { body: { error: "Choose a valid sport from the available list." }, status: 400 };
    }
    if (!ALLOWED_MARKETS.has(market)) {
      return { body: { error: "Choose a supported odds market." }, status: 400 };
    }

    const results = await Promise.allSettled([
      providerJson("/sports/" + sport + "/scores/", { daysFrom: "1" }, apiKey, env),
      providerJson("/sports/" + sport + "/odds/", {
        regions: env.ODDS_REGIONS || "us",
        markets: market,
        oddsFormat: "american",
        dateFormat: "iso"
      }, apiKey, env)
    ]);

    if (results[0].status === "rejected" && results[1].status === "rejected") {
      return {
        body: { error: "The provider could not load scores or odds for this sport." },
        status: 502
      };
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
    return {
      body: {
        updatedAt: new Date().toISOString(),
        warnings: warnings,
        events: normalizeEvents(scores, odds)
      },
      status: 200
    };
  }

  return { body: { error: "API route not found." }, status: 404 };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const allowedOrigin = env.CORS_ORIGIN || "https://x2023afx.github.io";

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
          "access-control-allow-methods": "GET, OPTIONS",
          "access-control-allow-headers": "Content-Type",
          "vary": "Origin"
        }
      });
    }
    if (request.method !== "GET") {
      return jsonResponse({ error: "Only GET requests are supported." }, 405, origin);
    }

    try {
      const apiKey = env.THE_ODDS_API_KEY ||
        (env.ODDS_KEY_STORE ? await env.ODDS_KEY_STORE.get() : null);
      const result = await handleApi(url, env, apiKey);
      return jsonResponse(result.body, result.status, origin);
    } catch (error) {
      return jsonResponse({
        error: error.message || "Sports data provider request failed."
      }, 502, origin);
    }
  }
};
