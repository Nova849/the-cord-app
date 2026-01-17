const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getSources: () => ipcRenderer.invoke('get-sources'),
  setMuteHotkey: (accelerator) => ipcRenderer.invoke('set-mute-hotkey', accelerator),
  setUpdateFeedUrl: (url) => ipcRenderer.invoke('set-update-feed-url', url),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
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
