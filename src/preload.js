const { contextBridge, ipcRenderer } = require('electron');

const on = (channel, cb) => {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  setKey: (key) => ipcRenderer.invoke('key:set', key),
  trackerState: () => ipcRenderer.invoke('tracker:state'),
  toggle: () => ipcRenderer.invoke('tracker:toggle'),
  checkNow: () => ipcRenderer.invoke('tracker:now'),
  ollamaStatus: () => ipcRenderer.invoke('ollama:status'),
  pullModel: (tier) => ipcRenderer.invoke('ollama:pull', tier),
  onStatus: (cb) => on('tracker:status', cb),
  onLog: (cb) => on('tracker:log', cb),
  onProgress: (cb) => on('ollama:progress', cb)
});
