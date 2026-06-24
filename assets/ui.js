'use strict';

// ══════════════════════════════════════════════════════════════════
//  UI HELPERS
// ══════════════════════════════════════════════════════════════════

export function toast(msg, ms = 2500) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), ms);
}

export function spinner(on) {
  document.getElementById('spinner').style.display = on ? 'flex' : 'none';
}

export function showScreen(id) {
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
  document.getElementById('btn-newday').style.display  = id === 'screen-home' ? '' : 'none';
  document.getElementById('btn-refresh').style.display = id === 'screen-settings' ? 'none' : '';
  if (id !== 'screen-home' && (!history.state || history.state.screen !== id)) {
    history.pushState({ screen: id }, '');
  }
}

// ══════════════════════════════════════════════════════════════════
//  PR CELEBRATION POPUP
// ══════════════════════════════════════════════════════════════════

function formatPerf(weight, reps) {
  if (weight > 0) return `${weight} kg × ${reps} reps`;
  return `${reps} reps`;
}

export function showPRCelebration(exerciseName, prevBest, newWeight, newReps, setNumber = null, totalSets = null) {
  const popup = document.getElementById('pr-popup');
  if (!popup) return;

  const setInfo = setNumber !== null && totalSets !== null
    ? ` (sæt ${setNumber}/${totalSets})`
    : '';

  document.getElementById('pr-popup-exercise').textContent = exerciseName + setInfo;
  document.getElementById('pr-popup-new').textContent = formatPerf(newWeight, newReps);

  const prevEl = document.getElementById('pr-popup-prev');
  if (prevBest) {
    prevEl.textContent = formatPerf(prevBest.todayWeight, prevBest.todayReps);
    document.getElementById('pr-popup-prev-row').style.display = '';
  } else {
    document.getElementById('pr-popup-prev-row').style.display = 'none';
  }

  popup.classList.add('show');
}

export function closePRPopup() {
  const popup = document.getElementById('pr-popup');
  if (popup) popup.classList.remove('show');
}
