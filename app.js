(function () {
  "use strict";

  const accountTokenKey = "northstarAccountToken";
  const lookupHistoryKey = "northstarLookupHistory";
  const maxLookups = 10;
  const stockForm = document.getElementById("stock-form");
  const symbolInput = document.getElementById("stock-symbol");
  const accountToken = function () {
    try {
      return localStorage.getItem(accountTokenKey) || "";
    } catch (error) {
      return "";
    }
  };
  let stockRequestId = 0;

  function apiUrl(path) {
    return STARTUP.apiBaseUrl.replace(/\/+$/, "") + path;
  }

  function apiRequest(path, token, options) {
    const requestOptions = options || {};
    requestOptions.headers = Object.assign({}, requestOptions.headers || {});
    if (token) {
      requestOptions.headers.Authorization = "Bearer " + token;
    }
    if (requestOptions.body) {
      requestOptions.headers["Content-Type"] = "application/json";
    }
    return fetch(apiUrl(path), requestOptions).then(function (response) {
      return response.text().then(function (body) {
        let data;
        try {
          data = JSON.parse(body);
        } catch (error) {
          throw new Error("The API returned an invalid response. Check the Worker URL and deployment.");
        }
        if (!response.ok) {
          throw new Error(data.error || "The request could not be completed.");
        }
        return data;
      });
    });
  }

  function displayAccount(signedIn, email) {
    document.getElementById("account-signed-out").hidden = signedIn;
    document.getElementById("account-signed-in").hidden = !signedIn;
    document.getElementById("account-email-display").textContent = email || "";
    const headerAccount = document.getElementById("header-account");
    const avatar = document.getElementById("header-account-avatar");
    const label = document.getElementById("header-account-label");
    avatar.textContent = signedIn && email ? email.trim().charAt(0).toUpperCase() : "";
    avatar.hidden = !signedIn;
    label.hidden = signedIn;
    headerAccount.classList.toggle("is-signed-in", signedIn);
    headerAccount.setAttribute("aria-label", signedIn ? "Account profile for " + email : "Sign in");
    headerAccount.title = signedIn ? email : "Sign in";
    document.getElementById("profile-menu-name").textContent = email || "";
    if (!signedIn) {
      closeProfileMenu();
    }
    renderLookupHistory();
  }

  function readLookupHistory() {
    try {
      const saved = JSON.parse(localStorage.getItem(lookupHistoryKey) || "[]");
      return Array.isArray(saved)
        ? saved.filter(function (symbol) {
          return typeof symbol === "string" && /^[A-Z0-9.^=-]{1,12}$/.test(symbol);
        }).slice(0, maxLookups)
        : [];
    } catch (error) {
      return [];
    }
  }

  function renderLookupHistory() {
    const history = readLookupHistory();
    [document.getElementById("profile-menu-lookups"), document.getElementById("account-lookups")]
      .forEach(function (container) {
        container.replaceChildren();
        if (!history.length) {
          const empty = document.createElement("p");
          empty.className = "profile-menu-empty";
          empty.textContent = "Your successful stock lookups will appear here.";
          container.appendChild(empty);
          return;
        }
        history.forEach(function (symbol) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "profile-lookup";
          button.textContent = symbol;
          button.addEventListener("click", function () {
            closeProfileMenu();
            window.location.hash = "stocks";
            loadStock(symbol);
          });
          container.appendChild(button);
        });
      });
  }

  function saveLookup(symbol) {
    const history = readLookupHistory().filter(function (savedSymbol) {
      return savedSymbol !== symbol;
    });
    history.unshift(symbol);
    try {
      localStorage.setItem(lookupHistoryKey, JSON.stringify(history.slice(0, maxLookups)));
    } catch (error) {
      return;
    }
    renderLookupHistory();
  }

  function closeProfileMenu() {
    const menu = document.getElementById("profile-menu");
    menu.hidden = true;
    document.getElementById("header-account").setAttribute("aria-expanded", "false");
  }

  function toggleProfileMenu() {
    const menu = document.getElementById("profile-menu");
    menu.hidden = !menu.hidden;
    document.getElementById("header-account").setAttribute("aria-expanded", String(!menu.hidden));
  }

  function openAccountSection(sectionId) {
    closeProfileMenu();
    window.location.hash = "account";
    window.setTimeout(function () {
      const section = document.getElementById(sectionId);
      if (section) {
        section.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 0);
  }

  function setMarketStatus(message, connected) {
    document.getElementById("market-status").textContent = message;
    const badge = document.getElementById("data-badge");
    badge.classList.toggle("is-connected", connected);
    badge.classList.toggle("is-disconnected", !connected);
    badge.lastChild.textContent = connected ? " Market data available" : " Market data unavailable";
  }

  function formatCurrency(value, currencyCode) {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode || "USD",
      maximumFractionDigits: 2
    }).format(value);
  }

  function formatPercent(value) {
    return (value > 0 ? "+" : "") + (value * 100).toFixed(2) + "%";
  }

  function renderChart(history, currencyCode) {
    const svg = document.getElementById("price-chart");
    const empty = document.getElementById("chart-empty");
    const range = document.getElementById("chart-range");
    const recent = history.slice(-65);
    if (recent.length < 2) {
      svg.hidden = true;
      range.hidden = true;
      empty.hidden = false;
      empty.textContent = "Not enough price history to draw a chart.";
      return;
    }

    const width = 720;
    const height = 250;
    const padding = { top: 16, right: 12, bottom: 20, left: 12 };
    const values = recent.map(function (item) { return item.close; });
    const min = Math.min.apply(null, values);
    const max = Math.max.apply(null, values);
    const spread = max - min || max * 0.02 || 1;
    const points = recent.map(function (item, index) {
      const x = padding.left + index * (width - padding.left - padding.right) / (recent.length - 1);
      const y = padding.top + (max - item.close) * (height - padding.top - padding.bottom) / spread;
      return { x: x, y: y };
    });
    const path = points.map(function (point, index) {
      return (index === 0 ? "M" : "L") + point.x.toFixed(2) + " " + point.y.toFixed(2);
    }).join(" ");

    svg.replaceChildren();
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
    line.setAttribute("d", path);
    line.setAttribute("class", "chart-line");
    svg.appendChild(line);
    svg.hidden = false;
    empty.hidden = true;
    range.hidden = false;
    range.textContent = recent[0].date + "  ·  " +
      formatCurrency(min, currencyCode) + " low  /  " +
      formatCurrency(max, currencyCode) + " high  ·  " + recent[recent.length - 1].date;
  }

  function renderForecast(data) {
    const forecastResults = document.getElementById("forecast-results");
    forecastResults.replaceChildren();
    data.forecast.forEach(function (item) {
      const row = document.createElement("div");
      row.className = "forecast-row";
      const label = document.createElement("strong");
      label.textContent = "Session " + item.session;
      const point = document.createElement("span");
      point.textContent = formatCurrency(item.price, data.currency);
      const interval = document.createElement("small");
      interval.textContent = formatCurrency(item.low, data.currency) + " - " +
        formatCurrency(item.high, data.currency) + " (80% model range)";
      row.append(label, point, interval);
      forecastResults.appendChild(row);
    });
    document.getElementById("forecast-method").textContent =
      "Based on " + data.model.returnObservations + " aligned historical daily returns. " +
      data.model.comparables.length + " comparable securities included.";
  }

  function renderComparables(data) {
    const container = document.getElementById("comparables");
    container.replaceChildren();
    data.comparables.forEach(function (item) {
      const row = document.createElement("div");
      row.className = "comparable-row";
      const symbol = document.createElement("strong");
      symbol.textContent = item.symbol;
      const name = document.createElement("span");
      name.textContent = item.name || item.symbol;
      const change = document.createElement("span");
      change.className = item.return > 0 ? "positive" : item.return < 0 ? "negative" : "";
      change.textContent = formatPercent(item.return) + " over latest 20 sessions";
      row.append(symbol, name, change);
      container.appendChild(row);
    });
  }

  function showEmptyMessage(container, message) {
    container.replaceChildren();
    const empty = document.createElement("p");
    empty.className = "chart-empty";
    empty.textContent = message;
    container.appendChild(empty);
  }

  function renderStock(data) {
    const overview = document.getElementById("stock-overview");
    overview.hidden = false;
    document.getElementById("company-name").textContent = data.name || data.symbol;
    document.getElementById("quote-symbol").textContent = data.symbol;
    document.getElementById("quote-price").textContent = formatCurrency(data.price, data.currency);
    const quoteChange = document.getElementById("quote-change");
    quoteChange.textContent = formatCurrency(data.change, data.currency) + " (" +
      formatPercent(data.changePercent) + ") vs previous close";
    quoteChange.classList.toggle("positive", data.change >= 0);
    quoteChange.classList.toggle("negative", data.change < 0);
    document.getElementById("quote-date").textContent = "As of " + data.priceDate;
    document.getElementById("projection-change").textContent = formatPercent(data.projectionPercent);
    document.getElementById("projection-price").textContent =
      "Estimated two-session price: " + formatCurrency(data.forecast[1].price, data.currency);
    const confidence = document.getElementById("model-confidence");
    confidence.textContent = data.model.directionalAccuracy === null
      ? "Not available"
      : Math.round(data.model.directionalAccuracy * 100) + "%";
    document.getElementById("confidence-detail").textContent =
      data.model.directionalAccuracy === null
        ? "Insufficient out-of-sample history for a stable estimate."
        : "Directional accuracy over " + data.model.backtestCount + " past two-session tests; not a probability of future success.";
    document.getElementById("market-updated").textContent =
      "Market history retrieved " + new Date(data.updatedAt).toLocaleString();
    renderChart(data.history, data.currency);
    renderForecast(data);
    renderComparables(data);
    setMarketStatus("Showing latest available daily market history for " + data.symbol + ".", true);
  }

  function loadStock(symbol) {
    const requestId = ++stockRequestId;
    const normalized = symbol.trim().toUpperCase();
    symbolInput.value = normalized;
    document.getElementById("stock-submit").disabled = true;
    setMarketStatus("Loading " + normalized + " and comparable historical prices...", true);
    document.getElementById("market-updated").textContent = "";
    document.getElementById("stock-overview").hidden = true;
    document.getElementById("price-chart").hidden = true;
    document.getElementById("chart-range").hidden = true;
    document.getElementById("chart-empty").hidden = false;
    document.getElementById("chart-empty").textContent = "Loading historical prices...";
    showEmptyMessage(document.getElementById("forecast-results"), "Calculating the two-session projection...");
    showEmptyMessage(document.getElementById("comparables"), "Loading comparable market history...");
    apiRequest("/api/stocks?symbol=" + encodeURIComponent(normalized), "")
      .then(function (data) {
        if (requestId === stockRequestId) {
          renderStock(data);
          saveLookup(normalized);
        }
      })
      .catch(function (error) {
        if (requestId === stockRequestId) {
          setMarketStatus(error.message, false);
          document.getElementById("stock-overview").hidden = true;
          document.getElementById("chart-empty").hidden = false;
          document.getElementById("chart-empty").textContent = "Market history is unavailable for this symbol.";
          document.getElementById("price-chart").hidden = true;
          showEmptyMessage(document.getElementById("forecast-results"), "Projection is unavailable.");
          showEmptyMessage(document.getElementById("comparables"), "Comparable history is unavailable.");
        }
      })
      .then(function () {
        if (requestId === stockRequestId) {
          document.getElementById("stock-submit").disabled = false;
        }
      });
  }

  function normalizeEmail(value) {
    return value.trim().toLowerCase();
  }

  function showView() {
    const requestedView = window.location.hash.slice(1);
    const currentView = document.getElementById(requestedView) ? requestedView : "stocks";
    document.querySelectorAll("[data-view]").forEach(function (view) {
      view.hidden = view.id !== currentView;
    });
    document.querySelectorAll("nav a").forEach(function (link) {
      if (link.hash === "#" + currentView) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  }

  function setAccountMessage(message) {
    document.getElementById("account-status").textContent = message;
  }

  function submitCredentials(action, button) {
    const emailInput = document.getElementById("account-email");
    const passwordInput = document.getElementById("account-password");
    if (!emailInput.reportValidity() || !passwordInput.reportValidity()) {
      return;
    }
    passwordInput.autocomplete = action === "register" ? "new-password" : "current-password";
    button.disabled = true;
    setAccountMessage(action === "register" ? "Creating account..." : "Signing in...");
    apiRequest("/api/auth/" + action, "", {
      method: "POST",
      body: JSON.stringify({
        email: normalizeEmail(emailInput.value),
        password: passwordInput.value
      })
    }).then(function (session) {
      localStorage.setItem(accountTokenKey, session.token);
      passwordInput.value = "";
      setAccountMessage("Signed in.");
      return loadAccount();
    }).catch(function (error) {
      setAccountMessage(error.message);
    }).then(function () {
      button.disabled = false;
    });
  }

  function loadAccount() {
    const token = accountToken();
    if (!token) {
      displayAccount(false, "");
      return Promise.resolve();
    }
    return apiRequest("/api/me", token).then(function (user) {
      displayAccount(true, user.email);
    }).catch(function (error) {
      localStorage.removeItem(accountTokenKey);
      displayAccount(false, "");
      setAccountMessage(error.message || "Your session could not be verified. Sign in again.");
    });
  }

  function initializeAccounts() {
    document.getElementById("header-account").addEventListener("click", function (event) {
      if (accountToken()) {
        event.preventDefault();
        toggleProfileMenu();
      }
    });
    document.querySelectorAll("[data-profile-target]").forEach(function (link) {
      link.addEventListener("click", function (event) {
        event.preventDefault();
        openAccountSection(link.dataset.profileTarget);
      });
    });
    document.addEventListener("click", function (event) {
      if (!event.target.closest(".profile-menu-container")) {
        closeProfileMenu();
      }
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        closeProfileMenu();
        document.getElementById("header-account").focus();
      }
    });
    document.getElementById("clear-lookups").addEventListener("click", function () {
      try {
        localStorage.removeItem(lookupHistoryKey);
      } catch (error) {
        setAccountMessage("Could not clear lookup history in this browser.");
        return;
      }
      renderLookupHistory();
      setAccountMessage("Lookup history cleared from this browser.");
    });
    document.getElementById("account-form").addEventListener("submit", function (event) {
      event.preventDefault();
      submitCredentials("login", event.currentTarget.querySelector('[data-action="login"]'));
    });
    document.getElementById("create-account").addEventListener("click", function (event) {
      submitCredentials("register", event.currentTarget);
    });
    document.getElementById("sign-out").addEventListener("click", function () {
      const token = accountToken();
      apiRequest("/api/auth/logout", token, { method: "POST", body: "{}" })
        .then(function () {
          localStorage.removeItem(accountTokenKey);
          displayAccount(false, "");
          setAccountMessage("Signed out.");
        })
        .catch(function (error) {
          localStorage.removeItem(accountTokenKey);
          displayAccount(false, "");
          setAccountMessage("Signed out on this device; the server session could not be revoked: " + error.message);
        });
    });
    document.getElementById("delete-account").addEventListener("click", function () {
      if (!window.confirm("Permanently delete your account? This cannot be undone.")) {
        return;
      }
      apiRequest("/api/account", accountToken(), { method: "DELETE" })
        .then(function () {
          localStorage.removeItem(accountTokenKey);
          displayAccount(false, "");
          setAccountMessage("Account deleted.");
        })
        .catch(function (error) {
          setAccountMessage(error.message);
        });
    });
    loadAccount();
  }

  document.getElementById("account-password").autocomplete = "current-password";
  STOCKS.forEach(function (stock) {
    const option = document.createElement("option");
    option.value = stock.symbol;
    option.label = stock.name;
    document.getElementById("stock-symbols").appendChild(option);
  });
  stockForm.addEventListener("submit", function (event) {
    event.preventDefault();
    if (symbolInput.reportValidity()) {
      loadStock(symbolInput.value);
    }
  });
  window.addEventListener("hashchange", showView);
  showView();
  initializeAccounts();
  loadStock(symbolInput.value);
}());
