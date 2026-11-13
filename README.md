# Pace & Pattern

A static, fictional sports-pattern demo for the BSAD 281 term project. It is designed to run directly from GitHub Pages: plain HTML, CSS, and JavaScript with no build step, backend, API key, or external service.

## What the demo includes

- Fictional sports, game scores, sample odds, and historical-pattern examples.
- Sample implied probabilities for demonstration only. They are not forecasts.
- A sample bet journal that saves in the current browser using `localStorage`.
- Manual result updates and calculated win/loss/net totals.

The board is not live and has no connection to sports providers or sportsbooks. Journal entries do not sync between devices, are not verified, and may be deleted when browser data is cleared. The journal is only a prototype; do not enter real personal information or real betting history. All patterns and statistics are fictional and cannot predict outcomes.

## Publish with GitHub Pages

1. Push or commit the project files to your GitHub repository.
2. On GitHub, open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select the `main` branch and `/ (root)`, then save.
5. After publishing, open the Pages URL shown in the settings.

The entry page is `index.html`. Changes appear on the Pages site after they are committed and pushed.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page structure and copy |
| `styles.css` | Responsive visual styling |
| `data.js` | Fictional sports, matchups, and historical examples |
| `app.js` | Browser-only rendering and sample journal |
| `project-notes/PROJECT_LOG.md` | Team prompts, problems, and decisions |
| `project-notes/BUSINESS_CASE.md` | Business reasoning for the prototype |

This repository does not deploy or configure Cloudflare services. Any existing Cloudflare account resources are left untouched; this project simply no longer depends on them.
