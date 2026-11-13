# Pace & Pattern

Pace & Pattern is a static sports-data explorer for the BSAD 281 term project. Its public Cloudflare Pages site requests current sports and odds data from a separate Cloudflare Worker. Email sign-in is optional and is only needed to use the online bet journal. The pages site and Worker must remain publicly reachable; do not put Cloudflare Access in front of either one.

## Features and data

- The game board loads active sports, current scores, and available odds through the Worker. Live coverage depends on the provider and sport; unavailable data is reported rather than replaced with sample values.
- The Patterns section is an illustrative, fictional historical sample. It is not derived from the live feed, a verified historical dataset, or a predictive model.
- Signed-out visitors can browse the entire site. Users may optionally request a one-time email sign-in link and keep a personal bet journal in the Worker’s Cloudflare D1 database.
- The journal is manually entered. It does not connect to sportsbooks, import or verify wagers or outcomes, or provide betting advice.

## Public site and Worker deployment

The current public site is <https://morgagemypyarlay.pages.dev>. The frontend is plain HTML, CSS, and JavaScript with no build step.

1. Publish the repository root as the Cloudflare Pages site (or connect the repository to Pages with the root directory as the project root). `index.html` is the entry point.
2. Deploy `worker.js` to the Worker named `pace-pattern-private`. Its API base URL is configured in `data.js` as `https://pace-pattern-private.x2023afx.workers.dev`.
3. Configure the Worker variables `CORS_ORIGIN=https://morgagemypyarlay.pages.dev` and `SITE_URL=https://morgagemypyarlay.pages.dev`. The Worker only permits the configured site origin for browser requests, and uses `SITE_URL` when generating email callback links.
4. Configure the Worker’s `THE_ODDS_API_KEY` secret for The Odds API. Do not put provider keys in frontend files or commit them.
5. To enable the optional account feature, bind the D1 database as `DB`, apply `schema.sql` to it, set `ACCOUNTS_ENABLED=true`, and configure the `RESEND_API_KEY` Worker secret plus a verified `EMAIL_FROM` sender if needed. These are server-side settings; do not add their values to this repository. The account feature requires D1 and email configuration, but the live sports API does not require users to sign in.
6. Keep the Pages site and Worker public, without Cloudflare Access policies. The Worker’s application routes enforce account authentication; CORS is configured for the public site.

The frontend checks `/api/status` and displays connection errors when the Worker, provider key, CORS configuration, or upstream sports service is unavailable. Account setup failures only affect signing in and journal access; they should not prevent browsing live sports data.

## Account and journal privacy

Signing in is optional. If you request an email link, your email address is sent to the Worker and its email provider. If you use the journal, your email and bet records are stored in the Worker’s D1 database and associated with your account. Session credentials are kept in this browser’s local storage; sign out on shared devices. The account page provides a control to permanently delete the account and its bet records. Avoid recording information you do not want stored by the service.

## Files

| File | Purpose |
|---|---|
| `index.html` | Site structure, navigation, and account forms |
| `styles.css` | Responsive visual design |
| `data.js` | Illustrative pattern examples and Worker API URL |
| `app.js` | Live API requests, account sign-in, and journal UI |
| `worker.js` | Sports API proxy and optional authenticated account API |
| `schema.sql` | D1 tables for email sign-in and user bet records |
| `project-notes/PROJECT_LOG.md` | Team prompts, problems, and decisions |
| `project-notes/BUSINESS_CASE.md` | Business reasoning for the project |
