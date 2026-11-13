(function () {
  "use strict";

  const gameSelect = document.getElementById("game-select");
  const marketSelect = document.getElementById("market-select");
  const chart = document.getElementById("chart");
  const windowGrid = document.getElementById("window-grid");
  const sportSelect = document.getElementById("sport-select");
  const liveMarketSelect = document.getElementById("live-market-select");
  const liveGames = document.getElementById("live-games");
  const liveStatus = document.getElementById("live-status");
  const liveEmpty = document.getElementById("live-empty");
  const lastUpdated = document.getElementById("last-updated");
  const dataBadge = document.getElementById("data-badge");
  const previousOdds = new Map();
  const accountTokenKey = "pacePatternAccountToken";
  let liveRequestId = 0;
  let accountRequestId = 0;

  function apiUrl(path) {
    return API_BASE_URL.replace(/\/+$/, "") + path;
  }

  function readApiResponse(response) {
    return response.text().then(function (body) {
      let data;
      try {
        data = JSON.parse(body);
      } catch (error) {
        if (body.trim().charAt(0) === "<") {
          throw new Error("The live data service returned a web page instead of API data. Check API_BASE_URL in data.js and confirm the Worker is deployed.");
        }
        throw new Error("The live data server returned an invalid response. Try again later.");
      }

      if (!response.ok) {
        throw new Error(data.error || "Live data could not be loaded.");
      }
      return data;
    });
  }

  function getApiErrorMessage(error) {
    if (error instanceof TypeError) {
      return "Could not reach the live data service. Check the Worker URL and set its CORS_ORIGIN to https://morgagemypyarlay.pages.dev.";
    }
    return error.message || "Live data could not be loaded.";
  }

  function accountRequest(path, token, options) {
    const requestOptions = options || {};
    requestOptions.headers = Object.assign({}, requestOptions.headers || {});
    if (token) {
      requestOptions.headers.Authorization = "Bearer " + token;
    }
    if (requestOptions.body) {
      requestOptions.headers["Content-Type"] = "application/json";
    }
    return fetch(apiUrl(path), requestOptions).then(readApiResponse);
  }

  function currentSessionToken() {
    try {
      return localStorage.getItem(accountTokenKey) || "";
    } catch (error) {
      return "";
    }
  }

  function saveSessionToken(token) {
    localStorage.setItem(accountTokenKey, token);
  }

  function clearSessionToken() {
    localStorage.removeItem(accountTokenKey);
  }

  function setAccountSignedIn(signedIn) {
    document.getElementById("account-signed-out").hidden = signedIn;
    document.getElementById("account-signed-in").hidden = !signedIn;
  }

  function currency(cents) {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD"
    }).format(cents / 100);
  }

  function betProfitCents(bet) {
    if (bet.outcome === "won") {
      return Math.round(bet.stakeCents * (bet.americanOdds > 0
        ? bet.americanOdds / 100
        : 100 / Math.abs(bet.americanOdds)));
    }
    if (bet.outcome === "lost") {
      return -bet.stakeCents;
    }
    return 0;
  }

  function renderBetHistory(bets) {
    const history = document.getElementById("bet-history");
    const empty = document.getElementById("bet-history-empty");
    history.replaceChildren();
    empty.hidden = bets.length > 0;

    let winnings = 0;
    let losses = 0;
    let winsCount = 0;
    let lossesCount = 0;
    let pushesCount = 0;
    bets.forEach(function (bet) {
      if (bet.outcome === "won") {
        winnings += betProfitCents(bet);
        winsCount += 1;
      } else if (bet.outcome === "lost") {
        losses += bet.stakeCents;
        lossesCount += 1;
      } else if (bet.outcome === "push") {
        pushesCount += 1;
      }

      const card = document.createElement("article");
      card.className = "panel bet-card";
      const info = document.createElement("div");
      info.className = "bet-card-info";
      const title = document.createElement("h3");
      title.textContent = bet.eventName + " · " + bet.selection;
      const meta = document.createElement("p");
      meta.textContent = bet.market + " · " + (bet.americanOdds > 0 ? "+" : "") +
        bet.americanOdds + " odds · " + currency(bet.stakeCents) + " stake · " +
        new Date(bet.placedAt).toLocaleDateString();
      info.append(title, meta);

      const controls = document.createElement("div");
      controls.className = "bet-card-controls";
      const outcome = document.createElement("select");
      outcome.setAttribute("aria-label", "Result for " + bet.eventName + " " + bet.selection);
      ["pending", "won", "lost", "push"].forEach(function (value) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value === "push" ? "Push / void" : value.charAt(0).toUpperCase() + value.slice(1);
        option.selected = value === bet.outcome;
        outcome.appendChild(option);
      });

      const result = document.createElement("strong");
      const profit = betProfitCents(bet);
      result.className = "bet-profit" + (profit < 0 ? " is-loss" : "");
      result.textContent = bet.outcome === "pending"
        ? "Pending"
        : bet.outcome === "push" ? "—" : (profit > 0 ? "+" : "") + currency(profit);

      const update = document.createElement("button");
      update.type = "button";
      update.className = "text-button";
      update.textContent = "Update";
      update.addEventListener("click", function () {
        update.disabled = true;
        accountRequest("/api/bets/" + encodeURIComponent(bet.id), currentSessionToken(), {
          method: "PATCH",
          body: JSON.stringify({ outcome: outcome.value })
        }).then(loadAccount).catch(function (error) {
          document.getElementById("bet-status").textContent = error.message;
          update.disabled = false;
        });
      });

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "text-button danger-text";
      remove.textContent = "Delete";
      remove.addEventListener("click", function () {
        if (!window.confirm("Delete this bet record?")) {
          return;
        }
        accountRequest("/api/bets/" + encodeURIComponent(bet.id), currentSessionToken(), {
          method: "DELETE"
        }).then(loadAccount).catch(function (error) {
          document.getElementById("bet-status").textContent = error.message;
        });
      });
      controls.append(outcome, result, update, remove);
      card.append(info, controls);
      history.appendChild(card);
    });

    document.getElementById("summary-wins").textContent = currency(winnings);
    document.getElementById("summary-losses").textContent = currency(losses);
    const net = winnings - losses;
    const netElement = document.getElementById("summary-net");
    netElement.textContent = (net > 0 ? "+" : "") + currency(net);
    netElement.classList.toggle("is-loss", net < 0);
    document.getElementById("summary-record").textContent =
      winsCount + " · " + lossesCount + " · " + pushesCount;
  }

  function loadAccount() {
    const token = currentSessionToken();
    const requestId = ++accountRequestId;
    if (!token) {
      setAccountSignedIn(false);
      return Promise.resolve();
    }
    return accountRequest("/api/me", token)
      .then(function (user) {
        if (requestId !== accountRequestId) {
          return null;
        }
        document.getElementById("account-email").textContent = user.email;
        setAccountSignedIn(true);
        return accountRequest("/api/bets", token);
      })
      .then(function (data) {
        if (data && requestId === accountRequestId) {
          renderBetHistory(data.bets);
        }
      })
      .catch(function (error) {
        if (requestId === accountRequestId) {
          if (error.message.indexOf("Sign in") !== -1) {
            clearSessionToken();
            setAccountSignedIn(false);
          }
          document.getElementById("login-status").textContent = error.message;
          document.getElementById("bet-status").textContent = error.message;
        }
      });
  }

  function verifyEmailLink() {
    const pageUrl = new URL(window.location.href);
    const magicToken = pageUrl.searchParams.get("auth");
    if (!magicToken) {
      return Promise.resolve(false);
    }
    pageUrl.searchParams.delete("auth");
    window.history.replaceState(null, "", pageUrl.pathname + "#account");
    window.location.hash = "account";
    return accountRequest("/api/auth/verify", "", {
      method: "POST",
      body: JSON.stringify({ token: magicToken })
    }).then(function (session) {
      saveSessionToken(session.token);
      document.getElementById("login-status").textContent = "You’re signed in.";
      return true;
    }).catch(function (error) {
      document.getElementById("login-status").textContent = error.message;
      return true;
    });
  }

  function initializeAccount() {
    const localDate = new Date();
    document.getElementById("bet-date").value = [
      localDate.getFullYear(),
      String(localDate.getMonth() + 1).padStart(2, "0"),
      String(localDate.getDate()).padStart(2, "0")
    ].join("-");

    document.getElementById("login-form").addEventListener("submit", function (event) {
      event.preventDefault();
      const button = event.currentTarget.querySelector("button[type=submit]");
      button.disabled = true;
      document.getElementById("login-status").textContent = "Sending sign-in link…";
      accountRequest("/api/auth/request", "", {
        method: "POST",
        body: JSON.stringify({ email: document.getElementById("login-email").value })
      }).then(function (result) {
        document.getElementById("login-status").textContent = result.message;
      }).catch(function (error) {
        document.getElementById("login-status").textContent = error.message;
      }).then(function () {
        button.disabled = false;
      });
    });

    document.getElementById("bet-form").addEventListener("submit", function (event) {
      event.preventDefault();
      const form = event.currentTarget;
      const stake = Number(document.getElementById("bet-stake").value);
      const dateParts = document.getElementById("bet-date").value.split("-").map(Number);
      const placedAt = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]).getTime();
      const button = form.querySelector("button[type=submit]");
      button.disabled = true;
      document.getElementById("bet-status").textContent = "Saving bet…";
      accountRequest("/api/bets", currentSessionToken(), {
        method: "POST",
        body: JSON.stringify({
          eventName: document.getElementById("bet-event").value,
          market: document.getElementById("bet-market").value,
          selection: document.getElementById("bet-selection").value,
          americanOdds: Number(document.getElementById("bet-odds").value),
          stakeCents: Math.round(stake * 100),
          outcome: document.getElementById("bet-outcome").value,
          placedAt: placedAt
        })
      }).then(function () {
        form.reset();
        document.getElementById("bet-date").value = [
          new Date().getFullYear(),
          String(new Date().getMonth() + 1).padStart(2, "0"),
          String(new Date().getDate()).padStart(2, "0")
        ].join("-");
        document.getElementById("bet-status").textContent = "Bet saved.";
        return loadAccount();
      }).catch(function (error) {
        document.getElementById("bet-status").textContent = error.message;
      }).then(function () {
        button.disabled = false;
      });
    });

    document.getElementById("sign-out").addEventListener("click", function () {
      const token = currentSessionToken();
      accountRequest("/api/auth/logout", token, { method: "POST", body: "{}" })
        .catch(function (error) {
          document.getElementById("login-status").textContent =
            "Signed out on this device. Server session could not be revoked: " + error.message;
        })
        .then(function () {
          clearSessionToken();
          setAccountSignedIn(false);
        });
    });

    document.getElementById("delete-account").addEventListener("click", function () {
      if (!window.confirm("Permanently delete your account and all its bet records? This cannot be undone.")) {
        return;
      }
      accountRequest("/api/account", currentSessionToken(), { method: "DELETE" })
        .then(function () {
          clearSessionToken();
          setAccountSignedIn(false);
          document.getElementById("login-status").textContent = "Account and bet history deleted.";
        })
        .catch(function (error) {
          document.getElementById("bet-status").textContent = error.message;
        });
    });

    verifyEmailLink().then(function () {
      loadAccount();
    });

    accountRequest("/api/status", "").then(function (status) {
      if (!status.accountsConfigured && !currentSessionToken()) {
        document.getElementById("login-status").textContent =
          "Email accounts are not set up on the backend yet. Configure the D1 database and Resend email secrets first.";
      }
    }).catch(function () {
      document.getElementById("login-status").textContent =
        "Could not check account setup. Make sure the live data server is available.";
    });
  }

  document.getElementById("brand-name").textContent = STARTUP.name;
  document.title = STARTUP.name + " — Live game explorer";

  GAMES.forEach(function (game) {
    const option = document.createElement("option");
    option.value = game.id;
    option.textContent = game.away + " at " + game.home;
    gameSelect.appendChild(option);
  });

  function makeMeter(rate) {
    const meter = document.createElement("div");
    meter.className = "meter";
    meter.setAttribute("role", "progressbar");
    meter.setAttribute("aria-label", "Historical sample hit rate");
    meter.setAttribute("aria-valuemin", "0");
    meter.setAttribute("aria-valuemax", "100");
    meter.setAttribute("aria-valuenow", String(rate));

    const fill = document.createElement("span");
    fill.style.width = rate + "%";
    meter.appendChild(fill);
    return meter;
  }

  function renderAnalysis() {
    const game = GAMES.find(function (item) { return item.id === gameSelect.value; }) || GAMES[0];
    const market = marketSelect.value;
    const windows = game.markets[market];
    const best = windows.reduce(function (currentBest, item) {
      return item.hitRate > currentBest.hitRate ? item : currentBest;
    }, windows[0]);
    const marketName = marketSelect.options[marketSelect.selectedIndex].textContent.toLowerCase();

    document.getElementById("game-start").textContent = game.start;
    document.getElementById("market-context").textContent =
      game.away + " at " + game.home + " · " + marketName + " · fictional historical sample";
    document.getElementById("best-window").textContent = best.label + " before start";
    document.getElementById("best-rate").textContent = best.hitRate + "%";
    document.getElementById("best-note").textContent = best.note;
    document.getElementById("best-move").textContent = best.lineMove === 0
      ? "No movement"
      : best.lineMove.toFixed(1) + " pts";
    document.getElementById("sample-count").textContent = best.samples + " examples";

    chart.replaceChildren();
    windowGrid.replaceChildren();
    windows.forEach(function (item) {
      const barRow = document.createElement("div");
      barRow.className = "bar-row" + (item.key === best.key ? " is-best" : "");

      const barLabel = document.createElement("span");
      barLabel.className = "bar-label";
      barLabel.textContent = item.label;

      const track = document.createElement("div");
      track.className = "bar-track";
      track.appendChild(makeMeter(item.hitRate));

      const value = document.createElement("strong");
      value.className = "bar-value";
      value.textContent = item.hitRate + "%";

      barRow.append(barLabel, track, value);
      chart.appendChild(barRow);

      const card = document.createElement("article");
      card.className = "window-card" + (item.key === best.key ? " is-best" : "");

      const title = document.createElement("div");
      title.className = "window-card-heading";
      const label = document.createElement("h3");
      label.textContent = item.label;
      const rate = document.createElement("strong");
      rate.textContent = item.hitRate + "%";
      title.append(label, rate);

      const meter = makeMeter(item.hitRate);
      const count = document.createElement("p");
      count.className = "window-meta";
      count.textContent = item.samples + " examples · " +
        (item.lineMove === 0 ? "no line movement" : item.lineMove.toFixed(1) + " pts average movement");
      card.append(title, meter, count);
      windowGrid.appendChild(card);
    });
  }

  function setLiveStatus(message, connected) {
    liveStatus.textContent = message;
    dataBadge.classList.toggle("is-connected", connected);
    dataBadge.classList.toggle("is-disconnected", !connected);
    dataBadge.lastChild.textContent = connected ? " Live data" : " Offline";
  }

  function formatAmericanOdds(price) {
    return price > 0 ? "+" + price : String(price);
  }

  function impliedProbability(price) {
    return price > 0 ? 100 / (price + 100) : Math.abs(price) / (Math.abs(price) + 100);
  }

  function getMovement(key, probability) {
    const previous = previousOdds.get(key);
    previousOdds.set(key, probability);
    if (previous === undefined) {
      return { label: "First observation", direction: "neutral" };
    }

    const change = (probability - previous) * 100;
    if (Math.abs(change) < 0.05) {
      return { label: "No change since refresh", direction: "neutral" };
    }
    return {
      label: (change > 0 ? "↑ " : "↓ ") + Math.abs(change).toFixed(1) + " pp since refresh",
      direction: change > 0 ? "up" : "down"
    };
  }

  function createOdds(event, marketKey) {
    const bookmaker = (event.bookmakers || []).find(function (book) {
      return (book.markets || []).some(function (market) { return market.key === marketKey; });
    });
    const market = bookmaker && bookmaker.markets.find(function (item) { return item.key === marketKey; });
    const section = document.createElement("div");
    section.className = "live-odds";

    if (!market || !market.outcomes.length) {
      const empty = document.createElement("p");
      empty.className = "odds-unavailable";
      empty.textContent = "No odds currently available for this market.";
      section.appendChild(empty);
      return section;
    }

    const provider = document.createElement("p");
    provider.className = "odds-provider";
    provider.textContent = "Odds from " + bookmaker.title;
    section.appendChild(provider);

    market.outcomes.forEach(function (outcome) {
      const probability = impliedProbability(outcome.price);
      const movement = getMovement(event.id + ":" + marketKey + ":" + outcome.name, probability);
      const row = document.createElement("div");
      row.className = "odds-row";

      const name = document.createElement("span");
      name.className = "odds-outcome";
      name.textContent = outcome.name +
        (typeof outcome.point === "number" ? " (" + (outcome.point > 0 ? "+" : "") + outcome.point + ")" : "");

      const price = document.createElement("strong");
      price.className = "odds-price";
      price.textContent = formatAmericanOdds(outcome.price);

      const chance = document.createElement("span");
      chance.className = "odds-probability";
      chance.textContent = (probability * 100).toFixed(1) + "% implied";

      const trend = document.createElement("span");
      trend.className = "odds-trend trend-" + movement.direction;
      trend.textContent = movement.label;

      row.append(name, price, chance, trend);
      section.appendChild(row);
    });
    return section;
  }

  function renderLiveEvents(events) {
    liveGames.replaceChildren();
    liveEmpty.hidden = events.length !== 0;
    events.forEach(function (event) {
      const card = document.createElement("article");
      card.className = "panel live-card";

      const header = document.createElement("div");
      header.className = "live-card-header";
      const status = document.createElement("span");
      status.className = "event-status" + (event.inProgress ? " is-live" : "");
      status.textContent = event.inProgress ? "Live now" : event.completed ? "Final" : "Upcoming";
      const scheduled = document.createElement("span");
      scheduled.className = "event-time";
      scheduled.textContent = event.inProgress || event.completed
        ? ""
        : new Date(event.commenceTime).toLocaleString();
      header.append(status, scheduled);

      const matchup = document.createElement("div");
      matchup.className = "matchup";
      [event.awayTeam, event.homeTeam].forEach(function (team) {
        const teamRow = document.createElement("div");
        teamRow.className = "team-row";
        const teamName = document.createElement("span");
        teamName.textContent = team;
        const score = document.createElement("strong");
        const teamScore = (event.scores || []).find(function (item) { return item.name === team; });
        score.textContent = teamScore ? teamScore.score : "—";
        teamRow.append(teamName, score);
        matchup.appendChild(teamRow);
      });

      const odds = createOdds(event, liveMarketSelect.value);
      card.append(header, matchup, odds);
      liveGames.appendChild(card);
    });
  }

  function fetchLiveEvents() {
    if (!sportSelect.value) {
      return;
    }
    const requestId = ++liveRequestId;
    const refreshButton = document.getElementById("refresh-live");
    refreshButton.disabled = true;
    liveStatus.textContent = "Updating scores and odds…";
    const params = new URLSearchParams({
      sport: sportSelect.value,
      market: liveMarketSelect.value
    });

    fetch(apiUrl("/api/events?" + params.toString()))
      .then(readApiResponse)
      .then(function (data) {
        if (requestId !== liveRequestId) {
          return;
        }
        renderLiveEvents(data.events || []);
        setLiveStatus(data.warnings && data.warnings.length
          ? data.warnings.join(" ")
          : "Showing current provider data. Refresh to check for changes.", true);
        lastUpdated.textContent = "Updated " + new Date(data.updatedAt).toLocaleTimeString();
      })
      .catch(function (error) {
        if (requestId === liveRequestId) {
          liveGames.replaceChildren();
          liveEmpty.hidden = false;
          setLiveStatus(getApiErrorMessage(error), false);
          lastUpdated.textContent = "";
        }
      })
      .then(function () {
        if (requestId === liveRequestId) {
          refreshButton.disabled = false;
        }
      });
  }

  function initializeLiveData() {
    fetch(apiUrl("/api/status"))
      .then(readApiResponse)
      .then(function (status) {
        if (!status.configured) {
          setLiveStatus("The Worker does not have the provider key configured. Add THE_ODDS_API_KEY as a Worker secret.", false);
          return null;
        }
        return fetch(apiUrl("/api/sports")).then(readApiResponse);
      })
      .then(function (data) {
        if (!data) {
          return;
        }
        sportSelect.replaceChildren();
        data.sports.forEach(function (sport) {
          const option = document.createElement("option");
          option.value = sport.key;
          option.textContent = sport.title;
          sportSelect.appendChild(option);
        });
        sportSelect.disabled = data.sports.length === 0;
        if (data.sports.length === 0) {
          setLiveStatus("The provider has no active sports available right now.", true);
          return;
        }
        setLiveStatus("Select a sport and refresh to load current scores and odds.", true);
        fetchLiveEvents();
      })
      .catch(function (error) {
        setLiveStatus(getApiErrorMessage(error), false);
      });
  }

  function showView() {
    const requested = (window.location.hash || "#live").slice(1);
    const views = document.querySelectorAll("[data-view]");
    const exists = Array.prototype.some.call(views, function (view) {
      return view.id === requested;
    });
    const current = exists ? requested : "live";

    views.forEach(function (view) {
      view.hidden = view.id !== current;
    });
    document.querySelectorAll("nav a").forEach(function (link) {
      if (link.getAttribute("href") === "#" + current) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });
    window.scrollTo(0, 0);
    if (current === "account") {
      loadAccount();
    }
  }

  gameSelect.addEventListener("change", renderAnalysis);
  marketSelect.addEventListener("change", renderAnalysis);
  sportSelect.addEventListener("change", fetchLiveEvents);
  liveMarketSelect.addEventListener("change", fetchLiveEvents);
  document.getElementById("refresh-live").addEventListener("click", fetchLiveEvents);
  window.addEventListener("hashchange", showView);
  renderAnalysis();
  showView();
  initializeLiveData();
  initializeAccount();
})();
