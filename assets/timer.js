'use strict';

import { cfg, DB_KEY_REST_TIMER } from './state.js';

// ══════════════════════════════════════════════════════════════════
//  REST TIMER
// ══════════════════════════════════════════════════════════════════
let restTimerInterval  = null;
let restTimerRemaining = 0;
let restTimerTotal     = 90;
let restTimerEndAt     = 0;
let restTimerOnDone    = null;
let restTimerNotified  = false;
const TIMER_RING_RADIUS    = 88;
const RING_CIRCUMFERENCE   = 2 * Math.PI * TIMER_RING_RADIUS;
const MAX_REST_DURATION    = 600;

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
  return Math.ceil((restTimerEndAt - now) / 1000);
}

function updateRestTimerActionBtn(remaining) {
  const actionBtn = document.getElementById('btn-timer-skip');
  const isOvertime = remaining <= 0;
  actionBtn.textContent = isOvertime ? 'Fortsæt ›' : 'Spring over ›';
  actionBtn.classList.toggle('btn-danger', !isOvertime);
  actionBtn.classList.toggle('btn-success', isOvertime);
}

function updateRestTimerUI(remaining = getRestTimerRemaining()) {
  const ringFg = document.getElementById('timer-ring-fg');
  const timeEl = document.getElementById('timer-time');
  const safeTotal = Math.max(restTimerTotal, 1);
  const clampedRemaining = Math.max(0, Math.min(safeTotal, remaining));
  const progress = clampedRemaining / safeTotal;

  timeEl.textContent = remaining;
  ringFg.style.strokeDasharray = RING_CIRCUMFERENCE;
  ringFg.style.strokeDashoffset = RING_CIRCUMFERENCE * (1 - progress);
  updateRestTimerActionBtn(remaining);
}

function completeRestTimer() {
  clearInterval(restTimerInterval);
  restTimerInterval = null;
  restTimerRemaining = 0;
  restTimerNotified = false;
  clearRestTimerState();
  updateRestTimerUI(0);
  document.getElementById('rest-timer-overlay').classList.remove('show');
  if (typeof restTimerOnDone === 'function') restTimerOnDone();
  restTimerOnDone = null;
}

function notifyRestTimerFinished() {
  if (restTimerNotified) return;
  restTimerNotified = true;
  if (document.visibilityState !== 'visible') return;
  if (cfg.timerSound !== false) beep();
  if (navigator.vibrate) navigator.vibrate([300, 100, 300, 100, 400]);
}

export function syncRestTimer(onDone) {
  if (!restTimerEndAt) return;
  if (typeof onDone === 'function') restTimerOnDone = onDone;
  restTimerRemaining = getRestTimerRemaining();
  updateRestTimerUI(restTimerRemaining);
  if (restTimerRemaining <= 0) notifyRestTimerFinished();
}

export function startRestTimer(seconds, onDone) {
  clearInterval(restTimerInterval);
  restTimerTotal     = seconds;
  restTimerEndAt     = Date.now() + (seconds * 1000);
  restTimerRemaining = seconds;
  restTimerNotified  = false;
  restTimerOnDone    = typeof onDone === 'function' ? onDone : null;
  saveRestTimerState();

  const overlay = document.getElementById('rest-timer-overlay');
  overlay.classList.add('show');
  syncRestTimer(onDone);

  restTimerInterval = setInterval(() => syncRestTimer(onDone), 1000);
}

export function skipRestTimer() {
  completeRestTimer();
}

export function addRestTime(extraSeconds) {
  restTimerRemaining = Math.min(getRestTimerRemaining() + extraSeconds, MAX_REST_DURATION);
  restTimerTotal     = Math.max(restTimerTotal, restTimerRemaining);
  restTimerEndAt     = Date.now() + (restTimerRemaining * 1000);
  saveRestTimerState();
  syncRestTimer();
}

export function restoreRestTimer() {
  let state = null;
  try { state = JSON.parse(localStorage.getItem(DB_KEY_REST_TIMER) || 'null'); } catch(e) {}
  if (!state || !state.endAt) return;

  restTimerEndAt = Number(state.endAt) || 0;
  restTimerTotal = Math.min(Math.max(Number(state.total) || cfg.restDuration || 90, 1), MAX_REST_DURATION);

  if (!restTimerEndAt) {
    clearRestTimerState();
    return;
  }
  restTimerNotified = false;
  restTimerOnDone = null;

  document.getElementById('rest-timer-overlay').classList.add('show');
  syncRestTimer();
  if (getRestTimerRemaining() <= 0) notifyRestTimerFinished();
  clearInterval(restTimerInterval);
  restTimerInterval = setInterval(() => syncRestTimer(), 1000);
}
