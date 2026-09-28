# Privacy Policy — Bifocal Tab

**Last updated: 29 September 2026**

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
- **A custom tile icon**, if you set one, is fetched from the URL you entered, by the browser,
  when the tile is drawn.

The extension's network rules (`declarativeNetRequest`) only remove the framing headers
(`X-Frame-Options`, `Content-Security-Policy` frame directives) that would otherwise stop the
search engine's page from displaying in the frame. They apply only to sub-frame requests, only
on the engine domains you can select and any custom engine you add. They block nothing,
redirect nothing, and give the extension no visibility into the requests themselves.

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
