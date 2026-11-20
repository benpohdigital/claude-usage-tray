const path = require('path');
const fs = require('fs');
const { app, Tray, BrowserWindow, ipcMain, screen, powerMonitor, Notification } = require('electron');
const { fetchUsage } = require('./usage');
const { drawIcon } = require('./icon');
const { Alerts, anyActive, paceWarning } = require('./alerts');

const MIN = 60 * 1000;
const POLL_INTERVAL = 5 * MIN;
const MIN_INTERVAL = 1 * MIN;
const MAX_BACKOFF = 15 * MIN;
const OFFLINE_RETRY = 2 * MIN;
const PANEL_WIDTH = 320;

const DEFAULT_SETTINGS = { alertsEnabled: true, thresholds: [75, 90], showPercent: false };

let tray, panel, alerts, settingsFile;
let settings = { ...DEFAULT_SETTINGS };
let lastGood = null;              // { windows, extraUsage, fetchedAt }
let status = 'loading', message = null;
let lastAttempt = 0, failures = 0, inFlight = null, timer = null;

if (!app.requestSingleInstanceLock()) app.quit();

// ---------- settings ----------

function loadSettings() {
  try { settings = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsFile, 'utf8')) }; } catch {}
}

function saveSettings() {
  try { fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2)); } catch (e) { console.error('[settings]', e.message); }
}

function setSetting(key, value) {
  if (key === 'openAtLogin') {
    app.setLoginItemSettings({ openAtLogin: !!value });
  } else if (key === 'thresholds') {
    const t = Array.isArray(value) ? value.map(Number).filter((n) => n >= 1 && n <= 100) : [];
    if (t.length !== 2) return;
    settings.thresholds = t.sort((a, b) => a - b);
  } else if (key === 'alertsEnabled' || key === 'showPercent') {
    settings[key] = !!value;
  } else {
    return;
  }
  saveSettings();
  render();
}

// ---------- state ----------

function getState() {
  const windows = lastGood ? lastGood.windows : [];
  return {
    status,
    message,
    fetchedAt: lastGood ? lastGood.fetchedAt : null,
    windows,
    extraUsage: lastGood ? lastGood.extraUsage : null,
    paceWarning: paceWarning(windows),
    settings: { ...settings, openAtLogin: app.getLoginItemSettings().openAtLogin },
  };
}

function render() {
  const session = lastGood && lastGood.windows.find((w) => w.kind === 'session');
  const percent = session ? session.utilization : null;
  const alert = settings.alertsEnabled && !!lastGood && anyActive(lastGood.windows, settings.thresholds);
  tray.setImage(drawIcon({ percent, alert }));
  tray.setTitle(settings.showPercent && percent != null ? ` ${Math.round(percent)}%` : '');
  tray.setToolTip(percent != null ? `Claude session: ${Math.round(percent)}%` : message || 'Claude usage');
  if (panel && !panel.isDestroyed()) panel.webContents.send('usage:update', getState());
}

// ---------- polling ----------

function schedule(delay) {
  clearTimeout(timer);
  timer = setTimeout(() => poll(), delay);
}

async function poll({ force = false } = {}) {
  if (inFlight) return inFlight;
  if (!force && Date.now() - lastAttempt < MIN_INTERVAL) return;
  lastAttempt = Date.now();
  inFlight = (async () => {
    let next = POLL_INTERVAL;
    try {
      const data = await fetchUsage();
      lastGood = { ...data, fetchedAt: Date.now() };
      status = 'ok';
      message = null;
      failures = 0;
      if (settings.alertsEnabled) {
        for (const body of alerts.check(lastGood.windows, settings.thresholds)) notify(body);
      }
    } catch (e) {
      status = e.status || 'unavailable';
      message = e.status ? e.message : 'Usage data not available';
      if (!e.status) console.error('[poll]', e);
      if (status === 'no-credentials' || status === 'unauthorized') {
        lastGood = null;          // grey bar; Keychain is read again on the next poll
      } else if (status === 'rate-limited' || status === 'server-error') {
        failures++;
        next = Math.min(MAX_BACKOFF, POLL_INTERVAL * 2 ** (failures - 1) * 2);
      } else if (status === 'offline') {
        next = OFFLINE_RETRY;
      }
    } finally {
      inFlight = null;
      schedule(next);
      render();
    }
  })();
  return inFlight;
}

function notify(body) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: 'Claude usage', body });
  n.on('click', showPanel);
  n.show();
}

// ---------- panel ----------

function createPanel() {
  panel = new BrowserWindow({
    width: PANEL_WIDTH,
    height: 360,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    transparent: true,
    hasShadow: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  panel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  panel.loadFile(path.join(__dirname, 'panel', 'index.html'));
  panel.on('blur', () => panel.hide());
  panel.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  panel.webContents.on('will-navigate', (e) => e.preventDefault());
}

function positionPanel() {
  const t = tray.getBounds();
  const { width, height } = panel.getBounds();
  const area = screen.getDisplayNearestPoint({ x: t.x, y: t.y }).workArea;
  const x = Math.round(Math.min(Math.max(t.x + t.width / 2 - width / 2, area.x + 8), area.x + area.width - width - 8));
  const y = Math.round(t.y + t.height + 4);
  panel.setBounds({ x, y, width, height });
}

function showPanel() {
  positionPanel();
  panel.show();
  panel.focus();
  render();
  if (!lastGood || Date.now() - lastGood.fetchedAt > MIN_INTERVAL) poll();
}

function togglePanel() {
  if (panel.isVisible()) panel.hide();
  else showPanel();
}

// ---------- app ----------

app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock.hide();
  settingsFile = path.join(app.getPath('userData'), 'settings.json');
  alerts = new Alerts(path.join(app.getPath('userData'), 'alerts.json'));
  loadSettings();

  tray = new Tray(drawIcon({ percent: null, alert: false }));
  tray.setIgnoreDoubleClickEvents(true);
  tray.on('click', togglePanel);
  tray.on('right-click', togglePanel);
  createPanel();

  ipcMain.handle('usage:get', () => getState());
  ipcMain.handle('usage:refresh', async () => { await poll(); return getState(); });
  ipcMain.handle('settings:set', (_e, key, value) => { setSetting(key, value); return getState(); });
  ipcMain.on('app:quit', () => app.quit());
  ipcMain.on('panel:resize', (_e, h) => {
    const height = Math.max(80, Math.min(800, Math.ceil(Number(h) || 0)));
    const b = panel.getBounds();
    if (b.height !== height) panel.setBounds({ ...b, height });
  });

  powerMonitor.on('suspend', () => clearTimeout(timer));
  // Give the network a few seconds to come back, then poll once.
  powerMonitor.on('resume', () => schedule(5000));

  poll({ force: true });
});

app.on('window-all-closed', (e) => e.preventDefault());
