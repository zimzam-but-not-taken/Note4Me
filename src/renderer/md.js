// Markdown <-> ProseMirror JSON for the Note4Me format (see FORMAT.md).
//
// Document model:
//   doc > (paragraph | heading | codeBlock | image | bulletList | orderedList)*
//   listItem > paragraph (bulletList | orderedList)*
//   one paragraph per line; marks: bold, italic, underline, strike, code,
//   link{href}, textStyle{color, backgroundColor}.
//
// The parser recognises only what the serializer writes. Everything else is
// literal text, so files edited by hand or other tools round-trip safely.

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const FENCE_RE = /^(`{3,}|~{3,})(.*)$/;
const HEADING_RE = /^(#{1,6}) (.*)$/;
const LIST_RE = /^( *)([-*+]|\d{1,9}\.)(?: (.*)|$)/;
// A list begins at column 0, or at an even indent for a list nested with no
// parent item (Tab on a first bullet). Odd indents stay text, as imported notes
// use "   → " style lines that must not turn into lists.
const LIST_START_RE = /^((?:  )*)([-*+]|\d{1,9}\.)(?: |$)/;
const IMG_TAG_RE = /^<img\s+([^>]*?)\s*\/?>\s*$/i;

function parseFenceInfo(info) {
  let language = null;
  let height = null;
  for (const tok of info.trim().split(/\s+/).filter(Boolean)) {
    const h = /^h=(\d+)$/.exec(tok);
    if (h) height = Number(h[1]);
    else if (language === null) language = tok;
  }
  return { language, height };
}

function attrsOfTag(s) {
  const out = {};
  for (const m of s.matchAll(/([a-zA-Z-]+)\s*=\s*"([^"]*)"/g)) out[m[1].toLowerCase()] = m[2];
  return out;
}

export function parseMarkdown(body) {
  // Split on "\n" only; a stray "\r" stays in the text and round-trips.
  const lines = body.split('\n');
  // A file always ends with "\n"; drop the phantom empty last line.
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const content = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const f = FENCE_RE.exec(line);
    if (f && !/^`{3,}.*`/.test(line)) {
      const fence = f[1];
      const { language, height } = parseFenceInfo(f[2]);
      const buf = [];
      i++;
      while (i < lines.length) {
        const t = lines[i].trimEnd();
        if (t[0] === fence[0] && /^(`{3,}|~{3,})$/.test(t) && t.length >= fence.length) {
          i++;
          break;
        }
        buf.push(lines[i]);
        i++;
      }
      const text = buf.join('\n');
      content.push({
        type: 'codeBlock',
        attrs: { language, height },
        content: text ? [{ type: 'text', text }] : [],
      });
      continue;
    }
    const h = HEADING_RE.exec(line);
    if (h) {
      content.push({ type: 'heading', attrs: { level: h[1].length }, content: parseInline(h[2]) });
      i++;
      continue;
    }
    if (line.startsWith('![')) {
      const lm = matchLink(line.slice(1));
      if (lm && line.slice(1 + lm.length).trim() === '') {
        content.push({ type: 'image', attrs: { src: lm.href, alt: lm.text || null, title: null, width: null, height: null } });
        i++;
        continue;
      }
    }
    const it = IMG_TAG_RE.exec(line);
    if (it) {
      const a = attrsOfTag(it[1]);
      if (a.src) {
        content.push({
          type: 'image',
          attrs: {
            src: a.src,
            alt: a.alt || null,
            title: null,
            width: a.width ? Number(a.width) : null,
            height: a.height ? Number(a.height) : null,
          },
        });
        i++;
        continue;
      }
    }
    if (LIST_START_RE.test(line)) {
      const start = i;
      while (i < lines.length && LIST_RE.test(lines[i])) i++;
      content.push(...parseList(lines.slice(start, i)));
      continue;
    }
    content.push({ type: 'paragraph', content: parseInline(line) });
    i++;
  }
  if (content.length === 0) content.push({ type: 'paragraph' });
  return { type: 'doc', content };
}

// Build nested lists from consecutive list lines. Indentation decides depth;
// a change of marker kind at the same depth starts a new sibling list.
function parseList(lines) {
  const roots = [];
  const stack = []; // { indent, list }
  for (const line of lines) {
    const m = LIST_RE.exec(line);
    const indent = m[1].length;
    const marker = m[2];
    const ordered = /\d/.test(marker);
    const text = m[3] || '';
    const item = { type: 'listItem', content: [{ type: 'paragraph', content: parseInline(text) }] };
    while (stack.length && indent < stack[stack.length - 1].indent) stack.pop();
    const top = stack[stack.length - 1];
    if (top && indent === top.indent) {
      const sameKind = (top.list.type === 'orderedList') === ordered;
      if (sameKind) {
        top.list.content.push(item);
        continue;
      }
      stack.pop();
    }
    const list = ordered
      ? { type: 'orderedList', attrs: { start: parseInt(marker, 10) || 1 }, content: [item] }
      : { type: 'bulletList', content: [item] };
    const parent = stack[stack.length - 1];
    if (parent && indent > parent.indent) {
      const lastItem = parent.list.content[parent.list.content.length - 1];
      lastItem.content.push(list);
    } else {
      // an indented list with no item above it: nest it in empty list shells,
      // one per two columns, so it keeps its depth
      let outer = list;
      for (let n = Math.floor(indent / 2); n > 0; n--) outer = { type: 'bulletList', content: [outer] };
      roots.push(outer);
    }
    stack.push({ indent, list });
  }
  return roots;
}

const SPAN_OPEN_RE = /^<span style="([^"]*)">/i;
const STYLE_RE = /(color|background(?:-color)?)\s*:\s*([^;"]+)/gi;

function parseStyle(style) {
  const out = {};
  let m;
  STYLE_RE.lastIndex = 0;
  while ((m = STYLE_RE.exec(style))) {
    const v = m[2].trim();
    if (m[1].toLowerCase() === 'color') out.color = v;
    else out.backgroundColor = v;
  }
  return out;
}

// Returns an array of ProseMirror text nodes.
export function parseInline(line) {
  const nodes = [];
  const stack = []; // active marks: {type, attrs}
  let buf = '';

  const flush = () => {
    if (!buf) return;
    const marks = collapseMarks(stack);
    nodes.push(marks.length ? { type: 'text', text: buf, marks } : { type: 'text', text: buf });
    buf = '';
  };

  let i = 0;
  const n = line.length;
  while (i < n) {
    const c = line[i];
    const rest = line.slice(i);

    if (c === '\\' && i + 1 < n && /[\\`*_{}\[\]()#+\-.!<>~|]/.test(line[i + 1])) {
      buf += line[i + 1];
      i += 2;
      continue;
    }

    if (c === '`') {
      const ticks = /^(`+)/.exec(rest)[1];
      const close = rest.indexOf(ticks, ticks.length);
      if (close > 0 && rest[close + ticks.length] !== '`') {
        let inner = rest.slice(ticks.length, close);
        if (inner.length > 2 && inner.startsWith(' ') && inner.endsWith(' ') && inner.trim()) inner = inner.slice(1, -1);
        flush();
        stack.push({ type: 'code' });
        buf = inner;
        flush();
        stack.pop();
        i += close + ticks.length;
        continue;
      }
    }

    if (c === '<') {
      const lower = rest.slice(0, 8).toLowerCase();
      if (lower.startsWith('</span>') && hasOpen(stack, 'textStyle')) {
        flush();
        popMark(stack, 'textStyle');
        i += 7;
        continue;
      }
      if (lower.startsWith('</u>') && hasOpen(stack, 'underline')) {
        flush();
        popMark(stack, 'underline');
        i += 4;
        continue;
      }
      if (lower.startsWith('<u>') && rest.toLowerCase().indexOf('</u>', 3) > 0) {
        flush();
        stack.push({ type: 'underline' });
        i += 3;
        continue;
      }
      const sm = SPAN_OPEN_RE.exec(rest);
      if (sm && rest.toLowerCase().indexOf('</span>', sm[0].length) > 0) {
        flush();
        stack.push({ type: 'textStyle', attrs: parseStyle(sm[1]) });
        i += sm[0].length;
        continue;
      }
    }

    if (c === '*' || c === '~') {
      const delim = rest.startsWith('**') ? '**' : rest.startsWith('~~') ? '~~' : c === '*' ? '*' : null;
      if (delim) {
        const type = delim === '**' ? 'bold' : delim === '*' ? 'italic' : 'strike';
        if (hasOpen(stack, type) && i > 0 && !/\s/.test(line[i - 1])) {
          flush();
          popMark(stack, type);
          i += delim.length;
          continue;
        }
        const after = line[i + delim.length];
        if (after && !/\s/.test(after) && findCloser(line, i + delim.length, delim) >= 0) {
          flush();
          stack.push({ type });
          i += delim.length;
          continue;
        }
      }
    }

    if (c === '[') {
      const lm = matchLink(rest);
      if (lm) {
        flush();
        stack.push({ type: 'link', attrs: { href: lm.href } });
        const inner = parseInline(lm.text);
        const marks = collapseMarks(stack);
        for (const nd of inner) {
          const m2 = [...(nd.marks || [])];
          for (const mk of marks) if (!m2.some((x) => x.type === mk.type)) m2.push(mk);
          nodes.push({ ...nd, marks: m2 });
        }
        stack.pop();
        i += lm.length;
        continue;
      }
    }

    buf += c;
    i++;
  }
  flush();
  return nodes;
}

function hasOpen(stack, type) {
  return stack.some((s) => s.type === type);
}
function popMark(stack, type) {
  const idx = stack.map((s) => s.type).lastIndexOf(type);
  if (idx >= 0) stack.splice(idx, 1);
}
function collapseMarks(stack) {
  const marks = [];
  for (const s of stack) {
    const existing = marks.find((m) => m.type === s.type);
    if (existing) {
      if (s.attrs) existing.attrs = { ...existing.attrs, ...s.attrs };
    } else {
      marks.push(s.attrs ? { type: s.type, attrs: { ...s.attrs } } : { type: s.type });
    }
  }
  return marks;
}

function findCloser(line, from, delim) {
  let j = from;
  while (j < line.length) {
    if (line[j] === '\\') {
      j += 2;
      continue;
    }
    if (line.startsWith(delim, j)) {
      const before = line[j - 1];
      if (before && !/\s/.test(before)) {
        if (delim === '*' && line[j + 1] === '*') {
          j += 2;
          continue;
        }
        return j;
      }
    }
    j++;
  }
  return -1;
}

function matchLink(rest) {
  if (rest[0] !== '[') return null;
  let depth = 0;
  let i = 0;
  for (i = 0; i < rest.length; i++) {
    const c = rest[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) break;
    }
  }
  if (depth !== 0 || rest[i + 1] !== '(') return null;
  const text = rest.slice(1, i);
  let j = i + 2;
  let pd = 1;
  for (; j < rest.length; j++) {
    if (rest[j] === '(') pd++;
    else if (rest[j] === ')') {
      pd--;
      if (pd === 0) break;
    }
  }
  if (pd !== 0) return null;
  let href = rest.slice(i + 2, j).trim();
  if (href.startsWith('<') && href.endsWith('>')) href = href.slice(1, -1);
  return { text, href, length: j + 1 };
}

// ---------------------------------------------------------------------------
// Serializing
// ---------------------------------------------------------------------------

const MARK_ORDER = ['textStyle', 'link', 'bold', 'italic', 'underline', 'strike', 'code'];

export function serializeMarkdown(doc) {
  const out = [];
  for (const node of doc.content || []) serializeBlock(node, out, '');
  return out.join('\n') + '\n';
}

function serializeBlock(node, out, indent) {
  switch (node.type) {
    case 'paragraph':
      out.push(indent + serializeInline(node.content || []));
      break;
    case 'heading':
      out.push(indent + '#'.repeat(node.attrs?.level || 1) + ' ' + serializeInline(node.content || []));
      break;
    case 'codeBlock': {
      const text = (node.content || []).map((t) => t.text || '').join('');
      let longest = 0;
      for (const m of text.matchAll(/`{3,}/g)) longest = Math.max(longest, m[0].length);
      const fence = '`'.repeat(Math.max(3, longest + 1));
      const info = [node.attrs?.language || '', node.attrs?.height ? `h=${node.attrs.height}` : ''].filter(Boolean).join(' ');
      out.push(indent + fence + info);
      if (text) out.push(...text.split('\n').map((l) => indent + l));
      out.push(indent + fence);
      break;
    }
    case 'image': {
      const { src = '', alt, width, height } = node.attrs || {};
      if (width || height) {
        const a = alt ? ` alt="${alt.replace(/"/g, '&quot;')}"` : '';
        const w = width ? ` width="${width}"` : '';
        const h = height ? ` height="${height}"` : '';
        out.push(`${indent}<img src="${src}"${a}${w}${h}>`);
      } else out.push(`${indent}![${alt || ''}](${src})`);
      break;
    }
    case 'bulletList':
    case 'orderedList': {
      const ordered = node.type === 'orderedList';
      const start = Number(node.attrs?.start) || 1;
      let idx = 0;
      for (const item of node.content || []) {
        if (item.type !== 'listItem') { // a list nested with no parent item
          serializeBlock(item, out, indent + '  ');
          continue;
        }
        const marker = ordered ? `${start + idx++}. ` : '- ';
        const kids = item.content || [];
        const first = kids[0];
        const hasPara = first && first.type === 'paragraph';
        out.push(indent + marker + (hasPara ? serializeInline(first.content || []) : ''));
        const sub = indent + ' '.repeat(marker.length);
        for (const k of kids.slice(hasPara ? 1 : 0)) serializeBlock(k, out, sub);
      }
      break;
    }
    default:
      out.push(indent + serializeInline(node.content || []));
  }
}

function styleOf(mark) {
  const a = mark.attrs || {};
  const parts = [];
  if (a.color) parts.push(`color:${a.color}`);
  if (a.backgroundColor) parts.push(`background:${a.backgroundColor}`);
  return parts.join(';');
}

function marksOf(textNode) {
  const present = new Map((textNode.marks || []).map((m) => [m.type, m]));
  const list = [];
  for (const t of MARK_ORDER) {
    const m = present.get(t);
    if (!m) continue;
    if (t === 'textStyle' && !styleOf(m)) continue;
    list.push(m);
  }
  return list;
}

function openClose(mark, core) {
  switch (mark.type) {
    case 'textStyle':
      return [`<span style="${styleOf(mark)}">`, '</span>'];
    case 'link':
      return ['[', `](${mark.attrs?.href || ''})`];
    case 'bold':
      return ['**', '**'];
    case 'italic':
      return ['*', '*'];
    case 'underline':
      return ['<u>', '</u>'];
    case 'strike':
      return ['~~', '~~'];
    case 'code':
      return core.includes('`') ? ['`` ', ' ``'] : ['`', '`'];
    default:
      return ['', ''];
  }
}

function sameMark(a, b) {
  if (a.type !== b.type) return false;
  if (a.type === 'textStyle') return styleOf(a) === styleOf(b);
  if (a.type === 'link') return (a.attrs?.href || '') === (b.attrs?.href || '');
  return true;
}

export function escapeText(text, atLineStart, inLink = false) {
  let out = text.replace(/\\/g, '\\\\').replace(/\*/g, '\\*').replace(/`/g, '\\`');
  if (inLink) out = out.replace(/[\[\]]/g, '\\$&');
  else {
    if (out.includes('](')) out = out.replace(/\[/g, '\\[');
    out = out.replace(/\](?=\()/g, '\\]');
  }
  out = out.replace(/(^|[^\w\\])_(?=\S)/g, '$1\\_');
  out = out.replace(/<(?=[A-Za-z/!?])/g, '\\<');
  out = out.replace(/~~/g, '\\~~');
  if (atLineStart) {
    out = out.replace(/^( *)([#>])/, '$1\\$2');
    out = out.replace(/^( *)(```|~~~)/, '$1\\$2');
    // a plain line that looks like a list item must not become one
    out = out.replace(/^([-+])( |$)/, '\\$1$2');
    out = out.replace(/^(\d{1,9})(\.)( |$)/, '$1\\$2$3');
  }
  return out;
}

// Marks that are HTML tags or link syntax may wrap whitespace; emphasis may not.
const WRAPS_SPACE = new Set(['textStyle', 'link', 'underline']);

export function serializeInline(nodes) {
  const out = [];
  const stack = []; // [{mark, close}]
  const closeTo = (depth) => {
    while (stack.length > depth) out.push(stack.pop().close);
  };
  for (const node of nodes) {
    if (node.type !== 'text') continue;
    const text = node.text || '';
    if (!text) continue;
    const core = text.trim();
    const spaceOnly = !core;
    const lead = spaceOnly ? '' : text.slice(0, text.length - text.trimStart().length);
    const trail = spaceOnly ? '' : text.slice(text.trimEnd().length);
    let wanted = marksOf(node);
    if (spaceOnly) wanted = wanted.filter((m) => WRAPS_SPACE.has(m.type));
    let keep = 0;
    while (keep < stack.length && keep < wanted.length && sameMark(stack[keep].mark, wanted[keep])) keep++;
    closeTo(keep);
    if (lead) out.push(lead);
    for (const mark of wanted.slice(keep)) {
      const [open, close] = openClose(mark, core);
      out.push(open);
      stack.push({ mark, close });
    }
    if (spaceOnly) {
      out.push(text);
      continue;
    }
    const atStart = out.length === 0;
    const isCode = wanted.some((m) => m.type === 'code');
    const inLink = wanted.some((m) => m.type === 'link');
    out.push(isCode ? core : escapeText(core, atStart, inLink));
    if (trail) {
      closeTo(0);
      out.push(trail);
    }
  }
  closeTo(0);
  return out.join('');
}

// Plain text of a line of Markdown, for search snippets.
export function plainText(line) {
  return parseInline(line).map((n) => n.text).join('');
}
