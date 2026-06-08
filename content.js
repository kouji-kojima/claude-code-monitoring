(function () {
  'use strict';

  if (document.getElementById('cco-host')) return;

  const RESCAN_MS = 30_000;
  const CARD_W = 240;
  let shadowRoot, mutationThrottle, scanTimer;

  // ── Shadow DOM host ──────────────────────────────────────────────────────────

  function buildOverlay() {
    const host = document.createElement('div');
    host.id = 'cco-host';
    host.style.cssText = [
      'position:fixed', 'bottom:20px', 'right:20px',
      `width:${CARD_W}px`, 'z-index:2147483647',
      'pointer-events:auto', 'display:block'
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
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 7px;
        }
        .title {
          font-size: 10px;
          font-weight: 700;
          color: #7b7faa;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }
        .toggle-btn {
          background: none;
          border: none;
          color: #5a5e98;
          cursor: pointer;
          font-size: 15px;
          line-height: 1;
          padding: 0;
          font-family: inherit;
        }
        .toggle-btn:hover { color: #9b9fcc; }
        .body { display: flex; flex-direction: column; gap: 6px; }
        #card.min .body { display: none; }
        .row { display: flex; flex-direction: column; gap: 2px; }
        .lbl { font-size: 9.5px; color: #6b6f9a; }
        .bar-row { display: flex; align-items: center; gap: 5px; }
        .bar {
          flex: 1;
          height: 4px;
          background: #2b2d52;
          border-radius: 3px;
          overflow: hidden;
        }
        .fill {
          height: 100%;
          border-radius: 3px;
          background: #4f46e5;
          transition: width 0.4s ease;
          width: 0%;
        }
        .fill.warn   { background: #d97706; }
        .fill.danger { background: #dc2626; }
        .pct {
          font-size: 11px;
          font-weight: 700;
          color: #e0e1ff;
          min-width: 28px;
          text-align: right;
        }
        .sub { font-size: 9px; color: #4e5280; }
        .div { height: 1px; background: #252748; }
        .rt-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .rt-val { font-size: 12px; font-weight: 700; color: #e0e1ff; }
        .ts { font-size: 8.5px; color: #353760; text-align: right; margin-top: 5px; }
        .no-data { font-size: 9px; color: #3d4070; text-align: center; padding: 4px 0; }
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
          <div class="ts" id="ts"></div>
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

  // ── Find usage panel container ───────────────────────────────────────────────
  // Claude.ai renders usage stats inside a panel. We anchor on known heading text
  // and walk up until we find a container that also holds a progress bar.

  const PANEL_KEYWORDS = ['現在のセッション', 'プラン使用制限', 'すべてのモデル'];

  function findUsagePanel() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (!PANEL_KEYWORDS.some(k => n.nodeValue.includes(k))) continue;
      // Walk up from this text node looking for a container with progress bars
      let el = n.parentElement;
      for (let i = 0; i < 12 && el && el !== document.body; i++) {
        const bars = el.querySelectorAll('[role="progressbar"], progress, meter');
        if (bars.length >= 1) return el;
        el = el.parentElement;
      }
    }
    return null;
  }

  // ── Extract from scoped container ────────────────────────────────────────────

  function textNodesIn(el) {
    const results = [];
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const v = n.nodeValue.trim();
      if (v) results.push(v);
    }
    return results;
  }

  function barClass(p) {
    return p >= 90 ? 'danger' : p >= 70 ? 'warn' : '';
  }

  function setBar(fillId, pctId, pct) {
    const f = shadowRoot.getElementById(fillId);
    const p = shadowRoot.getElementById(pctId);
    if (!f || !p) return;
    f.style.width = pct + '%';
    f.className = 'fill ' + barClass(pct);
    p.textContent = pct + '%';
  }

  function scan() {
    if (!shadowRoot) return;

    const panel = findUsagePanel();

    let sPct = null, wPct = null, sReset = '', wReset = '', routine = '--';

    if (panel) {
      // ── Progress bars inside the panel ──
      const bars = Array.from(panel.querySelectorAll('[role="progressbar"], progress, meter'));
      bars.forEach((bar, i) => {
        const v = bar.getAttribute('aria-valuenow')
               ?? bar.getAttribute('value')
               ?? null;
        const pct = v !== null ? Math.round(parseFloat(v)) : null;
        if (pct === null || pct < 0 || pct > 100) return;
        if (i === 0 && sPct === null) sPct = pct;
        else if (i === 1 && wPct === null) wPct = pct;
      });

      // ── Percentage from text "XX% 使用済み" inside the panel ──
      const texts = textNodesIn(panel);
      const pctTexts = [];
      texts.forEach(t => {
        // Match "13% 使用済み" or standalone "13%"
        const m = t.match(/^(\d{1,3})\s*%\s*使用済み$/)
               || t.match(/^(\d{1,3})%$/);
        if (m) pctTexts.push(parseInt(m[1], 10));
      });
      if (sPct === null && pctTexts.length >= 1) sPct = pctTexts[0];
      if (wPct === null && pctTexts.length >= 2) wPct = pctTexts[1];

      // ── Reset times ──
      const resetTexts = texts.filter(t => t.includes('リセット'));
      if (resetTexts[0]) sReset = resetTexts[0];
      if (resetTexts[1]) wReset = resetTexts[1];

      // ── Routine count ──
      const allText = panel.textContent;
      const routineM = allText.match(/(\d+)\s*[\/／]\s*(\d+)/);
      if (routineM) {
        routine = `${routineM[1]} / ${routineM[2]}`;
      } else if (allText.includes('まだルーティン')) {
        // Find the max number near ルーティン
        const limM = allText.match(/(\d+)/g);
        routine = limM ? `0 / ${limM[limM.length - 1]}` : '0';
      }
    }

    // ── Apply to overlay ──
    if (sPct !== null) setBar('sf', 'sp', sPct);
    if (wPct !== null) setBar('wf', 'wp', wPct);

    const sr = shadowRoot.getElementById('sr');
    const wr = shadowRoot.getElementById('wr');
    const rt = shadowRoot.getElementById('rt');
    const ts = shadowRoot.getElementById('ts');

    if (sr) sr.textContent = sReset;
    if (wr) wr.textContent = wReset;
    if (rt) rt.textContent = routine;
    if (ts) {
      const now = new Date();
      ts.textContent = panel
        ? `更新 ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`
        : '使用状況パネルを開いてください';
    }
  }

  // ── MutationObserver ─────────────────────────────────────────────────────────

  function startObserver() {
    new MutationObserver(() => {
      clearTimeout(mutationThrottle);
      mutationThrottle = setTimeout(scan, 600);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function init() {
    buildOverlay();
    scan();
    startObserver();
    scanTimer = setInterval(scan, RESCAN_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 1500));
  } else {
    setTimeout(init, 1500);
  }
})();
