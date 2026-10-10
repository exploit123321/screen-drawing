const { app, BrowserWindow, Tray, Menu, globalShortcut, screen, desktopCapturer,
  ipcMain, clipboard, ClipboardItem, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { createWheelPassthrough } = require('./wheel');
const { disableShowAnimation } = require('./native');

const DEFAULTS = { drawKey: 'Ctrl+Alt+D', captureKey: 'Ctrl+Alt+S', clickThroughKey: 'Ctrl+Shift+X', autoStart: false };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

let settings = { ...DEFAULTS };
let tray = null, settingsWin = null;
let overlays = [];                       // { win, display, mode }
let toolState = { tool: 'pen', color: '#ff3b30', color2: '#0a84ff', width: 4 };
let busy = false, allowedSavePath = null;
let clickThrough = false;
let drawBeforeCapture = false;           // capture started from drawing mode: go back to the drawings afterwards
let registered = [];

if (!app.requestSingleInstanceLock()) app.quit();

function loadSettings() {
  try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch { settings = { ...DEFAULTS }; }
}
function saveSettings() {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
}

/* ---------- shortcuts ---------- */
function registerShortcuts() {
  registered.forEach((k) => globalShortcut.unregister(k));
  registered = [];
  const failed = [];
  const bind = (key, fn, label) => {
    if (!key) return;
    let ok = false;
    try { ok = globalShortcut.register(key, fn); } catch { /* invalid accelerator */ }
    if (ok) registered.push(key); else failed.push(`${label} (${key})`);
  };
  bind(settings.drawKey, toggleDraw, 'Draw');
  bind(settings.captureKey, () => startCapture('region'), 'Capture');
  return failed;
}

// Keys that exist only while drawing: the click-through toggle, and Esc while click-through leaves the overlay
// unfocused. Never re-register a key from its own callback: Windows fires it again at once, undoing the toggle.
let drawKeysOn = false, escapeOn = false;
function setDrawKeys(on) {
  setEscapeKey(on && clickThrough);
  if (on === drawKeysOn) return;
  drawKeysOn = on;
  const k = settings.clickThroughKey;
  if (!k) return;
  if (!on) globalShortcut.unregister(k);
  else try { globalShortcut.register(k, () => setClickThrough(!clickThrough)); } catch { /* invalid accelerator */ }
}
function setEscapeKey(on) {
  if (on === escapeOn) return;
  escapeOn = on;
  if (on) globalShortcut.register('Escape', closeOverlays); else globalShortcut.unregister('Escape');
}

/* ---------- overlays ---------- */
// Overlay windows are created once per display and only shown/hidden afterwards, so toggling is instant.
const pool = new Map();                  // displayId -> { win, display, loaded, active, mode }

function createPoolEntry(display) {
  const b = display.bounds;
  // type 'toolbar' makes this a tool window (WS_EX_TOOLWINDOW). Chrome, Edge, Firefox and Electron apps treat any
  // other window covering them as opaque and stop painting (video goes black) unless it is a tool window.
  const win = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height, type: 'toolbar',
    frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    resizable: false, movable: false, minimizable: false, maximizable: false,
    skipTaskbar: true, alwaysOnTop: true, show: false, enableLargerThanScreen: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setMenuBarVisibility(false);
  disableShowAnimation(win);
  const entry = { win, display, active: false, mode: null };
  entry.loaded = new Promise((r) => win.webContents.once('did-finish-load', r));
  // Show each window once at startup while it is still empty (fully transparent) and click-through: the first real
  // show otherwise waits ~200 ms for Windows and the GPU to set the window up.
  entry.loaded.then(() => {
    if (win.isDestroyed() || entry.active) return;
    win.setIgnoreMouseEvents(true); win.showInactive();
    setTimeout(() => { if (!win.isDestroyed() && !entry.active) { win.hide(); win.setIgnoreMouseEvents(false); } }, 250);
  });
  win.on('closed', () => { pool.delete(display.id); overlays = overlays.filter((o) => o !== entry); });
  win.loadFile(path.join(__dirname, 'overlay.html'));
  return entry;
}

function syncPool() {
  const ds = screen.getAllDisplays();
  for (const [id, e] of [...pool]) {
    const d = ds.find((x) => x.id === id);
    if (!d || JSON.stringify(d.bounds) !== JSON.stringify(e.display.bounds) || d.scaleFactor !== e.display.scaleFactor) {
      overlays = overlays.filter((o) => o !== e);
      pool.delete(id);
      if (!e.win.isDestroyed()) e.win.destroy();
    }
  }
  for (const d of ds) if (!pool.has(d.id)) pool.set(d.id, createPoolEntry(d));
}

const DEBUG = !!process.env.SCREENDRAWING_DEBUG;
let t0 = 0;

function showEntry(o, mode) {
  // Same bounds in every mode: resizing a visible transparent window (draw -> capture) flickers.
  const b = o.display.bounds;
  o.win.setBounds(b); o.win.setBounds(b);
  o.win.setIgnoreMouseEvents(false);                 // also undoes the startup warm-up if it is still running
  o.win.setContentProtection(mode === 'capture');   // capture mode hides itself from the screen grab; drawing stays visible to screen sharing
  if (!o.win.isVisible()) o.win.show();
  o.win.focus();
}

function hideEntry(o) {
  o.active = false;
  if (o.win.isDestroyed()) return;
  o.win.setIgnoreMouseEvents(false);
  o.win.setContentProtection(false);
  o.win.hide();
  o.win.webContents.send('reset');
}

// In drawing mode the mouse wheel scrolls the window underneath.
const wheel = createWheelPassthrough(() => overlays.filter((o) => o.mode === 'draw').map((o) => o.win));

function closeOverlays() {
  wheel.stop();
  clickThrough = false; drawBeforeCapture = false;
  setDrawKeys(false);
  const list = overlays; overlays = [];
  list.forEach(hideEntry);
}

// One switch for the toolbar button and the shortcut. The toolbar's own window still catches the mouse while
// it is over the toolbar (see 'ovl:ignore').
function setClickThrough(on) {
  const drawing = overlays.filter((o) => o.mode === 'draw');
  if (!drawing.length) return;
  clickThrough = on;
  if (on) wheel.stop(); else wheel.start();          // click-through already lets the wheel through
  for (const o of drawing) {
    o.win.setIgnoreMouseEvents(on, { forward: true });
    o.win.webContents.send('clickthrough', on);
  }
  setEscapeKey(on);
}

function backToDraw(o) {
  o.win.setIgnoreMouseEvents(false);
  if (o.mode === 'draw') return;
  o.mode = 'draw';
  o.win.setContentProtection(false);
  o.win.webContents.send('draw-mode');
}

function makeOverlay(display, mode, extra = {}) {
  let entry = pool.get(display.id);
  if (!entry) { syncPool(); entry = pool.get(display.id); }
  entry.active = true; entry.mode = mode;
  overlays.push(entry);
  entry.loaded.then(() => {
    if (entry.win.isDestroyed() || !entry.active) return;
    entry.win.webContents.send('init', {
      mode, tool: toolState, ctKey: settings.clickThroughKey, ...extra,
      display: { id: display.id, bounds: display.bounds, scaleFactor: display.scaleFactor },
    });
    showEntry(entry, mode);
  });
  return entry;
}

const cursorDisplay = () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint());

function toggleDraw() {
  if (busy) return;
  if (overlays.length) return closeOverlays();
  t0 = Date.now();
  const active = cursorDisplay();
  for (const d of screen.getAllDisplays()) makeOverlay(d, 'draw', { toolbar: d.id === active.id });
  clickThrough = false;
  wheel.start();
  setDrawKeys(true);
}

// One desktopCapturer call grabs every screen of the same pixel size (each call costs ~400ms).
async function grabScreens(displays) {
  const shots = new Map();
  const groups = new Map();
  for (const d of displays) {
    const w = Math.round(d.bounds.width * d.scaleFactor), h = Math.round(d.bounds.height * d.scaleFactor);
    const k = w + 'x' + h;
    if (!groups.has(k)) groups.set(k, { w, h, list: [] });
    groups.get(k).list.push(d);
  }
  const all = screen.getAllDisplays();
  await Promise.all([...groups.values()].map(async (g) => {
    const srcs = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: g.w, height: g.h } });
    for (const d of g.list) {
      const s = srcs.find((x) => x.display_id === String(d.id)) || srcs[all.findIndex((x) => x.id === d.id)];
      if (s) { const sz = s.thumbnail.getSize(); shots.set(d.id, { data: s.thumbnail.toBitmap(), w: sz.width, h: sz.height }); }
    }
  }));
  return shots;
}

// Capture opens instantly over the live screen (and keeps any drawings); the frozen frame arrives a moment later.
async function startCapture(kind, preferredId) {
  if (busy) return;
  busy = true;
  wheel.stop();
  try {
    const t = Date.now();
    if (!overlays.length) drawBeforeCapture = false;
    else if (overlays.every((o) => o.mode === 'draw')) drawBeforeCapture = true;
    if (clickThrough) { clickThrough = false; overlays.forEach((o) => o.win.webContents.send('clickthrough', false)); }
    setDrawKeys(false);
    const target = (preferredId && screen.getAllDisplays().find((d) => d.id === preferredId)) || cursorDisplay();
    const displays = kind === 'full' ? [target] : screen.getAllDisplays();
    const keep = new Set(displays.map((d) => d.id));
    for (const o of overlays.filter((x) => !keep.has(x.display.id))) {
      if (drawBeforeCapture) backToDraw(o);          // other screens keep showing their drawings
      else { overlays = overlays.filter((x) => x !== o); hideEntry(o); }
    }
    for (const d of displays) {
      const o = overlays.find((x) => x.display.id === d.id);
      if (o) {
        o.mode = 'capture'; o.win.setIgnoreMouseEvents(false);
        o.win.webContents.send('capture-mode', { kind });
        showEntry(o, 'capture');
      } else makeOverlay(d, 'capture', { kind });
    }
    await sleep(40);                     // let content protection take effect before grabbing pixels
    const shots = await grabScreens(displays);
    for (const d of displays) {
      const o = overlays.find((x) => x.display.id === d.id), s = shots.get(d.id);
      if (o && s && !o.win.isDestroyed()) o.win.webContents.send('bg', s);
    }
    if (DEBUG) console.log('capture grab ms', Date.now() - t);
  } finally { busy = false; }
}

const entryOf = (e) => overlays.find((o) => o.win.webContents === e.sender);

ipcMain.on('ovl:ready', () => { if (DEBUG) console.log('first paint ms', Date.now() - t0); });
// Esc, the close button, or a finished copy/save. A capture started from drawing mode goes back to the drawings.
ipcMain.on('ovl:close', () => {
  if (!drawBeforeCapture || !overlays.some((o) => o.mode === 'capture')) return closeOverlays();
  drawBeforeCapture = false;
  overlays.forEach(backToDraw);
  wheel.start();
  setDrawKeys(true);
});
ipcMain.on('ovl:capture', (e, kind) => { const o = entryOf(e); startCapture(kind, o && o.display.id); });
ipcMain.on('ovl:tool', (e, s) => {
  toolState = s;
  overlays.forEach((o) => { if (o.win.webContents !== e.sender) o.win.webContents.send('tool', s); });
});
ipcMain.on('ovl:clickthrough', (e, on) => setClickThrough(on));
ipcMain.on('ovl:ignore', (e, ignore) => {
  const o = entryOf(e); if (o) o.win.setIgnoreMouseEvents(ignore, { forward: true });
});
ipcMain.on('ovl:selected', (e) => {            // user started selecting on this display: the others step aside
  const others = overlays.filter((o) => o.win.webContents !== e.sender);
  if (drawBeforeCapture) return others.forEach(backToDraw);
  overlays = overlays.filter((o) => o.win.webContents === e.sender);
  others.forEach(hideEntry);
});

// Electron 44 replaced clipboard.writeImage with the async write(); image/png gives Windows PNG and bitmap formats.
ipcMain.handle('ovl:copy', async (e, buf) => {
  try {
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([Buffer.from(buf)], { type: 'image/png' }) })]);
    return true;
  } catch { return false; }
});
ipcMain.handle('ovl:save-dialog', async (e) => {
  const o = entryOf(e);
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const r = await dialog.showSaveDialog(o ? o.win : undefined, {
    title: 'Save screenshot',
    defaultPath: path.join(app.getPath('pictures'), `Screenshot ${stamp}.png`),
    filters: [{ name: 'PNG image', extensions: ['png'] }, { name: 'JPEG image', extensions: ['jpg', 'jpeg'] }],
  });
  if (r.canceled || !r.filePath) return null;
  allowedSavePath = r.filePath;
  return r.filePath;
});
ipcMain.handle('ovl:write', async (e, file, buf) => {
  if (file !== allowedSavePath) return false;      // only the path chosen in the dialog
  await fs.promises.writeFile(file, Buffer.from(buf));
  allowedSavePath = null;
  return true;
});

/* ---------- settings window ---------- */
function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) return settingsWin.focus();
  settingsWin = new BrowserWindow({
    width: 460, height: 560, resizable: false, minimizable: false, maximizable: false,
    title: 'ScreenDrawing settings', autoHideMenuBar: true, backgroundColor: '#1c1c20',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  settingsWin.removeMenu();
  settingsWin.loadFile(path.join(__dirname, 'settings.html'));
}
ipcMain.handle('settings:get', () => settings);
ipcMain.handle('settings:set', (e, s) => {
  const drawing = overlays.some((o) => o.mode === 'draw');
  setDrawKeys(false);
  settings = { ...settings, drawKey: s.drawKey, captureKey: s.captureKey, clickThroughKey: s.clickThroughKey, autoStart: !!s.autoStart };
  saveSettings();
  app.setLoginItemSettings({ openAtLogin: settings.autoStart });
  const failed = registerShortcuts();
  if (drawing) setDrawKeys(true);
  else if (settings.clickThroughKey) {          // registered only while drawing; check now that it is free
    let ok = false;
    try { ok = globalShortcut.register(settings.clickThroughKey, () => {}); } catch { /* invalid accelerator */ }
    if (ok) globalShortcut.unregister(settings.clickThroughKey); else failed.push(`Click-through (${settings.clickThroughKey})`);
  }
  return { failed };
});

/* ---------- tray ---------- */
function buildTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon.png')).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('ScreenDrawing');
  const item = (label, click) => ({ label, click });
  tray.setContextMenu(Menu.buildFromTemplate([
    item('Draw on screen', toggleDraw),
    item('Capture region', () => startCapture('region')),
    item('Capture freehand region', () => startCapture('free')),
    item('Capture full screen', () => startCapture('full')),
    { type: 'separator' },
    item('Settings...', openSettings),
    item('Quit', () => app.quit()),
  ]));
  tray.on('click', toggleDraw);
}

app.on('second-instance', openSettings);
app.on('window-all-closed', () => { /* stay alive in the tray */ });
app.on('will-quit', () => { wheel.stop(); globalShortcut.unregisterAll(); });

app.whenReady().then(() => {
  loadSettings();
  buildTray();
  syncPool();
  ['display-added', 'display-removed', 'display-metrics-changed'].forEach((ev) => screen.on(ev, () => { closeOverlays(); syncPool(); }));
  const failed = registerShortcuts();
  if (process.env.SCREENDRAWING_SELFTEST) setTimeout(() => { toggleDraw(); setTimeout(closeOverlays, 1500); setTimeout(() => startCapture('region'), 2200); setTimeout(() => app.quit(), 5000); }, 3000);
  if (failed.length) {
    dialog.showMessageBox({ type: 'warning', message: 'Some shortcuts could not be registered',
      detail: `${failed.join(', ')} are used by another app. Choose different keys in Settings.` });
    openSettings();
  } else if (!fs.existsSync(settingsFile())) {
    saveSettings();
    tray.displayBalloon({ title: 'ScreenDrawing is running', content: `${settings.drawKey}: draw   ${settings.captureKey}: capture` });
  }
});
