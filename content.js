(function () {
  'use strict';

  if (document.getElementById('cco-host')) return;

  const CARD_W   = 240;
  const DOM_SCAN_MS = 15_000; // DOM fallback interval

  let shadowRoot, mutationThrottle, domTimer;
  let cached = { session: null, weekly: null, routine: null };

  // ── Inject page-context script ───────────────────────────────────────────────

  function injectScript() {
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('injected.js');
    s.onload = () => s.remove();
    (document.head || document.documentElement).appendChild(s);
  }

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
        .hdr {
          display: flex; align-items: center;
          justify-content: space-between; margin-bottom: 7px;
        }
        .title {
          font-size: 10px; font-weight: 700; color: #7b7faa;
          letter-spacing: 0.06em; text-transform: uppercase;
        }
        .toggle-btn {
          background: none; border: none; color: #5a5e98;
          cursor: pointer; font-size: 15px; line-height: 1; padding: 0;
        }
        .toggle-btn:hover { color: #9b9fcc; }
        .body { display: flex; flex-direction: column; gap: 6px; }
        #card.min .body { display: none; }
        .row { display: flex; flex-direction: column; gap: 2px; }
        .lbl { font-size: 9.5px; color: #6b6f9a; }
        .bar-row { display: flex; align-items: center; gap: 5px; }
        .bar { flex:1; height:4px; background:#2b2d52; border-radius:3px; overflow:hidden; }
        .fill {
          height:100%; border-radius:3px; background:#4f46e5;
          transition: width 0.4s ease; width:0%;
        }
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
          <div class="ts" id="ts">API レスポンス待機中...</div>
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

  // ── Apply data to overlay ────────────────────────────────────────────────────

  function barClass(p) { return p >= 90 ? 'danger' : p >= 70 ? 'warn' : ''; }

  function setBar(fillId, pctId, pct) {
    const f = shadowRoot && shadowRoot.getElementById(fillId);
    const p = shadowRoot && shadowRoot.getElementById(pctId);
    if (!f || !p) return;
    f.style.width = pct + '%';
    f.className = 'fill ' + barClass(pct);
    p.textContent = pct + '%';
  }

  function applyData({ session, weekly, routine }) {
    if (session) {
      setBar('sf', 'sp', session.pct);
      const sr = shadowRoot.getElementById('sr');
      if (sr && session.reset) sr.textContent = session.reset;
    }
    if (weekly) {
      setBar('wf', 'wp', weekly.pct);
      const wr = shadowRoot.getElementById('wr');
      if (wr && weekly.reset) wr.textContent = weekly.reset;
    }
    if (routine) {
      const rt = shadowRoot.getElementById('rt');
      if (rt) rt.textContent = routine;
    }
    const ts = shadowRoot && shadowRoot.getElementById('ts');
    if (ts) {
      const now = new Date();
      ts.textContent = `更新 ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
    }
  }

  // ── Listen for injected.js postMessage ───────────────────────────────────────

  window.addEventListener('message', (ev) => {
    if (!ev.data || !ev.data.__cco) return;
    const { usage } = ev.data;
    if (!usage) return;
    if (usage.session) cached.session = usage.session;
    if (usage.weekly)  cached.weekly  = usage.weekly;
    if (usage.routine) cached.routine = usage.routine;
    applyData(cached);
  });

  // ── DOM fallback (only when panel is visible) ────────────────────────────────

  const PANEL_ANCHORS = ['現在のセッション', 'プラン使用制限', 'すべてのモデル'];

  function findUsagePanel() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (!PANEL_ANCHORS.some(k => n.nodeValue.includes(k))) continue;
      let el = n.parentElement;
      for (let i = 0; i < 12 && el && el !== document.body; i++) {
        if (el.querySelectorAll('[role="progressbar"], progress, meter').length >= 1) return el;
        el = el.parentElement;
      }
    }
    return null;
  }

  function domFallback() {
    const panel = findUsagePanel();
    if (!panel) return; // panel not open → skip silently

    const texts = [];
    const w = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) { const v = n.nodeValue.trim(); if (v) texts.push(v); }

    const pctTexts = [];
    texts.forEach(t => {
      const m = t.match(/^(\d{1,3})\s*%\s*使用済み$/) || t.match(/^(\d{1,3})%$/);
      if (m) pctTexts.push(parseInt(m[1], 10));
    });
    const resetTexts = texts.filter(t => t.includes('リセット'));
    const routineM = panel.textContent.match(/(\d+)\s*[\/／]\s*(\d+)/);

    const update = {};
    if (pctTexts[0] !== undefined && !cached.session) update.session = { pct: pctTexts[0], reset: resetTexts[0] || '' };
    if (pctTexts[1] !== undefined && !cached.weekly)  update.weekly  = { pct: pctTexts[1], reset: resetTexts[1] || '' };
    if (routineM && !cached.routine) update.routine = `${routineM[1]} / ${routineM[2]}`;

    if (Object.keys(update).length) {
      Object.assign(cached, update);
      applyData(cached);
    }
  }

  // ── Init ─────────────────────────────────────────────────────────────────────

  function init() {
    injectScript();
    buildOverlay();
    domTimer = setInterval(domFallback, DOM_SCAN_MS);
    // Initial DOM scan after brief delay
    setTimeout(domFallback, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 500));
  } else {
    setTimeout(init, 500);
  }
})();
