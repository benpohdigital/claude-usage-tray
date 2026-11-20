// Reads the Claude Code OAuth token from the Keychain and fetches plan usage.
// The token never leaves this module except as a request header to api.anthropic.com.
const { execFile } = require('child_process');

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const KEYCHAIN_SERVICE = 'Claude Code-credentials';

const LABELS = {
  five_hour: 'Current session',
  seven_day: 'Weekly (all models)',
  seven_day_sonnet: 'Weekly (Sonnet)',
  seven_day_opus: 'Weekly (Opus)',
};

class UsageError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function readToken() {
  return new Promise((resolve, reject) => {
    execFile('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'], (err, stdout) => {
      if (err) return reject(new UsageError('no-credentials', 'Claude Code not signed in'));
      try {
        const creds = JSON.parse(stdout.trim());
        const token = creds?.claudeAiOauth?.accessToken ?? creds?.accessToken;
        if (typeof token !== 'string' || !token) throw new Error('no accessToken');
        resolve(token);
      } catch {
        reject(new UsageError('no-credentials', 'Claude Code not signed in'));
      }
    });
  });
}

function isWindow(v) {
  return v && typeof v === 'object' && typeof v.utilization === 'number';
}

// Turns the raw response into display rows. Unknown fields are ignored; unknown
// seven_day_* windows are shown as extra per-model rows.
function parse(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('response is not an object');

  const windows = [];
  const add = (key, kind) => {
    const w = raw[key];
    if (!isWindow(w)) return;
    windows.push({
      key,
      kind,
      label: LABELS[key] || `Weekly (${key.replace(/^seven_day_/, '').replace(/_/g, ' ')})`,
      utilization: Math.max(0, Math.min(100, w.utilization)),
      resetsAt: typeof w.resets_at === 'string' ? w.resets_at : null,
    });
  };
  add('five_hour', 'session');
  add('seven_day', 'weekly');
  add('seven_day_sonnet', 'model');
  add('seven_day_opus', 'model');
  for (const key of Object.keys(raw)) {
    if (/^seven_day_/.test(key) && !LABELS[key]) add(key, 'model');
  }

  const ex = raw.extra_usage;
  const extraUsage = ex && typeof ex === 'object'
    ? { isEnabled: !!ex.is_enabled, utilization: typeof ex.utilization === 'number' ? ex.utilization : null }
    : null;

  if (!windows.length && !extraUsage) throw new Error('no usage windows in response');
  return { windows, extraUsage };
}

async function fetchUsage() {
  const token = await readToken();
  let res;
  try {
    res = await fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'Content-Type': 'application/json',
        'User-Agent': 'claude-usage-tray/0.1',
      },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new UsageError('offline', 'Offline');
  }

  if (res.status === 401) throw new UsageError('unauthorized', 'Sign in to Claude Code again');
  if (res.status === 429) throw new UsageError('rate-limited', 'Rate limited by the server');
  if (res.status >= 500) throw new UsageError('server-error', `Server error (${res.status})`);
  if (!res.ok) throw new UsageError('unavailable', 'Usage data not available');

  try {
    return parse(await res.json());
  } catch (e) {
    console.error('[usage] unexpected response:', e.message);
    throw new UsageError('unavailable', 'Usage data not available');
  }
}

module.exports = { fetchUsage, parse, UsageError };
