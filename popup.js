'use strict';

const ORANGE = '#FF6B35';
const INDIGO = '#4f46e5';
const BG     = '#0a0b1c';
const GRID   = '#14162e';
const MUTED  = '#9499c8';

const MODEL_COLORS = {
  opus:   '#c084fc',
  sonnet: '#60a5fa',
  haiku:  '#34d399',
  fable:  '#fbbf24',
};

const JST = 9 * 3600_000;  // UTC+9 オフセット (ms)

function modelColor(model) {
  if (!model) return ORANGE;
  const m = model.toLowerCase();
  for (const [k, c] of Object.entries(MODEL_COLORS)) { if (m.includes(k)) return c; }
  return ORANGE;
}

function modelLabel(model) {
  if (!model) return '--';
  const m = model.toLowerCase();
  if (m.includes('opus'))   return 'Opus';
  if (m.includes('sonnet')) return 'Sonnet';
  if (m.includes('haiku'))  return 'Haiku';
  if (m.includes('fable'))  return 'Fable';
  return model.split('-').filter(p => !/^\d/.test(p)).slice(1).join(' ') || model;
}

function fmtTime(ms) {
  const d = new Date(ms);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function alpha(hex, a) {
  return hex + Math.round(a * 255).toString(16).padStart(2, '0');
}

// ── 非線形時間スケール (JST 基準、土日圧縮) ──────────────────────────────────

function buildTimeScale(t0, t1) {
  // JST 0:00 に揃えた最初の日の始まり
  const jstDay0 = new Date(t0 + JST);
  jstDay0.setUTCHours(0, 0, 0, 0);
  let cur = jstDay0.getTime() - JST;

  const breaks = [{ real: cur, virt: 0 }];
  let virt = 0;

  while (cur < t1 + 86_400_000) {
    const jstNow = new Date(cur + JST);
    const dow    = jstNow.getUTCDay();
    const hJST   = jstNow.getUTCHours();
    let next, w;

    if (dow === 0 || dow === 6) {
      // 土日: 翌 0:00 JST までスキップ
      const nx = new Date(jstNow);
      nx.setUTCDate(nx.getUTCDate() + 1); nx.setUTCHours(0, 0, 0, 0);
      next = nx.getTime() - JST; w = 0;
    } else if (hJST < 7) {
      // 深夜 0:00-7:00: スキップ
      const nx = new Date(jstNow);
      nx.setUTCHours(7, 0, 0, 0);
      next = nx.getTime() - JST; w = 0;
    } else if (hJST < 22) {
      // 活動時間 7:00-22:00 (15h = 1.0)
      const nx = new Date(jstNow);
      nx.setUTCHours(22, 0, 0, 0);
      next = nx.getTime() - JST;
      w = (next - cur) / (15 * 3600_000);
    } else {
      // 夜間 22:00-24:00: スキップ
      const nx = new Date(jstNow);
      nx.setUTCDate(nx.getUTCDate() + 1); nx.setUTCHours(0, 0, 0, 0);
      next = nx.getTime() - JST; w = 0;
    }

    virt += w;
    cur = next;
    breaks.push({ real: cur, virt });
  }
  return breaks;
}

function virtAt(breaks, t) {
  for (let i = 0; i < breaks.length - 1; i++) {
    if (t >= breaks[i].real && t < breaks[i + 1].real) {
      const frac = (t - breaks[i].real) / (breaks[i + 1].real - breaks[i].real);
      return breaks[i].virt + frac * (breaks[i + 1].virt - breaks[i].virt);
    }
  }
  // 末端外挿
  const last = breaks[breaks.length - 1], prev = breaks[breaks.length - 2];
  return last.virt + (t - last.real) / (last.real - prev.real) * (last.virt - prev.virt);
}

function makeXPos(PAD, CW, breaks, t0, t1) {
  const v0 = virtAt(breaks, t0);
  const v1 = virtAt(breaks, t1);
  const span = Math.max(v1 - v0, 0.001);
  return t => PAD.left + CW * (virtAt(breaks, t) - v0) / span;
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

  if (history.length === 1) {
    const p = history[0];
    history = [p, { ...p, t: Math.max(Date.now(), p.t + 60000) }];
  }

  const t0 = history[0].t;
  const t1 = history[history.length - 1].t;
  const breaks = buildTimeScale(t0, t1);
  const xPos   = makeXPos(PAD, CW, breaks, t0, t1);
  const yPos   = v => PAD.top + CH * (1 - Math.min(110, Math.max(0, v)) / 110);

  // ── 曜日ラベル（平日 7:00 JST の開始位置）──────────────────────────────────
  const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];
  const spanDays  = (t1 - t0) / 86_400_000;

  if (spanDays >= 0.3) {
    const jd0 = new Date(t0 + JST); jd0.setUTCHours(0, 0, 0, 0);
    let d = jd0.getTime() - JST;
    while (d <= t1 + 86_400_000) {
      const jd  = new Date(d + JST);
      const dow = jd.getUTCDay();
      if (dow !== 0 && dow !== 6) {
        const nx = new Date(jd); nx.setUTCHours(7, 0, 0, 0);
        const t7 = nx.getTime() - JST;
        if (t7 >= t0 && t7 <= t1) {
          const x = xPos(t7);
          ctx.strokeStyle = '#191b36';
          ctx.lineWidth = 1;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(x, PAD.top);
          ctx.lineTo(x, PAD.top + CH);
          ctx.stroke();
          ctx.fillStyle    = '#9499c8';
          ctx.font         = 'bold 9px sans-serif';
          ctx.textAlign    = 'left';
          ctx.textBaseline = 'top';
          ctx.fillText(DAY_NAMES[dow], x + 3, PAD.top + 3);
        }
      }
      d += 86_400_000;
    }
  }

  // ── Y軸グリッド＋ラベル ──────────────────────────────────────────────────────
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

  // ── X軸ラベル（最大 6 tick）────────────────────────────────────────────────
  const ticks = Math.min(6, history.length - 1);
  for (let i = 0; i <= ticks; i++) {
    const idx = Math.round((i / ticks) * (history.length - 1));
    const x   = xPos(history[idx].t);
    ctx.fillStyle = MUTED;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(fmtTime(history[idx].t), x, PAD.top + CH + 6);
  }

  // ── クリップ ───────────────────────────────────────────────────────────────
  ctx.save();
  ctx.beginPath();
  ctx.rect(PAD.left, PAD.top, CW, CH);
  ctx.clip();

  const validS = history.filter(p => p.s != null);
  const validW = history.filter(p => p.w != null);

  // 週間制限ライン
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
      const x = xPos(p.t);
      if (i > 0 && x - xPos(validW[i - 1].t) >= 1) ctx.lineTo(x, yPos(p.w));
      else ctx.moveTo(x, yPos(p.w));
    });
    ctx.stroke();
  }

  // セッションライン（モデル別色）
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

    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (let i = 1; i < validS.length; i++) {
      const p0 = validS[i - 1], p1 = validS[i];
      const x0 = xPos(p0.t), x1 = xPos(p1.t);
      if (x1 - x0 < 1) continue; // ギャップ（夜間・土日）はスキップ
      ctx.strokeStyle = modelColor(p1.model);
      ctx.beginPath();
      ctx.moveTo(x0, yPos(p0.s));
      ctx.lineTo(x1, yPos(p1.s));
      ctx.stroke();
    }
  }

  // スパイクマーカー
  let maxSpike = null;
  validS.forEach((pt, i) => {
    if (i === 0) return;
    const delta = pt.s - validS[i - 1].s;
    if (delta < 3) return;
    if (!maxSpike || delta > maxSpike.delta) maxSpike = { delta: Math.round(delta), t: pt.t };

    const x = xPos(pt.t), y = yPos(pt.s);
    ctx.shadowColor = ORANGE;
    ctx.shadowBlur  = 12;
    ctx.fillStyle   = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    if (delta >= 5) {
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur  = 4;
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`+${Math.round(delta)}%`, x, y - 8);
      ctx.shadowBlur = 0;
    }
  });

  ctx.restore();
  return maxSpike;
}

// ── Main ─────────────────────────────────────────────────────────────────────

function applyTabLayout(canvas) {
  const w = Math.max(window.innerWidth - 40, 740);
  document.body.classList.add('tab-mode');
  canvas.width = w;
  canvas.style.width = w + 'px';
}

async function main() {
  const { cco_history = [], cco_current = {} } =
    await chrome.storage.local.get(['cco_history', 'cco_current']);

  const canvas = document.getElementById('chart');
  applyTabLayout(canvas);
  const maxSpike = drawChart(canvas, cco_history);

  const s = cco_current.session;
  const w = cco_current.weekly;
  document.getElementById('stat-session').textContent = s ? s.pct + '%' : '--%';
  document.getElementById('stat-weekly').textContent  = w ? w.pct + '%' : '--%';

  const model = cco_current.model;
  if (model) {
    const el = document.getElementById('stat-model');
    el.textContent = modelLabel(model);
    el.style.color = modelColor(model);
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
