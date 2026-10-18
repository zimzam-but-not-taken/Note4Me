// Settings window. Every change previews live in the notebook window (over
// IPC) and is written to disk only on Save; Cancel or closing drops it.

import { THEME_IDS, THEME_LABELS, CUSTOM_VARS, applyThemeVars, sampleThemes, currentVarHex, currentAlpha, toHex } from './theme.js';
import { ICON_STYLES, ICON_LABELS, DEFAULT_ICON_COLORS, nodeIcon, iconDefs } from './icons.js';
import { SHORTCUTS, resolveKeys, normalizeAccelerator, displayAccelerator } from '../shared/shortcuts.js';

const $ = (sel) => document.querySelector(sel);
const api = window.api;
const validColors = (c) => Array.isArray(c) && c.length === DEFAULT_ICON_COLORS.length && c.every((x) => /^#[0-9a-f]{6}$/i.test(x));
const iconColors = () => (validColors(draft?.iconColors) ? draft.iconColors : DEFAULT_ICON_COLORS);

let draft = null;
let themeSamples = {};
let selectedVar = CUSTOM_VARS[0][0];

// The subset of settings this window owns.
function pickDraft(s) {
  const keys = { ...(s.keys || {}) };
  // older settings stored just these two outside `keys`
  if (keys.quit === undefined && s.quitKey) keys.quit = s.quitKey;
  if (keys.close === undefined && s.closeKey) keys.close = s.closeKey;
  return {
    theme: s.theme || 'modern-dark',
    customTheme: s.customTheme ? { ...s.customTheme } : null,
    nodeIcons: ICON_STYLES.includes(s.nodeIcons) ? s.nodeIcons : 'folders',
    windowAlpha: s.windowAlpha ?? null,
    iconColors: validColors(s.iconColors) ? [...s.iconColors] : null,
    blur: s.blur === true,
    imageStorage: s.imageStorage || 'embed',
    keys,
    hotkeys: s.hotkeys !== false,
    spellcheck: s.spellcheck !== false,
    mdTyping: s.mdTyping !== false,
    colorCarry: s.colorCarry === true,
  };
}

function patchOf(d) {
  const keys = {};
  for (const sc of SHORTCUTS) {
    const v = d.keys[sc.id];
    if (typeof v === 'string' && normalizeAccelerator(v) !== sc.key) keys[sc.id] = normalizeAccelerator(v);
  }
  return { ...d, keys, quitKey: null, closeKey: null };
}

function preview() {
  applyThemeVars(draft.theme, draft.customTheme);
  api.settings.preview(patchOf(draft));
}

async function save() {
  await api.settings.set(patchOf(draft));
  api.settings.close();
}

// ---------------------------------------------------------------------------
// Appearance
// ---------------------------------------------------------------------------

function miniPreview(c) {
  const el = document.createElement('div');
  el.className = 'mini';
  el.style.background = c.editor;
  el.innerHTML = `
    <div class="m-tree" style="background:${c.tree}"><i style="background:${c.text}"></i><i style="background:${c.accent};opacity:.9"></i><i style="background:${c.text}"></i></div>
    <div class="m-main">
      <div class="m-bar" style="background:${c.chrome}"><b style="background:${c.text}"></b><b style="background:${c.text}"></b><b style="background:${c.accent}"></b></div>
      <div class="m-page"><i class="t" style="background:${c.accent}"></i><i style="background:${c.text}"></i><i style="background:${c.text}"></i><i class="l" style="background:${c.link}"></i></div>
    </div>`;
  return el;
}

function customSample() {
  const c = draft.customTheme || {};
  const base = { ...(themeSamples[c.base] || themeSamples['modern-dark']) };
  const map = { '--editor-bg': 'editor', '--editor-fg': 'text', '--tree-bg': 'tree', '--chrome-bg': 'chrome', '--accent': 'accent', '--link': 'link' };
  for (const [v, k] of Object.entries(map)) if (toHex(c[v])) base[k] = toHex(c[v]);
  return base;
}

function renderThemeTiles() {
  const grid = $('#theme-grid');
  grid.replaceChildren();
  for (const id of [...THEME_IDS, 'custom']) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'tile' + (draft.theme === id ? ' active' : '');
    tile.dataset.theme = id;
    tile.appendChild(miniPreview(id === 'custom' ? customSample() : themeSamples[id]));
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = THEME_LABELS[id];
    tile.appendChild(name);
    tile.addEventListener('click', () => {
      draft.theme = id;
      if (id === 'custom' && !draft.customTheme) draft.customTheme = { base: 'modern-dark' };
      $('#custom-block').hidden = id !== 'custom';
      preview();
      renderThemeTiles();
      if (id === 'custom') renderCustom();
    });
    grid.appendChild(tile);
  }
  $('#custom-block').hidden = draft.theme !== 'custom';
}

function renderCustom() {
  const c = draft.customTheme || (draft.customTheme = { base: 'modern-dark' });
  $('#c-base').value = THEME_IDS.includes(c.base) ? c.base : 'modern-dark';
  const varSel = $('#c-var');
  varSel.replaceChildren();
  for (const [v, label] of CUSTOM_VARS) varSel.appendChild(new Option((c[v] ? '● ' : '') + label, v));
  varSel.value = selectedVar;
  const value = c[selectedVar] || '';
  $('#c-hex').value = value;
  $('#c-color').value = toHex(value) || currentVarHex(selectedVar);
  const chips = $('#c-chips');
  chips.replaceChildren();
  const overridden = CUSTOM_VARS.filter(([v]) => c[v]);
  if (!overridden.length) {
    const none = document.createElement('span');
    none.className = 'none';
    none.textContent = 'No colours changed yet';
    chips.appendChild(none);
  }
  for (const [v, label] of overridden) {
    const chip = document.createElement('span');
    chip.className = 'chip' + (v === selectedVar ? ' active' : '');
    chip.innerHTML = `<span class="sw" style="background:${c[v]}"></span><span>${label}</span><span class="x" title="Use the base theme's colour">×</span>`;
    chip.addEventListener('click', (e) => {
      if (e.target.classList.contains('x')) setCustomColor(v, '');
      else { selectedVar = v; renderCustom(); }
    });
    chips.appendChild(chip);
  }
}

function setCustomColor(v, value) {
  const c = draft.customTheme || (draft.customTheme = { base: 'modern-dark' });
  if (value) c[v] = value;
  else delete c[v];
  preview();
  renderCustom();
  renderThemeTiles();
}

function refreshIconDefs() {
  document.getElementById('icon-defs')?.remove();
  const holder = document.createElement('div');
  holder.id = 'icon-defs';
  holder.innerHTML = iconDefs(iconColors());
  document.body.prepend(holder);
}

function renderIconColors() {
  const wrap = $('#icon-colors');
  wrap.replaceChildren();
  iconColors().forEach((hex, i) => {
    const input = document.createElement('input');
    input.type = 'color';
    input.value = hex;
    input.title = `Level ${i + 1}`;
    input.addEventListener('input', () => {
      const next = [...iconColors()];
      next[i] = input.value;
      draft.iconColors = next;
      refreshIconDefs();
      renderIconTiles();
      preview();
    });
    wrap.appendChild(input);
  });
}

function renderIconTiles() {
  const grid = $('#icon-grid');
  grid.replaceChildren();
  const colors = iconColors();
  for (const style of ICON_STYLES) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'tile' + (draft.nodeIcons === style ? ' active' : '');
    const pair = document.createElement('div');
    pair.className = 'icon-pair';
    pair.innerHTML = style === 'none' ? '<span class="hint">—</span>' : nodeIcon(style, colors[0], true) + nodeIcon(style, colors[2], false);
    tile.appendChild(pair);
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = ICON_LABELS[style];
    tile.appendChild(name);
    tile.addEventListener('click', () => {
      draft.nodeIcons = style;
      preview();
      renderIconTiles();
    });
    grid.appendChild(tile);
  }
}

function wireAppearance() {
  $('#c-base').replaceChildren(...THEME_IDS.map((id) => new Option(THEME_LABELS[id], id)));
  $('#c-base').addEventListener('change', () => {
    draft.customTheme = { ...(draft.customTheme || {}), base: $('#c-base').value };
    preview();
    renderCustom();
    renderThemeTiles();
  });
  $('#c-var').addEventListener('change', () => { selectedVar = $('#c-var').value; renderCustom(); });
  $('#c-color').addEventListener('input', () => setCustomColor(selectedVar, $('#c-color').value));
  $('#c-hex').addEventListener('change', () => setCustomColor(selectedVar, $('#c-hex').value.trim()));
  $('#c-reset').addEventListener('click', () => setCustomColor(selectedVar, ''));

  const alpha = $('#s-alpha');
  alpha.addEventListener('input', () => {
    $('#s-alpha-val').textContent = alpha.value + '%';
    draft.windowAlpha = Number(alpha.value) / 100;
    preview();
  });
  $('#s-blur').addEventListener('change', () => { draft.blur = $('#s-blur').checked; preview(); });
  $('#icon-colors-reset').addEventListener('click', () => {
    draft.iconColors = null;
    refreshIconDefs();
    renderIconColors();
    renderIconTiles();
    preview();
  });
}

function fillAppearance() {
  renderThemeTiles();
  if (draft.theme === 'custom') renderCustom();
  const wa = draft.windowAlpha ?? currentAlpha('--editor-bg');
  $('#s-alpha').value = Math.round(wa * 20) * 5;
  $('#s-alpha-val').textContent = $('#s-alpha').value + '%';
  $('#s-blur').checked = draft.blur;
  renderIconColors();
  renderIconTiles();
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

function wireEditor() {
  $('#s-spell').addEventListener('change', () => { draft.spellcheck = $('#s-spell').checked; });
  $('#s-md').addEventListener('change', () => { draft.mdTyping = $('#s-md').checked; });
  $('#s-colorcarry').addEventListener('change', () => { draft.colorCarry = $('#s-colorcarry').checked; });
  $('#s-images').addEventListener('change', () => { draft.imageStorage = $('#s-images').value; });
}

function fillEditor() {
  $('#s-spell').checked = draft.spellcheck;
  $('#s-md').checked = draft.mdTyping;
  $('#s-colorcarry').checked = draft.colorCarry;
  $('#s-images').value = draft.imageStorage;
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

const CODE_KEYS = {
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Enter: 'Return', NumpadEnter: 'Return',
  Backspace: 'Backspace', Delete: 'Delete', Space: 'Space', Tab: 'Tab', Escape: 'Esc', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  Comma: ',', Period: '.', Slash: '/', Backslash: '\\', BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Semicolon: ';', Quote: "'", Backquote: '`',
  IntlBackslash: '\\', NumpadAdd: 'Plus', NumpadSubtract: '-', NumpadMultiply: '*', NumpadDivide: '/', NumpadDecimal: '.', Insert: 'Insert', PrintScreen: 'PrintScreen',
};

function acceleratorFromEvent(e) {
  const code = e.code || '';
  let key = '';
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit\d$/.test(code)) key = code.slice(5);
  else if (/^Numpad\d$/.test(code)) key = code.slice(6);
  else if (/^F\d{1,2}$/.test(code)) key = code;
  else key = CODE_KEYS[code] || (e.key && e.key.length === 1 && e.key.trim() ? e.key.toUpperCase() : '');
  if (!key) return null;
  const mods = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('CmdOrCtrl');
  return [...mods, key].join('+');
}

function effectiveKeys() {
  return resolveKeys({ keys: draft.keys });
}

function renderKeys() {
  const wrap = $('#keys');
  wrap.replaceChildren();
  const K = effectiveKeys();
  const users = new Map();
  for (const sc of SHORTCUTS) if (K[sc.id]) users.set(K[sc.id], [...(users.get(K[sc.id]) || []), sc]);
  let group = null;
  let box = null;
  for (const sc of SHORTCUTS) {
    if (sc.group !== group) {
      group = sc.group;
      box = document.createElement('div');
      box.className = 'kgroup';
      const t = document.createElement('div');
      t.className = 'ktitle';
      t.textContent = group;
      box.appendChild(t);
      wrap.appendChild(box);
    }
    const acc = K[sc.id];
    const row = document.createElement('div');
    row.className = 'krow';
    const others = (users.get(acc) || []).filter((o) => o.id !== sc.id);
    if (acc && others.length) {
      row.classList.add('conflict');
      row.title = 'Also used by: ' + others.map((o) => o.label).join(', ');
    }
    const label = document.createElement('span');
    label.className = 'klabel';
    label.textContent = sc.label;
    const cap = document.createElement('button');
    cap.type = 'button';
    cap.className = 'keycap' + (acc ? '' : ' empty') + (acc !== sc.key ? ' changed' : '');
    cap.textContent = acc ? displayAccelerator(acc) : 'none';
    cap.title = acc || 'No shortcut';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'kreset';
    reset.textContent = '↺';
    reset.title = 'Back to default' + (sc.key ? ` (${displayAccelerator(sc.key)})` : '');
    reset.hidden = acc === sc.key;
    reset.addEventListener('click', () => { delete draft.keys[sc.id]; renderKeys(); });
    cap.addEventListener('focus', () => {
      cap.classList.add('recording');
      cap.textContent = 'Press keys…';
      api.settings.suspendKeys(true);
    });
    cap.addEventListener('blur', () => {
      api.settings.suspendKeys(false);
      renderKeys();
    });
    cap.addEventListener('keydown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (/^(Shift|Control|Alt|Meta)/.test(e.code)) return;
      const plain = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
      if (plain && e.code === 'Escape') { cap.blur(); return; }
      if (plain && (e.code === 'Backspace' || e.code === 'Delete')) { draft.keys[sc.id] = ''; cap.blur(); return; }
      if (plain && (e.code === 'Enter' || e.code === 'NumpadEnter')) { cap.blur(); return; }
      const acc = acceleratorFromEvent(e);
      if (!acc) return;
      // a bare letter would just type; shortcuts need a modifier or an F-key
      if (!e.metaKey && !e.ctrlKey && !e.altKey && !/^F\d/.test(acc)) { cap.textContent = 'Add ⌘, ⌃ or ⌥ (F-keys work alone)'; return; }
      draft.keys[sc.id] = acc;
      cap.blur();
    });
    row.append(label, cap, reset);
    box.appendChild(row);
  }
}

function wireKeys() {
  $('#keys-defaults').addEventListener('click', () => { draft.keys = {}; renderKeys(); });
  $('#keys-on').addEventListener('change', () => {
    draft.hotkeys = $('#keys-on').checked;
    $('#keys').classList.toggle('off', !draft.hotkeys);
  });
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

function showSection(name) {
  for (const b of document.querySelectorAll('#s-nav button')) b.classList.toggle('active', b.dataset.section === name);
  for (const s of document.querySelectorAll('.sec')) s.classList.toggle('active', s.id === 'sec-' + name);
  $('#s-main').scrollTop = 0;
}

async function main() {
  const s = await api.settings.get();
  draft = pickDraft(s);
  refreshIconDefs();
  themeSamples = sampleThemes();
  applyThemeVars(draft.theme, draft.customTheme);

  wireAppearance();
  wireEditor();
  wireKeys();
  fillAppearance();
  fillEditor();
  renderKeys();
  $('#keys-on').checked = draft.hotkeys;
  $('#keys').classList.toggle('off', !draft.hotkeys);

  for (const b of document.querySelectorAll('#s-nav button')) b.addEventListener('click', () => showSection(b.dataset.section));
  const section = new URLSearchParams(location.search).get('section');
  if (section) showSection(section);
  api.onSettingsSection?.((name) => showSection(name));

  $('#s-save').addEventListener('click', save);
  $('#s-cancel').addEventListener('click', () => api.settings.close());
  document.addEventListener('keydown', (e) => {
    if (e.target.classList?.contains('keycap')) return;
    if (e.key === 'Escape') { e.preventDefault(); api.settings.close(); }
    else if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
      if (e.target.tagName === 'INPUT') e.target.dispatchEvent(new Event('change'));
      save();
    }
  });

  // the notebook window may change the theme from its View menu meanwhile
  api.onSettingsChanged?.((next) => {
    if (document.activeElement?.classList?.contains('keycap')) return;
    const mine = patchOf(draft);
    const theirs = patchOf(pickDraft(next));
    if (JSON.stringify(mine) === JSON.stringify(theirs)) return;
    draft.theme = theirs.theme;
    draft.customTheme = theirs.customTheme;
    applyThemeVars(draft.theme, draft.customTheme);
    renderThemeTiles();
    if (draft.theme === 'custom') renderCustom();
  });
}

main();
