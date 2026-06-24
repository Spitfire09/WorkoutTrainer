'use strict';

import { API_ACTIONS } from './schema.js';
import {
  exercises, logEntries, cfg, currentEx, setExercises, setLogEntries, setCurrentEx,
  save, uid, isoDate, isoTime, sortDayValues, esc, createLogEntry, apiGetUrl, deriveDateOnly, MS_PER_DAY
} from './state.js';
import { api, apiFetch } from './api.js';
import { toast, spinner, showScreen, showPRCelebration } from './ui.js';
import { checkPR, getBestPerformance, getProgressionHint, isStagnant, renderLog } from './log.js';
import { startRestTimer } from './timer.js';

function toUtcMidnightTs(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) return null;
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return null;
  return Date.UTC(year, month - 1, day);
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

export function renderHome() {
  buildDayOptions();
  buildMuscleOptions();
  const typeFilter     = document.getElementById('sel-type').value;
  const dayFilter      = document.getElementById('sel-day').value;
  const categoryFilter = document.getElementById('sel-category').value;
  const muscleFilter   = document.getElementById('sel-muscle').value;
  const activeFilter   = document.getElementById('sel-active').value;

  let filtered = exercises;
  if (typeFilter)     filtered = filtered.filter(e => e.type === typeFilter);
  if (dayFilter)      filtered = filtered.filter(e => String(e.day) === dayFilter);
  if (categoryFilter) filtered = filtered.filter(e => e.category === categoryFilter);
  if (muscleFilter)   filtered = filtered.filter(e => e.muscleGroup === muscleFilter);
  if (activeFilter === 'active')   filtered = filtered.filter(e => e.active !== false);
  else if (activeFilter === 'inactive') filtered = filtered.filter(e => e.active === false);

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

  const sorted = [...filtered].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed === 'yes' ? 1 : -1;
    return a.exercise.localeCompare(b.exercise);
  });

  const now = new Date();
  const todayMidnightMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const latestByExercise = {};
  for (const entry of logEntries) {
    if (!entry?.exercise) continue;
    const dateStr = deriveDateOnly(entry.date);
    if (!dateStr) continue;
    const ts = toUtcMidnightTs(dateStr);
    if (ts === null) continue;
    if (!(entry.exercise in latestByExercise) || ts > latestByExercise[entry.exercise]) {
      latestByExercise[entry.exercise] = ts;
    }
  }

  sorted.forEach(ex => {
    const isPrEx = ex.completed === 'yes' && checkPR(ex.exercise, ex.todayWeight, ex.todayReps);
    const stagnant = isStagnant(ex.exercise);
    const progressHint = getProgressionHint(ex);
    const latestTs = latestByExercise[ex.exercise];
    let daysSinceLastLogged = null;
    if (latestTs !== undefined) {
      const diffDays = Math.floor((todayMidnightMs - latestTs) / MS_PER_DAY);
      daysSinceLastLogged = diffDays < 0 ? 0 : diffDays;
    }
    const card = document.createElement('div');
    card.className = 'ex-card' + (ex.completed === 'yes' ? ' done' : '');
    const typeAccent = { Push: '#3b82f6', Pull: '#10b981', Leg: '#f59e0b', Core: '#a78bfa' };
    card.style.setProperty('--card-accent', typeAccent[ex.type] || '#3b82f6');
    const details = [
      `Dag ${esc(String(ex.day))}`,
      ex.muscleGroup ? esc(ex.muscleGroup) : '',
      daysSinceLastLogged !== null ? `${daysSinceLastLogged} dage` : ''
    ].filter(Boolean).join(' &nbsp;·&nbsp; ');
    card.innerHTML = `
      <div class="ex-card-info">
        <h3>${esc(ex.exercise)}</h3>
        <p>Mål: ${ex.lastWeight} kg / ${ex.lastReps} reps &nbsp;·&nbsp; ${details}</p>
      </div>
      <span class="badge-type badge-type-${esc((ex.type||'').toLowerCase())}">${esc(ex.type)}</span>
      ${progressHint !== null ? '<span class="badge-increase">⬆ Øg vægt</span>' : ''}
      ${stagnant && progressHint === null ? '<span class="badge-stagnant">⏸</span>' : ''}
      ${isPrEx ? '<span class="badge-pr">🏆 PR</span>' : ''}
      ${ex.completed === 'yes' ? '<span class="badge-done">✓</span>' : ''}
      <span class="ex-card-arrow" role="button" aria-label="Detaljer" tabindex="0">›</span>`;
    const arrow = card.querySelector('.ex-card-arrow');
    arrow.addEventListener('click', e => { e.stopPropagation(); openDetails(ex); });
    arrow.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); openDetails(ex); } });
    card.addEventListener('click', () => openQuickPanel(ex));
    list.appendChild(card);
  });
}

// ══════════════════════════════════════════════════════════════════
//  DETAILS SCREEN
// ══════════════════════════════════════════════════════════════════
export function openDetails(ex) {
  setCurrentEx(ex);
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
  document.getElementById('det-active').checked    = ex.active !== false;
  if (ex.completed === 'yes' && ex.todayWeight > 0 && ex.todayWeight >= (ex.lastWeight ?? 0)) {
    document.getElementById('det-lastweight').value = ex.todayWeight;
  }
  showScreen('screen-details');
}

async function ensureExerciseSynced(ex) {
  if (!ex.synced && cfg.url) {
    await api({ action: API_ACTIONS.NEW_EXERCISE, exercise: ex });
    ex.synced = true;
    save();
  }
}

export async function saveDetails() {
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
  ex.active      = document.getElementById('det-active').checked;
  save();

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
                  Description: ex.description, Active: ex.active } });
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
export async function saveNewExercise() {
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
//  NEW DAY
// ══════════════════════════════════════════════════════════════════
export async function newDay() {
  if (!confirm('Ny dag — nulstil alle afsluttede øvelser?\nAfsluttet ← nej')) return;
  clearAllQuickProgress();
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
export async function deleteExercise() {
  if (!currentEx) return;
  if (!confirm('Slet øvelsen "' + currentEx.exercise + '"?')) return;
  const id = currentEx.entryId;
  clearQuickProgressSet(currentEx);
  setExercises(exercises.filter(e => e.entryId !== id));
  save();
  if (cfg.url) {
    try { await api({ action: API_ACTIONS.DELETE_EXERCISE, entryId: id }); } catch(e) {}
  }
  toast('Øvelse slettet');
  setCurrentEx(null);
  showScreen('screen-home');
  renderHome();
}

// ══════════════════════════════════════════════════════════════════
//  QUICK-COMPLETE PANEL
// ══════════════════════════════════════════════════════════════════
let currentQuickEx = null;
let quickSetCurrent = 1;
let quickSetLogged  = [];
const QUICK_PROGRESS_KEY = 'wt_quick_progress';
let quickProgress = {};

try {
  quickProgress = JSON.parse(localStorage.getItem(QUICK_PROGRESS_KEY) || '{}') || {};
} catch (_) {
  quickProgress = {};
}

function saveQuickProgress() {
  localStorage.setItem(QUICK_PROGRESS_KEY, JSON.stringify(quickProgress));
}

function getQuickProgressSet(ex) {
  if (!ex?.entryId || ex.completed === 'yes') return 1;
  const total = ex.set || 3;
  const next = Number(quickProgress[ex.entryId]) || 1;
  return Math.max(1, Math.min(total, next));
}

function setQuickProgressSet(ex, setNumber) {
  if (!ex?.entryId) return;
  const total = ex.set || 3;
  const clamped = Math.max(1, Math.min(total, Number(setNumber) || 1));
  quickProgress[ex.entryId] = clamped;
  saveQuickProgress();
}

function clearQuickProgressSet(ex) {
  if (!ex?.entryId) return;
  delete quickProgress[ex.entryId];
  saveQuickProgress();
}

function clearAllQuickProgress() {
  quickProgress = {};
  saveQuickProgress();
}

export function openQuickPanel(ex) {
  currentQuickEx = ex;
  quickSetCurrent = getQuickProgressSet(ex);
  quickSetLogged  = [];
  document.getElementById('qp-title').textContent  = ex.exercise || '';
  document.getElementById('qp-weight').value = ex.todayWeight ?? ex.lastWeight ?? 0;
  document.getElementById('qp-reps').value   = ex.todayReps   ?? ex.lastReps   ?? 0;
  updateQPSetUI();

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

export function closeQuickPanel() {
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

export async function quickDone() {
  if (!currentQuickEx) return;
  const ex = currentQuickEx;

  const todayWeight   = Number(document.getElementById('qp-weight').value) || 0;
  const todayReps     = Number(document.getElementById('qp-reps').value)   || 0;
  const completedDate = isoDate();

  const prevBest = getBestPerformance(ex.exercise);
  const isNewPR = checkPR(ex.exercise, todayWeight, todayReps);

  ex.todayWeight = todayWeight;
  ex.todayReps   = todayReps;
  ex.completed   = 'yes';
  ex.lastCompletedDate = completedDate;
  clearQuickProgressSet(ex);

  const logEntry = {
    ...createLogEntry(ex, { todayWeight, todayReps, date: `${completedDate} ${isoTime()}` }),
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
  if (isNewPR) {
    showPRCelebration(ex.exercise, prevBest, todayWeight, todayReps);
  } else {
    toast('✅ ' + ex.exercise + ' afsluttet!');
  }
  renderHome();
}

export async function quickLogSet() {
  if (!currentQuickEx) return;
  const ex = currentQuickEx;

  const todayWeight = Number(document.getElementById('qp-weight').value) || 0;
  const todayReps   = Number(document.getElementById('qp-reps').value)   || 0;
  const total       = ex.set || 3;
  const setNumber   = quickSetCurrent;

  const isNewPR = checkPR(ex.exercise, todayWeight, todayReps);
  const prevBest = isNewPR ? getBestPerformance(ex.exercise) : null;

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
    ex.todayWeight = todayWeight;
    ex.todayReps   = todayReps;
    ex.completed   = 'yes';
    ex.lastCompletedDate = isoDate();
    clearQuickProgressSet(ex);
    save();
    closeQuickPanel();
    renderHome();
    if (isNewPR) {
      showPRCelebration(ex.exercise, prevBest, todayWeight, todayReps);
    } else {
      toast('✅ ' + ex.exercise + ' afsluttet (' + total + ' sæt)!');
    }
  } else {
    setQuickProgressSet(ex, quickSetCurrent);
    updateQPSetUI();
    if (isNewPR) {
      showPRCelebration(ex.exercise, prevBest, todayWeight, todayReps, setNumber, total);
    } else {
      toast('📝 Sæt ' + setNumber + '/' + total + ' logget');
    }
  }

  startRestTimer(cfg.restDuration || 90, () => {});

  if (cfg.url) {
    try { await api({ action: API_ACTIONS.LOG_WORKOUT, entry: logEntry }); logEntry.synced = true; save(); } catch(e) {}
  }
}

// ══════════════════════════════════════════════════════════════════
//  SYNC WITH GOOGLE SHEET
// ══════════════════════════════════════════════════════════════════
export async function syncAll() {
  if (!cfg.url) { toast('⚠️ Angiv Apps Script URL under Indstillinger'); return; }
  spinner(true);
  try {
    const unsyncedEx  = exercises.filter(e => !e.synced);
    const unsyncedLog = logEntries.filter(e => !e.synced);
    if (unsyncedEx.length)  await api({ action: API_ACTIONS.IMPORT_EXERCISES, rows: unsyncedEx });
    if (unsyncedLog.length) await api({ action: API_ACTIONS.IMPORT_LOG,       rows: unsyncedLog });

    const [exRes, logRes] = await Promise.all([
      apiFetch(apiGetUrl(cfg.url, API_ACTIONS.LIST_EXERCISES, cfg.secret)),
      apiFetch(apiGetUrl(cfg.url, API_ACTIONS.LIST_LOG, cfg.secret))
    ]);
    if (exRes.status === 'ok')  { setExercises(exRes.exercises || []); }
    if (logRes.status === 'ok') { setLogEntries(logRes.entries || []); }
    save();
    renderHome(); renderLog();
    toast('✅ Synkroniseret!');
  } catch(e) {
    toast('⚠️ Synk fejlede: ' + e.message);
  }
  spinner(false);
}
