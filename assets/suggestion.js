'use strict';

import { exercises, logEntries, deriveDateOnly, MS_PER_DAY, esc } from './state.js';

// ══════════════════════════════════════════════════════════════════
//  SMART DAY SUGGESTION
// ══════════════════════════════════════════════════════════════════
const BUFFER_DAYS_SET        = new Set(['3', '9']);
const LOW_PRIORITY_DAYS      = new Set(['H', 'h']);
const NEVER_LOGGED_STALENESS = Infinity;
const LOW_PRIORITY_WEIGHT    = 0.25;
const BUFFER_DAY_WEIGHT      = 0.45;

/** Days since the exercise was last logged (0 = today, NEVER_LOGGED_STALENESS if never). */
export function exStaleness(exerciseName) {
  const todayMidnightMs = new Date().setHours(0, 0, 0, 0);
  let latest = null;
  for (const e of logEntries) {
    if (e.exercise === exerciseName) {
      const dateStr = deriveDateOnly(e.date);
      if (!dateStr) continue;
      const d = new Date(dateStr + 'T00:00:00').getTime();
      if (latest === null || d > latest) latest = d;
    }
  }
  return latest === null ? NEVER_LOGGED_STALENESS : (todayMidnightMs - latest) / MS_PER_DAY;
}

/**
 * Scores every day based on how long overdue its exercises are.
 * Returns { primaryDay, backups } or null when no exercises exist.
 */
export function suggestDay() {
  if (!exercises.length) return null;
  const allDays = [...new Set(exercises.map(e => String(e.day)).filter(Boolean))];
  if (!allDays.length) return null;

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
    .filter(({ staleness }) => staleness > 0)
    .map(b => b.ex);

  return { primaryDay, backups };
}

export function renderSuggestion() {
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
