const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
    // settings window
    open: (section) => ipcRenderer.invoke('settings:open', section),
    close: () => ipcRenderer.invoke('settings:close'),
    preview: (patch) => ipcRenderer.send('settings:preview', patch),
    suspendKeys: (on) => ipcRenderer.send('keys:suspend', on),
  },
  notebook: {
    pick: (create) => ipcRenderer.invoke('notebook:pick', create),
    open: (dir) => ipcRenderer.invoke('notebook:open', dir),
    tree: () => ipcRenderer.invoke('notebook:tree'),
    exportMarkdown: (rel) => ipcRenderer.invoke('export:markdown', rel),
  },
  note: {
    read: (rel) => ipcRenderer.invoke('note:read', rel),
    write: (rel, body, raw) => ipcRenderer.invoke('note:write', rel, body, raw),
  },
  node: {
    create: (opts) => ipcRenderer.invoke('node:create', opts),
    rename: (opts) => ipcRenderer.invoke('node:rename', opts),
    delete: (rel) => ipcRenderer.invoke('node:delete', rel),
    move: (opts) => ipcRenderer.invoke('node:move', opts),
  },
  asset: {
    save: (opts) => ipcRenderer.invoke('asset:save', opts),
  },
  shell: {
    open: (url) => ipcRenderer.invoke('shell:open', url),
    reveal: (rel) => ipcRenderer.invoke('shell:reveal', rel),
  },
  edit: (op) => ipcRenderer.invoke('edit', op),
  appearance: (opts) => ipcRenderer.invoke('window:appearance', opts),
  search: (opts) => ipcRenderer.invoke('search:all', opts),
  onCommand: (fn) => ipcRenderer.on('cmd', (_e, name) => fn(name)),
  onFlush: (fn) => ipcRenderer.on('flush', () => fn()),
  flushed: () => ipcRenderer.send('flushed'),
  // settings sync between windows
  onSettingsChanged: (fn) => ipcRenderer.on('settings-changed', (_e, s) => fn(s)),
  onSettingsPreview: (fn) => ipcRenderer.on('settings-preview', (_e, patch) => fn(patch)),
  onSettingsRevert: (fn) => ipcRenderer.on('settings-revert', () => fn()),
  onSettingsSection: (fn) => ipcRenderer.on('settings-section', (_e, s) => fn(s)),
});
