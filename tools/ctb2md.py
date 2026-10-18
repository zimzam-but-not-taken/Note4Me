#!/usr/bin/env python3
"""
ctb2md.py - Convert a CherryTree SQLite notebook (.ctb) into a Note4Me
Markdown tree.

    python3 tools/ctb2md.py ~/Notes/Attack.ctb ~/Notes/Note4Me/Attack [--assets]

Images are embedded in the note as data URIs by default so the folder holds
nothing but notes. --assets writes them to _assets/ next to the note instead.

The output layout and inline syntax are described in FORMAT.md. The goal is
Markdown that any viewer (Obsidian, VS Code, GitHub) can read, while keeping
the three things that matter in a CherryTree notebook: the node tree,
foreground/background colours, and syntax-highlighted code blocks.

Only the Python standard library is used.
"""

from __future__ import annotations

import base64
import html
import os
import re
import sqlite3
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path

# ----------------------------------------------------------------------------
# Colour / attribute normalisation
# ----------------------------------------------------------------------------

# Colours that mean "no colour" in a dark CherryTree theme. Dropping them keeps
# the Markdown clean and lets the app theme decide the defaults.
DEFAULT_FG = {"#ffffff"}
DEFAULT_BG = {"#000000"}


def norm_color(value: str | None) -> str | None:
    """GTK writes 16-bit-per-channel colours (#rrrrggggbbbb). Fold to #rrggbb."""
    if not value:
        return None
    v = value.strip().lower()
    if not v.startswith("#"):
        return v
    hexpart = v[1:]
    if len(hexpart) == 12:
        hexpart = hexpart[0:2] + hexpart[4:6] + hexpart[8:10]
    elif len(hexpart) == 3:
        hexpart = "".join(c * 2 for c in hexpart)
    elif len(hexpart) != 6:
        return v
    return "#" + hexpart


@dataclass(frozen=True)
class Attrs:
    bold: bool = False
    italic: bool = False
    underline: bool = False
    strike: bool = False
    mono: bool = False
    fg: str | None = None
    bg: str | None = None
    link: str | None = None
    scale: str | None = None  # h1..h6, small, sup, sub

    def is_plain(self) -> bool:
        return self == Attrs()


def attrs_from_xml(el: ET.Element) -> Attrs:
    a = el.attrib
    fg = norm_color(a.get("foreground"))
    bg = norm_color(a.get("background"))
    if fg in DEFAULT_FG:
        fg = None
    if bg in DEFAULT_BG:
        bg = None
    return Attrs(
        bold=a.get("weight") == "heavy",
        italic=a.get("style") == "italic",
        underline=a.get("underline") == "single",
        strike=a.get("strikethrough") == "true",
        mono=a.get("family") == "monospace",
        fg=fg,
        bg=bg,
        link=a.get("link") or None,
        scale=a.get("scale") or None,
    )


# ----------------------------------------------------------------------------
# Document model: a node body is a list of blocks; a text block is a list of
# runs (text, attrs). Objects (code boxes, images, tables) are blocks too.
# ----------------------------------------------------------------------------


@dataclass
class Run:
    text: str
    attrs: Attrs


@dataclass
class CodeBox:
    offset: int
    syntax: str
    text: str
    height: int = 0


@dataclass
class Image:
    offset: int
    png: bytes | None
    anchor: str
    filename: str
    link: str


@dataclass
class Grid:
    offset: int
    rows: list[list[str]]


@dataclass
class Node:
    id: int
    name: str
    syntax: str
    is_rich: bool
    txt: str
    icon: int
    children: list["Node"] = field(default_factory=list)
    parent: "Node | None" = None
    # filled in during layout
    stem: str = ""
    rel_dir: Path = Path()

    @property
    def rel_file(self) -> Path:
        return self.rel_dir / f"{self.stem}.md"

    @property
    def rel_child_dir(self) -> Path:
        return self.rel_dir / self.stem


# ----------------------------------------------------------------------------
# Loading
# ----------------------------------------------------------------------------


def load_tree(db: sqlite3.Connection) -> tuple[list[Node], dict[int, Node]]:
    nodes: dict[int, Node] = {}
    for nid, name, syntax, is_richtxt, txt, is_ro in db.execute(
        "select node_id, name, syntax, is_richtxt, txt, is_ro from node"
    ):
        nodes[nid] = Node(
            id=nid,
            name=name or f"node_{nid}",
            syntax=syntax or "plain-text",
            is_rich=bool(is_richtxt & 1),
            txt=txt or "",
            icon=(is_ro or 0) >> 1,
        )
    roots: list[Node] = []
    for nid, father, seq in db.execute(
        "select node_id, father_id, sequence from children order by father_id, sequence"
    ):
        node = nodes.get(nid)
        if node is None:
            continue
        if father == 0 or father not in nodes:
            roots.append(node)
        else:
            parent = nodes[father]
            node.parent = parent
            parent.children.append(node)
    # Nodes missing from `children` (should not happen) become roots.
    linked = {n.id for r in roots for n in walk(r)}
    for n in nodes.values():
        if n.id not in linked:
            roots.append(n)
    return roots, nodes


def walk(node: Node):
    yield node
    for c in node.children:
        yield from walk(c)


def load_objects(db: sqlite3.Connection, nid: int) -> list[CodeBox | Image | Grid]:
    objs: list[CodeBox | Image | Grid] = []
    for off, syntax, txt, height, is_width_pix in db.execute(
        "select offset, syntax, txt, height, is_width_pix from codebox where node_id=?", (nid,)
    ):
        objs.append(CodeBox(off, syntax or "", txt or "", int(height or 0)))
    for off, anchor, png, filename, link in db.execute(
        "select offset, anchor, png, filename, link from image where node_id=?", (nid,)
    ):
        objs.append(Image(off, png, anchor or "", filename or "", link or ""))
    for off, txt in db.execute("select offset, txt from grid where node_id=?", (nid,)):
        objs.append(Grid(off, parse_grid(txt or "")))
    objs.sort(key=lambda o: o.offset)
    return objs


def parse_grid(txt: str) -> list[list[str]]:
    try:
        root = ET.fromstring(txt)
    except ET.ParseError:
        return []
    rows = []
    for row in root.iter("row"):
        rows.append([(c.text or "") for c in row.iter("cell")])
    # CherryTree stores the header row last.
    if len(rows) > 1:
        rows = [rows[-1]] + rows[:-1]
    return rows


def parse_rich(txt: str) -> list[Run]:
    """Turn CherryTree's <node><rich_text ...>..</rich_text></node> into runs."""
    if not txt.strip():
        return []
    try:
        root = ET.fromstring(txt)
    except ET.ParseError:
        # Fall back to a regex so a single bad node does not stop the export.
        runs = []
        for m in re.finditer(r"<rich_text([^>]*)>(.*?)</rich_text>", txt, re.S):
            fake = ET.Element("rich_text")
            for k, v in re.findall(r'(\w+)="([^"]*)"', m.group(1)):
                fake.set(k, v)
            runs.append(Run(html.unescape(m.group(2)), attrs_from_xml(fake)))
        return runs
    runs = []
    for el in root.iter("rich_text"):
        text = el.text or ""
        if text:
            runs.append(Run(text, attrs_from_xml(el)))
    return runs


# ----------------------------------------------------------------------------
# Splicing objects back into the text by character offset
# ----------------------------------------------------------------------------


def split_runs_at(runs: list[Run], pos: int) -> tuple[list[Run], list[Run]]:
    before, after = [], []
    count = 0
    for r in runs:
        if count + len(r.text) <= pos:
            before.append(r)
        elif count >= pos:
            after.append(r)
        else:
            cut = pos - count
            before.append(Run(r.text[:cut], r.attrs))
            after.append(Run(r.text[cut:], r.attrs))
        count += len(r.text)
    return before, after


def interleave(runs: list[Run], objs: list) -> list:
    """Return a list of text-run lists and objects in document order.

    Every embedded object occupies one character in CherryTree's buffer, so the
    i-th object (0-based) sits at plain-text position `offset - i`.
    """
    blocks: list = []
    rest = runs
    consumed = 0
    for i, obj in enumerate(objs):
        pos = obj.offset - i - consumed
        before, rest = split_runs_at(rest, max(0, pos))
        consumed += sum(len(r.text) for r in before)
        if before:
            blocks.append(before)
        blocks.append(obj)
    if rest:
        blocks.append(rest)
    return blocks


# ----------------------------------------------------------------------------
# Markdown rendering
# ----------------------------------------------------------------------------

def escape_text(text: str, at_line_start: bool, in_link: bool = False) -> str:
    """Escape just enough so CommonMark viewers and Note4Me read it as text.
    Note4Me's own parser only recognises what is escaped here, so anything
    else (list markers, tables, raw HTML other than the tags we emit) is left
    alone and round-trips as literal text."""
    out = text.replace("\\", "\\\\")
    out = out.replace("*", "\\*").replace("`", "\\`")
    # '[' only matters if a '](' follows on the same line; ']' only before '('.
    # Inside link text both are always escaped so the brackets stay balanced.
    if in_link:
        out = out.replace("[", "\\[").replace("]", "\\]")
    else:
        if "](" in out:
            out = out.replace("[", "\\[")
        out = re.sub(r"\](?=\()", r"\\]", out)
    # '_' only opens emphasis when it starts a word.
    out = re.sub(r"(?<![\w\\])_(?=\S)", r"\\_", out)
    # '<' followed by a letter or '/' could be taken for HTML.
    out = re.sub(r"<(?=[A-Za-z/!?])", r"\\<", out)
    out = out.replace("~~", r"\~~")
    if at_line_start:
        out = re.sub(r"^(\s*)([#>])", r"\1\\\2", out)
        out = re.sub(r"^(\s*)(```|~~~)", r"\1\\\2", out)
        # "- item" and "1. item" are deliberately left alone: CherryTree users
        # type lists by hand, and in Note4Me they become real lists.
    return out


def span_style(a: Attrs) -> str | None:
    parts = []
    if a.fg:
        parts.append(f"color:{a.fg}")
    if a.bg:
        parts.append(f"background:{a.bg}")
    return ";".join(parts) if parts else None


def merge_runs(runs: list[Run]) -> list[Run]:
    """Merge neighbours with identical attributes; let whitespace-only runs
    adopt the attributes of identical neighbours so a coloured heading does
    not shatter into one span per word."""
    runs = [r for r in runs if r.text]
    # Pass 1: whitespace runs between identical neighbours take their attrs.
    for i in range(1, len(runs) - 1):
        r = runs[i]
        if r.text.strip() == "" and "\n" not in r.text:
            prev, nxt = runs[i - 1], runs[i + 1]
            if prev.attrs == nxt.attrs and not prev.attrs.link:
                runs[i] = Run(r.text, prev.attrs)
    # Pass 2: merge identical neighbours.
    merged: list[Run] = []
    for r in runs:
        if merged and merged[-1].attrs == r.attrs:
            merged[-1] = Run(merged[-1].text + r.text, r.attrs)
        else:
            merged.append(r)
    return merged


class LinkResolver:
    def __init__(self, nodes_by_id: dict[int, Node]):
        self.nodes = nodes_by_id

    def resolve(self, link: str, from_node: Node) -> str | None:
        kind, _, rest = link.partition(" ")
        if kind == "webs":
            return rest.strip()
        if kind == "node":
            parts = rest.split()
            try:
                target = self.nodes[int(parts[0])]
            except (ValueError, KeyError, IndexError):
                return None
            rel = os.path.relpath(target.rel_file, start=from_node.rel_dir)
            url = rel.replace(os.sep, "/").replace(" ", "%20")
            if len(parts) > 1:
                url += "#" + parts[1]
            return url
        if kind == "file":
            return "file://" + rest.strip().replace(" ", "%20")
        if kind == "fold":
            return "file://" + rest.strip().replace(" ", "%20")
        return None


# Mark nesting order, outermost first. Code (mono) is innermost because
# nothing can nest inside backticks.
MARK_ORDER = ("span", "link", "bold", "italic", "underline", "strike", "mono")
WRAPS_SPACE = ("span", "link", "underline")


def marks_for(a: Attrs) -> list[str]:
    marks = []
    if span_style(a):
        marks.append("span")
    if a.link:
        marks.append("link")
    if a.bold:
        marks.append("bold")
    if a.italic:
        marks.append("italic")
    if a.underline:
        marks.append("underline")
    if a.strike:
        marks.append("strike")
    if a.mono:
        marks.append("mono")
    return marks


def open_close(mark: str, a: Attrs, core: str, resolver: LinkResolver, node: Node) -> tuple[str, str]:
    if mark == "span":
        return f'<span style="{span_style(a)}">', "</span>"
    if mark == "link":
        url = resolver.resolve(a.link or "", node) or ""
        return "[", f"]({url})"
    if mark == "mono":
        return ("`` ", " ``") if "`" in core else ("`", "`")
    return {"bold": ("**", "**"), "italic": ("*", "*"),
            "underline": ("<u>", "</u>"), "strike": ("~~", "~~")}[mark]


def render_line(runs: list[Run], resolver: LinkResolver, node: Node) -> str:
    """Render one line of runs (no newlines inside) to Markdown."""
    out: list[str] = []
    stack: list[tuple[str, Attrs, str]] = []  # (mark, attrs, close string)

    def close_to(depth: int) -> None:
        while len(stack) > depth:
            out.append(stack.pop()[2])

    for r in runs:
        text = r.text
        if not text:
            continue
        core = text.strip()
        space_only = not core
        lead = "" if space_only else text[: len(text) - len(text.lstrip())]
        trail = "" if space_only else text[len(text.rstrip()):]
        wanted = marks_for(r.attrs)
        if space_only:
            # Tags and links may wrap whitespace; emphasis may not.
            wanted = [m for m in wanted if m in WRAPS_SPACE]
        # Marks already open that we can keep (same kind and same payload).
        keep = 0
        for (m, a, _), w in zip(stack, wanted):
            if m != w:
                break
            if m == "span" and span_style(a) != span_style(r.attrs):
                break
            if m == "link" and a.link != r.attrs.link:
                break
            keep += 1
        close_to(keep)
        if lead:
            # Edge whitespace breaks CommonMark emphasis, so it stays outside.
            out.append(lead)
        for m in wanted[keep:]:
            o, c = open_close(m, r.attrs, core, resolver, node)
            out.append(o)
            stack.append((m, r.attrs, c))
        if space_only:
            out.append(text)
            continue
        at_start = not out  # nothing emitted on this line yet, tags included
        out.append(core if r.attrs.mono else escape_text(core, at_start, bool(r.attrs.link)))
        if trail:
            close_to(0)
            out.append(trail)
    close_to(0)
    return "".join(out)


def render_text_block(runs: list[Run], resolver: LinkResolver, node: Node) -> list[str]:
    """Render a run list into Markdown lines. Each CherryTree line becomes one
    Markdown line; blank lines stay blank."""
    runs = merge_runs(runs)
    # Split into lines, carrying attrs across newlines.
    lines: list[list[Run]] = [[]]
    for r in runs:
        parts = r.text.split("\n")
        for i, p in enumerate(parts):
            if i > 0:
                lines.append([])
            if p:
                lines[-1].append(Run(p, r.attrs))
    out = []
    for line in lines:
        out.append(render_line_with_scale(line, resolver, node))
    return out


def render_line_with_scale(line: list[Run], resolver: LinkResolver, node: Node) -> str:
    if not line:
        return ""
    scales = {r.attrs.scale for r in line if r.text.strip()}
    scale = next(iter(scales)) if len(scales) == 1 else None
    prefix = ""
    if scale and scale in ("h1", "h2", "h3", "h4", "h5", "h6"):
        prefix = "#" * int(scale[1]) + " "
        line = [Run(r.text, _without_scale(r.attrs)) for r in line]
    body = render_line(line, resolver, node)
    if scale in ("small", "sup", "sub"):
        tag = {"small": "small", "sup": "sup", "sub": "sub"}[scale]
        body = f"<{tag}>{render_line([Run(r.text, _without_scale(r.attrs)) for r in line], resolver, node)}</{tag}>"
    return prefix + body


def _without_scale(a: Attrs) -> Attrs:
    return Attrs(a.bold, a.italic, a.underline, a.strike, a.mono, a.fg, a.bg, a.link, None)


# highlight.js names for CherryTree / GtkSourceView language ids
LANG_MAP = {
    "plain-text": "",
    "sh": "bash",
    "shell": "bash",
    "nasm": "x86asm",
    "asm": "armasm",
    "js": "javascript",
    "py": "python",
    "c-sharp": "csharp",
    "cpp": "cpp",
    "html": "html",
    "xml": "xml",
    "yaml": "yaml",
    "powershell": "powershell",
    "sql": "sql",
    "dosbatch": "dos",
    "objc": "objectivec",
    "makefile": "makefile",
    "ini": "ini",
    "desktop": "ini",
    "cmake": "cmake",
    "docker": "dockerfile",
    "dockerfile": "dockerfile",
    "latex": "latex",
    "markdown": "markdown",
    "json": "json",
}


def fence_for(text: str) -> str:
    longest = 0
    for m in re.finditer(r"`{3,}", text):
        longest = max(longest, len(m.group(0)))
    return "`" * max(3, longest + 1)


def render_code(syntax: str, text: str, height: int = 0) -> list[str]:
    """CherryTree's stored box height is only a minimum (boxes grow with their
    content), so it is not carried over. Note4Me adds `h=N` to the fence info
    only when you drag a box smaller than its content."""
    lang = LANG_MAP.get(syntax, syntax)
    fence = fence_for(text)
    body = text.rstrip("\n")
    return [f"{fence}{lang}", *body.split("\n"), fence]


def render_table(rows: list[list[str]]) -> list[str]:
    if not rows:
        return []
    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]

    def cell(c: str) -> str:
        return c.replace("|", "\\|").replace("\n", " ")

    out = ["| " + " | ".join(cell(c) for c in rows[0]) + " |"]
    out.append("|" + "---|" * width)
    for r in rows[1:]:
        out.append("| " + " | ".join(cell(c) for c in r) + " |")
    return out


# ----------------------------------------------------------------------------
# File system layout
# ----------------------------------------------------------------------------

_BAD_CHARS = {"/": "∕", "\\": "∕", ":": "꞉"}


def sanitize_stem(name: str) -> str:
    s = "".join(_BAD_CHARS.get(c, c) for c in name)
    s = re.sub(r"[\x00-\x1f]", "", s).strip().strip(".")
    s = s[:120].rstrip() or "untitled"
    if s.startswith(("_assets", ".")):
        s = "_" + s.lstrip("._")
    return s


def layout(roots: list[Node]) -> None:
    def assign(siblings: list[Node], rel_dir: Path):
        used: set[str] = set()
        for n in siblings:
            base = sanitize_stem(n.name)
            stem, k = base, 2
            while stem.lower() in used:
                stem = f"{base} ({k})"
                k += 1
            used.add(stem.lower())
            n.stem = stem
            n.rel_dir = rel_dir
            if n.children:
                assign(n.children, n.rel_child_dir)

    assign(roots, Path())


def yaml_quote(s: str) -> str:
    if re.match(r"^[A-Za-z0-9 _()\-,.]+$", s) and not s.strip().startswith(("-", "#")):
        return s
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


# ----------------------------------------------------------------------------
# Main conversion
# ----------------------------------------------------------------------------


def convert(ctb_path: Path, out_dir: Path, embed_images: bool = True) -> dict:
    db = sqlite3.connect(f"file:{ctb_path}?mode=ro", uri=True)
    roots, by_id = load_tree(db)
    layout(roots)
    resolver = LinkResolver(by_id)
    stats = {"nodes": 0, "codeboxes": 0, "images": 0, "tables": 0, "empty": 0}

    out_dir.mkdir(parents=True, exist_ok=True)

    def write_order(rel_dir: Path, siblings: list[Node]):
        (out_dir / rel_dir).mkdir(parents=True, exist_ok=True)
        (out_dir / rel_dir / ".order").write_text(
            "".join(n.stem + "\n" for n in siblings), encoding="utf-8"
        )

    write_order(Path(), roots)

    for node in [n for r in roots for n in walk(r)]:
        stats["nodes"] += 1
        if node.children:
            write_order(node.rel_child_dir, node.children)

        lines: list[str] = []
        front: dict[str, str] = {}
        if node.stem != node.name:
            front["title"] = node.name
        if node.icon:
            front["icon"] = str(node.icon)

        objs = load_objects(db, node.id)
        if node.is_rich:
            runs = parse_rich(node.txt)
        else:
            # A plain-text / code node: its whole body is one code block.
            runs = []
            if node.txt:
                objs = [CodeBox(0, node.syntax, node.txt, 0)] + objs

        if not runs and not objs:
            stats["empty"] += 1

        img_n = 0
        blocks = interleave(runs, objs)
        for bi, block in enumerate(blocks):
            prev_is_obj = bi > 0 and not isinstance(blocks[bi - 1], list)
            next_is_obj = bi + 1 < len(blocks) and not isinstance(blocks[bi + 1], list)
            if isinstance(block, list):
                new_lines = render_text_block(block, resolver, node)
                # The newline right after an object only ends the object's
                # line; the empty line before an object is the object's line.
                if prev_is_obj and new_lines and new_lines[0] == "":
                    new_lines = new_lines[1:]
                if next_is_obj and new_lines and new_lines[-1] == "":
                    new_lines = new_lines[:-1]
                lines.extend(new_lines)
            elif isinstance(block, CodeBox):
                stats["codeboxes"] += 1
                lines.extend(render_code(block.syntax, block.text, block.height))
            elif isinstance(block, Image):
                if block.anchor:
                    lines.append(f'<a id="{html.escape(block.anchor)}"></a>')
                elif block.png:
                    stats["images"] += 1
                    img_n += 1
                    is_image = not block.filename or block.filename.lower().endswith(
                        (".png", ".jpg", ".jpeg", ".gif", ".webp")
                    )
                    if embed_images and is_image:
                        b64 = base64.b64encode(block.png).decode("ascii")
                        lines.append(f"![](data:image/png;base64,{b64})")
                        continue
                    assets = out_dir / node.rel_dir / "_assets"
                    assets.mkdir(parents=True, exist_ok=True)
                    fname = f"{node.stem}-{img_n}.png"
                    if block.filename:
                        fname = f"{node.stem}-{img_n}-{sanitize_stem(block.filename)}"
                    (assets / fname).write_bytes(block.png)
                    url = f"_assets/{fname}".replace(" ", "%20")
                    if is_image:
                        lines.append(f"![]({url})")
                    else:
                        lines.append(f"[{block.filename}]({url})")
            elif isinstance(block, Grid):
                stats["tables"] += 1
                lines.extend(render_table(block.rows))

        # Tidy: strip trailing blank lines, single trailing newline.
        while lines and lines[-1] == "":
            lines.pop()
        text = "\n".join(lines) + "\n" if lines else ""
        if front:
            fm = "---\n" + "".join(f"{k}: {yaml_quote(v)}\n" for k, v in front.items()) + "---\n"
            text = fm + text
        path = out_dir / node.rel_file
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    db.close()
    return stats


def main(argv: list[str]) -> int:
    embed = "--assets" not in argv
    args = [a for a in argv[1:] if not a.startswith("--")]
    if len(args) != 2:
        print(__doc__)
        return 2
    src, dst = Path(args[0]).expanduser(), Path(args[1]).expanduser()
    if not src.is_file():
        print(f"not a file: {src}", file=sys.stderr)
        return 1
    if dst.exists() and any(dst.iterdir()):
        print(f"refusing to write into non-empty directory: {dst}", file=sys.stderr)
        return 1
    stats = convert(src, dst, embed_images=embed)
    print(f"wrote {dst}")
    for k, v in stats.items():
        print(f"  {k:10s} {v}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
