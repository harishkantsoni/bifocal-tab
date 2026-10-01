# Privacy Policy — Bifocal Tab

**Last updated: 1 October 2026**

Bifocal Tab is a browser extension that replaces the new tab page. It has no server, no
account, and no analytics. Nothing you do in it is sent to the developer, because there is
nowhere for it to be sent.

## What the extension stores, and where

Everything stays inside your own browser profile.

| What | Where it lives |
| --- | --- |
| Your shortcuts and groups — title, URL, order | Real bookmarks, in a single folder named **Bifocal Tab** under *Other bookmarks* |
| Pane side, split ratio, chosen search engine, any custom engine you add | `chrome.storage.local` |
| Custom icon URLs you set, keyed by bookmark id | `chrome.storage.local` |
| First-run and migration flags | `chrome.storage.local` |

Because your shortcuts are ordinary bookmarks, they are covered by your browser's own sync
settings and by your browser's privacy controls. If you have browser sync turned on, they sync
the same way the rest of your bookmarks do — between your own devices, under your own browser
account, not through anything the extension operates.

Uninstalling the extension removes the `chrome.storage.local` data. It deliberately leaves the
bookmark folder in place, so your shortcuts survive a reinstall; delete that folder yourself if
you want it gone.

## What the extension reads

- **Bookmarks.** It reads and writes the *Bifocal Tab* folder to draw and edit the dial grid.
  It reads the wider bookmark tree only to locate that folder. It does not modify bookmarks
  outside it, and does not transmit any bookmark anywhere.
- **Cached favicons.** Shortcut icons come from the icon your browser has already cached for
  that site, read locally through the `favicon` permission. The extension does not use a
  third-party favicon service, which would otherwise reveal your list of shortcuts to that
  service.

## Network requests

The extension itself makes no network requests. Two things on the page do cause traffic, and
both go to sites you chose:

- **The search pane** loads the search engine you selected — Google by default — in an iframe.
  That page loads directly from the engine with your normal browser cookies, exactly as it
  would in any other tab, and that engine's own privacy policy applies to it. The extension
  does not read the frame's contents, inject scripts into it, or observe what you type or
  search for.

  Because the pane is the engine's real page and not a stripped-down copy, **you may be signed
  in inside it**, and searches you run there may be associated with that account by the engine,
  exactly as they would be in a normal tab. The pane is a third-party frame, so the engine
  receives only the cookies a third-party frame is allowed — which is usually enough for your
  avatar to appear. If your browser blocks third-party cookies, the engine will serve you its
  signed-out page instead. Either way this is a matter between you and the engine: the
  extension neither sends nor reads those cookies, and cannot see which of the two you got.
- **Clicking a result** opens it in a normal tab rather than inside the pane, because most
  sites refuse to be framed at all. See *Browsing history* below for how the extension knows
  where the pane was being sent.
- **A custom tile icon**, if you set one, is fetched from the URL you entered, by the browser,
  when the tile is drawn.

The extension's network rules (`declarativeNetRequest`) remove the headers that would otherwise
stop the search engine's page from displaying in the frame: `X-Frame-Options`, `Frame-Options`
and `Content-Security-Policy`. They apply only to sub-frame requests, only on the engine domains
you can select and any custom engine you add. They block nothing, redirect nothing, and give the
extension no visibility into the requests themselves.

`Content-Security-Policy` is removed in full rather than just its framing directive, because a
header rule cannot edit one directive out of a header — the only way to drop `frame-ancestors`
is to drop the header carrying it. That does weaken the engine page's own protections inside the
pane, and it is the unavoidable cost of embedding a page that asks not to be embedded. It
applies to the engine page you chose, in the frame, and to no other site.

## Browsing history

Chrome warns that this extension can "read your browsing history", which is the warning
attached to the `webNavigation` permission. What the extension actually does with it is narrow,
and worth stating plainly.

The search pane is a cross-origin frame, so nothing inside it is readable from the extension's
page — not its links, not its location, not its history. When you click a search result, the
only way the extension can learn where the pane is being sent is to ask the browser.
`webNavigation` is that question. The answer is used for one decision, taken immediately: if
the destination is not the search engine itself, it is opened in a normal tab and the pane is
put back on your results.

That address is used at the moment of the click and then discarded. It is not stored, not
written to disk, not aggregated, and not sent anywhere — there is no server to send it to. The
extension does not consult navigation events for any other tab, and ignores every event that
is not the search pane in the tab it is running in.

The alternative to this permission would have been to strip the `X-Frame-Options` and
`Content-Security-Policy` headers from every site the pane touched, so that results could be
displayed inside it. That was rejected deliberately: those headers are what stop a page from
framing your bank and stealing your clicks, and removing them across the web is a far larger
imposition than reading one address and forgetting it.

## Host permissions

`*://*.google.com/*` is granted up front because Google is the default engine and the framing
rule can only act on a host the extension has access to. Every other engine is optional: the
extension asks for that single origin at the moment you pick that engine, and never requests
broader access on its own.

## Data collection, sale and sharing

The developer collects **no** user data — not personal information, not browsing history, not
search terms, not bookmarks, not analytics or crash reports. Nothing is sold, shared,
transferred, or used for advertising, credit assessment, or lending, and nothing is used for
any purpose unrelated to the extension's single purpose.

## Changes

Material changes to this policy will be published in this file in the extension's public
repository, with the date above updated.

## Contact

Harish Soni — soniharishkant@gmail.com
Source and issue tracker: https://github.com/harishkantsoni/bifocal-tab
