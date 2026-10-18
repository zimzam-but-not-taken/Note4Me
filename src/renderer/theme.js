// Theme helpers shared by the main window and the settings window.
// Themes are sets of CSS variables on <html data-theme>; a custom theme is a
// base theme plus per-variable overrides stored in settings.customTheme.

export const THEME_IDS = ['modern-dark', 'modern-light', 'cherry-dark', 'cherry-light', 'dracula', 'nord', 'solarized-dark'];
export const THEME_LABELS = {
  'modern-dark': 'Modern dark', 'modern-light': 'Modern light', 'cherry-dark': 'Classic dark', 'cherry-light': 'Classic light',
  dracula: 'Dracula', nord: 'Nord', 'solarized-dark': 'Solarized dark', custom: 'Custom',
};

// Surfaces the user can recolour in a custom theme.
export const CUSTOM_VARS = [
  ['--editor-bg', 'Editor background'],
  ['--editor-fg', 'Text color'],
  ['--chrome-bg', 'Top bar background'],
  ['--chrome-fg', 'Top bar buttons & text'],
  ['--tree-bg', 'Tree background'],
  ['--tree-fg', 'Tree text'],
  ['--tree-sel-bg', 'Tree selection'],
  ['--accent', 'Accent'],
  ['--code-bg', 'Code box background'],
  ['--code-fg', 'Code box text'],
  ['--link', 'Links'],
];

export function toHex(cssColor) {
  const t = String(cssColor || '').trim();
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(t);
  if (m) return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
  if (/^#[0-9a-f]{6}$/i.test(t)) return t.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(t)) return '#' + [...t.slice(1)].map((c) => c + c).join('').toLowerCase();
  return null;
}

// The colour a variable currently resolves to, as hex (alpha dropped).
export function currentVarHex(v) {
  const el = document.createElement('span');
  el.style.color = `var(${v})`;
  el.style.position = 'absolute';
  el.style.opacity = '0';
  document.body.appendChild(el);
  const c = getComputedStyle(el).color;
  el.remove();
  return toHex(c) || '#000000';
}

// How see-through a background currently is (0..1), read from the live style.
export function currentAlpha(v) {
  const el = document.createElement('span');
  el.style.backgroundColor = `var(${v})`;
  el.style.position = 'absolute';
  el.style.opacity = '0';
  document.body.appendChild(el);
  const c = getComputedStyle(el).backgroundColor;
  el.remove();
  const m = /rgba?\([^)]*?(?:,|\/)\s*([\d.]+)\s*\)$/.exec(c);
  const a = m && c.includes('/') || (m && c.startsWith('rgba')) ? Number(m[1]) : 1;
  return Math.max(0, Math.min(1, 1 - (Number.isFinite(a) ? a : 1)));
}

// Keep custom backgrounds responsive to the transparency slider.
export function withAlphaVar(v, value) {
  const hex = toHex(value);
  if (!hex) return value;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  if (v === '--tree-bg') return `rgb(${r} ${g} ${b} / var(--tree-alpha, 1))`;
  if (v === '--editor-bg') return `rgb(${r} ${g} ${b} / var(--editor-alpha, 1))`;
  if (v === '--chrome-bg') return `rgb(${r} ${g} ${b} / var(--chrome-alpha, 1))`;
  return value;
}

// Put a theme on <html>: data-theme plus inline overrides for a custom one.
export function applyThemeVars(theme, customTheme) {
  const root = document.documentElement;
  for (const [v] of CUSTOM_VARS) root.style.removeProperty(v);
  if (theme === 'custom') {
    const c = customTheme || {};
    root.dataset.theme = THEME_IDS.includes(c.base) ? c.base : 'modern-dark';
    for (const [v] of CUSTOM_VARS) if (c[v]) root.style.setProperty(v, withAlphaVar(v, c[v]));
  } else {
    root.dataset.theme = THEME_IDS.includes(theme) ? theme : 'modern-dark';
  }
}

// Transparency: 0 = solid, 1 = fully see-through. null = theme default.
export function applyAlpha(windowAlpha) {
  const root = document.documentElement;
  for (const v of ['--tree-alpha', '--chrome-alpha', '--editor-alpha']) {
    if (windowAlpha === null || windowAlpha === undefined) root.style.removeProperty(v);
    else root.style.setProperty(v, String(1 - windowAlpha));
  }
}

// Is the editor background dark? Drives the native frosted material + menus.
export function themeIsDark() {
  const hex = currentVarHex('--editor-bg');
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) < 128;
}

// Representative colours of every built-in theme, for preview tiles.
// Reads them off the live stylesheet by switching <html data-theme> briefly.
export function sampleThemes() {
  const root = document.documentElement;
  const saved = root.dataset.theme;
  const out = {};
  for (const id of THEME_IDS) {
    root.dataset.theme = id;
    out[id] = {
      editor: currentVarHex('--editor-bg'), text: currentVarHex('--editor-fg'), tree: currentVarHex('--tree-bg'),
      chrome: currentVarHex('--chrome-bg'), accent: currentVarHex('--accent'), link: currentVarHex('--link'),
    };
  }
  if (saved) root.dataset.theme = saved;
  else delete root.dataset.theme;
  return out;
}
