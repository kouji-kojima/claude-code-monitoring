(function () {
  'use strict';

  if (document.getElementById('cco-host')) return;

  const CARD_W = 240;
  let shadowRoot;
  let cached = { session: null, weekly: null, routine: null };

  // ── Shadow DOM overlay ───────────────────────────────────────────────────────

  function buildOverlay() {
    const host = document.createElement('div');
    host.id = 'cco-host';
    host.style.cssText = [
      'position:fixed', 'bottom:20px', 'right:20px',
      `width:${CARD_W}px`, 'z-index:2147483647', 'display:block'
    ].join(';');
    document.body.appendChild(host);

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
        .hdr { display:flex; align-items:center; justify-content:space-between; margin-bottom:7px; }
        .title { font-size:10px; font-weight:700; color:#7b7faa; letter-spacing:0.06em; text-transform:uppercase; }
        .toggle-btn { background:none; border:none; color:#5a5e98; cursor:pointer; font-size:15px; line-height:1; padding:0; }
        .toggle-btn:hover { color:#9b9fcc; }
        .body { display:flex; flex-direction:column; gap:6px; }
        #card.min .body { display:none; }
        .row { display:flex; flex-direction:column; gap:2px; }
        .lbl { font-size:9.5px; color:#6b6f9a; }
        .bar-row { display:flex; align-items:center; gap:5px; }
        .bar { flex:1; height:4px; background:#2b2d52; border-radius:3px; overflow:hidden; }
        .fill { height:100%; border-radius:3px; background:#4f46e5; transition:width 0.4s ease; width:0%; }
        .fill.warn   { background:#d97706; }
        .fill.danger { background:#dc2626; }
        .pct { font-size:11px; font-weight:700; color:#e0e1ff; min-width:28px; text-align:right; }
        .sub { font-size:9px; color:#4e5280; }
        .div { height:1px; background:#252748; }
        .rt-row { display:flex; align-items:center; justify-content:space-between; }
        .rt-val { font-size:12px; font-weight:700; color:#e0e1ff; }
        .ts { font-size:8.5px; color:#353760; text-align:right; margin-top:5px; }
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
          <div class="div"></div>
          <div class="row rt-row">
            <span class="lbl">ルーティン</span>
            <span class="rt-val" id="rt">--</span>
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

  function applyData({ session, weekly, routine }) {
    if (session != null) {
      setBar('sf', 'sp', session.pct);
      const sr = shadowRoot.getElementById('sr');
      if (sr) sr.textContent = session.reset || '';
    }
    if (weekly != null) {
      setBar('wf', 'wp', weekly.pct);
      const wr = shadowRoot.getElementById('wr');
      if (wr) wr.textContent = weekly.reset || '';
    }
    if (routine != null) {
      const rt = shadowRoot.getElementById('rt');
      if (rt) rt.textContent = routine;
    }
    const ts = shadowRoot.getElementById('ts');
    if (ts) {
      const now = new Date();
      ts.textContent = `更新 ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
    }
  }

  // ── Listen for interceptor.js events ─────────────────────────────────────────

  window.addEventListener('__cco_usage', (ev) => {
    const usage = ev.detail;
    if (!usage) return;
    if (usage.session != null) cached.session = usage.session;
    if (usage.weekly  != null) cached.weekly  = usage.weekly;
    if (usage.routine != null) cached.routine = usage.routine;
    applyData(cached);
  });

  // ── Probe org-specific usage endpoints ──────────────────────────────────────

  let orgProbed = false;

  async function probeOrgUsage(orgId) {
    if (orgProbed) return;
    orgProbed = true;
    const paths = [
      `/api/organizations/${orgId}/usage`,
      `/api/organizations/${orgId}/limits`,
      `/api/organizations/${orgId}/rate_limits`,
      `/api/organizations/${orgId}/plan`,
      `/api/organizations/${orgId}/plan_limits`,
      `/api/organizations/${orgId}/subscription`,
      `/api/organizations/${orgId}/billing`,
      `/api/organizations/${orgId}/entitlements`,
      `/api/organizations/${orgId}/members/me`,
      `/v1/organizations/${orgId}/usage`,
      `/v1/organizations/${orgId}/limits`,
      `/v1/organizations/${orgId}/rate_limits`,
      `/api/claude_code/organizations/${orgId}/usage`,
      `/api/claude_code/organizations/${orgId}/limits`,
    ];
    console.log('[CCO] probing org usage endpoints for org:', orgId);
    for (const path of paths) {
      try {
        const res = await fetch('https://claude.ai' + path, { credentials: 'include' });
        const text = await res.text();
        console.log(`[CCO] probe ${path} → ${res.status} | ${text.substring(0, 150)}`);
      } catch (e) {
        console.log(`[CCO] probe ${path} → error:`, e.message);
      }
    }
  }

  // Listen for org ID from interceptor
  window.addEventListener('__cco_orgid', (ev) => {
    probeOrgUsage(ev.detail);
  });

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
