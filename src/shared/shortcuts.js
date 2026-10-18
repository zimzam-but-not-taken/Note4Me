'use strict';
// Every keyboard shortcut in the app, in menu order. `id` is the command the
// main window runs (sent over the 'cmd' channel) unless `native` is set, in
// which case the main process handles it itself; `cmd` names a window command
// the window runs as well when the keystroke reaches it before the menu. Users override the defaults
// in settings.keys ({ id: accelerator }); an empty string means unbound.
// Shared by the main process (menu) and the settings window (editor).

const SHORTCUTS = [
  { group: 'Notebook', id: 'open-notebook', label: 'Open notebook…', key: 'CmdOrCtrl+O' },
  { group: 'Notebook', id: 'new-notebook', label: 'New notebook…', key: 'CmdOrCtrl+Shift+O' },
  { group: 'Notebook', id: 'new-window', label: 'New window', key: '', native: true },
  { group: 'Notebook', id: 'new-sibling', label: 'New node (same level)', key: 'CmdOrCtrl+Shift+N' },
  { group: 'Notebook', id: 'new-child', label: 'New child node', key: 'CmdOrCtrl+N' },
  { group: 'Notebook', id: 'rename', label: 'Rename node', key: 'F2' },
  { group: 'Notebook', id: 'delete', label: 'Delete node', key: '' },
  { group: 'Notebook', id: 'reveal', label: 'Reveal in Finder', key: '' },
  { group: 'Notebook', id: 'export-md', label: 'Export as Markdown…', key: '' },
  { group: 'Notebook', id: 'settings', label: 'Settings', key: 'CmdOrCtrl+,' },
  { group: 'Notebook', id: 'close', label: 'Close window', key: 'CmdOrCtrl+W', native: true },
  { group: 'Notebook', id: 'quit', label: 'Quit', key: 'CmdOrCtrl+Q', native: true },

  { group: 'Edit', id: 'find', label: 'Find in note', key: 'CmdOrCtrl+F' },
  { group: 'Edit', id: 'replace', label: 'Find and replace in note', key: 'Ctrl+H' },
  { group: 'Edit', id: 'search', label: 'Search all notes', key: 'CmdOrCtrl+Shift+F' },
  { group: 'Edit', id: 'paste-plain', label: 'Paste without formatting', key: 'CmdOrCtrl+Shift+V', native: true },

  { group: 'Selection', id: 'select-word-right', label: 'Select next word', key: 'Ctrl+Shift+Right' },
  { group: 'Selection', id: 'select-word-left', label: 'Select previous word', key: 'Ctrl+Shift+Left' },
  { group: 'Selection', id: 'select-line-end', label: 'Select to end of line', key: 'Shift+Alt+Down' },
  { group: 'Selection', id: 'select-line-start', label: 'Select to start of line', key: 'Shift+Alt+Up' },

  { group: 'Linux-style editing', id: 'linux-undo', label: 'Undo', key: 'Ctrl+Z', native: true, cmd: 'undo' },
  { group: 'Linux-style editing', id: 'linux-redo', label: 'Redo', key: 'Ctrl+Y', native: true, cmd: 'redo' },
  { group: 'Linux-style editing', id: 'linux-redo-alt', label: 'Redo (alternate)', key: 'Ctrl+Shift+Z', native: true, cmd: 'redo' },
  { group: 'Linux-style editing', id: 'linux-copy', label: 'Copy', key: 'Ctrl+C', native: true },
  { group: 'Linux-style editing', id: 'linux-cut', label: 'Cut', key: 'Ctrl+X', native: true },
  { group: 'Linux-style editing', id: 'linux-paste', label: 'Paste', key: 'Ctrl+V', native: true },
  { group: 'Linux-style editing', id: 'linux-paste-plain', label: 'Paste without formatting', key: 'Ctrl+Shift+V', native: true },
  { group: 'Linux-style editing', id: 'linux-select-all', label: 'Select all', key: 'Ctrl+A', native: true },

  { group: 'Format', id: 'bold', label: 'Bold', key: 'CmdOrCtrl+B' },
  { group: 'Format', id: 'italic', label: 'Italic', key: 'CmdOrCtrl+I' },
  { group: 'Format', id: 'underline', label: 'Underline', key: 'CmdOrCtrl+U' },
  { group: 'Format', id: 'strike', label: 'Strikethrough', key: 'CmdOrCtrl+Shift+X' },
  { group: 'Format', id: 'code', label: 'Monospace', key: 'CmdOrCtrl+E' },
  { group: 'Format', id: 'fg', label: 'Text color…', key: 'Shift+Alt+F' },
  { group: 'Format', id: 'bg', label: 'Highlight color…', key: 'Shift+Alt+B' },
  { group: 'Format', id: 'fg-again', label: 'Apply last text color', key: 'Shift+Alt+G' },
  { group: 'Format', id: 'bg-again', label: 'Apply last highlight', key: 'Shift+Alt+H' },
  { group: 'Format', id: 'clear', label: 'Clear formatting', key: 'CmdOrCtrl+Shift+\\' },
  { group: 'Format', id: 'para', label: 'Normal text', key: 'CmdOrCtrl+Alt+0' },
  { group: 'Format', id: 'h1', label: 'Heading 1', key: 'CmdOrCtrl+Alt+1' },
  { group: 'Format', id: 'h2', label: 'Heading 2', key: 'CmdOrCtrl+Alt+2' },
  { group: 'Format', id: 'h3', label: 'Heading 3', key: 'CmdOrCtrl+Alt+3' },
  { group: 'Format', id: 'bullets', label: 'Bullet list', key: 'CmdOrCtrl+Shift+8' },
  { group: 'Format', id: 'numbers', label: 'Numbered list', key: 'CmdOrCtrl+Shift+7' },
  { group: 'Format', id: 'codeblock', label: 'Code box', key: 'Shift+Alt+CmdOrCtrl+C' },
  { group: 'Format', id: 'md-typing', label: 'Markdown while typing (on/off)', key: '' },

  { group: 'Tree', id: 'move-up', label: 'Move node up', key: 'CmdOrCtrl+Alt+Up' },
  { group: 'Tree', id: 'move-down', label: 'Move node down', key: 'CmdOrCtrl+Alt+Down' },
  { group: 'Tree', id: 'indent', label: 'Indent node', key: 'CmdOrCtrl+Alt+Right' },
  { group: 'Tree', id: 'outdent', label: 'Outdent node', key: 'CmdOrCtrl+Alt+Left' },
  { group: 'Tree', id: 'prev-node', label: 'Previous node', key: 'CmdOrCtrl+Up' },
  { group: 'Tree', id: 'next-node', label: 'Next node', key: 'CmdOrCtrl+Down' },

  { group: 'View', id: 'zoom-in', label: 'Bigger text', key: 'CmdOrCtrl+=' },
  { group: 'View', id: 'zoom-out', label: 'Smaller text', key: 'CmdOrCtrl+-' },
  { group: 'View', id: 'zoom-reset', label: 'Reset text size', key: 'CmdOrCtrl+0' },
  { group: 'View', id: 'toggle-tree', label: 'Show/hide tree', key: 'CmdOrCtrl+\\' },
];

const MOD_ALIASES = {
  cmd: 'CmdOrCtrl', command: 'CmdOrCtrl', meta: 'CmdOrCtrl', super: 'CmdOrCtrl', cmdorctrl: 'CmdOrCtrl', commandorcontrol: 'CmdOrCtrl',
  ctrl: 'Ctrl', control: 'Ctrl', alt: 'Alt', option: 'Alt', opt: 'Alt', shift: 'Shift',
};
const MOD_ORDER = ['Ctrl', 'Alt', 'Shift', 'CmdOrCtrl'];
const KEY_ALIASES = { esc: 'Esc', escape: 'Esc', enter: 'Return', return: 'Return', del: 'Delete', delete: 'Delete', backspace: 'Backspace', space: 'Space', tab: 'Tab', up: 'Up', down: 'Down', left: 'Left', right: 'Right', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', plus: 'Plus' };

// Canonical Electron accelerator ("Ctrl+Alt+Shift+CmdOrCtrl+Key"), '' if empty.
function normalizeAccelerator(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  // split on '+' but keep a trailing '+' key ("Cmd++" -> Cmd, Plus)
  const parts = raw.replace(/\+\+$/, '+Plus').split('+').map((t) => t.trim()).filter(Boolean);
  const mods = new Set();
  let key = '';
  for (const p of parts) {
    const m = MOD_ALIASES[p.toLowerCase()];
    if (m) mods.add(m);
    else key = KEY_ALIASES[p.toLowerCase()] || (p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1));
  }
  if (!key) return '';
  return [...MOD_ORDER.filter((m) => mods.has(m)), key].join('+');
}

// Effective accelerator per shortcut id, defaults merged with settings.keys.
function resolveKeys(settings) {
  const keys = (settings && settings.keys) || {};
  const out = {};
  for (const s of SHORTCUTS) out[s.id] = typeof keys[s.id] === 'string' ? normalizeAccelerator(keys[s.id]) : s.key;
  // older settings stored just these two
  if (settings && keys.quit === undefined && settings.quitKey) out.quit = normalizeAccelerator(settings.quitKey);
  if (settings && keys.close === undefined && settings.closeKey) out.close = normalizeAccelerator(settings.closeKey);
  return out;
}

const GLYPHS = { Ctrl: '⌃', Alt: '⌥', Shift: '⇧', CmdOrCtrl: '⌘', Up: '↑', Down: '↓', Left: '←', Right: '→', Return: '↩', Backspace: '⌫', Delete: '⌦', Esc: '⎋', Tab: '⇥', Space: '␣', Plus: '+', PageUp: '⇞', PageDown: '⇟', Home: '↖', End: '↘' };

// "CmdOrCtrl+Shift+N" -> "⇧⌘N" for display on macOS.
function displayAccelerator(acc) {
  const n = normalizeAccelerator(acc);
  if (!n) return '';
  const parts = n.split('+');
  const key = parts.pop();
  return parts.map((m) => GLYPHS[m]).join('') + (GLYPHS[key] || key);
}

module.exports = { SHORTCUTS, resolveKeys, normalizeAccelerator, displayAccelerator };
