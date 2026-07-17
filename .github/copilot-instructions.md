# Copilot repository instructions

## Projektbeskrivelse

WorkoutTrainer er en Progressive Web App (PWA) til progressivt overload-træning.
Den synkroniserer data med Google Sheets via et Apps Script backend.

## Sprog

- **UI-tekst, labels og brugervendte beskeder skal altid være på dansk.**
- Kodekommentarer, variabelnavne og commit-beskeder skrives på engelsk.

## Arkitektur

Ingen build-step — appen bruger native ES modules (`type="module"` i `package.json`).

```
index.html          – Enkelt-side HTML-shell (skærme, navigation, formularer)
assets/
  schema.js         – Delte konstanter: API_ACTIONS, DEFAULTS (exercise/log/cfg)
  state.js          – App-state, persistence (localStorage), utility-funktioner
  api.js            – Google Apps Script kommunikation (fetch/post)
  ui.js             – Generiske UI-helpers (toast, spinner, showScreen, navigation)
  suggestion.js     – Smart dag-forslag algoritme
  exercises.js      – Exercise CRUD, quick-panel, sync, home screen rendering
  log.js            – Log-entries, PR-detektion, progressivt overload, import/normaliser
  analysis.js       – Analyse-skærm, progressionskort (canvas)
  timer.js          – Hvile-timer med nedtællings-ring
  init.js           – Entry point: DOMContentLoaded event-wiring (ingen business logic)
  styles.css        – Al CSS
sw.js               – Service worker (offline cache, versioneret per deploy)
manifest.json       – PWA manifest
GoogleSheet/
  apps-script.js    – Google Apps Script backend (deployed som web app)
```

## Modulansvar

- `state.js` — pure utility-funktioner; let at teste og ændre isoleret.
- `init.js` — kun event-wiring, ingen business logic.
- `log.js` — PR-detektion, progressivt overload, stagnations-logik.
- `analysis.js` — progression-chart og analyse-skærm.
- `exercises.js` — home screen rendering og exercise CRUD.

## Data og datamodel

- Al data er persisteret lokalt i `localStorage` til offline brug.
- Ved "Sync" pushes usynkroniserede items til Google Sheets, derefter hentes den autoritative kopi.
- **Performance score** bruger en Epley-baseret formel (`weight * (1 + reps / 30)`) til PR-, progressions- og stagnations-logik — ikke vægt alene.
- Exercises har et `active` boolean-felt (default: `true`). Home screen viser kun aktive øvelser som standard.

## Udvikling

```bash
npm install        # installer dev-afhængigheder (eslint, jest)
npm start          # serve lokalt på port 3000
npm run lint       # kør ESLint på assets/
npm test           # kør unit tests (Jest med jsdom)
```

## Konventioner

- Brug eksisterende biblioteker. Tilføj ikke nye npm-pakker uden god grund.
- Ret ikke pre-eksisterende problemer uden relation til opgaven.
- Hold `init.js` fri for business logic — al logik hører hjemme i de relevante moduler.
- Tests ligger i `tests/` og bruger Jest med jsdom-miljø.
