'use strict';

import { DEFAULTS } from './schema.js';

// ══════════════════════════════════════════════════════════════════
//  CONSTANTS
// ══════════════════════════════════════════════════════════════════
export const DB_KEY_EXERCISES  = 'wt_exercises';
export const DB_KEY_LOG        = 'wt_log';
export const DB_KEY_CFG        = 'wt_config';
export const DB_KEY_REST_TIMER = 'wt_rest_timer';

export const MS_PER_DAY            = 86400000;
export const MS_PER_HOUR           = 3600000;
export const PROGRESSION_INCREMENT = 2.5;
export const PROGRESSION_STREAK    = 3;
export const STAGNATION_DAYS       = 28;

// ══════════════════════════════════════════════════════════════════
//  STATE (mutable singletons)
// ══════════════════════════════════════════════════════════════════
export let exercises  = [];
export let logEntries = [];
export let cfg        = { ...DEFAULTS.cfg };
export let currentEx  = null;

export function setExercises(val)  { exercises  = val; }
export function setLogEntries(val) { logEntries = val; }
export function setCfg(val)        { cfg        = val; }
export function setCurrentEx(val)  { currentEx  = val; }

// ══════════════════════════════════════════════════════════════════
//  PERSISTENCE
// ══════════════════════════════════════════════════════════════════
export function save() {
  localStorage.setItem(DB_KEY_EXERCISES, JSON.stringify(exercises));
  localStorage.setItem(DB_KEY_LOG,       JSON.stringify(logEntries));
}

export function load() {
  try { exercises  = JSON.parse(localStorage.getItem(DB_KEY_EXERCISES) || '[]'); } catch(e){}
  try { logEntries = JSON.parse(localStorage.getItem(DB_KEY_LOG)       || '[]'); } catch(e){}
  try { cfg        = JSON.parse(localStorage.getItem(DB_KEY_CFG)       || '{}'); } catch(e){}
  let migratedExercises = false;
  exercises.forEach(ex => {
    if (!ex.entryId) {
      ex.entryId = uid();
      migratedExercises = true;
    }
  });
  if (migratedExercises) {
    localStorage.setItem(DB_KEY_EXERCISES, JSON.stringify(exercises));
  }
  cfg.url          = cfg.url    || DEFAULTS.cfg.url;
  cfg.secret       = cfg.secret || DEFAULTS.cfg.secret;
  cfg.restDuration = cfg.restDuration ?? DEFAULTS.cfg.restDuration;
  cfg.timerSound   = cfg.timerSound   ?? DEFAULTS.cfg.timerSound;
}

export function saveCfg() {
  localStorage.setItem(DB_KEY_CFG, JSON.stringify(cfg));
}

// ══════════════════════════════════════════════════════════════════
//  UTILITY FUNCTIONS
// ══════════════════════════════════════════════════════════════════
export function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

export function isoDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function isoTime(date = new Date()) {
  return date.toTimeString().slice(0, 5);
}

export function sortDayValues(values) {
  return [...values].sort((a, b) => {
    const na = parseInt(a), nb = parseInt(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    if (!isNaN(na)) return -1;
    if (!isNaN(nb)) return 1;
    return a.localeCompare(b);
  });
}

export function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export function apiGetUrl(baseUrl, action, secret) {
  const params = new URLSearchParams({ action, secret });
  return `${baseUrl}?${params.toString()}`;
}

export function createLogEntry(ex, { todayWeight, todayReps, setNumber = null, totalSets = null, date = `${isoDate()} ${isoTime()}`, set = ex?.set ?? DEFAULTS.log.set }) {
  return {
    ...DEFAULTS.log,
    entryId: uid(),
    date,
    type: ex.type,
    exercise: ex.exercise,
    day: String(ex.day),
    lastWeight: ex.lastWeight,
    todayWeight,
    lastReps: ex.lastReps,
    todayReps,
    set,
    setNumber,
    totalSets,
    muscleGroup: ex.muscleGroup || ''
  };
}

/** Normalise date strings to ISO YYYY-MM-DD */
export function deriveDateOnly(dateStr) {
  if (!dateStr) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return dateStr.slice(0, 10);
  const euMatch = dateStr.match(/^(\d{2})-(\d{2})-(\d{4})/);
  if (euMatch) return `${euMatch[3]}-${euMatch[2]}-${euMatch[1]}`;
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return '';
}

export function normalizeTimeOnly(timeStr) {
  if (!timeStr) return '';
  const m = String(timeStr).trim().match(/(\d{1,2})[:.](\d{2})/);
  if (!m) return '';
  const h = String(Math.min(23, Math.max(0, Number(m[1])))).padStart(2, '0');
  const min = String(Math.min(59, Math.max(0, Number(m[2])))).padStart(2, '0');
  return `${h}:${min}`;
}

export function logEntrySortValue(entry) {
  const dateStr = entry.date || '';
  if (!dateStr) return 0;
  const isoMatch = dateStr.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})/);
  if (isoMatch) {
    const ts = new Date(`${isoMatch[1]}T${isoMatch[2]}:00`).getTime();
    if (!isNaN(ts)) return ts;
  }
  const euMatch = dateStr.match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{1,2}:\d{2})/);
  if (euMatch) {
    const ts = new Date(`${euMatch[3]}-${euMatch[2]}-${euMatch[1]}T${euMatch[4]}:00`).getTime();
    if (!isNaN(ts)) return ts;
  }
  const fallbackTs = new Date(dateStr).getTime();
  return isNaN(fallbackTs) ? 0 : fallbackTs;
}

/** Simple linear regression — returns { slope, intercept } for y = slope*x + intercept. */
export function linReg(values) {
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
