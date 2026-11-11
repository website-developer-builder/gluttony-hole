'use strict';

const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { devour } = require('./devour');

const SIZES = { Small: 180, Medium: 260, Large: 360 };
const CORNERS = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];
const MARGIN = 18;

let win = null;
let tray = null;
let settings = null;

// ---------- settings ----------
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const DEFAULTS = {
  size: 'Medium', corner: 'bottom-right', position: null, style: 'tilted',
  confirm: false, sound: true, quality: 'high', openAtLogin: false,
  devouredCount: 0, devouredBytes: 0,
};
function loadSettings() {
  try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; }
  catch { settings = { ...DEFAULTS }; }
}
function saveSettings() {
  try { fs.mkdirSync(path.dirname(settingsFile()), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); }
  catch { /* ignore */ }
}

// ---------- helpers ----------
function fmtBytes(b) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0; let n = b;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i ? 1 : 0)} ${u[i]}`;
}

function cornerBounds(corner, size) {
  const wa = screen.getPrimaryDisplay().workArea;
  const x = corner.endsWith('left') ? wa.x + MARGIN : wa.x + wa.width - size - MARGIN;
  const y = corner.startsWith('top') ? wa.y + MARGIN : wa.y + wa.height - size - MARGIN;
  return { x: Math.round(x), y: Math.round(y), width: size, height: size };
}

function initialBounds() {
  const size = SIZES[settings.size] || SIZES.Medium;
  if (settings.position) {
    const { x, y } = settings.position;
    const onScreen = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return x + size / 2 >= a.x && x + size / 2 <= a.x + a.width && y + size / 2 >= a.y && y + size / 2 <= a.y + a.height;
    });
    if (onScreen) return { x, y, width: size, height: size };
  }
  return cornerBounds(settings.corner, size);
}

function appPaths() {
  // The running executable / bundle, so the hole can never eat itself.
  const exe = app.getPath('exe');
  const list = [app.getAppPath()];
  if (process.platform === 'darwin') {
    const i = exe.indexOf('.app/');
    if (i > 0) list.push(exe.slice(0, i + 4));
  } else {
    list.push(path.dirname(exe));
  }
  return list;
}

// ---------- window ----------
function createWindow() {
  const b = initialBounds();
  win = new BrowserWindow({
    ...b,
    transparent: true,
    frame: false,
    resizable: false,
    movable: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    focusable: true,
    backgroundColor: '#00000000',
    title: 'Gluttony Hole',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, 'floating');
  if (process.platform === 'darwin') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('did-finish-load', pushConfig);

  // Never navigate away when something is dropped outside our drop handler.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  win.on('moved', () => {
    const [x, y] = win.getPosition();
    settings.position = { x, y };
    saveSettings();
  });
}

function pushConfig() {
  if (!win) return;
  win.webContents.send('config', {
    style: settings.style, sound: settings.sound, quality: settings.quality,
  });
}

function applySize() {
  const size = SIZES[settings.size];
  const [x, y] = win.getPosition();
  const [w] = win.getSize();
  // keep the centre where it is
  const c = Math.round((w - size) / 2);
  win.setBounds({ x: x + c, y: y + c, width: size, height: size });
}

function snapTo(corner) {
  settings.corner = corner;
  settings.position = null;
  win.setBounds(cornerBounds(corner, SIZES[settings.size]));
  const [x, y] = win.getPosition();
  settings.position = { x, y };
  saveSettings();
}

// ---------- menu / tray ----------
function buildMenu() {
  const radio = (label, checked, click) => ({ label, type: 'radio', checked, click });
  return Menu.buildFromTemplate([
    { label: `Devoured: ${settings.devouredCount} item${settings.devouredCount === 1 ? '' : 's'} · ${fmtBytes(settings.devouredBytes)}`, enabled: false },
    { type: 'separator' },
    {
      label: 'Move to corner',
      submenu: CORNERS.map((c) => ({ label: c.replace('-', ' ').replace(/\b\w/g, (m) => m.toUpperCase()), click: () => snapTo(c) })),
    },
    {
      label: 'Size',
      submenu: Object.keys(SIZES).map((s) => radio(s, settings.size === s, () => { settings.size = s; saveSettings(); applySize(); refreshMenus(); })),
    },
    {
      label: 'Look',
      submenu: [
        radio('Tilted (cinematic)', settings.style === 'tilted', () => { settings.style = 'tilted'; saveSettings(); pushConfig(); refreshMenus(); }),
        radio('Warm glow', settings.style === 'classic', () => { settings.style = 'classic'; saveSettings(); pushConfig(); refreshMenus(); }),
        radio('Edge-on', settings.style === 'edge', () => { settings.style = 'edge'; saveSettings(); pushConfig(); refreshMenus(); }),
      ],
    },
    {
      label: 'Render quality',
      submenu: [
        radio('High', settings.quality === 'high', () => { settings.quality = 'high'; saveSettings(); pushConfig(); refreshMenus(); }),
        radio('Battery saver', settings.quality === 'low', () => { settings.quality = 'low'; saveSettings(); pushConfig(); refreshMenus(); }),
      ],
    },
    { type: 'separator' },
    { label: 'Ask before devouring', type: 'checkbox', checked: settings.confirm, click: (i) => { settings.confirm = i.checked; saveSettings(); } },
    { label: 'Sound', type: 'checkbox', checked: settings.sound, click: (i) => { settings.sound = i.checked; saveSettings(); pushConfig(); } },
    {
      label: 'Launch at login', type: 'checkbox', checked: settings.openAtLogin,
      click: (i) => { settings.openAtLogin = i.checked; saveSettings(); app.setLoginItemSettings({ openAtLogin: i.checked }); },
    },
    { type: 'separator' },
    { label: 'Show / Hide', click: () => (win.isVisible() ? win.hide() : win.showInactive()) },
    { label: 'Quit Gluttony Hole', role: 'quit' },
  ]);
}

function trayImage() {
  const file = path.join(__dirname, 'assets', process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png');
  const img = nativeImage.createFromPath(file);
  if (process.platform === 'darwin') img.setTemplateImage(true);
  return img;
}

function refreshMenus() {
  if (!tray) return;
  tray.setContextMenu(buildMenu());
  tray.setToolTip(`Gluttony Hole — ${settings.devouredCount} devoured (${fmtBytes(settings.devouredBytes)})`);
}

// ---------- IPC ----------
ipcMain.handle('devour', async (_e, paths) => {
  if (!Array.isArray(paths) || !paths.length) return [];
  paths = paths.filter((p) => typeof p === 'string');

  if (settings.confirm) {
    const names = paths.map((p) => path.basename(p));
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Devour forever', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: `Permanently delete ${paths.length} item${paths.length === 1 ? '' : 's'}?`,
      detail: `${names.slice(0, 8).join('\n')}${names.length > 8 ? `\n…and ${names.length - 8} more` : ''}\n\nThis skips the Trash and cannot be undone.`,
    });
    if (response !== 0) return paths.map((p) => ({ path: p, ok: false, error: 'Cancelled', cancelled: true }));
  }

  const results = await devour(paths, appPaths());
  for (const r of results) {
    if (r.ok) { settings.devouredCount += 1; settings.devouredBytes += r.bytes || 0; }
  }
  saveSettings();
  refreshMenus();
  return results;
});

ipcMain.on('move-by', (_e, dx, dy) => {
  if (!win || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
  const [x, y] = win.getPosition();
  win.setPosition(Math.round(x + dx), Math.round(y + dy));
});

ipcMain.on('show-menu', () => buildMenu().popup({ window: win }));

// ---------- lifecycle ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { win.showInactive(); } });

  app.whenReady().then(() => {
    loadSettings();
    if (process.platform === 'darwin' && app.dock) app.dock.hide();
    createWindow();
    tray = new Tray(trayImage());
    refreshMenus();
    if (process.platform !== 'darwin') tray.on('click', () => (win.isVisible() ? win.hide() : win.showInactive()));

    screen.on('display-removed', () => snapTo(settings.corner));
  });

  app.on('window-all-closed', () => app.quit());
}
