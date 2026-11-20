// The only bridge between the panel and the main process. No token ever crosses it.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('usageApi', {
  getUsage: () => ipcRenderer.invoke('usage:get'),
  refresh: () => ipcRenderer.invoke('usage:refresh'),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  quit: () => ipcRenderer.send('app:quit'),
  resize: (height) => ipcRenderer.send('panel:resize', height),
  onUpdate: (cb) => ipcRenderer.on('usage:update', (_e, state) => cb(state)),
});
