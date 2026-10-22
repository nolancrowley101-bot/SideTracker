const path = require('path');
const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, nativeImage } = require('electron');
const config = require('./lib/config');
const ollama = require('./lib/ollama');
const { Tracker } = require('./lib/tracker');

app.setAppUserModelId('com.sidetracker.app'); // required for Windows notifications

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let win = null;
let tray = null;
let quitting = false;
const tracker = new Tracker();
const iconPath = path.join(__dirname, '..', 'build', 'icon.png');

function createWindow() {
  win = new BrowserWindow({
    width: 880,
    height: 760,
    minWidth: 720,
    minHeight: 560,
    title: 'SideTracker',
    backgroundColor: '#14171f',
    autoHideMenuBar: true,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide(); // keep tracking from the tray
    }
  });
}

function showWindow() {
  if (!win) createWindow();
  win.show();
  win.focus();
}

function buildTray() {
  const img = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip('SideTracker');
  tray.on('click', showWindow);
  const refresh = () => {
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open SideTracker', click: showWindow },
        {
          label: tracker.running ? 'Pause tracking' : 'Start tracking',
          click: () => (tracker.running ? tracker.stop() : tracker.start())
        },
        { type: 'separator' },
        { label: 'Quit', click: () => { quitting = true; app.quit(); } }
      ])
    );
  };
  refresh();
  tracker.on('status', refresh);
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function applyLoginItem(cfg) {
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!cfg.launchAtLogin });
}

async function ollamaStatus() {
  const cfg = config.load();
  const up = await ollama.ensureRunning(cfg.ollamaUrl);
  if (!up) return { up: false, installed: {} };
  let names = [];
  try { names = await ollama.listModels(cfg.ollamaUrl); } catch { /* ignore */ }
  const installed = {};
  for (const tier of Object.keys(cfg.models)) installed[tier] = ollama.hasModel(names, cfg.models[tier]);
  return { up: true, installed };
}

function registerIpc() {
  ipcMain.handle('config:get', () => config.publicView());
  ipcMain.handle('config:set', (_e, patch) => {
    config.update(patch);
    applyLoginItem(config.load());
    return config.publicView();
  });
  ipcMain.handle('key:set', (_e, key) => {
    config.setApiKey(typeof key === 'string' ? key : '');
    return config.publicView();
  });
  ipcMain.handle('tracker:state', () => ({ status: tracker.status(), log: tracker.log }));
  ipcMain.handle('tracker:toggle', () => {
    tracker.running ? tracker.stop() : tracker.start();
    return tracker.status();
  });
  ipcMain.handle('tracker:now', () => { tracker.tick(); });
  ipcMain.handle('ollama:status', ollamaStatus);
  ipcMain.handle('ollama:pull', async (_e, tier) => {
    const cfg = config.load();
    const model = cfg.models[tier];
    if (!model) throw new Error('Unknown model tier');
    if (!(await ollama.ensureRunning(cfg.ollamaUrl))) throw new Error('Ollama is not installed or not running. Install it from ollama.com.');
    await ollama.pull(cfg.ollamaUrl, model, (p) => send('ollama:progress', { tier, ...p }));
    return ollamaStatus();
  });
}

app.on('second-instance', showWindow);

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  buildTray();

  tracker.on('status', (s) => send('tracker:status', s));
  tracker.on('log', (e) => send('tracker:log', e));
  tracker.on('sidetracked', ({ minutes, activity, goal }) => {
    if (!Notification.isSupported()) return;
    const n = new Notification({
      title: `You've been sidetracked for ${minutes} min`,
      body: `${activity}${goal ? `\nBack to: ${goal}` : ''}`,
      icon: iconPath
    });
    n.on('click', showWindow);
    n.show();
  });

  const cfg = config.load();
  applyLoginItem(cfg);
  if (cfg.autoStart && config.getApiKey()) tracker.start();
  // When launched at login, stay in the tray.
  if (process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAtLogin) win.hide();
});

app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { /* stay alive in tray */ });
