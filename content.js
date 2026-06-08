(function () {
  'use strict';

  if (document.getElementById('cco-host')) return;

  const RESCAN_MS = 30_000;
  let shadowRoot, mutationThrottle, scanTimer;

  // ── Shadow DOM host ──────────────────────────────────────────────────────────

  function buildOverlay() {
    const host = document.createElement('div');
    host.id = 'cco-host';
    host.style.cssText = [
      'position:fixed', 'bottom:20px', 'right:20px',
      'width:200px', 'z-index:2147483647',
      'pointer-events:auto', 'all:unset',
      'display:block'
    ].join(';');
    document.body.appendChild(host);

    shadowRoot = host.attachShadow({ mode: 'open' });
    shadowRoot.innerHTML = `
      <style>
        :host { all: initial; display: block; }
        #card {
          width: 200px;
          background: #1a1b2e;
          border: 1px solid #2e3058;
          border-radius: 10px;
          padding: 8px 11px 9px;
          box-shadow: 0 4px 18px rgba(0,0,0,0.55);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          font-size: 11px;
          color: #c8c9e8;
          user-select: none;
          box-sizing: border-box;
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
        .lbl {
          font-size: 9.5px;
          color: #6b6f9a;
        }
        .bar-row {
          display: flex;
          align-items: center;
          gap: 5px;
        }
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
        .fill.warn  { background: #d97706; }
        .fill.danger { background: #dc2626; }
        .pct {
          font-size: 11px;
          font-weight: 700;
          color: #e0e1ff;
          min-width: 28px;
          text-align: right;
        }
        .sub {
          font-size: 9px;
          color: #4e5280;
        }
        .div { height: 1px; background: #252748; }
        .rt-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .rt-val {
          font-size: 12px;
          font-weight: 700;
          color: #e0e1ff;
        }
        .ts {
          font-size: 8.5px;
          color: #353760;
          text-align: right;
          margin-top: 5px;
        }
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

    // Toggle
    let min = false;
    const card = shadowRoot.getElementById('card');
    const tog = shadowRoot.getElementById('tog');
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

  // ── Data extraction ──────────────────────────────────────────────────────────

  function allText(root) {
    const results = [];
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const v = n.nodeValue.trim();
      if (v) results.push({ node: n, text: v });
    }
    return results;
  }

  function nearestBlock(node, up = 6) {
    let el = node.parentElement;
    for (let i = 0; i < up && el && el !== document.body; i++) {
      if (el.children.length > 1 || el.offsetHeight > 20) return el;
      el = el.parentElement;
    }
    return node.parentElement;
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

    const texts = allText(document.body);

    // ── Strategy 1: aria progressbars ──
    const ariaBarValues = [];
    document.querySelectorAll('[role="progressbar"]').forEach(el => {
      const v = el.getAttribute('aria-valuenow');
      if (v !== null) ariaBarValues.push(parseInt(v, 10));
    });

    // ── Strategy 2: inline width% divs inside containers near usage keywords ──
    const widthPcts = [];
    document.querySelectorAll('[style*="width"]').forEach(el => {
      const m = el.style.width.match(/^(\d+(\.\d+)?)%$/);
      if (m) {
        const pct = Math.round(parseFloat(m[1]));
        if (pct >= 0 && pct <= 100) widthPcts.push({ pct, el });
      }
    });

    // ── Strategy 3: text pattern "XX% 使用済み" or number near セッション/モデル ──
    const pctFromText = [];
    texts.forEach(({ text }) => {
      const m = text.match(/^(\d+)%?\s*使用済み$/) || text.match(/^(\d{1,3})%$/);
      if (m) pctFromText.push(parseInt(m[1], 10));
    });

    // Pick best source
    const pctSource =
      pctFromText.length >= 2 ? pctFromText :
      ariaBarValues.length >= 2 ? ariaBarValues :
      widthPcts.length >= 2 ? widthPcts.map(x => x.pct) :
      null;

    if (pctSource && pctSource.length >= 1) setBar('sf', 'sp', pctSource[0]);
    if (pctSource && pctSource.length >= 2) setBar('wf', 'wp', pctSource[1]);

    // ── Reset times ──
    const resetTexts = texts.filter(({ text }) => text.includes('リセット'));
    const sr = shadowRoot.getElementById('sr');
    const wr = shadowRoot.getElementById('wr');
    if (sr && resetTexts[0]) sr.textContent = resetTexts[0].text;
    if (wr && resetTexts[1]) wr.textContent = resetTexts[1].text;

    // ── Routine count ──
    const rt = shadowRoot.getElementById('rt');
    if (rt) {
      // Look for "X / Y" or "X/Y" pattern near ルーティン
      const routineIdx = texts.findIndex(({ text }) => text.includes('ルーティン'));
      let found = null;
      if (routineIdx >= 0) {
        // Search nearby text nodes
        for (let i = routineIdx; i < Math.min(routineIdx + 10, texts.length); i++) {
          const m = texts[i].text.match(/(\d+)\s*[\/／]\s*(\d+)/);
          if (m) { found = `${m[1]} / ${m[2]}`; break; }
        }
        // Also check parent container text
        if (!found) {
          const block = nearestBlock(texts[routineIdx].node, 8);
          if (block) {
            const m = block.textContent.match(/(\d+)\s*[\/／]\s*(\d+)/);
            if (m) found = `${m[1]} / ${m[2]}`;
          }
        }
      }
      // "まだルーティンを実行していません" → 0/?
      if (!found && texts.some(({ text }) => text.includes('まだルーティン'))) {
        // Try to find max from nearby numbers
        if (routineIdx >= 0) {
          const block = nearestBlock(texts[routineIdx].node, 8);
          const nm = block && block.textContent.match(/(\d+)/);
          found = nm ? `0 / ${nm[1]}` : '0';
        }
      }
      if (found) rt.textContent = found;
    }

    // ── Timestamp ──
    const ts = shadowRoot.getElementById('ts');
    if (ts) {
      const now = new Date();
      ts.textContent = `更新 ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
    }
  }

  // ── MutationObserver ─────────────────────────────────────────────────────────

  function startObserver() {
    new MutationObserver(() => {
      clearTimeout(mutationThrottle);
      mutationThrottle = setTimeout(scan, 600);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  // ── Init ─────────────────────────────────────────────────────────────────────

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
