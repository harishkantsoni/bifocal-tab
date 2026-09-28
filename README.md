# Focus New Tab

A Chrome extension that replaces the new tab page with two vertical halves: Google search in
one, a drag-and-drop speed dial grid in the other.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this folder.
4. Open a new tab. Chrome shows a "Keep changes?" prompt the first time — accept it.

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

Search sits on the **right** by default. Groups dissolve on their own when they drop to one
member, the same way a phone home screen folder does.

Everything is stored in `chrome.storage.local`, so the layout survives restarts but stays on
this machine.

## How Google gets into the frame

Google sends `X-Frame-Options`, which normally blocks embedding, so two things are in play:

- The frame loads `https://www.google.com/webhp?igu=1`. The `igu=1` parameter is Google's own
  frame-friendly mode and does the work in most cases.
- `rules.json` is a `declarativeNetRequest` ruleset that strips `X-Frame-Options` and
  `Content-Security-Policy` from **sub-frame** responses on `google.com`. Host permissions are
  limited to `*://*.google.com/*`, so nothing else is touched.

If the frame ever comes up blank, hover the search half and use the **↗** button in its bottom
corner to open the page in a full tab, or point Settings → Search page URL at another engine
(DuckDuckGo and Bing both frame cleanly). There is deliberately no "it failed" timer: a slow
frame is not a blocked one, and Chrome reports an `X-Frame-Options` block as a `load` event
rather than an `error`, so any timeout-based guess produces false alarms.

One thing no extension can fix: Chrome puts the caret in the address bar when a new tab opens,
so the search box inside the frame is not focused. Click it, or just type in the address bar.

## Files

| File | Role |
| --- | --- |
| `manifest.json` | MV3 manifest, new tab override, permissions |
| `rules.json` | Header-stripping rules that let Google render in a frame |
| `newtab.html` | Page structure: two panes, group folder, modals |
| `newtab.css` | Layout, tiles, overlays, light and dark themes |
| `newtab.js` | State, storage, the pointer drag engine, grouping |
| `icons/` | Toolbar and store icons |

## Notes on the drag engine

Dragging is built on pointer events rather than HTML5 drag-and-drop: the tile itself is moved
around the grid as a live placeholder while a ghost clone follows the cursor, and the DOM order
is read back into state on drop. That is what makes a tile able to cross from the group folder
back out to the main grid in a single gesture. Dropping near the **centre** of another tile
merges; dropping toward an **edge** reorders.
