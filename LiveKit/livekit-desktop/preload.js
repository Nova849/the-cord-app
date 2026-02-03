const { contextBridge, ipcRenderer } = require('electron');

const isE2eMode = process.env.E2E_MODE === '1';
const isE2eLive = process.env.E2E_LIVE === '1';

contextBridge.exposeInMainWorld('electronAPI', {
  getSources: () => ipcRenderer.invoke('get-sources'),
  setMuteHotkey: (accelerator) => ipcRenderer.invoke('set-mute-hotkey', accelerator),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  setUpdateFeedUrl: (url) => ipcRenderer.invoke('set-update-feed-url', url),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  onUpdateStatus: (handler) => {
    ipcRenderer.removeAllListeners('update-status');
    if (typeof handler === 'function') {
      ipcRenderer.on('update-status', (event, message) => handler(message));
    }
  },
  onGlobalMuteToggle: (handler) => {
    ipcRenderer.removeAllListeners('global-mute-toggle');
    if (typeof handler === 'function') {
      ipcRenderer.on('global-mute-toggle', handler);
    }
  }
});

if (isE2eMode) {
  contextBridge.exposeInMainWorld('__E2E_MODE__', true);
}

if (isE2eLive) {
  contextBridge.exposeInMainWorld('__E2E_LIVE__', true);
}
