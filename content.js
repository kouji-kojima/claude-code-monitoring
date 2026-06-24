(function () {
  'use strict';

  if (document.getElementById('cco-host')) return;

  const CARD_W = 240;
  let shadowRoot;
  let cached = { session: null, weekly: null };
  let currentOrgId = null;
  let currentModel  = null;

  // ── Shadow DOM overlay ───────────────────────────────────────────────────────

  function buildOverlay() {
    const host = document.createElement('div');
    host.id = 'cco-host';
    host.style.cssText = [
      'position:fixed', 'top:0', 'left:8px',
      `width:${CARD_W}px`, 'z-index:2147483647', 'display:block'
    ].join(';');
    document.body.appendChild(host);

    // デフォルト位置: bottom:275px 相当を top で表現
    const defaultTop = () => window.innerHeight - 275 - (host.offsetHeight || 130);
    chrome.storage.local.get('cco_pos', ({ cco_pos }) => {
      if (cco_pos) {
        host.style.left = cco_pos.left + 'px';
        host.style.top  = cco_pos.top  + 'px';
      } else {
        host.style.top = defaultTop() + 'px';
      }
    });

    shadowRoot = host.attachShadow({ mode: 'open' });
    shadowRoot.innerHTML = `
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        #card {
          width: ${CARD_W}px;
          background: #1a1b2e;
          border: 1px solid #2e3058;
          border-radius: 10px;
          padding: 8px 12px 10px;
          box-shadow: 0 4px 18px rgba(0,0,0,0.55);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          font-size: 11px;
          color: #c8c9e8;
          user-select: none;
        }
        .hdr { display:flex; align-items:center; justify-content:space-between; margin-bottom:7px; cursor:grab; }
        .hdr:active { cursor:grabbing; }
        .title { font-size:10px; font-weight:700; color:#c8c9e8; letter-spacing:0.06em; text-transform:uppercase; }
        .toggle-btn { background:none; border:none; color:#c8c9e8; cursor:pointer; font-size:15px; line-height:1; padding:0; }
        .toggle-btn:hover { color:#ffffff; }
        .body { display:flex; flex-direction:column; gap:6px; }
        #card.min .body { display:none; }
        .row { display:flex; flex-direction:column; gap:2px; }
        .lbl { font-size:9.5px; color:#c8c9e8; }
        .bar-row { display:flex; align-items:center; gap:5px; }
        .bar { flex:1; height:4px; background:#2b2d52; border-radius:3px; overflow:hidden; }
        .fill { height:100%; border-radius:3px; background:#4f46e5; transition:width 0.4s ease; width:0%; }
        .fill.warn   { background:#d97706; }
        .fill.danger { background:#dc2626; }
        .pct { font-size:11px; font-weight:700; color:#e0e1ff; min-width:28px; text-align:right; }
        .sub { font-size:9px; color:#c8c9e8; }
        .div { height:1px; background:#252748; }
        .ts { font-size:8.5px; color:#9b9fcc; text-align:right; margin-top:5px; }
      </style>
      <div id="card">
        <div class="hdr">
          <span class="title">Claude 使用状況</span>
          <button class="toggle-btn" id="tog">−</button>
        </div>
        <div class="body">
          <div class="row">
            <span class="lbl">現在のセッション</span>
            <div class="bar-row">
              <div class="bar"><div class="fill" id="sf"></div></div>
              <span class="pct" id="sp">--%</span>
            </div>
            <span class="sub" id="sr"></span>
          </div>
          <div class="div"></div>
          <div class="row">
            <span class="lbl">週間制限（全モデル）</span>
            <div class="bar-row">
              <div class="bar"><div class="fill" id="wf"></div></div>
              <span class="pct" id="wp">--%</span>
            </div>
            <span class="sub" id="wr"></span>
          </div>
          <div class="ts" id="ts">待機中...</div>
        </div>
      </div>`;

    let min = false;
    const card = shadowRoot.getElementById('card');
    const tog  = shadowRoot.getElementById('tog');
    chrome.storage.local.get('cco_min', ({ cco_min }) => {
      if (cco_min) { min = true; card.classList.add('min'); tog.textContent = '+'; }
    });
    tog.addEventListener('click', () => {
      min = !min;
      card.classList.toggle('min', min);
      tog.textContent = min ? '+' : '−';
      chrome.storage.local.set({ cco_min: min });
    });

    // ── ドラッグ ──────────────────────────────────────────────────────────────
    let dragging = false, dragOx = 0, dragOy = 0;
    const hdr = shadowRoot.querySelector('.hdr');

    hdr.addEventListener('mousedown', (e) => {
      if (e.target === tog) return; // 最小化ボタンはドラッグ対象外
      dragging = true;
      dragOx = e.clientX - host.offsetLeft;
      dragOy = e.clientY - host.offsetTop;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const maxX = window.innerWidth  - CARD_W;
      const maxY = window.innerHeight - host.offsetHeight;
      host.style.left = Math.max(0, Math.min(maxX, e.clientX - dragOx)) + 'px';
      host.style.top  = Math.max(0, Math.min(maxY, e.clientY - dragOy)) + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      chrome.storage.local.set({ cco_pos: {
        top:  parseInt(host.style.top),
        left: parseInt(host.style.left),
      }});
    });
  }

  // ── Apply data ───────────────────────────────────────────────────────────────

  function barClass(p) { return p >= 90 ? 'danger' : p >= 70 ? 'warn' : ''; }

  function setBar(fillId, pctId, pct) {
    const f = shadowRoot.getElementById(fillId);
    const p = shadowRoot.getElementById(pctId);
    if (!f || !p) return;
    f.style.width = pct + '%';
    f.className = 'fill ' + barClass(pct);
    p.textContent = pct + '%';
  }

  function applyData({ session, weekly }) {
    if (session != null) {
      setBar('sf', 'sp', session.pct);
      const sr = shadowRoot.getElementById('sr');
      if (sr) sr.textContent = session.reset || '';
      scheduleResetPoll('session', session.resetAt);
    }
    if (weekly != null) {
      setBar('wf', 'wp', weekly.pct);
      const wr = shadowRoot.getElementById('wr');
      if (wr) wr.textContent = weekly.reset || '';
      scheduleResetPoll('weekly', weekly.resetAt);
    }
    const ts = shadowRoot.getElementById('ts');
    if (ts) {
      const now = new Date();
      ts.textContent = `更新 ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
    }
    saveSnapshot();
  }

  // ── History snapshot ─────────────────────────────────────────────────────────

  function saveSnapshot() {
    const s = cached.session?.pct ?? null;
    const w = cached.weekly?.pct  ?? null;
    if (s === null && w === null) return;

    chrome.storage.local.get(['cco_history'], ({ cco_history = [] }) => {
      const last = cco_history[cco_history.length - 1];
      const now  = Date.now();
      if (last && last.s === s && last.w === w && (now - last.t) < 60 * 1000) {
        // Values unchanged and recent — just update current state
        chrome.storage.local.set({ cco_current: {
          session: cached.session, weekly: cached.weekly,
          model: currentModel, t: now,
        }});
        return;
      }
      cco_history.push({ t: now, s, w, model: currentModel });
      if (cco_history.length > 20160) cco_history.splice(0, cco_history.length - 20160);
      chrome.storage.local.set({
        cco_history,
        cco_current: { session: cached.session, weekly: cached.weekly, model: currentModel, t: now },
      });
    });
  }

  // ── Listen for interceptor.js events ─────────────────────────────────────────

  window.addEventListener('__cco_usage', (ev) => {
    const usage = ev.detail;
    if (!usage) return;
    if (usage.session != null) cached.session = usage.session;
    if (usage.weekly  != null) cached.weekly  = usage.weekly;
    applyData(cached);
  });

  window.addEventListener('__cco_model', (ev) => {
    if (ev.detail) currentModel = ev.detail;
  });

  // ── Probe general (non-org-specific) usage endpoints ────────────────────────

  async function probeEndpoints() {
    const paths = [
      '/api/account', '/api/me', '/api/usage',
      '/api/account/usage', '/api/bootstrap', '/api/user', '/api/profile',
    ];
    for (const path of paths) {
      try {
        const res = await fetch('https://claude.ai' + path, { credentials: 'include' });
        if (res.ok) {
          const text = await res.text();
          if (text && (text[0] === '{' || text[0] === '['))
            window.dispatchEvent(new CustomEvent('__cco_raw', { detail: { url: path, text } }));
        }
      } catch (_) {}
    }
  }

  // ── リセット時刻での自動再取得 ────────────────────────────────────────────────

  const resetTimers = { session: null, weekly: null };

  function scheduleResetPoll(key, resetAt) {
    if (!resetAt) return;
    const delay = resetAt - Date.now();
    if (delay <= 0 || delay > 6 * 3600 * 1000) return; // 6時間超は無視
    if (resetTimers[key]) clearTimeout(resetTimers[key]);
    resetTimers[key] = setTimeout(() => {
      resetTimers[key] = null;
      pollNow();
      // APIが更新されるまで少し待ってもう一度
      setTimeout(pollNow, 5000);
    }, delay + 1500); // 1.5秒バッファ
  }

  // ── 30秒ポーリング ───────────────────────────────────────────────────────────

  async function pollNow() {
    if (currentOrgId) {
      const key = `/api/organizations/${currentOrgId}/rate_limits`;
      try {
        const res = await fetch('https://claude.ai' + key, { credentials: 'include' });
        if (res.ok) {
          const text = await res.text();
          if (text && (text[0] === '{' || text[0] === '[')) {
            window.dispatchEvent(new CustomEvent('__cco_raw', { detail: { url: key, text } }));
            return;
          }
        }
      } catch (_) {}
    }
    await probeEndpoints();
  }

  setInterval(pollNow, 30_000);

  // ── Probe org-specific usage endpoints ──────────────────────────────────────

  let orgProbed = false;

  async function probeOrgUsage(orgId) {
    currentOrgId = orgId;
    if (orgProbed) return;
    orgProbed = true;
    const paths = [
      `/api/organizations/${orgId}`,
      `/api/organizations/${orgId}/usage`,
      `/api/organizations/${orgId}/usage_limits`,
      `/api/organizations/${orgId}/limits`,
      `/api/organizations/${orgId}/rate_limits`,
      `/api/organizations/${orgId}/plan`,
      `/api/organizations/${orgId}/plan_limits`,
      `/api/organizations/${orgId}/subscription`,
      `/api/organizations/${orgId}/billing`,
      `/api/organizations/${orgId}/entitlements`,
      `/api/organizations/${orgId}/active_entitlements`,
      `/api/organizations/${orgId}/member_limits`,
      `/api/organizations/${orgId}/members/me`,
      `/api/organizations/${orgId}/usage_stats`,
      `/v1/organizations/${orgId}/usage`,
      `/v1/organizations/${orgId}/limits`,
      `/api/claude_code/organizations/${orgId}/usage`,
      `/api/claude_code/organizations/${orgId}/limits`,
    ];
    for (const path of paths) {
      try {
        const res = await fetch('https://claude.ai' + path, { credentials: 'include' });
        if (res.ok) {
          const text = await res.text();
          if (text && (text[0] === '{' || text[0] === '['))
            window.dispatchEvent(new CustomEvent('__cco_raw', { detail: { url: path, text } }));
        }
      } catch (_) {}
    }
  }

  // Parse raw successful responses and apply
  window.addEventListener('__cco_raw', (ev) => {
    const text = ev.detail?.text;
    if (!text) return;
    let data;
    try { data = JSON.parse(text); } catch (_) { return; }
    const found = contentExtract(data, 0);
    if (found && (found.session || found.weekly)) {
      if (found.session != null) cached.session = found.session;
      if (found.weekly  != null) cached.weekly  = found.weekly;
      applyData(cached);
    }
  });

  window.addEventListener('__cco_orgid', (ev) => {
    probeOrgUsage(ev.detail);
  });

  // ── Minimal content-side extractor ───────────────────────────────────────────

  const S_KW = ['session', 'currentsession', 'daily', 'billingperiod', 'currentperiod', 'fivehour', 'five'];
  const W_KW = ['weekly', 'allmodels', 'allmodel', 'week', 'planperiod', 'planusage', 'sevenday', 'seven'];
  const PCT  = ['percent', 'percentage', 'usedpercent', 'usagepercent', 'fraction', 'ratio'];
  const RST  = ['reset', 'resetat', 'resets', 'expiresat', 'refreshat', 'nextreset', 'periodend'];
  const LIM  = ['limit', 'max', 'total', 'allowed', 'quota', 'messagelimit', 'messageslimit'];
  const CNT  = ['used', 'count', 'executed', 'runs', 'completed', 'messagesused', 'tokensused'];

  function lc2(k) { return k.toLowerCase().replace(/_/g, ''); }
  function pv2(obj, keys) {
    for (const [k, v] of Object.entries(obj)) {
      if (keys.some(kw => lc2(k).includes(kw))) return v;
    }
  }
  function toPct2(v) {
    if (typeof v === 'number') return v >= 1 ? Math.round(v) : Math.round(v * 100);
    if (typeof v === 'string') { const m = v.match(/^(\d+\.?\d*)\s*%?$/); if (m) { const n = +m[1]; return n < 1 ? Math.round(n*100) : Math.round(n); } }
    return null;
  }
  function fmtR2(v) {
    if (!v) return '';
    const d = typeof v === 'number' ? new Date(v > 1e10 ? v : v*1000) : new Date(v);
    if (isNaN(d)) return '';
    const diff = d - Date.now();
    if (diff <= 0) return 'まもなくリセット';
    const h = Math.floor(diff/3600000), m = Math.floor((diff%3600000)/60000);
    if (h === 0 && m === 0) return 'まもなくリセット';
    return h > 0 ? `${h}時間${m}分後にリセット` : `${m}分後にリセット`;
  }
  function rstAt2(v) {
    if (!v) return null;
    const d = typeof v === 'number' ? new Date(v > 1e10 ? v : v*1000) : new Date(v);
    return isNaN(d) ? null : d.getTime();
  }
  function parseS2(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    let pct = null;
    const pv = pv2(obj, PCT); pct = pv !== undefined ? toPct2(pv) : null;
    if (pct === null) { const u = pv2(obj,CNT), t = pv2(obj,LIM); if (typeof u==='number'&&typeof t==='number'&&t>0) pct=Math.round(u/t*100); }
    const rv = pv2(obj, RST);
    return pct !== null ? { pct, reset: fmtR2(rv), resetAt: rstAt2(rv) } : null;
  }
  function contentExtract(data, depth) {
    if (depth > 10 || !data || typeof data !== 'object') return null;
    if (Array.isArray(data)) { for (const i of data) { const r=contentExtract(i,depth+1); if(r) return r; } return null; }
    let session=null, weekly=null;
    for (const [k,v] of Object.entries(data)) {
      const lk = lc2(k);
      if (S_KW.some(kw=>lk.includes(kw))) session = parseS2(v) ?? session;
      if (W_KW.some(kw=>lk.includes(kw))) weekly  = parseS2(v) ?? weekly;
    }
    if (session||weekly) return { session, weekly };
    for (const v of Object.values(data)) { if (v&&typeof v==='object') { const r=contentExtract(v,depth+1); if(r) return r; } }
    return null;
  }

  // ── Init ─────────────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      buildOverlay();
      setTimeout(probeEndpoints, 2000);
    });
  } else {
    buildOverlay();
    setTimeout(probeEndpoints, 2000);
  }
})();
