/* Bookmark-backed store for Bifocal Tab.
 *
 * The bookmark tree is the source of truth for dials and groups: a bookmark is a dial,
 * a folder is a group. Anything bookmarks cannot express — pane layout, custom tile
 * icons — lives in chrome.storage.local alongside it.
 */

export const ROOT_TITLE = 'Bifocal Tab';

/* Folder titles this extension has shipped under. An existing folder is retitled in
 * place rather than abandoned, so a rename never orphans somebody's dials. */
const LEGACY_TITLES = ['Minimal New Tab', 'Focus New Tab'];
/* Search engines.
 *
 * `url` is the engine's own page, loaded straight into the frame — there is no search box
 * of our own anywhere in this extension. `origin` is stated rather than derived, because
 * several of these search from a subdomain and the permission has to line up with the
 * registrable domain the ruleset keys on.
 *
 * Every engine except Google refuses to be framed (measured: Bing, Brave and DuckDuckGo
 * answer X-Frame-Options: SAMEORIGIN, Yahoo answers DENY, and most add frame-ancestors on
 * top). `rules.json` strips those headers, but only on domains the user has actually
 * granted: the manifest asks for declarativeNetRequestWithHostAccess, so a rule whose
 * domain has no host permission simply never fires. Google ships as a granted origin
 * because it is the default; the rest are requested the moment they are chosen. */
export const ENGINES = [
  { id: 'google',     name: 'Google',       url: 'https://www.google.com/webhp?igu=1', origin: '*://*.google.com/*' },
  { id: 'bing',       name: 'Bing',         url: 'https://www.bing.com/',              origin: '*://*.bing.com/*' },
  { id: 'duckduckgo', name: 'DuckDuckGo',   url: 'https://duckduckgo.com/',            origin: '*://*.duckduckgo.com/*' },
  { id: 'yahoo',      name: 'Yahoo',        url: 'https://search.yahoo.com/',          origin: '*://*.yahoo.com/*' },
  { id: 'brave',      name: 'Brave Search', url: 'https://search.brave.com/',          origin: '*://*.brave.com/*' }
];

export const CUSTOM_PREFIX = 'custom:';
export const isCustomEngine = (id) => String(id || '').startsWith(CUSTOM_PREFIX);

/* Dynamic rules start well clear of the static ruleset's ids. */
const CUSTOM_RULE_BASE = 1000;
const STRIP_HEADERS = [
  { header: 'x-frame-options', operation: 'remove' },
  { header: 'frame-options', operation: 'remove' },
  { header: 'content-security-policy', operation: 'remove' },
  { header: 'content-security-policy-report-only', operation: 'remove' }
];

const DEFAULT_SETTINGS = {
  searchSide: 'right',
  splitRatio: 0.5,
  engineId: 'google',
  customEngines: [],      // { id, name, url }
  openInNewTab: true      // a tile is somewhere you meant to go; the new tab page stays put
};

/* Seeded into the bookmark folder the first time the extension runs, so a fresh
 * install opens onto something rather than an empty grid. They are ordinary
 * bookmarks from that moment on: renaming, regrouping or deleting them sticks. */
const DEFAULT_ITEMS = [
  {
    type: 'group',
    title: 'AI tools',
    items: [
      { title: 'Claude', url: 'https://claude.ai' },
      { title: 'ChatGPT', url: 'https://chatgpt.com' },
      { title: 'Gemini', url: 'https://gemini.google.com' }
    ]
  },
  {
    type: 'group',
    title: 'Social Media',
    items: [
      { title: 'Facebook', url: 'https://www.facebook.com' },
      { title: 'X', url: 'https://x.com' },
      { title: 'Instagram', url: 'https://www.instagram.com' },
      { title: 'Reddit', url: 'https://www.reddit.com' },
      { title: 'LinkedIn', url: 'https://www.linkedin.com' }
    ]
  },
  { title: 'Wikipedia', url: 'https://www.wikipedia.org' },
  { title: 'Yahoo', url: 'https://www.yahoo.com' }
];

let rootId = null;
let settings = { ...DEFAULT_SETTINGS };
let icons = {};                 // bookmarkId -> custom icon URL
let groupSizes = {};            // folderId -> children last seen, to spot a folder that shrank
let items = [];                 // derived view of the root folder's children
const lastOrder = new Map();    // parentId -> comma-joined child ids, to skip no-op reorders
const changeListeners = new Set();

/* ------------------------------------------------------------------ helpers */
export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url || ''; }
}

/* Built-ins first, then whatever the user added. */
export function allEngines() {
  return [...ENGINES, ...(settings.customEngines || [])];
}

export function engineById(id) {
  return allEngines().find((e) => e.id === id) || ENGINES[0];
}

/* The host permission an engine needs before its framing headers can be stripped.
 * Built-ins carry theirs; a custom engine gets its own host and anything under it. */
export function originOf(engine) {
  if (engine.origin) return engine.origin;
  try { return `*://*.${new URL(engine.url).hostname}/*`; } catch { return null; }
}

export const hasAccess = (engine) =>
  chrome.permissions.contains({ origins: [originOf(engine)] });

/* Must be called straight from a click or change handler; Chrome refuses a permission
 * request that is not attached to a user gesture. */
export const requestAccess = (engine) =>
  chrome.permissions.request({ origins: [originOf(engine)] });

/* A usable engine page is just an http(s) address. */
export function validateEngineUrl(raw) {
  const url = normalizeUrl(raw);
  if (!url) return { error: 'That is not a valid address.' };
  if (!/^https?:$/.test(new URL(url).protocol)) return { error: 'Use an http or https address.' };
  return { url };
}

/* The static ruleset names the built-in engines. Anything the user adds needs a rule of
 * its own, rewritten as a set so a removed engine never leaves its rule behind. */
async function syncCustomRules() {
  const customs = settings.customEngines || [];
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((r) => r.id),
    addRules: customs.map((e, i) => ({
      id: CUSTOM_RULE_BASE + i,
      priority: 1,
      action: { type: 'modifyHeaders', responseHeaders: STRIP_HEADERS },
      condition: { requestDomains: [new URL(e.url).hostname], resourceTypes: ['sub_frame'] }
    }))
  });
}

export function normalizeUrl(raw) {
  const s = (raw || '').trim();
  if (!s) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^(about|chrome|edge|file):/i.test(s)
    ? s
    : 'https://' + s;
  try { return new URL(withScheme).href; } catch { return null; }
}

const OTHER_ID_GUESS = '2';

/** The "Other bookmarks" node. Its id is '2' in Chrome and Edge, but never assume. */
async function otherBookmarksId() {
  try {
    await chrome.bookmarks.getChildren(OTHER_ID_GUESS);
    return OTHER_ID_GUESS;
  } catch {
    const [tree] = await chrome.bookmarks.getTree();
    const roots = tree.children || [];
    const other = roots.find((r) => r.id !== '1') || roots[0];
    return other.id;
  }
}

async function adopt(node) {
  if (node.title !== ROOT_TITLE) await chrome.bookmarks.update(node.id, { title: ROOT_TITLE });
  await chrome.storage.local.set({ rootId: node.id });
  return { id: node.id, created: false };
}

async function resolveRoot() {
  const saved = await chrome.storage.local.get('rootId');
  if (saved.rootId) {
    try {
      const [node] = await chrome.bookmarks.get(saved.rootId);
      if (node && !node.url) return adopt(node);
    } catch { /* folder was deleted; fall through and make a new one */ }
  }

  const parentId = await otherBookmarksId();
  const children = await chrome.bookmarks.getChildren(parentId);
  const existing = children.find(
    (c) => !c.url && (c.title === ROOT_TITLE || LEGACY_TITLES.includes(c.title))
  );
  if (existing) return adopt(existing);

  const made = await chrome.bookmarks.create({ parentId, title: ROOT_TITLE });
  await chrome.storage.local.set({ rootId: made.id });
  return { id: made.id, created: true };
}

/* -------------------------------------------------------------- tree → view */
function toItem(node) {
  if (node.url) {
    return {
      id: node.id,
      type: 'dial',
      title: node.title || hostOf(node.url),
      url: node.url,
      icon: icons[node.id]
    };
  }
  /* Last resort for a folder with nothing in it: draw no tile rather than a blank one.
   * A group drained of bookmarks is normally unwound before this (see dissolveThinGroups);
   * what reaches here is a folder that never held two, such as one created empty in the
   * bookmark manager, and deleting that behind somebody's back is not ours to do. It
   * reappears as a tile the moment it holds a bookmark again. */
  const kids = (node.children || []).map(toItem).filter(Boolean);
  if (!kids.length) return null;

  return {
    id: node.id,
    type: 'group',
    title: node.title || 'Group',
    items: kids
  };
}

function rememberOrder(node) {
  if (node.url) return;
  lastOrder.set(node.id, (node.children || []).map((c) => c.id).join(','));
  for (const child of node.children || []) rememberOrder(child);
}

/* How many bookmarks each group held when we last looked. Kept on disk because the
 * deletion that drains a group often happens with no new tab page open to see it. */
function collectSizes(node, out) {
  if (node.url) return out;
  if (node.id !== rootId) out[node.id] = (node.children || []).length;
  for (const child of node.children || []) collectSizes(child, out);
  return out;
}

async function rememberSizes(subtree) {
  const next = collectSizes(subtree, {});
  const same = Object.keys(next).length === Object.keys(groupSizes).length
    && Object.keys(next).every((id) => groupSizes[id] === next[id]);
  groupSizes = next;
  if (!same) await chrome.storage.local.set({ groupSizes });
}

async function readTree() {
  let subtree;
  try {
    [subtree] = await chrome.bookmarks.getSubTree(rootId);
  } catch {
    const fresh = await resolveRoot();   // folder vanished under us
    rootId = fresh.id;
    [subtree] = await chrome.bookmarks.getSubTree(rootId);
  }

  // A group drained outside the extension is unwound here, whether the deletion landed
  // while a new tab watched it or while none was open.
  if (await dissolveThinGroups({ shrunkOnly: true })) {
    [subtree] = await chrome.bookmarks.getSubTree(rootId);
  }

  lastOrder.clear();
  rememberOrder(subtree);
  await rememberSizes(subtree);
  items = (subtree.children || []).map(toItem).filter(Boolean);
  return items;
}

/* ------------------------------------------------------------------ lookups */
export function locate(id, list = items) {
  const i = list.findIndex((it) => it.id === id);
  if (i !== -1) return { list, index: i, item: list[i] };
  for (const item of list) {
    if (item.type === 'group') {
      const hit = locate(id, item.items);
      if (hit) return hit;
    }
  }
  return null;
}

export function find(id) {
  const hit = locate(id);
  return hit ? hit.item : null;
}

/* ----------------------------------------------------------------- mutation */
/** Place ids as the children of parentId, in order. Ascending moves converge
 *  regardless of how the browser interprets a same-parent move index. */
async function placeAll(parentId, ids) {
  if (lastOrder.get(parentId) === ids.join(',')) return;
  for (let i = 0; i < ids.length; i++) {
    await chrome.bookmarks.move(ids[i], { parentId, index: i });
  }
  lastOrder.set(parentId, ids.join(','));
}

async function mergeInto(dragId, targetId) {
  const [target] = await chrome.bookmarks.get(targetId);
  if (!target) return;

  if (!target.url) {                       // already a group: just drop it in
    await chrome.bookmarks.move(dragId, { parentId: targetId });
    return;
  }
  const folder = await chrome.bookmarks.create({
    parentId: target.parentId,
    index: target.index,
    title: 'Group'
  });
  await chrome.bookmarks.move(targetId, { parentId: folder.id, index: 0 });
  await chrome.bookmarks.move(dragId, { parentId: folder.id, index: 1 });
}

/** Android-style: a folder that falls to one member stops being a folder. The last
 *  bookmark moves back out to where the folder sat, and the empty folder is removed.
 *
 *  Deepest folders go first, so nesting unwinds from the inside out.
 *
 *  `shrunkOnly` is the pass a plain read is allowed to make: it touches a folder only
 *  where the recorded size says it used to hold two or more, so a deletion made in the
 *  bookmark manager still unwinds, while a one-bookmark folder somebody built by hand is
 *  left exactly as they left it. Our own mutations run the unrestricted pass. */
function firstThinFolder(node, shrunkOnly) {
  for (const child of node.children || []) {
    if (child.url) continue;
    const deeper = firstThinFolder(child, shrunkOnly);
    if (deeper) return deeper;
    const thin = (child.children || []).length <= 1;
    if (thin && (!shrunkOnly || groupSizes[child.id] >= 2)) return child;
  }
  return null;
}

/** Returns whether anything moved, so a caller holding a tree snapshot knows to re-read. */
async function dissolveThinGroups({ shrunkOnly = false } = {}) {
  let changed = false;
  for (let guard = 0; guard < 50; guard++) {
    let tree;
    try {
      [tree] = await chrome.bookmarks.getSubTree(rootId);
    } catch { return changed; }              // root went away; readTree rebuilds it

    const thin = firstThinFolder(tree, shrunkOnly);
    if (!thin) return changed;

    const kids = thin.children || [];
    try {
      if (kids.length === 1) {
        await chrome.bookmarks.move(kids[0].id, { parentId: thin.parentId, index: thin.index });
      }
      await chrome.bookmarks.remove(thin.id); // empty by now, so remove() is safe
    } catch { return changed; }               // another new tab got there first

    delete groupSizes[thin.id];
    changed = true;
  }
  return changed;
}

export const store = {
  get items() { return items; },
  get settings() { return settings; },
  get rootId() { return rootId; },

  async init() {
    const saved = await chrome.storage.local.get([
      'settings', 'icons', 'groupSizes', 'state', 'migrated', 'seeded',
      'dialTargetDefaulted'
    ]);
    settings = { ...DEFAULT_SETTINGS, ...(saved.settings || {}) };

    /* openInNewTab shipped false and is now the default. Every install that predates the
     * change has false sitting on disk, and almost none of them chose it: setSettings writes
     * the whole object, so merely dragging the divider was enough to persist the old default.
     * Stored values win over DEFAULT_SETTINGS, so the new one is applied once and the fact
     * recorded; a deliberate switch back to the current tab survives from then on. */
    if (!saved.dialTargetDefaulted) {
      settings = { ...settings, openInNewTab: true };
      await chrome.storage.local.set({ settings, dialTargetDefaulted: true });
    }

    icons = saved.icons || {};
    groupSizes = saved.groupSizes || {};

    const root = await resolveRoot();
    rootId = root.id;

    // One-time lift of anything the pre-bookmark version had stored.
    const hasV1 = saved.state && saved.state.items?.length;
    if (root.created && !saved.migrated && hasV1) {
      await importTree(saved.state.items, rootId);
      if (saved.state.settings) {
        settings = { ...settings, ...saved.state.settings };
        await chrome.storage.local.set({ settings });
      }
      await chrome.storage.local.set({ migrated: true });
    } else if (root.created && !saved.seeded) {
      await importTree(DEFAULT_ITEMS, rootId);
    }
    // Marked whether or not we seeded: rebuilding a folder somebody deleted must not
    // hand them the starter set a second time.
    if (!saved.seeded) await chrome.storage.local.set({ seeded: true });

    await readTree();
    watch();
    return items;
  },

  refresh: readTree,

  onChange(cb) { changeListeners.add(cb); return () => changeListeners.delete(cb); },

  async setSettings(patch) {
    settings = { ...settings, ...patch };
    await chrome.storage.local.set({ settings });
  },

  async addCustomEngine({ name, url }) {
    // Date.now() alone collides if two are added inside the same millisecond.
    const taken = new Set((settings.customEngines || []).map((e) => e.id));
    let id = CUSTOM_PREFIX + Date.now();
    while (taken.has(id)) id += '-1';
    const engine = { id, name: name.trim().slice(0, 40), url };
    await this.setSettings({ customEngines: [...(settings.customEngines || []), engine] });
    await syncCustomRules();
    return engine;
  },

  /* Removing the engine in use falls back to the first built-in rather than leaving
   * `engineId` pointing at something that is gone. */
  async removeCustomEngine(id) {
    const left = (settings.customEngines || []).filter((e) => e.id !== id);
    await this.setSettings({
      customEngines: left,
      ...(settings.engineId === id ? { engineId: ENGINES[0].id } : {})
    });
    await syncCustomRules();
  },

  async addDial({ url, title, icon, parentId }) {
    const node = await chrome.bookmarks.create({
      parentId: parentId || rootId,
      title: title || hostOf(url),
      url
    });
    if (icon) await this.setIcon(node.id, icon);
    return node.id;
  },

  async updateDial(id, { url, title, icon }) {
    await chrome.bookmarks.update(id, { title, url });
    await this.setIcon(id, icon);
  },

  async rename(id, title) {
    await chrome.bookmarks.update(id, { title });
  },

  async setIcon(id, icon) {
    if (icon) icons[id] = icon; else delete icons[id];
    await chrome.storage.local.set({ icons });
  },

  async remove(id) {
    const [node] = await chrome.bookmarks.get(id);
    if (!node) return;
    if (node.url) await chrome.bookmarks.remove(id);
    else await chrome.bookmarks.removeTree(id);
    if (icons[id]) await this.setIcon(id, null);
    await dissolveThinGroups();
  },

  /** Spill a folder's children into its parent, then drop the empty folder. */
  async ungroup(id) {
    const [folder] = await chrome.bookmarks.getSubTree(id);
    if (!folder || folder.url) return;
    let index = folder.index;
    for (const child of folder.children || []) {
      await chrome.bookmarks.move(child.id, { parentId: folder.parentId, index: ++index });
    }
    await chrome.bookmarks.remove(id);
  },

  async moveTo(id, parentId, index) {
    await chrome.bookmarks.move(id, index == null ? { parentId } : { parentId, index });
    await dissolveThinGroups();
  },

  /** Translate the grid's post-drag DOM order into bookmark moves. */
  async applyDrop({ rootIds, groupId, groupIds, dragId, mergeTargetId }) {
    if (mergeTargetId && mergeTargetId !== dragId) {
      await mergeInto(dragId, mergeTargetId);
      return;
    }
    if (groupId && groupIds) await placeAll(groupId, groupIds);
    await placeAll(rootId, rootIds);
    await dissolveThinGroups();
  }
};

/* ------------------------------------------------- changes made outside us */
let notifyTimer = null;
function notify() {
  clearTimeout(notifyTimer);
  notifyTimer = setTimeout(async () => {
    await readTree();
    for (const cb of changeListeners) cb(items);
  }, 150);
}

function watch() {
  const b = chrome.bookmarks;
  for (const event of [b.onCreated, b.onRemoved, b.onChanged, b.onMoved, b.onChildrenReordered]) {
    event.addListener(notify);
  }
}

/* ----------------------------------------------------- migration from v1 */
async function importTree(list, parentId) {
  for (const item of list) {
    if (item.type === 'group') {
      const folder = await chrome.bookmarks.create({ parentId, title: item.title || 'Group' });
      await importTree(item.items || [], folder.id);
    } else {
      const node = await chrome.bookmarks.create({
        parentId,
        title: item.title || hostOf(item.url),
        url: item.url
      });
      if (item.icon) icons[node.id] = item.icon;
    }
  }
  await chrome.storage.local.set({ icons });
}
