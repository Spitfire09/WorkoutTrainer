'use strict';

import { exercises, logEntries, esc, sortDayValues, deriveDateOnly, MS_PER_HOUR, linReg } from './state.js';
import { getProgressionHint, isStagnant } from './log.js';
import { showScreen } from './ui.js';

// ══════════════════════════════════════════════════════════════════
//  PROGRESSION CHART
// ══════════════════════════════════════════════════════════════════
let chartExerciseName = '';

export function openChart(exerciseName) {
  if (!exerciseName) return;
  chartExerciseName = exerciseName;
  document.getElementById('chart-exercise-title').textContent = exerciseName;
  showScreen('screen-chart');
  renderChart();
}

export function renderChart() {
  const name   = chartExerciseName;
  const canvas = document.getElementById('chart-canvas');
  const ctx    = canvas.getContext('2d');

  const entries = logEntries
    .filter(e => e.exercise === name && deriveDateOnly(e.date))
    .sort((a, b) => deriveDateOnly(a.date).localeCompare(deriveDateOnly(b.date)));

  const byDate = {};
  entries.forEach(e => {
    const d = deriveDateOnly(e.date);
    if (!byDate[d] || e.todayWeight > byDate[d].weight) {
      byDate[d] = { date: d, weight: e.todayWeight, reps: e.todayReps, isPR: !!e.isPR };
    }
  });
  const data = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));

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

  const best1RM = entries.reduce((best, e) => {
    if (!e.todayWeight || !e.todayReps) return best;
    return Math.max(best, e.todayWeight * (1 + e.todayReps / 30));
  }, 0);

  const volByDate = {};
  entries.forEach(e => {
    const d = deriveDateOnly(e.date);
    volByDate[d] = (volByDate[d] || 0) + (e.todayWeight || 0) * (e.todayReps || 0);
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

  recentEl.innerHTML = entries.slice(0, 8).map(e => `
    <div class="log-card" style="margin-bottom:6px">
      <div class="log-card-info">
        <h3 style="font-size:13px">${esc(deriveDateOnly(e.date))} ${e.isPR ? '<span class="badge-pr">🏆 PR</span>' : ''}</h3>
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
    ctx.fillStyle = weights[0] >= maxW ? '#fbbf24' : '#22d3ee';
    ctx.beginPath(); ctx.arc(xPos(0), yPos(weights[0]), 6, 0, Math.PI * 2); ctx.fill();
  } else {
    const areaGrad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + cH);
    areaGrad.addColorStop(0, 'rgba(34,211,238,0.22)');
    areaGrad.addColorStop(1, 'rgba(34,211,238,0)');
    ctx.fillStyle = areaGrad;
    ctx.beginPath();
    ctx.moveTo(xPos(0), PAD.top + cH);
    data.forEach((d, i) => ctx.lineTo(xPos(i), yPos(d.weight)));
    ctx.lineTo(xPos(n - 1), PAD.top + cH);
    ctx.closePath(); ctx.fill();

    ctx.strokeStyle = 'rgba(245,158,11,0.65)'; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    data.forEach((d, i) => {
      const y = yVolPos(volData[i]);
      if (i === 0) ctx.moveTo(xPos(0), y); else ctx.lineTo(xPos(i), y);
    });
    ctx.stroke();
    ctx.setLineDash([]);

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

    ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
    ctx.beginPath();
    data.forEach((d, i) => i === 0 ? ctx.moveTo(xPos(i), yPos(d.weight)) : ctx.lineTo(xPos(i), yPos(d.weight)));
    ctx.stroke();

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
export function renderAnalyse() {
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
        .map(e => ({ e, _d: deriveDateOnly(e.date) || '' }))
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

  // ── 2. Stagnation summary ────────────────────────────────────
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
    .filter(e => e.muscleGroup && deriveDateOnly(e.date))
    .map(e => ({ e, _d: deriveDateOnly(e.date) }))
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
