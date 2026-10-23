// Note4Me renderer: tree + editor + glue.

import { Editor, Extension, InputRule, markInputRule, textblockTypeInputRule } from '@tiptap/core';
import { EditorState, Plugin, PluginKey, Selection, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import { BulletList, OrderedList, ListItem } from '@tiptap/extension-list';
import { NodeRange } from '@tiptap/pm/model';
import { findWrapping, liftTarget, ReplaceStep } from '@tiptap/pm/transform';
import Bold from '@tiptap/extension-bold';
import Italic from '@tiptap/extension-italic';
import Strike from '@tiptap/extension-strike';
import Code from '@tiptap/extension-code';
import Heading from '@tiptap/extension-heading';
import { TextStyle, Color, BackgroundColor } from '@tiptap/extension-text-style';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Image from '@tiptap/extension-image';
import { createLowlight } from 'lowlight';
import { parseMarkdown, serializeMarkdown } from './md.js';
import { applyThemeVars, applyAlpha, themeIsDark } from './theme.js';
import { ICON_STYLES, DEFAULT_ICON_COLORS, nodeIcon as drawNodeIcon, iconDefs } from './icons.js';
import { SHORTCUTS, resolveKeys } from '../shared/shortcuts.js';

// Lazy syntax highlighting: lowlight starts with no grammars, so a note
// with no code box loads none. Each language is a separate chunk (esbuild
// code-splitting) fetched the first time a code box uses it. LANG_LOADERS
// maps a fence language to its import; ALIASES fold common spellings in.
const LANG_LOADERS = {
  'bash': () => import('highlight.js/lib/languages/bash'),
  'shell': () => import('highlight.js/lib/languages/shell'),
  'powershell': () => import('highlight.js/lib/languages/powershell'),
  'python': () => import('highlight.js/lib/languages/python'),
  'javascript': () => import('highlight.js/lib/languages/javascript'),
  'typescript': () => import('highlight.js/lib/languages/typescript'),
  'json': () => import('highlight.js/lib/languages/json'),
  'yaml': () => import('highlight.js/lib/languages/yaml'),
  'xml': () => import('highlight.js/lib/languages/xml'),
  'sql': () => import('highlight.js/lib/languages/sql'),
  'php': () => import('highlight.js/lib/languages/php'),
  'ruby': () => import('highlight.js/lib/languages/ruby'),
  'perl': () => import('highlight.js/lib/languages/perl'),
  'go': () => import('highlight.js/lib/languages/go'),
  'rust': () => import('highlight.js/lib/languages/rust'),
  'c': () => import('highlight.js/lib/languages/c'),
  'cpp': () => import('highlight.js/lib/languages/cpp'),
  'csharp': () => import('highlight.js/lib/languages/csharp'),
  'java': () => import('highlight.js/lib/languages/java'),
  'kotlin': () => import('highlight.js/lib/languages/kotlin'),
  'swift': () => import('highlight.js/lib/languages/swift'),
  'lua': () => import('highlight.js/lib/languages/lua'),
  'r': () => import('highlight.js/lib/languages/r'),
  'css': () => import('highlight.js/lib/languages/css'),
  'scss': () => import('highlight.js/lib/languages/scss'),
  'less': () => import('highlight.js/lib/languages/less'),
  'markdown': () => import('highlight.js/lib/languages/markdown'),
  'ini': () => import('highlight.js/lib/languages/ini'),
  'properties': () => import('highlight.js/lib/languages/properties'),
  'makefile': () => import('highlight.js/lib/languages/makefile'),
  'dockerfile': () => import('highlight.js/lib/languages/dockerfile'),
  'nginx': () => import('highlight.js/lib/languages/nginx'),
  'apache': () => import('highlight.js/lib/languages/apache'),
  'http': () => import('highlight.js/lib/languages/http'),
  'diff': () => import('highlight.js/lib/languages/diff'),
  'graphql': () => import('highlight.js/lib/languages/graphql'),
  'objectivec': () => import('highlight.js/lib/languages/objectivec'),
  'vbnet': () => import('highlight.js/lib/languages/vbnet'),
  'vbscript': () => import('highlight.js/lib/languages/vbscript'),
  'x86asm': () => import('highlight.js/lib/languages/x86asm'),
  'armasm': () => import('highlight.js/lib/languages/armasm'),
  'wasm': () => import('highlight.js/lib/languages/wasm'),
  'plaintext': () => import('highlight.js/lib/languages/plaintext'),
};
const LANG_ALIASES = {
  'sh': 'bash',
  'zsh': 'bash',
  'console': 'shell',
  'ps': 'powershell',
  'ps1': 'powershell',
  'py': 'python',
  'js': 'javascript',
  'ts': 'typescript',
  'yml': 'yaml',
  'html': 'xml',
  'htm': 'xml',
  'rb': 'ruby',
  'pl': 'perl',
  'golang': 'go',
  'rs': 'rust',
  'c++': 'cpp',
  'cs': 'csharp',
  'kt': 'kotlin',
  'md': 'markdown',
  'conf': 'ini',
  'dockerfile': 'dockerfile',
  'asm': 'x86asm',
  'arm': 'armasm',
  'vbs': 'vbscript',
  'text': 'plaintext',
  'txt': 'plaintext',
  'objc': 'objectivec',
  'vb': 'vbnet',
};

const lowlight = createLowlight();
const LANG_NAMES = Object.keys(LANG_LOADERS).sort();
const loadedLangs = new Set();
const loadingLangs = new Map();
// Canonical loader key for a fence language ('py' -> 'python'); null if unknown.
function langKey(name) {
  if (!name) return null;
  const n = String(name).toLowerCase();
  const k = LANG_ALIASES[n] || n;
  return LANG_LOADERS[k] ? k : null;
}
// Load a language's grammar once, register it, and return whether it became
// newly available (so the caller can re-highlight).
function ensureLang(name) {
  const k = langKey(name);
  if (!k || loadedLangs.has(k)) return Promise.resolve(false);
  if (loadingLangs.has(k)) return loadingLangs.get(k);
  const p = LANG_LOADERS[k]()
    .then((mod) => { if (!loadedLangs.has(k)) { lowlight.register(k, mod.default); loadedLangs.add(k); } loadingLangs.delete(k); return true; })
    .catch(() => { loadingLangs.delete(k); return false; });
  loadingLangs.set(k, p);
  return p;
}
// Every distinct language used by a code box in the document.
function codeLangsIn(doc) {
  const out = new Set();
  doc.descendants((n) => { if (n.type.name === 'codeBlock' && n.attrs.language) out.add(n.attrs.language); });
  return out;
}
// A code box left on 'auto' (no language) is highlighted by lowlight's
// highlightAuto, which only scores grammars that are already registered. With
// lazy loading nothing is registered for an auto box, so detection finds
// nothing and the box renders as plaintext. To restore auto-detection without
// going back to eager-loading everything, load a curated common set the first
// time the note actually contains an auto box. A note with no code box, or one
// whose boxes all name a language, still loads none of these.
const AUTODETECT = [
  'bash', 'c', 'cpp', 'csharp', 'css', 'diff', 'dockerfile', 'go', 'ini',
  'java', 'javascript', 'json', 'kotlin', 'lua', 'markdown', 'objectivec',
  'php', 'python', 'ruby', 'rust', 'shell', 'sql', 'swift', 'typescript',
  'xml', 'yaml',
];
// True once at least one auto-detect grammar is registered, so an auto box has
// candidates to score against.
function autodetectReady() { return AUTODETECT.some((k) => loadedLangs.has(k)); }
// Load the auto-detect candidate set once; resolves true if any grammar became
// newly available (so the caller can re-highlight).
function ensureAutodetect() {
  const need = AUTODETECT.filter((k) => !loadedLangs.has(k));
  if (!need.length) return Promise.resolve(false);
  return Promise.all(need.map(ensureLang)).then((r) => r.some(Boolean));
}
// Load the auto-detect set (e.g. an auto box was created or selected) then
// re-highlight once the grammars land.
function ensureAutodetectThenRehighlight() {
  ensureAutodetect().then((loaded) => { if (loaded) rehighlightLoaded(); });
}
// Does the document contain a code box with no language (shown as 'auto')?
function docHasAutoCode(doc) {
  let found = false;
  doc.descendants((n) => { if (!found && n.type.name === 'codeBlock' && !n.attrs.language) found = true; });
  return found;
}
// Re-run highlighting on code boxes whose language just loaded, without
// dirtying the note or touching undo history.
let suppressDirty = false;
function rehighlightLoaded() {
  if (!editor) return;
  const { state } = editor;
  const autoReady = autodetectReady();
  let tr = null;
  state.doc.descendants((n, pos) => {
    if (n.type.name !== 'codeBlock') return;
    // A languaged box repaints when its grammar is loaded; an auto box repaints
    // once the auto-detect candidates are in place.
    const ready = n.attrs.language ? loadedLangs.has(langKey(n.attrs.language)) : autoReady;
    if (ready) tr = (tr || state.tr).setNodeMarkup(pos, undefined, { ...n.attrs });
  });
  if (!tr) return;
  tr.setMeta('addToHistory', false);
  suppressDirty = true;
  editor.view.dispatch(tr);
  suppressDirty = false;
}
// Ensure the languages a document uses are loaded, then re-highlight once.
function ensureDocLangs() {
  if (!editor) return;
  const need = [...codeLangsIn(editor.state.doc)].filter((l) => langKey(l) && !loadedLangs.has(langKey(l)));
  const jobs = need.map(ensureLang);
  // Load the auto-detect set too if any box is on 'auto'.
  if (docHasAutoCode(editor.state.doc)) jobs.push(ensureAutodetect());
  if (!jobs.length) return;
  Promise.all(jobs).then((r) => { if (r.some(Boolean)) rehighlightLoaded(); });
}
// Load one language (e.g. from the dropdown or a typed fence) then re-highlight.
function ensureLangThenRehighlight(name) {
  ensureLang(name).then((loaded) => { if (loaded) rehighlightLoaded(); });
}
const $ = (sel) => document.querySelector(sel);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
  root: null,
  tree: [],
  byRel: new Map(),
  parentOf: new Map(),
  current: null, // rel of the open note
  raw: '', // front matter kept verbatim
  dirty: false,
  saveTimer: null,
  collapsed: new Set(),
  fontSize: 17,
  lastFg: '#f66151',
  lastBg: '#3d3846',
  lastLang: '',
  paletteMode: 'fg',
  filter: '',
  prefs: {},
  sidebarWidth: null,
};

function nbPrefs() {
  return (state.prefs.notebooks || {})[state.root] || {};
}
function saveNbPrefs(patch) {
  state.prefs.notebooks = { ...(state.prefs.notebooks || {}), [state.root]: { ...nbPrefs(), ...patch } };
  window.api.settings.set({ notebooks: state.prefs.notebooks });
}

const PALETTE = [
  '#f66151', '#ffbe6f', '#f9f06b', '#8ff0a4', '#99c1f1', '#dc8add',
  '#e01b24', '#ff7800', '#f5c211', '#2ec27e', '#3584e4', '#c061cb',
  '#cdab8f', '#ffffff', '#9a9996', '#241f31', '#3d3846', '#5e5c64',
  '#a51d2d', '#613583', '#1c71d8', '#26a269', '#e5a50a', '#000000',
];
// One colour per tree level, repeating; the user can change them in Settings.
function nodeColors() {
  const c = state.prefs?.iconColors;
  return Array.isArray(c) && c.length === DEFAULT_ICON_COLORS.length && c.every((x) => /^#[0-9a-f]{6}$/i.test(x)) ? c : DEFAULT_ICON_COLORS;
}

// ---------------------------------------------------------------------------
// Paths / images
// ---------------------------------------------------------------------------

function currentDir() {
  if (!state.current) return '';
  const i = state.current.lastIndexOf('/');
  return i < 0 ? '' : state.current.slice(0, i);
}

function joinRel(dir, rel) {
  const parts = (dir ? dir.split('/') : []).concat(rel.split('/'));
  const out = [];
  for (const p of parts) {
    if (!p || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out.join('/');
}

function resolveSrc(src) {
  if (!src) return src;
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return src; // data:, nb:, https:
  let decoded = src;
  try { decoded = decodeURI(src); } catch { /* keep */ }
  const rel = joinRel(currentDir(), decoded);
  return 'nb://local/' + rel.split('/').map(encodeURIComponent).join('/');
}

// the path of a notebook file as written from inside `dir` ("../a/b.png")
function relativeTo(dir, rel) {
  const a = dir ? dir.split('/') : [];
  const b = rel.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...Array(a.length - i).fill('..'), ...b.slice(i)].join('/');
}

function unresolveSrc(src) {
  if (!src || !src.startsWith('nb://local/')) return src;
  const rel = decodeURIComponent(src.slice('nb://local/'.length));
  // An image pasted into a note in another folder keeps pointing at its file.
  return relativeTo(currentDir(), rel).split('/').map(encodeURIComponent).join('/');
}

// Drag a corner handle; calls onMove(dx, dy) while dragging and onEnd() after.
function cornerDrag(handle, onMove, onEnd) {
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX;
    const sy = e.clientY;
    const move = (ev) => onMove(ev.clientX - sx, ev.clientY - sy, ev);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      onEnd();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
}

// ---------------------------------------------------------------------------
// Editor extensions
// ---------------------------------------------------------------------------

let editor = null;
const noInputRules = { addInputRules: () => [], addPasteRules: () => [] };
// Formatting keys are handled by the window (see the keydown handler near the
// end), so they follow the user's settings. The extensions' own keymaps would
// keep the defaults alive regardless.
const noKeys = { addKeyboardShortcuts: () => ({}) };
// Markdown while typing is on unless the user switched it off in Settings.
const mdOn = () => state.prefs.mdTyping !== false;

// Markdown while typing (Settings > Editor, or Format > Markdown While Typing):
// `**bold**`, `*italic*`, `~~strike~~`, `` `code` `` and ``` fences turn into
// formatting as they are typed. `# ` deliberately does not make a heading: the
// user's section titles are typed as `#### Title ####` and must stay text
// (headings are ⌘⌥1-3). The rules are always installed and
// simply do nothing while the setting is off (for notes full of shell
// commands and regexes). Lists (`- `, `1. `) always work.
const MarkdownTyping = Extension.create({
  name: 'markdownTyping',
  addInputRules() {
    const { schema } = this.editor;
    const gate = (rule) => new InputRule({ find: rule.find, handler: (p) => (mdOn() ? rule.handler(p) : null) });
    const mark = (find, name) => markInputRule({ find, type: schema.marks[name] });
    return [
      textblockTypeInputRule({ find: /^```([\w+#-]*)\s$/, type: schema.nodes.codeBlock, getAttributes: (m) => { if (m[1]) ensureLangThenRehighlight(m[1]); else ensureAutodetectThenRehighlight(); return { language: m[1] || null }; } }),
      mark(/(?:^|\s)(\*\*(?!\s+\*\*)([^*]+)\*\*(?!\s+\*\*))$/, 'bold'),
      mark(/(?:^|\s)(__(?!\s+__)([^_]+)__(?!\s+__))$/, 'bold'),
      mark(/(?:^|\s)(\*(?!\s+\*)([^*]+)\*(?!\s+\*))$/, 'italic'),
      mark(/(?:^|\s)(_(?!\s+_)([^_]+)_(?!\s+_))$/, 'italic'),
      mark(/(?:^|\s)(~~(?!\s+~~)([^~]+)~~(?!\s+~~))$/, 'strike'),
      mark(/(?:^|\s)(`(?!\s+`)([^`]+)`(?!\s+`))$/, 'code'),
    ].map(gate);
  },
});

// Lists may nest directly inside lists (no item in between), so Tab on the
// first bullet can still push it a level deeper, as CherryTree lets you. The
// file keeps it as an indented "  - " line.
const LIST_CONTENT = '(listItem | bulletList | orderedList)+';
const isListNode = (n) => n && (n.type.name === 'bulletList' || n.type.name === 'orderedList');
const listItemDepth = ($pos) => {
  for (let d = $pos.depth; d > 0; d--) if ($pos.node(d).type.name === 'listItem') return d;
  return 0;
};
// range covering just the item around the cursor, inside its list
function itemRange(state) {
  const { $from, $to } = state.selection;
  const d = listItemDepth($from);
  if (!d || d !== listItemDepth($to) || $from.before(d) !== $to.before(d)) return null;
  return new NodeRange(state.doc.resolve($from.before(d)), state.doc.resolve($from.after(d)), d - 1);
}
const NoteListItem = ListItem.extend({
  addKeyboardShortcuts() {
    const wrapDeeper = () =>
      this.editor.commands.command(({ state, tr, dispatch }) => {
        const range = itemRange(state);
        if (!range) return false;
        const wrapping = findWrapping(range, range.parent.type);
        if (!wrapping) return false;
        if (dispatch) tr.wrap(range, wrapping).scrollIntoView();
        return true;
      });
    // an item in a list that sits directly in another list moves up one list
    const liftShallower = () =>
      this.editor.commands.command(({ state, tr, dispatch }) => {
        const range = itemRange(state);
        if (!range || !isListNode(state.selection.$from.node(range.depth - 1))) return false;
        const target = liftTarget(range);
        if (target === null) return false;
        if (dispatch) tr.lift(range, target).scrollIntoView();
        return true;
      });
    const emptyItem = () => {
      const { $from } = this.editor.state.selection;
      const d = listItemDepth($from);
      return d > 0 && $from.node(d).childCount === 1 && $from.parent.content.size === 0;
    };
    return {
      Enter: () => this.editor.commands.splitListItem(this.name) || (emptyItem() && liftShallower()),
      Tab: () => this.editor.commands.sinkListItem(this.name) || wrapDeeper(),
      'Shift-Tab': () => liftShallower() || this.editor.commands.liftListItem(this.name),
    };
  },
});

const looksLikeMarkdown = (t) => /(^|\n)(#{1,6} |[-*+] |\d+\. |```)|\*\*[^*\n]+\*\*|`[^`\n]+`|~~[^~\n]+~~/.test(t);

const NoteImage = Image.extend({
  inline: false,
  group: 'block',
  draggable: true,
  addAttributes() {
    const num = (name) => ({
      default: null,
      parseHTML: (el) => (el.getAttribute(name) ? Number(el.getAttribute(name)) : null),
      renderHTML: (attrs) => (attrs[name] ? { [name]: attrs[name] } : {}),
    });
    return {
      ...this.parent?.(),
      src: {
        default: null,
        parseHTML: (el) => unresolveSrc(el.getAttribute('src')),
        renderHTML: (attrs) => ({ src: resolveSrc(attrs.src) }),
      },
      width: num('width'),
      height: num('height'),
    };
  },
  addNodeView() {
    return ({ node, getPos, editor: ed }) => {
      let current = node;
      const dom = document.createElement('span');
      dom.className = 'img-wrap';
      const img = document.createElement('img');
      dom.appendChild(img);
      const apply = (n) => {
        img.src = resolveSrc(n.attrs.src);
        img.alt = n.attrs.alt || '';
        img.style.width = n.attrs.width ? n.attrs.width + 'px' : '';
        img.style.height = n.attrs.height ? n.attrs.height + 'px' : '';
      };
      apply(node);
      const commit = (width, height) =>
        ed.view.dispatch(ed.state.tr.setNodeMarkup(getPos(), undefined, { ...current.attrs, width, height }));
      // Three handles: right edge = width only, bottom edge = height only,
      // corner = both (hold Shift to keep the aspect ratio).
      const handles = [];
      for (const kind of ['right', 'bottom', 'corner']) {
        const h = document.createElement('span');
        h.className = `rh rh-${kind}`;
        h.title = kind === 'corner' ? 'Drag to resize (Shift keeps proportions). Double-click to reset.' : `Drag to change ${kind === 'right' ? 'width' : 'height'}`;
        let w0 = 0;
        let h0 = 0;
        h.addEventListener('pointerdown', () => {
          const r = img.getBoundingClientRect();
          w0 = r.width;
          h0 = r.height;
          dom.classList.add('resizing');
        });
        cornerDrag(
          h,
          (dx, dy, ev) => {
            let w = w0;
            let hh = h0;
            if (kind === 'right') w = w0 + dx;
            else if (kind === 'bottom') hh = h0 + dy;
            else if (ev.shiftKey) {
              const k = Math.max((w0 + dx) / w0, (h0 + dy) / h0);
              w = w0 * k;
              hh = h0 * k;
            } else {
              w = w0 + dx;
              hh = h0 + dy;
            }
            img.style.width = Math.max(24, Math.round(w)) + 'px';
            img.style.height = Math.max(24, Math.round(hh)) + 'px';
          },
          () => {
            dom.classList.remove('resizing');
            const r = img.getBoundingClientRect();
            commit(Math.round(r.width), Math.round(r.height));
          }
        );
        h.addEventListener('dblclick', (e) => {
          e.preventDefault();
          commit(null, null);
        });
        dom.appendChild(h);
        handles.push(h);
      }
      return {
        dom,
        update(n) {
          if (n.type !== current.type) return false;
          current = n;
          apply(n);
          return true;
        },
        ignoreMutation: () => true,
        stopEvent: (e) => handles.includes(e.target),
      };
    };
  },
});

const NoteCodeBlock = CodeBlockLowlight.extend({
  addInputRules: () => [],
  // One ↓ on the last line (or ↑ on the first) leaves the box from any column.
  // TipTap only leaves from the very end of the text, so mid-line it took a
  // second press: the first just moved the caret to the end of the line.
  addKeyboardShortcuts() {
    const leave = (dir) => () => {
      const { state } = this.editor;
      const { $from, empty } = state.selection;
      if (!empty || $from.parent.type !== this.type) return false;
      const text = $from.parent.textContent;
      const onEdgeLine = dir > 0 ? !text.includes('\n', $from.parentOffset) : !text.slice(0, $from.parentOffset).includes('\n');
      if (!onEdgeLine) return false;
      const edge = dir > 0 ? $from.after() : $from.before();
      const neighbour = dir > 0 ? state.doc.nodeAt(edge) : edge > 0;
      if (!neighbour) return dir > 0 ? this.editor.commands.exitCode() : this.editor.commands.insertDefaultBlock({ pos: edge });
      return this.editor.commands.command(({ tr }) => {
        tr.setSelection(Selection.near(state.doc.resolve(edge), dir)).scrollIntoView();
        return true;
      });
    };
    return { ...this.parent?.(), ArrowDown: leave(1), ArrowUp: leave(-1) };
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      height: {
        default: null,
        parseHTML: (el) => (el.getAttribute('data-height') ? Number(el.getAttribute('data-height')) : null),
        renderHTML: (attrs) => (attrs.height ? { 'data-height': attrs.height } : {}),
      },
    };
  },
  addNodeView() {
    return ({ node, getPos, editor: ed }) => {
      let current = node;
      const dom = document.createElement('div');
      dom.className = 'code-box';
      const pre = document.createElement('pre');
      pre.spellcheck = false;
      const code = document.createElement('code');
      const lang = document.createElement('span');
      lang.className = 'code-lang';
      pre.appendChild(code);
      dom.append(pre, lang);
      // The box always fits its content: a new line adds a line. A height
      // saved by older versions (``` lang h=160) is kept in the file but ignored.
      const apply = (n) => {
        code.className = n.attrs.language ? `language-${n.attrs.language}` : '';
        lang.textContent = n.attrs.language || 'auto';
      };
      apply(node);
      return {
        dom,
        contentDOM: code,
        update(n) {
          if (n.type !== current.type) return false;
          current = n;
          apply(n);
          return true;
        },
        ignoreMutation: (m) => !code.contains(m.target) || (m.target === code && m.type === 'attributes'),
      };
    };
  },
});

// --- find-in-note -----------------------------------------------------------

const searchKey = new PluginKey('note4me-search');
const search = { term: '', index: 0, matches: [] };

function computeMatches(doc) {
  const matches = [];
  if (!search.term) return matches;
  const needle = search.term.toLowerCase();
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const text = node.text.toLowerCase();
    let i = text.indexOf(needle);
    while (i >= 0) {
      matches.push({ from: pos + i, to: pos + i + needle.length });
      i = text.indexOf(needle, i + needle.length);
    }
  });
  return matches;
}

function decorate(doc) {
  search.matches = computeMatches(doc);
  if (search.index >= search.matches.length) search.index = 0;
  return DecorationSet.create(
    doc,
    search.matches.map((m, i) => Decoration.inline(m.from, m.to, { class: 'find-hit' + (i === search.index ? ' current' : '') }))
  );
}

const SearchExtension = Extension.create({
  name: 'note4meSearch',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: searchKey,
        state: {
          init: (_c, s) => decorate(s.doc),
          apply: (tr, old) => (tr.docChanged || tr.getMeta(searchKey) ? decorate(tr.doc) : old),
        },
        props: { decorations: (s) => searchKey.getState(s) },
      }),
    ];
  },
});

// Markdown mode also tints bracket labels such as [GOAL] or [TODO] the way
// Obsidian does: the word in the accent colour, the brackets dimmer. Pure
// decoration; the file keeps the plain text. Code boxes and monospace text
// are left alone, so array indexes stay as they are.
const labelKey = new PluginKey('note4meLabels');
const LABEL_RE = /\[([^\[\]\n]{1,40})\]/g;
function decorateLabels(doc) {
  if (!mdOn()) return DecorationSet.empty;
  const decos = [];
  doc.descendants((node, pos, parent) => {
    if (parent?.type.name === 'codeBlock') return false;
    if (!node.isText || node.marks.some((m) => m.type.name === 'code' || m.type.name === 'link')) return;
    for (const m of node.text.matchAll(LABEL_RE)) {
      if (!/[A-Za-z]/.test(m[1])) continue;
      const a = pos + m.index;
      const b = a + m[0].length;
      decos.push(Decoration.inline(a, a + 1, { class: 'md-label-br' }), Decoration.inline(a + 1, b - 1, { class: 'md-label' }), Decoration.inline(b - 1, b, { class: 'md-label-br' }));
    }
  });
  return DecorationSet.create(doc, decos);
}
const LabelExtension = Extension.create({
  name: 'note4meLabels',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: labelKey,
        state: {
          init: (_c, s) => decorateLabels(s.doc),
          apply: (tr, old) => (tr.docChanged || tr.getMeta(labelKey) ? decorateLabels(tr.doc) : old),
        },
        props: { decorations: (s) => labelKey.getState(s) },
      }),
    ];
  },
});

// --- colour stops where the coloured text stops ----------------------------
// Text or highlight colour does not carry on to what is typed after a
// coloured run or on the next line (Settings › Editor can turn carrying on
// back on). Typing inside a coloured word keeps its colour, and picking a
// colour with nothing selected "arms" it for the text typed next, until the
// caret moves or the line ends.
const colorKey = new PluginKey('note4meColorStop');
const colorCarries = () => state.prefs.colorCarry === true;
function soleStep(tr) {
  if (tr.steps.length !== 1 || !(tr.steps[0] instanceof ReplaceStep)) return null;
  return tr.steps[0];
}
// a transaction that just typed text: one step inserting a single text node
function typedText(tr) {
  const step = soleStep(tr);
  if (!step || step.from !== step.to || tr.getMeta('paste') || tr.getMeta('uiEvent') === 'paste') return null;
  const { slice } = step;
  if (slice.openStart || slice.openEnd || slice.content.childCount !== 1 || !slice.content.firstChild.isText) return null;
  return { from: step.from, to: step.from + slice.content.firstChild.nodeSize, node: slice.content.firstChild };
}
const deletedText = (tr) => { const s = soleStep(tr); return !!s && s.from < s.to && s.slice.size === 0; };
const ColorStop = Extension.create({
  name: 'note4meColorStop',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: colorKey,
        state: {
          init: () => ({ armed: false }),
          apply(tr, prev) {
            const meta = tr.getMeta(colorKey);
            if (meta !== undefined) return { armed: meta };
            if (typedText(tr) || deletedText(tr)) return prev;
            if (tr.docChanged || tr.selectionSet) return { armed: false };
            return prev;
          },
        },
        appendTransaction(trs, _old, newState) {
          if (colorCarries() || trs.length !== 1) return null;
          const ins = typedText(trs[0]);
          if (!ins) return null;
          const styleType = newState.schema.marks.textStyle;
          const mark = ins.node.marks.find((m) => m.type === styleType);
          if (!mark) return null;
          if (colorKey.getState(newState).armed) return newState.tr.setStoredMarks(ins.node.marks);
          const after = newState.doc.resolve(ins.to).nodeAfter;
          if (after && mark.isInSet(after.marks)) return null; // inside a coloured run
          return newState.tr.removeMark(ins.from, ins.to, styleType);
        },
      }),
    ];
  },
});

function refreshSearch(scroll) {
  if (!editor) return;
  editor.view.dispatch(editor.state.tr.setMeta(searchKey, true));
  const m = search.matches[search.index];
  $('#find-count').textContent = search.term ? (search.matches.length ? `${search.index + 1} / ${search.matches.length}` : 'no matches') : '';
  if (scroll && m) {
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, m.from, m.to)));
    revealPos(m.from);
  }
}

// Scroll the note so the position sits mid-screen, unless it is already in
// comfortable view. Used while stepping through find matches: the caret is
// not in the note then, so the editor's own scroll-to-selection does not run.
function revealPos(pos) {
  const wrap = $('#editor-wrap');
  const c = editor.view.coordsAtPos(pos);
  const r = wrap.getBoundingClientRect();
  const margin = Math.min(80, r.height / 4);
  if (c.top >= r.top + margin && c.bottom <= r.bottom - margin) return;
  wrap.scrollTop += c.top - (r.top + r.height / 2);
}

// --- editor construction ----------------------------------------------------

// One editor for the whole session. Switching notes swaps its state instead
// of rebuilding it, and the state of every note visited is kept, so ⌘Z after
// coming back to a note still undoes what was done there (a cut image, say).
// A note whose file changed on disk meanwhile starts afresh.
const noteStates = new Map(); // note rel -> EditorState
let editorRel = null; // the note the editor is showing

const inTextField = () => /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || '');

function buildEditor(json, rel = null) {
  if (editor) {
    if (editorRel) noteStates.set(editorRel, editor.state);
    editorRel = rel;
    let next = null;
    try {
      const doc = editor.schema.nodeFromJSON(json);
      const saved = rel ? noteStates.get(rel) : null;
      next = saved && saved.doc.eq(doc) ? saved : EditorState.create({ doc, plugins: editor.state.plugins });
    } catch (err) {
      console.warn('rebuilding editor', err);
    }
    if (next) {
      editor.view.updateState(next);
      editor.view.dispatch(editor.state.tr.setMeta(searchKey, true)); // find-in-note decorations for this note
      updateToolbar();
      ensureDocLangs(); // load any code-box languages this note uses
      return;
    }
    editor.destroy();
    editor = null;
  }
  editorRel = rel;
  editor = new Editor({
    element: $('#editor'),
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
        hardBreak: false,
        heading: false,
        bold: false,
        italic: false,
        strike: false,
        code: false,
        underline: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        trailingNode: false,
        link: { openOnClick: false, autolink: false, linkOnPaste: true },
      }),
      Bold.extend({ ...noInputRules, ...noKeys }),
      Italic.extend({ ...noInputRules, ...noKeys }),
      Strike.extend({ ...noInputRules, ...noKeys }),
      Code.extend({ ...noInputRules, ...noKeys }),
      Underline.extend(noKeys),
      BulletList.extend({ ...noKeys, content: LIST_CONTENT }).configure({ keepMarks: true }), // `- ` starts a list
      OrderedList.extend({ ...noKeys, content: LIST_CONTENT }).configure({ keepMarks: true }), // `1. ` starts a list
      NoteListItem,
      Heading.extend({ addInputRules: () => [], ...noKeys }).configure({ levels: [1, 2, 3, 4, 5, 6] }),
      TextStyle,
      Color,
      BackgroundColor,
      NoteCodeBlock.configure({ lowlight, defaultLanguage: null, exitOnTripleEnter: true, exitOnArrowDown: true }),
      NoteImage.configure({ allowBase64: true }), // embedded images copied within the app paste back
      SearchExtension,
      MarkdownTyping,
      LabelExtension,
      ColorStop,
    ],
    content: json,
    autofocus: false,
    editorProps: {
      attributes: { spellcheck: 'true' },
      handlePaste: (view, event) => handlePaste(view, event),
      handleClick: (view, pos, event) => handleEditorClick(view, pos, event),
      handleKeyDown: (view, event) => {
        // Chromium would bold/italicise/underline on ⌘B/⌘I/⌘U by itself; only the app's keys may.
        if ((event.metaKey || event.ctrlKey) && !event.altKey && ['KeyB', 'KeyI', 'KeyU'].includes(event.code)) return true;
        if (event.key === 'Tab' && editor.isActive('codeBlock')) {
          event.preventDefault();
          editor.commands.insertContent('    ');
          return true;
        }
        return false;
      },
    },
    onUpdate: () => {
      // a re-highlight after a language loads must not dirty the note
      if (suppressDirty) { updateToolbar(); return; }
      state.dirty = true;
      scheduleSave();
      updateToolbar();
    },
    onSelectionUpdate: () => updateToolbar(),
  });
  updateToolbar();
  ensureDocLangs(); // load any code-box languages this note uses
}

const inCodeBlock = (st) => {
  const { $from, $to } = st.selection;
  return $from.parent.type.name === 'codeBlock' || $to.parent.type.name === 'codeBlock';
};

function handlePaste(view, event) {
  const items = [...(event.clipboardData?.items || [])];
  const img = items.find((it) => it.type.startsWith('image/'));
  if (!img) {
    // With Markdown typing on, plain text that reads like Markdown is parsed as such.
    // Inside a code box nothing is Markdown: the text goes in as it is, which
    // ProseMirror does by itself for code blocks. Parsing it here used to turn
    // `# comment`, `- flag` and backtick lines into paragraphs that split the box.
    if (!mdOn() || !editor || inCodeBlock(view.state)) return false;
    const text = event.clipboardData?.getData('text/plain') || '';
    if (event.clipboardData?.getData('text/html') || !looksLikeMarkdown(text)) return false;
    event.preventDefault();
    // `#### Title ####` section lines are text, not headings
    const kept = text.replace(/^( *)(#{1,6} .*#)\s*$/gm, '$1\\$2');
    editor.chain().focus().insertContent(parseMarkdown(kept).content).run();
    return true;
  }
  if (!state.current) return false;
  const file = img.getAsFile();
  if (!file) return false;
  event.preventDefault();
  const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
  if ((state.prefs.imageStorage || 'embed') === 'assets') {
    file.arrayBuffer().then(async (buf) => {
      const src = await window.api.asset.save({ noteRel: state.current, bytes: new Uint8Array(buf), ext });
      editor.chain().focus().insertContent({ type: 'image', attrs: { src } }).run();
    });
  } else {
    const reader = new FileReader();
    reader.onload = () => editor.chain().focus().insertContent({ type: 'image', attrs: { src: reader.result } }).run();
    reader.readAsDataURL(file);
  }
  return true;
}

function handleEditorClick(view, pos, event) {
  const a = event.target.closest && event.target.closest('a');
  if (!a) return false;
  const href = a.getAttribute('href') || '';
  if (!href) return false;
  if (/^https?:|^mailto:|^file:/i.test(href)) {
    window.api.shell.open(href);
    return true;
  }
  if (/\.md(#.*)?$/i.test(href)) {
    let target = href.replace(/#.*$/, '');
    try { target = decodeURI(target); } catch { /* keep */ }
    const rel = joinRel(currentDir(), target);
    if (state.byRel.has(rel)) {
      selectNode(rel);
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Saving / loading
// ---------------------------------------------------------------------------

function scheduleSave() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(saveCurrent, 600);
}

async function saveCurrent() {
  clearTimeout(state.saveTimer);
  if (!state.dirty || !state.current || !editor) return;
  const rel = state.current;
  const body = serializeMarkdown(editor.getJSON());
  state.dirty = false;
  try {
    await window.api.note.write(rel, body, state.raw);
    $('#status-save').textContent = `saved ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    state.dirty = true;
    $('#status-save').textContent = `save failed: ${err.message}`;
  }
}

async function loadNote(rel) {
  const { raw, body } = await window.api.note.read(rel);
  state.current = rel;
  state.raw = raw || '';
  state.dirty = false;
  buildEditor(parseMarkdown(body || ''), rel);
  $('#status-save').textContent = '';
  renderBreadcrumb();
  if (search.term) refreshSearch(false);
  saveNbPrefs({ lastNode: rel });
}

// ---------------------------------------------------------------------------
// Notebook / tree
// ---------------------------------------------------------------------------

async function openNotebook(dir) {
  await saveCurrent();
  const res = await window.api.notebook.open(dir);
  if (!res) return false;
  state.root = res.root;
  state.current = null;
  noteStates.clear();
  const prefs = nbPrefs();
  if (Array.isArray(prefs.collapsed)) state.collapsed = new Set(prefs.collapsed);
  else {
    // First time in this notebook: start with every branch folded.
    state.collapsed = new Set();
    const fold = (nodes) => nodes.forEach((n) => { if (n.children.length) { state.collapsed.add(n.rel); fold(n.children); } });
    fold(res.tree);
  }
  setTree(res.tree);
  $('#welcome').hidden = true;
  document.title = `Note4Me — ${res.root.split('/').pop()}`;
  const last = prefs.lastNode || null;
  const first = state.byRel.has(last) ? last : state.tree[0]?.rel;
  if (first) {
    expandTo(first);
    await selectNode(first);
  } else {
    buildEditor({ type: 'doc', content: [{ type: 'paragraph' }] });
  }
  return true;
}

function setTree(tree) {
  state.tree = tree;
  state.byRel = new Map();
  state.parentOf = new Map();
  const walk = (nodes, parent) => {
    for (const n of nodes) {
      state.byRel.set(n.rel, n);
      state.parentOf.set(n.rel, parent);
      walk(n.children, n);
    }
  };
  walk(tree, null);
  renderTree();
  populateScope();
}

async function refreshTree() {
  setTree(await window.api.notebook.tree());
}

function persistCollapsed() {
  saveNbPrefs({ collapsed: [...state.collapsed] });
}

function expandTo(rel) {
  let p = state.parentOf.get(rel);
  while (p) {
    state.collapsed.delete(p.rel);
    p = state.parentOf.get(p.rel);
  }
  persistCollapsed();
}

// Tree glyphs. Style is a setting; colour follows depth.
function nodeIcon(depth, hasKids) {
  const style = ICON_STYLES.includes(state.prefs.nodeIcons) ? state.prefs.nodeIcons : 'folders';
  const colors = nodeColors();
  return drawNodeIcon(style, colors[depth % colors.length], hasKids);
}

function renderTree() {
  const treeEl = $('#tree');
  const frag = document.createDocumentFragment();
  const filter = state.filter.trim().toLowerCase();
  treeEl.classList.toggle('filtering', !!filter);

  const build = (nodes, depth) => {
    const ul = document.createElement('ul');
    for (const n of nodes) {
      const li = document.createElement('li');
      li.dataset.rel = n.rel;
      const hasKids = n.children.length > 0;
      if (hasKids && state.collapsed.has(n.rel)) li.classList.add('collapsed');
      const row = document.createElement('div');
      row.className = 'row' + (n.rel === state.current ? ' selected' : '');
      row.style.setProperty('--depth', depth);
      row.innerHTML = `<span class="twisty ${hasKids ? '' : 'empty'}"><svg class="ic"><use href="#i-chevron"/></svg></span>${nodeIcon(depth, hasKids)}<span class="label"></span>`;
      row.querySelector('.label').textContent = n.title;
      row.draggable = true;
      li.appendChild(row);
      let visible = true;
      if (hasKids) {
        const sub = build(n.children, depth + 1);
        li.appendChild(sub);
        if (filter) {
          const anyChild = [...sub.querySelectorAll(':scope > li')].some((c) => !c.classList.contains('filtered-out'));
          visible = anyChild || n.title.toLowerCase().includes(filter);
        }
      } else if (filter) {
        visible = n.title.toLowerCase().includes(filter);
      }
      if (!visible) li.classList.add('filtered-out');
      ul.appendChild(li);
    }
    return ul;
  };
  frag.appendChild(build(state.tree, 0));
  const defs = document.createElement('div');
  defs.innerHTML = iconDefs(nodeColors());
  treeEl.replaceChildren(defs.firstElementChild, frag);
  const sel = treeEl.querySelector('.row.selected');
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}

// The window title carries the note name; the path row is gone to save space.
function renderBreadcrumb() {
  const n = state.current ? state.byRel.get(state.current) : null;
  const nb = state.root ? state.root.split('/').pop() : '';
  document.title = n ? `${n.title} — ${nb}` : nb ? `Note4Me — ${nb}` : 'Note4Me';
}

async function selectNode(rel) {
  if (!state.byRel.has(rel)) return;
  if (rel === state.current) {
    renderTree();
    return;
  }
  await saveCurrent();
  await loadNote(rel);
  renderTree();
}

function visibleRows() {
  // offsetParent is null for rows hidden by a collapsed ancestor or the filter
  return [...document.querySelectorAll('#tree li')]
    .filter((li) => li.querySelector(':scope > .row').offsetParent !== null)
    .map((li) => li.dataset.rel);
}

function stepNode(delta) {
  const rows = visibleRows();
  const i = rows.indexOf(state.current);
  const j = Math.min(rows.length - 1, Math.max(0, (i < 0 ? 0 : i) + delta));
  if (rows[j]) selectNode(rows[j]);
}

function toggleCollapse(rel, force) {
  const n = state.byRel.get(rel);
  if (!n || !n.children.length) return;
  const collapse = force === undefined ? !state.collapsed.has(rel) : force;
  if (collapse) state.collapsed.add(rel);
  else state.collapsed.delete(rel);
  persistCollapsed();
  renderTree();
}

// --- node operations --------------------------------------------------------

async function newNode(kind) {
  if (!state.root) return;
  const cur = state.current;
  await saveCurrent();
  const opts = { title: 'New Node' };
  if (kind === 'child' && cur) opts.parentRel = cur;
  else if (cur) opts.afterRel = cur;
  const rel = await window.api.node.create(opts);
  if (kind === 'child' && cur) state.collapsed.delete(cur);
  await refreshTree();
  await selectNode(rel);
  startRename(rel);
}

function startRename(rel) {
  const li = document.querySelector(`#tree li[data-rel="${CSS.escape(rel)}"]`);
  if (!li) return;
  const label = li.querySelector(':scope > .row > .label');
  const node = state.byRel.get(rel);
  const input = document.createElement('input');
  input.value = node.title;
  label.replaceChildren(input);
  input.focus();
  input.select();
  let done = false;
  const finish = async (commit) => {
    if (done) return;
    done = true;
    const title = input.value.trim();
    if (commit && title && title !== node.title) {
      const newRel = await window.api.node.rename({ rel, title });
      remapCollapsed(rel, newRel);
      if (state.current === rel) state.current = newRel;
      await refreshTree();
      if (state.current === newRel) {
        renderBreadcrumb();
      }
    } else {
      renderTree();
    }
    $('#tree').focus();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

function remapCollapsed(oldRel, newRel) {
  const oldDir = oldRel.replace(/\.md$/, '');
  const newDir = newRel.replace(/\.md$/, '');
  const next = new Set();
  for (const r of state.collapsed) {
    if (r === oldRel) next.add(newRel);
    else if (r.startsWith(oldDir + '/')) next.add(newDir + r.slice(oldDir.length));
    else next.add(r);
  }
  state.collapsed = next;
  persistCollapsed();
}

async function deleteNode() {
  const rel = state.current;
  if (!rel) return;
  const node = state.byRel.get(rel);
  const kids = node.children.length;
  const msg = kids
    ? `Move "${node.title}" and its ${kids} child node${kids > 1 ? 's' : ''} to the Trash?`
    : `Move "${node.title}" to the Trash?`;
  if (!confirm(msg)) return;
  const rows = visibleRows();
  const i = rows.indexOf(rel);
  const fallback = rows[i - 1] || rows[i + 1] || null;
  state.dirty = false;
  await window.api.node.delete(rel);
  state.current = null;
  await refreshTree();
  const next = state.byRel.has(fallback) ? fallback : state.tree[0]?.rel;
  if (next) await selectNode(next);
  else {
    buildEditor({ type: 'doc', content: [{ type: 'paragraph' }] });
    renderBreadcrumb();
  }
}

async function moveNode(op) {
  const rel = state.current;
  if (!rel) return;
  await saveCurrent();
  const newRel = await window.api.node.move({ rel, op });
  await afterMove(rel, newRel);
}

// Drag and drop: put `rel` inside `target` ('into'; '' is the root) or beside it.
async function dropNode(rel, op, target) {
  if (!canDrop(rel, target)) return;
  await saveCurrent();
  const newRel = await window.api.node.move({ rel, op, target });
  await afterMove(rel, newRel);
}

// A node can't be dropped on itself or anywhere inside its own subtree.
function canDrop(rel, target) {
  return target !== rel && !target.startsWith(rel.replace(/\.md$/, '') + '/');
}

// The node at `rel` is now at `newRel`: fix every rel we track (the open note
// may be the moved node or one of its descendants), reload the tree and show
// the node in its new place.
async function afterMove(rel, newRel) {
  if (newRel !== rel) {
    remapCollapsed(rel, newRel);
    const oldDir = rel.replace(/\.md$/, '');
    const newDir = newRel.replace(/\.md$/, '');
    const remap = (r) => (r === rel ? newRel : r && r.startsWith(oldDir + '/') ? newDir + r.slice(oldDir.length) : r);
    state.current = remap(state.current);
    editorRel = remap(editorRel);
  }
  await refreshTree();
  expandTo(newRel);
  if (state.current) expandTo(state.current);
  renderTree();
  renderBreadcrumb();
}

// ---------------------------------------------------------------------------
// Toolbar / formatting
// ---------------------------------------------------------------------------

function updateToolbar() {
  if (!editor) return;
  for (const btn of document.querySelectorAll('#toolbar button[data-cmd], #tb-overflow button[data-cmd]')) {
    const c = btn.dataset.cmd;
    if (['bold', 'italic', 'underline', 'strike', 'code'].includes(c)) btn.classList.toggle('active', editor.isActive(c) || (c === 'bold' && editor.isActive('heading')));
    if (c === 'codeblock') btn.classList.toggle('active', editor.isActive('codeBlock'));
    if (c === 'bullets') btn.classList.toggle('active', editor.isActive('bulletList'));
    if (c === 'numbers') btn.classList.toggle('active', editor.isActive('orderedList'));
  }
  const pstyle = $('#pstyle');
  pstyle.value = String(editor.isActive('heading') ? editor.getAttributes('heading').level || 1 : 0);
  pstyle.disabled = editor.isActive('codeBlock');
  const lang = $('#lang');
  const inCode = editor.isActive('codeBlock');
  lang.disabled = !inCode;
  lang.value = inCode ? editor.getAttributes('codeBlock').language || '' : '';
}

function applyColor(mode, hex) {
  if (!editor) return;
  const chain = editor.chain().focus();
  if (mode === 'fg') {
    if (hex) {
      chain.setColor(hex).run();
      state.lastFg = hex;
      document.documentElement.style.setProperty('--fg-swatch', hex);
    } else chain.unsetColor().run();
  } else if (hex) {
    chain.setBackgroundColor(hex).run();
    state.lastBg = hex;
    document.documentElement.style.setProperty('--bg-swatch', hex);
  } else chain.unsetBackgroundColor().run();
  // colour picked with nothing selected applies to what is typed next
  if (hex && editor.state.selection.empty) editor.view.dispatch(editor.state.tr.setMeta(colorKey, true));
  persistPrefs();
}

let paletteIndex = 0;

function paletteSwatches() {
  return [...document.querySelectorAll('#palette .palette-grid button')];
}

function focusSwatch(i) {
  const sw = paletteSwatches();
  if (!sw.length) return;
  paletteIndex = ((i % sw.length) + sw.length) % sw.length;
  sw.forEach((b, k) => b.classList.toggle('focused', k === paletteIndex));
  sw[paletteIndex].focus({ preventScroll: true });
}

function showPalette(mode, anchorEl) {
  state.paletteMode = mode;
  const pal = $('#palette');
  const r = anchorEl.getBoundingClientRect();
  pal.hidden = false;
  pal.style.left = Math.min(r.left, window.innerWidth - 220) + 'px';
  pal.style.top = r.bottom + 4 + 'px';
  $('#palette-custom').value = mode === 'fg' ? state.lastFg : state.lastBg;
  const last = mode === 'fg' ? state.lastFg : state.lastBg;
  const idx = PALETTE.indexOf(last);
  focusSwatch(idx >= 0 ? idx : 0);
}

function hidePopovers() {
  $('#palette').hidden = true;
  $('#ctx-menu').hidden = true;
  $('#tb-overflow').hidden = true;
}

// Fit the toolbar to the window: groups that do not fit move, rightmost
// first, into the "…" popover, and come back when there is room again.
const toolbarGroups = [...document.querySelectorAll('#toolbar .tb-group')];
function layoutToolbar() {
  const bar = $('#toolbar');
  const more = $('#btn-more');
  const panel = $('#tb-overflow');
  for (const g of toolbarGroups) bar.insertBefore(g, more);
  more.hidden = true;
  const overflowing = () => bar.scrollWidth > bar.clientWidth + 1;
  if (overflowing()) {
    more.hidden = false;
    for (let i = toolbarGroups.length - 1; i >= 0 && overflowing(); i--) panel.prepend(toolbarGroups[i]);
  }
  if (!panel.children.length) panel.hidden = true;
  else if (!panel.hidden) placeOverflow();
}

function placeOverflow() {
  const panel = $('#tb-overflow');
  const r = $('#btn-more').getBoundingClientRect();
  panel.style.top = r.bottom + 4 + 'px';
  panel.style.left = Math.max(8, Math.min(r.left, window.innerWidth - panel.offsetWidth - 8)) + 'px';
}

function showOverflow() {
  const panel = $('#tb-overflow');
  panel.hidden = false;
  placeOverflow();
}

// --- keyboard selection ------------------------------------------------------
// ⌃⇧→ / ⌃⇧← grow the selection one word at a time (letters, digits and _;
// punctuation is skipped, not selected on its own). ⇧⌥↓ / ⇧⌥↑ take the rest
// of the line to its end or start. Chromium's own ⌃⇧→ selected the whole line.
const WORD_CHAR = /[\p{L}\p{N}_]/u;
function wordStep(doc, $pos, dir) {
  const text = $pos.parent.textBetween(0, $pos.parent.content.size, null, '\uFFFC');
  let i = $pos.parentOffset;
  if (dir > 0) {
    while (i < text.length && !WORD_CHAR.test(text[i])) i++;
    while (i < text.length && WORD_CHAR.test(text[i])) i++;
  } else {
    while (i > 0 && !WORD_CHAR.test(text[i - 1])) i--;
    while (i > 0 && WORD_CHAR.test(text[i - 1])) i--;
  }
  const pos = $pos.start() + i;
  if (pos !== $pos.pos) return pos;
  // nothing left in this block: step into the next one
  const next = Selection.near(doc.resolve(dir > 0 ? Math.min(doc.content.size, $pos.after()) : Math.max(0, $pos.before())), dir);
  return next.head;
}
function extendSelection(headFor) {
  // only while the caret is in the note (not the search or find box)
  if (!editor || !editor.view.dom.contains(document.activeElement)) return;
  const { state, view } = editor;
  const { $head, anchor } = state.selection;
  if (!$head.parent.isTextblock) return;
  const head = headFor(state.doc, $head);
  if (head === $head.pos) return;
  view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, anchor, head)).scrollIntoView());
}

function toggleCodeBlock() {
  if (!editor) return;
  if (editor.isActive('codeBlock')) editor.chain().focus().toggleCodeBlock().run();
  else {
    if (state.lastLang) ensureLangThenRehighlight(state.lastLang);
    else ensureAutodetectThenRehighlight();
    editor.chain().focus().toggleCodeBlock({ language: state.lastLang || null }).run();
  }
}

function setZoom(px) {
  state.fontSize = Math.max(9, Math.min(48, px));
  document.documentElement.style.setProperty('--editor-font-size', state.fontSize + 'px');
  persistPrefs();
}

function applyTheme(theme) {
  applyThemeVars(theme, state.prefs.customTheme);
  state.prefs.theme = theme;
  applyAlpha(windowAlphaPref());
  syncNativeAppearance();
}

function syncNativeAppearance() {
  window.api.appearance?.({ dark: themeIsDark(), blur: state.prefs.blur === true });
}

function windowAlphaPref() {
  if (state.prefs.windowAlpha !== undefined && state.prefs.windowAlpha !== null) return state.prefs.windowAlpha;
  // older settings had two sliders; take the larger
  const a = Math.max(state.prefs.sidebarAlpha ?? 0, state.prefs.editorAlpha ?? 0);
  return a > 0 ? a : null;
}

// Everything the settings window can change, applied to this window.
function applyPrefs() {
  applyTheme(state.prefs.theme || 'modern-dark');
  renderTree();
  // the Markdown-mode label tint follows the setting at once
  if (editor) editor.view.dispatch(editor.state.tr.setMeta(labelKey, true));
}

function setSidebarHidden(hidden) {
  $('#sidebar').classList.toggle('hidden', hidden);
  $('#main').classList.toggle('no-sidebar', hidden);
  $('#btn-tree').classList.toggle('active', !hidden);
  state.prefs.sidebarHidden = hidden;
  window.api.settings.set({ sidebarHidden: hidden });
}

function persistPrefs() {
  window.api.settings.set({ fontSize: state.fontSize, lastFg: state.lastFg, lastBg: state.lastBg, lastLang: state.lastLang, sidebarWidth: state.sidebarWidth });
}

// ---------------------------------------------------------------------------
// Notebook-wide search panel
// ---------------------------------------------------------------------------

let searchTimer = null;
let searchSeq = 0;
const srCollapsed = new Set(); // notes whose hits are folded away in the results

// The scope menu lists the top-level nodes, so a search can be kept to one
// branch. Rebuilt whenever the tree changes; the pick survives if it still exists.
function populateScope() {
  const sel = $('#search-scope');
  const was = sel.value;
  sel.replaceChildren(new Option('All notes', ''));
  for (const n of state.tree) sel.appendChild(new Option(n.title, n.rel));
  sel.value = [...sel.options].some((o) => o.value === was) ? was : '';
}

function titlesMode() {
  return $('#search-titles').checked;
}

function setResultsVisible(show) {
  $('#search-panel').hidden = !show;
  $('#tree').style.display = show ? 'none' : '';
}

// One box: typing searches the contents of every note; the "titles" toggle
// switches it to filtering the tree by node name instead.
function onSearchInput() {
  const q = $('#search-input').value;
  const active = q.trim().length > 0;
  $('#search-close').hidden = !active;
  $('#search-opts').hidden = !active;
  $('#search-scope-row').hidden = !active || titlesMode();
  if (!active) {
    state.filter = '';
    renderTree();
    setResultsVisible(false);
    $('#search-status').textContent = '';
    return;
  }
  if (titlesMode()) {
    setResultsVisible(false);
    state.filter = q;
    renderTree();
    const n = document.querySelectorAll('#tree li:not(.filtered-out) > .row').length;
    $('#search-status').textContent = `${n} node${n === 1 ? '' : 's'}`;
    return;
  }
  state.filter = '';
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 200);
}

function clearSearch() {
  $('#search-input').value = '';
  srCollapsed.clear();
  onSearchInput();
  $('#tree').focus();
}

async function runSearch() {
  const query = $('#search-input').value;
  if (!query.trim() || titlesMode()) return;
  const status = $('#search-status');
  const list = $('#search-results');
  const seq = ++searchSeq;
  status.textContent = 'searching…';
  setResultsVisible(true);
  const res = await window.api.search({
    query,
    caseSensitive: $('#search-case').checked,
    regex: $('#search-regex').checked,
    titlesOnly: false,
    scope: $('#search-scope').value,
  });
  if (seq !== searchSeq) return; // a newer search superseded this one
  list.replaceChildren();
  if (res.error) {
    status.textContent = res.error;
    return;
  }
  const order = new Map([...state.byRel.keys()].map((r, i) => [r, i]));
  res.results.sort((a, b) => (order.get(a.rel) ?? 1e9) - (order.get(b.rel) ?? 1e9));
  status.textContent = `${res.total}${res.truncated ? '+' : ''} hit${res.total === 1 ? '' : 's'} in ${res.results.length} note${res.results.length === 1 ? '' : 's'}`;
  if (!res.results.length) {
    const empty = document.createElement('div');
    empty.className = 'sr-empty';
    empty.textContent = $('#search-scope').value ? 'No matches in this branch.' : 'No matches in any note.';
    list.appendChild(empty);
    return;
  }
  const frag = document.createDocumentFragment();
  for (const r of res.results) {
    // Clicking a note's title folds its hits away (and back); a note matched
    // only by its title has nothing to fold, so the click opens it instead.
    const bodyHits = r.hits.filter((h) => !h.title).length;
    const head = document.createElement('div');
    head.className = 'sr-node';
    head.tabIndex = 0;
    const twisty = document.createElement('span');
    twisty.className = 'sr-twisty';
    const title = document.createElement('span');
    title.className = 'sr-title';
    title.textContent = r.title;
    const count = document.createElement('span');
    count.className = 'sr-count';
    count.textContent = bodyHits;
    const p = document.createElement('span');
    p.className = 'sr-path';
    p.textContent = r.rel.replace(/\.md$/, '').split('/').slice(0, -1).join(' / ') || '(top level)';
    head.append(twisty, title, count, p);
    const group = document.createElement('div');
    group.className = 'sr-group';
    const fold = (on) => {
      head.classList.toggle('collapsed', on);
      group.hidden = on;
      if (on) srCollapsed.add(r.rel);
      else srCollapsed.delete(r.rel);
    };
    if (bodyHits) fold(srCollapsed.has(r.rel));
    else head.classList.add('leaf');
    head.onclick = (e) => {
      if (!bodyHits) return openHit(r.rel, query, 0);
      if (e.altKey) {
        // ⌥-click folds or unfolds every note
        const on = !head.classList.contains('collapsed');
        for (const n of list.querySelectorAll('.sr-node:not(.leaf)')) if (n.classList.contains('collapsed') !== on) n.click();
        return;
      }
      fold(!head.classList.contains('collapsed'));
    };
    head.onkeydown = (e) => { if (e.key === 'Enter') head.click(); };
    frag.append(head, group);
    r.hits.forEach((h, k) => {
      if (h.title) return;
      const el = document.createElement('div');
      el.className = 'sr-hit';
      el.tabIndex = 0;
      const ln = document.createElement('span');
      ln.className = 'ln';
      ln.textContent = h.line;
      el.appendChild(ln);
      const mark = document.createElement('mark');
      mark.textContent = h.text.slice(h.col, h.col + h.match.length);
      el.append(h.text.slice(0, h.col), mark, h.text.slice(h.col + h.match.length));
      const bodyIndex = r.hits.slice(0, k).filter((x) => !x.title).length;
      el.onclick = () => openHit(r.rel, h.match, bodyIndex);
      el.onkeydown = (e) => { if (e.key === 'Enter') el.onclick(); };
      group.appendChild(el);
    });
  }
  list.appendChild(frag);
}

// Find bar; with replace on, the second row for replacing shows as well. A
// selected bit of text becomes the search term.
function openFind(replace) {
  const bar = $('#find-bar');
  bar.hidden = false;
  bar.classList.toggle('replace', !!replace);
  const fi = $('#find-input');
  if (editor && !editor.state.selection.empty) {
    const { from, to } = editor.state.selection;
    const sel = editor.state.doc.textBetween(from, to, ' ');
    if (sel && !sel.includes('\n') && sel.length <= 200) {
      fi.value = sel;
      search.term = sel;
      search.index = 0;
      refreshSearch(false);
    }
  }
  const target = replace && fi.value ? $('#replace-input') : fi;
  target.focus();
  target.select();
}

// Replace the current match, or every match, keeping the formatting of the
// text replaced. The find decorations recompute on the change. With "Drop
// emptied lines" on, a line left blank by the replacement is removed too,
// and so is a bullet left with nothing in it (never the note's only line).
function replaceMatches(all) {
  if (!editor || !search.matches.length) return;
  const text = $('#replace-input').value;
  const dropEmpty = $('#replace-drop').checked;
  const { tr } = editor.state;
  const targets = all ? [...search.matches].reverse() : [search.matches[search.index]];
  for (const m of targets) {
    tr.insertText(text, m.from, m.to);
    if (!dropEmpty) continue;
    const $p = tr.doc.resolve(m.from);
    const block = $p.parent;
    if (!block.isTextblock || block.textContent.trim() || block.content.content.some((n) => !n.isText)) continue;
    // remove the line; if that would leave its list item (or list) empty,
    // remove that instead
    for (let d = $p.depth; d > 0; d--) {
      const parent = $p.node(d - 1);
      const idx = $p.index(d - 1);
      if (parent.canReplace(idx, idx + 1)) {
        tr.delete($p.before(d), $p.after(d));
        break;
      }
      if (parent.childCount !== 1) break;
    }
  }
  editor.view.dispatch(tr);
  if (!all && search.index >= search.matches.length) search.index = 0;
  refreshSearch(!all);
  if (all) editor.commands.focus();
}

async function openHit(rel, term, index) {
  await selectNode(rel);
  expandTo(rel);
  renderTree();
  $('#find-bar').hidden = false;
  $('#find-input').value = term;
  search.term = term;
  search.index = index;
  refreshSearch(true);
}

// ---------------------------------------------------------------------------
// AI helper
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Settings window glue: it previews changes here live, Save persists them,
// and closing it without saving puts things back.
// ---------------------------------------------------------------------------

let prefsBeforePreview = null;

function onSettingsPreview(patch) {
  if (!prefsBeforePreview) prefsBeforePreview = { ...state.prefs, customTheme: state.prefs.customTheme ? { ...state.prefs.customTheme } : null };
  Object.assign(state.prefs, patch);
  applyPrefs();
}

function onSettingsRevert() {
  if (!prefsBeforePreview) return;
  state.prefs = prefsBeforePreview;
  prefsBeforePreview = null;
  applyPrefs();
}

function onSettingsChanged(settings) {
  prefsBeforePreview = null;
  state.prefs = settings;
  applyPrefs();
}

// ---------------------------------------------------------------------------
// Commands (menu + toolbar share these)
// ---------------------------------------------------------------------------

const commands = {
  'open-notebook': async () => {
    const dir = await window.api.notebook.pick(false);
    if (dir) openNotebook(dir);
  },
  'new-notebook': async () => {
    const dir = await window.api.notebook.pick(true);
    if (!dir) return;
    await openNotebook(dir);
    if (!state.tree.length) newNode('sibling');
  },
  'new-sibling': () => newNode('sibling'),
  'new-child': () => newNode('child'),
  rename: () => state.current && startRename(state.current),
  delete: () => deleteNode(),
  reveal: () => state.current && window.api.shell.reveal(state.current),
  undo: () => (inTextField() ? document.execCommand('undo') : editor?.chain().focus().undo().run()),
  redo: () => (inTextField() ? document.execCommand('redo') : editor?.chain().focus().redo().run()),
  bold: () => {
    if (!editor) return;
    // a heading already reads as bold, so ⌘B on one makes it normal text again
    if (editor.isActive('heading') && !editor.isActive('bold')) editor.chain().focus().setParagraph().run();
    else editor.chain().focus().toggleBold().run();
  },
  italic: () => editor?.chain().focus().toggleItalic().run(),
  underline: () => editor?.chain().focus().toggleUnderline().run(),
  strike: () => editor?.chain().focus().toggleStrike().run(),
  code: () => editor?.chain().focus().toggleCode().run(),
  clear: () => {
    if (!editor) return;
    const chain = editor.chain().focus().unsetAllMarks();
    if (editor.isActive('heading')) chain.setParagraph();
    chain.run();
  },
  para: () => editor?.chain().focus().setParagraph().run(),
  h1: () => editor?.chain().focus().toggleHeading({ level: 1 }).run(),
  h2: () => editor?.chain().focus().toggleHeading({ level: 2 }).run(),
  h3: () => editor?.chain().focus().toggleHeading({ level: 3 }).run(),
  'md-typing': () => window.api.settings.set({ mdTyping: !mdOn() }),
  fg: () => showPalette('fg', $('#btn-fg')),
  bg: () => showPalette('bg', $('#btn-bg')),
  'fg-again': () => applyColor('fg', state.lastFg),
  'bg-again': () => applyColor('bg', state.lastBg),
  bullets: () => editor?.chain().focus().toggleBulletList().run(),
  numbers: () => editor?.chain().focus().toggleOrderedList().run(),
  codeblock: () => toggleCodeBlock(),
  'select-word-right': () => extendSelection((doc, $h) => wordStep(doc, $h, 1)),
  'select-word-left': () => extendSelection((doc, $h) => wordStep(doc, $h, -1)),
  'select-line-end': () => extendSelection((_d, $h) => $h.end()),
  'select-line-start': () => extendSelection((_d, $h) => $h.start()),
  'zoom-in': () => setZoom(state.fontSize + 1),
  'zoom-out': () => setZoom(state.fontSize - 1),
  'zoom-reset': () => setZoom(16),
  'toggle-tree': () => setSidebarHidden(!$('#sidebar').classList.contains('hidden')),
  'move-up': () => moveNode('up'),
  'move-down': () => moveNode('down'),
  indent: () => moveNode('indent'),
  outdent: () => moveNode('outdent'),
  'prev-node': () => stepNode(-1),
  'next-node': () => stepNode(1),
  find: () => openFind(false),
  replace: () => openFind(true),
  search: () => {
    setSidebarHidden(false);
    $('#search-titles').checked = false;
    $('#search-input').focus();
    $('#search-input').select();
  },
  'filter-tree': () => {
    setSidebarHidden(false);
    $('#search-titles').checked = true;
    $('#search-input').focus();
    $('#search-input').select();
  },
  'export-md': () => state.current && window.api.notebook.exportMarkdown(state.current),
  settings: () => window.api.settings.open(),
};

function runCommand(name, opts = {}) {
  // One keystroke reaches the app twice: once as a key event the window handles
  // itself (fromKey), once as the menu accelerator firing `send('cmd', …)`.
  // Which arrives first depends on the key — ⌘ keys hit the window first, but
  // ⌃/⌥/F keys hit the menu first — so the duplicate can come from either side.
  // Drop a repeat of the same command from the *other* source within a short
  // window, whichever order it lands in. Two real presses are both fromKey, so
  // they share a source and are never dropped.
  const src = opts.fromKey ? 'key' : 'menu';
  const dup = state.lastShortcut;
  if (dup && dup.cmd === name && dup.src !== src && Date.now() - dup.at < 150) {
    state.lastShortcut = null;
    return;
  }
  state.lastShortcut = { cmd: name, src, at: Date.now() };
  if (name.startsWith('theme:')) {
    const theme = name.slice(6);
    if (theme === 'custom' && !state.prefs.customTheme) {
      window.api.settings.open('appearance');
      return;
    }
    applyTheme(theme);
    window.api.settings.set({ theme });
    return;
  }
  commands[name]?.();
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

// Does a keydown event match an Electron accelerator like "Shift+Alt+F"?
function acceleratorMatches(acc, e) {
  if (!acc) return false;
  const parts = acc.split('+');
  const key = parts.pop();
  const want = { meta: parts.includes('CmdOrCtrl') || parts.includes('Cmd'), ctrl: parts.includes('Ctrl'), alt: parts.includes('Alt'), shift: parts.includes('Shift') };
  if (want.meta !== e.metaKey || want.ctrl !== e.ctrlKey || want.alt !== e.altKey || want.shift !== e.shiftKey) return false;
  const code = e.code || '';
  const typed = (e.key || '').toUpperCase();
  if (/^[A-Z]$/.test(key)) return code === 'Key' + key || typed === key;
  if (/^\d$/.test(key)) return code === 'Digit' + key || typed === key;
  const map = { Up: 'ArrowUp', Down: 'ArrowDown', Left: 'ArrowLeft', Right: 'ArrowRight', Return: 'Enter', Esc: 'Escape', ',': 'Comma', '.': 'Period', '/': 'Slash', '\\': 'Backslash', '-': 'Minus', '=': 'Equal', '[': 'BracketLeft', ']': 'BracketRight', ';': 'Semicolon', "'": 'Quote', '`': 'Backquote' };
  return code === (map[key] || key);
}

function wire() {
  // toolbar
  $('#toolbar').addEventListener('mousedown', (e) => {
    if (e.target.closest('#btn-more')) {
      e.preventDefault();
      const wasOpen = !$('#tb-overflow').hidden;
      hidePopovers();
      if (!wasOpen) showOverflow();
      return;
    }
    const btn = e.target.closest('button[data-cmd]');
    if (!btn) return;
    e.preventDefault(); // keep editor selection
    hidePopovers();
    runCommand(btn.dataset.cmd);
  });
  $('#tb-overflow').addEventListener('mousedown', (e) => {
    const btn = e.target.closest('button[data-cmd]');
    if (!btn) return;
    e.preventDefault();
    const cmd = btn.dataset.cmd;
    // the color palette anchors to its button, so keep the popover open for it
    if (cmd === 'fg' || cmd === 'bg') $('#palette').hidden = true;
    else hidePopovers();
    runCommand(cmd);
  });
  const ro = new ResizeObserver(() => layoutToolbar());
  ro.observe($('#toolbar'));
  ro.observe($('#status-save')); // the "saved …" text changes width
  layoutToolbar();
  $('#pstyle').addEventListener('mousedown', (e) => e.stopPropagation());
  $('#pstyle').addEventListener('change', (e) => {
    const level = Number(e.target.value);
    if (level) editor?.chain().focus().setHeading({ level }).run();
    else editor?.chain().focus().setParagraph().run();
  });
  const langSel = $('#lang');
  langSel.appendChild(new Option('auto', ''));
  for (const name of LANG_NAMES) langSel.appendChild(new Option(name, name));
  langSel.addEventListener('change', () => {
    state.lastLang = langSel.value;
    if (langSel.value) ensureLangThenRehighlight(langSel.value); // load the grammar; re-highlight when ready
    else ensureAutodetectThenRehighlight(); // 'auto' selected: load detection candidates
    editor?.chain().focus().updateAttributes('codeBlock', { language: langSel.value || null }).run();
    persistPrefs();
  });

  // palette (mouse or arrow keys + Enter)
  const grid = $('#palette .palette-grid');
  PALETTE.forEach((hex, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.style.background = hex;
    b.title = hex;
    b.addEventListener('mousedown', (e) => e.preventDefault()); // keep the editor selection
    b.addEventListener('click', () => {
      applyColor(state.paletteMode, hex);
      hidePopovers();
    });
    b.addEventListener('focus', () => { paletteIndex = i; });
    grid.appendChild(b);
  });
  const hint = document.createElement('div');
  hint.className = 'palette-hint';
  hint.textContent = '← → ↑ ↓ choose · ⏎ apply · esc close';
  $('#palette').appendChild(hint);
  $('#palette').addEventListener('keydown', (e) => {
    const inGrid = e.target.closest('.palette-grid');
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 6, ArrowUp: -6 }[e.key];
    if (step !== undefined) {
      e.preventDefault();
      focusSwatch(paletteIndex + step);
    } else if (inGrid && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      applyColor(state.paletteMode, PALETTE[paletteIndex]);
      hidePopovers();
    } else if (e.key === 'Home') focusSwatch(0);
    else if (e.key === 'End') focusSwatch(PALETTE.length - 1);
    else if (e.key === 'Escape') {
      hidePopovers();
      editor?.commands.focus();
    }
  });
  $('#palette-none').addEventListener('mousedown', (e) => e.preventDefault());
  $('#palette-none').addEventListener('click', () => {
    applyColor(state.paletteMode, null);
    hidePopovers();
  });
  $('#palette-custom').addEventListener('input', (e) => applyColor(state.paletteMode, e.target.value));

  // tree
  const treeEl = $('#tree');
  treeEl.addEventListener('click', (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    const rel = row.parentElement.dataset.rel;
    if (e.target.closest('.twisty')) toggleCollapse(rel);
    else selectNode(rel);
  });
  treeEl.addEventListener('dblclick', (e) => {
    const row = e.target.closest('.row');
    if (row && !e.target.closest('.label input')) toggleCollapse(row.parentElement.dataset.rel);
  });
  treeEl.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    e.preventDefault();
    selectNode(row.parentElement.dataset.rel).then(() => {
      const menu = $('#ctx-menu');
      menu.hidden = false;
      menu.style.left = Math.min(e.clientX, window.innerWidth - 250) + 'px';
      menu.style.top = Math.min(e.clientY, window.innerHeight - 320) + 'px';
    });
  });
  // Drag a row onto another row: the top quarter drops before it, the bottom
  // quarter after it, the middle makes it a child. The empty space below the
  // tree drops at the end of the root. Hovering a folded node for a moment
  // unfolds it so the drop can go deeper.
  let drag = null; // { rel, overRel, zone, timer }
  const zoneOf = (row, e) => {
    const r = row.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    return y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'into';
  };
  const clearDropMarks = () => {
    for (const el of treeEl.querySelectorAll('.drop-before, .drop-after, .drop-into')) el.classList.remove('drop-before', 'drop-after', 'drop-into');
    treeEl.classList.remove('drop-root');
    if (drag) { clearTimeout(drag.timer); drag.timer = null; drag.overRel = null; drag.zone = null; }
  };
  treeEl.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.row');
    if (!row || e.target.closest('input')) { e.preventDefault(); return; }
    drag = { rel: row.parentElement.dataset.rel, overRel: null, zone: null, timer: null };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', drag.rel);
    row.classList.add('dragging');
    treeEl.classList.add('dragging');
  });
  treeEl.addEventListener('dragover', (e) => {
    if (!drag) return;
    const row = e.target.closest('.row');
    const target = row ? row.parentElement.dataset.rel : '';
    if (!canDrop(drag.rel, target)) { clearDropMarks(); return; }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const zone = row ? zoneOf(row, e) : 'root';
    if (target === drag.overRel && zone === drag.zone) return;
    clearDropMarks();
    drag.overRel = target;
    drag.zone = zone;
    if (!row) { treeEl.classList.add('drop-root'); return; }
    row.classList.add('drop-' + zone);
    const li = row.parentElement;
    if (zone === 'into' && li.classList.contains('collapsed')) {
      // Unfold in place rather than re-rendering: rebuilding the tree mid-drag
      // would pull the dragged row out of the DOM and end the drag.
      drag.timer = setTimeout(() => {
        if (!drag || drag.overRel !== target) return;
        state.collapsed.delete(target);
        persistCollapsed();
        li.classList.remove('collapsed');
        drag.overRel = null; // re-mark on the next dragover
      }, 600);
    }
  });
  treeEl.addEventListener('dragleave', (e) => {
    // relatedTarget is unreliable mid-drag; only clear once the pointer is
    // actually outside the tree, so moving between a row's parts keeps marks.
    if (!drag) return;
    const r = treeEl.getBoundingClientRect();
    if (e.clientX <= r.left || e.clientX >= r.right || e.clientY <= r.top || e.clientY >= r.bottom) clearDropMarks();
  });
  treeEl.addEventListener('drop', (e) => {
    if (!drag) return;
    e.preventDefault();
    const { rel, overRel, zone } = drag;
    clearDropMarks();
    if (!zone) return;
    if (zone === 'root') dropNode(rel, 'into', '');
    else dropNode(rel, zone, overRel);
  });
  treeEl.addEventListener('dragend', () => {
    clearDropMarks();
    drag = null;
    treeEl.classList.remove('dragging');
    for (const el of treeEl.querySelectorAll('.row.dragging')) el.classList.remove('dragging');
  });
  treeEl.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    const rel = state.current;
    if (e.key === 'ArrowDown') { e.preventDefault(); stepNode(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); stepNode(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); toggleCollapse(rel, false); }
    else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (rel && !state.collapsed.has(rel) && state.byRel.get(rel)?.children.length) toggleCollapse(rel, true);
      else if (state.parentOf.get(rel)) selectNode(state.parentOf.get(rel).rel);
    } else if (e.key === 'Enter') { e.preventDefault(); editor?.commands.focus(); }
    else if (e.key === 'F2') { e.preventDefault(); rel && startRename(rel); }
    else if (e.key === 'Backspace' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); deleteNode(); }
  });
  $('#ctx-menu').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    hidePopovers();
    runCommand(b.dataset.act);
  });
  // search box (contents by default, titles with the toggle)
  $('#search-input').addEventListener('input', onSearchInput);
  $('#search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') clearSearch();
    else if (e.key === 'Enter') {
      if (titlesMode()) treeEl.focus();
      else runSearch();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const first = $('#search-panel').hidden ? null : $('#search-results .sr-hit, #search-results .sr-node');
      if (first) first.focus();
      else treeEl.focus();
    }
  });
  $('#search-close').onclick = clearSearch;
  for (const id of ['#search-case', '#search-regex', '#search-titles', '#search-scope']) $(id).addEventListener('change', onSearchInput);
  $('#search-results').addEventListener('keydown', (e) => {
    const items = [...document.querySelectorAll('#search-results [tabindex]')].filter((el) => el.offsetParent !== null);
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' && i < items.length - 1) { e.preventDefault(); items[i + 1].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (i > 0) items[i - 1].focus(); else $('#search-input').focus(); }
    else if (e.key === 'Escape') clearSearch();
  });

  // find bar
  const fi = $('#find-input');
  fi.addEventListener('input', () => {
    search.term = fi.value;
    search.index = 0;
    refreshSearch(true);
  });
  fi.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      search.index = (search.index + (e.shiftKey ? -1 : 1) + search.matches.length) % (search.matches.length || 1);
      refreshSearch(true);
    } else if (e.key === 'Escape') closeFind();
  });
  $('#find-next').onclick = () => { search.index = (search.index + 1) % (search.matches.length || 1); refreshSearch(true); };
  $('#find-prev').onclick = () => { search.index = (search.index - 1 + search.matches.length) % (search.matches.length || 1); refreshSearch(true); };
  $('#find-close').onclick = closeFind;
  const ri = $('#replace-input');
  ri.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') replaceMatches(e.metaKey || e.ctrlKey);
    else if (e.key === 'Escape') closeFind();
  });
  $('#replace-one').onclick = () => replaceMatches(false);
  $('#replace-drop').addEventListener('change', () => window.api.settings.set({ replaceDropEmpty: $('#replace-drop').checked }));
  $('#replace-all').onclick = () => replaceMatches(true);
  function closeFind() {
    $('#find-bar').hidden = true;
    $('#find-bar').classList.remove('replace');
    search.term = '';
    refreshSearch(false);
    editor?.commands.focus();
  }

  // welcome
  $('#w-open').onclick = commands['open-notebook'];
  $('#w-new').onclick = commands['new-notebook'];

  // Every app shortcut is handled here, in the window, so the keys follow the
  // user's settings even where the editor or Chromium would act on the
  // keystroke itself (⌘B, ⌥ letters typing accented characters). The menu
  // shows the same keys and runs the command when the window never sees the
  // key (macOS gives ⌥/⌃/F-key equivalents to the menu first).
  document.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey || e.altKey || /^F\d/.test(e.code)) || state.prefs.hotkeys === false) return;
    const keys = resolveKeys(state.prefs);
    const sc = SHORTCUTS.find((s) => (!s.native || s.cmd) && keys[s.id] && acceleratorMatches(keys[s.id], e));
    if (!sc) return;
    const cmd = sc.cmd || sc.id;
    e.preventDefault();
    e.stopPropagation();
    runCommand(cmd, { fromKey: true });
  }, true);

  // popovers close on outside click / escape
  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.popover') && !e.target.closest('#btn-fg, #btn-bg, #btn-more')) hidePopovers();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hidePopovers();
  });

  // splitter
  $('#splitter').addEventListener('mousedown', (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = $('#sidebar').getBoundingClientRect().width;
    const move = (ev) => {
      const w = Math.max(160, Math.min(window.innerWidth - 400, startW + ev.clientX - startX));
      state.sidebarWidth = w;
      document.documentElement.style.setProperty('--sidebar-width', w + 'px');
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      persistPrefs();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });

  // menu commands + flush on close
  window.api.onCommand(runCommand);
  window.api.onFlush(async () => {
    await saveCurrent();
    window.api.flushed();
  });
  window.addEventListener('blur', () => saveCurrent());

  // Multiple windows share one notebook. When another window changes the tree
  // (new/rename/delete/move), refresh ours; if the note we had open was moved
  // or deleted there, fall back to a blank editor.
  window.api.onNotebookChanged(async () => {
    if (!state.root) return;
    await refreshTree();
    if (state.current && !state.byRel.has(state.current)) {
      state.current = null;
      buildEditor({ type: 'doc', content: [{ type: 'paragraph' }] });
    }
  });
  // When we regain focus, pick up edits another window saved to the same note.
  // Only when we have no unsaved edits of our own, so we never clobber them.
  window.addEventListener('focus', reloadIfChangedElsewhere);
}

// Re-read the open note and rebuild only if the file on disk differs from what
// we are showing. Keeps two windows on the same note in step without resetting
// the cursor on every focus.
async function reloadIfChangedElsewhere() {
  if (!state.current || state.dirty || !editor) return;
  try {
    const { raw, body } = await window.api.note.read(state.current);
    if ((body || '') === serializeMarkdown(editor.getJSON())) return;
    state.raw = raw || '';
    buildEditor(parseMarkdown(body || ''), state.current);
    if (search.term) refreshSearch(false);
  } catch { /* note vanished; the tree refresh handles it */ }
}

async function main() {
  wire();
  const s = await window.api.settings.get();
  state.prefs = s;
  window.api.onSettingsPreview(onSettingsPreview);
  window.api.onSettingsRevert(onSettingsRevert);
  window.api.onSettingsChanged(onSettingsChanged);
  state.lastFg = s.lastFg || state.lastFg;
  state.lastBg = s.lastBg || state.lastBg;
  state.lastLang = s.lastLang || '';
  applyTheme(s.theme || 'modern-dark');
  document.documentElement.style.setProperty('--fg-swatch', state.lastFg);
  document.documentElement.style.setProperty('--bg-swatch', state.lastBg);
  if (s.sidebarWidth) {
    state.sidebarWidth = s.sidebarWidth;
    document.documentElement.style.setProperty('--sidebar-width', s.sidebarWidth + 'px');
  }
  setZoom(s.fontSize || 16);
  $('#replace-drop').checked = s.replaceDropEmpty !== false;
  setSidebarHidden(!!s.sidebarHidden);
  const opened = s.lastNotebook ? await openNotebook(s.lastNotebook) : false;
  if (!opened) {
    $('#welcome').hidden = false;
    buildEditor({ type: 'doc', content: [{ type: 'paragraph' }] });
  }
}

main();
