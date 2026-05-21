# WorkoutTracker

Progressive overload tracking PWA — personal workout diary with Google Sheets sync.

## Architecture

```
index.html          – Single-page HTML shell (screens, nav, forms)
assets/
  schema.js         – Shared constants: API_ACTIONS, DEFAULTS (exercise/log/cfg)
  state.js          – App state, persistence (localStorage), utility functions
  api.js            – Google Apps Script communication (fetch/post)
  ui.js             – Generic UI helpers (toast, spinner, showScreen, navigation)
  suggestion.js     – Smart day suggestion algorithm
  exercises.js      – Exercise CRUD, quick-panel, sync, home screen rendering
  log.js            – Log entries, PR detection, progressive overload, import/normalize
  analysis.js       – Analyse screen, progression chart (canvas)
  timer.js          – Rest timer with countdown ring
  init.js           – Entry point: DOMContentLoaded event wiring
  styles.css        – All CSS
sw.js               – Service worker (offline cache, versioned per deploy)
manifest.json       – PWA manifest
GoogleSheet/
  apps-script.js    – Google Apps Script backend (deployed as web app)
```

## Data flow

```
Browser localStorage  ←→  App state (in-memory arrays)
                              ↕ (sync on demand)
                      Google Sheets (via Apps Script web app)
```

- All data is persisted locally in `localStorage` for offline use.
- On "Sync" the app pushes unsynced items to Google Sheets, then fetches the authoritative copy back.

## Development

```bash
npm install          # install dev dependencies (eslint, jest)
npm start            # serve locally on port 3000
npm run lint         # run ESLint on assets/
npm test             # run unit tests
```

No build step required — the app uses native ES modules (`type="module"`).

## Deploy

Push to `main` triggers `.github/workflows/deploy.yml` which:
1. Replaces the service worker cache version with the commit SHA.
2. Deploys to GitHub Pages.

## For agents / copilot

- Each module has a single responsibility (see file list above).
- Pure utility functions are in `state.js` — easy to test and modify in isolation.
- Business logic (PR detection, progression hints, staleness) lives in `log.js`.
- UI rendering is split by screen: `exercises.js` (home), `log.js` (log), `analysis.js` (analyse/chart).
- `init.js` is the wiring-only entry point — event listeners with no business logic.

