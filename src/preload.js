const { contextBridge, ipcRenderer } = require('electron');
const send = (ch) => (...a) => ipcRenderer.send(ch, ...a);
const call = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);

contextBridge.exposeInMainWorld('api', {
  onInit: (cb) => ipcRenderer.on('init', (_e, d) => cb(d)),
  onReset: (cb) => ipcRenderer.on('reset', () => cb()),
  onCaptureMode: (cb) => ipcRenderer.on('capture-mode', (_e, d) => cb(d)),
  onBg: (cb) => ipcRenderer.on('bg', (_e, d) => cb(d)),
  onTool: (cb) => ipcRenderer.on('tool', (_e, s) => cb(s)),
  onDrawMode: (cb) => ipcRenderer.on('draw-mode', () => cb()),
  onClickThrough: (cb) => ipcRenderer.on('clickthrough', (_e, on) => cb(on)),
  ready: send('ovl:ready'),
  close: send('ovl:close'),
  capture: send('ovl:capture'),
  tool: send('ovl:tool'),
  clickThrough: send('ovl:clickthrough'),
  ignore: send('ovl:ignore'),
  selected: send('ovl:selected'),
  copy: call('ovl:copy'),
  saveDialog: call('ovl:save-dialog'),
  writeFile: call('ovl:write'),
  getSettings: call('settings:get'),
  setSettings: call('settings:set'),
});
