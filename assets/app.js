'use strict';

const { API_ACTIONS, DEFAULTS } = window.WT_SCHEMA;
// ══════════════════════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════════════════════
const DB_KEY_EXERCISES = 'wt_exercises';
const DB_KEY_LOG       = 'wt_log';
const DB_KEY_CFG       = 'wt_config';
const DB_KEY_REST_TIMER = 'wt_rest_timer';

const MS_PER_DAY          = 86400000;   // milliseconds in one day
const MS_PER_HOUR         = 3600000;    // milliseconds in one hour
const PROGRESSION_INCREMENT = 2.5;      // kg to suggest adding when progression criteria met
const PROGRESSION_STREAK    = 3;        // consecutive sessions needed to trigger hint
const STAGNATION_DAYS       = 28;       // days without PR before an exercise is "stagnant"

let exercises  = [];   // Array of exercise objects
let logEntries = [];   // Array of log entry objects
let cfg        = { ...DEFAULTS.cfg };
let currentEx  = null; // Exercise being edited/viewed

// ── Persist ─────────────────────────────────────────────────────
function save() {
  localStorage.setItem(DB_KEY_EXERCISES, JSON.stringify(exercises));
  localStorage.setItem(DB_KEY_LOG,       JSON.stringify(logEntries));
}

function load() {
  try { exercises  = JSON.parse(localStorage.getItem(DB_KEY_EXERCISES) || '[]'); } catch(e){}
  try { logEntries = JSON.parse(localStorage.getItem(DB_KEY_LOG)       || '[]'); } catch(e){}
  try { cfg        = JSON.parse(localStorage.getItem(DB_KEY_CFG)       || '{}'); } catch(e){}
  cfg.url          = cfg.url    || DEFAULTS.cfg.url;
  cfg.secret       = cfg.secret || DEFAULTS.cfg.secret;
  cfg.restDuration = cfg.restDuration ?? DEFAULTS.cfg.restDuration;
}

function saveCfg() {
  localStorage.setItem(DB_KEY_CFG, JSON.stringify(cfg));
}

function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function isoDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function isoTime(date = new Date()) {
  return date.toTimeString().slice(0, 5);
}

function sortDayValues(values) {
  return [...values].sort((a, b) => {
    const na = parseInt(a), nb = parseInt(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    if (!isNaN(na)) return -1;
    if (!isNaN(nb)) return 1;
    return a.localeCompare(b);
  });
}

function apiGetUrl(baseUrl, action, secret) {
  const params = new URLSearchParams({ action, secret });
  return `${baseUrl}?${params.toString()}`;
}

function createLogEntry(ex, { todayWeight, todayReps, setNumber = null, totalSets = null, dateOnly = isoDate(), set = ex.set, timeOnly = isoTime() }) {
  const normalizedDateOnly = dateOnly || isoDate();
  const normalizedTimeOnly = timeOnly || isoTime();
  return {
    ...DEFAULTS.log,
    entryId: uid(),
    date: `${normalizedDateOnly} ${normalizedTimeOnly}`,
    type: ex.type,
    exercise: ex.exercise,
    day: String(ex.day),
    lastWeight: ex.lastWeight,
    todayWeight,
    lastReps: ex.lastReps,
    todayReps,
    dateOnly: normalizedDateOnly,
    timeOnly: normalizedTimeOnly,
    set,
    setNumber,
    totalSets,
    muscleGroup: ex.muscleGroup || ''
  };
}

// ══════════════════════════════════════════════════════════════════
//  UI HELPERS
// ══════════════════════════════════════════════════════════════════
function toast(msg, ms = 2500) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), ms);
}
function spinner(on) { document.getElementById('spinner').style.display = on ? 'flex' : 'none'; }

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.querySelectorAll('#topnav button').forEach(b => {
    b.classList.toggle('active', b.dataset.screen === id);
  });
  const titles = {
    'screen-home':     'WorkoutTracker',
    'screen-details':  'Øvelse',
    'screen-new':      'Ny øvelse',
    'screen-log':      'Log',
    'screen-analyse':  'Analyse',
    'screen-settings': 'Indstillinger',
    'screen-chart':    'Fremgang'
  };
  document.getElementById('topbar-title').textContent = titles[id] || 'WorkoutTracker';
  // Show/hide top-bar controls depending on screen
  document.getElementById('btn-newday').style.display  = id === 'screen-home' ? '' : 'none';
  document.getElementById('btn-refresh').style.display = id === 'screen-settings' ? 'none' : '';
  // Push history entry so Android back button navigates within the app.
  // Only push if we're not already recording this screen to avoid duplicates.
  if (id !== 'screen-home' && (!history.state || history.state.screen !== id)) {
    history.pushState({ screen: id }, '');
  }
}

// ══════════════════════════════════════════════════════════════════
//  SMART DAY SUGGESTION
// ══════════════════════════════════════════════════════════════════
const BUFFER_DAYS_SET        = new Set(['3', '9']);
const LOW_PRIORITY_DAYS      = new Set(['H', 'h']);
const NEVER_LOGGED_STALENESS = Infinity; // exercises never logged rank as maximally stale
const LOW_PRIORITY_WEIGHT    = 0.25;     // day H is rarely used
const BUFFER_DAY_WEIGHT      = 0.45;     // days 3 & 9 are overflow containers

/** Days since the exercise was last logged (0 = today, NEVER_LOGGED_STALENESS if never). */
function exStaleness(exerciseName) {
  const todayMidnightMs = new Date().setHours(0, 0, 0, 0);
  let latest = null;
  for (const e of logEntries) {
    if (e.exercise === exerciseName && e.dateOnly) {
      const d = new Date(e.dateOnly + 'T00:00:00').getTime();
      if (latest === null || d > latest) latest = d;
    }
  }
  return latest === null ? NEVER_LOGGED_STALENESS : (todayMidnightMs - latest) / MS_PER_DAY;
}

/**
 * Scores every day based on how long overdue its exercises are, with
 * reduced weight for buffer days (3, 9) and low-priority days (H).
 * Returns { primaryDay, backups } or null when no exercises exist.
 *   primaryDay – day string of the top-scoring day
 *   backups    – up to 3 exercise objects from other days, most stale first
 */
function suggestDay() {
  if (!exercises.length) return null;
  const allDays = [...new Set(exercises.map(e => String(e.day)).filter(Boolean))];
  if (!allDays.length) return null;

  // Build a staleness cache to avoid re-scanning logEntries repeatedly
  const stalenessCache = {};
  exercises.forEach(ex => {
    if (!(ex.exercise in stalenessCache)) {
      stalenessCache[ex.exercise] = exStaleness(ex.exercise);
    }
  });

  const dayScores = allDays.map(day => {
    const dayExs = exercises.filter(e => String(e.day) === day);
    if (!dayExs.length) return null;
    const avg = dayExs.reduce((s, ex) => s + stalenessCache[ex.exercise], 0) / dayExs.length;
    let multiplier = 1.0;
    if (LOW_PRIORITY_DAYS.has(day))    multiplier = LOW_PRIORITY_WEIGHT;
    else if (BUFFER_DAYS_SET.has(day)) multiplier = BUFFER_DAY_WEIGHT;
    return { day, score: avg * multiplier };
  }).filter(Boolean);
  dayScores.sort((a, b) => b.score - a.score);
  const primaryDay = dayScores[0].day;

  const backups = exercises
    .filter(e => String(e.day) !== primaryDay)
    .map(e => ({ ex: e, staleness: stalenessCache[e.exercise] }))
    .sort((a, b) => b.staleness - a.staleness)
    .slice(0, 3)
    .filter(({ staleness }) => staleness > 0) // exclude exercises already logged today
    .map(b => b.ex);

  return { primaryDay, backups };
}

function renderSuggestion() {
  const el = document.getElementById('suggestion-bar');
  if (!el) return;
  const sugg = suggestDay();
  if (!sugg) { el.innerHTML = ''; return; }
  const { primaryDay, backups } = sugg;

  let backupHtml = '';
  if (backups.length) {
    const items = backups.map(ex =>
      `<span class="sugg-backup-item">${esc(ex.exercise)}<span class="sugg-backup-day">Dag ${esc(String(ex.day))}</span></span>`
    ).join('');
    backupHtml = `<div class="sugg-backups">Ekstra øvelser: ${items}</div>`;
  }

  el.innerHTML = `
    <div class="sugg-card">
      <div class="sugg-main">
        <span class="sugg-icon">💡</span>
        <span class="sugg-text">Foreslået dag: <strong>Dag ${esc(primaryDay)}</strong></span>
        <button class="sugg-btn" data-day="${esc(primaryDay)}">Vælg ›</button>
      </div>
      ${backupHtml}
    </div>`;
}

// ══════════════════════════════════════════════════════════════════
//  RENDER: HOME
// ══════════════════════════════════════════════════════════════════
function buildDayOptions() {
  const days = sortDayValues(new Set(exercises.map(e => String(e.day))));
  const sel = document.getElementById('sel-day');
  const cur = sel.value;
  sel.innerHTML = '<option value="">Alle dage</option>';
  days.forEach(d => {
    const o = document.createElement('option');
    o.value = d; o.textContent = 'Dag ' + d;
    sel.appendChild(o);
  });
  if (days.includes(cur)) sel.value = cur;
}

function buildMuscleOptions() {
  const sel = document.getElementById('sel-muscle');
  const cur = sel.value;
  sel.innerHTML = '<option value="">Alle muskler</option>';
  const groups = [...new Set(exercises.map(e => e.muscleGroup).filter(Boolean))].sort();
  groups.forEach(g => {
    const o = document.createElement('option');
    o.value = g; o.textContent = g;
    sel.appendChild(o);
  });
  if (groups.includes(cur)) sel.value = cur;
}

function renderHome() {
  buildDayOptions();
  buildMuscleOptions();
  renderSuggestion();
  const typeFilter     = document.getElementById('sel-type').value;
  const dayFilter      = document.getElementById('sel-day').value;
  const categoryFilter = document.getElementById('sel-category').value;
  const muscleFilter   = document.getElementById('sel-muscle').value;

  let filtered = exercises;
  if (typeFilter)     filtered = filtered.filter(e => e.type === typeFilter);
  if (dayFilter)      filtered = filtered.filter(e => String(e.day) === dayFilter);
  if (categoryFilter) filtered = filtered.filter(e => e.category === categoryFilter);
  if (muscleFilter)   filtered = filtered.filter(e => e.muscleGroup === muscleFilter);

  const done  = filtered.filter(e => e.completed === 'yes').length;
  const total = filtered.length;
  const pct   = total ? Math.round(done / total * 100) : 0;
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('progress-label').textContent =
    total ? `${done} / ${total} øvelser afsluttet (${pct}%)` : '';

  const list = document.getElementById('exercise-list');
  list.innerHTML = '';

  if (!filtered.length) {
    list.innerHTML = '<p class="empty">Ingen øvelser matcher filtret.</p>'; return;
  }

  // Sort: not-done first, then alphabetically
  const sorted = [...filtered].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed === 'yes' ? 1 : -1;
    return a.exercise.localeCompare(b.exercise);
  });

  sorted.forEach(ex => {
    const pr = getPersonalRecord(ex.exercise);
    const isPrEx = pr > 0 && ex.todayWeight >= pr && ex.completed === 'yes';
    const stagnant = isStagnant(ex.exercise);
    const progressHint = getProgressionHint(ex);
    const card = document.createElement('div');
    card.className = 'ex-card' + (ex.completed === 'yes' ? ' done' : '');
    const typeAccent = { Push: '#3b82f6', Pull: '#10b981', Leg: '#f59e0b', Core: '#a78bfa' };
    card.style.setProperty('--card-accent', typeAccent[ex.type] || '#3b82f6');
    card.innerHTML = `
      <div class="ex-card-info">
        <h3>${esc(ex.exercise)}</h3>
        <p>Mål: ${ex.lastWeight} kg / ${ex.lastReps} reps &nbsp;·&nbsp; Dag ${esc(String(ex.day))}${ex.muscleGroup ? ` &nbsp;·&nbsp; ${esc(ex.muscleGroup)}` : ''}</p>
      </div>
      <span class="badge-type badge-type-${esc((ex.type||'').toLowerCase())}">${esc(ex.type)}</span>
      ${progressHint !== null ? '<span class="badge-increase">⬆ Øg vægt</span>' : ''}
      ${stagnant && progressHint === null ? '<span class="badge-stagnant">⏸</span>' : ''}
      ${isPrEx ? '<span class="badge-pr">🏆 PR</span>' : ''}
      ${ex.completed === 'yes' ? '<span class="badge-done">✓</span>' : ''}
      <span class="ex-card-arrow" role="button" aria-label="Detaljer" tabindex="0">›</span>`;
    // Arrow → full details screen
    const arrow = card.querySelector('.ex-card-arrow');
    arrow.addEventListener('click', e => { e.stopPropagation(); openDetails(ex); });
    arrow.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); openDetails(ex); } });
    // Card → quick panel
    card.addEventListener('click', () => openQuickPanel(ex));
    list.appendChild(card);
  });
}

// ══════════════════════════════════════════════════════════════════
//  DETAILS SCREEN
// ══════════════════════════════════════════════════════════════════
function openDetails(ex) {
  currentEx = ex;
  document.getElementById('det-exercise').value    = ex.exercise         || '';
  document.getElementById('det-type').value        = ex.type             || 'Push';
  document.getElementById('det-category').value    = ex.category         || 'Compound';
  document.getElementById('det-musclegroup').value = ex.muscleGroup      || '';
  document.getElementById('det-day').value         = String(ex.day       || '');
  document.getElementById('det-set').value         = ex.set              ?? 3;
  document.getElementById('det-rpe').value         = ex.rpe              ?? '';
  document.getElementById('det-lastweight').value  = ex.lastWeight       ?? 0;
  document.getElementById('det-todayweight').value = ex.todayWeight      ?? ex.lastWeight ?? 0;
  document.getElementById('det-lastreps').value    = ex.lastReps         ?? 0;
  document.getElementById('det-todayreps').value   = ex.todayReps        ?? ex.lastReps ?? 0;
  document.getElementById('det-description').value = ex.description      || '';
  // Auto-advance target weight when exercise was completed at or above target
  if (ex.completed === 'yes' && ex.todayWeight > 0 && ex.todayWeight >= (ex.lastWeight ?? 0)) {
    document.getElementById('det-lastweight').value = ex.todayWeight;
  }
  showScreen('screen-details');
}

async function saveDetails() {
  if (!currentEx) return;
  const ex = currentEx;

  ex.exercise    = document.getElementById('det-exercise').value.trim();
  ex.type        = document.getElementById('det-type').value;
  ex.category    = document.getElementById('det-category').value;
  ex.muscleGroup = document.getElementById('det-musclegroup').value;
  ex.day         = document.getElementById('det-day').value.trim();
  ex.set         = Number(document.getElementById('det-set').value)         || 3;
  ex.rpe         = Number(document.getElementById('det-rpe').value)         || null;
  ex.lastWeight  = Number(document.getElementById('det-lastweight').value)  || 0;
  ex.lastReps    = Number(document.getElementById('det-lastreps').value)    || 0;
  ex.todayWeight = Number(document.getElementById('det-todayweight').value) || 0;
  ex.todayReps   = Number(document.getElementById('det-todayreps').value)   || 0;
  ex.description = document.getElementById('det-description').value.trim();
  save();

  // Sync only the updated metadata fields — do NOT mark as completed
  if (cfg.url) {
    spinner(true);
    try {
      await ensureExerciseSynced(ex);
      await api({ action: API_ACTIONS.UPDATE_EXERCISE, entryId: ex.entryId,
        fields: { Exercise: ex.exercise, Type: ex.type, Category: ex.category,
                  MuscleGroup: ex.muscleGroup || '',
                  Day: ex.day, Set: ex.set, RPE: ex.rpe || '',
                  TodayWeight: ex.todayWeight, TodayReps: ex.todayReps,
                  LastWeight: ex.lastWeight, LastReps: ex.lastReps,
                  Description: ex.description } });
      ex.synced = true; save();
    } catch(e) { toast('⚠️ Offline – gemt lokalt'); }
    spinner(false);
  }

  toast('💾 ' + ex.exercise + ' gemt!');
  showScreen('screen-home');
  renderHome();
}

// ══════════════════════════════════════════════════════════════════
//  NEW EXERCISE
// ══════════════════════════════════════════════════════════════════
async function saveNewExercise() {
  const name = document.getElementById('new-exercise').value.trim();
  if (!name) { toast('⚠️ Angiv et navn'); return; }

  const ex = {
    entryId:           uid(),
    id:                null,
    date:              isoDate(),
    type:              document.getElementById('new-type').value,
    category:          document.getElementById('new-category').value,
    muscleGroup:       document.getElementById('new-musclegroup').value,
    day:               document.getElementById('new-day').value.trim() || '1',
    exercise:          name,
    lastWeight:        Number(document.getElementById('new-weight').value) || 0,
    todayWeight:       Number(document.getElementById('new-weight').value) || 0,
    lastReps:          Number(document.getElementById('new-reps').value)   || 10,
    todayReps:         Number(document.getElementById('new-reps').value)   || 10,
    set:               Number(document.getElementById('new-set').value)    || 3,
    rpe:               Number(document.getElementById('new-rpe').value)    || null,
    completed:         'no',
    lastCompletedDate: isoDate(),
    description:       document.getElementById('new-description').value.trim(),
    synced:            false
  };
  exercises.push(ex);
  save();

  if (cfg.url) {
    spinner(true);
    try {
      await api({ action: API_ACTIONS.NEW_EXERCISE, exercise: ex });
      ex.synced = true; save();
    } catch(e) { toast('⚠️ Offline – gemt lokalt'); }
    spinner(false);
  }

  // Clear form
  ['new-exercise','new-day','new-rpe','new-description'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('new-musclegroup').value = '';
  document.getElementById('new-weight').value = '0';
  document.getElementById('new-reps').value   = '10';
  document.getElementById('new-set').value    = '3';

  toast('✅ Øvelse oprettet!');
  showScreen('screen-home');
  renderHome();
}

// ══════════════════════════════════════════════════════════════════
//  LOG SCREEN
// ══════════════════════════════════════════════════════════════════
function renderLog() {
  const q    = document.getElementById('log-search').value.toLowerCase();
  const list = document.getElementById('log-list');
  list.innerHTML = '';

  let filtered = logEntries;
  if (q) filtered = filtered.filter(e =>
    (e.exercise||'').toLowerCase().includes(q) ||
    (e.type||'').toLowerCase().includes(q) ||
    (e.dateOnly||'').includes(q));

  filtered = filtered
    .map(e => ({ e, key: logEntrySortValue(e) }))
    .sort((a, b) => b.key - a.key)
    .map(({ e }) => e);

  if (!filtered.length) {
    list.innerHTML = '<p class="empty">Ingen log-poster fundet.</p>'; return;
  }

  filtered.forEach(entry => {
    const setInfo = entry.setNumber ? ` &nbsp;·&nbsp; Sæt ${entry.setNumber}/${entry.totalSets || entry.set || '?'}` : '';
    const prBadge = entry.isPR ? ' <span class="badge-pr">🏆 PR</span>' : '';
    const card = document.createElement('div');
    card.className = 'log-card';
    card.innerHTML = `
      <div class="log-card-info">
        <h3>${esc(entry.exercise)}${prBadge}</h3>
        <p>${entry.todayWeight} kg, ${entry.todayReps} reps${setInfo} (mål: ${entry.lastWeight} kg, ${entry.lastReps} reps)</p>
        <p>${esc(entry.dateOnly || deriveDateOnly(entry.date) || entry.date)} &nbsp;·&nbsp; Dag: ${esc(String(entry.day))} &nbsp;·&nbsp; ${esc(entry.type)}</p>
      </div>
      <button class="btn-icon-danger" data-id="${entry.entryId}" title="Slet" aria-label="Slet log-post">🗑</button>`;
    card.querySelector('.btn-icon-danger').addEventListener('click', e => {
      e.stopPropagation();
      deleteLog(entry.entryId);
    });
    list.appendChild(card);
  });
}

async function deleteLog(entryId) {
  if (!confirm('Slet denne log-post?')) return;
  logEntries = logEntries.filter(e => e.entryId !== entryId);
  save();
  if (cfg.url) {
    try { await api({ action: API_ACTIONS.DELETE_LOG, entryId }); } catch(e) {}
  }
  renderLog();
  toast('Log-post slettet');
}

// ══════════════════════════════════════════════════════════════════
//  NEW DAY
// ══════════════════════════════════════════════════════════════════
async function newDay() {
  if (!confirm('Ny dag — nulstil alle afsluttede øvelser?\nAfsluttet ← nej')) return;
  let reset = 0;
  exercises.forEach(ex => {
    if (ex.completed === 'yes') {
      ex.completed  = 'no';
      ex.synced     = false;
      reset++;
    }
  });
  save();

  if (cfg.url) {
    spinner(true);
    try {
      await api({ action: API_ACTIONS.NEW_DAY });
      exercises.forEach(e => e.synced = true);
      save();
    } catch(e) { toast('⚠️ Offline – ændringer gemt lokalt'); }
    spinner(false);
  }

  toast(`✅ ${reset} øvelser nulstillet til ny dag`);
  renderHome();
}

// ══════════════════════════════════════════════════════════════════
//  DELETE EXERCISE
// ══════════════════════════════════════════════════════════════════
async function deleteExercise() {
  if (!currentEx) return;
  if (!confirm('Slet øvelsen "' + currentEx.exercise + '"?')) return;
  const id = currentEx.entryId;
  exercises = exercises.filter(e => e.entryId !== id);
  save();
  if (cfg.url) {
    try { await api({ action: API_ACTIONS.DELETE_EXERCISE, entryId: id }); } catch(e) {}
  }
  toast('Øvelse slettet');
  currentEx = null;
  showScreen('screen-home');
  renderHome();
}

// ══════════════════════════════════════════════════════════════════
//  SYNC WITH GOOGLE SHEET
// ══════════════════════════════════════════════════════════════════

/** If an exercise has never been synced to Google Sheets, create it now. */
async function ensureExerciseSynced(ex) {
  if (!ex.synced && cfg.url) {
    await api({ action: API_ACTIONS.NEW_EXERCISE, exercise: ex });
    ex.synced = true;
    save();
  }
}

async function syncAll() {
  if (!cfg.url) { toast('⚠️ Angiv Apps Script URL under Indstillinger'); return; }
  spinner(true);
  try {
    // Push any locally imported / unsynced items to Google Sheet first
    const unsyncedEx  = exercises.filter(e => !e.synced);
    const unsyncedLog = logEntries.filter(e => !e.synced);
    if (unsyncedEx.length)  await api({ action: API_ACTIONS.IMPORT_EXERCISES, rows: unsyncedEx });
    if (unsyncedLog.length) await api({ action: API_ACTIONS.IMPORT_LOG,       rows: unsyncedLog });

    // Then fetch the authoritative data from Google Sheet
    const [exRes, logRes] = await Promise.all([
      apiFetch(apiGetUrl(cfg.url, API_ACTIONS.LIST_EXERCISES, cfg.secret)),
      apiFetch(apiGetUrl(cfg.url, API_ACTIONS.LIST_LOG, cfg.secret))
    ]);
    if (exRes.status === 'ok')  { exercises  = exRes.exercises  || []; }
    if (logRes.status === 'ok') { logEntries = logRes.entries   || []; }
    save();
    renderHome(); renderLog();
    toast('✅ Synkroniseret!');
  } catch(e) {
    toast('⚠️ Synk fejlede: ' + e.message);
  }
  spinner(false);
}

// ══════════════════════════════════════════════════════════════════
//  API
// ══════════════════════════════════════════════════════════════════
async function apiFetch(url, opts) {
  const resp = await fetch(url, opts);
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  return resp.json();
}

async function api(body) {
  return apiFetch(cfg.url, {
    method:  'POST',
    headers: { 'Content-Type': 'text/plain' }, // avoid CORS preflight
    body:    JSON.stringify({ secret: cfg.secret, ...body })
  });
}

// ══════════════════════════════════════════════════════════════════
//  IMPORT FROM FILE
// ══════════════════════════════════════════════════════════════════

/** Normalise an exercise object that may use PascalCase keys (seed-data.json)
 *  or the internal camelCase keys used by the app. */
function normalizeExercise(e) {
  return {
    ...DEFAULTS.exercise,
    entryId:           e.entryId           || e.EntryID         || uid(),
    id:                e.id                ?? e.ID              ?? DEFAULTS.exercise.id,
    date:              e.date              || e.Date             || DEFAULTS.exercise.date,
    type:              e.type              || e.Type             || DEFAULTS.exercise.type,
    category:          e.category          || e.Category         || DEFAULTS.exercise.category,
    muscleGroup:       e.muscleGroup       || e.MuscleGroup      || DEFAULTS.exercise.muscleGroup,
    day:               String(e.day        ?? e.Day              ?? DEFAULTS.exercise.day),
    exercise:          e.exercise          || e.Exercise         || DEFAULTS.exercise.exercise,
    lastWeight:        Number(e.lastWeight  ?? e.LastWeight       ?? DEFAULTS.exercise.lastWeight) || 0,
    todayWeight:       Number(e.todayWeight ?? e.TodayWeight      ?? DEFAULTS.exercise.todayWeight) || 0,
    lastReps:          Number(e.lastReps    ?? e.LastReps         ?? DEFAULTS.exercise.lastReps) || 0,
    todayReps:         Number(e.todayReps   ?? e.TodayReps        ?? DEFAULTS.exercise.todayReps) || 0,
    set:               Number(e.set         ?? e.Set              ?? DEFAULTS.exercise.set) || DEFAULTS.exercise.set,
    completed:         e.completed         || e.Completed        || DEFAULTS.exercise.completed,
    lastCompletedDate: e.lastCompletedDate || e.LastCompletedDate || DEFAULTS.exercise.lastCompletedDate,
    description:       e.description       || e.Description      || DEFAULTS.exercise.description,
    rpe:               e.rpe               ?? e.RPE              ?? DEFAULTS.exercise.rpe,
    synced:            false
  };
}

/** Normalise a log entry that may use PascalCase keys (seed-data.json)
 *  or the internal camelCase keys used by the app. */
function deriveDateOnly(dateStr) {
  if (!dateStr) return '';
  // Already ISO (YYYY-MM-DD or YYYY-MM-DD ...) — fastest path
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return dateStr.slice(0, 10);
  // Try native Date parsing (handles Date.toString(), ISO-with-T, RFC 2822, etc.)
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    // Use local date (not UTC) to avoid shifting dates back for GMT+ timezones
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return '';
}

function normalizeTimeOnly(timeStr) {
  if (!timeStr) return '';
  const m = String(timeStr).trim().match(/(\d{1,2})[:.](\d{2})/);
  if (!m) return '';
  const h = String(Math.min(23, Math.max(0, Number(m[1])))).padStart(2, '0');
  const min = String(Math.min(59, Math.max(0, Number(m[2])))).padStart(2, '0');
  return `${h}:${min}`;
}

function deriveTimeOnly(dateStr) {
  if (!dateStr) return '';
  const m = String(dateStr).match(/(\d{1,2})[:.](\d{2})/);
  if (!m) return '';
  return normalizeTimeOnly(`${m[1]}:${m[2]}`);
}

function logEntrySortValue(entry) {
  const dateOnly = entry.dateOnly || deriveDateOnly(entry.date) || '';
  const timeOnly = normalizeTimeOnly(entry.timeOnly) || deriveTimeOnly(entry.date) || '00:00';
  if (dateOnly) {
    const ts = new Date(`${dateOnly}T${timeOnly}:00`).getTime();
    if (!isNaN(ts)) return ts;
  }
  const fallbackTs = new Date(entry.date || '').getTime();
  return isNaN(fallbackTs) ? 0 : fallbackTs;
}

function normalizeLogEntry(e) {
  const sourceDateOnly = e.dateOnly || e.DateOnly || '';
  const sourceTimeOnly = normalizeTimeOnly(e.timeOnly || e.TimeOnly || '');
  const rawDate  = e.date || e.Date || (sourceDateOnly ? `${sourceDateOnly} ${sourceTimeOnly || '00:00'}` : (sourceTimeOnly ? `1970-01-01 ${sourceTimeOnly}` : ''));
  const dateOnly = sourceDateOnly || deriveDateOnly(rawDate);
  const timeOnly = sourceTimeOnly || deriveTimeOnly(rawDate) || DEFAULTS.log.timeOnly;
  return {
    ...DEFAULTS.log,
    entryId:     e.entryId     || e.EntryID  || uid(),
    date:        rawDate,
    type:        e.type        || e.Type      || DEFAULTS.log.type,
    exercise:    e.exercise    || e.Exercise  || DEFAULTS.log.exercise,
    day:         String(e.day  ?? e.Day       ?? DEFAULTS.log.day),
    lastWeight:  Number(e.lastWeight  ?? e.LastWeight  ?? DEFAULTS.log.lastWeight) || 0,
    todayWeight: Number(e.todayWeight ?? e.TodayWeight ?? DEFAULTS.log.todayWeight) || 0,
    lastReps:    Number(e.lastReps    ?? e.LastReps    ?? DEFAULTS.log.lastReps) || 0,
    todayReps:   Number(e.todayReps   ?? e.TodayReps   ?? DEFAULTS.log.todayReps) || 0,
    dateOnly,
    timeOnly,
    set:         e.set         ?? e.Set       ?? DEFAULTS.log.set,
    setNumber:   e.setNumber   ?? e.SetNumber ?? DEFAULTS.log.setNumber,
    totalSets:   e.totalSets   ?? DEFAULTS.log.totalSets,
    muscleGroup: e.muscleGroup || e.MuscleGroup || DEFAULTS.log.muscleGroup,
    isPR:        e.isPR        ?? DEFAULTS.log.isPR,
    synced:      false
  };
}

function mergeExercises(incoming) {
  const existingIds = new Set(exercises.map(e => e.entryId));
  let added = 0;
  incoming.forEach(raw => {
    const ex = normalizeExercise(raw);
    if (!existingIds.has(ex.entryId)) {
      exercises.push(ex);
      existingIds.add(ex.entryId);
      added++;
    }
  });
  return added;
}

function mergeLog(incoming) {
  const existingIds = new Set(logEntries.map(e => e.entryId));
  let added = 0;
  incoming.forEach(raw => {
    const entry = normalizeLogEntry(raw);
    if (!existingIds.has(entry.entryId)) {
      logEntries.push(entry);
      existingIds.add(entry.entryId);
      added++;
    }
  });
  return added;
}

function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try { resolve(JSON.parse(e.target.result)); }
      catch { reject(new Error('Ugyldig JSON-fil')); }
    };
    reader.onerror = () => reject(new Error('Kunne ikke læse filen'));
    reader.readAsText(file);
  });
}

function importExercisesFromFile() {
  document.getElementById('file-import-exercises').click();
}

function importLogFromFile() {
  document.getElementById('file-import-log').click();
}

function importCombinedFromFile() {
  document.getElementById('file-import-combined').click();
}

// ══════════════════════════════════════════════════════════════════
//  SETTINGS
// ══════════════════════════════════════════════════════════════════
function loadSettings() {
  document.getElementById('cfg-url').value          = cfg.url          || '';
  document.getElementById('cfg-secret').value       = cfg.secret       || '';
  document.getElementById('cfg-rest-duration').value = cfg.restDuration ?? 90;
  loadChangelog();
}

async function loadChangelog() {
  try {
    const resp = await fetch('./CHANGELOG.json?' + Date.now());
    const entries = await resp.json();
    const latest5 = entries.slice(0, 5);
    const container = document.getElementById('changelog-list');
    container.innerHTML = latest5.map(e => {
      const d = e.timestamp ? new Date(e.timestamp) : null;
      const formatted = d ? d.toLocaleString('da-DK', { dateStyle: 'short', timeStyle: 'short' }) : e.date;
      return `<p style="margin:4px 0;font-size:13px"><strong>${esc(e.version)}</strong> <span style="color:var(--muted)">(${formatted})</span><br><span style="color:var(--text)">${esc(e.description)}</span></p>`;
    }).join('');
  } catch (_) {
    document.getElementById('changelog-list').textContent = 'Kunne ikke indlæse versionshistorik.';
  }
}

async function checkForUpdate() {
  toast('🔄 Søger efter opdatering…');
  try {
    // Unregister all service workers
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const reg of registrations) {
        await reg.unregister();
      }
    }
    // Clear all caches
    if ('caches' in window) {
      const keys = await caches.keys();
      for (const key of keys) {
        await caches.delete(key);
      }
    }
    toast('✅ Cache ryddet – genindlæser…');
    setTimeout(() => location.reload(true), 500);
  } catch (e) {
    toast('❌ Fejl ved opdatering: ' + e.message);
  }
}

function exportJson() {
  const blob = new Blob([JSON.stringify({ exercises, log: logEntries }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'workouttracker-export.json';
  a.click();
}

async function testConnection() {
  const url    = document.getElementById('cfg-url').value.trim();
  const secret = document.getElementById('cfg-secret').value;
  const el     = document.getElementById('conn-status');

  if (!url) { el.className = 'err'; el.textContent = '⚠️ Angiv en Apps Script URL først.'; return; }

  el.className = 'busy'; el.textContent = '⏳ Tester forbindelse…';

  try {
    // Step 1: ping (no auth required)
    const ping = await apiFetch(url);
    if (!ping || ping.status !== 'ok') throw new Error('Uventet svar fra server');

    // Step 2: verify secret by listing exercises
    const check = await apiFetch(apiGetUrl(url, API_ACTIONS.LIST_EXERCISES, secret));
    if (check.status === 'error') {
      el.className = 'err';
      el.textContent = '⚠️ Forbundet, men nøgle er forkert: ' + check.message;
    } else {
      el.className = 'ok';
      el.textContent = '✅ Forbundet! Google Sheet svarer korrekt.';
    }
  } catch (e) {
    el.className = 'err';
    el.textContent = '❌ Forbindelsesfejl: ' + e.message;
  }
}

// ══════════════════════════════════════════════════════════════════
//  QUICK-COMPLETE PANEL
// ══════════════════════════════════════════════════════════════════
let currentQuickEx = null;
let quickSetCurrent = 1;   // which set we're on (1-based)
let quickSetLogged  = [];   // weights/reps logged so far this exercise

function openQuickPanel(ex) {
  currentQuickEx = ex;
  quickSetCurrent = 1;
  quickSetLogged  = [];
  document.getElementById('qp-title').textContent  = ex.exercise || '';
  document.getElementById('qp-weight').value = ex.todayWeight ?? ex.lastWeight ?? 0;
  document.getElementById('qp-reps').value   = ex.todayReps   ?? ex.lastReps   ?? 0;
  updateQPSetUI();

  // Show progression hint if applicable
  const hint = getProgressionHint(ex);
  const hintEl = document.getElementById('qp-hint');
  if (hint !== null) {
    hintEl.textContent = `💡 Mål nået 3 gange i træk — overvej at øge til ${hint} kg næste session`;
    hintEl.classList.add('show');
  } else {
    hintEl.textContent = '';
    hintEl.classList.remove('show');
  }

  document.getElementById('quick-panel').classList.add('open');
  const fromScreen = document.querySelector('.screen.active')?.id || 'screen-home';
  history.pushState({ screen: 'quick-panel', returnTo: fromScreen }, '');
}

function closeQuickPanel() {
  document.getElementById('quick-panel').classList.remove('open');
  currentQuickEx = null;
}

function updateQPSetUI() {
  if (!currentQuickEx) return;
  const total = currentQuickEx.set || 3;
  document.getElementById('qp-set-label').textContent = `Sæt ${Math.min(quickSetCurrent, total)} af ${total}`;
  let chips = '';
  for (let i = 1; i <= total; i++) {
    const cls = i < quickSetCurrent ? 'done' : i === quickSetCurrent ? 'active' : '';
    chips += `<div class="set-chip-sm ${cls}">${i}</div>`;
  }
  document.getElementById('qp-set-chips').innerHTML = chips;
}

async function quickDone() {
  if (!currentQuickEx) return;
  const ex = currentQuickEx;

  // Read new values before mutating the exercise object.
  // The app is local-first: we persist locally immediately so the UI stays
  // consistent even when offline. A failed sync only shows a warning toast.
  const todayWeight   = Number(document.getElementById('qp-weight').value) || 0;
  const todayReps     = Number(document.getElementById('qp-reps').value)   || 0;
  const completedDate = isoDate();

  // PR check must happen BEFORE adding the new log entry
  const isNewPR = checkPR(ex.exercise, todayWeight);

  ex.todayWeight = todayWeight;
  ex.todayReps   = todayReps;
  ex.completed   = 'yes';
  ex.lastCompletedDate = completedDate;

  const logEntry = {
    ...createLogEntry(ex, { todayWeight, todayReps, dateOnly: completedDate }),
    isPR: isNewPR
  };
  logEntries.unshift(logEntry);
  save();

  if (cfg.url) {
    spinner(true);
    try {
      await ensureExerciseSynced(ex);
      await api({ action: API_ACTIONS.MARK_COMPLETED, entryId: ex.entryId,
        todayWeight, todayReps, logEntry });
      ex.synced = true; logEntry.synced = true; save();
    } catch(e) { toast('⚠️ Offline – gemt lokalt'); }
    spinner(false);
  }

  closeQuickPanel();
  if (isNewPR) toast('🏆 NY PR! ' + ex.exercise + ' — ' + todayWeight + ' kg!', 3500);
  else toast('✅ ' + ex.exercise + ' afsluttet!');
  renderHome();
}

async function quickLogSet() {
  if (!currentQuickEx) return;
  const ex = currentQuickEx;

  const todayWeight = Number(document.getElementById('qp-weight').value) || 0;
  const todayReps   = Number(document.getElementById('qp-reps').value)   || 0;
  const total       = ex.set || 3;
  const setNumber   = quickSetCurrent;

  // PR check must happen BEFORE adding the new log entry
  const isNewPR = checkPR(ex.exercise, todayWeight);

  const logEntry = {
    ...createLogEntry(ex, { todayWeight, todayReps, set: 1, setNumber, totalSets: total }),
    isPR: isNewPR
  };
  logEntries.unshift(logEntry);
  quickSetLogged.push({ weight: todayWeight, reps: todayReps, setNumber });
  save();

  quickSetCurrent++;
  const isLastSet = quickSetCurrent > total;

  if (isLastSet) {
    // All sets logged — mark exercise complete
    ex.todayWeight = todayWeight;
    ex.todayReps   = todayReps;
    ex.completed   = 'yes';
    ex.lastCompletedDate = isoDate();
    save();
    closeQuickPanel();
    renderHome();
    if (isNewPR) toast('🏆 NY PR! ' + todayWeight + ' kg — alle ' + total + ' sæt klaret!', 3500);
    else toast('✅ ' + ex.exercise + ' afsluttet (' + total + ' sæt)!');
  } else {
    updateQPSetUI();
    if (isNewPR) toast('🏆 NY PR på sæt ' + setNumber + '! ' + todayWeight + ' kg', 3000);
    else toast('📝 Sæt ' + setNumber + '/' + total + ' logget');
  }

  // Start rest timer regardless of whether last set or not
  startRestTimer(cfg.restDuration || 90, () => {});

  if (cfg.url) {
    try { await api({ action: API_ACTIONS.LOG_WORKOUT, entry: logEntry }); logEntry.synced = true; save(); } catch(e) {}
  }
}

// ══════════════════════════════════════════════════════════════════
//  PERSONAL RECORD DETECTION
// ══════════════════════════════════════════════════════════════════
function getPersonalRecord(exerciseName) {
  const vals = logEntries
    .filter(e => e.exercise === exerciseName && e.todayWeight > 0)
    .map(e => e.todayWeight);
  return vals.length ? Math.max(...vals) : 0;
}

/** Returns true if `weight` is strictly higher than all existing log entries for this exercise. */
function checkPR(exerciseName, weight) {
  if (!weight || weight <= 0) return false;
  return weight > getPersonalRecord(exerciseName);
}

// ══════════════════════════════════════════════════════════════════
//  PROGRESSIVE OVERLOAD HELPERS
// ══════════════════════════════════════════════════════════════════

/**
 * Returns the suggested next weight (kg) if the user has hit their target
 * in the last STREAK sessions, or null otherwise.
 */
function getProgressionHint(ex) {
  // Group log entries by date, keep max weight per session
  const byDate = {};
  logEntries
    .filter(e => e.exercise === ex.exercise && e.todayWeight > 0 && e.dateOnly)
    .forEach(e => {
      if (!byDate[e.dateOnly] || e.todayWeight > byDate[e.dateOnly].weight) {
        byDate[e.dateOnly] = { weight: e.todayWeight, reps: e.todayReps || 0 };
      }
    });
  const sessions = Object.entries(byDate)
    .sort((a, b) => b[0].localeCompare(a[0])) // newest first
    .slice(0, PROGRESSION_STREAK);
  if (sessions.length < PROGRESSION_STREAK) return null;
  const allMet = sessions.every(([, s]) =>
    s.weight >= ex.lastWeight && s.reps >= ex.lastReps
  );
  if (!allMet) return null;
  return +(ex.lastWeight + PROGRESSION_INCREMENT).toFixed(1);
}

/**
 * Returns true if the exercise has had no new PR in more than 28 days
 * (requires at least 4 log entries to avoid false positives on new exercises).
 */
function isStagnant(exName) {
  const entries = logEntries.filter(e => e.exercise === exName && e.todayWeight > 0);
  if (entries.length < 4) return false;
  const maxWeight = Math.max(...entries.map(e => e.todayWeight));
  const prEntry = entries
    .sort((a, b) => b.dateOnly.localeCompare(a.dateOnly))
    .find(e => e.todayWeight >= maxWeight);
  if (!prEntry || !prEntry.dateOnly) return false;
  const days = (Date.now() - new Date(prEntry.dateOnly + 'T00:00:00').getTime()) / MS_PER_DAY;
  return days > STAGNATION_DAYS;
}

/** Simple linear regression — returns { slope, intercept } for y = slope*x + intercept. */
function linReg(values) {
  const n = values.length;
  if (n < 2) return null;
  const sumX  = values.reduce((s, _, i) => s + i,     0);
  const sumY  = values.reduce((s, v)    => s + v,     0);
  const sumXY = values.reduce((s, v, i) => s + i * v, 0);
  const sumX2 = values.reduce((s, _, i) => s + i * i, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (!denom) return null;
  const slope     = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

// ══════════════════════════════════════════════════════════════════
//  REST TIMER
// ══════════════════════════════════════════════════════════════════
let restTimerInterval  = null;
let restTimerRemaining = 0;
let restTimerTotal     = 90;
let restTimerEndAt     = 0;
const TIMER_RING_RADIUS    = 88;
const RING_CIRCUMFERENCE   = 2 * Math.PI * TIMER_RING_RADIUS;
const MAX_REST_DURATION    = 600; // seconds

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [[0, 660], [0.2, 660], [0.4, 880]].forEach(([t, freq]) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.4, ctx.currentTime + t);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.18);
      osc.start(ctx.currentTime + t);
      osc.stop(ctx.currentTime + t + 0.2);
    });
  } catch(e) {}
}

function saveRestTimerState() {
  if (!restTimerEndAt) {
    localStorage.removeItem(DB_KEY_REST_TIMER);
    return;
  }
  localStorage.setItem(DB_KEY_REST_TIMER, JSON.stringify({
    endAt: restTimerEndAt,
    total: restTimerTotal
  }));
}

function clearRestTimerState() {
  restTimerEndAt = 0;
  localStorage.removeItem(DB_KEY_REST_TIMER);
}

function getRestTimerRemaining(now = Date.now()) {
  if (!restTimerEndAt) return 0;
  return Math.max(0, Math.ceil((restTimerEndAt - now) / 1000));
}

function updateRestTimerUI(remaining = getRestTimerRemaining()) {
  const ringFg = document.getElementById('timer-ring-fg');
  const timeEl = document.getElementById('timer-time');
  const safeTotal = Math.max(restTimerTotal, 1);
  const clampedRemaining = Math.max(0, remaining);
  const progress = clampedRemaining / safeTotal;

  timeEl.textContent = clampedRemaining;
  ringFg.style.strokeDasharray = RING_CIRCUMFERENCE;
  ringFg.style.strokeDashoffset = RING_CIRCUMFERENCE * (1 - progress);
}

function finishRestTimer(onDone, notifyUser = document.visibilityState === 'visible') {
  clearInterval(restTimerInterval);
  restTimerInterval = null;
  restTimerRemaining = 0;
  clearRestTimerState();
  updateRestTimerUI(0);

  const overlay = document.getElementById('rest-timer-overlay');
  if (notifyUser) {
    beep();
    if (navigator.vibrate) navigator.vibrate([300, 100, 300, 100, 400]);
    setTimeout(() => {
      overlay.classList.remove('show');
      if (typeof onDone === 'function') onDone();
    }, 1200);
    return;
  }

  overlay.classList.remove('show');
  if (typeof onDone === 'function') onDone();
}

function syncRestTimer(onDone) {
  if (!restTimerEndAt) return;
  restTimerRemaining = getRestTimerRemaining();
  updateRestTimerUI(restTimerRemaining);
  if (restTimerRemaining <= 0) finishRestTimer(onDone);
}

function startRestTimer(seconds, onDone) {
  clearInterval(restTimerInterval);
  restTimerTotal     = seconds;
  restTimerEndAt     = Date.now() + (seconds * 1000);
  restTimerRemaining = seconds;
  saveRestTimerState();

  const overlay = document.getElementById('rest-timer-overlay');
  overlay.classList.add('show');
  syncRestTimer(onDone);

  restTimerInterval = setInterval(() => syncRestTimer(onDone), 1000);
}

function skipRestTimer() {
  clearInterval(restTimerInterval);
  restTimerInterval = null;
  restTimerRemaining = 0;
  clearRestTimerState();
  document.getElementById('rest-timer-overlay').classList.remove('show');
}

function addRestTime(extraSeconds) {
  restTimerRemaining = Math.min(getRestTimerRemaining() + extraSeconds, MAX_REST_DURATION);
  restTimerTotal     = Math.max(restTimerTotal, restTimerRemaining);
  restTimerEndAt     = Date.now() + (restTimerRemaining * 1000);
  saveRestTimerState();
  syncRestTimer();
}

function restoreRestTimer() {
  let state = null;
  try { state = JSON.parse(localStorage.getItem(DB_KEY_REST_TIMER) || 'null'); } catch(e) {}
  if (!state || !state.endAt) return;

  restTimerEndAt = Number(state.endAt) || 0;
  restTimerTotal = Math.min(Math.max(Number(state.total) || cfg.restDuration || 90, 1), MAX_REST_DURATION);

  if (!restTimerEndAt) {
    clearRestTimerState();
    return;
  }

  if (getRestTimerRemaining() <= 0) {
    finishRestTimer(null, false);
    return;
  }

  document.getElementById('rest-timer-overlay').classList.add('show');
  syncRestTimer();
  clearInterval(restTimerInterval);
  restTimerInterval = setInterval(() => syncRestTimer(), 1000);
}

// ══════════════════════════════════════════════════════════════════
//  PROGRESSION CHART
// ══════════════════════════════════════════════════════════════════
let chartExerciseName = '';

function openChart(exerciseName) {
  if (!exerciseName) return;
  chartExerciseName = exerciseName;
  document.getElementById('chart-exercise-title').textContent = exerciseName;
  showScreen('screen-chart');
  renderChart();
}

function renderChart() {
  const name   = chartExerciseName;
  const canvas = document.getElementById('chart-canvas');
  const ctx    = canvas.getContext('2d');

  // Gather entries for this exercise, sorted chronologically
  const entries = logEntries
    .filter(e => e.exercise === name && e.dateOnly)
    .sort((a, b) => a.dateOnly.localeCompare(b.dateOnly));

  // Aggregate: one point per date — take the max weight that day
  const byDate = {};
  entries.forEach(e => {
    if (!byDate[e.dateOnly] || e.todayWeight > byDate[e.dateOnly].weight) {
      byDate[e.dateOnly] = { date: e.dateOnly, weight: e.todayWeight, reps: e.todayReps, isPR: !!e.isPR };
    }
  });
  const data = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));

  // ── Stats cards ────────────────────────────────────────────────
  const statsEl = document.getElementById('chart-stats');
  const recentEl = document.getElementById('chart-recent-log');
  if (!data.length) {
    statsEl.innerHTML  = '<p class="empty" style="width:100%">Ingen log-data for denne øvelse endnu.</p>';
    recentEl.innerHTML = '';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  const maxW  = Math.max(...data.map(d => d.weight));
  const lastW = data[data.length - 1].weight;
  const diff  = +(lastW - data[0].weight).toFixed(1);
  const diffColor = diff >= 0 ? 'var(--success)' : 'var(--danger)';

  // 1RM estimate (Epley formula: w × (1 + r/30))
  const best1RM = entries.reduce((best, e) => {
    if (!e.todayWeight || !e.todayReps) return best;
    return Math.max(best, e.todayWeight * (1 + e.todayReps / 30));
  }, 0);

  // Total volume per session (summed across all sets per date)
  const volByDate = {};
  entries.forEach(e => {
    volByDate[e.dateOnly] = (volByDate[e.dateOnly] || 0) + (e.todayWeight || 0) * (e.todayReps || 0);
  });
  const lastVol = volByDate[data[data.length - 1].date] || 0;

  statsEl.innerHTML = `
    <div class="stat-card">
      <div class="stat-card-label">Bedste (PR)</div>
      <div class="stat-card-value" style="color:var(--accent2)">${maxW} kg</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-label">Seneste</div>
      <div class="stat-card-value">${lastW} kg</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-label">Fremgang</div>
      <div class="stat-card-value" style="color:${diffColor}">${diff >= 0 ? '+' : ''}${diff} kg</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-label">Est. 1RM</div>
      <div class="stat-card-value" style="color:var(--accent3)">${best1RM.toFixed(1)} kg</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-label">Sessioner</div>
      <div class="stat-card-value">${data.length}</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-label">Volumen (sidst)</div>
      <div class="stat-card-value" style="font-size:16px">${lastVol.toFixed(0)} kg</div>
    </div>`;

  // ── Recent log ─────────────────────────────────────────────────
  recentEl.innerHTML = entries.slice(0, 8).map(e => `
    <div class="log-card" style="margin-bottom:6px">
      <div class="log-card-info">
        <h3 style="font-size:13px">${esc(e.dateOnly)} ${e.timeOnly ? '· ' + esc(e.timeOnly) : ''} ${e.isPR ? '<span class="badge-pr">🏆 PR</span>' : ''}</h3>
        <p>${e.todayWeight} kg × ${e.todayReps} reps${e.setNumber ? ' (sæt ' + e.setNumber + '/' + (e.totalSets || e.set || '?') + ')' : ''}</p>
      </div>
    </div>`).join('');

  // ── Canvas chart ───────────────────────────────────────────────
  const W = canvas.clientWidth || 320;
  const H = 220;
  canvas.width  = W * (window.devicePixelRatio || 1);
  canvas.height = H * (window.devicePixelRatio || 1);
  canvas.style.height = H + 'px';
  ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);

  const PAD = { top: 20, right: 20, bottom: 40, left: 46 };
  const cW   = W - PAD.left - PAD.right;
  const cH   = H - PAD.top  - PAD.bottom;
  const n    = data.length;

  const weights = data.map(d => d.weight);
  const rawMin  = Math.min(...weights);
  const rawMax  = Math.max(...weights);
  const span    = rawMax - rawMin || 10;
  const minW    = Math.max(0, rawMin - span * 0.2);
  const maxWVal = rawMax + span * 0.2;

  const xPos  = i => PAD.left + (n < 2 ? cW / 2 : (i / (n - 1)) * cW);
  const yPos  = w => PAD.top + cH - ((w - minW) / (maxWVal - minW)) * cH;

  // Volume normalisation for secondary line (normalised to 10–90 % chart height)
  const volData  = data.map(d => volByDate[d.date] || 0);
  const maxVol   = Math.max(...volData, 1);
  const yVolPos  = v => PAD.top + cH * 0.1 + (1 - v / maxVol) * cH * 0.8;

  ctx.clearRect(0, 0, W, H);

  // Grid
  const gridSteps = 4;
  for (let i = 0; i <= gridSteps; i++) {
    const y   = PAD.top + (i / gridSteps) * cH;
    const val = maxWVal - (i / gridSteps) * (maxWVal - minW);
    ctx.strokeStyle = '#1e3050'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke();
    ctx.fillStyle = '#64748b'; ctx.font = '11px Inter,Segoe UI,sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(val.toFixed(0), PAD.left - 5, y + 4);
  }

  if (n === 1) {
    // Single dot
    ctx.fillStyle = weights[0] >= maxW ? '#fbbf24' : '#22d3ee';
    ctx.beginPath(); ctx.arc(xPos(0), yPos(weights[0]), 6, 0, Math.PI * 2); ctx.fill();
  } else {
    // Area fill (gradient) – rgba values correspond to --accent2 (#22d3ee)
    const areaGrad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + cH);
    areaGrad.addColorStop(0, 'rgba(34,211,238,0.22)');  // --accent2 at 22% opacity
    areaGrad.addColorStop(1, 'rgba(34,211,238,0)');     // --accent2 transparent
    ctx.fillStyle = areaGrad;
    ctx.beginPath();
    ctx.moveTo(xPos(0), PAD.top + cH);
    data.forEach((d, i) => ctx.lineTo(xPos(i), yPos(d.weight)));
    ctx.lineTo(xPos(n - 1), PAD.top + cH);
    ctx.closePath(); ctx.fill();

    // Volume series (dashed orange line, normalised)
    ctx.strokeStyle = 'rgba(245,158,11,0.65)'; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    data.forEach((d, i) => {
      const y = yVolPos(volData[i]);
      if (i === 0) ctx.moveTo(xPos(0), y); else ctx.lineTo(xPos(i), y);
    });
    ctx.stroke();
    ctx.setLineDash([]);

    // Trend line (linear regression, purple dashed)
    const reg = linReg(weights);
    if (reg) {
      ctx.strokeStyle = 'rgba(167,139,250,0.7)'; ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(xPos(0),     yPos(Math.max(minW, reg.intercept)));
      ctx.lineTo(xPos(n - 1), yPos(Math.max(minW, reg.slope * (n - 1) + reg.intercept)));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Main weight line
    ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
    ctx.beginPath();
    data.forEach((d, i) => i === 0 ? ctx.moveTo(xPos(i), yPos(d.weight)) : ctx.lineTo(xPos(i), yPos(d.weight)));
    ctx.stroke();

    // Dots
    data.forEach((d, i) => {
      const x = xPos(i), y = yPos(d.weight);
      const isPrDot = d.weight >= maxW;
      ctx.beginPath();
      ctx.arc(x, y, isPrDot ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = isPrDot ? '#fbbf24' : '#22d3ee';
      ctx.fill();
      if (isPrDot) { ctx.strokeStyle = '#92400e'; ctx.lineWidth = 2; ctx.stroke(); }
    });
  }

  // X-axis date labels
  ctx.fillStyle = '#64748b'; ctx.font = '10px Inter,Segoe UI,sans-serif'; ctx.textAlign = 'center';
  const maxLabels = Math.min(n, 6);
  const step = Math.max(1, Math.ceil(n / maxLabels));
  data.forEach((d, i) => {
    if (i % step !== 0 && i !== n - 1) return;
    ctx.fillText(d.date.slice(5), xPos(i), H - PAD.bottom + 16);
  });
}

// ══════════════════════════════════════════════════════════════════
//  ANALYSE SCREEN
// ══════════════════════════════════════════════════════════════════
function renderAnalyse() {
  const el = document.getElementById('analyse-content');
  if (!el) return;

  if (!exercises.length) {
    el.innerHTML = '<p class="empty">Ingen øvelser fundet. Opret øvelser og log træning for at se analyse.</p>';
    return;
  }

  let html = '';

  // ── 1. Progressionsoverblik ────────────────────────────────────
  html += `<div class="analyse-card">
    <div class="analyse-card-title">📈 Progressionsoverblik</div>`;
  const exWithLog = exercises.filter(ex =>
    logEntries.some(e => e.exercise === ex.exercise)
  );
  if (!exWithLog.length) {
    html += `<p class="empty" style="padding:20px 0">Log dine første sæt for at se progression.</p>`;
  } else {
    exWithLog.forEach(ex => {
      const exEntries = logEntries
        .filter(e => e.exercise === ex.exercise && e.todayWeight > 0)
        .map(e => ({ e, _d: e.dateOnly || deriveDateOnly(e.date) || '' }))
        .sort((a, b) => a._d.localeCompare(b._d))
        .map(({ e }) => e);
      if (!exEntries.length) return;
      const maxW  = Math.max(...exEntries.map(e => e.todayWeight));
      const lastW = exEntries[exEntries.length - 1].todayWeight;
      const firstW = exEntries[0].todayWeight;
      const diff  = +(lastW - firstW).toFixed(1);
      const diffStr = diff >= 0 ? `+${diff}` : `${diff}`;
      const stagnant = isStagnant(ex.exercise);
      const hint = getProgressionHint(ex);
      let badge = '';
      if (hint !== null) badge = `<span class="badge-increase">⬆ Øg til ${hint} kg</span>`;
      else if (stagnant)  badge = `<span class="badge-stagnant">⏸ Stagnation</span>`;
      html += `<div class="analyse-row">
        <span class="analyse-row-label">${esc(ex.exercise)}</span>
        <span class="analyse-row-value">${lastW} kg &nbsp;·&nbsp; PR: ${maxW} kg &nbsp;·&nbsp; ${diffStr} kg totalt</span>
        <span class="analyse-row-badge">${badge}</span>
      </div>`;
    });
  }
  html += `</div>`;

  // ── 2. Stagnation summary (if any) ────────────────────────────
  const stagnantList = exercises.filter(ex => isStagnant(ex.exercise));
  if (stagnantList.length) {
    html += `<div class="analyse-card">
      <div class="analyse-card-title">⏸ Stagnerede øvelser <small style="font-weight:400;color:var(--muted)">(ingen PR i &gt;28 dage)</small></div>`;
    stagnantList.forEach(ex => {
      html += `<div class="analyse-row">
        <span class="analyse-row-label">${esc(ex.exercise)}</span>
        <span class="analyse-row-value">Dag ${esc(String(ex.day))} · ${ex.lastWeight} kg mål</span>
        <span class="analyse-row-badge"><span class="badge-stagnant">Stagnation</span></span>
      </div>`;
    });
    html += `</div>`;
  }

  // ── 3. Volumenbalance pr. dag ──────────────────────────────────
  html += `<div class="analyse-card">
    <div class="analyse-card-title">⚖️ Volumenbalance pr. dag</div>`;
  const byDay = {};
  exercises.forEach(ex => {
    const d = String(ex.day || '');
    if (!d) return;
    if (!byDay[d]) byDay[d] = { compound: 0, isolation: 0 };
    if (ex.category === 'Compound') byDay[d].compound++;
    else byDay[d].isolation++;
  });
  const dayKeys = sortDayValues(Object.keys(byDay));
  if (!dayKeys.length) {
    html += `<p class="empty" style="padding:20px 0">Ingen øvelser med dagsnummer fundet.</p>`;
  } else {
    dayKeys.forEach(day => {
      const { compound, isolation } = byDay[day];
      const total = compound + isolation;
      const isolPct = total ? Math.round(isolation / total * 100) : 0;
      let badge = '';
      if (compound === 0)  badge = `<span class="badge-stagnant">Ingen compound</span>`;
      else if (isolPct > 65) badge = `<span style="color:var(--warning);font-size:11px;font-weight:700">⚠ ${isolPct}% iso</span>`;
      html += `<div class="analyse-row">
        <span class="analyse-row-label">Dag ${esc(day)}</span>
        <span class="analyse-row-value">${compound} compound &nbsp;·&nbsp; ${isolation} isolation</span>
        <span class="analyse-row-badge">${badge}</span>
      </div>`;
    });
  }
  html += `</div>`;

  // ── 4. Push/Pull balance ───────────────────────────────────────
  html += `<div class="analyse-card">
    <div class="analyse-card-title">🔄 Push/Pull balance</div>`;
  const pushCount = exercises.filter(e => e.type === 'Push').length;
  const pullCount = exercises.filter(e => e.type === 'Pull').length;
  if (!(pushCount + pullCount)) {
    html += `<p class="empty" style="padding:20px 0">Ingen Push/Pull-øvelser fundet.</p>`;
  } else {
    const ratio = pushCount / (pullCount || 1);
    if (ratio > 1.5)
      html += `<div class="analyse-alert">⚠️ ${pushCount} Push vs ${pullCount} Pull — overvej flere Pull-øvelser for muskelbalance</div>`;
    else if (ratio < 0.67)
      html += `<div class="analyse-alert">⚠️ ${pushCount} Push vs ${pullCount} Pull — overvej flere Push-øvelser for muskelbalance</div>`;
    else
      html += `<div class="analyse-ok">✅ God balance: ${pushCount} Push / ${pullCount} Pull</div>`;
    dayKeys.forEach(day => {
      const dp = exercises.filter(e => String(e.day) === day && e.type === 'Push').length;
      const dl = exercises.filter(e => String(e.day) === day && e.type === 'Pull').length;
      if (dp + dl > 0) {
        html += `<div class="analyse-row">
          <span class="analyse-row-label">Dag ${esc(day)}</span>
          <span class="analyse-row-value">${dp} Push &nbsp;·&nbsp; ${dl} Pull</span>
          <span class="analyse-row-badge"></span>
        </div>`;
      }
    });
  }
  html += `</div>`;

  // ── 5. Recovery check ──────────────────────────────────────────
  html += `<div class="analyse-card">
    <div class="analyse-card-title">😴 Recovery-advarsler</div>`;
  const muscleLastDate = {};
  const recoveryWarnings = [];
  logEntries
    .filter(e => e.muscleGroup && (e.dateOnly || deriveDateOnly(e.date)))
    .map(e => ({ e, _d: e.dateOnly || deriveDateOnly(e.date) }))
    .sort((a, b) => a._d.localeCompare(b._d))
    .forEach(({ e, _d }) => {
      const mg = e.muscleGroup;
      const dateStr = _d;
      const date = new Date(dateStr + 'T00:00:00');
      if (muscleLastDate[mg]) {
        const diffH = (date - muscleLastDate[mg]) / MS_PER_HOUR;
        if (diffH > 0 && diffH < 48) {
          const key = mg + dateStr;
          if (!recoveryWarnings.find(w => w.key === key)) {
            recoveryWarnings.push({ key, muscle: mg, hours: Math.round(diffH), date: dateStr });
          }
        }
      }
      if (!muscleLastDate[mg] || date > muscleLastDate[mg]) {
        muscleLastDate[mg] = date;
      }
    });
  const recentRW = recoveryWarnings.slice(-5).reverse();
  if (!recentRW.length) {
    html += `<div class="analyse-ok">✅ Ingen Recovery-advarsler fundet i loggen</div>`;
  } else {
    recentRW.forEach(w => {
      html += `<div class="analyse-alert">⚠️ ${esc(w.muscle)}: kun ${w.hours}t hvile (${esc(w.date)})</div>`;
    });
  }
  html += `</div>`;

  el.innerHTML = html;
}

// ══════════════════════════════════════════════════════════════════
//  UTILITY
// ══════════════════════════════════════════════════════════════════
function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ══════════════════════════════════════════════════════════════════
//  EVENT WIRING
// ══════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {

  load();
  loadSettings();
  renderHome();
  restoreRestTimer();

  // Top nav
  document.querySelectorAll('#topnav button[data-screen]').forEach(btn => {
    btn.addEventListener('click', () => {
      showScreen(btn.dataset.screen);
      if (btn.dataset.screen === 'screen-log')     renderLog();
      if (btn.dataset.screen === 'screen-analyse') renderAnalyse();
    });
  });

  // Topbar
  document.getElementById('btn-refresh').addEventListener('click', syncAll);
  document.getElementById('btn-newday').addEventListener('click', newDay);

  // Home filters
  document.getElementById('sel-type').addEventListener('change', renderHome);
  document.getElementById('sel-day').addEventListener('change',  renderHome);
  document.getElementById('sel-category').addEventListener('change', renderHome);
  document.getElementById('sel-muscle').addEventListener('change', renderHome);

  // Suggestion bar – delegated click (one listener for all renders)
  document.getElementById('suggestion-bar').addEventListener('click', e => {
    const btn = e.target.closest('.sugg-btn');
    if (!btn) return;
    document.getElementById('sel-day').value = btn.dataset.day;
    renderHome();
  });

  // Details
  document.getElementById('btn-det-back').addEventListener('click',   () => { showScreen('screen-home'); renderHome(); });
  document.getElementById('btn-det-save').addEventListener('click',   saveDetails);
  document.getElementById('btn-det-delete').addEventListener('click', deleteExercise);
  document.getElementById('btn-det-chart').addEventListener('click',  () => openChart(currentEx && currentEx.exercise));

  // New exercise
  document.getElementById('btn-new-back').addEventListener('click', () => showScreen('screen-home'));
  document.getElementById('btn-new-save').addEventListener('click', saveNewExercise);

  // Log search
  document.getElementById('log-search').addEventListener('input', renderLog);

  // Settings
  document.getElementById('btn-save-settings').addEventListener('click', () => {
    cfg.url          = document.getElementById('cfg-url').value.trim();
    cfg.secret       = document.getElementById('cfg-secret').value;
    cfg.restDuration = Number(document.getElementById('cfg-rest-duration').value) || 90;
    saveCfg();
    // Reset connection status when settings change
    const el = document.getElementById('conn-status');
    el.className = ''; el.textContent = '';
    toast('✅ Indstillinger gemt');
  });
  document.getElementById('btn-test-conn').addEventListener('click', testConnection);
  document.getElementById('btn-sync').addEventListener('click', syncAll);
  document.getElementById('btn-export-json').addEventListener('click', exportJson);
  document.getElementById('btn-check-update').addEventListener('click', checkForUpdate);

  // Import from file
  document.getElementById('btn-import-exercises').addEventListener('click', importExercisesFromFile);
  document.getElementById('btn-import-log').addEventListener('click', importLogFromFile);
  document.getElementById('btn-import-combined').addEventListener('click', importCombinedFromFile);

  document.getElementById('file-import-exercises').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    try {
      const data = await readJsonFile(file);
      const rows = Array.isArray(data) ? data : (data.exercises || []);
      if (!rows.length) { toast('⚠️ Ingen øvelser fundet i filen'); return; }
      const added = mergeExercises(rows);
      save(); renderHome();
      toast(`✅ ${added} nye øvelser indlæst (${rows.length - added} sprunget over)`);
    } catch(err) { toast('❌ ' + err.message); }
  });

  document.getElementById('file-import-log').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    try {
      const data = await readJsonFile(file);
      const rows = Array.isArray(data) ? data : (data.log || data.entries || []);
      if (!rows.length) { toast('⚠️ Ingen log-poster fundet i filen'); return; }
      const added = mergeLog(rows);
      save(); renderLog();
      toast(`✅ ${added} nye log-poster indlæst (${rows.length - added} sprunget over)`);
    } catch(err) { toast('❌ ' + err.message); }
  });

  document.getElementById('file-import-combined').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    try {
      const data = await readJsonFile(file);
      const exRows  = Array.isArray(data) ? data : (data.exercises || []);
      const logRows = Array.isArray(data) ? []   : (data.log || data.entries || []);
      const addedEx  = mergeExercises(exRows);
      const addedLog = mergeLog(logRows);
      save(); renderHome();
      toast(`✅ Importeret: ${addedEx} øvelser, ${addedLog} log-poster`);
    } catch(err) { toast('❌ ' + err.message); }
  });

  // Quick panel
  document.getElementById('qp-close').addEventListener('click', closeQuickPanel);
  document.getElementById('qp-backdrop').addEventListener('click', closeQuickPanel);
  document.getElementById('qp-btn-done').addEventListener('click', quickDone);
  document.getElementById('qp-btn-log').addEventListener('click', quickLogSet);

  // Rest timer
  document.getElementById('btn-timer-skip').addEventListener('click', skipRestTimer);
  document.getElementById('btn-timer-add').addEventListener('click', () => addRestTime(30));

  // Chart screen
  document.getElementById('btn-chart-back').addEventListener('click', () => { showScreen('screen-home'); renderHome(); });

  // PWA
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  const handleRestTimerResume = () => syncRestTimer();
  document.addEventListener('visibilitychange', handleRestTimerResume);
  window.addEventListener('pageshow', handleRestTimerResume);

  // ── Android back button (PWA) ──────────────────────────────────
  // Replace the initial history entry (no extra push, start clean).
  history.replaceState({ screen: 'screen-home' }, '');

  window.addEventListener('popstate', (e) => {
    // Priority 1: close rest-timer overlay
    const timerOverlay = document.getElementById('rest-timer-overlay');
    if (timerOverlay.classList.contains('show')) {
      skipRestTimer();
      history.pushState({ screen: 'rest-timer' }, '');
      return;
    }
    // Priority 2: close quick panel
    const quickPanel = document.getElementById('quick-panel');
    if (quickPanel.classList.contains('open')) {
      closeQuickPanel();
      // Restore state for the screen we returned to
      const active = document.querySelector('.screen.active')?.id || 'screen-home';
      history.pushState({ screen: active }, '');
      return;
    }
    // Priority 3: go back to home screen
    const active = document.querySelector('.screen.active');
    if (active && active.id !== 'screen-home') {
      showScreen('screen-home');
      renderHome();
    }
    // Replace (not push) to avoid accumulating duplicate home states
    history.replaceState({ screen: 'screen-home' }, '');
  });

}); // end DOMContentLoaded
