(function () {
  'use strict';

  const _fetch = window.fetch.bind(window);

  window.fetch = async function (...args) {
    const res = await _fetch(...args);
    try {
      const url = typeof args[0] === 'string' ? args[0]
                : (args[0] && args[0].url) ? args[0].url : '';
      if (/\.(js|css|png|jpg|webp|woff2?|svg|ico)(\?|$)/i.test(url)) return res;

      const clone = res.clone();
      clone.text().then(text => {
        if (!text || (text[0] !== '{' && text[0] !== '[')) return;
        let data;
        try { data = JSON.parse(text); } catch (_) { return; }
        const usage = findUsage(data);
        if (usage) window.postMessage({ __cco: true, usage }, '*');
      }).catch(() => {});
    } catch (_) {}
    return res;
  };

  // ── Recursive usage finder ───────────────────────────────────────────────────

  const SESSION_KEYS  = ['session', 'current_session', 'currentSession'];
  const WEEKLY_KEYS   = ['weekly', 'all_models', 'allModels', 'model', 'weekly_limit'];
  const ROUTINE_KEYS  = ['routine', 'routines', 'automation'];
  const PERCENT_KEYS  = ['percent', 'percentage', 'used_percent', 'usedPercent',
                         'usage_percent', 'usagePercent', 'fraction', 'ratio'];
  const COUNT_KEYS    = ['used', 'count', 'executed', 'runs'];
  const LIMIT_KEYS    = ['limit', 'max', 'total', 'allowed', 'quota'];
  const RESET_KEYS    = ['reset', 'reset_at', 'resetAt', 'resets_at', 'resetsAt',
                         'expires', 'expires_at', 'expiresAt', 'refresh', 'refresh_at'];

  function lc(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k.toLowerCase()] = { key: k, val: v };
    return out;
  }

  function pickFirst(lcObj, keys) {
    for (const k of keys) {
      const hit = lcObj[k] ?? lcObj[k.replace(/_([a-z])/g, (_, c) => c)];
      if (hit !== undefined) return hit.val ?? hit;
    }
    return undefined;
  }

  // Try to read a percent value (0-100) from an object or number
  function toPercent(v) {
    if (typeof v === 'number') {
      if (v >= 0 && v <= 1)   return Math.round(v * 100); // fraction
      if (v >= 0 && v <= 100) return Math.round(v);
    }
    if (typeof v === 'string') {
      const m = v.match(/^(\d+(\.\d+)?)\s*%?$/);
      if (m) { const n = parseFloat(m[1]); return n <= 1 ? Math.round(n * 100) : Math.round(n); }
    }
    return null;
  }

  function toTimestamp(v) {
    if (!v) return null;
    if (typeof v === 'number') return new Date(v * 1000 > 1e12 ? v : v * 1000);
    if (typeof v === 'string') { const d = new Date(v); return isNaN(d) ? null : d; }
    return null;
  }

  function formatReset(ts) {
    if (!ts) return '';
    const diff = ts - Date.now();
    if (diff < 0) return 'まもなくリセット';
    const h = Math.floor(diff / 3_600_000);
    const m = Math.floor((diff % 3_600_000) / 60_000);
    if (h > 0) return `${h}時間${m}分後にリセット`;
    return `${m}分後にリセット`;
  }

  function extractSection(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const lco = lc(obj);
    let pct = null;
    for (const k of PERCENT_KEYS) {
      const v = pickFirst(lco, [k]);
      pct = toPercent(v);
      if (pct !== null) break;
    }
    let resetTs = null;
    for (const k of RESET_KEYS) {
      const v = pickFirst(lco, [k]);
      resetTs = toTimestamp(v);
      if (resetTs) break;
    }
    return pct !== null ? { pct, reset: formatReset(resetTs) } : null;
  }

  function extractRoutine(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const lco = lc(obj);
    const used  = pickFirst(lco, COUNT_KEYS);
    const limit = pickFirst(lco, LIMIT_KEYS);
    if (typeof used === 'number' && typeof limit === 'number') {
      return `${used} / ${limit}`;
    }
    return null;
  }

  function findUsage(data, depth = 0) {
    if (depth > 8 || !data || typeof data !== 'object') return null;

    const lco = lc(Array.isArray(data) ? {} : data);
    let session = null, weekly = null, routine = null;

    if (!Array.isArray(data)) {
      // Try to find named sections
      for (const k of SESSION_KEYS) {
        const v = pickFirst(lco, [k]);
        if (v) { session = extractSection(v); if (session) break; }
      }
      for (const k of WEEKLY_KEYS) {
        const v = pickFirst(lco, [k]);
        if (v) { weekly = extractSection(v); if (weekly) break; }
      }
      for (const k of ROUTINE_KEYS) {
        const v = pickFirst(lco, [k]);
        if (v) { routine = extractRoutine(v); if (routine) break; }
      }

      // If we found at least one metric, return partial result
      if (session || weekly || routine) return { session, weekly, routine };
    }

    // Recurse into children
    const children = Array.isArray(data) ? data : Object.values(data);
    for (const child of children) {
      if (child && typeof child === 'object') {
        const found = findUsage(child, depth + 1);
        if (found) return found;
      }
    }
    return null;
  }
})();
