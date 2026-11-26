# Northstar

Northstar is a stock research prototype. It displays real daily market history, compares a selected stock with a small configured peer group, and calculates a two-session statistical projection. It is not a brokerage, a real-time quote service, or a source of personalized financial advice.

## Market data and projection

- The Cloudflare Worker retrieves up to five years of daily historical prices from Yahoo Finance's chart endpoint. No API key is required. This is an unofficial endpoint and may be rate-limited or changed by Yahoo; data can be delayed.
- Each ticker's response is cached at the Worker edge for one hour to reduce repeated provider requests.
- Known tickers use comparison securities configured in `worker.js`. Other valid symbols use SPY and QQQ as broad-market comparators.
- The projection blends the selected stock's mean daily return over the latest 60 aligned observations (60%) with the mean of available comparables' returns (40%), then compounds the blended mean for two sessions.
- The displayed confidence is the directional accuracy from up to 60 rolling out-of-sample, two-session historical tests. It is not the probability that the next projection will be right. The price range uses the historical dispersion of blended daily returns and is also not a guarantee.
- The model does not account for news, earnings, macroeconomic events, fees, or trading constraints. Use the site for research and education, not as a recommendation to trade.

## Deploy the public site and API

The frontend is plain HTML, CSS, and JavaScript with no build step.

1. Publish the repository root as the Cloudflare Pages site. `index.html` is the entry point.
2. Deploy `worker.js` to the Worker named `pace-pattern-private` (or update `STARTUP.apiBaseUrl` in `data.js` to the new Worker URL).
3. Configure `CORS_ORIGIN` on the Worker to the exact public Pages origin. The existing public site is `https://morgagemypyarlay.pages.dev`.
4. To enable account sign-in, bind the existing Cloudflare D1 database as `DB` and set `ACCOUNTS_ENABLED=true`. Do not replace or recreate a database containing existing data. The current schema and migration preserve existing account rows; for a database that has the original `users` table but has not had username/password columns added, run `migrations/0002_username_password.sql` once before deployment.
5. The app validates email syntax and creates email/password accounts directly in D1. It does not send confirmation, login, or other email. Passwords are stored as salted PBKDF2-SHA-256 hashes, never as plain text. An email address is not proof of identity because ownership is not verified.

The stock research page works without an account. Accounts are only for sign-in and account management. The Worker does not submit trades or store a portfolio.

## Privacy and account data

Email addresses, password hashes, sessions, and account rate-limit hashes are stored in the bound D1 database. Session tokens and up to ten recent stock lookup symbols are kept in this browser's local storage; lookup history is not sent to the server. Sign out on shared devices. The account page can delete the account. Existing sports-journal tables in a previously provisioned D1 database are left untouched by the application.

Display preferences (dark mode, chart range, and currency) are stored in this browser. Currency conversion uses Frankfurter reference rates, which are delayed and may not be available for every market currency; if conversion fails, prices remain in the security's market currency.

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
