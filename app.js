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
  let liveRequestId = 0;

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

    fetch("/api/events?" + params.toString())
      .then(function (response) {
        return response.json().then(function (data) {
          if (!response.ok) {
            throw new Error(data.error || "Live data could not be loaded.");
          }
          return data;
        });
      })
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
          setLiveStatus(error.message, false);
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
    fetch("/api/status")
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Live service is not available. Start the app using the local server.");
        }
        return response.json();
      })
      .then(function (status) {
        if (!status.configured) {
          setLiveStatus("Provider key is not configured. Add THE_ODDS_API_KEY to the server environment and restart.", false);
          return null;
        }
        return fetch("/api/sports");
      })
      .then(function (response) {
        if (!response) {
          return null;
        }
        return response.json().then(function (data) {
          if (!response.ok) {
            throw new Error(data.error || "Sports list could not be loaded.");
          }
          return data;
        });
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
        setLiveStatus(error.message, false);
      });
  }

  function showView() {
    const requested = (window.location.hash || "#live").slice(1);
    const views = document.querySelectorAll("[data-view]");
    const exists = Array.prototype.some.call(views, function (view) {
      return view.id === requested;
    });
    const current = exists ? requested : "home";

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
})();
