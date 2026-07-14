'use strict';

import { DEFAULTS, API_ACTIONS } from './schema.js';
import {
  exercises, logEntries, setLogEntries, cfg, save, uid, esc,
  deriveDateOnly, normalizeTimeOnly, logEntrySortValue,
  MS_PER_DAY, PROGRESSION_INCREMENT, PROGRESSION_STREAK, STAGNATION_DAYS
} from './state.js';
import { api } from './api.js';
import { toast } from './ui.js';

// ══════════════════════════════════════════════════════════════════
//  PERSONAL RECORD DETECTION
// ══════════════════════════════════════════════════════════════════
export function getPersonalRecord(exerciseName) {
  const vals = logEntries
    .filter(e => e.exercise === exerciseName && e.todayWeight > 0)
    .map(e => e.todayWeight);
  return vals.length ? Math.max(...vals) : 0;
}

export function getPerformanceScore(weight, reps) {
  const safeWeight = Number(weight) || 0;
  const safeReps = Number(reps) || 0;
  if (safeWeight <= 0) return safeReps > 0 ? safeReps : 0;
  return +(safeWeight * (1 + safeReps / 30)).toFixed(1);
}

export function getBestPerformance(exerciseName) {
  return logEntries
    .filter(e => e.exercise === exerciseName && (e.todayWeight > 0 || e.todayReps > 0))
    .map(e => ({
      entry: e,
      score: getPerformanceScore(e.todayWeight, e.todayReps),
      date: deriveDateOnly(e.date) || ''
    }))
    .filter(item => item.score > 0)
    .sort((a, b) =>
      b.score - a.score ||
      b.entry.todayWeight - a.entry.todayWeight ||
      b.entry.todayReps - a.entry.todayReps ||
      logEntrySortValue(b.entry) - logEntrySortValue(a.entry)
    )[0]?.entry || null;
}

export function checkPR(exerciseName, weight, reps = 0) {
  const score = getPerformanceScore(weight, reps);
  if (!score) return false;
  const best = getBestPerformance(exerciseName);
  if (!best) return true;
  return score > getPerformanceScore(best.todayWeight, best.todayReps);
}

// ══════════════════════════════════════════════════════════════════
//  PROGRESSIVE OVERLOAD HELPERS
// ══════════════════════════════════════════════════════════════════
export function getProgressionHint(ex) {
  const byDate = {};
  logEntries
    .filter(e => e.exercise === ex.exercise && e.todayWeight > 0 && deriveDateOnly(e.date))
    .forEach(e => {
      const d = deriveDateOnly(e.date);
      if (!byDate[d] || getPerformanceScore(e.todayWeight, e.todayReps) > getPerformanceScore(byDate[d].weight, byDate[d].reps)) {
        byDate[d] = { weight: e.todayWeight, reps: e.todayReps || 0 };
      }
    });
  const sessions = Object.entries(byDate)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, PROGRESSION_STREAK);
  if (sessions.length < PROGRESSION_STREAK) return null;
  const targetScore = getPerformanceScore(ex.lastWeight, ex.lastReps);
  const allMet = sessions.every(([, s]) =>
    getPerformanceScore(s.weight, s.reps) >= targetScore
  );
  if (!allMet) return null;
  return +(ex.lastWeight + PROGRESSION_INCREMENT).toFixed(1);
}

export function isStagnant(exName) {
  const prEntry = getBestPerformance(exName);
  if (!prEntry) return false;
  const prDate = deriveDateOnly(prEntry.date);
  if (!prDate) return false;
  const days = (Date.now() - new Date(prDate + 'T00:00:00').getTime()) / MS_PER_DAY;
  return days > STAGNATION_DAYS;
}

// ══════════════════════════════════════════════════════════════════
//  LOG SCREEN
// ══════════════════════════════════════════════════════════════════
export function renderLog() {
  const q    = document.getElementById('log-search').value.toLowerCase();
  const list = document.getElementById('log-list');
  list.innerHTML = '';

  let filtered = logEntries;
  if (q) filtered = filtered.filter(e =>
    (e.exercise||'').toLowerCase().includes(q) ||
    (e.type||'').toLowerCase().includes(q) ||
    (e.date||'').includes(q));

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
        <p>${esc(deriveDateOnly(entry.date) || entry.date)} &nbsp;·&nbsp; Dag: ${esc(String(entry.day))} &nbsp;·&nbsp; ${esc(entry.type)}</p>
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
  setLogEntries(logEntries.filter(e => e.entryId !== entryId));
  save();
  if (cfg.url) {
    try { await api({ action: API_ACTIONS.DELETE_LOG, entryId }); } catch(e) {}
  }
  renderLog();
  toast('Log-post slettet');
}

// ══════════════════════════════════════════════════════════════════
//  IMPORT / NORMALIZE HELPERS
// ══════════════════════════════════════════════════════════════════
export function normalizeExercise(e) {
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
    active:            e.active !== undefined ? (e.active !== false && e.active !== 'false' && e.active !== 'FALSE') : (e.Active !== undefined ? (e.Active !== false && e.Active !== 'false' && e.Active !== 'FALSE') : DEFAULTS.exercise.active),
    exRxUrl:           e.exRxUrl           || e.ExRxUrl          || DEFAULTS.exercise.exRxUrl,
    synced:            false
  };
}

export function normalizeLogEntry(e) {
  const sourceDateOnly = e.dateOnly || e.DateOnly || '';
  const sourceTimeOnly = normalizeTimeOnly(e.timeOnly || e.TimeOnly || '');
  const rawDate  = e.date || e.Date || (sourceDateOnly ? `${sourceDateOnly} ${sourceTimeOnly || '00:00'}` : (sourceTimeOnly ? `1970-01-01 ${sourceTimeOnly}` : ''));
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
    set:         e.set         ?? e.Set       ?? DEFAULTS.log.set,
    setNumber:   e.setNumber   ?? e.SetNumber ?? DEFAULTS.log.setNumber,
    totalSets:   e.totalSets   ?? DEFAULTS.log.totalSets,
    muscleGroup: e.muscleGroup || e.MuscleGroup || DEFAULTS.log.muscleGroup,
    isPR:        e.isPR        ?? DEFAULTS.log.isPR,
    synced:      false
  };
}

export function mergeExercises(incoming) {
  const existingById = new Map(exercises.map(e => [e.entryId, e]));
  let added = 0;
  let updatedUrl = 0;
  incoming.forEach(raw => {
    const ex = normalizeExercise(raw);
    const existing = existingById.get(ex.entryId);
    if (!existing) {
      exercises.push(ex);
      existingById.set(ex.entryId, ex);
      added++;
      return;
    }
    if (!existing.exRxUrl && ex.exRxUrl) {
      existing.exRxUrl = ex.exRxUrl;
      updatedUrl++;
    }
  });
  return { added, updatedUrl };
}

export function mergeLog(incoming) {
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

export function readJsonFile(file) {
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
