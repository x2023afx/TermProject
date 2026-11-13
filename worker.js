"use strict";

const API_ROOT = "https://api.the-odds-api.com/v4";
const RESEND_ROOT = "https://api.resend.com/emails";
const ALLOWED_MARKETS = new Set(["h2h", "spreads", "totals"]);
const ALLOWED_OUTCOMES = new Set(["pending", "won", "lost", "push"]);
const SPORT_KEY_PATTERN = /^[a-zA-Z0-9_-]+$/;
const TOKEN_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function accountsEnabled(env) {
  return env.ACCOUNTS_ENABLED === "true" && Boolean(env.DB && env.RESEND_API_KEY);
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
    headers["access-control-allow-methods"] = "GET, POST, PATCH, DELETE, OPTIONS";
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
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), function (byte) {
    return byte.toString(16).padStart(2, "0");
  }).join("");
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

async function providerJson(endpoint, params, apiKey) {
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

async function sendLoginEmail(email, token, env) {
  if (!env.RESEND_API_KEY) {
    throw new Error("Email sign-in is not configured. Add the RESEND_API_KEY Worker secret.");
  }
  const siteUrl = (env.SITE_URL || "https://x2023afx.github.io/TermProject").replace(/\/+$/, "");
  const link = siteUrl + "/?auth=" + encodeURIComponent(token) + "#account";
  const response = await fetch(RESEND_ROOT, {
    method: "POST",
    headers: {
      "authorization": "Bearer " + env.RESEND_API_KEY,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM || "Pace & Pattern <onboarding@resend.dev>",
      to: [email],
      subject: "Your Pace & Pattern sign-in link",
      text: "Use this link within 15 minutes to sign in to Pace & Pattern:\n\n" + link +
        "\n\nIf you did not request this, you can ignore this email.",
      html: "<p>Use this link within 15 minutes to sign in to Pace &amp; Pattern:</p>" +
        '<p><a href="' + link + '">Sign in</a></p>' +
        "<p>If you did not request this, you can ignore this email.</p>"
    })
  });
  if (!response.ok) {
    throw new Error("The email provider could not send the sign-in link. Check its API key and verified sender.");
  }
}

async function getSession(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  const match = authorization.match(/^Bearer ([a-f0-9]{64})$/i);
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

function moneyCents(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= 100000000;
}

function validateBet(body) {
  if (!body || typeof body !== "object") {
    return "Provide bet details.";
  }
  const fields = ["eventName", "market", "selection"];
  if (fields.some(function (key) {
    return typeof body[key] !== "string" || !body[key].trim() || body[key].trim().length > 160;
  })) {
    return "Enter a game, market, and selection (up to 160 characters each).";
  }
  if (!Number.isInteger(body.americanOdds) ||
      (body.americanOdds > -100 && body.americanOdds < 100) ||
      body.americanOdds < -100000 || body.americanOdds > 100000) {
    return "Enter valid American odds, such as -110 or +150.";
  }
  if (!moneyCents(body.stakeCents)) {
    return "Enter a stake greater than zero.";
  }
  if (!ALLOWED_OUTCOMES.has(body.outcome)) {
    return "Choose pending, won, lost, or push.";
  }
  const placedAt = Number(body.placedAt);
  if (!Number.isSafeInteger(placedAt) || placedAt < 0 || placedAt > Date.now() + 86400000) {
    return "Enter a valid bet date.";
  }
  return null;
}

async function handleApi(request, url, env) {
  if (url.pathname === "/api/status" && request.method === "GET") {
    const oddsKey = env.THE_ODDS_API_KEY ||
      (env.ODDS_KEY_STORE ? await env.ODDS_KEY_STORE.get() : null);
    return {
      body: {
        provider: "The Odds API",
        configured: Boolean(oddsKey),
        accountsConfigured: accountsEnabled(env)
      },
      status: 200
    };
  }

  if (url.pathname === "/api/auth/request" && request.method === "POST") {
    if (!accountsEnabled(env)) {
      return jsonError("Email accounts are not configured on the backend yet.", 503);
    }
    const body = await readJson(request);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonError("Enter a valid email address.", 400);
    }

    const now = Date.now();
    const emailHash = await hashValue(email);
    const sourceIp = request.headers.get("CF-Connecting-IP") || "unknown";
    const ipHash = await hashValue(sourceIp);
    await env.DB.prepare("DELETE FROM auth_requests WHERE created_at < ?").bind(now - 3600000).run();
    await env.DB.prepare("DELETE FROM login_tokens WHERE expires_at < ?").bind(now).run();
    await env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now).run();
    const limits = await env.DB.batch([
      env.DB.prepare("SELECT COUNT(*) AS count FROM auth_requests WHERE email_hash = ? AND created_at > ?")
        .bind(emailHash, now - 900000),
      env.DB.prepare("SELECT COUNT(*) AS count FROM auth_requests WHERE ip_hash = ? AND created_at > ?")
        .bind(ipHash, now - 900000)
    ]);
    if (limits[0].results[0].count >= 3 || limits[1].results[0].count >= 10) {
      return jsonError("Too many sign-in requests. Wait 15 minutes and try again.", 429);
    }

    const token = newToken();
    await env.DB.prepare(
      "INSERT INTO auth_requests (email_hash, ip_hash, created_at) VALUES (?, ?, ?)"
    ).bind(emailHash, ipHash, now).run();
    await env.DB.prepare(
      "INSERT INTO login_tokens (token_hash, email, expires_at, created_at) VALUES (?, ?, ?, ?)"
    ).bind(await hashValue(token), email, now + TOKEN_TTL_MS, now).run();
    try {
      await sendLoginEmail(email, token, env);
    } catch (error) {
      await env.DB.prepare("DELETE FROM login_tokens WHERE token_hash = ?").bind(await hashValue(token)).run();
      throw error;
    }
    return {
      body: { message: "If the address can receive email, a sign-in link is on its way. It expires in 15 minutes." },
      status: 200
    };
  }

  if (url.pathname === "/api/auth/verify" && request.method === "POST") {
    if (!accountsEnabled(env)) {
      return jsonError("Email accounts are not configured on the backend yet.", 503);
    }
    const body = await readJson(request);
    const token = typeof body.token === "string" ? body.token : "";
    if (!/^[a-f0-9]{64}$/i.test(token)) {
      return jsonError("That sign-in link is invalid or expired. Request a new one.", 400);
    }
    const now = Date.now();
    const tokenHash = await hashValue(token);
    const login = await env.DB.prepare(
      "SELECT email FROM login_tokens WHERE token_hash = ? AND expires_at > ?"
    ).bind(tokenHash, now).first();
    if (!login) {
      return jsonError("That sign-in link is invalid or expired. Request a new one.", 401);
    }

    const userId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO users (id, email, created_at) VALUES (?, ?, ?)"
    ).bind(userId, login.email, now).run();
    const user = await env.DB.prepare("SELECT id, email FROM users WHERE email = ?")
      .bind(login.email).first();
    const consumed = await env.DB.prepare(
      "DELETE FROM login_tokens WHERE token_hash = ? AND expires_at > ?"
    ).bind(tokenHash, now).run();
    if (!consumed.meta || consumed.meta.changes !== 1) {
      return jsonError("That sign-in link has already been used. Request a new one.", 401);
    }

    const sessionToken = newToken();
    await env.DB.prepare(
      "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)"
    ).bind(await hashValue(sessionToken), user.id, now + SESSION_TTL_MS, now).run();
    return {
      body: { token: sessionToken, email: user.email, expiresAt: now + SESSION_TTL_MS },
      status: 200
    };
  }

  if (url.pathname.indexOf("/api/") !== 0) {
    return jsonError("API route not found.", 404);
  }

  if (!accountsEnabled(env)) {
    return jsonError("Email accounts are not enabled for this deployment.", 503);
  }

  if (url.pathname === "/api/sports" && request.method === "GET") {
    const apiKey = env.THE_ODDS_API_KEY ||
      (env.ODDS_KEY_STORE ? await env.ODDS_KEY_STORE.get() : null);
    if (!apiKey) {
      return jsonError("The sports data provider key is not configured.", 503);
    }
    const sports = await providerJson("/sports/", {}, apiKey);
    return {
      body: {
        sports: sports.filter(function (sport) { return sport.active; }).map(function (sport) {
          return { key: sport.key, title: sport.title, group: sport.group };
        })
      },
      status: 200
    };
  }

  if (url.pathname === "/api/events" && request.method === "GET") {
    const sport = url.searchParams.get("sport") || "";
    const market = url.searchParams.get("market") || "h2h";
    if (!SPORT_KEY_PATTERN.test(sport)) {
      return jsonError("Choose a valid sport from the available list.", 400);
    }
    if (!ALLOWED_MARKETS.has(market)) {
      return jsonError("Choose a supported odds market.", 400);
    }
    const apiKey = env.THE_ODDS_API_KEY ||
      (env.ODDS_KEY_STORE ? await env.ODDS_KEY_STORE.get() : null);
    if (!apiKey) {
      return jsonError("The sports data provider key is not configured.", 503);
    }
    const results = await Promise.allSettled([
      providerJson("/sports/" + sport + "/scores/", { daysFrom: "1" }, apiKey),
      providerJson("/sports/" + sport + "/odds/", {
        regions: env.ODDS_REGIONS || "us",
        markets: market,
        oddsFormat: "american",
        dateFormat: "iso"
      }, apiKey)
    ]);
    if (results[0].status === "rejected" && results[1].status === "rejected") {
      return jsonError("The provider could not load scores or odds for this sport.", 502);
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
      body: { updatedAt: new Date().toISOString(), warnings: warnings, events: normalizeEvents(scores, odds) },
      status: 200
    };
  }

  const session = await getSession(request, env);
  if (!session) {
    return jsonError("Sign in to access your account.", 401);
  }

  if (url.pathname === "/api/me" && request.method === "GET") {
    return { body: { email: session.email }, status: 200 };
  }

  if (url.pathname === "/api/bets" && request.method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT id, event_name AS eventName, market, selection, american_odds AS americanOdds, " +
      "stake_cents AS stakeCents, outcome, placed_at AS placedAt " +
      "FROM bets WHERE user_id = ? ORDER BY placed_at DESC, created_at DESC"
    ).bind(session.id).all();
    return { body: { bets: rows.results }, status: 200 };
  }

  if (url.pathname === "/api/bets" && request.method === "POST") {
    const body = await readJson(request);
    const validationError = validateBet(body);
    if (validationError) {
      return jsonError(validationError, 400);
    }
    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO bets (id, user_id, event_name, market, selection, american_odds, stake_cents, outcome, placed_at, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      id, session.id, body.eventName.trim(), body.market.trim(), body.selection.trim(),
      body.americanOdds, body.stakeCents, body.outcome, Number(body.placedAt), Date.now()
    ).run();
    return { body: { id: id }, status: 201 };
  }

  const betMatch = url.pathname.match(/^\/api\/bets\/([a-f0-9-]{36})$/i);
  if (betMatch && request.method === "PATCH") {
    const body = await readJson(request);
    if (!body || !ALLOWED_OUTCOMES.has(body.outcome)) {
      return jsonError("Choose pending, won, lost, or push.", 400);
    }
    const result = await env.DB.prepare(
      "UPDATE bets SET outcome = ? WHERE id = ? AND user_id = ?"
    ).bind(body.outcome, betMatch[1], session.id).run();
    if (!result.meta || result.meta.changes !== 1) {
      return jsonError("Bet not found.", 404);
    }
    return { body: { updated: true }, status: 200 };
  }

  if (betMatch && request.method === "DELETE") {
    const result = await env.DB.prepare(
      "DELETE FROM bets WHERE id = ? AND user_id = ?"
    ).bind(betMatch[1], session.id).run();
    if (!result.meta || result.meta.changes !== 1) {
      return jsonError("Bet not found.", 404);
    }
    return { body: { deleted: true }, status: 200 };
  }

  if (url.pathname === "/api/account" && request.method === "DELETE") {
    const user = await env.DB.prepare("SELECT email FROM users WHERE id = ?")
      .bind(session.id).first();
    if (user) {
      await env.DB.prepare("DELETE FROM login_tokens WHERE email = ?").bind(user.email).run();
      await env.DB.prepare("DELETE FROM auth_requests WHERE email_hash = ?")
        .bind(await hashValue(user.email)).run();
    }
    await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(session.id).run();
    return { body: { deleted: true }, status: 200 };
  }

  if (url.pathname === "/api/auth/logout" && request.method === "POST") {
    const authorization = request.headers.get("Authorization") || "";
    const match = authorization.match(/^Bearer ([a-f0-9]{64})$/i);
    if (match) {
      await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
        .bind(await hashValue(match[1])).run();
    }
    return { body: { loggedOut: true }, status: 200 };
  }

  return jsonError("API route not found.", 404);
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
          "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
          "access-control-allow-headers": "Content-Type, Authorization",
          "vary": "Origin"
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
