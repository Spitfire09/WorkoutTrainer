import { describe, test, expect, beforeEach } from '@jest/globals';
import { openDetails } from '../assets/exercises.js';

function setupDetailsDom() {
  document.body.innerHTML = `
    <div id="toast"></div>
    <div id="spinner"></div>
    <div id="topbar-title"></div>
    <button id="btn-newday"></button>
    <button id="btn-refresh"></button>
    <div id="topnav"><button data-screen="screen-details"></button></div>
    <div id="screen-home" class="screen"></div>
    <div id="screen-details" class="screen"></div>
    <input id="det-exercise" />
    <input id="det-type" />
    <input id="det-category" />
    <input id="det-musclegroup" />
    <input id="det-day" />
    <input id="det-set" />
    <input id="det-rpe" />
    <input id="det-lastweight" />
    <input id="det-todayweight" />
    <input id="det-lastreps" />
    <input id="det-todayreps" />
    <textarea id="det-description"></textarea>
    <input id="det-active" type="checkbox" />
    <input id="det-exrxurl" />
    <a id="det-exrx-link" href="#"></a>
  `;
}

describe('exercise link handling', () => {
  beforeEach(() => {
    setupDetailsDom();
    history.replaceState(null, '', '/');
  });

  test('openDetails keeps link button active for non-ExRx URLs', () => {
    openDetails({
      exercise: 'Bench Press',
      exRxUrl: 'https://www.youtube.com/watch?v=demo'
    });

    const link = document.getElementById('det-exrx-link');
    expect(link.href).toBe('https://www.youtube.com/watch?v=demo');
    expect(link.style.pointerEvents).toBe('');
    expect(link.style.opacity).toBe('1');
  });

  test('link button normalizes non-ExRx URLs without scheme while typing', () => {
    openDetails({
      exercise: 'Squat',
      exRxUrl: ''
    });

    const input = document.getElementById('det-exrxurl');
    input.oninput({ target: { value: 'example.com/video' } });

    const link = document.getElementById('det-exrx-link');
    expect(link.href).toBe('https://example.com/video');
    expect(link.style.pointerEvents).toBe('');
  });

  test('link button stays disabled for unsafe protocols', () => {
    openDetails({
      exercise: 'Deadlift',
      exRxUrl: 'javascript:alert(1)'
    });

    const link = document.getElementById('det-exrx-link');
    expect(link.getAttribute('href')).toBe('#');
    expect(link.style.pointerEvents).toBe('none');
    expect(link.style.opacity).toBe('0.35');
  });
});
