(function () {
  "use strict";

  const BET_STORAGE_KEY = "pacePatternDemoBets";
  const gameSelect = document.getElementById("game-select");
  const marketSelect = document.getElementById("market-select");
  const chart = document.getElementById("chart");
  const windowGrid = document.getElementById("window-grid");
  const sportSelect = document.getElementById("sport-select");
  const liveMarketSelect = document.getElementById("live-market-select");
  const liveGames = document.getElementById("live-games");
  const liveEmpty = document.getElementById("live-empty");
  const betStatus = document.getElementById("bet-status");
  let bets = [];
  let betStorageReady = true;

  function currency(cents) {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD"
    }).format(cents / 100);
  }

  function localDateValue(date) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-");
  }

  function saveBets(nextBets) {
    if (!betStorageReady) {
      throw new Error("Journal storage is unavailable. Your changes were not saved.");
    }
    try {
      localStorage.setItem(BET_STORAGE_KEY, JSON.stringify(nextBets));
    } catch (error) {
      throw new Error("Could not save to this browser. Check storage settings and try again.");
    }
    bets = nextBets;
    renderBetHistory();
  }

  function loadBets() {
    try {
      const saved = localStorage.getItem(BET_STORAGE_KEY);
      if (saved === null) {
        bets = [];
        return;
      }
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed) || !parsed.every(function (bet) {
        return bet && typeof bet.id === "string" &&
          typeof bet.eventName === "string" &&
          typeof bet.market === "string" &&
          typeof bet.selection === "string" &&
          Number.isInteger(bet.americanOdds) && bet.americanOdds !== 0 &&
          Number.isInteger(bet.stakeCents) && bet.stakeCents > 0 &&
          ["pending", "won", "lost", "push"].indexOf(bet.outcome) !== -1 &&
          typeof bet.placedAt === "string";
      })) {
        throw new Error("Saved journal data is invalid.");
      }
      bets = parsed;
    } catch (error) {
      betStorageReady = false;
      betStatus.textContent = error instanceof SyntaxError ||
        error.message === "Saved journal data is invalid."
        ? "Saved journal data could not be read. The journal is locked to avoid overwriting it."
        : "Browser storage is unavailable. Journal changes cannot be saved here.";
      document.getElementById("bet-form").querySelector("button[type=submit]").disabled = true;
      document.getElementById("clear-bet-history").disabled = true;
    }
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

  function renderBetHistory() {
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
        new Date(bet.placedAt + "T12:00:00").toLocaleDateString();
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

      const profit = betProfitCents(bet);
      const result = document.createElement("strong");
      result.className = "bet-profit" + (profit < 0 ? " is-loss" : "");
      result.textContent = bet.outcome === "pending"
        ? "Pending"
        : bet.outcome === "push" ? "—" : (profit > 0 ? "+" : "") + currency(profit);

      const update = document.createElement("button");
      update.type = "button";
      update.className = "text-button";
      update.textContent = "Update";
      update.addEventListener("click", function () {
        const updated = bets.map(function (item) {
          return item.id === bet.id ? Object.assign({}, item, { outcome: outcome.value }) : item;
        });
        try {
          saveBets(updated);
          betStatus.textContent = "Sample bet updated in this browser.";
        } catch (error) {
          betStatus.textContent = error.message;
        }
      });

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "text-button danger-text";
      remove.textContent = "Delete";
      remove.addEventListener("click", function () {
        if (!window.confirm("Delete this sample bet record?")) {
          return;
        }
        try {
          saveBets(bets.filter(function (item) { return item.id !== bet.id; }));
          betStatus.textContent = "Sample bet deleted.";
        } catch (error) {
          betStatus.textContent = error.message;
        }
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

  function initializeAccount() {
    const dateInput = document.getElementById("bet-date");
    dateInput.value = localDateValue(new Date());
    loadBets();
    renderBetHistory();

    document.getElementById("bet-form").addEventListener("submit", function (event) {
      event.preventDefault();
      const form = event.currentTarget;
      const odds = Number(document.getElementById("bet-odds").value);
      const stake = Number(document.getElementById("bet-stake").value);
      const eventName = document.getElementById("bet-event").value.trim();
      const market = document.getElementById("bet-market").value.trim();
      const selection = document.getElementById("bet-selection").value.trim();
      if (!Number.isInteger(odds) || odds === 0 || !Number.isFinite(stake) || stake <= 0) {
        betStatus.textContent = "Enter non-zero whole-number American odds and a positive stake.";
        return;
      }
      if (!eventName || !market || !selection) {
        betStatus.textContent = "Enter a game, market, and selection.";
        return;
      }
      const date = dateInput.value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(date + "T12:00:00").getTime())) {
        betStatus.textContent = "Enter a valid bet date.";
        return;
      }
      const nextBets = [{
        id: window.crypto && window.crypto.randomUUID
          ? window.crypto.randomUUID()
          : String(Date.now()) + "-" + Math.random().toString(36).slice(2),
        eventName: eventName,
        market: market,
        selection: selection,
        americanOdds: odds,
        stakeCents: Math.round(stake * 100),
        outcome: document.getElementById("bet-outcome").value,
        placedAt: date
      }].concat(bets);
      try {
        saveBets(nextBets);
        form.reset();
        dateInput.value = localDateValue(new Date());
        betStatus.textContent = "Sample bet saved in this browser.";
      } catch (error) {
        betStatus.textContent = error.message;
      }
    });

    document.getElementById("clear-bet-history").addEventListener("click", function () {
      if (!window.confirm("Clear all sample bet history saved in this browser?")) {
        return;
      }
      try {
        saveBets([]);
        betStatus.textContent = "Sample history cleared.";
      } catch (error) {
        betStatus.textContent = error.message;
      }
    });
  }

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
      const count = document.createElement("p");
      count.className = "window-meta";
      count.textContent = item.samples + " examples · " +
        (item.lineMove === 0 ? "no line movement" : item.lineMove.toFixed(1) + " pts average movement");
      card.append(title, makeMeter(item.hitRate), count);
      windowGrid.appendChild(card);
    });
  }

  function formatAmericanOdds(price) {
    return price > 0 ? "+" + price : String(price);
  }

  function impliedProbability(price) {
    return price > 0 ? 100 / (price + 100) : Math.abs(price) / (Math.abs(price) + 100);
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
      empty.textContent = "No sample odds available for this market.";
      section.appendChild(empty);
      return section;
    }

    const provider = document.createElement("p");
    provider.className = "odds-provider";
    provider.textContent = "Fictional sample odds";
    section.appendChild(provider);

    market.outcomes.forEach(function (outcome) {
      const probability = impliedProbability(outcome.price);
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
      const sample = document.createElement("span");
      sample.className = "odds-trend trend-neutral";
      sample.textContent = "sample";
      row.append(name, price, chance, sample);
      section.appendChild(row);
    });
    return section;
  }

  function renderLiveEvents() {
    const events = DEMO_EVENTS.filter(function (event) {
      return event.sport === sportSelect.value;
    });
    liveGames.replaceChildren();
    liveEmpty.hidden = events.length !== 0;
    events.forEach(function (event) {
      const card = document.createElement("article");
      card.className = "panel live-card";
      const header = document.createElement("div");
      header.className = "live-card-header";
      const status = document.createElement("span");
      status.className = "event-status";
      status.textContent = "Demo sample";
      const scheduled = document.createElement("span");
      scheduled.className = "event-time";
      scheduled.textContent = "Fictional matchup";
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
      card.append(header, matchup, createOdds(event, liveMarketSelect.value));
      liveGames.appendChild(card);
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
  }

  document.getElementById("brand-name").textContent = STARTUP.name;
  document.title = STARTUP.name + " — Sports demo";
  GAMES.forEach(function (game) {
    const option = document.createElement("option");
    option.value = game.id;
    option.textContent = game.away + " at " + game.home;
    gameSelect.appendChild(option);
  });
  DEMO_SPORTS.forEach(function (sport) {
    const option = document.createElement("option");
    option.value = sport.key;
    option.textContent = sport.title;
    sportSelect.appendChild(option);
  });

  gameSelect.addEventListener("change", renderAnalysis);
  marketSelect.addEventListener("change", renderAnalysis);
  sportSelect.addEventListener("change", renderLiveEvents);
  liveMarketSelect.addEventListener("change", renderLiveEvents);
  document.getElementById("refresh-live").addEventListener("click", function () {
    renderLiveEvents();
    document.getElementById("live-status").textContent =
      "Showing fictional sample data. Refreshing does not load a live feed.";
  });
  window.addEventListener("hashchange", showView);
  renderAnalysis();
  renderLiveEvents();
  initializeAccount();
  showView();
})();
