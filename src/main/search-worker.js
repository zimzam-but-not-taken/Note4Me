'use strict';
// Notebook-wide search runs here, on a worker thread, so a slow or malicious
// regular expression can only wedge this thread — the main process terminates
// the worker after a timeout and the UI stays responsive. The main process
// hands us the node list (it already scans the tree for the sidebar); we do the
// file reading and matching, which is the unbounded part.

const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const { plainText } = require('../renderer/md.js');

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Minimal front-matter split (the worker only needs the body).
function bodyOf(text) {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text);
  return m ? text.slice(m[0].length) : text;
}

function run({ query, caseSensitive, regex, titlesOnly, nodes }) {
  let re;
  try {
    re = new RegExp(regex ? query : escapeRe(query), caseSensitive ? 'g' : 'gi');
  } catch (err) {
    return { results: [], total: 0, error: err.message };
  }
  const results = [];
  let total = 0;
  const MAX_TOTAL = 2000;
  const MAX_PER_FILE = 60;
  for (const node of nodes) {
    const hits = [];
    re.lastIndex = 0;
    if (re.test(node.title)) hits.push({ line: 0, text: node.title, title: true });
    if (!titlesOnly) {
      let text = '';
      try { text = fs.readFileSync(node.abs, 'utf8'); } catch { text = ''; }
      const lines = bodyOf(text).split('\n');
      let inCode = false;
      let fence = null;
      for (let i = 0; i < lines.length && hits.length < MAX_PER_FILE; i++) {
        const raw = lines[i];
        if (!inCode) {
          const f = /^(`{3,}|~{3,})/.exec(raw);
          if (f) { inCode = true; fence = f[1]; continue; }
        } else if (raw.trimEnd().startsWith(fence) && /^(`{3,}|~{3,})\s*$/.test(raw)) {
          inCode = false;
          continue;
        }
        if (raw.startsWith('![') || /^<img\s/i.test(raw)) continue; // embedded image data
        const plain = inCode ? raw : plainText(raw.replace(/^(#{1,6}|[-*+]|\d{1,9}\.) /, ''));
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(plain)) && hits.length < MAX_PER_FILE) {
          if (m[0] === '') { re.lastIndex++; continue; }
          const start = Math.max(0, m.index - 40);
          hits.push({
            line: i + 1,
            text: (start > 0 ? '…' : '') + plain.slice(start, m.index + m[0].length + 60),
            match: m[0],
            col: m.index - start + (start > 0 ? 1 : 0),
          });
        }
      }
    }
    if (hits.length) {
      results.push({ rel: node.rel, title: node.title, hits });
      total += hits.length;
      if (total >= MAX_TOTAL) return { results, total, truncated: true };
    }
  }
  return { results, total, truncated: false };
}

try {
  parentPort.postMessage(run(workerData));
} catch (err) {
  parentPort.postMessage({ results: [], total: 0, error: String(err && err.message || err) });
}
