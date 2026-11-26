(function () {
  "use strict";

  const accountTokenKey = "northstarAccountToken";
  const lookupHistoryKey = "northstarLookupHistory";
  const settingsKey = "northstarSettings";
  const maxLookups = 10;
  const currencies = {
    AUD: "Australian Dollar", BRL: "Brazilian Real", CAD: "Canadian Dollar",
    CHF: "Swiss Franc", CNY: "Chinese Renminbi Yuan", CZK: "Czech Koruna",
    DKK: "Danish Krone", EUR: "Euro", GBP: "British Pound", HKD: "Hong Kong Dollar",
    HUF: "Hungarian Forint", IDR: "Indonesian Rupiah", ILS: "Israeli New Shekel",
    INR: "Indian Rupee", ISK: "Icelandic Krona", JPY: "Japanese Yen",
    KRW: "South Korean Won", MXN: "Mexican Peso", MYR: "Malaysian Ringgit",
    NOK: "Norwegian Krone", NZD: "New Zealand Dollar", PHP: "Philippine Peso",
    PLN: "Polish Zloty", RON: "Romanian Leu", SEK: "Swedish Krona",
    SGD: "Singapore Dollar", THB: "Thai Baht", TRY: "Turkish Lira",
    USD: "United States Dollar", ZAR: "South African Rand"
  };
  const exchangeRates = new Map();
  const stockForm = document.getElementById("stock-form");
  const symbolInput = document.getElementById("stock-symbol");
  let accountSignedIn = false;
  let currentStockData = null;
  let stockRenderId = 0;
  let marketMoversRequestId = 0;
  let marketMoversLoadedPeriod = "";
  let marketMoversLoadingPeriod = "";
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

  function readSettings() {
    const defaults = { darkMode: false, currency: "MARKET", dateRange: "3m" };
    try {
      const saved = JSON.parse(localStorage.getItem(settingsKey) || "{}");
      return {
        darkMode: typeof saved.darkMode === "boolean" ? saved.darkMode : defaults.darkMode,
        currency: saved.currency === "MARKET" || Object.prototype.hasOwnProperty.call(currencies, saved.currency)
          ? saved.currency
          : defaults.currency,
        dateRange: ["1w", "1m", "3m", "6m", "1y", "5y"].indexOf(saved.dateRange) !== -1
          ? saved.dateRange
          : defaults.dateRange
      };
    } catch (error) {
      return defaults;
    }
  }

  function saveSettings(settings) {
    try {
      localStorage.setItem(settingsKey, JSON.stringify(settings));
      return true;
    } catch (error) {
      document.getElementById("currency-status").textContent =
        "Could not save preferences in this browser.";
      return false;
    }
  }

  function applyTheme(darkMode) {
    document.body.dataset.theme = darkMode ? "dark" : "light";
  }

  function initializeSettings() {
    const settings = readSettings();
    const currencySelect = document.getElementById("currency-setting");
    Object.keys(currencies).sort().forEach(function (code) {
      const option = document.createElement("option");
      option.value = code;
      option.textContent = code + " - " + currencies[code];
      currencySelect.appendChild(option);
    });
    document.getElementById("dark-mode-setting").checked = settings.darkMode;
    currencySelect.value = settings.currency;
    document.getElementById("date-range-setting").value = settings.dateRange;
    applyTheme(settings.darkMode);

    document.getElementById("dark-mode-setting").addEventListener("change", function (event) {
      const next = Object.assign({}, readSettings(), { darkMode: event.currentTarget.checked });
      applyTheme(next.darkMode);
      saveSettings(next);
    });
    currencySelect.addEventListener("change", function (event) {
      const next = Object.assign({}, readSettings(), { currency: event.currentTarget.value });
      if (saveSettings(next) && currentStockData) {
        renderStock(currentStockData);
      }
    });
    document.getElementById("date-range-setting").addEventListener("change", function (event) {
      const next = Object.assign({}, readSettings(), { dateRange: event.currentTarget.value });
      if (saveSettings(next) && currentStockData) {
        renderStock(currentStockData);
      }
    });
  }

  function displayAccount(signedIn, email) {
    accountSignedIn = signedIn;
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
      displayPersonalInfo(null);
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
    const container = document.getElementById("account-lookups");
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
    const section = document.getElementById(sectionId);
    if (!section) {
      return;
    }
    window.location.hash = sectionId;
    showView();
    window.setTimeout(function () {
      if (!section.closest("[data-view]").hidden) {
        section.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 50);
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

  function getExchangeRate(baseCurrency, targetCurrency) {
    if (baseCurrency === targetCurrency) {
      return Promise.resolve(1);
    }
    const key = baseCurrency + ":" + targetCurrency;
    const cached = exchangeRates.get(key);
    if (cached && Date.now() - cached.fetchedAt < 60 * 60 * 1000) {
      return Promise.resolve(cached.rate);
    }
    const url = "https://api.frankfurter.dev/v1/latest?base=" +
      encodeURIComponent(baseCurrency) + "&symbols=" + encodeURIComponent(targetCurrency);
    return fetch(url, { headers: { accept: "application/json" } }).then(function (response) {
      if (!response.ok) {
        throw new Error("Exchange-rate service returned HTTP " + response.status + ".");
      }
      return response.json();
    }).then(function (data) {
      const rate = data && data.rates && Number(data.rates[targetCurrency]);
      if (!Number.isFinite(rate) || rate <= 0) {
        throw new Error("No exchange rate is available for " + baseCurrency + " to " + targetCurrency + ".");
      }
      exchangeRates.set(key, { rate: rate, fetchedAt: Date.now() });
      return rate;
    });
  }

  function formatPercent(value) {
    return (value > 0 ? "+" : "") + (value * 100).toFixed(2) + "%";
  }

  function renderChart(history, currencyCode, exchangeRate) {
    const svg = document.getElementById("price-chart");
    const empty = document.getElementById("chart-empty");
    const range = document.getElementById("chart-range");
    const settings = readSettings();
    const rangeCounts = { "1w": 5, "1m": 22, "3m": 65, "6m": 130, "1y": 260, "5y": 1300 };
    const recent = history.slice(-rangeCounts[settings.dateRange]);
    const rangeNames = { "1w": "week", "1m": "month", "3m": "months", "6m": "months", "1y": "year", "5y": "years" };
    document.getElementById("chart-range-label").textContent =
      "Daily closing prices · past " + settings.dateRange.slice(0, -1) + " " + rangeNames[settings.dateRange];
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
    const values = recent.map(function (item) { return item.close * (exchangeRate || 1); });
    const min = Math.min.apply(null, values);
    const max = Math.max.apply(null, values);
    const spread = max - min || max * 0.02 || 1;
    const points = recent.map(function (item, index) {
      const x = padding.left + index * (width - padding.left - padding.right) / (recent.length - 1);
      const y = padding.top + (max - item.close * (exchangeRate || 1)) *
        (height - padding.top - padding.bottom) / spread;
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

  function renderForecast(data, currencyCode, exchangeRate) {
    const forecastResults = document.getElementById("forecast-results");
    forecastResults.replaceChildren();
    data.forecast.forEach(function (item) {
      const row = document.createElement("div");
      row.className = "forecast-row";
      const label = document.createElement("strong");
      label.textContent = "Session " + item.session;
      const point = document.createElement("span");
      point.textContent = formatCurrency(item.price * exchangeRate, currencyCode);
      const interval = document.createElement("small");
      interval.textContent = formatCurrency(item.low * exchangeRate, currencyCode) + " - " +
        formatCurrency(item.high * exchangeRate, currencyCode) + " (80% model range)";
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

  function renderMarketMovers(data) {
    const stocks = data.stocks;
    const topStocks = stocks.slice(0, 5);
    const svg = document.getElementById("movers-chart");
    const empty = document.getElementById("movers-chart-empty");
    const legend = document.getElementById("movers-legend");
    const chartRange = document.getElementById("movers-chart-range");
    const list = document.getElementById("movers-list");
    const width = 720;
    const height = 260;
    const padding = { top: 16, right: 12, bottom: 20, left: 12 };
    const performanceSeries = topStocks.map(function (stock) {
      return stock.history.map(function (item) {
        return item.close / stock.history[0].close - 1;
      });
    });
    const allReturns = performanceSeries.reduce(function (all, series) {
      return all.concat(series);
    }, []);

    list.replaceChildren();
    stocks.forEach(function (stock, index) {
      const row = document.createElement("article");
      row.className = "mover-row";
      const rank = document.createElement("span");
      rank.className = "mover-rank";
      rank.textContent = String(index + 1);
      const identity = document.createElement("div");
      identity.className = "mover-identity";
      const symbol = document.createElement("strong");
      symbol.textContent = stock.symbol;
      const name = document.createElement("span");
      name.textContent = stock.name || stock.symbol;
      identity.append(symbol, name);
      const price = document.createElement("span");
      price.className = "mover-price";
      price.textContent = formatCurrency(stock.price, stock.currency);
      const change = document.createElement("strong");
      change.className = stock.periodReturn > 0 ? "positive" : stock.periodReturn < 0 ? "negative" : "";
      change.textContent = formatPercent(stock.periodReturn);
      const analyze = document.createElement("button");
      analyze.type = "button";
      analyze.className = "text-button";
      analyze.textContent = "Analyze";
      analyze.setAttribute("aria-label", "Analyze " + stock.symbol);
      analyze.addEventListener("click", function () {
        symbolInput.value = stock.symbol;
        window.location.hash = "stocks";
        loadStock(stock.symbol);
      });
      row.append(rank, identity, price, change, analyze);
      list.appendChild(row);
    });

    if (topStocks.length < 2 || !allReturns.length) {
      svg.hidden = true;
      legend.hidden = true;
      chartRange.hidden = true;
      empty.hidden = false;
      empty.textContent = "Not enough data to draw the performance chart.";
      return;
    }

    const min = Math.min.apply(null, allReturns.concat([0]));
    const max = Math.max.apply(null, allReturns.concat([0]));
    const spread = max - min || 0.02;
    const baselineY = padding.top + max * (height - padding.top - padding.bottom) / spread;
    svg.replaceChildren();
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    const baseline = document.createElementNS("http://www.w3.org/2000/svg", "line");
    baseline.setAttribute("x1", String(padding.left));
    baseline.setAttribute("x2", String(width - padding.right));
    baseline.setAttribute("y1", baselineY.toFixed(2));
    baseline.setAttribute("y2", baselineY.toFixed(2));
    baseline.setAttribute("class", "movers-zero-line");
    svg.appendChild(baseline);
    performanceSeries.forEach(function (series, seriesIndex) {
      const path = series.map(function (value, pointIndex) {
        const x = padding.left + pointIndex * (width - padding.left - padding.right) /
          Math.max(series.length - 1, 1);
        const y = padding.top + (max - value) * (height - padding.top - padding.bottom) / spread;
        return (pointIndex === 0 ? "M" : "L") + x.toFixed(2) + " " + y.toFixed(2);
      }).join(" ");
      const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
      line.setAttribute("d", path);
      line.setAttribute("class", "movers-line movers-line-" + seriesIndex);
      svg.appendChild(line);
    });
    svg.hidden = false;
    empty.hidden = true;
    legend.replaceChildren();
    topStocks.forEach(function (stock, index) {
      const label = document.createElement("span");
      label.className = "movers-legend-item";
      const marker = document.createElement("span");
      marker.className = "movers-legend-marker movers-line-" + index;
      marker.setAttribute("aria-hidden", "true");
      label.append(marker, document.createTextNode(stock.symbol));
      legend.appendChild(label);
    });
    legend.hidden = false;
    chartRange.hidden = false;
    chartRange.textContent = topStocks[0].history[0].date + "  ·  0% baseline  ·  " +
      topStocks[0].history[topStocks[0].history.length - 1].date;
  }

  function loadMarketMovers() {
    const period = document.getElementById("movers-period").value;
    if (period === marketMoversLoadedPeriod || period === marketMoversLoadingPeriod) {
      return;
    }
    const requestId = ++marketMoversRequestId;
    marketMoversLoadingPeriod = period;
    document.getElementById("movers-status").textContent = "Loading popular stock performance...";
    document.getElementById("movers-chart").hidden = true;
    document.getElementById("movers-legend").hidden = true;
    document.getElementById("movers-chart-range").hidden = true;
    document.getElementById("movers-chart-empty").hidden = false;
    document.getElementById("movers-chart-empty").textContent = "Loading historical prices...";
    showEmptyMessage(document.getElementById("movers-list"), "Loading popular stock history...");
    apiRequest("/api/market-movers?period=" + encodeURIComponent(period), "")
      .then(function (data) {
        if (requestId !== marketMoversRequestId) {
          return;
        }
        renderMarketMovers(data);
        marketMoversLoadedPeriod = period;
        const periodLabel = document.getElementById("movers-period").selectedOptions[0].textContent;
        document.getElementById("movers-status").textContent =
          "Updated " + new Date(data.updatedAt).toLocaleString() +
          (data.unavailableCount ? " · " + data.unavailableCount + " symbols unavailable" : "") +
          " · " + periodLabel;
      })
      .catch(function (error) {
        if (requestId === marketMoversRequestId) {
          document.getElementById("movers-status").textContent = error.message;
          document.getElementById("movers-chart-empty").textContent =
            "Popular stock performance is unavailable. Try changing the timeframe.";
          showEmptyMessage(document.getElementById("movers-list"), "Popular stock history is unavailable.");
        }
      })
      .then(function () {
        if (requestId === marketMoversRequestId) {
          marketMoversLoadingPeriod = "";
        }
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
    currentStockData = data;
    const renderId = ++stockRenderId;
    const settings = readSettings();
    const currencyCode = settings.currency === "MARKET" ? data.currency : settings.currency;
    const status = document.getElementById("currency-status");
    status.textContent = settings.currency === "MARKET"
      ? "Prices use each security's market currency (" + data.currency + ")."
      : "Loading " + currencyCode + " reference exchange rate...";

    return getExchangeRate(data.currency, currencyCode).then(function (exchangeRate) {
      if (renderId !== stockRenderId) {
        return;
      }
      renderStockValues(data, currencyCode, exchangeRate);
      status.textContent = settings.currency === "MARKET"
        ? "Prices shown in market currency (" + data.currency + ")."
        : "Prices converted from " + data.currency + " to " + currencyCode +
          " using a reference rate from Frankfurter; rates may be delayed.";
    }).catch(function (error) {
      if (renderId !== stockRenderId) {
        return;
      }
      renderStockValues(data, data.currency, 1);
      status.textContent = "Could not convert to " + currencyCode + ". Showing market currency (" +
        data.currency + "). " + error.message;
    });
  }

  function renderStockValues(data, currencyCode, exchangeRate) {
    const overview = document.getElementById("stock-overview");
    overview.hidden = false;
    document.getElementById("company-name").textContent = data.name || data.symbol;
    document.getElementById("quote-symbol").textContent = data.symbol;
    document.getElementById("quote-price").textContent = formatCurrency(data.price * exchangeRate, currencyCode);
    const quoteChange = document.getElementById("quote-change");
    quoteChange.textContent = formatCurrency(data.change * exchangeRate, currencyCode) + " (" +
      formatPercent(data.changePercent) + ") vs previous close";
    quoteChange.classList.toggle("positive", data.change >= 0);
    quoteChange.classList.toggle("negative", data.change < 0);
    document.getElementById("quote-date").textContent = "As of " + data.priceDate;
    document.getElementById("projection-change").textContent = formatPercent(data.projectionPercent);
    document.getElementById("projection-price").textContent =
      "Estimated two-session price: " + formatCurrency(data.forecast[1].price * exchangeRate, currencyCode);
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
    renderChart(data.history, currencyCode, exchangeRate);
    renderForecast(data, currencyCode, exchangeRate);
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
    const requestedElement = document.getElementById(requestedView);
    const parentView = requestedElement && requestedElement.closest("[data-view]");
    const currentView = parentView ? parentView.id : "stocks";
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
    if (currentView === "market-movers") {
      loadMarketMovers();
    }
  }

  function setAccountMessage(message) {
    document.getElementById("account-status").textContent = message;
  }

  function displayPersonalInfo(profile) {
    const form = document.getElementById("personal-info-form");
    const fields = ["fullName", "phone", "streetAddress", "city", "region", "postalCode", "country"];
    fields.forEach(function (field) {
      const input = form.elements.namedItem(field);
      input.value = profile && typeof profile[field] === "string" ? profile[field] : "";
      if (input.dataset.format) {
        formatNumericField(input);
      }
    });
  }

  function formatNumericField(input) {
    const digits = input.value.replace(/\D/g, "").slice(0, input.dataset.format === "phone" ? 10 : 6);
    if (input.dataset.format === "phone") {
      input.value = digits.length > 6
        ? digits.slice(0, 3) + "-" + digits.slice(3, 6) + "-" + digits.slice(6)
        : digits.length > 3
          ? digits.slice(0, 3) + "-" + digits.slice(3)
          : digits;
    } else {
      input.value = digits.length > 3 ? digits.slice(0, 3) + "-" + digits.slice(3) : digits;
    }
  }

  function initializeNumericFields() {
    document.querySelectorAll('input[data-format="phone"]').forEach(function (input) {
      input.addEventListener("input", function () {
        formatNumericField(input);
      });
    });
  }

  function addressStreet(properties) {
    const street = properties.street || properties.name || "";
    return [properties.housenumber, street].filter(Boolean).join(" ");
  }

  function addressLabel(properties) {
    return [
      addressStreet(properties),
      properties.postcode,
      properties.city || properties.locality || properties.district,
      properties.state,
      properties.country
    ].filter(Boolean).join(", ");
  }

  function applyAddressSuggestion(form, properties) {
    const values = {
      streetAddress: addressStreet(properties),
      city: properties.city || properties.locality || properties.district || "",
      region: properties.state || "",
      postalCode: properties.postcode || "",
      country: properties.country || ""
    };
    Object.keys(values).forEach(function (field) {
      form.elements.namedItem(field).value = values[field];
    });
  }

  function initializeAddressAutocomplete() {
    document.querySelectorAll(".address-autocomplete").forEach(function (container) {
      const input = container.querySelector('input[name="streetAddress"]');
      const list = container.querySelector('[role="listbox"]');
      const form = input.form;
      let timer;
      let request;
      let requestId = 0;
      let activeIndex = -1;

      function closeSuggestions() {
        requestId += 1;
        if (request) {
          request.abort();
          request = null;
        }
        list.hidden = true;
        list.replaceChildren();
        input.setAttribute("aria-expanded", "false");
        input.removeAttribute("aria-activedescendant");
        activeIndex = -1;
      }

      function showStatus(message) {
        list.replaceChildren();
        const status = document.createElement("div");
        status.className = "address-suggestion-status";
        status.setAttribute("role", "option");
        status.setAttribute("aria-disabled", "true");
        status.textContent = message;
        list.appendChild(status);
        list.hidden = false;
        input.setAttribute("aria-expanded", "true");
      }

      function selectSuggestion(properties) {
        applyAddressSuggestion(form, properties);
        closeSuggestions();
      }

      function setActiveOption(nextIndex) {
        const options = list.querySelectorAll('[role="option"]:not([aria-disabled="true"])');
        if (!options.length) {
          return;
        }
        activeIndex = (nextIndex + options.length) % options.length;
        options.forEach(function (option, index) {
          option.setAttribute("aria-selected", String(index === activeIndex));
        });
        input.setAttribute("aria-activedescendant", options[activeIndex].id);
      }

      function renderSuggestions(features) {
        list.replaceChildren();
        activeIndex = -1;
        if (!features.length) {
          showStatus("No address suggestions found.");
          return;
        }
        features.forEach(function (feature, index) {
          const option = document.createElement("button");
          option.type = "button";
          option.id = "address-option-" + requestId + "-" + index;
          option.setAttribute("role", "option");
          option.setAttribute("aria-selected", "false");
          option.className = "address-suggestion";
          option.textContent = addressLabel(feature.properties);
          option.addEventListener("pointerdown", function (event) {
            event.preventDefault();
          });
          option.addEventListener("click", function () {
            selectSuggestion(feature.properties);
          });
          list.appendChild(option);
        });
        list.hidden = false;
        input.setAttribute("aria-expanded", "true");
      }

      input.addEventListener("input", function () {
        window.clearTimeout(timer);
        requestId += 1;
        if (request) {
          request.abort();
        }
        const query = input.value.trim();
        if (query.length < 3) {
          closeSuggestions();
          return;
        }
        showStatus("Searching for addresses...");
        timer = window.setTimeout(function () {
          const currentRequestId = requestId;
          request = new AbortController();
          const url = "https://photon.komoot.io/api/?q=" +
            encodeURIComponent(query) + "&limit=5&lang=en";
          fetch(url, { signal: request.signal, headers: { accept: "application/json" } })
            .then(function (response) {
              if (!response.ok) {
                throw new Error("Address lookup returned HTTP " + response.status + ".");
              }
              return response.json();
            })
            .then(function (data) {
              if (currentRequestId === requestId) {
                renderSuggestions(Array.isArray(data.features) ? data.features : []);
              }
            })
            .catch(function (error) {
              if (error.name !== "AbortError" && currentRequestId === requestId) {
                showStatus("Address suggestions are unavailable. You can enter the address manually.");
              }
            });
        }, 300);
      });

      input.addEventListener("keydown", function (event) {
        const options = list.querySelectorAll('[role="option"]:not([aria-disabled="true"])');
        if (event.key === "ArrowDown" && !list.hidden) {
          event.preventDefault();
          setActiveOption(activeIndex + 1);
        } else if (event.key === "ArrowUp" && !list.hidden) {
          event.preventDefault();
          setActiveOption(activeIndex < 0 ? options.length - 1 : activeIndex - 1);
        } else if (event.key === "Enter" && activeIndex >= 0) {
          event.preventDefault();
          options[activeIndex].click();
        } else if (event.key === "Escape") {
          closeSuggestions();
        }
      });

      input.addEventListener("blur", function () {
        window.setTimeout(closeSuggestions, 150);
      });
    });
  }

  function submitPersonalInfo(button) {
    const form = document.getElementById("personal-info-form");
    const fields = ["fullName", "phone", "streetAddress", "city", "region", "postalCode", "country"];
    const profile = {};
    fields.forEach(function (field) {
      profile[field] = form.elements.namedItem(field).value.trim();
    });
    button.disabled = true;
    document.getElementById("personal-info-status").textContent = "Saving personal information...";
    apiRequest("/api/profile", accountToken(), {
      method: "PUT",
      body: JSON.stringify({ profile: profile })
    }).then(function () {
      document.getElementById("personal-info-status").textContent = "Personal information saved.";
    }).catch(function (error) {
      document.getElementById("personal-info-status").textContent =
        "Could not save personal information: " + error.message;
    }).then(function () {
      button.disabled = false;
    });
  }

  function setAccountFormMode(mode) {
    const form = document.getElementById("account-form");
    const signupDetails = document.getElementById("signup-details");
    const actionButton = document.getElementById("account-submit");
    const createButton = document.getElementById("create-account");
    const isRegister = mode === "register";
    form.dataset.mode = isRegister ? "register" : "login";
    signupDetails.disabled = !isRegister;
    signupDetails.hidden = !isRegister;
    signupDetails.querySelectorAll("input").forEach(function (input) {
      input.required = isRegister;
    });
    document.getElementById("account-form-heading").textContent =
      isRegister ? "Create your account" : "Sign in";
    actionButton.textContent = isRegister ? "Create account" : "Sign in";
    actionButton.dataset.action = mode;
    createButton.textContent = isRegister ? "Back to sign in" : "Create account";
    document.getElementById("account-password").autocomplete =
      isRegister ? "new-password" : "current-password";
  }

  function submitCredentials(action, button) {
    const emailInput = document.getElementById("account-email");
    const passwordInput = document.getElementById("account-password");
    if (!emailInput.reportValidity() || !passwordInput.reportValidity()) {
      return;
    }
    const profile = {};
    if (action === "register") {
      const form = document.getElementById("account-form");
      ["fullName", "phone", "streetAddress", "city", "region", "postalCode", "country"]
        .forEach(function (field) {
          const input = form.elements.namedItem(field);
          if (!input.reportValidity()) {
            return;
          }
          profile[field] = input.value.trim();
        });
      if (Object.keys(profile).length !== 7) {
        return;
      }
    }
    passwordInput.autocomplete = action === "register" ? "new-password" : "current-password";
    button.disabled = true;
    setAccountMessage(action === "register" ? "Creating account..." : "Signing in...");
    apiRequest("/api/auth/" + action, "", {
      method: "POST",
      body: JSON.stringify({
        email: normalizeEmail(emailInput.value),
        password: passwordInput.value,
        profile: action === "register" ? profile : undefined
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
      displayPersonalInfo(user.profile);
    }).catch(function (error) {
      localStorage.removeItem(accountTokenKey);
      displayAccount(false, "");
      displayPersonalInfo(null);
      setAccountMessage(error.message || "Your session could not be verified. Sign in again.");
    });
  }

  function initializeAccounts() {
    document.getElementById("header-account").addEventListener("click", function (event) {
      if (accountSignedIn) {
        event.preventDefault();
        toggleProfileMenu();
      } else {
        window.location.hash = "account";
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
    document.getElementById("personal-info-form").addEventListener("submit", function (event) {
      event.preventDefault();
      submitPersonalInfo(event.currentTarget.querySelector("#save-personal-info"));
    });
    document.getElementById("account-form").addEventListener("submit", function (event) {
      event.preventDefault();
      const action = event.currentTarget.dataset.mode === "register" ? "register" : "login";
      submitCredentials(action, event.currentTarget.querySelector('[data-action]'));
    });
    document.getElementById("create-account").addEventListener("click", function (event) {
      setAccountFormMode(
        document.getElementById("account-form").dataset.mode === "register" ? "login" : "register"
      );
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
  setAccountFormMode("login");
  initializeNumericFields();
  initializeAddressAutocomplete();
  initializeSettings();
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
  document.getElementById("movers-period").addEventListener("change", function () {
    marketMoversLoadedPeriod = "";
    loadMarketMovers();
  });
  showView();
  initializeAccounts();
  loadStock(symbolInput.value);
}());
