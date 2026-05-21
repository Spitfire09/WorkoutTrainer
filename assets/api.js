'use strict';

import { cfg } from './state.js';

// ══════════════════════════════════════════════════════════════════
//  API COMMUNICATION
// ══════════════════════════════════════════════════════════════════

export async function apiFetch(url, opts) {
  const resp = await fetch(url, opts);
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  return resp.json();
}

export async function api(body) {
  return apiFetch(cfg.url, {
    method:  'POST',
    headers: { 'Content-Type': 'text/plain' },
    body:    JSON.stringify({ secret: cfg.secret, ...body })
  });
}
