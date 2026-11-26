(function () {
  "use strict";

  const accountTokenKey = "northstarAccountToken";
  const lookupHistoryKey = "northstarLookupHistory";
  const watchlistKey = "crystalballstocksWatchlist";
  const settingsKey = "northstarSettings";
  const maxLookups = 10;
  const maxWatchlistStocks = 8;
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
  let lastStockSymbol = symbolInput.value;
  let stockSearchRequestId = 0;
  let stockSearchController = null;
  let stockSearchTimer = null;
  let accountSignedIn = false;
  let currentStockData = null;
  let currentChartCurrency = "USD";
  let currentChartExchangeRate = 1;
  let stockRenderId = 0;
  let benchmarkHistory = null;
  let benchmarkLoadedSymbol = "";
  let benchmarkRequestId = 0;
  let watchlistRequestId = 0;
  let marketMoversRequestId = 0;
  let marketMoversLoadedPeriod = "";
  let marketMoversLoadingPeriod = "";
  let candidateRequestId = 0;
  let candidateLoadedPeriod = "";
  let candidateLoadingPeriod = "";
  let newsRequestId = 0;
  let newsLoaded = false;
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

  function readWatchlist() {
    try {
      const saved = JSON.parse(localStorage.getItem(watchlistKey) || "[]");
      return Array.isArray(saved)
        ? saved.filter(function (symbol) {
          return typeof symbol === "string" && /^[A-Z0-9.^=-]{1,12}$/.test(symbol);
        }).filter(function (symbol, index, list) {
          return list.indexOf(symbol) === index;
        }).slice(0, maxWatchlistStocks)
        : [];
    } catch (error) {
      return [];
    }
  }

  function saveWatchlist(symbols) {
    try {
      localStorage.setItem(watchlistKey, JSON.stringify(symbols.slice(0, maxWatchlistStocks)));
      return true;
    } catch (error) {
      document.getElementById("watchlist-status").textContent =
        "Could not save your watchlist in this browser.";
      return false;
    }
  }

  function updateWatchlistToggle() {
    const button = document.getElementById("watchlist-toggle");
    const symbol = currentStockData && currentStockData.symbol;
    const saved = symbol && readWatchlist().indexOf(symbol) !== -1;
    button.disabled = !symbol;
    button.textContent = saved ? "Remove from watchlist" : "Add to watchlist";
    button.setAttribute("aria-pressed", String(Boolean(saved)));
  }

  function renderWatchlist(stocks) {
    const list = document.getElementById("watchlist-list");
    list.replaceChildren();
    if (!stocks.length) {
      const empty = document.createElement("p");
      empty.className = "chart-empty";
      empty.textContent = "Add a stock from its quote card to start your watchlist.";
      list.appendChild(empty);
      return;
    }
    stocks.forEach(function (stock) {
      const row = document.createElement("article");
      row.className = "watchlist-row";
      const open = document.createElement("button");
      open.type = "button";
      open.className = "watchlist-stock";
      open.setAttribute("aria-label", "Analyze " + stock.symbol);
      const identity = document.createElement("span");
      identity.className = "watchlist-identity";
      const symbol = document.createElement("strong");
      symbol.textContent = stock.symbol;
      const name = document.createElement("small");
      name.textContent = stock.name || stock.symbol;
      identity.append(symbol, name);
      const price = document.createElement("span");
      price.className = "watchlist-price";
      price.textContent = formatCurrency(stock.price, stock.currency);
      const daily = document.createElement("small");
      daily.className = stock.dailyChange > 0 ? "positive" : stock.dailyChange < 0 ? "negative" : "";
      daily.textContent = formatPercent(stock.dailyChange) + " today";
      const period = document.createElement("strong");
      period.className = stock.periodReturn > 0 ? "positive" : stock.periodReturn < 0 ? "negative" : "";
      period.textContent = formatPercent(stock.periodReturn);
      open.append(identity, price, daily, period);
      open.addEventListener("click", function () {
        symbolInput.value = stock.symbol;
        window.location.hash = "stocks";
        loadStock(stock.symbol);
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "text-button";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", "Remove " + stock.symbol + " from watchlist");
      remove.addEventListener("click", function () {
        const next = readWatchlist().filter(function (savedSymbol) {
          return savedSymbol !== stock.symbol;
        });
        if (saveWatchlist(next)) {
          updateWatchlistToggle();
          loadWatchlist();
        }
      });
      row.append(open, remove);
      list.appendChild(row);
    });
  }

  function loadWatchlist() {
    const symbols = readWatchlist();
    const status = document.getElementById("watchlist-status");
    const list = document.getElementById("watchlist-list");
    const requestId = ++watchlistRequestId;
    if (!symbols.length) {
      status.textContent = "";
      renderWatchlist([]);
      return;
    }
    status.textContent = "Loading latest watchlist prices...";
    showEmptyMessage(list, "Loading saved stocks...");
    const period = document.getElementById("watchlist-period").value;
    apiRequest("/api/watchlist?symbols=" + encodeURIComponent(symbols.join(",")) +
      "&period=" + encodeURIComponent(period), "")
      .then(function (data) {
        if (requestId !== watchlistRequestId) {
          return;
        }
        if (!data.stocks.length && data.unavailable.length) {
          showEmptyMessage(list, "Could not load saved stock prices. Try again later.");
        } else {
          renderWatchlist(data.stocks);
        }
        status.textContent = "Prices as of " + new Date(data.updatedAt).toLocaleString() +
          (data.unavailable.length ? " · Could not load " + data.unavailable.join(", ") + "." : "") +
          " · period return: " + document.getElementById("watchlist-period").selectedOptions[0].textContent;
      })
      .catch(function (error) {
        if (requestId === watchlistRequestId) {
          status.textContent = error.message;
          showEmptyMessage(list, "Watchlist prices are unavailable right now.");
        }
      });
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

  function setMarketStatus(message) {
    document.getElementById("market-status").textContent = message;
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

  function appendChartGrid(svg, width, height, padding) {
    const color = getComputedStyle(document.body).getPropertyValue("--chart-grid").trim();
    [0.25, 0.5, 0.75].forEach(function (fraction) {
      const gridline = document.createElementNS("http://www.w3.org/2000/svg", "line");
      const y = padding.top + fraction * (height - padding.top - padding.bottom);
      gridline.setAttribute("x1", String(padding.left));
      gridline.setAttribute("x2", String(width - padding.right));
      gridline.setAttribute("y1", y.toFixed(2));
      gridline.setAttribute("y2", y.toFixed(2));
      gridline.setAttribute("class", "chart-gridline");
      gridline.setAttribute("stroke", color);
      gridline.setAttribute("stroke-width", "1");
      gridline.setAttribute("vector-effect", "non-scaling-stroke");
      svg.appendChild(gridline);
    });
  }

  function csvCell(value) {
    if (value === null || value === undefined) {
      return "";
    }
    if (typeof value === "number") {
      return Number.isFinite(value) ? String(value) : "";
    }
    let text = String(value);
    if (/^[\s]*[=+\-@]/.test(text)) {
      text = "'" + text;
    }
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function exportStockData() {
    if (!currentStockData) {
      return;
    }
    const data = currentStockData;
    const currencyCode = currentChartCurrency;
    const exchangeRate = currentChartExchangeRate;
    const rows = [[
      "Section", "Date", "Symbol", "Name", "Currency", "Price", "Change", "Return",
      "Low", "High", "Notes"
    ]];
    function addRow(section, date, symbol, name, currency, price, change, changePercent, low, high, notes) {
      rows.push([section, date, symbol, name, currency, price, change, changePercent, low, high, notes]);
    }

    addRow("Quote", data.priceDate, data.symbol, data.name, currencyCode,
      data.price * exchangeRate, data.change * exchangeRate, data.changePercent, "", "",
      "Latest daily close; displayed values use a reference exchange rate from " + data.currency +
        " at " + exchangeRate + ".");
    data.forecast.forEach(function (item) {
      addRow("Forecast session " + item.session, "", data.symbol, data.name, currencyCode,
        item.price * exchangeRate, "", item.price / data.price - 1,
        item.low * exchangeRate, item.high * exchangeRate,
        "Estimated range; actual prices may fall outside it.");
    });
    addRow("Model confidence", "", data.symbol, data.name, "", "", "",
      data.model.directionalAccuracy === null ? "" : data.model.directionalAccuracy,
      "", "", data.model.directionalAccuracy === null
        ? "Insufficient out-of-sample history."
        : "Historical directional accuracy across " + data.model.backtestCount +
          " tests; not a probability of future success.");
    data.comparables.forEach(function (item) {
      addRow("Comparable", "", item.symbol, item.name, "", "", "", item.return, "", "",
        "Return over latest 20 aligned sessions.");
    });
    data.history.forEach(function (item) {
      addRow("Daily close", item.date, data.symbol, data.name, currencyCode,
        item.close * exchangeRate, "", "", "", "",
        "Historical close; converted from " + data.currency + " using the reference rate above.");
    });

    const csv = "\uFEFF" + rows.map(function (row) {
      return row.map(csvCell).join(",");
    }).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = data.symbol + "-stock-research.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function renderChart(history, currencyCode, exchangeRate, comparisonHistory, comparisonSymbol) {
    const svg = document.getElementById("price-chart");
    const empty = document.getElementById("chart-empty");
    const range = document.getElementById("chart-range");
    const legend = document.getElementById("benchmark-legend");
    const benchmarkStatus = document.getElementById("benchmark-status");
    const settings = readSettings();
    const rangeCounts = { "1w": 5, "1m": 22, "3m": 65, "6m": 130, "1y": 260, "5y": 1300 };
    const recent = history.slice(-rangeCounts[settings.dateRange]);
    const rangeNames = { "1w": "week", "1m": "month", "3m": "months", "6m": "months", "1y": "year", "5y": "years" };
    document.getElementById("chart-range-label").textContent =
      "Daily closing prices · past " + settings.dateRange.slice(0, -1) + " " + rangeNames[settings.dateRange];
    if (recent.length < 2) {
      svg.hidden = true;
      range.hidden = true;
      legend.hidden = true;
      empty.hidden = false;
      empty.textContent = "Not enough price history to draw a chart.";
      return;
    }

    const width = 720;
    const height = 250;
    const padding = { top: 16, right: 12, bottom: 20, left: 12 };
    const benchmarkByDate = new Map((comparisonHistory || []).map(function (item) {
      return [item.date, item.close];
    }));
    const shared = comparisonSymbol && comparisonSymbol !== "none"
      ? recent.filter(function (item) { return benchmarkByDate.has(item.date); })
      : [];
    const compared = shared.length >= 2;
    const chartItems = compared ? shared : recent;
    const targetValues = compared
      ? chartItems.map(function (item) { return item.close / chartItems[0].close - 1; })
      : chartItems.map(function (item) { return item.close * (exchangeRate || 1); });
    const benchmarkValues = compared
      ? chartItems.map(function (item) {
        return benchmarkByDate.get(item.date) / benchmarkByDate.get(chartItems[0].date) - 1;
      })
      : [];
    const values = targetValues.concat(benchmarkValues);
    const min = Math.min.apply(null, values);
    const max = Math.max.apply(null, values);
    const spread = max - min || (compared ? 0.02 : max * 0.02) || 1;
    function makePath(series) {
      return series.map(function (value, index) {
        const x = padding.left + index * (width - padding.left - padding.right) / (series.length - 1);
        const y = padding.top + (max - value) *
        (height - padding.top - padding.bottom) / spread;
        return (index === 0 ? "M" : "L") + x.toFixed(2) + " " + y.toFixed(2);
      }).join(" ");
    }

    svg.replaceChildren();
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.removeAttribute("hidden");
    svg.style.display = "block";
    const gridColor = getComputedStyle(document.body).getPropertyValue("--chart-grid").trim();
    appendChartGrid(svg, width, height, padding);
    if (compared) {
      const zeroLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
      const zeroY = padding.top + (max / spread) * (height - padding.top - padding.bottom);
      zeroLine.setAttribute("x1", String(padding.left));
      zeroLine.setAttribute("x2", String(width - padding.right));
      zeroLine.setAttribute("y1", zeroY.toFixed(2));
      zeroLine.setAttribute("y2", zeroY.toFixed(2));
      zeroLine.setAttribute("class", "benchmark-zero-line");
      zeroLine.setAttribute("fill", "none");
      zeroLine.setAttribute("stroke", gridColor);
      zeroLine.setAttribute("stroke-width", "1");
      svg.appendChild(zeroLine);
    }
    const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
    line.setAttribute("d", makePath(targetValues));
    line.setAttribute("class", "chart-line");
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", getComputedStyle(document.body).getPropertyValue("--green").trim());
    line.setAttribute("stroke-width", "2.5");
    line.setAttribute("stroke-linecap", "round");
    line.setAttribute("stroke-linejoin", "round");
    line.setAttribute("vector-effect", "non-scaling-stroke");
    svg.appendChild(line);
    if (compared) {
      const benchmarkLine = document.createElementNS("http://www.w3.org/2000/svg", "path");
      benchmarkLine.setAttribute("d", makePath(benchmarkValues));
      benchmarkLine.setAttribute("class", "benchmark-chart-line");
      benchmarkLine.setAttribute("fill", "none");
      benchmarkLine.setAttribute("stroke",
        getComputedStyle(document.body).getPropertyValue("--chart-series-2").trim());
      benchmarkLine.setAttribute("stroke-width", "2.5");
      benchmarkLine.setAttribute("stroke-linecap", "round");
      benchmarkLine.setAttribute("stroke-linejoin", "round");
      benchmarkLine.setAttribute("vector-effect", "non-scaling-stroke");
      svg.appendChild(benchmarkLine);
    }
    svg.hidden = false;
    empty.hidden = true;
    range.hidden = false;
    if (compared) {
      const symbol = symbolInput.value.trim().toUpperCase();
      const targetReturn = targetValues[targetValues.length - 1];
      const benchmarkReturn = benchmarkValues[benchmarkValues.length - 1];
      range.textContent = chartItems[0].date + "  ·  " + symbol + " " + formatPercent(targetReturn) +
        "  /  " + comparisonSymbol + " " + formatPercent(benchmarkReturn) + "  ·  " +
        chartItems[chartItems.length - 1].date;
      legend.replaceChildren();
      [
        { label: symbol, className: "chart-legend-stock" },
        { label: comparisonSymbol, className: "chart-legend-benchmark" }
      ].forEach(function (item) {
        const entry = document.createElement("span");
        entry.className = "chart-legend-item";
        const marker = document.createElement("span");
        marker.className = item.className;
        marker.setAttribute("aria-hidden", "true");
        entry.append(marker, document.createTextNode(item.label));
        legend.appendChild(entry);
      });
      legend.hidden = false;
      document.getElementById("chart-range-label").textContent =
        "Relative price performance · both indexed to 0% on the first shared trading day";
      benchmarkStatus.textContent = "Comparing with " +
        (comparisonSymbol === "SPY" ? "the S&P 500" : "the Nasdaq-100") + ".";
    } else {
      legend.hidden = true;
      range.textContent = chartItems[0].date + "  ·  " +
        formatCurrency(min, currencyCode) + " low  /  " +
        formatCurrency(max, currencyCode) + " high  ·  " + chartItems[chartItems.length - 1].date;
      document.getElementById("chart-range-label").textContent =
        "Daily closing prices · past " + settings.dateRange.slice(0, -1) + " " + rangeNames[settings.dateRange];
      if (comparisonSymbol && comparisonSymbol !== "none" && comparisonHistory &&
        comparisonHistory.length && shared.length < 2) {
        benchmarkStatus.textContent = "Not enough shared trading dates to compare this benchmark.";
      } else if (comparisonSymbol === "none") {
        benchmarkStatus.textContent = "Benchmark comparison is off.";
      }
    }
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
    let expandedEntry = null;
    stocks.forEach(function (stock, index) {
      const entry = document.createElement("article");
      entry.className = "mover-entry";
      const row = document.createElement("div");
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
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "mover-toggle";
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Show " + stock.symbol + " price trend");
      toggle.append(rank, identity, price, change);
      const details = document.createElement("div");
      details.className = "mover-trend";
      details.hidden = true;
      details.id = "mover-trend-" + stock.symbol.toLowerCase();
      toggle.setAttribute("aria-controls", details.id);
      const trendHeading = document.createElement("div");
      trendHeading.className = "mover-trend-heading";
      const trendTitle = document.createElement("strong");
      trendTitle.textContent = stock.symbol + " price trend";
      const trendSummary = document.createElement("span");
      trendSummary.className = stock.periodReturn > 0 ? "positive" : stock.periodReturn < 0 ? "negative" : "";
      trendSummary.textContent =
        (stock.periodReturn > 0 ? "Upward" : stock.periodReturn < 0 ? "Downward" : "Flat") +
        " over " + formatPercent(stock.periodReturn);
      trendHeading.append(trendTitle, trendSummary);
      const trendChart = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      trendChart.setAttribute("class", "mover-trend-chart");
      trendChart.setAttribute("viewBox", "0 0 720 180");
      trendChart.setAttribute("role", "img");
      trendChart.setAttribute("aria-label", stock.symbol + " historical price change over " +
        document.getElementById("movers-period").selectedOptions[0].textContent);
      trendChart.setAttribute("tabindex", "0");
      trendChart.setAttribute("aria-describedby", "mover-tooltip-" + stock.symbol.toLowerCase());
      const trendTooltip = document.createElement("p");
      trendTooltip.className = "mover-tooltip";
      trendTooltip.id = "mover-tooltip-" + stock.symbol.toLowerCase();
      trendTooltip.setAttribute("role", "status");
      trendTooltip.hidden = true;
      const chartRange = document.createElement("div");
      chartRange.className = "mover-trend-range";
      chartRange.textContent = stock.history[0].date + "  ·  " +
        formatCurrency(stock.history[0].close, stock.currency) + " to " +
        formatCurrency(stock.price, stock.currency) + "  ·  " +
        stock.history[stock.history.length - 1].date;
      details.append(trendHeading, trendChart, trendTooltip, chartRange);
      toggle.addEventListener("click", function () {
        const opening = details.hidden;
        if (expandedEntry && expandedEntry !== entry) {
          expandedEntry.querySelector(".mover-toggle").setAttribute("aria-expanded", "false");
          expandedEntry.querySelector(".mover-trend").hidden = true;
        }
        details.hidden = !opening;
        toggle.setAttribute("aria-expanded", String(opening));
        if (opening) {
          expandedEntry = entry;
          if (!trendChart.hasChildNodes()) {
            const returns = stock.history.map(function (item) {
              return item.close / stock.history[0].close - 1;
            });
            const minReturn = Math.min.apply(null, returns.concat([0]));
            const maxReturn = Math.max.apply(null, returns.concat([0]));
            const spreadReturn = maxReturn - minReturn || 0.02;
            const top = 12;
            const bottom = 168;
            const path = returns.map(function (value, pointIndex) {
              const x = pointIndex * 720 / Math.max(returns.length - 1, 1);
              const y = top + (maxReturn - value) * (bottom - top) / spreadReturn;
              return (pointIndex === 0 ? "M" : "L") + x.toFixed(2) + " " + y.toFixed(2);
            }).join(" ");
            const zeroY = top + maxReturn * (bottom - top) / spreadReturn;
            const baseline = document.createElementNS("http://www.w3.org/2000/svg", "line");
            baseline.setAttribute("x1", "0");
            baseline.setAttribute("x2", "720");
            baseline.setAttribute("y1", zeroY.toFixed(2));
            baseline.setAttribute("y2", zeroY.toFixed(2));
            baseline.setAttribute("class", "mover-trend-zero");
            appendChartGrid(trendChart, 720, 180, { top: top, right: 0, bottom: 12, left: 0 });
            const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
            line.setAttribute("d", path);
            line.setAttribute("class", "mover-trend-line");
            const crosshair = document.createElementNS("http://www.w3.org/2000/svg", "line");
            crosshair.setAttribute("y1", String(top));
            crosshair.setAttribute("y2", String(bottom));
            crosshair.setAttribute("class", "mover-trend-crosshair");
            crosshair.setAttribute("visibility", "hidden");
            const marker = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            marker.setAttribute("r", "5");
            marker.setAttribute("class", "mover-trend-marker");
            marker.setAttribute("visibility", "hidden");
            trendChart.append(baseline, line, crosshair, marker);

            function showPoint(pointIndex) {
              const boundedIndex = Math.max(0, Math.min(pointIndex, stock.history.length - 1));
              const point = stock.history[boundedIndex];
              const relativeReturn = point.close / stock.history[0].close - 1;
              const x = boundedIndex * 720 / Math.max(stock.history.length - 1, 1);
              const y = top + (maxReturn - returns[boundedIndex]) * (bottom - top) / spreadReturn;
              crosshair.setAttribute("x1", x.toFixed(2));
              crosshair.setAttribute("x2", x.toFixed(2));
              crosshair.removeAttribute("visibility");
              marker.setAttribute("cx", x.toFixed(2));
              marker.setAttribute("cy", y.toFixed(2));
              marker.removeAttribute("visibility");
              trendTooltip.textContent = point.date + " · " +
                formatCurrency(point.close, stock.currency) + " · " +
                formatPercent(relativeReturn) + " vs. start · " +
                Math.round(boundedIndex / Math.max(stock.history.length - 1, 1) * 100) +
                "% through timeframe";
              trendTooltip.hidden = false;
              trendChart.dataset.activeIndex = String(boundedIndex);
            }

            trendChart.addEventListener("pointermove", function (event) {
              const screenMatrix = trendChart.getScreenCTM();
              if (!screenMatrix) {
                return;
              }
              const pointer = trendChart.createSVGPoint();
              pointer.x = event.clientX;
              pointer.y = event.clientY;
              const chartPoint = pointer.matrixTransform(screenMatrix.inverse());
              const progress = Math.max(0, Math.min(1, chartPoint.x / 720));
              showPoint(Math.round(progress * (stock.history.length - 1)));
            });
            trendChart.addEventListener("pointerleave", function () {
              crosshair.setAttribute("visibility", "hidden");
              marker.setAttribute("visibility", "hidden");
              trendTooltip.hidden = true;
            });
            trendChart.addEventListener("keydown", function (event) {
              const currentIndex = Number(trendChart.dataset.activeIndex || 0);
              let nextIndex = currentIndex;
              if (event.key === "ArrowRight") {
                nextIndex += 1;
              } else if (event.key === "ArrowLeft") {
                nextIndex -= 1;
              } else if (event.key === "Home") {
                nextIndex = 0;
              } else if (event.key === "End") {
                nextIndex = stock.history.length - 1;
              } else {
                return;
              }
              event.preventDefault();
              showPoint(nextIndex);
            });
          }
        } else {
          expandedEntry = null;
        }
      });
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
      row.append(toggle, analyze);
      entry.append(row, details);
      list.appendChild(entry);
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
    appendChartGrid(svg, width, height, padding);
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

  function renderResearchCandidates(data) {
    const list = document.getElementById("candidate-list");
    list.replaceChildren();
    data.stocks.forEach(function (stock) {
      const card = document.createElement("article");
      card.className = "candidate-card";
      const heading = document.createElement("div");
      heading.className = "candidate-heading";
      const identity = document.createElement("div");
      identity.className = "candidate-identity";
      const symbol = document.createElement("strong");
      symbol.textContent = stock.symbol;
      const name = document.createElement("span");
      name.textContent = stock.name || stock.symbol;
      identity.append(symbol, name);
      const returns = document.createElement("div");
      returns.className = "candidate-returns";
      const periodReturn = document.createElement("strong");
      periodReturn.className = stock.periodReturn >= 0 ? "positive" : "negative";
      periodReturn.textContent = formatPercent(stock.periodReturn);
      const dailyReturn = document.createElement("small");
      dailyReturn.className = stock.dailyChange > 0 ? "positive" : stock.dailyChange < 0 ? "negative" : "";
      dailyReturn.textContent = formatPercent(stock.dailyChange) + " today";
      returns.append(periodReturn, dailyReturn);
      heading.append(identity, returns);

      const chart = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      chart.setAttribute("class", "candidate-chart");
      chart.setAttribute("viewBox", "0 0 320 72");
      chart.setAttribute("role", "img");
      chart.setAttribute("aria-label", stock.symbol + " price trend over " +
        document.getElementById("candidate-period").selectedOptions[0].textContent);
      appendChartGrid(chart, 320, 72, { top: 5, right: 0, bottom: 5, left: 0 });
      const closes = stock.history.map(function (item) { return item.close; });
      const min = Math.min.apply(null, closes);
      const max = Math.max.apply(null, closes);
      const spread = max - min || max * 0.02 || 1;
      const path = closes.map(function (value, index) {
        const x = index * 320 / Math.max(closes.length - 1, 1);
        const y = 5 + (max - value) * 62 / spread;
        return (index === 0 ? "M" : "L") + x.toFixed(2) + " " + y.toFixed(2);
      }).join(" ");
      const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
      line.setAttribute("d", path);
      line.setAttribute("class", "candidate-chart-line");
      line.setAttribute("fill", "none");
      line.setAttribute("stroke", getComputedStyle(document.body)
        .getPropertyValue(stock.periodReturn >= 0 ? "--positive" : "--red").trim());
      line.setAttribute("stroke-width", "2.5");
      line.setAttribute("stroke-linecap", "round");
      line.setAttribute("stroke-linejoin", "round");
      line.setAttribute("vector-effect", "non-scaling-stroke");
      chart.appendChild(line);

      const price = document.createElement("p");
      price.className = "candidate-price";
      price.textContent = formatCurrency(stock.price, stock.currency) + " · close " + stock.priceDate;
      const newsHeading = document.createElement("p");
      newsHeading.className = "candidate-news-label";
      newsHeading.textContent = "Related headlines";
      const headlines = document.createElement("div");
      headlines.className = "candidate-headlines";
      const tickerNewsLink = document.createElement("a");
      tickerNewsLink.href = "https://finance.yahoo.com/quote/" +
        encodeURIComponent(stock.symbol) + "/news/";
      tickerNewsLink.target = "_blank";
      tickerNewsLink.rel = "noopener noreferrer";
      tickerNewsLink.textContent = "View " + stock.symbol + " news articles on Yahoo Finance";
      if (!stock.headlinesAvailable) {
        headlines.appendChild(tickerNewsLink);
      } else if (!stock.headlines.length) {
        headlines.append(tickerNewsLink);
      } else {
        stock.headlines.forEach(function (story) {
          const link = document.createElement("a");
          link.href = story.link;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = story.title + " · " + story.publisher;
          headlines.appendChild(link);
        });
        headlines.appendChild(tickerNewsLink);
      }
      const analyze = document.createElement("button");
      analyze.type = "button";
      analyze.className = "text-button candidate-analyze";
      analyze.textContent = "Analyze " + stock.symbol;
      analyze.addEventListener("click", function () {
        symbolInput.value = stock.symbol;
        loadStock(stock.symbol);
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
      card.append(heading, chart, price, newsHeading, headlines, analyze);
      list.appendChild(card);
    });
    if (!data.stocks.length) {
      showEmptyMessage(list, "No trending tickers with enough historical data were found.");
    }
  }

  function loadResearchCandidates() {
    const period = document.getElementById("candidate-period").value;
    if (period === candidateLoadedPeriod || period === candidateLoadingPeriod) {
      return;
    }
    const requestId = ++candidateRequestId;
    candidateLoadingPeriod = period;
    const status = document.getElementById("candidate-status");
    status.textContent = "Finding trending tickers and loading their historical trends and headlines...";
    showEmptyMessage(document.getElementById("candidate-list"), "Loading research candidates...");
    apiRequest("/api/research-candidates?period=" + encodeURIComponent(period), "")
      .then(function (data) {
        if (requestId !== candidateRequestId) {
          return;
        }
        renderResearchCandidates(data);
        candidateLoadedPeriod = period;
        status.textContent = "Updated " + new Date(data.updatedAt).toLocaleString() +
          " · ranked by absolute historical movement" +
          (data.unavailableCount ? " · " + data.unavailableCount + " price histories unavailable" : "") +
          ".";
      })
      .catch(function (error) {
        if (requestId === candidateRequestId) {
          status.textContent = error.message;
          showEmptyMessage(document.getElementById("candidate-list"),
            "Research candidates are unavailable right now. Try again later.");
        }
      })
      .then(function () {
        if (requestId === candidateRequestId) {
          candidateLoadingPeriod = "";
        }
      });
  }

  function renderNews(stories) {
    const list = document.getElementById("news-list");
    list.replaceChildren();
    if (!stories.length) {
      showEmptyMessage(list, "No market headlines are available right now.");
      return;
    }
    stories.forEach(function (story) {
      const article = document.createElement("article");
      article.className = "panel news-card";
      if (story.imageUrl) {
        const image = document.createElement("img");
        image.className = "news-image";
        image.src = story.imageUrl;
        image.alt = "";
        image.loading = "lazy";
        image.referrerPolicy = "no-referrer";
        image.addEventListener("error", function () {
          image.remove();
        }, { once: true });
        article.appendChild(image);
      }
      const source = document.createElement("p");
      source.className = "news-source";
      source.textContent = story.publisher || "Yahoo Finance";
      const title = document.createElement("h2");
      const link = document.createElement("a");
      link.href = story.link;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = story.title;
      title.appendChild(link);
      const details = document.createElement("p");
      details.className = "news-details";
      const published = story.publishedAt ? new Date(story.publishedAt) : null;
      details.textContent = published && Number.isFinite(published.getTime())
        ? "Published " + published.toLocaleString()
        : "Market headline";
      article.append(source, title, details);
      list.appendChild(article);
    });
  }

  function loadNews(forceRefresh) {
    if (newsLoaded && !forceRefresh) {
      return;
    }
    const requestId = ++newsRequestId;
    const status = document.getElementById("news-status");
    status.textContent = "Loading market headlines...";
    showEmptyMessage(document.getElementById("news-list"), "Loading headlines...");
    apiRequest("/api/news", "")
      .then(function (data) {
        if (requestId !== newsRequestId) {
          return;
        }
        renderNews(data.stories);
        status.textContent = "Updated " + new Date(data.updatedAt).toLocaleString() +
          " · Headlines may be delayed.";
        newsLoaded = true;
      })
      .catch(function (error) {
        if (requestId === newsRequestId) {
          status.textContent = error.message;
          showEmptyMessage(document.getElementById("news-list"),
            "Headlines are unavailable right now. Try refreshing in a moment.");
        }
      });
  }

  function loadBenchmarkHistory(symbol) {
    const status = document.getElementById("benchmark-status");
    const selectedSymbol = symbol;
    const requestId = ++benchmarkRequestId;
    if (!selectedSymbol || selectedSymbol === "none") {
      benchmarkHistory = null;
      benchmarkLoadedSymbol = "";
      status.textContent = "Benchmark comparison is off.";
      if (currentStockData) {
        renderChart(currentStockData.history, currentChartCurrency, currentChartExchangeRate, null, "none");
      }
      return;
    }
    if (benchmarkLoadedSymbol === selectedSymbol && benchmarkHistory) {
      status.textContent = "Updating comparison chart...";
      if (currentStockData) {
        renderChart(currentStockData.history, currentChartCurrency, currentChartExchangeRate,
          benchmarkHistory, selectedSymbol);
      }
      return;
    }
    benchmarkHistory = null;
    benchmarkLoadedSymbol = "";
    status.textContent = "Loading benchmark history...";
    if (currentStockData) {
      renderChart(currentStockData.history, currentChartCurrency, currentChartExchangeRate, null, selectedSymbol);
    }
    apiRequest("/api/history?symbol=" + encodeURIComponent(selectedSymbol), "")
      .then(function (data) {
        if (requestId !== benchmarkRequestId) {
          return;
        }
        benchmarkHistory = data.history;
        benchmarkLoadedSymbol = selectedSymbol;
        if (currentStockData) {
          renderChart(currentStockData.history, currentChartCurrency, currentChartExchangeRate,
            benchmarkHistory, selectedSymbol);
        }
      })
      .catch(function (error) {
        if (requestId === benchmarkRequestId) {
          status.textContent = "Benchmark unavailable: " + error.message;
        }
      });
  }

  function renderStock(data) {
    currentStockData = data;
    document.getElementById("stock-export").disabled = false;
    updateWatchlistToggle();
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
    currentChartCurrency = currencyCode;
    currentChartExchangeRate = exchangeRate;
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
    const benchmarkSymbol = document.getElementById("benchmark-symbol").value;
    const activeBenchmarkHistory = benchmarkLoadedSymbol === benchmarkSymbol ? benchmarkHistory : null;
    renderChart(data.history, currencyCode, exchangeRate, activeBenchmarkHistory, benchmarkSymbol);
    if (benchmarkSymbol !== "none" && benchmarkLoadedSymbol !== benchmarkSymbol) {
      loadBenchmarkHistory(benchmarkSymbol);
    }
    renderForecast(data, currencyCode, exchangeRate);
    renderComparables(data);
    setMarketStatus("Showing latest available daily market history for " + data.symbol + ".");
  }

  function loadStock(symbol) {
    const requestId = ++stockRequestId;
    const normalized = symbol.trim().toUpperCase();
    currentStockData = null;
    document.getElementById("stock-export").disabled = true;
    updateWatchlistToggle();
    lastStockSymbol = normalized;
    symbolInput.value = normalized;
    document.getElementById("stock-submit").disabled = true;
    setMarketStatus("Loading " + normalized + " and comparable historical prices...");
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
          setMarketStatus(error.message);
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

  function renderStockSuggestions(results, query) {
    const list = document.getElementById("stock-symbol-suggestions");
    const matchingPopular = STOCKS.filter(function (stock) {
      const normalizedQuery = query.toLowerCase();
      return stock.symbol.toLowerCase().indexOf(normalizedQuery) !== -1 ||
        stock.name.toLowerCase().indexOf(normalizedQuery) !== -1;
    });
    const suggestions = results.concat(matchingPopular);
    const seen = new Set();
    list.replaceChildren();
    let activeIndex = -1;
    suggestions.forEach(function (stock) {
      if (seen.has(stock.symbol) || !stock.symbol) {
        return;
      }
      seen.add(stock.symbol);
      const option = document.createElement("button");
      option.type = "button";
      option.className = "stock-suggestion";
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");
      const symbol = document.createElement("strong");
      symbol.textContent = stock.symbol;
      const name = document.createElement("span");
      name.textContent = stock.name || stock.symbol;
      option.append(symbol, name);
      option.addEventListener("pointerdown", function (event) {
        event.preventDefault();
      });
      option.addEventListener("click", function () {
        closeStockSuggestions();
        loadStock(stock.symbol);
      });
      list.appendChild(option);
    });
    list.hidden = !list.childElementCount;
    symbolInput.setAttribute("aria-expanded", String(!list.hidden));

    function setActiveOption(nextIndex) {
      const options = list.querySelectorAll('[role="option"]');
      if (!options.length) {
        return;
      }
      activeIndex = (nextIndex + options.length) % options.length;
      options.forEach(function (option, index) {
        option.setAttribute("aria-selected", String(index === activeIndex));
      });
      symbolInput.setAttribute("aria-activedescendant", options[activeIndex].id);
    }

    list.querySelectorAll('[role="option"]').forEach(function (option, index) {
      option.id = "stock-suggestion-" + index;
    });
    return setActiveOption;
  }

  function closeStockSuggestions() {
    const list = document.getElementById("stock-symbol-suggestions");
    list.hidden = true;
    list.replaceChildren();
    symbolInput.setAttribute("aria-expanded", "false");
    symbolInput.removeAttribute("aria-activedescendant");
  }

  function initializeStockSearch() {
    const searchStatus = document.getElementById("stock-search-status");
    let setActiveOption = function () {};
    symbolInput.addEventListener("focus", function () {
      symbolInput.value = "";
      setActiveOption = renderStockSuggestions([], "");
      searchStatus.textContent = "Popular stocks and ETFs. Type to search by ticker or company name.";
    });
    symbolInput.addEventListener("blur", function () {
      if (!symbolInput.value.trim()) {
        symbolInput.value = lastStockSymbol;
        searchStatus.textContent = "Search any stock or ETF by symbol or company name.";
      }
      window.setTimeout(closeStockSuggestions, 120);
    });
    symbolInput.addEventListener("input", function () {
      const query = symbolInput.value.trim();
      stockSearchRequestId += 1;
      window.clearTimeout(stockSearchTimer);
      if (stockSearchController) {
        stockSearchController.abort();
        stockSearchController = null;
      }
      if (query.length < 2) {
        closeStockSuggestions();
        searchStatus.textContent = "Type at least 2 characters to search.";
        return;
      }

      setActiveOption = renderStockSuggestions([], query);
      const requestId = stockSearchRequestId;
      searchStatus.textContent = "Searching stock and ETF symbols...";
      stockSearchTimer = window.setTimeout(function () {
        stockSearchController = new AbortController();
        apiRequest("/api/stock-search?q=" + encodeURIComponent(query), "", {
          signal: stockSearchController.signal
        }).then(function (data) {
          if (requestId !== stockSearchRequestId) {
            return;
          }
          const results = Array.isArray(data.results) ? data.results : [];
          setActiveOption = renderStockSuggestions(results, query);
          const suggestionCount = document.getElementById("stock-symbol-suggestions").childElementCount;
          searchStatus.textContent = suggestionCount
            ? suggestionCount + " matching stocks or ETFs. Select a ticker or enter one directly."
            : "No matches found. You can still enter a ticker symbol directly.";
        }).catch(function (error) {
          if (error.name !== "AbortError" && requestId === stockSearchRequestId) {
            setActiveOption = renderStockSuggestions([], query);
            searchStatus.textContent =
              "Live suggestions are unavailable. You can still enter a ticker symbol directly.";
          }
        });
      }, 250);
    });
    symbolInput.addEventListener("keydown", function (event) {
      const options = document.querySelectorAll("#stock-symbol-suggestions [role='option']");
      if (event.key === "ArrowDown" && !document.getElementById("stock-symbol-suggestions").hidden) {
        event.preventDefault();
        const activeOption = symbolInput.getAttribute("aria-activedescendant");
        const activeIndex = Array.prototype.indexOf.call(options, document.getElementById(activeOption));
        setActiveOption(activeIndex + 1);
      } else if (event.key === "ArrowUp" && !document.getElementById("stock-symbol-suggestions").hidden) {
        event.preventDefault();
        const activeOption = symbolInput.getAttribute("aria-activedescendant");
        const activeIndex = Array.prototype.indexOf.call(options, document.getElementById(activeOption));
        setActiveOption(activeIndex < 0 ? options.length - 1 : activeIndex - 1);
      } else if (event.key === "Escape") {
        closeStockSuggestions();
      } else if (event.key === "Enter" &&
        symbolInput.getAttribute("aria-activedescendant")) {
        event.preventDefault();
        document.getElementById(symbolInput.getAttribute("aria-activedescendant")).click();
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
    if (currentView === "news") {
      loadNews(false);
    }
    if (currentView === "stocks") {
      loadWatchlist();
      loadResearchCandidates();
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
  initializeStockSearch();
  stockForm.addEventListener("submit", function (event) {
    event.preventDefault();
    const symbol = symbolInput.value.trim();
    if (!symbol) {
      symbolInput.reportValidity();
      return;
    }
    if (!/^[A-Za-z0-9.^=-]{1,12}$/.test(symbol)) {
      document.getElementById("stock-search-status").textContent =
        "Choose a ticker from the suggestions or enter a ticker symbol.";
      return;
    }
    loadStock(symbol);
  });
  window.addEventListener("hashchange", showView);
  document.getElementById("movers-period").addEventListener("change", function () {
    marketMoversLoadedPeriod = "";
    loadMarketMovers();
  });
  document.getElementById("candidate-period").addEventListener("change", function () {
    loadResearchCandidates();
  });
  document.getElementById("news-refresh").addEventListener("click", function () {
    loadNews(true);
  });
  document.getElementById("benchmark-symbol").addEventListener("change", function (event) {
    loadBenchmarkHistory(event.currentTarget.value);
  });
  document.getElementById("stock-export").addEventListener("click", exportStockData);
  document.getElementById("watchlist-period").addEventListener("change", loadWatchlist);
  document.getElementById("watchlist-toggle").addEventListener("click", function () {
    if (!currentStockData) {
      return;
    }
    const symbol = currentStockData.symbol;
    const current = readWatchlist();
    const isSaved = current.indexOf(symbol) !== -1;
    if (isSaved) {
      if (saveWatchlist(current.filter(function (savedSymbol) { return savedSymbol !== symbol; }))) {
        document.getElementById("watchlist-status").textContent = symbol + " removed from your watchlist.";
      } else {
        return;
      }
    } else {
      if (current.length >= maxWatchlistStocks) {
        document.getElementById("watchlist-status").textContent =
          "Your watchlist is full. Remove a stock before adding another.";
        return;
      }
      if (saveWatchlist([symbol].concat(current))) {
        document.getElementById("watchlist-status").textContent = symbol + " added to your watchlist.";
      } else {
        return;
      }
    }
    updateWatchlistToggle();
    loadWatchlist();
  });
  showView();
  initializeAccounts();
  loadStock(symbolInput.value);
}());
