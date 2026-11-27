# CrystalBallStocks

CrystalBallStocks is a stock research prototype. It displays real daily market history, compares a selected stock with a small configured peer group, and calculates a two-session statistical projection. It is not a brokerage, a real-time quote service, or a source of personalized financial advice.

The Popular stocks tab ranks a selection of widely followed stocks and ETFs by historical price performance over a selectable timeframe (one week through five years). It also charts relative returns for the five leading performers; it does not rank trading volume or predict future returns.

The stock research chart can compare a selected stock with the S&P 500 (SPY) or Nasdaq-100 (QQQ) over the same dates. A browser-local watchlist saves up to eight symbols and shows latest prices, daily changes, and returns over a selectable period; watchlist data does not sync across browsers or devices.

The main page includes research candidates from Yahoo Finance's currently trending ticker list, ranked by absolute historical movement and paired with ticker-related headlines. This is a limited discovery list, not a scan of every listed stock or a buy/sell recommendation.

The selected stock's quote card can export its quote, projections, comparable returns, model confidence, and daily history as a CSV file that opens in Excel.

The News page loads market headlines from Yahoo Finance. Desktop side rails display clearly labeled sample advertisements; these are fictional mockups and are not paid placements or real offers.

## Market data and projection

- The Cloudflare Worker retrieves up to five years of daily historical prices and live ticker/company-name search suggestions from Yahoo Finance. No API key is required. These are unofficial endpoints and may be rate-limited or changed by Yahoo; data can be delayed.
- Each ticker's response is cached at the Worker edge for one hour to reduce repeated provider requests.
- Known tickers use comparison securities configured in `worker.js`. Other valid symbols use SPY and QQQ as broad-market comparators.
- The projection aligns daily closes with available comparables, calculates daily percentage returns, then blends each stock return (60%) with the mean return of its available comparables (40%). It averages the latest 60 blended observations (at least 30 are required) and compounds that mean from the latest close for one and two sessions.
- Current Yahoo Finance ticker headlines and broad U.S. macro headlines published in the last seven days are scored using a small positive/negative keyword list. When dated headlines are available, the weighted score can adjust the two-session daily drift by up to 10% of recent blended-return volatility (company headlines receive 70% weight and macro headlines 30%, renormalized if one source is unavailable). This is a simple heuristic, not language understanding or a reliable measure of market sentiment.
- Recent headlines containing earnings-related or macro-event terms widen the range using fixed multipliers (1.25 for an earnings-related headline and 1.20 for a macro-event headline; both combine multiplicatively). This is not a scheduled earnings or economic calendar, so events without matching recent headlines are not detected.
- The displayed 80% model range uses the sample standard deviation of blended returns scaled by the square root of the forecast horizon, then applies the detected event multipliers. It is a statistical estimate, not a guarantee.
- Directional accuracy is measured over up to 60 earlier two-session tests using historical returns only; current news signals and estimated trading costs are not included in that backtest. The rate is not the probability that the next projection will be right.
- Editable browser-local assumptions estimate a hypothetical long position's net two-session result after round-trip commission and slippage and flag an order below the selected minimum order size. Defaults are a $1,000 order, $0 commission per order, 0.1% slippage per side, and a $1 minimum order. These assumptions do not alter the forecast price, model broker-specific rules, or place trades. Use the site for research and education, not as a recommendation to trade.

## Deploy the public site and API

The frontend is plain HTML, CSS, and JavaScript with no build step.

1. Publish the repository root as the Cloudflare Pages site. `index.html` is the entry point.
2. Deploy `worker.js` to the Worker named `pace-pattern-private` (or update `STARTUP.apiBaseUrl` in `data.js` to the new Worker URL).
3. Configure `CORS_ORIGIN` on the Worker to the exact public Pages origin, `https://crystalballstocks.pages.dev`.
4. To enable account sign-in, bind the existing Cloudflare D1 database as `DB` and set `ACCOUNTS_ENABLED=true`. Do not replace or recreate a database containing existing data. The current schema and migration preserve existing account rows; for a database that has the original `users` table but has not had username/password columns added, run `migrations/0002_username_password.sql` once before deployment.
5. To support saved personal details for existing accounts and required signup details, run `migrations/0003_user_profile.sql` once against the existing D1 database before deploying the Worker. For a new database, the profile columns are included in `schema.sql`.
6. Account creation requires a name, phone number, and mailing address (street, city, region, postal code, and country) in addition to email and password. Phone numbers use `000-000-0000`; postal codes may contain letters, numbers, spaces, and hyphens. Sign-in remains email and password only. The app does not send confirmation, login, or other email. Passwords are stored as salted PBKDF2-SHA-256 hashes, never as plain text. An email address is not proof of identity because ownership is not verified.

The stock research page works without an account. Accounts are only for sign-in and account management. The Worker does not submit trades or store a portfolio.

## Privacy and account data

Email addresses, personal details, password hashes, sessions, and account rate-limit hashes are stored in the bound D1 database. Address suggestions are retrieved from Photon (Komoot); the partial address you type is sent to that service. Session tokens and up to ten recent stock lookup symbols are kept in this browser's local storage; lookup history is not sent to the server. Sign out on shared devices. The account page can delete the account. Existing sports-journal tables in a previously provisioned D1 database are left untouched by the application.

Display preferences (dark mode, chart range, and currency) and illustrative trade assumptions are stored in this browser. Signing out restores the trade-assumption defaults but preserves the selected theme. Currency conversion uses Frankfurter reference rates, which are delayed and may not be available for every market currency; if conversion fails, prices remain in the security's market currency.

## Files

| File | Purpose |
|---|---|
| `index.html` | Stock research, projection, account, and methodology views |
| `styles.css` | Responsive visual design |
| `data.js` | Stock suggestions and Worker API URL |
| `app.js` | Market-data and account UI |
| `worker.js` | Yahoo Finance data proxy, projection algorithm, and account API |
| `schema.sql` | D1 schema for new installations |
| `migrations/0002_username_password.sql` | Adds password-account columns to the original users table |
| `migrations/0003_user_profile.sql` | Adds optional personal profile fields to users |
