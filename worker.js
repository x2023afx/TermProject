"use strict";

const API_ROOT = "https://api.the-odds-api.com/v4";
const RESEND_SEND_ROOT = "https://api.resend.com/emails";
const ALLOWED_MARKETS = new Set(["h2h", "spreads", "totals"]);
const ALLOWED_OUTCOMES = new Set(["pending", "won", "lost", "push"]);
const SPORT_KEY_PATTERN = /^[a-zA-Z0-9_-]+$/;
const TOKEN_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PASSWORD_ITERATIONS = 600000;
const DUMMY_PASSWORD_SALT = "7f2e8a4c1d9b6f305a7c2e8d4b1f6093";

function accountsEnabled(env) {
  return env.ACCOUNTS_ENABLED === "true" &&
    Boolean(env.DB);
}

function emailSignInEnabled(env) {
  return accountsEnabled(env) && Boolean(env.RESEND_API_KEY && env.RESEND_FROM_EMAIL);
}

async function getOddsApiKey(env) {
  if (typeof env.THE_ODDS_API_KEY === "string" && env.THE_ODDS_API_KEY.trim()) {
    return env.THE_ODDS_API_KEY.trim();
  }
  if (typeof env.ODDS_KEY_STORE === "string" && env.ODDS_KEY_STORE.trim()) {
    return env.ODDS_KEY_STORE.trim();
  }
  if (env.ODDS_KEY_STORE && typeof env.ODDS_KEY_STORE.get === "function") {
    const value = await env.ODDS_KEY_STORE.get();
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }
  return null;
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
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
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

function validUsername(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_]{3,32}$/.test(value);
}

function validPassword(value) {
  return typeof value === "string" && value.length >= 12 && value.length <= 128;
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

async function workerSecret(env, name) {
  let value = env[name];
  if (value && typeof value.get === "function") {
    value = await value.get();
  }
  return typeof value === "string" ? value.trim() : "";
}

async function sendLoginEmail(email, token, env) {
  const apiKey = await workerSecret(env, "RESEND_API_KEY");
  const from = await workerSecret(env, "RESEND_FROM_EMAIL");
  if (!apiKey || !from) {
    throw new Error("Resend email is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL.");
  }
  const siteUrl = (env.SITE_URL || "https://morgagemypyarlay.pages.dev").replace(/\/+$/, "");
  const link = siteUrl + "/?auth=" + encodeURIComponent(token) + "#account";
  const response = await fetch(RESEND_SEND_ROOT, {
    method: "POST",
    headers: {
      "authorization": "Bearer " + apiKey,
      "content-type": "application/json; charset=utf-8"
    },
    body: JSON.stringify({
      from: from,
      to: [email],
      subject: "Your Pace & Pattern sign-in link",
      text: [
        "Use this link within 15 minutes to sign in to Pace & Pattern:",
        "",
        link,
        "",
        "If you did not request this, you can ignore this email."
      ].join("\n")
    })
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error("Resend rejected the sign-in email (HTTP " + response.status +
      "): " + details.slice(0, 300));
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
    "SELECT users.id AS id, users.email AS email, users.username AS username FROM sessions " +
    "JOIN users ON users.id = sessions.user_id " +
    "WHERE sessions.token_hash = ? AND sessions.expires_at > ?"
  ).bind(tokenHash, Date.now()).first();
}

async function allowAuthRequest(identifier, request, env, now) {
  const identifierHash = await hashValue(identifier);
  const sourceIp = request.headers.get("CF-Connecting-IP") || "unknown";
  const ipHash = await hashValue(sourceIp);
  await env.DB.prepare("DELETE FROM auth_requests WHERE created_at < ?").bind(now - 3600000).run();
  await env.DB.prepare("DELETE FROM login_tokens WHERE expires_at < ?").bind(now).run();
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now).run();
  const limits = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS count FROM auth_requests WHERE email_hash = ? AND created_at > ?")
      .bind(identifierHash, now - 900000),
    env.DB.prepare("SELECT COUNT(*) AS count FROM auth_requests WHERE ip_hash = ? AND created_at > ?")
      .bind(ipHash, now - 900000)
  ]);
  if (limits[0].results[0].count >= 3 || limits[1].results[0].count >= 10) {
    return false;
  }
  await env.DB.prepare(
    "INSERT INTO auth_requests (email_hash, ip_hash, created_at) VALUES (?, ?, ?)"
  ).bind(identifierHash, ipHash, now).run();
  return true;
}

async function createSession(userId, env, now) {
  const sessionToken = newToken();
  await env.DB.prepare(
    "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)"
  ).bind(await hashValue(sessionToken), userId, now + SESSION_TTL_MS, now).run();
  return { token: sessionToken, expiresAt: now + SESSION_TTL_MS };
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
    const oddsKey = await getOddsApiKey(env);
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
    if (!emailSignInEnabled(env)) {
      return jsonError("Email sign-in is not configured on the backend yet.", 503);
    }
    const body = await readJson(request);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonError("Enter a valid email address.", 400);
    }

    const now = Date.now();
    if (!await allowAuthRequest(email, request, env, now)) {
      return jsonError("Too many sign-in requests. Wait 15 minutes and try again.", 429);
    }

    const token = newToken();
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

  if (url.pathname === "/api/auth/register" && request.method === "POST") {
    if (!accountsEnabled(env)) {
      return jsonError("Username accounts are not enabled for this deployment.", 503);
    }
    const body = await readJson(request);
    const usernameInput = body && typeof body.username === "string" ? body.username.trim() : "";
    const password = body && body.password;
    if (!validUsername(usernameInput)) {
      return jsonError("Use a username with 3 to 32 letters, numbers, or underscores.", 400);
    }
    if (!validPassword(password)) {
      return jsonError("Use a password between 12 and 128 characters.", 400);
    }
    const username = usernameInput.toLowerCase();
    const now = Date.now();
    if (!await allowAuthRequest(username, request, env, now)) {
      return jsonError("Too many account requests. Wait 15 minutes and try again.", 429);
    }
    const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
    const passwordHash = await hashPassword(password, salt, PASSWORD_ITERATIONS);
    const userId = crypto.randomUUID();
    const inserted = await env.DB.prepare(
      "INSERT INTO users (id, email, username, password_salt, password_hash, password_iterations, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(username) DO NOTHING"
    ).bind(
      userId, userId + "@username.invalid", username, salt, passwordHash, PASSWORD_ITERATIONS, now
    ).run();
    if (!inserted.meta || inserted.meta.changes !== 1) {
      return jsonError("That username is already taken.", 409);
    }
    const session = await createSession(userId, env, now);
    return {
      body: { token: session.token, username: username, expiresAt: session.expiresAt },
      status: 201
    };
  }

  if (url.pathname === "/api/auth/login" && request.method === "POST") {
    if (!accountsEnabled(env)) {
      return jsonError("Username accounts are not enabled for this deployment.", 503);
    }
    const body = await readJson(request);
    const usernameInput = body && typeof body.username === "string" ? body.username.trim() : "";
    const password = body && body.password;
    if (!validUsername(usernameInput) || typeof password !== "string" || password.length > 128) {
      return jsonError("Enter a valid username and password.", 400);
    }
    const username = usernameInput.toLowerCase();
    const now = Date.now();
    if (!await allowAuthRequest(username, request, env, now)) {
      return jsonError("Too many sign-in attempts. Wait 15 minutes and try again.", 429);
    }
    const user = await env.DB.prepare(
      "SELECT id, username, password_salt, password_hash, password_iterations " +
      "FROM users WHERE username = ?"
    ).bind(username).first();
    const salt = user && /^[a-f0-9]{32}$/i.test(user.password_salt || "")
      ? user.password_salt
      : DUMMY_PASSWORD_SALT;
    const iterations = user && Number.isInteger(user.password_iterations) &&
      user.password_iterations >= 100000 && user.password_iterations <= 1000000
      ? user.password_iterations
      : PASSWORD_ITERATIONS;
    const passwordHash = await hashPassword(password, salt, iterations);
    if (!user || !user.password_hash || !equalHexValues(passwordHash, user.password_hash)) {
      return jsonError("Invalid username or password.", 401);
    }
    const session = await createSession(user.id, env, now);
    return {
      body: { token: session.token, username: user.username, expiresAt: session.expiresAt },
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

  if (url.pathname === "/api/sports" && request.method === "GET") {
    const apiKey = await getOddsApiKey(env);
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
    const apiKey = await getOddsApiKey(env);
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

  if (!accountsEnabled(env)) {
    return jsonError("Accounts are not enabled for this deployment.", 503);
  }

  const session = await getSession(request, env);
  if (!session) {
    return jsonError("Sign in to access your account.", 401);
  }

  if (url.pathname === "/api/me" && request.method === "GET") {
    return { body: { username: session.username, email: session.email }, status: 200 };
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
    const user = await env.DB.prepare("SELECT email, username FROM users WHERE id = ?")
      .bind(session.id).first();
    if (user) {
      if (user.email) {
        await env.DB.prepare("DELETE FROM login_tokens WHERE email = ?").bind(user.email).run();
        await env.DB.prepare("DELETE FROM auth_requests WHERE email_hash = ?")
          .bind(await hashValue(user.email)).run();
      }
      if (user.username) {
        await env.DB.prepare("DELETE FROM auth_requests WHERE email_hash = ?")
          .bind(await hashValue(user.username)).run();
      }
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
