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
