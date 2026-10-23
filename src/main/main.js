// Note4Me — Electron main process.
// Owns the notebook folder: tree scanning, reading/writing notes, node
// operations, notebook-wide search, settings (and the settings window), the
// Markdown export, and a custom `nb://` protocol that serves images from
// inside the notebook.

const { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, nativeTheme, protocol, net, session, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const fssync = require('node:fs');
const { pathToFileURL } = require('node:url');
const { Worker } = require('node:worker_threads');
const { resolveKeys, normalizeAccelerator } = require('../shared/shortcuts.js');

// One settings folder for both `npm start` and the packaged app.
{
  const dir = path.join(app.getPath('appData'), 'Note4Me');
  const legacy = path.join(app.getPath('appData'), 'note4me');
  if (!fssync.existsSync(dir) && fssync.existsSync(legacy)) fssync.cpSync(legacy, dir, { recursive: true });
  app.setPath('userData', dir);
}

// All note windows share the one open notebook. `win` points at the active one
// (the last focused), so dialogs, menu commands and the context menu act on the
// window the user is looking at; `noteWins` is every open note window, for the
// things that must reach all of them (settings, theme, tree changes).
let win = null;
const noteWins = new Set();
let root = null; // absolute path of the open notebook

// everything in a channel, to every note window
function broadcast(channel, ...args) {
  for (const w of noteWins) if (!w.isDestroyed()) w.webContents.send(channel, ...args);
}
// to every note window except the one that caused the change
function broadcastOthers(sender, channel, ...args) {
  for (const w of noteWins) if (!w.isDestroyed() && w.webContents !== sender) w.webContents.send(channel, ...args);
}
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

const THEMES = [
  ['modern-dark', 'Modern Dark'],
  ['modern-light', 'Modern Light'],
  ['cherry-dark', 'Classic Dark'],
  ['cherry-light', 'Classic Light'],
  ['dracula', 'Dracula'],
  ['nord', 'Nord'],
  ['solarized-dark', 'Solarized Dark'],
  ['custom', 'Custom…'],
];

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function loadSettings() {
  try {
    return JSON.parse(fssync.readFileSync(settingsPath(), 'utf8'));
  } catch {
    return {};
  }
}

function saveSettings(patch) {
  const s = { ...loadSettings(), ...patch };
  fssync.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fssync.writeFileSync(settingsPath(), JSON.stringify(s, null, 2));
  return s;
}

// ---------------------------------------------------------------------------
// Notebook helpers
// ---------------------------------------------------------------------------

const BAD = { '/': '∕', '\\': '∕', ':': '꞉' };

function sanitizeStem(name) {
  let s = [...name].map((c) => BAD[c] ?? c).join('');
  s = s.replace(/[\x00-\x1f]/g, '').trim().replace(/^\.+|\.+$/g, '');
  s = s.slice(0, 120).trim() || 'untitled';
  if (s.startsWith('_') || s.startsWith('.')) s = '_' + s.replace(/^[._]+/, '');
  return s;
}

function abs(rel) {
  if (!root) throw new Error('no notebook open');
  const p = path.resolve(root, rel);
  if (p !== root && !p.startsWith(root + path.sep)) throw new Error('path escapes notebook');
  return p;
}

function parseFrontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { front: {}, raw: '', body: text };
  const front = {};
  for (const line of m[1].split(/\r?\n/)) {
    const mm = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!mm) continue;
    let v = mm[2].trim();
    if (v.startsWith('"') && v.endsWith('"')) {
      try { v = JSON.parse(v); } catch { v = v.slice(1, -1); }
    }
    front[mm[1]] = v;
  }
  return { front, raw: m[0], body: text.slice(m[0].length) };
}

function yamlQuote(s) {
  if (/^[A-Za-z0-9 _()\-,.]+$/.test(s) && !/^[-#]/.test(s.trim())) return s;
  return JSON.stringify(s);
}

async function readOrder(dir) {
  try {
    const t = await fs.readFile(path.join(dir, '.order'), 'utf8');
    return t.split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

async function writeOrder(dir, stems) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, '.order'), stems.map((s) => s + '\n').join(''));
}

async function readTitle(file, stem) {
  try {
    const fh = await fs.open(file, 'r');
    const buf = Buffer.alloc(2048);
    const { bytesRead } = await fh.read(buf, 0, 2048, 0);
    await fh.close();
    const head = buf.subarray(0, bytesRead).toString('utf8');
    if (!head.startsWith('---')) return stem;
    const { front } = parseFrontMatter(head);
    return front.title || stem;
  } catch {
    return stem;
  }
}

async function scanDir(relDir) {
  const dir = abs(relDir || '.');
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = entries.filter((e) => e.isFile() && e.name.endsWith('.md') && !/^[._]/.test(e.name));
  const dirs = new Set(entries.filter((e) => e.isDirectory()).map((e) => e.name));
  const order = await readOrder(dir);
  const stems = files.map((f) => f.name.slice(0, -3));
  const rank = new Map(order.map((s, i) => [s, i]));
  stems.sort((a, b) => {
    const ra = rank.has(a) ? rank.get(a) : Infinity;
    const rb = rank.has(b) ? rank.get(b) : Infinity;
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
  });
  const nodes = [];
  for (const stem of stems) {
    const rel = path.posix.join(relDir || '', stem + '.md');
    const childDir = path.posix.join(relDir || '', stem);
    nodes.push({
      rel,
      stem,
      dir: relDir || '',
      title: await readTitle(path.join(dir, stem + '.md'), stem),
      children: dirs.has(stem) ? await scanDir(childDir) : [],
    });
  }
  return nodes;
}

function flatten(nodes, out = []) {
  for (const n of nodes) {
    out.push(n);
    flatten(n.children, out);
  }
  return out;
}

async function siblingsOf(relFile) {
  const dir = path.posix.dirname(relFile) === '.' ? '' : path.posix.dirname(relFile);
  const nodes = await scanDir(dir);
  return { dir, stems: nodes.map((n) => n.stem) };
}

async function uniqueStem(dirAbs, base) {
  let stem = base;
  let k = 2;
  while (fssync.existsSync(path.join(dirAbs, stem + '.md')) || fssync.existsSync(path.join(dirAbs, stem))) {
    stem = `${base} (${k++})`;
  }
  return stem;
}

// ---------------------------------------------------------------------------
// IPC: settings, notebook, notes
// ---------------------------------------------------------------------------

ipcMain.handle('settings:get', () => loadSettings());
ipcMain.handle('settings:set', (_e, patch) => applySettingsPatch(patch));

ipcMain.handle('notebook:pick', async (_e, create) => {
  const r = await dialog.showOpenDialog(win, {
    title: create ? 'Choose an empty folder for the new notebook' : 'Open notebook folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return r.filePaths[0];
});

ipcMain.handle('notebook:open', async (_e, dir) => {
  if (!dir) return null;
  const st = await fs.stat(dir).catch(() => null);
  if (!st || !st.isDirectory()) return null;
  root = path.resolve(dir);
  saveSettings({ lastNotebook: root });
  return { root, tree: await scanDir('') };
});

ipcMain.handle('notebook:tree', async () => (root ? await scanDir('') : []));

ipcMain.handle('note:read', async (_e, rel) => {
  const text = await fs.readFile(abs(rel), 'utf8').catch(() => '');
  return parseFrontMatter(text);
});

ipcMain.handle('note:write', async (_e, rel, body, raw) => {
  await fs.mkdir(path.dirname(abs(rel)), { recursive: true });
  await fs.writeFile(abs(rel), (raw || '') + body, 'utf8');
  return true;
});

// ---------------------------------------------------------------------------
// IPC: node operations
// ---------------------------------------------------------------------------

ipcMain.handle('node:create', async (e, { parentRel, afterRel, title }) => {
  let dirRel = '';
  if (parentRel) dirRel = parentRel.replace(/\.md$/, '');
  else if (afterRel) dirRel = path.posix.dirname(afterRel) === '.' ? '' : path.posix.dirname(afterRel);
  const dirAbs = abs(dirRel || '.');
  await fs.mkdir(dirAbs, { recursive: true });
  const base = sanitizeStem(title || 'New Node');
  const stem = await uniqueStem(dirAbs, base);
  const front = stem !== title ? `---\ntitle: ${yamlQuote(title)}\n---\n` : '';
  await fs.writeFile(path.join(dirAbs, stem + '.md'), front, 'utf8');
  const { stems } = await siblingsOf(path.posix.join(dirRel, stem + '.md'));
  const without = stems.filter((s) => s !== stem);
  const idx = afterRel && !parentRel ? without.indexOf(path.posix.basename(afterRel, '.md')) : -1;
  if (idx >= 0) without.splice(idx + 1, 0, stem);
  else without.push(stem);
  await writeOrder(dirAbs, without);
  broadcastOthers(e.sender, 'notebook-changed');
  return path.posix.join(dirRel, stem + '.md');
});

ipcMain.handle('node:rename', async (e, { rel, title }) => {
  const oldAbs = abs(rel);
  const dirAbs = path.dirname(oldAbs);
  const oldStem = path.basename(rel, '.md');
  const text = await fs.readFile(oldAbs, 'utf8').catch(() => '');
  const { front, body } = parseFrontMatter(text);
  let stem = sanitizeStem(title);
  if (stem !== oldStem) stem = await uniqueStem(dirAbs, stem);
  const keep = { ...front };
  if (stem !== title) keep.title = title;
  else delete keep.title;
  const keys = Object.keys(keep);
  const raw = keys.length ? '---\n' + keys.map((k) => `${k}: ${yamlQuote(String(keep[k]))}\n`).join('') + '---\n' : '';
  await fs.writeFile(oldAbs, raw + body, 'utf8');
  if (stem !== oldStem) {
    await fs.rename(oldAbs, path.join(dirAbs, stem + '.md'));
    if (fssync.existsSync(path.join(dirAbs, oldStem))) {
      await fs.rename(path.join(dirAbs, oldStem), path.join(dirAbs, stem));
    }
    const order = await readOrder(dirAbs);
    await writeOrder(dirAbs, order.map((s) => (s === oldStem ? stem : s)));
  }
  broadcastOthers(e.sender, 'notebook-changed');
  return path.posix.join(path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel), stem + '.md');
});

ipcMain.handle('node:delete', async (e, rel) => {
  const file = abs(rel);
  const dir = file.replace(/\.md$/, '');
  await shell.trashItem(file).catch(() => fs.rm(file, { force: true }));
  if (fssync.existsSync(dir)) await shell.trashItem(dir).catch(() => fs.rm(dir, { recursive: true, force: true }));
  const dirAbs = path.dirname(file);
  const order = await readOrder(dirAbs);
  await writeOrder(dirAbs, order.filter((s) => s !== path.basename(rel, '.md')));
  broadcastOthers(e.sender, 'notebook-changed');
  return true;
});

ipcMain.handle('node:move', async (e, { rel, op, target }) => {
  const stem = path.posix.basename(rel, '.md');
  const { dir, stems } = await siblingsOf(rel);
  const dirAbs = abs(dir || '.');
  const i = stems.indexOf(stem);
  if (i < 0) return rel;
  if (op === 'up' || op === 'down') {
    const j = op === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= stems.length) return rel;
    [stems[i], stems[j]] = [stems[j], stems[i]];
    await writeOrder(dirAbs, stems);
    broadcastOthers(e.sender, 'notebook-changed');
    return rel;
  }
  if (op === 'indent') {
    if (i === 0) return rel;
    const newParent = stems[i - 1];
    const r = await moveNode(dirAbs, stem, path.posix.join(dir, newParent), path.join(dirAbs, newParent), null);
    broadcastOthers(e.sender, 'notebook-changed');
    return r;
  }
  if (op === 'outdent') {
    if (!dir) return rel;
    const parentDir = path.posix.dirname(dir) === '.' ? '' : path.posix.dirname(dir);
    const r = await moveNode(dirAbs, stem, parentDir, abs(parentDir || '.'), { after: path.posix.basename(dir) });
    broadcastOthers(e.sender, 'notebook-changed');
    return r;
  }
  if (op === 'into' || op === 'before' || op === 'after') {
    const r = await moveTo(rel, op, typeof target === 'string' ? target : '');
    broadcastOthers(e.sender, 'notebook-changed');
    return r;
  }
  return rel;
});

// Drag and drop: put `rel` inside `target` as its last child ('into'; an empty
// target is the notebook root) or beside it ('before' / 'after'). A node can't
// be dropped on itself or into its own subtree.
async function moveTo(rel, op, target) {
  const stem = path.posix.basename(rel, '.md');
  const dir = path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel);
  const ownDir = rel.replace(/\.md$/, '');
  if (target === rel || target.startsWith(ownDir + '/')) return rel;
  let targetDir;
  let place = null;
  if (op === 'into') targetDir = target ? target.replace(/\.md$/, '') : '';
  else {
    if (!target) return rel;
    targetDir = path.posix.dirname(target) === '.' ? '' : path.posix.dirname(target);
    place = { [op]: path.posix.basename(target, '.md') };
  }
  const dirAbs = abs(dir || '.');
  const targetDirAbs = abs(targetDir || '.');
  if (targetDir === dir) {
    // Same folder: just reorder.
    const { stems } = await siblingsOf(rel);
    const without = stems.filter((s) => s !== stem);
    placeIn(without, stem, place);
    await writeOrder(dirAbs, without);
    return rel;
  }
  if (!fssync.existsSync(path.join(dirAbs, stem + '.md'))) return rel;
  return moveNode(dirAbs, stem, targetDir, targetDirAbs, place);
}

// Insert `stem` into a sibling list: after/before the named sibling, else at the end.
function placeIn(list, stem, place) {
  const ref = place ? (place.after ?? place.before) : undefined;
  const i = ref !== undefined ? list.indexOf(ref) : -1;
  if (i < 0) list.push(stem);
  else list.splice(place.after !== undefined ? i + 1 : i, 0, stem);
}

// Move one node (its file, its children folder and its asset files) into
// another folder. `place` is { after: stem } / { before: stem } or null (end).
async function moveNode(dirAbs, stem, targetRelDir, targetDirAbs, place) {
  await fs.mkdir(targetDirAbs, { recursive: true });
  const newStem = await uniqueStem(targetDirAbs, stem);
  await fs.rename(path.join(dirAbs, stem + '.md'), path.join(targetDirAbs, newStem + '.md'));
  if (fssync.existsSync(path.join(dirAbs, stem))) {
    await fs.rename(path.join(dirAbs, stem), path.join(targetDirAbs, newStem));
  }
  // Images saved as files are referenced relative to the note's folder; carry them along.
  const assets = path.join(dirAbs, '_assets');
  if (fssync.existsSync(assets)) {
    const mine = (await fs.readdir(assets)).filter((f) => f.startsWith(stem + '-'));
    if (mine.length) {
      await fs.mkdir(path.join(targetDirAbs, '_assets'), { recursive: true });
      for (const f of mine) {
        await fs.rename(path.join(assets, f), path.join(targetDirAbs, '_assets', f.replace(stem + '-', newStem + '-')));
      }
      if (newStem !== stem) {
        const file = path.join(targetDirAbs, newStem + '.md');
        const t = await fs.readFile(file, 'utf8');
        await fs.writeFile(file, t.split(`_assets/${encodeURIComponent(stem)}-`).join(`_assets/${encodeURIComponent(newStem)}-`));
      }
    }
  }
  const oldOrder = await readOrder(dirAbs);
  await writeOrder(dirAbs, oldOrder.filter((s) => s !== stem));
  const { stems } = await siblingsOf(path.posix.join(targetRelDir, newStem + '.md'));
  const without = stems.filter((s) => s !== newStem);
  placeIn(without, newStem, place);
  await writeOrder(targetDirAbs, without);
  return path.posix.join(targetRelDir, newStem + '.md');
}

ipcMain.handle('asset:save', async (_e, { noteRel, bytes, ext }) => {
  const dirRel = path.posix.dirname(noteRel) === '.' ? '' : path.posix.dirname(noteRel);
  const stem = path.posix.basename(noteRel, '.md');
  // `ext` is renderer-supplied (from a pasted file's MIME type); keep it to a
  // plain extension so it can't smuggle path separators into the filename.
  const safeExt = /^[a-z0-9]{1,8}$/i.test(ext) ? ext.toLowerCase() : 'png';
  await fs.mkdir(abs(path.posix.join(dirRel, '_assets')), { recursive: true });
  // Resolve every candidate through abs(), so the final write can never land
  // outside the notebook even if the stem or extension is unexpected.
  const relFor = (name) => abs(path.posix.join(dirRel, '_assets', name));
  let n = 1;
  let name;
  do {
    name = `${stem}-${n++}.${safeExt}`;
  } while (fssync.existsSync(relFor(name)));
  await fs.writeFile(relFor(name), Buffer.from(bytes));
  return `_assets/${name}`;
});

// The renderer tells us whether the theme is dark and whether blur is wanted,
// so the native material (and menus) match instead of going white.
ipcMain.handle('window:appearance', (_e, { dark, blur }) => {
  nativeTheme.themeSource = dark ? 'dark' : 'light';
  for (const w of noteWins) {
    try { w.setVibrancy(blur ? 'sidebar' : null); } catch { /* ignore */ }
  }
});

ipcMain.handle('shell:open', (_e, url) => shell.openExternal(url));
ipcMain.handle('shell:reveal', (_e, rel) => shell.showItemInFolder(abs(rel)));

// ---------------------------------------------------------------------------
// IPC: notebook-wide search
// ---------------------------------------------------------------------------

// The match loop runs on a worker thread (search-worker.js) so a pathological
// regex can't freeze the app: if the worker runs past the timeout we terminate
// it and report a timeout. Only one search runs at a time — a newer search
// kills the one in flight. The tree scan stays here (it's bounded, async I/O
// the sidebar needs anyway); the worker does the heavy, unbounded matching.
const SEARCH_TIMEOUT_MS = 4000;
let activeSearch = null;

function runSearch(payload) {
  if (activeSearch) { try { activeSearch.terminate(); } catch { /* already gone */ } activeSearch = null; }
  return new Promise((resolve) => {
    const worker = new Worker(path.join(__dirname, 'search-worker.js'), { workerData: payload });
    activeSearch = worker;
    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (activeSearch === worker) activeSearch = null;
      worker.terminate();
      resolve(val);
    };
    const timer = setTimeout(
      () => finish({ results: [], total: 0, truncated: false, error: 'Search timed out — that pattern is too slow. Try a simpler one.' }),
      SEARCH_TIMEOUT_MS
    );
    worker.on('message', finish);
    worker.on('error', (err) => finish({ results: [], total: 0, error: err.message }));
    worker.on('exit', () => finish({ results: [], total: 0, truncated: false }));
  });
}

ipcMain.handle('search:all', async (_e, { query, caseSensitive, regex, titlesOnly, scope }) => {
  if (!root || !query) return { results: [], total: 0, truncated: false };
  let nodes = flatten(await scanDir(''));
  // scope: a node's rel; only it and the notes under it are searched
  if (scope) nodes = nodes.filter((n) => n.rel === scope || n.rel.startsWith(scope.replace(/\.md$/, '') + '/'));
  // abs() is validated here; the worker only ever sees paths inside the notebook
  const payload = { query, caseSensitive, regex, titlesOnly, nodes: nodes.map((n) => ({ rel: n.rel, title: n.title, abs: abs(n.rel) })) };
  return runSearch(payload);
});

// ---------------------------------------------------------------------------
// Settings window. Changes preview live in the notebook window and are
// written to disk only on Save; closing the window drops the preview.
// ---------------------------------------------------------------------------

const UI_SETTING_KEYS = ['theme', 'customTheme', 'nodeIcons', 'windowAlpha', 'iconColors', 'blur', 'imageStorage', 'keys', 'hotkeys', 'spellcheck', 'mdTyping', 'colorCarry'];
let settingsWin = null;
let keysSuspended = false;

function applySettingsPatch(patch) {
  const s = saveSettings(patch);
  if ('spellcheck' in patch) session.defaultSession.setSpellCheckerEnabled(s.spellcheck !== false);
  if (['theme', 'keys', 'hotkeys', 'spellcheck', 'mdTyping', 'quitKey', 'closeKey'].some((k) => k in patch)) {
    try { buildMenu(); } catch (err) { console.error('menu failed to build:', err); }
  }
  if (UI_SETTING_KEYS.some((k) => k in patch)) {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('settings-changed', s);
  }
  return s;
}

function openSettingsWindow(section) {
  if (settingsWin) {
    settingsWin.focus();
    if (section) settingsWin.webContents.send('settings-section', section);
    return;
  }
  const width = 780;
  const height = 640;
  const pb = win ? win.getBounds() : null;
  settingsWin = new BrowserWindow({
    width,
    height,
    minWidth: 640,
    minHeight: 480,
    x: pb ? Math.round(pb.x + (pb.width - width) / 2) : undefined,
    y: pb ? Math.round(pb.y + (pb.height - height) / 2) : undefined,
    title: 'Settings',
    show: false,
    backgroundColor: '#1e1e22',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    fullscreenable: false,
    minimizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  settingsWin.loadFile(path.join(__dirname, '..', 'renderer', 'settings.html'), { query: section ? { section } : {} });
  settingsWin.once('ready-to-show', () => settingsWin?.show());
  settingsWin.on('closed', () => {
    settingsWin = null;
    if (keysSuspended) {
      keysSuspended = false;
      buildMenu();
    }
    broadcast('settings-revert'); // drop any un-saved live preview
  });
}

ipcMain.handle('settings:open', (_e, section) => openSettingsWindow(section));
ipcMain.handle('settings:close', () => settingsWin?.close());
ipcMain.on('settings:preview', (_e, patch) => broadcast('settings-preview', patch));
ipcMain.on('keys:suspend', (_e, on) => {
  if (keysSuspended === !!on) return;
  keysSuspended = !!on;
  try { buildMenu(); } catch (err) { console.error('menu failed to build:', err); }
});

// ---------------------------------------------------------------------------
// Export: a node and its subtree as plain, readable Markdown
// ---------------------------------------------------------------------------

const MIME_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/bmp': 'bmp' };

// Strip Note4Me's inline HTML (colours, underline, sized images), drop the
// code-box height hint, and move images into files next to the document.
async function readableMarkdown(text, { title, srcDirAbs, outDirAbs, stem }) {
  const { body } = parseFrontMatter(text);
  let n = 0;
  const saveImage = async (src) => {
    const assets = path.join(outDirAbs, 'assets');
    await fs.mkdir(assets, { recursive: true });
    n += 1;
    const m = /^data:(image\/[a-z0-9+.-]+);base64,(.*)$/is.exec(src);
    let name = null;
    if (m) {
      name = `${stem}-${n}.${MIME_EXT[m[1].toLowerCase()] || 'bin'}`;
      await fs.writeFile(path.join(assets, name), Buffer.from(m[2], 'base64'));
    } else if (!/^[a-z]+:/i.test(src)) {
      const from = path.join(srcDirAbs, decodeURIComponent(src));
      name = `${stem}-${n}${path.extname(from)}`;
      await fs.copyFile(from, path.join(assets, name)).catch(() => { name = null; });
    }
    return name ? `![](assets/${encodeURIComponent(name)})` : `![](${src})`;
  };
  const out = [];
  let inFence = false;
  for (let line of body.split('\n')) {
    if (/^```/.test(line)) {
      inFence = !inFence;
      out.push(line.replace(/\s+h=\d+\s*$/, ''));
      continue;
    }
    if (inFence) { out.push(line); continue; }
    const img = /^\s*(?:!\[[^\]]*\]\(([^)]+)\)|<img\s[^>]*src="([^"]+)"[^>]*>)\s*$/i.exec(line);
    if (img) { out.push(await saveImage(img[1] || img[2])); continue; }
    let prev;
    do {
      prev = line;
      line = line.replace(/<span\s+style="[^"]*">([\s\S]*?)<\/span>/gi, '$1').replace(/<u>([\s\S]*?)<\/u>/gi, '$1');
    } while (line !== prev);
    out.push(line);
  }
  return `# ${title}\n\n${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

ipcMain.handle('export:markdown', async (_e, rel) => {
  if (!root || !win) return { error: 'No notebook open.' };
  const node = flatten(await scanDir('')).find((n) => n.rel === rel);
  if (!node) return { error: 'Node not found.' };
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Export as Markdown',
    message: `Choose a folder for "${node.title}" and its child notes`,
    buttonLabel: 'Export Here',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (canceled || !filePaths[0]) return { canceled: true };
  const dest = filePaths[0];
  let count = 0;
  const walk = async (n, outDirAbs) => {
    const stem = path.posix.basename(n.rel, '.md');
    const text = await fs.readFile(abs(n.rel), 'utf8').catch(() => '');
    const md = await readableMarkdown(text, { title: n.title, srcDirAbs: path.dirname(abs(n.rel)), outDirAbs, stem });
    await fs.mkdir(outDirAbs, { recursive: true });
    await fs.writeFile(path.join(outDirAbs, stem + '.md'), md, 'utf8');
    count += 1;
    for (const c of n.children || []) await walk(c, path.join(outDirAbs, stem));
  };
  try {
    await walk(node, dest);
  } catch (err) {
    return { error: err.message };
  }
  const { response } = await dialog.showMessageBox(win, {
    message: `Exported ${count} note${count === 1 ? '' : 's'} as Markdown.`,
    detail: dest,
    buttons: ['Show in Finder', 'OK'],
    defaultId: 1,
  });
  if (response === 0) shell.showItemInFolder(path.join(dest, path.posix.basename(rel, '.md') + '.md'));
  return { count, dest };
});

// ---------------------------------------------------------------------------
// Window / protocol / menu
// ---------------------------------------------------------------------------

protocol.registerSchemesAsPrivileged([
  { scheme: 'nb', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function createWindow({ primary = false } = {}) {
  const s = loadSettings();
  // Cascade a second window off the active one so it doesn't land exactly on top.
  const base = win && !win.isDestroyed() ? win.getBounds() : null;
  const w = new BrowserWindow({
    width: s.width || 1400,
    height: s.height || 900,
    minWidth: 700,
    minHeight: 400,
    x: base ? base.x + 32 : undefined,
    y: base ? base.y + 32 : undefined,
    title: 'Note4Me',
    show: !process.env.NOTE4ME_HIDDEN, // NOTE4ME_HIDDEN=1: headless checks without a window
    // A truly transparent window: with blur on, macOS draws a frosted material
    // behind the page; with blur off, the desktop shows through sharply.
    transparent: true,
    backgroundColor: '#00000000',
    vibrancy: s.blur === true ? 'sidebar' : undefined,
    visualEffectState: 'active',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });
  noteWins.add(w);
  win = w;
  w.flushed = false;
  w.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  w.webContents.on('context-menu', (_e, params) => showContextMenu(params));
  // The active window is whichever was focused last; dialogs and menu commands
  // follow it.
  w.on('focus', () => { win = w; });
  // Headless screenshot for development: NOTE4ME_SHOT=/path/out.png (first window only)
  if (primary && process.env.NOTE4ME_SHOT) {
    w.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2) console.log(`[renderer] ${message}`);
    });
    w.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        // NOTE4ME_SHOT_JS: optional script to drive the UI before the capture
        if (process.env.NOTE4ME_SHOT_JS) {
          const r = await w.webContents.executeJavaScript(process.env.NOTE4ME_SHOT_JS).catch((e) => console.log('shot js failed:', e.message));
          if (r !== undefined) console.log('shot js:', JSON.stringify(r));
          await new Promise((r) => setTimeout(r, 900));
        }
        const img = await w.capturePage();
        fssync.writeFileSync(process.env.NOTE4ME_SHOT, img.toPNG());
        app.exit(0);
      }, Number(process.env.NOTE4ME_SHOT_DELAY || 2500));
    });
  }
  w.on('resize', () => {
    const [width, height] = w.getSize();
    saveSettings({ width, height });
  });
  // Save the open note before the window closes or the app quits. A
  // prevented close would otherwise cancel a quit, so both paths share this.
  w.on('close', (e) => {
    if (w.flushed) return;
    e.preventDefault();
    flushWindow(w, () => { if (!w.isDestroyed()) w.close(); });
  });
  w.on('closed', () => {
    noteWins.delete(w);
    if (win === w) win = [...noteWins].find((x) => !x.isDestroyed()) || null;
  });
  return w;
}

function send(channel, ...args) {
  if (win) win.webContents.send(channel, ...args);
}

// Right-click menu for the editor and the other text fields. Electron shows
// nothing on its own, so spelling suggestions, clipboard commands and the
// formatting shortcuts all live here. The tree draws its own HTML menu and
// swallows the event before it reaches this handler.
function showContextMenu(p) {
  if (!win) return;
  const wc = win.webContents;
  const items = [];
  const sep = () => {
    if (items.length && items[items.length - 1].type !== 'separator') items.push({ type: 'separator' });
  };
  // the note body is a contenteditable, not a form control like the search box
  const inEditor = p.isEditable && p.formControlType === 'none';

  if (p.misspelledWord) {
    const guesses = (p.dictionarySuggestions || []).slice(0, 6);
    if (guesses.length) for (const g of guesses) items.push({ label: g, click: () => wc.replaceMisspelling(g) });
    else items.push({ label: 'No Guesses Found', enabled: false });
    sep();
    items.push({
      label: 'Add to Dictionary',
      click: () => session.defaultSession.addWordToSpellCheckerDictionary(p.misspelledWord),
    });
    sep();
  }
  if (p.linkURL) {
    items.push({ label: 'Open Link', click: () => shell.openExternal(p.linkURL) });
    items.push({ label: 'Copy Link', click: () => clipboard.writeText(p.linkURL) });
    sep();
  }
  if (p.hasImageContents) {
    items.push({ label: 'Copy Image', click: () => wc.copyImageAt(p.x, p.y) });
    sep();
  }
  const selected = (p.selectionText || '').trim();
  if (selected && process.platform === 'darwin') {
    const short = selected.length > 24 ? selected.slice(0, 24) + '…' : selected;
    items.push({ label: `Look Up “${short}”`, click: () => wc.showDefinitionForSelection() });
    sep();
  }
  const f = p.editFlags || {};
  if (inEditor) {
    items.push({ label: 'Undo', click: () => send('cmd', 'undo') });
    items.push({ label: 'Redo', click: () => send('cmd', 'redo') });
    sep();
  } else if (p.isEditable) {
    items.push({ label: 'Undo', enabled: !!f.canUndo, click: () => wc.undo() });
    items.push({ label: 'Redo', enabled: !!f.canRedo, click: () => wc.redo() });
    sep();
  }
  if (p.isEditable || f.canCopy) {
    items.push({ label: 'Cut', enabled: !!f.canCut, click: () => wc.cut() });
    items.push({ label: 'Copy', enabled: !!f.canCopy, click: () => wc.copy() });
    if (p.isEditable) {
      items.push({ label: 'Paste', enabled: !!f.canPaste, click: () => wc.paste() });
      items.push({ label: 'Paste Without Formatting', enabled: !!f.canPaste, click: () => wc.pasteAndMatchStyle() });
    }
    items.push({ label: 'Select All', enabled: f.canSelectAll !== false, click: () => wc.selectAll() });
  }
  if (inEditor) {
    sep();
    items.push({
      label: 'Format',
      submenu: [
        { label: 'Bold', click: () => send('cmd', 'bold') },
        { label: 'Italic', click: () => send('cmd', 'italic') },
        { label: 'Underline', click: () => send('cmd', 'underline') },
        { label: 'Strikethrough', click: () => send('cmd', 'strike') },
        { label: 'Monospace', click: () => send('cmd', 'code') },
        { type: 'separator' },
        { label: 'Foreground Color…', click: () => send('cmd', 'fg') },
        { label: 'Background Color…', click: () => send('cmd', 'bg') },
        { label: 'Clear Formatting', click: () => send('cmd', 'clear') },
        { type: 'separator' },
        { label: 'Bullet List', click: () => send('cmd', 'bullets') },
        { label: 'Numbered List', click: () => send('cmd', 'numbers') },
        { label: 'Code Box', click: () => send('cmd', 'codeblock') },
      ],
    });
  }
  while (items.length && items[items.length - 1].type === 'separator') items.pop();
  if (!items.length) return;
  Menu.buildFromTemplate(items).popup({ window: win });
}

// Ask one window's renderer to save its open note, then run `fn`. Each window
// flushes on its own handshake so closing one never waits on another; the
// `flushed` reply is matched to the window that sent the `flush`.
function flushWindow(w, fn) {
  if (!w || w.isDestroyed() || w.flushed) return fn();
  if (w._flushing) return;
  w._flushing = true;
  let settled = false;
  const done = () => {
    if (settled) return;
    settled = true;
    w._flushing = false;
    if (!w.isDestroyed()) w.flushed = true;
    ipcMain.removeListener('flushed', onFlushed);
    clearTimeout(timer);
    fn();
  };
  const onFlushed = (e) => { if (!w.isDestroyed() && e.sender === w.webContents) done(); };
  ipcMain.on('flushed', onFlushed);
  const timer = setTimeout(done, 1500);
  w.webContents.send('flush');
}

app.on('before-quit', (e) => {
  const pending = [...noteWins].filter((w) => !w.isDestroyed() && !w.flushed);
  if (!pending.length) return;
  e.preventDefault();
  Promise.all(pending.map((w) => new Promise((res) => flushWindow(w, res)))).then(() => app.quit());
});

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const settings = loadSettings();
  const theme = settings.theme || 'modern-dark';
  const K = resolveKeys(settings);
  // settings.hotkeys === false turns every app shortcut off (the standard
  // macOS editing keys and the Quit/Close keys stay). While the settings
  // window is recording a shortcut none may fire, otherwise pressing the keys
  // you want to assign runs the old command. Role items get their default key
  // back whenever the accelerator is undefined, so "no key" must be '' here.
  const hotkeysOn = settings.hotkeys !== false;
  const acc = (id) => (keysSuspended || !hotkeysOn ? '' : K[id] || '');
  const item = (id, label, click) => ({ label, accelerator: acc(id), click: click || (() => send('cmd', id)) });
  // Native roles keep their default keys unless a configured shortcut takes one.
  const taken = new Set(Object.values(K).filter(Boolean).map(normalizeAccelerator));
  const roleAcc = (def) => {
    if (keysSuspended) return '';
    const n = normalizeAccelerator(def);
    return taken.has(n) ? n.replace('CmdOrCtrl', 'Ctrl') : n;
  };
  const role = (r, def) => ({ role: r, accelerator: def ? roleAcc(def) : '' });
  const wc = () => BrowserWindow.getFocusedWindow()?.webContents;
  // Quit and Close follow the user's key even with hotkeys off; a cleared key means none.
  const quitItem = { role: 'quit', accelerator: keysSuspended ? '' : K.quit || '' };
  const closeItem = { role: 'close', accelerator: keysSuspended ? '' : K.close || '' };
  const template = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            item('settings', 'Settings…', () => openSettingsWindow()),
            { type: 'separator' },
            { role: 'services' }, { type: 'separator' }, role('hide', 'Cmd+H'), role('hideOthers', 'Cmd+Alt+H'), { role: 'unhide' },
            { type: 'separator' }, quitItem,
          ],
        }]
      : []),
    {
      label: 'File',
      submenu: [
        item('open-notebook', 'Open Notebook…'),
        item('new-notebook', 'New Notebook…'),
        item('new-window', 'New Window', () => createWindow()),
        { type: 'separator' },
        item('new-sibling', 'New Node (same level)'),
        item('new-child', 'New Child Node'),
        item('rename', 'Rename Node'),
        item('delete', 'Delete Node'),
        { type: 'separator' },
        item('reveal', 'Reveal in Finder'),
        item('export-md', 'Export as Markdown…'),
        ...(isMac ? [] : [item('settings', 'Settings…', () => openSettingsWindow())]),
        { type: 'separator' },
        isMac ? closeItem : quitItem,
      ],
    },
    {
      label: 'Edit',
      submenu: [
        // The note's undo history lives in the editor, not in Chromium, so the
        // menu asks the window; other windows and text fields get the native undo.
        { label: 'Undo', accelerator: roleAcc('CmdOrCtrl+Z'), click: () => (BrowserWindow.getFocusedWindow() === win ? send('cmd', 'undo') : wc()?.undo()) },
        { label: 'Redo', accelerator: roleAcc('CmdOrCtrl+Shift+Z'), click: () => (BrowserWindow.getFocusedWindow() === win ? send('cmd', 'redo') : wc()?.redo()) },
        { type: 'separator' },
        role('cut', 'CmdOrCtrl+X'), role('copy', 'CmdOrCtrl+C'), role('paste', 'CmdOrCtrl+V'),
        item('paste-plain', 'Paste Without Formatting', () => wc()?.pasteAndMatchStyle()),
        role('selectAll', 'CmdOrCtrl+A'),
        {
          label: 'Linux-Style Shortcuts',
          submenu: [
            item('linux-undo', 'Undo', () => send('cmd', 'undo')),
            item('linux-redo', 'Redo', () => send('cmd', 'redo')),
            item('linux-redo-alt', 'Redo (Shift)', () => send('cmd', 'redo')),
            { type: 'separator' },
            item('linux-copy', 'Copy', () => wc()?.copy()),
            item('linux-cut', 'Cut', () => wc()?.cut()),
            item('linux-paste', 'Paste', () => wc()?.paste()),
            item('linux-paste-plain', 'Paste Without Formatting', () => wc()?.pasteAndMatchStyle()),
            item('linux-select-all', 'Select All', () => wc()?.selectAll()),
          ],
        },
        {
          label: 'Selection',
          submenu: [
            item('select-word-right', 'Select Next Word'),
            item('select-word-left', 'Select Previous Word'),
            item('select-line-end', 'Select to End of Line'),
            item('select-line-start', 'Select to Start of Line'),
          ],
        },
        { type: 'separator' },
        {
          label: 'Check Spelling While Typing',
          type: 'checkbox',
          checked: settings.spellcheck !== false,
          click: (mi) => applySettingsPatch({ spellcheck: mi.checked }),
        },
        { type: 'separator' },
        item('find', 'Find in Note'),
        item('replace', 'Find and Replace in Note'),
        item('search', 'Search All Notes'),
      ],
    },
    {
      label: 'Format',
      submenu: [
        item('bold', 'Bold'), item('italic', 'Italic'), item('underline', 'Underline'), item('strike', 'Strikethrough'), item('code', 'Monospace'),
        { type: 'separator' },
        item('fg', 'Text Color…'), item('bg', 'Highlight Color…'), item('fg-again', 'Apply Last Text Color'), item('bg-again', 'Apply Last Highlight'), item('clear', 'Clear Formatting'),
        { type: 'separator' },
        item('bullets', 'Bullet List'), item('numbers', 'Numbered List'),
        { type: 'separator' },
        item('codeblock', 'Insert Code Box'),
        { type: 'separator' },
        {
          label: 'Paragraph Style',
          submenu: [item('para', 'Normal Text'), item('h1', 'Heading 1'), item('h2', 'Heading 2'), item('h3', 'Heading 3')],
        },
        { type: 'separator' },
        {
          label: 'Markdown While Typing',
          type: 'checkbox',
          checked: settings.mdTyping !== false,
          accelerator: acc('md-typing'),
          click: (mi) => applySettingsPatch({ mdTyping: mi.checked }),
        },
      ],
    },
    {
      label: 'Tree',
      submenu: [
        item('move-up', 'Move Node Up'), item('move-down', 'Move Node Down'),
        item('indent', 'Indent Node (make child of previous)'), item('outdent', 'Outdent Node'),
        { type: 'separator' },
        item('prev-node', 'Previous Node'), item('next-node', 'Next Node'),
      ],
    },
    {
      label: 'View',
      submenu: [
        item('zoom-in', 'Bigger Text'), item('zoom-out', 'Smaller Text'), item('zoom-reset', 'Reset Text Size'),
        { type: 'separator' },
        {
          label: 'Theme',
          submenu: THEMES.map(([id, label]) => ({
            label,
            type: 'radio',
            checked: id === theme,
            click: () => send('cmd', `theme:${id}`),
          })),
        },
        item('toggle-tree', 'Toggle Tree'),
        { type: 'separator' },
        role('reload', 'CmdOrCtrl+R'), role('toggleDevTools', 'Alt+CmdOrCtrl+I'), { type: 'separator' }, role('togglefullscreen', 'Ctrl+CmdOrCtrl+F'),
      ],
    },
    {
      role: 'window',
      submenu: [
        role('minimize', 'CmdOrCtrl+M'), { role: 'zoom' },
        ...(isMac ? [{ type: 'separator' }, { role: 'front' }] : [closeItem]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  protocol.handle('nb', (request) => {
    try {
      const u = new URL(request.url);
      const rel = decodeURIComponent(u.pathname.replace(/^\//, ''));
      return net.fetch(pathToFileURL(abs(rel)).toString());
    } catch {
      return new Response('not found', { status: 404 });
    }
  });
  const s = loadSettings();
  session.defaultSession.setSpellCheckerEnabled(s.spellcheck !== false);
  if (process.platform === 'darwin' && app.dock) {
    try { app.dock.setIcon(path.join(__dirname, '..', 'assets', 'icon.png')); } catch { /* ignore */ }
  }
  try {
    buildMenu();
  } catch (err) {
    console.error('menu failed to build:', err);
  }
  createWindow({ primary: true });
  app.on('activate', () => {
    if (noteWins.size === 0) createWindow({ primary: true });
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
