const { app, BrowserWindow, ipcMain, desktopCapturer, globalShortcut, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let registeredMuteHotkey = '';
let updatePromptOpen = false;

function resolveLocalPath(fileName) {
  const localPath = path.join(__dirname, fileName);
  if (fs.existsSync(localPath)) return localPath;
  return path.join(__dirname, '..', fileName);
}

function loadUpdateFeedUrl() {
  if (process.env.THECORD_UPDATE_URL) return process.env.THECORD_UPDATE_URL;
  const candidates = [];
  try {
    if (app?.getPath) {
      candidates.push(path.join(app.getPath('userData'), 'update.config.json'));
    }
  } catch (e) {}
  candidates.push(resolveLocalPath('update.config.json'));
  try {
    for (const configPath of candidates) {
      if (!fs.existsSync(configPath)) continue;
      const raw = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(raw);
      const url = typeof parsed.updateUrl === 'string' ? parsed.updateUrl.trim() : '';
      if (url) return url;
    }
    return '';
  } catch (e) {
    console.warn('Failed to load update.config.json', e);
    return '';
  }
}

function normalizeUpdateUrl(url) {
  const trimmed = String(url || '').trim();
  if (!trimmed) return '';
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

function persistUpdateFeedUrl(url) {
  if (!app?.getPath) return '';
  const configPath = path.join(app.getPath('userData'), 'update.config.json');
  const payload = { updateUrl: normalizeUpdateUrl(url) };
  fs.writeFileSync(configPath, JSON.stringify(payload, null, 2));
  return configPath;
}

function setupAutoUpdater() {
  if (!app.isPackaged) return;
  const feedUrl = normalizeUpdateUrl(loadUpdateFeedUrl());
  if (!feedUrl) {
    console.log('Auto-update disabled (no update URL configured).');
    return;
  }
  try {
    autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl });
    console.log('[auto-update] feed URL', feedUrl);
  } catch (e) {
    console.warn('Failed to set update feed URL', e);
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.on('update-available', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-status', 'Update available. Downloading...');
    }
  });
  autoUpdater.on('update-not-available', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-status', 'No updates available.');
    }
  });
  autoUpdater.on('update-downloaded', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-status', 'Update ready to install.');
    }
    if (updatePromptOpen) return;
    updatePromptOpen = true;
    dialog.showMessageBox({
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update ready',
      message: 'A new version is ready. Restart to install?'
    }).then(result => {
      updatePromptOpen = false;
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    }).catch(() => {
      updatePromptOpen = false;
    });
  });
  autoUpdater.on('error', (err) => {
    const details = err?.stack || err?.message || String(err);
    console.error('Auto-update error', details);
    if (mainWindow && !mainWindow.isDestroyed()) {
      const message = err?.message ? `Update error: ${err.message}` : 'Update error. Check the update URL.';
      mainWindow.webContents.send('update-status', message);
    }
  });
  autoUpdater.checkForUpdates();
  setInterval(() => {
    autoUpdater.checkForUpdates();
  }, 6 * 60 * 60 * 1000);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 420,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow = win;
  win.loadFile('index.html');
  if (!app.isPackaged) {
    win.webContents.openDevTools();
  }
}

app.whenReady().then(() => {
  createWindow();
  setupAutoUpdater();
});

app.on('before-quit', () => {
  try { globalShortcut.unregisterAll(); } catch (e) {}
});

ipcMain.handle('get-sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
  return sources.map(s => ({ id: s.id, name: s.name }));
});

ipcMain.handle('set-mute-hotkey', async (event, accelerator) => {
  try {
    const next = String(accelerator || '').trim();
    if (registeredMuteHotkey) {
      try { globalShortcut.unregister(registeredMuteHotkey); } catch (e) {}
      registeredMuteHotkey = '';
    }
    if (!next) return { ok: true, registered: '' };
    const success = globalShortcut.register(next, () => {
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('global-mute-toggle');
        }
      } catch (e) {}
    });
    if (success) registeredMuteHotkey = next;
    return { ok: success, registered: success ? next : '' };
  } catch (e) {
    return { ok: false, registered: '' };
  }
});

ipcMain.handle('set-update-feed-url', async (event, url) => {
  try {
    const next = normalizeUpdateUrl(url);
    persistUpdateFeedUrl(next);
    if (app.isPackaged && next) {
      try {
        autoUpdater.setFeedURL({ provider: 'generic', url: next });
        autoUpdater.checkForUpdates();
      } catch (e) {
        return { ok: false, error: e?.message || 'Failed to set feed URL' };
      }
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || 'Failed to save update URL' };
  }
});

ipcMain.handle('check-for-updates', async () => {
  if (!app.isPackaged) {
    return { ok: false, message: 'Updates require a packaged build.' };
  }
  const feedUrl = normalizeUpdateUrl(loadUpdateFeedUrl());
  if (!feedUrl) {
    return { ok: false, message: 'Update feed URL not set.' };
  }
  try {
    autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl });
  } catch (e) {
    console.warn('Failed to set update URL', e);
    return { ok: false, message: 'Failed to set update URL.' };
  }
  try {
    console.log('[auto-update] checkForUpdates', feedUrl);
    autoUpdater.checkForUpdates();
    return { ok: true, message: 'Checking for updates...' };
  } catch (e) {
    console.warn('Update check failed', e);
    return { ok: false, message: 'Update check failed.' };
  }
});

ipcMain.handle('get-app-version', async () => {
  try {
    return { ok: true, version: app.getVersion() };
  } catch (e) {
    return { ok: false, version: '' };
  }
});
