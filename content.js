(function () {
  'use strict';

  if (document.getElementById('cco-overlay')) return;

  const RESCAN_MS = 30_000;
  let overlay, minimized = false, scanTimer, mutationThrottle;

  // ── DOM helpers ─────────────────────────────────────────────────────────────

  function textNodes(root, substr) {
    const results = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (n.nodeValue.includes(substr)) results.push(n);
    }
    return results;
  }

  function closestBlock(node, maxUp = 8) {
    let el = node.parentElement;
    for (let i = 0; i < maxUp && el; i++, el = el.parentElement) {
      if (el.children.length > 1) return el;
    }
    return node.parentElement;
  }

  function parsePercent(text) {
    const m = text.match(/(\d+)\s*%/);
    return m ? parseInt(m[1], 10) : null;
  }

  function parseRoutine(text) {
    const m = text.match(/(\d+)\s*[\/／]\s*(\d+)/);
    return m ? `${m[1]} / ${m[2]}` : null;
  }

  // ── Build overlay ────────────────────────────────────────────────────────────

  function buildOverlay() {
    overlay = document.createElement('div');
    overlay.id = 'cco-overlay';
    overlay.innerHTML = `
      <div class="cco-header">
        <span class="cco-title">Claude 使用状況</span>
        <button class="cco-toggle" title="最小化">−</button>
      </div>
      <div class="cco-body">
        <div class="cco-item" id="cco-session">
          <div class="cco-label">現在のセッション</div>
          <div class="cco-row">
            <div class="cco-bar"><div class="cco-bar-fill" id="cco-s-fill" style="width:0%"></div></div>
            <span class="cco-pct" id="cco-s-pct">--%</span>
          </div>
          <div class="cco-reset" id="cco-s-reset"></div>
        </div>
        <div class="cco-divider"></div>
        <div class="cco-item" id="cco-weekly">
          <div class="cco-label">週間制限（全モデル）</div>
          <div class="cco-row">
            <div class="cco-bar"><div class="cco-bar-fill" id="cco-w-fill" style="width:0%"></div></div>
            <span class="cco-pct" id="cco-w-pct">--%</span>
          </div>
          <div class="cco-reset" id="cco-w-reset"></div>
        </div>
        <div class="cco-divider"></div>
        <div class="cco-item">
          <div class="cco-routine-row">
            <span class="cco-label">ルーティン実行数</span>
            <span class="cco-routine-count" id="cco-routine">--</span>
          </div>
        </div>
        <div class="cco-updated" id="cco-updated"></div>
      </div>`;
    document.body.appendChild(overlay);

    const toggle = overlay.querySelector('.cco-toggle');
    chrome.storage.local.get('cco_minimized', ({ cco_minimized }) => {
      if (cco_minimized) setMinimized(true, toggle);
    });
    toggle.addEventListener('click', () => {
      setMinimized(!minimized, toggle);
      chrome.storage.local.set({ cco_minimized: minimized });
    });
  }

  function setMinimized(val, btn) {
    minimized = val;
    overlay.classList.toggle('cco-minimized', val);
    btn.textContent = val ? '+' : '−';
  }

  // ── Bar color ────────────────────────────────────────────────────────────────

  function barClass(pct) {
    if (pct >= 90) return 'danger';
    if (pct >= 70) return 'warn';
    return '';
  }

  function applyBar(fillId, pctId, pct) {
    const fill = document.getElementById(fillId);
    const pctEl = document.getElementById(pctId);
    if (!fill || !pctEl) return;
    fill.style.width = `${pct}%`;
    fill.className = `cco-bar-fill ${barClass(pct)}`;
    pctEl.textContent = `${pct}%`;
  }

  // ── Scan usage data from page DOM ────────────────────────────────────────────

  function scan() {
    const body = document.body;

    // ── Percentage values ──
    // Look for text like "13% 使用済み" or "50% 使用済み"
    const usedNodes = textNodes(body, '使用済み');
    const pcts = [];
    usedNodes.forEach(n => {
      // The % and number may be in a sibling/parent span
      const block = closestBlock(n, 4);
      const pct = parsePercent(block ? block.textContent : n.nodeValue);
      if (pct !== null) pcts.push({ pct, node: n });
    });

    // Fallback: aria progressbars
    if (pcts.length === 0) {
      document.querySelectorAll('[role="progressbar"]').forEach(el => {
        const v = el.getAttribute('aria-valuenow');
        if (v !== null) pcts.push({ pct: parseInt(v, 10), node: el });
      });
    }

    // ── Reset times ──
    const resetNodes = textNodes(body, 'リセット');
    const resets = resetNodes.map(n => n.nodeValue.trim());

    // ── Routine count ──
    let routineText = '--';
    const routineNodes = textNodes(body, 'ルーティン');
    if (routineNodes.length > 0) {
      const block = closestBlock(routineNodes[0], 8);
      if (block) {
        const parsed = parseRoutine(block.textContent);
        if (parsed) routineText = parsed;
      }
    }
    // Fallback: "まだルーティンを実行していません" → show 0/?
    if (routineText === '--') {
      const notYet = textNodes(body, 'まだルーティン');
      if (notYet.length > 0) routineText = '0 / ?';
    }

    // ── Apply to overlay ──
    if (!document.getElementById('cco-s-fill')) return;

    if (pcts.length >= 1) applyBar('cco-s-fill', 'cco-s-pct', pcts[0].pct);
    if (pcts.length >= 2) applyBar('cco-w-fill', 'cco-w-pct', pcts[1].pct);

    const sReset = document.getElementById('cco-s-reset');
    const wReset = document.getElementById('cco-w-reset');
    if (sReset && resets[0]) sReset.textContent = resets[0];
    if (wReset && resets[1]) wReset.textContent = resets[1];

    const routineEl = document.getElementById('cco-routine');
    if (routineEl) routineEl.textContent = routineText;

    const updEl = document.getElementById('cco-updated');
    if (updEl) {
      const now = new Date();
      updEl.textContent = `更新: ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
    }
  }

  // ── MutationObserver (throttled) ─────────────────────────────────────────────

  function startObserver() {
    const obs = new MutationObserver(() => {
      clearTimeout(mutationThrottle);
      mutationThrottle = setTimeout(scan, 800);
    });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
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
