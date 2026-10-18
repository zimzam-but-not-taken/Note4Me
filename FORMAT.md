# Note4Me on-disk format

A notebook is a plain folder. Everything in it is readable by any Markdown
viewer (Obsidian, VS Code, GitHub). If Note4Me disappears tomorrow, the notes
are still yours and still formatted.

## Tree

```
Attack/
  .order                      ← sibling order, one stem per line
  Mobile.md                   ← the node "Mobile"
  Mobile/                     ← its children live in a folder of the same name
    .order
    Android.md
    Android/
    IOS.md
    IOS/
      _assets/                ← images for notes in this folder
        GRP-1.png
      ...
```

* A node is `<stem>.md`. Its children are in `<stem>/` next to it.
* `.order` lists the stems in display order. Stems not listed sort after,
  alphabetically. A missing `.order` means alphabetical.
* `_assets/` holds images saved as files (optional; images are embedded in
  the note by default). Files beginning with `_` or `.` are never nodes.
* The stem is the title unless the title contains `/`, `\` or `:` or other
  characters a file name cannot hold. Then the file keeps the real title in
  front matter:

  ```
  ---
  title: "UPNP_(UDP/1900, TCP/5000)"
  ---
  ```

## Body

The body is Markdown with three deliberate choices:

1. **One line is one line.** A single newline is a line break, like a text
   editor, not a soft wrap. Blank lines are blank lines. (Obsidian renders
   this way by default; GitHub will join consecutive lines into a paragraph,
   which is still readable.)
2. **Lists are Markdown lists.** `- item` and `1. item` at column zero,
   nested by indenting two spaces. A list begins at column zero or at an
   even indent (a list nested with no item above it, from Tab on a first
   bullet); a line indented by an odd number of spaces stays text, so the
   `   → ` lines of imported notes are never turned into lists.
3. **Colour is inline HTML.** `<span style="color:#f66151">text</span>`,
   `<span style="background:#3d3846">text</span>`, or both separated by `;`.
   Colours are always 6-digit hex. This is the one thing plain Markdown
   cannot say, and every serious Markdown viewer passes it through.
4. **Code is a fenced block** with a highlight.js language id. The box always
   fits its content. Files written by older versions may carry a box height
   in the info string; it is kept but ignored, as other viewers do:

   ````
   ```x86asm h=160
   mov x0, #0
   ```
   ````

Inline marks, from outermost to innermost when nested:

| mark        | syntax                      |
|-------------|-----------------------------|
| colour      | `<span style="...">…</span>` |
| link        | `[text](url)`               |
| bold        | `**text**`                  |
| italic      | `*text*`                    |
| underline   | `<u>text</u>`               |
| strike      | `~~text~~`                  |
| monospace   | `` `text` ``                |

Headings are `#`–`######` followed by a space. Images stand alone on a line,
embedded as a data URI by default, `![](data:image/png;base64,…)`, or as a
relative file, `![](_assets/GRP-1.png)`. An image that was resized is written
as `<img src="…" width="420">`, which every Markdown viewer renders. Links to
other nodes are relative paths to the `.md` file, with spaces as `%20`.

## Escaping

Note4Me's parser recognises only the constructs above. Everything else is
literal text, so `| a | b |`, `> quote`, `---` and so on round-trip unchanged
(other viewers may render them as tables, quotes or rules, which is fine).

Characters that would otherwise be read as markup are escaped with a
backslash: `\* \` \\`, `\[` when a `](` follows on the line, `\]` before `(`,
`\_` when it would start a word, `\<` before a letter or `/`, `\~~`, and at
the start of a line `\#`, `\>`, `` \``` ``, `\-` and `1\.` when the line is
plain text rather than a list item.

## Converting from CherryTree

```
python3 tools/ctb2md.py ~/path/to/Notebook.ctb ~/Notes/Note4Me/Notebook
```

Close CherryTree first, or copy the `.ctb` and convert the copy, so the
database is not changing underneath the converter. The converter drops the
theme defaults (white foreground, black background) so the app theme decides
them, folds GTK's 16-bit colours to 6-digit hex, and maps GtkSourceView
language ids to highlight.js ids (`nasm` → `x86asm`, `sh` → `bash`). Lines
typed as `- item` or `1. item` in CherryTree become real lists. Images are
embedded; pass `--assets` to write them to `_assets/` instead.
