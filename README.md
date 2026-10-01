# Bifocal Tab

A Chrome/Edge extension that replaces the new tab page with two vertical halves: a search
engine's own page in one, a drag-and-drop speed dial grid in the other. The dials are stored
as real bookmarks.

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
contents with it.

A group that drops to **one** item dissolves itself, the way a phone home screen folder does:
the last bookmark moves back out to where the folder sat, and the empty folder is deleted. That
check runs only straight after you move or remove something — never on a plain page load — so
merely opening a new tab will not restructure a one-bookmark folder you made by hand.

If you had dials from the pre-bookmark version, they are copied into the folder once, on first
run, and the old copy is left untouched as a backup. If the extension has run under an earlier
name, its existing folder is renamed in place rather than replaced, so a rename never orphans
your dials.

## Using it

| Action | How |
| --- | --- |
| Add a shortcut | **+ Add**, or drag a link out of the search results onto the dial half |
| Open a shortcut | Click it — a new tab by default. Ctrl/Shift/middle-click is always a new tab |
| Move a shortcut | Drag it to any slot in the grid |
| Make a group | Drop one shortcut **onto another shortcut’s icon** — the icon lights up when it will merge |
| Add to a group | Drop a shortcut onto the group tile’s icon |
| Open a group | Click it. Click its name to rename |
| Take one out | Open the group, drag the tile outside the box. Down to one item, the group dissolves |
| Edit / remove | Right-click a tile |
| Search | Use the engine's own box, in the search half |
| Change engine | Settings → Search engine |
| Add your own engine | Settings → Search engine → **+ Add a search engine…** |
| Open shortcuts in this tab instead | Settings → **Open shortcuts in** → The current tab |
| Move the search half | The **⇄** button, or Settings → Search pane side |
| Resize the halves | Drag the divider; double-click it to reset to 50/50 |

Search sits on the **right** by default, and a shortcut opens in a **new tab** — the new tab
page stays where it is, which is the point of having the dials and the search side by side.

## Search engines

Settings → **Search engine** picks which engine's page fills the search half. Five are built
in: Google, Bing, DuckDuckGo, Yahoo and Brave Search. There is no search box of this
extension's own anywhere — the pane *is* the engine's site, with its own box, its own
suggestions and its own results.

**+ Add a search engine…** at the bottom of the list takes a name and the address of any page
you want framed. Added engines sit under **Yours**, and a **Remove** button appears whenever
one is selected. Removing the engine in use falls back to Google rather than leaving the
setting pointing at nothing.

## Why Chrome asks for permission when you switch

Engines block framing, and they all do it differently. Measured response headers:

| Engine | Framing header |
| --- | --- |
| Google | `X-Frame-Options: SAMEORIGIN` |
| `google.com/webhp?igu=1` | none |
| Bing | `X-Frame-Options: SAMEORIGIN` |
| DuckDuckGo | `X-Frame-Options: SAMEORIGIN`, `frame-ancestors 'self'` |
| Yahoo | `X-Frame-Options: DENY`, `frame-ancestors 'none'` |
| Brave, Startpage, Ecosia | `X-Frame-Options: SAMEORIGIN`, `frame-ancestors 'self'` |

Google is the odd one out: it publishes an embeddable build of itself at `/webhp?igu=1` that
frames with no header at all. The pane does **not** use it — see *Why the pane is signed in*
below — so Google's SAMEORIGIN needs stripping like everyone else's.

So showing an engine's page means stripping those headers for that site, and stripping headers
for a site means holding a host permission for it. Rather than ask for all five up front, only
Google — the default — is granted at install. Choosing any other engine triggers Chrome's own
permission prompt for that one site, and adding a custom engine prompts for its site. Decline
and nothing changes: the dropdown snaps back and says so.

If an engine was somehow saved without access — or access is later withdrawn from
`chrome://extensions` — the frame half says so and offers a **Grant access** button.
That button exists because re-picking the engine already showing in the dropdown fires no
`change` event, so there would otherwise be no gesture left to ask with.

One implementation note worth keeping: `chrome.permissions.request()` must be *called*
synchronously inside the click or change handler. Awaiting anything first — even a
`permissions.contains()` check to avoid a redundant prompt — spends the user activation, and
the call then throws instead of prompting. There is no pre-check for exactly that reason, and
none is needed: an origin that is already granted resolves `true` without showing a prompt.

`rules.json` is a `declarativeNetRequest` ruleset naming the five built-in domains, and each
custom engine gets a dynamic rule of its own. Both strip `X-Frame-Options` and
`Content-Security-Policy` from **sub-frame** responses only. Because the manifest asks for
`declarativeNetRequestWithHostAccess` rather than plain `declarativeNetRequest`, a rule whose
domain has not been granted never fires — the ruleset cannot reach further than the
permissions you have actually approved.

Two things worth knowing. Stripping a site's CSP removes more than its framing rule, which is
a real reduction in that page's own defences — it is the price of embedding a site that does
not want to be embedded. And headers are not the only defence: an engine that busts frames in
JavaScript, or simply serves a degraded page to an embedded client, will still do so. If a
frame comes up blank or broken, hover the half and use the **↗** button in its bottom corner
to open the engine in a full tab.

There is deliberately no "it failed" timer: a slow frame is not a blocked one, and the browser
reports an `X-Frame-Options` block as a `load` event rather than an `error`, so any
timeout-based guess produces false alarms.

One thing no extension can fix: the browser puts the caret in the address bar when a new tab
opens, so the search box inside the frame is not focused. Click it, or type in the address bar.

## Why the pane is signed in

Google's `/webhp?igu=1` is the address every "embed Google in an iframe" recipe reaches for: it
frames without a fight. The catch is that it is the guest build. It is *permanently* signed out
— no avatar, no apps menu, no personalisation — and that is not a cookie problem you can fix,
it is what the page is for.

So the pane loads the plain `https://www.google.com/` and strips SAMEORIGIN like any other
engine. The session comes with it, and your avatar appears.

There is deliberately no "are you signed in?" check behind that. The frame is cross-origin, so
whether an avatar drew is not something this page can see — and it does not need to be. The pane
is a third-party frame, so Google receives only the `SameSite=None` half of your session, which
is enough for the avatar; the `SameSite=Lax` cookies (`SID`, `__Secure-1PSID`) never travel to a
cross-site frame and no extension can make them. When those third-party cookies are blocked,
Google serves its own signed-out page. The fallback is Google's, not ours, which is why there is
no code here implementing one.

Two consequences worth stating. Searches run in the pane can be tied to your Google account, the
way they would be in a normal tab — `igu=1` used to prevent that as a side effect of being the
guest build. And the pane's signed-in state depends on *your* third-party-cookie setting, so it
is not the same for everybody.

## Why results open in a tab instead of the pane

The header stripping above covers the engine and stops there. Follow a result and the pane
leaves the engine for somewhere with no rule of its own, and most of the web refuses to be
framed: `leetcode.com` and `github.com` both answer `X-Frame-Options: DENY`, so Chrome paints
"refused to connect" where the page should be.

Covering that would mean stripping the header with no domain condition at all — access to
every site, and the clickjacking defence off each one. Those headers are what stop a page
framing your bank and harvesting your clicks, and that seemed a poor trade for not having to
switch tabs. So a result is handed to a real tab instead, opened next to the one it came from,
and the pane goes back to your results.

The pane cannot see this happening on its own: it is cross-origin, so its links, location and
history are all unreadable from the page holding it. `webNavigation` is the only thing that
will say where the frame is being sent, which is why Chrome warns about reading browsing
history at install. The address is used for that one decision and discarded —
[PRIVACY.md](PRIVACY.md) has the detail.

**Every** result leaves, whoever owns it. Matching on the host alone would have let a result
pointing at `maps.google.com` or `support.google.com` load in the pane while the identical
click on `leetcode.com` opened a tab, and a rule you cannot predict from looking at a link is
worse than either behaviour on its own. So the pane keeps the engine's *search surface* — its
own page, the site root, and `/search`, which covers every built-in engine's results, Google's
images, news and video tabs, and every page past the first — and everything else is a
destination.

Some test is unavoidable at this point. Submitting a search is a frame navigation exactly like
clicking a result, and Chrome reports both as `manual_subframe`, so with nothing to tell them
apart the pane would fire off a tab the moment you searched and could never show results at
all.

Two rough edges. A result that redirects through the engine (`google.com/url?q=…`) is caught on
the hop that actually leaves, so the handoff can lag a redirect behind. And putting the pane
back re-requests the results page, which loses your scroll position in it.

Speed-dial tiles have their own setting — Settings → **Open shortcuts in** — and default to a
new tab for the same reason a result does: the page you were on keeps its place. Set it to
*The current tab* to have a tile navigate away instead. Ctrl, Shift and middle-click still
force a new tab either way, as they do anywhere else in the browser.

## Permissions

| Permission | Why |
| --- | --- |
| `bookmarks` | The dial grid *is* a bookmark folder |
| `storage` | Pane layout, chosen and custom search engines, custom icon URLs |
| `favicon` | Tile icons from the browser's own favicon cache — no external requests |
| `declarativeNetRequestWithHostAccess` + `*://*.google.com/*` | Strip frame-blocking headers on sub-frames, so the chosen engine renders. Google is granted at install as the default |
| `optional_host_permissions` | Requested one site at a time, only when you pick another engine or add your own |
| `webNavigation` | The only way to learn where the cross-origin pane is being sent, so a clicked result can be handed to a real tab. Read at the moment of the click and discarded |

Nothing is collected or sent anywhere — see [PRIVACY.md](PRIVACY.md).

## Files

| File | Role |
| --- | --- |
| `manifest.json` | MV3 manifest, new tab override, permissions |
| `rules.json` | Header-stripping rules that let the chosen engine render in a frame |
| `newtab.html` | Page structure: two panes, group folder, modals |
| `newtab.css` | Layout, tiles, overlays, light and dark themes |
| `store.js` | Bookmark tree ↔ dial model, search engines, permissions, settings, live change events |
| `newtab.js` | Rendering, the pointer drag engine, menus and modals |
| `icons/` | Toolbar and store icons |

## Notes on the drag engine

Dragging is built on pointer events rather than HTML5 drag-and-drop: the tile itself is moved
around the grid as a live placeholder while a ghost clone follows the cursor. On drop, the DOM
order is read back and translated into `chrome.bookmarks.move` calls. That is what lets a tile
cross from the group folder back out to the main grid in one gesture. Dropping on another
tile's **icon** merges; dropping anywhere else on it reorders.

Two things that are easy to get wrong here, both learned the hard way:

- **No `setPointerCapture` on the dragged tile.** Chrome releases pointer capture as soon as a
  captured element is reparented, and this engine reparents the dragged tile constantly. The
  capture died on the first reorder, `pointerup` went elsewhere, and every drag leaked its
  ghost onto the page. Document-level listeners survive reparenting; capture does not.
- **Reorders need a settle delay.** Each one reflows the grid under a stationary cursor, which
  can shove the tile you were aiming at out from under it and oscillate. A 120 ms floor between
  reorders stops that, and the merge zone is the icon box so it never overlaps the reorder zone.

Reordering places children one at a time in ascending index order. That converges whether the
browser interprets a same-parent move index against the list with the node still in it or
without — the classic off-by-one in `bookmarks.move`.
