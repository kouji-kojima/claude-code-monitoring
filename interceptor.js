// Runs in page's MAIN world (document_start) — can intercept fetch & XHR freely.
(function () {
  'use strict';

  const POST     = (usage) => window.dispatchEvent(new CustomEvent('__cco_usage', { detail: usage }));
  const POST_ORG = (id)    => window.dispatchEvent(new CustomEvent('__cco_orgid', { detail: id }));
  let orgIdSent = false;

  // ── Extract org ID from any intercepted URL ──────────────────────────────────
  function maybeExtractOrgId(url) {
    if (orgIdSent) return;
    const m = url.match(/\/organizations\/([0-9a-f-]{36})\//i);
    if (m) { orgIdSent = true; POST_ORG(m[1]); }
  }

  // ── Fetch interceptor ────────────────────────────────────────────────────────

  const _fetch = window.fetch.bind(window);
  window.fetch = async function (...args) {
    const res = await _fetch(...args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url ?? '');
      maybeExtractOrgId(url);
      if (!/\.(js|css|png|jpg|webp|woff2?|svg|ico)(\?|$)/i.test(url)) {
        res.clone().text().then(t => tryParse(url, t)).catch(() => {});
      }
    } catch (_) {}
    return res;
  };

  // ── XHR interceptor ──────────────────────────────────────────────────────────

  const _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._cco_url = url;
    maybeExtractOrgId(url);
    this.addEventListener('load', function () {
      try { tryParse(this._cco_url || '', this.responseText); } catch (_) {}
    });
    return _open.call(this, method, url, ...rest);
  };

  // ── Parser / extractor ───────────────────────────────────────────────────────

  function tryParse(url, text) {
    // Log raw response BEFORE any filtering
    console.log('[CCO] raw:', url, '|', text ? text.substring(0, 80) : '(empty)');
    if (!text || (text[0] !== '{' && text[0] !== '[')) return;
    let data;
    try { data = JSON.parse(text); } catch (_) { return; }

    console.log('[CCO] API response:', url, data);

    const found = extract(data, 0);
    if (found && (found.session || found.weekly || found.routine)) {
      console.log('[CCO] usage found:', found);
      POST(found);
    }
  }

  // keywords for matching field names (lowercase)
  const S_KEYS  = ['session', 'current_session', 'currentsession', 'daily'];
  const W_KEYS  = ['weekly', 'all_models', 'allmodels', 'allmodel', 'week'];
  const R_KEYS  = ['routine', 'routines', 'automation', 'scheduled'];
  const PCT_KEYS  = ['percent', 'percentage', 'used_percent', 'usedpercent',
                     'usage_percent', 'usagepercent', 'fraction', 'ratio',
                     'consumed', 'used', 'usage'];
  const RST_KEYS  = ['reset', 'reset_at', 'resetat', 'resets_at', 'resets',
                     'expires', 'expires_at', 'expiresat', 'refresh_at',
                     'refreshat', 'next_reset', 'nextreset'];
  const LIM_KEYS  = ['limit', 'max', 'total', 'allowed', 'quota', 'maximum'];
  const CNT_KEYS  = ['used', 'count', 'executed', 'runs', 'completed'];

  function lc(k) { return k.toLowerCase().replace(/_/g, ''); }

  function pickVal(obj, keys) {
    for (const [k, v] of Object.entries(obj)) {
      if (keys.some(kw => lc(k).includes(lc(kw)))) return v;
    }
    return undefined;
  }

  function toPercent(v) {
    if (typeof v === 'number') {
      if (v > 1 && v <= 100) return Math.round(v);
      if (v >= 0 && v <= 1)  return Math.round(v * 100);
    }
    if (typeof v === 'string') {
      const m = v.match(/^(\d+(\.\d+)?)\s*%?$/);
      if (m) { const n = parseFloat(m[1]); return n <= 1 ? Math.round(n * 100) : Math.round(n); }
    }
    return null;
  }

  function fmtReset(v) {
    if (!v) return '';
    const d = typeof v === 'number'
      ? new Date(v > 1e10 ? v : v * 1000)
      : new Date(v);
    if (isNaN(d)) return String(v);
    const diff = d - Date.now();
    if (diff < 0) return 'まもなくリセット';
    const h = Math.floor(diff / 3_600_000);
    const m = Math.floor((diff % 3_600_000) / 60_000);
    return h > 0 ? `${h}時間${m}分後にリセット` : `${m}分後にリセット`;
  }

  function parseSection(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    // Direct percent field
    const pv = pickVal(obj, PCT_KEYS);
    const pct = pv !== undefined ? toPercent(pv) : null;
    const rv = pickVal(obj, RST_KEYS);
    return pct !== null ? { pct, reset: fmtReset(rv) } : null;
  }

  function parseRoutine(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const used  = pickVal(obj, CNT_KEYS);
    const limit = pickVal(obj, LIM_KEYS);
    if (typeof used === 'number' && typeof limit === 'number')
      return `${used} / ${limit}`;
    // percent only
    const pv = pickVal(obj, PCT_KEYS);
    const pct = pv !== undefined ? toPercent(pv) : null;
    if (pct !== null) return `${pct}%`;
    return null;
  }

  function extract(data, depth) {
    if (depth > 10 || !data || typeof data !== 'object') return null;

    // If it's an array, search each element
    if (Array.isArray(data)) {
      for (const item of data) {
        const r = extract(item, depth + 1);
        if (r) return r;
      }
      return null;
    }

    let session = null, weekly = null, routine = null;

    for (const [k, v] of Object.entries(data)) {
      const lk = lc(k);
      if (S_KEYS.some(kw => lk.includes(lw(kw)))) {
        session = parseSection(v) ?? session;
      }
      if (W_KEYS.some(kw => lk.includes(lw(kw)))) {
        weekly = parseSection(v) ?? weekly;
      }
      if (R_KEYS.some(kw => lk.includes(lw(kw)))) {
        routine = parseRoutine(v) ?? routine;
      }
    }

    if (session || weekly || routine) return { session, weekly, routine };

    // Recurse into children
    for (const v of Object.values(data)) {
      if (v && typeof v === 'object') {
        const r = extract(v, depth + 1);
        if (r) return r;
      }
    }
    return null;
  }

  function lw(s) { return s.replace(/_/g, ''); }
})();
