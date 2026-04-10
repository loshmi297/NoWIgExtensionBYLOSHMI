'use strict';

function americanToImplied(odds) {
  const o = parseFloat(odds);
  if (isNaN(o)) return null;
  return o < 0 ? Math.abs(o) / (Math.abs(o) + 100) : 100 / (o + 100);
}
function removeVig(iY, iN) {
  const t = iY + iN; return { yes: iY / t, no: iN / t };
}
function normalizePrice(val) {
  let n = parseFloat(val);
  if (isNaN(n)) return null;
  if (n > 1) n = n / 100;
  return (n >= 0.01 && n <= 0.99) ? n : null;
}
function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function edgeColor(e) {
  return e >= 0.10 ? 'var(--green)' : e >= 0.05 ? 'var(--yellow)' : e > 0 ? 'var(--muted2)' : 'var(--red)';
}

// ─── PERSIST ─────────────────────────────────────────────
const FIELDS = ['labelA', 'labelB', 'oddsOver', 'oddsUnder', 'polyOver', 'polyUnder', 'marketLabel'];

function saveState() {
  const s = {};
  FIELDS.forEach(id => { const el = document.getElementById(id); if (el) s[id] = el.value; });
  chrome.storage.local.set({ formState: s });
}

document.addEventListener('DOMContentLoaded', () => {
  FIELDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.addEventListener('input', saveState); el.addEventListener('change', saveState); }
  });
  init();
});

function init() {
  chrome.storage.local.get({ formState: {}, lastResult: null }, (data) => {
    FIELDS.forEach(id => {
      const el = document.getElementById(id);
      if (el && data.formState[id] !== undefined && data.formState[id] !== '') {
        el.value = data.formState[id];
      }
    });
    syncLabels();
    if (data.lastResult) { lastResult = data.lastResult; renderResult(lastResult); }
  });
}

function getLabel(side) {
  const val = (document.getElementById(side === 'A' ? 'labelA' : 'labelB').value || '').trim().toUpperCase();
  return val || (side === 'A' ? 'SIDE A' : 'SIDE B');
}

function syncLabels() {
  const a = getLabel('A'), b = getLabel('B');
  ['headA','headPA'].forEach(id => { const el = document.getElementById(id); if(el) el.textContent = a; });
  ['headB','headPB'].forEach(id => { const el = document.getElementById(id); if(el) el.textContent = b; });
}

['labelA','labelB'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', syncLabels);
});

// ─── TABS ─────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'history') renderHistory();
  });
});

document.getElementById('openFanduel').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://sportsbook.fanduel.com/' });
});

// ─── CALCULATE ────────────────────────────────────────────
let lastResult = null;

document.getElementById('calcBtn').addEventListener('click', calculate);
document.addEventListener('keydown', e => { if (e.key === 'Enter') calculate(); });

function calculate() {
  const oddsOver  = document.getElementById('oddsOver').value;
  const oddsUnder = document.getElementById('oddsUnder').value;
  const polyOver  = normalizePrice(document.getElementById('polyOver').value);
  const polyUnder = normalizePrice(document.getElementById('polyUnder').value);
  const label     = document.getElementById('marketLabel').value.trim() || 'Unnamed Market';
  const lA = getLabel('A');
  const lB = getLabel('B');

  const implOver  = americanToImplied(oddsOver);
  const implUnder = americanToImplied(oddsUnder);

  if (implOver === null || implUnder === null) { alert('Enter both FanDuel odds.'); return; }
  if (polyOver === null && polyUnder === null) { alert('Enter at least one Polymarket price.'); return; }

  const { yes: trueOver, no: trueUnder } = removeVig(implOver, implUnder);

  // Each market is independent — Over market resolves on whether he goes Over,
  // Under market resolves on whether he goes Under
  const edgeOver  = polyOver  !== null ? trueOver  - polyOver  : null;
  const edgeUnder = polyUnder !== null ? trueUnder - polyUnder : null;

  // Best side
  let best = 'none';
  if (edgeOver !== null && edgeUnder !== null) {
    best = edgeOver >= edgeUnder ? 'over' : 'under';
  } else if (edgeOver !== null) best = 'over';
  else if (edgeUnder !== null) best = 'under';

  const bestEdge = best === 'over' ? edgeOver : edgeUnder;
  const bestPoly = best === 'over' ? polyOver  : polyUnder;
  const bestTrue = best === 'over' ? trueOver  : trueUnder;

  let verdictClass = 'skip';
  if (bestEdge >= 0.10) verdictClass = 'trade';
  else if (bestEdge >= 0.05) verdictClass = 'weak';

  lastResult = {
    label, labelA: lA, labelB: lB, trueOver, trueUnder, polyOver, polyUnder,
    edgeOver, edgeUnder, best, bestEdge, bestPoly, bestTrue,
    verdictClass, edgePct: (bestEdge * 100).toFixed(1), ts: Date.now()
  };

  chrome.storage.local.set({ lastResult });
  renderResult(lastResult);
}

function renderResult(r) {
  const { trueOver, trueUnder, polyOver, polyUnder, edgeOver, edgeUnder,
          best, bestEdge, bestPoly, bestTrue, verdictClass, edgePct } = r;

  function fillRow(side, poly, trueP, edge) {
    const pEl = document.getElementById('v-' + side + '-poly');
    const tEl = document.getElementById('v-' + side + '-true');
    const eEl = document.getElementById('v-' + side + '-edge');
    const row = document.getElementById('row-' + side);
    if (!pEl) return;

    pEl.textContent = poly !== null ? Math.round(poly * 100) + '¢' : '--';
    tEl.textContent = trueP !== null ? (trueP * 100).toFixed(1) + '%' : '--';

    if (edge !== null) {
      eEl.textContent   = (edge >= 0 ? '+' : '') + (edge * 100).toFixed(1) + '%';
      eEl.style.color   = edgeColor(edge);
      eEl.style.fontWeight = '700';
    } else {
      eEl.textContent = '--';
    }

    row.className = 'tw-row' + (side === best ? ' tw-best' : '');
  }

  fillRow('over',  polyOver,  trueOver,  edgeOver);
  fillRow('under', polyUnder, trueUnder, edgeUnder);

  // Verdict
  const ep = parseFloat(edgePct);
  let vText = '';
  const bestLabel = best === 'over' ? (r.labelA || 'SIDE A') : (r.labelB || 'SIDE B');
  if (verdictClass === 'trade') vText = 'BUY ' + bestLabel + ' — STRONG EDGE';
  else if (verdictClass === 'weak') vText = 'BUY ' + bestLabel + ' — WEAK EDGE';
  else if (ep > 0) vText = 'MARGINAL EDGE — PROBABLY SKIP';
  else vText = 'NO EDGE ON EITHER SIDE — SKIP';

  document.getElementById('verdict').className = 'verdict ' + verdictClass;
  document.getElementById('verdict').textContent = vText;

  // Exit targets
  const exitEl = document.getElementById('exitTarget');
  if (verdictClass === 'trade' && bestPoly !== null) {
    const t1 = (bestPoly + bestEdge * 0.5).toFixed(3);
    const t2 = (bestPoly + bestEdge * 0.75).toFixed(3);
    const t3 = bestTrue.toFixed(3);
    exitEl.className = 'exit-target';
    exitEl.innerHTML = 'Exit: <span>$' + t1 + '</span> (50%) &nbsp; <span>$' + t2 + '</span> (75%) &nbsp; <span>$' + t3 + '</span> (full)';
  } else {
    exitEl.className = 'exit-target hidden';
  }

  // Update result row labels
  const lA = lastResult.labelA || 'SIDE A';
  const lB = lastResult.labelB || 'SIDE B';
  const elA = document.getElementById('res-labelA');
  const elB = document.getElementById('res-labelB');
  if (elA) elA.textContent = 'BUY ' + lA;
  if (elB) elB.textContent = 'BUY ' + lB;

  document.getElementById('saveBtn').classList.remove('hidden', 'saved');
  document.getElementById('saveBtn').textContent = 'SAVE TO HISTORY';
  document.getElementById('result').classList.remove('hidden');
}

// ─── SAVE ─────────────────────────────────────────────────
document.getElementById('saveBtn').addEventListener('click', () => {
  if (!lastResult) return;
  chrome.storage.local.get({ history: [] }, (data) => {
    const h = data.history;
    if (h.length && h[0].ts === lastResult.ts) {
      document.getElementById('saveBtn').textContent = 'ALREADY SAVED'; return;
    }
    h.unshift(lastResult);
    if (h.length > 100) h.splice(100);
    chrome.storage.local.set({ history: h }, () => {
      document.getElementById('saveBtn').textContent = 'SAVED';
      document.getElementById('saveBtn').classList.add('saved');
    });
  });
});

// ─── HISTORY ──────────────────────────────────────────────
function renderHistory() {
  chrome.storage.local.get({ history: [] }, (data) => {
    const list  = document.getElementById('historyList');
    const empty = document.getElementById('historyEmpty');
    const stats = document.getElementById('historyStats');
    const history = data.history;

    if (history.length === 0) {
      list.innerHTML = ''; empty.classList.remove('hidden');
      stats.innerHTML = 'No trades saved yet.'; return;
    }

    empty.classList.add('hidden');
    const trades = history.filter(h => h.verdictClass === 'trade').length;
    const avg = (history.reduce((a, h) => a + parseFloat(h.edgePct), 0) / history.length).toFixed(1);
    stats.innerHTML = '<strong>' + history.length + '</strong> saved &nbsp;&middot;&nbsp; <strong>' + trades + '</strong> trades &nbsp;&middot;&nbsp; avg <strong>+' + avg + '%</strong>';

    list.innerHTML = history.map(h => {
      const ep = parseFloat(h.edgePct);
      const cls = ep >= 10 ? 'green' : ep >= 5 ? 'yellow' : 'red';
      const overE  = h.edgeOver  !== null ? (h.edgeOver * 100).toFixed(1)  : '--';
      const underE = h.edgeUnder !== null ? (h.edgeUnder * 100).toFixed(1) : '--';
      return '<div class="history-item">' +
        '<div class="hi-top"><div class="hi-label">' + escHtml(h.label) + '</div>' +
        '<div class="hi-edge ' + cls + '">' + (ep >= 0 ? '+' : '') + h.edgePct + '%</div></div>' +
        '<div class="hi-bottom">' +
          '<span>O: ' + (h.polyOver ? Math.round(h.polyOver*100) + '¢' : '--') + ' (' + (parseFloat(overE) >= 0 ? '+' : '') + overE + '%)</span>' +
          '<span>U: ' + (h.polyUnder ? Math.round(h.polyUnder*100) + '¢' : '--') + ' (' + (parseFloat(underE) >= 0 ? '+' : '') + underE + '%)</span>' +
        '</div>' +
        '<div style="display:flex;justify-content:space-between;margin-top:5px;">' +
        '<div class="hi-date">' + formatDate(h.ts) + '</div>' +
        '<div class="hi-verdict ' + h.verdictClass + '">' + h.verdictClass.toUpperCase() + '</div>' +
        '</div></div>';
    }).join('');
  });
}

document.getElementById('clearHistory').addEventListener('click', () => {
  if (!confirm('Clear all history?')) return;
  chrome.storage.local.set({ history: [], lastResult: null }, renderHistory);
});
