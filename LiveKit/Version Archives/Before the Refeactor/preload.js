const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getSources: () => ipcRenderer.invoke('get-sources'),
  setMuteHotkey: (accelerator) => ipcRenderer.invoke('set-mute-hotkey', accelerator),
  onGlobalMuteToggle: (handler) => {
    ipcRenderer.removeAllListeners('global-mute-toggle');
    if (typeof handler === 'function') {
      ipcRenderer.on('global-mute-toggle', handler);
    }
  }
});
