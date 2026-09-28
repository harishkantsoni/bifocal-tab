# Bifocal Tab

A Chrome/Edge extension that replaces the new tab page with two vertical halves: Google search
in one, a drag-and-drop speed dial grid in the other. The dials are stored as real bookmarks.

## Install

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and pick this folder.
4. Open a new tab. The browser asks to confirm the new tab change the first time — accept it.

## Where your dials live

Everything in the dial grid is a bookmark under a single folder:

```
Other bookmarks/
└── Bifocal Tab/
    ├── GitHub                  ← a bookmark is a dial
    ├── Gmail
    └── Work/                   ← a folder is a group
        ├── Jira
        └── Confluence
```

This is a two-way arrangement. Reordering tiles moves bookmarks, dragging one tile onto another
creates a real folder, and edits you make in the bookmark manager appear in the grid without a
reload. It also means your dials ride along with browser sync and survive reinstalling the
extension.

Two things bookmarks cannot hold stay in `chrome.storage.local`: the pane layout (side, split
ratio, search URL) and any custom icon URLs, which are keyed by bookmark id.

**Deleting a tile deletes the bookmark.** Removing a group asks first, since that takes its
contents with it. Nothing is ever deleted automatically — an emptied group stays put until you
remove it yourself.

If you had dials from the pre-bookmark version, they are copied into the folder once, on first
run, and the old copy is left untouched as a backup. If the extension has run under an earlier
name, its existing folder is renamed in place rather than replaced, so a rename never orphans
your dials.

## Using it

| Action | How |
| --- | --- |
| Add a shortcut | **+ Add**, or drag a link out of the search results onto the dial half |
| Open a shortcut | Click it. Ctrl/Shift/middle-click opens a new tab |
| Move a shortcut | Drag it to any slot in the grid |
| Make a group | Drag one shortcut onto another — like dropping an app on an app |
| Add to a group | Drag a shortcut onto the group tile |
| Open a group | Click it. Click its name to rename |
| Take one out | Open the group, drag the tile outside the box |
| Edit / remove | Right-click a tile |
| Move the search half | The **⇄** button, or Settings → Search pane side |
| Resize the halves | Drag the divider; double-click it to reset to 50/50 |

Search sits on the **right** by default.

## How Google gets into the frame

Google sends `X-Frame-Options` on its normal pages, which blocks embedding, so two things are
in play:

- The frame loads `https://www.google.com/webhp?igu=1`. The `igu=1` parameter is Google's own
  frame-friendly mode and does the work in most cases.
- `rules.json` is a `declarativeNetRequest` ruleset that strips `X-Frame-Options` and
  `Content-Security-Policy` from **sub-frame** responses on `google.com`. Host permissions are
  limited to `*://*.google.com/*`, so nothing else is touched.

If the frame ever comes up blank, hover the search half and use the **↗** button in its bottom
corner to open the page in a full tab, or point Settings → Search page URL at another engine
(DuckDuckGo and Bing both frame cleanly). There is deliberately no "it failed" timer: a slow
frame is not a blocked one, and the browser reports an `X-Frame-Options` block as a `load` event
rather than an `error`, so any timeout-based guess produces false alarms.

One thing no extension can fix: the browser puts the caret in the address bar when a new tab
opens, so the search box inside the frame is not focused. Click it, or type in the address bar.

## Permissions

| Permission | Why |
| --- | --- |
| `bookmarks` | The dial grid *is* a bookmark folder |
| `storage` | Pane layout and custom icon URLs |
| `favicon` | Tile icons from the browser's own favicon cache — no external requests |
| `declarativeNetRequestWithHostAccess` + `*://*.google.com/*` | Strip frame-blocking headers on google.com sub-frames only |

## Files

| File | Role |
| --- | --- |
| `manifest.json` | MV3 manifest, new tab override, permissions |
| `rules.json` | Header-stripping rules that let Google render in a frame |
| `newtab.html` | Page structure: two panes, group folder, modals |
| `newtab.css` | Layout, tiles, overlays, light and dark themes |
| `store.js` | Bookmark tree ↔ dial model, settings, live change events |
| `newtab.js` | Rendering, the pointer drag engine, menus and modals |
| `icons/` | Toolbar and store icons |

## Notes on the drag engine

Dragging is built on pointer events rather than HTML5 drag-and-drop: the tile itself is moved
around the grid as a live placeholder while a ghost clone follows the cursor. On drop, the DOM
order is read back and translated into `chrome.bookmarks.move` calls. That is what lets a tile
cross from the group folder back out to the main grid in one gesture. Dropping near the
**centre** of another tile merges; dropping toward an **edge** reorders.

Reordering places children one at a time in ascending index order. That converges whether the
browser interprets a same-parent move index against the list with the node still in it or
without — the classic off-by-one in `bookmarks.move`.
