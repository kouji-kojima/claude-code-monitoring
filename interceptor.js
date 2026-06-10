// Runs in page's MAIN world (document_start) — can intercept fetch & XHR freely.
(function () {
  'use strict';

  const POST       = (usage) => window.dispatchEvent(new CustomEvent('__cco_usage',  { detail: usage }));
  const POST_ORG   = (id)    => window.dispatchEvent(new CustomEvent('__cco_orgid',  { detail: id }));
  const POST_MODEL = (model) => window.dispatchEvent(new CustomEvent('__cco_model',  { detail: model }));
  let orgIdSent = false;

  function maybeExtractOrgId(url) {
    if (orgIdSent) return;
    const m = url.match(/\/organizations\/([0-9a-f-]{36})\//i);
    if (m) { orgIdSent = true; POST_ORG(m[1]); }
  }

  function maybeExtractModel(body) {
    if (!body || typeof body !== 'string') return;
    try {
      const d = JSON.parse(body);
      if (d && typeof d.model === 'string' && d.model.includes('claude')) POST_MODEL(d.model);
    } catch (_) {}
  }

  // ── Fetch interceptor ────────────────────────────────────────────────────────

  const _fetch = window.fetch.bind(window);
  window.fetch = async function (...args) {
    try {
      const init = args[1];
      if (init) maybeExtractModel(init.body);
    } catch (_) {}

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

  const _send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body) {
    maybeExtractModel(body);
    return _send.call(this, body);
  };

  // ── Parser / extractor ───────────────────────────────────────────────────────

  function tryParse(url, text) {
    if (!text || (text[0] !== '{' && text[0] !== '[')) return;
    let data;
    try { data = JSON.parse(text); } catch (_) { return; }

    const found = extract(data, 0);
    if (found && (found.session || found.weekly)) {
      POST(found);
    }
  }

  // ── Window-state checker (Next.js / React hydration data) ───────────────────

  function checkWindowState() {
    try {
      const nd = window.__NEXT_DATA__;
      if (nd) tryParse('__NEXT_DATA__', JSON.stringify(nd));
    } catch (_) {}
    try {
      const qs = window.__reactQueryState__ || window.__REACT_QUERY_STATE__;
      if (qs) tryParse('__reactQueryState__', JSON.stringify(qs));
    } catch (_) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkWindowState);
  } else {
    setTimeout(checkWindowState, 500);
  }

  const S_KEYS = ['session', 'currentsession', 'daily', 'billingperiod', 'currentperiod', 'thisperiod',
                   'fivehour', 'five'];
  const W_KEYS = ['weekly', 'allmodels', 'allmodel', 'week', 'planperiod', 'planusage',
                   'sevenday', 'seven'];
  const PCT_KEYS  = ['percent', 'percentage', 'usedpercent', 'usagepercent',
                     'fraction', 'ratio', 'consumed', 'utilization', 'saturation'];
  const RST_KEYS  = ['reset', 'resetat', 'resets', 'expiresat', 'refreshat',
                     'nextreset', 'periodend', 'until', 'endat'];
  const LIM_KEYS  = ['limit', 'max', 'total', 'allowed', 'quota', 'maximum',
                     'messagelimit', 'tokenlimit', 'messageslimit'];
  const CNT_KEYS  = ['used', 'count', 'executed', 'runs', 'completed',
                     'messagesused', 'tokensused', 'messagecount'];

  function lc(k) { return k.toLowerCase().replace(/_/g, ''); }

  function pickVal(obj, keys) {
    for (const [k, v] of Object.entries(obj)) {
      if (keys.some(kw => lc(k).includes(kw))) return v;
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
    const pv = pickVal(obj, PCT_KEYS);
    let pct = pv !== undefined ? toPercent(pv) : null;
    if (pct === null) {
      const used  = pickVal(obj, CNT_KEYS);
      const total = pickVal(obj, LIM_KEYS);
      if (typeof used === 'number' && typeof total === 'number' && total > 0)
        pct = Math.round((used / total) * 100);
    }
    const rv = pickVal(obj, RST_KEYS);
    return pct !== null ? { pct, reset: fmtReset(rv) } : null;
  }

  function extract(data, depth) {
    if (depth > 10 || !data || typeof data !== 'object') return null;
    if (Array.isArray(data)) {
      for (const item of data) {
        const r = extract(item, depth + 1);
        if (r) return r;
      }
      return null;
    }
    let session = null, weekly = null;
    for (const [k, v] of Object.entries(data)) {
      const lk = lc(k);
      if (S_KEYS.some(kw => lk.includes(kw))) session = parseSection(v) ?? session;
      if (W_KEYS.some(kw => lk.includes(kw))) weekly  = parseSection(v) ?? weekly;
    }
    if (session || weekly) return { session, weekly };
    for (const v of Object.values(data)) {
      if (v && typeof v === 'object') {
        const r = extract(v, depth + 1);
        if (r) return r;
      }
    }
    return null;
  }
})();
