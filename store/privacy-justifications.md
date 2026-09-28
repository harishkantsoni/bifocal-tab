# Chrome Web Store — Privacy practices tab

Paste each block into the matching field on the item's **Privacy practices** tab.

## Single purpose

Bifocal Tab replaces the new tab page with a split view: a search engine's own page in one
half and a grid of speed-dial shortcuts, stored as real bookmarks, in the other. Everything
the extension does serves that single new tab page.

## Permission justifications

### bookmarks

The speed-dial grid *is* the user's bookmarks. Tiles are read from a single folder
("Bifocal Tab" under Other bookmarks); adding, renaming, reordering, grouping or deleting a
tile creates, updates, moves or removes the corresponding bookmark, and edits made in the
browser's own bookmark manager show up in the grid. Storing dials as bookmarks is what lets
them ride along with browser sync and survive a reinstall. Only that one folder is written
to. No bookmark data leaves the browser.

### storage

chrome.storage.local holds the small amount of state a bookmark cannot: which pane is on
which side, the split ratio, the selected search engine and any custom engine URLs, plus
custom icon URLs keyed by bookmark id and a few one-time migration flags. Local only; nothing
is transmitted.

### favicon

Each dial shows the site's icon. The favicon permission lets the new tab page read the icon
the browser has already cached for that URL (chrome://favicon2 via the /_favicon/ endpoint)
instead of fetching icons from a third-party favicon service, which would disclose the user's
shortcut list to that service. It is used for display only.

### declarativeNetRequestWithHostAccess

The search half of the page embeds the chosen search engine's own page in an iframe. Those
pages send X-Frame-Options and frame-ancestors headers that would blank the frame. A static
ruleset (rules.json) removes only those framing headers, only on sub_frame requests, and only
for the engine domains the user can pick (google.com, bing.com, duckduckgo.com, yahoo.com,
brave.com), plus one dynamic rule per custom engine the user adds. No request is blocked,
redirected or inspected, and no request body or content is read. The declarativeNetRequest
rules are declarative — the extension never sees the traffic.

### Host permissions

*://*.google.com/* is the default search engine's origin, required so the header-stripping
rule above may apply to it (declarativeNetRequestWithHostAccess only acts on hosts the
extension has access to). The other engines and any custom engine are declared as *optional*
host permissions: the extension asks for that one origin at the moment the user chooses that
engine, and only then. Host access is used solely to let the chosen engine's page render in
the frame; the extension injects no content scripts and reads no page data.

### Remote code

The extension executes no remote code. All JavaScript is bundled in the package; there is no
eval, no remotely loaded script or module, and no WebAssembly. The only remote content is the
search engine's own page displayed inside an iframe in the new tab page — that page runs in
its own origin and sandbox, exactly as it would in a normal tab, and the extension neither
reads from it nor injects into it.

## Data use certification

The extension collects no user data. Bookmarks, settings and icon URLs stay in the browser
profile; there is no server, no analytics and no network request made by the extension itself.
