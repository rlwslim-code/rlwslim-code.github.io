'use strict';
// Preserve strict same-origin checks, while recognizing both official production domains.
function allowedOrigin(origin, config) {
  if (typeof origin !== 'string' || !origin) return false;
  const expected = typeof config?.base === 'string' ? config.base : '';
  const normalized = value => { try { const url = new URL(value); return url.origin === value.replace(/\/$/, '') ? url.origin : null; } catch { return null; } };
  const submitted = normalized(origin);
  if (!submitted) return false;
  if (submitted === normalized(expected)) return true;
  return config?.production === true && (submitted === 'https://www.grimwear.store' || submitted === 'https://grimwear.store');
}
module.exports = { allowedOrigin };
