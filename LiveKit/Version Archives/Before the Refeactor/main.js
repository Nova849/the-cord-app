const { app, BrowserWindow, ipcMain, desktopCapturer, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');

let presenceServer = null;
let chatServer = null;
let mainWindow = null;
let registeredMuteHotkey = '';

function loadPresenceConfig() {
  try {
    const configPath = path.join(__dirname, '..', 'presence.config.json');
    if (!fs.existsSync(configPath)) return null;
    const raw = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    console.warn('Failed to load presence.config.json', e);
    return null;
  }
}

function startPresenceServerIfConfigured() {
  if (presenceServer) return;
  const config = loadPresenceConfig();
  if (!config || !config.apiKey || !config.apiSecret) {
    console.warn('Presence server not started (missing config).');
    return;
  }
  try {
    const { startPresenceServer } = require(path.join(__dirname, '..', 'presenceServer.js'));
    presenceServer = startPresenceServer({
      apiKey: config.apiKey,
      apiSecret: config.apiSecret,
      host: config.host || 'http://127.0.0.1:7880',
      port: config.port || 7882
    });
  } catch (e) {
    console.warn('Failed to start presence server', e);
  }
}

function startChatServer() {
  if (chatServer) return;
  try {
    const { startChatServer } = require(path.join(__dirname, '..', 'chatServer.js'));
    chatServer = startChatServer();
  } catch (e) {
    console.warn('Failed to start chat server', e);
  }
}

function createWindow() {
  startPresenceServerIfConfigured();
  startChatServer();
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
  win.webContents.openDevTools();
}

app.whenReady().then(createWindow);

app.on('before-quit', () => {
  try {
    if (presenceServer && typeof presenceServer.close === 'function') {
      presenceServer.close();
    }
    if (chatServer && typeof chatServer.close === 'function') {
      chatServer.close();
    }
  } catch (e) {}
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
