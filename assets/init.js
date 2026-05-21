'use strict';

import { API_ACTIONS } from './schema.js';
import { cfg, exercises, logEntries, load, save, saveCfg, esc, apiGetUrl } from './state.js';
import { apiFetch } from './api.js';
import { toast, showScreen } from './ui.js';
import { renderHome, saveDetails, saveNewExercise, newDay, deleteExercise, closeQuickPanel, quickDone, quickLogSet, syncAll } from './exercises.js';
import { renderLog, mergeExercises, mergeLog, readJsonFile } from './log.js';
import { renderAnalyse, openChart } from './analysis.js';
import { restoreRestTimer, skipRestTimer, addRestTime, syncRestTimer } from './timer.js';
import { currentEx } from './state.js';

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
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const reg of registrations) {
        await reg.unregister();
      }
    }
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
    const ping = await apiFetch(url);
    if (!ping || ping.status !== 'ok') throw new Error('Uventet svar fra server');
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

  // Suggestion bar
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
  history.replaceState({ screen: 'screen-home' }, '');

  window.addEventListener('popstate', () => {
    const timerOverlay = document.getElementById('rest-timer-overlay');
    if (timerOverlay.classList.contains('show')) {
      skipRestTimer();
      history.pushState({ screen: 'rest-timer' }, '');
      return;
    }
    const quickPanel = document.getElementById('quick-panel');
    if (quickPanel.classList.contains('open')) {
      closeQuickPanel();
      const active = document.querySelector('.screen.active')?.id || 'screen-home';
      history.pushState({ screen: active }, '');
      return;
    }
    const active = document.querySelector('.screen.active');
    if (active && active.id !== 'screen-home') {
      showScreen('screen-home');
      renderHome();
    }
    history.replaceState({ screen: 'screen-home' }, '');
  });

}); // end DOMContentLoaded
