'use strict';

const ORANGE = '#FF6B35';
const INDIGO = '#4f46e5';
const BG     = '#0a0b1c';
const GRID   = '#14162e';
const MUTED  = '#3a3e68';

const MODEL_COLORS = {
  opus:   '#c084fc',
  sonnet: '#60a5fa',
  haiku:  '#34d399',
  fable:  '#fbbf24',
};

function modelColor(model) {
  if (!model) return ORANGE;
  const m = model.toLowerCase();
  for (const [k, c] of Object.entries(MODEL_COLORS)) {
    if (m.includes(k)) return c;
  }
  return ORANGE;
}

function modelLabel(model) {
  if (!model) return '--';
  const m = model.toLowerCase();
  if (m.includes('opus'))   return 'Opus';
  if (m.includes('sonnet')) return 'Sonnet';
  if (m.includes('haiku'))  return 'Haiku';
  if (m.includes('fable'))  return 'Fable';
  const parts = model.split('-').filter(p => !/^\d/.test(p));
  return parts.slice(1).join(' ') || model;
}

function fmtTime(ms) {
  const d = new Date(ms);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function alpha(hex, a) {
  return hex + Math.round(a * 255).toString(16).padStart(2, '0');
}

// ── Chart ────────────────────────────────────────────────────────────────────

function drawChart(canvas, history) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const PAD = { top: 22, right: 24, bottom: 34, left: 44 };
  const CW = W - PAD.left - PAD.right;
  const CH = H - PAD.top - PAD.bottom;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = BG;
  ctx.beginPath();
  ctx.roundRect(0, 0, W, H, 8);
  ctx.fill();

  if (history.length === 0) {
    ctx.fillStyle = MUTED;
    ctx.font = '13px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('データを収集中です... claude.ai を開いてお待ちください', W / 2, H / 2);
    return null;
  }

  // Single data point — synthesize a "now" point so a flat line renders.
  if (history.length === 1) {
    const p = history[0];
    history = [p, { ...p, t: Math.max(Date.now(), p.t + 60000) }];
  }

  const t0 = history[0].t;
  const t1 = history[history.length - 1].t;
  const tRange = Math.max(t1 - t0, 1);

  const xPos = t => PAD.left + CW * (t - t0) / tRange;
  const yPos = v => PAD.top + CH * (1 - Math.min(110, Math.max(0, v)) / 110);

  // Grid + Y-axis labels
  [0, 25, 50, 75, 100].forEach(pct => {
    const y = yPos(pct);
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo(PAD.left, y);
    ctx.lineTo(PAD.left + CW, y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = MUTED;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(pct + '%', PAD.left - 6, y);
  });

  // X-axis labels (up to 6 ticks)
  const ticks = Math.min(6, history.length - 1);
  for (let i = 0; i <= ticks; i++) {
    const idx = Math.round((i / ticks) * (history.length - 1));
    const x = xPos(history[idx].t);
    ctx.fillStyle = MUTED;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(fmtTime(history[idx].t), x, PAD.top + CH + 6);
  }

  // Clip to chart area
  ctx.save();
  ctx.beginPath();
  ctx.rect(PAD.left, PAD.top, CW, CH);
  ctx.clip();

  const validS = history.filter(p => p.s != null);
  const validW = history.filter(p => p.w != null);

  // ── Weekly line + fill ─────────────────────────────────────────────────────
  if (validW.length >= 2) {
    const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + CH);
    grad.addColorStop(0, alpha(INDIGO, 0.22));
    grad.addColorStop(1, alpha(INDIGO, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(xPos(validW[0].t), yPos(validW[0].w));
    validW.forEach(p => ctx.lineTo(xPos(p.t), yPos(p.w)));
    ctx.lineTo(xPos(validW[validW.length - 1].t), PAD.top + CH);
    ctx.lineTo(xPos(validW[0].t), PAD.top + CH);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = INDIGO;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    validW.forEach((p, i) => {
      i === 0 ? ctx.moveTo(xPos(p.t), yPos(p.w)) : ctx.lineTo(xPos(p.t), yPos(p.w));
    });
    ctx.stroke();
  }

  // ── Session gradient fill (orange base, under model-colored line) ──────────
  if (validS.length >= 2) {
    const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + CH);
    grad.addColorStop(0, alpha(ORANGE, 0.18));
    grad.addColorStop(1, alpha(ORANGE, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(xPos(validS[0].t), yPos(validS[0].s));
    validS.forEach(p => ctx.lineTo(xPos(p.t), yPos(p.s)));
    ctx.lineTo(xPos(validS[validS.length - 1].t), PAD.top + CH);
    ctx.lineTo(xPos(validS[0].t), PAD.top + CH);
    ctx.closePath();
    ctx.fill();

    // Session line — each segment colored by the model at that point
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (let i = 1; i < validS.length; i++) {
      const p0 = validS[i - 1], p1 = validS[i];
      ctx.strokeStyle = modelColor(p1.model);
      ctx.beginPath();
      ctx.moveTo(xPos(p0.t), yPos(p0.s));
      ctx.lineTo(xPos(p1.t), yPos(p1.s));
      ctx.stroke();
    }
  }

  // ── Spike markers ──────────────────────────────────────────────────────────
  let maxSpike = null;
  validS.forEach((pt, i) => {
    if (i === 0) return;
    const delta = pt.s - validS[i - 1].s;
    if (delta < 3) return;
    if (!maxSpike || delta > maxSpike.delta) maxSpike = { delta: Math.round(delta), t: pt.t };

    const x = xPos(pt.t), y = yPos(pt.s);

    // Glow ring
    ctx.shadowColor = ORANGE;
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Label for notable spikes
    if (delta >= 5) {
      ctx.fillStyle = ORANGE;
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`+${Math.round(delta)}%`, x, y - 8);
    }
  });

  ctx.restore();
  return maxSpike;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { cco_history = [], cco_current = {} } =
    await chrome.storage.local.get(['cco_history', 'cco_current']);

  const canvas = document.getElementById('chart');
  const maxSpike = drawChart(canvas, cco_history);

  // Stats
  const s = cco_current.session;
  const w = cco_current.weekly;
  document.getElementById('stat-session').textContent = s ? s.pct + '%' : '--%';
  document.getElementById('stat-weekly').textContent  = w ? w.pct + '%' : '--%';

  const model = cco_current.model;
  if (model) {
    const el = document.getElementById('stat-model');
    el.textContent  = modelLabel(model);
    el.style.color  = modelColor(model);

    document.getElementById('model-legend').style.display = 'flex';
    document.getElementById('model-dot').style.cssText =
      `width:8px;height:8px;border-radius:50%;background:${modelColor(model)};flex-shrink:0`;
    document.getElementById('model-name-leg').textContent = modelLabel(model);
  }

  if (maxSpike) {
    document.getElementById('stat-spike').textContent =
      `+${maxSpike.delta}% (${fmtTime(maxSpike.t)})`;
  }

  const last = cco_history[cco_history.length - 1];
  if (last) document.getElementById('stat-update').textContent = fmtTime(last.t);

  document.getElementById('clear-btn').addEventListener('click', () => {
    chrome.storage.local.remove(['cco_history', 'cco_current'], () => window.close());
  });
}

main();
