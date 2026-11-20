// Threshold alerts. Each threshold fires once per usage window; the sent state is
// keyed by resets_at so a new window starts clean. State survives restarts.
const fs = require('fs');

const WEEK_MS = 7 * 24 * 3600 * 1000;

function formatIn(ms) {
  const mins = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${h} h ${m} min` : `${m} min`;
}

const hhmm = (d) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
const dayTime = (d) => `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${hhmm(d)}`;

function name(w) {
  if (w.kind === 'session') return 'session';
  if (w.kind === 'weekly') return 'weekly';
  return w.label.replace(/^Weekly \((.*)\)$/, 'weekly $1');
}

function message(w, threshold, now) {
  const parsed = w.resetsAt ? new Date(w.resetsAt) : null;
  const reset = parsed && !isNaN(parsed) ? parsed : null;
  if (threshold >= 100) {
    const at = reset ? (w.kind === 'session' ? ` Resets at ${hhmm(reset)}.` : ` Resets ${dayTime(reset)}.`) : '';
    return `Claude ${name(w)} limit reached.${at}`;
  }
  const subject = w.kind === 'session' ? 'session' : `${name(w)} usage`;
  const when = !reset ? '' : w.kind === 'session' ? ` Resets in ${formatIn(reset - now)}.` : ` Resets ${dayTime(reset)}.`;
  return `Claude ${subject} at ${threshold}%.${when}`;
}

// The API's resets_at jitters by fractions of a second between calls, so only a
// clear jump (a new window starts hours later) counts as a new window.
function sameWindow(a, b) {
  if (a === b) return true;
  const ta = Date.parse(a), tb = Date.parse(b);
  return !isNaN(ta) && !isNaN(tb) && Math.abs(ta - tb) < 10 * 60 * 1000;
}

class Alerts {
  constructor(file) {
    this.file = file;
    try { this.state = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { this.state = {}; }
  }

  save() {
    try { fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2)); } catch (e) { console.error('[alerts] save failed:', e.message); }
  }

  // Returns notification texts to send now. Records them as sent.
  check(windows, thresholds, now = Date.now()) {
    const out = [];
    let changed = false;
    for (const w of windows) {
      // 75/90 alerts for session + weekly; every window gets the 100% alert.
      const levels = w.kind === 'model' ? [100] : [...thresholds, 100];
      let entry = this.state[w.key];
      if (!entry || !sameWindow(entry.resetsAt, w.resetsAt)) {
        entry = this.state[w.key] = { resetsAt: w.resetsAt, sent: [] };
        changed = true;
      }
      const crossed = levels.filter((t) => w.utilization >= t && !entry.sent.includes(t));
      if (!crossed.length) continue;
      // If several thresholds were crossed between polls, only announce the highest.
      out.push(message(w, Math.max(...crossed), now));
      entry.sent.push(...crossed);
      changed = true;
    }
    if (changed) this.save();
    return out;
  }
}

// True when any shown window is at or over the lowest alert threshold.
function anyActive(windows, thresholds) {
  return windows.some((w) => w.utilization >= (w.kind === 'model' ? 100 : Math.min(...thresholds)));
}

// Weekly pace: more of the limit used than of the week elapsed (with a small margin
// so the first hours of a week do not trigger it).
function paceWarning(windows, now = Date.now()) {
  const w = windows.find((x) => x.kind === 'weekly');
  if (!w || !w.resetsAt || w.utilization >= 100) return false;
  const elapsed = 1 - (new Date(w.resetsAt) - now) / WEEK_MS;
  return w.utilization >= 15 && w.utilization > elapsed * 100 + 5;
}

module.exports = { Alerts, anyActive, paceWarning, formatIn };
