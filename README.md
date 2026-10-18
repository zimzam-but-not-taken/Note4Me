# Note4Me

**CherryTree's editing. Obsidian's files.**

![Note4Me: a node tree on the left, a note with coloured text and highlighted ARM64 code boxes on the right](Screenshot.png)

Note4Me is a hierarchical note app for technical notes, built to get a big
CherryTree notebook out of its `.ctb` database and into plain Markdown without
giving up the way CherryTree lets you write.

Markdown is king: files in a folder outlive any app, diff cleanly, and open in
Obsidian, VS Code or GitHub. But Markdown-only notes suck for the kind of
notes a pentester or engineer keeps. There is no text colour or highlight, no
real tree of nodes, every `*`, `_` and `#` inside a shell command fights the
syntax, and a code box is three backticks and a prayer. CherryTree gets all of
that right and stores it in a SQLite blob nobody else can read.

Note4Me is the happy medium: the notebook on disk is nothing but Markdown
files and folders, and the editor behaves like CherryTree.

## What it takes from each

| From CherryTree | From Obsidian |
|---|---|
| A tree of nodes, each with its own page, children in a folder beside it | Every note is a plain `.md` file; the notebook is a folder |
| Text colour and highlight on any run of text, keyboard-driven palette | Markdown as you type: `**bold**`, `` `code` ``, `- ` lists, fences |
| Syntax-highlighted code boxes you can type into like an editor | `[GOAL]`-style labels tinted inline |
| Bullets that look like the ones you typed by hand for years (`-`, `→`, `⇒`) | Readable anywhere, forever, without this app |
| One line is one line: Enter makes a new line, not a paragraph | Nothing hidden in a database |
| Linux muscle memory: ⌃C/⌃V, ⌃Z/⌃Y, ⇧⌥F/⇧⌥B for colours | |

Colour is the one thing Markdown cannot say, so it is written as
`<span style="color:#f66151">…</span>`, which every serious Markdown viewer
passes through. The full on-disk contract is in [FORMAT.md](FORMAT.md).

## Bring your CherryTree notes over

Close CherryTree (or copy the `.ctb` first, so it is not changing underneath
you), then:

```
python3 tools/ctb2md.py ~/Notes/Attack.ctb ~/Notes/Note4Me/Attack
```

Open that folder with **File ▸ Open Notebook…** (⌘O). The converter needs only
the Python standard library. It keeps the node tree, colours, code boxes and
images, drops the theme defaults (white on black) so the app theme decides
them, and turns lines typed as `- item` into real lists. Images are embedded
in the note by default; `--assets` writes them to `_assets/` instead.

## Build and run

macOS, Apple silicon. Electron, TipTap and esbuild; no server, no account.

```
npm install
npm start              # bundle and launch from the source tree
npm run install-app    # build Note4Me.app, install it in /Applications, relaunch
npm run package        # just build the .app into out/
```

The app is ad-hoc signed, so it runs on the machine that built it. Both the
app and `npm start` share one settings file at
`~/Library/Application Support/Note4Me/settings.json`. While developing,
`npm run watch` rebuilds the bundle on save; reload with ⌘R.

## Keys

Every shortcut can be changed in Settings › Keyboard: click one, press the
new keys. Backspace clears it, ↺ restores the default, and the switch at the
top turns all of them off.

| action | key |
|---|---|
| new node at the same level / new child node | ⇧⌘N / ⌘N |
| rename / delete node | F2 / ⌘⌫ (tree focused) |
| move node up / down | ⌥⌘↑ / ⌥⌘↓ |
| indent / outdent node | ⌥⌘→ / ⌥⌘← |
| previous / next node | ⌘↑ / ⌘↓ |
| bold / italic / underline / strike / mono | ⌘B / ⌘I / ⌘U / ⇧⌘X / ⌘E |
| text colour / highlight palette | ⇧⌥F / ⇧⌥B |
| re-apply last text colour / highlight | ⇧⌥G / ⇧⌥H |
| clear formatting | ⇧⌘\ |
| normal text / heading 1 / 2 / 3 | ⌥⌘0 / ⌥⌘1 / ⌥⌘2 / ⌥⌘3 |
| bullet / numbered list | ⇧⌘8 / ⇧⌘7 (Tab / ⇧Tab to nest, also on the first bullet) |
| code box | ⇧⌥⌘C (Tab indents, triple Enter or ↓ on the last line exits) |
| select next / previous word | ⌃⇧→ / ⌃⇧← |
| select to end / start of line | ⇧⌥↓ / ⇧⌥↑ |
| copy / cut / paste / select all, Linux style | ⌃C / ⌃X / ⌃V / ⌃A |
| undo / redo, Linux style | ⌃Z / ⌃Y (or ⌃⇧Z) |
| paste without formatting | ⌃⇧V or ⇧⌘V |
| find in note / find and replace / search all notes | ⌘F / ⌃H / ⇧⌘F |
| bigger / smaller / reset text | ⌘= / ⌘- / ⌘0 |
| settings | ⌘, |
| toggle tree | ⌘\ |

Right-click a node for the same tree operations.

## How the editor behaves

**Markdown while typing** (on by default; Settings › Editor or Format menu)
turns `**bold**`, `*italic*`, `` `code` ``, `~~strike~~` and ```` ``` ````
fences into formatting as you type, reads pasted plain text as Markdown, and
tints bracket labels such as `[GOAL]`. `# ` deliberately stays text, so
`#### Section ####` title lines work; headings are ⌥⌘1–3. Switch it off for a
note full of regexes. `- ` and `1. ` lists always work.

**Bullets** render as `-`, then `→`, then `⇒` when nested (then `•`, `◇`,
`▪`), the way CherryTree notes tend to be typed by hand. The file still says
`- `. Tab on the first bullet of a list indents it too.

**Colours stop where the coloured text stops.** Typing after a coloured run,
or on the next line, is back to normal; editing inside a coloured word keeps
its colour; a colour picked with nothing selected applies to what you type
next. "Colour carries on while typing" in Settings › Editor restores the usual
editor behaviour.

**Code boxes** highlight with highlight.js, auto-detect their language when
none is chosen, and grow with their content. ↓ on the last line or ↑ on the
first leaves the box with one press.

**Find and replace** (⌃H) replaces the current match on Enter or every match
on ⌘Enter, keeps the formatting of what it replaces, scrolls each match to
mid-screen, and with "Drop emptied lines" on also removes a line (or bullet)
that a replacement leaves blank.

**Search** at the top of the tree searches the contents of every note and
lists matching lines grouped by note; Enter on a hit jumps to it. Toggles for
case, regular expressions, and title-only filtering.

**Images** pasted from the clipboard are embedded in the note, so the folder
holds nothing but notes (switch to `_assets/` files in Settings). Drag the
edges or corner to resize; Shift keeps proportions; double-click resets.

**Export** right-click a node › Export as Markdown writes it and its children
as plain Markdown for people who do not have the app: colours stripped,
images as files, titles as headings.

**Themes**: Modern dark and light, Classic dark and light (light tree, black
editor), Dracula, Nord, Solarized, or a custom palette where every surface
colour is yours. Window transparency, tree icon styles and brightness, spell
check with a right-click dictionary.

## Layout

```
src/main/main.js        Electron main: notebook folder I/O, node ops, menus, nb:// protocol
src/main/preload.js     IPC bridge exposed as window.api
src/shared/shortcuts.js every shortcut, shared by the menu, the window and Settings
src/renderer/app.js     tree, toolbar, editor extensions and commands
src/renderer/md.js      Markdown <-> ProseMirror (the format contract)
src/renderer/styles.css themes and layout
src/renderer/settings.* the Settings window
tools/ctb2md.py         CherryTree .ctb -> Markdown tree
build/                  icon, packaging and install scripts
```

Headless checks while developing: `NOTE4ME_HIDDEN=1 NOTE4ME_SHOT=out.png
NOTE4ME_SHOT_JS='…' npx electron .` opens the app without showing a window,
runs the script in the page, logs its return value as `shot js:` and exits.

## Status

Built for one person's notebook and used daily. macOS only for now, English
only, no sync, no plugins. If it breaks your notes they are still Markdown
files in a folder, which was the point.
