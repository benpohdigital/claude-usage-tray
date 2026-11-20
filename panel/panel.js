'use strict';

const api = window.usageApi;
const $ = (id) => document.getElementById(id);
const card = $('card');
const rowsEl = $('rows');
const noticeEl = $('notice');
const updatedEl = $('updated');
const refreshBtn = $('refresh');
const th = [$('th0'), $('th1')];

let state = null;

// ---------- formatting (local time zone) ----------

const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function parseDate(iso) {
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(d) ? d : null;
}

function resetText(win) {
  const d = parseDate(win.resetsAt);
  if (!d) return '';
  if (win.kind === 'session') {
    const mins = Math.floor((d - Date.now()) / 60000);
    if (mins < 1) return 'Resets soon';
    const h = Math.floor(mins / 60), m = mins % 60;
    if (!h) return `Resets in ${m} min`;
    return m ? `Resets in ${h} h ${m} min` : `Resets in ${h} h`;
  }
  return `Resets ${weekdayFmt.format(d)} ${timeFmt.format(d)}`;
}

function agoText(ms) {
  if (!ms) return '';
  const mins = Math.floor((Date.now() - ms) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} h ago`;
  return `${weekdayFmt.format(ms)} ${timeFmt.format(ms)}`;
}

const pctText = (u) => `${Math.round(u)}%`;
const clamp = (u) => Math.max(0, Math.min(100, Number(u) || 0));

// ---------- DOM helpers ----------

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function bar(utilization) {
  const u = clamp(utilization);
  const fill = el('div', 'fill' + (u >= 90 ? ' crit' : u >= 75 ? ' warn' : ''));
  fill.style.width = u + '%';
  const track = el('div', 'bar');
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', '100');
  track.setAttribute('aria-valuenow', String(Math.round(u)));
  track.append(fill);
  return track;
}

function row(label, sub, right, utilization) {
  const wrap = el('div', 'row');
  const top = el('div', 'row-top');
  const left = el('div');
  left.append(el('div', 'label', label));
  if (sub) left.append(el('div', 'sub', sub));
  top.append(left, el('div', 'pct', right));
  wrap.append(top);
  if (utilization != null) wrap.append(bar(utilization));
  return wrap;
}

// ---------- render ----------

const STALE = new Set(['offline', 'rate-limited', 'server-error']);
const BLOCKING = new Set(['no-credentials', 'unauthorized']);

function render() {
  if (!state) return;
  const { status, message, fetchedAt, windows = [], extraUsage, paceWarning, settings } = state;

  // Notice
  let notice = message || '';
  if (!notice && status === 'loading' && !windows.length) notice = 'Loading…';
  if (STALE.has(status) && fetchedAt) notice += (notice ? ' · ' : '') + `Last updated ${agoText(fetchedAt)}`;
  noticeEl.textContent = notice;
  noticeEl.hidden = !notice;
  noticeEl.classList.toggle('big', BLOCKING.has(status) || (!windows.length && status !== 'loading'));

  // Rows
  const frag = document.createDocumentFragment();
  if (!BLOCKING.has(status)) {
    for (const w of windows) {
      const r = row(w.label, resetText(w), pctText(w.utilization), w.utilization);
      if (w.kind === 'weekly' && paceWarning) {
        r.append(el('p', 'pace', 'On pace to hit the weekly limit before reset.'));
      }
      frag.append(r);
    }
    if (extraUsage) {
      const on = !!extraUsage.isEnabled;
      const hasU = on && typeof extraUsage.utilization === 'number';
      const right = on ? (hasU ? `On · ${pctText(extraUsage.utilization)}` : 'On') : 'Off';
      frag.append(row('Extra usage', null, right, hasU ? extraUsage.utilization : null));
    }
  }
  rowsEl.replaceChildren(frag);

  renderUpdated();
  if (settings) renderSettings(settings);
}

function renderUpdated() {
  const ago = state && agoText(state.fetchedAt);
  updatedEl.textContent = ago ? `Updated ${ago}` : '';
}

function renderSettings(s) {
  // Do not clobber a field the user is editing.
  const set = (input, prop, value) => { if (document.activeElement !== input) input[prop] = value; };
  set($('alertsEnabled'), 'checked', !!s.alertsEnabled);
  set($('showPercent'), 'checked', !!s.showPercent);
  set($('openAtLogin'), 'checked', !!s.openAtLogin);
  const t = Array.isArray(s.thresholds) ? s.thresholds : [75, 90];
  th.forEach((input, i) => {
    set(input, 'value', String(t[i] ?? ''));
    input.disabled = !s.alertsEnabled;
  });
}

function apply(next) {
  if (next && typeof next === 'object') {
    state = next;
    render();
  }
}

// ---------- actions ----------

async function setSetting(key, value) {
  try { apply(await api.setSetting(key, value)); } catch (e) { console.error(e); render(); }
}

for (const key of ['alertsEnabled', 'showPercent', 'openAtLogin']) {
  $(key).addEventListener('change', (e) => setSetting(key, e.target.checked));
}

function onThresholdChange() {
  const vals = th.map((i) => Number(i.value));
  if (!vals.every((v) => Number.isInteger(v) && v >= 1 && v <= 100)) {
    if (state && state.settings) renderSettings(state.settings); // revert invalid input
    return;
  }
  setSetting('thresholds', vals.sort((a, b) => a - b));
}
th.forEach((i) => i.addEventListener('change', onThresholdChange));

refreshBtn.addEventListener('click', async () => {
  if (refreshBtn.disabled) return;
  refreshBtn.disabled = true;
  refreshBtn.textContent = 'Refreshing…';
  try { apply(await api.refresh()); } catch (e) { console.error(e); }
  finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = 'Refresh';
  }
});

$('quit').addEventListener('click', () => api && api.quit());

// ---------- sizing ----------

new ResizeObserver(() => {
  if (api) api.resize(Math.ceil(card.getBoundingClientRect().height));
}).observe(card);

// ---------- start ----------

if (!api) {
  noticeEl.textContent = 'Bridge not available';
  noticeEl.hidden = false;
} else {
  api.onUpdate(apply);
  api.getUsage().then(apply, (e) => console.error(e));
  // Keep "Updated … ago" and session countdown fresh.
  setInterval(render, 30000);
}
