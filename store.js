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
export const DEFAULT_SEARCH_URL = 'https://www.google.com/webhp?igu=1';

const DEFAULT_SETTINGS = {
  searchSide: 'right',
  splitRatio: 0.5,
  searchUrl: DEFAULT_SEARCH_URL,
  openInNewTab: false
};

let rootId = null;
let settings = { ...DEFAULT_SETTINGS };
let icons = {};                 // bookmarkId -> custom icon URL
let items = [];                 // derived view of the root folder's children
const lastOrder = new Map();    // parentId -> comma-joined child ids, to skip no-op reorders
const changeListeners = new Set();

/* ------------------------------------------------------------------ helpers */
export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url || ''; }
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
  return {
    id: node.id,
    type: 'group',
    title: node.title || 'Group',
    items: (node.children || []).map(toItem)
  };
}

function rememberOrder(node) {
  if (node.url) return;
  lastOrder.set(node.id, (node.children || []).map((c) => c.id).join(','));
  for (const child of node.children || []) rememberOrder(child);
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
  lastOrder.clear();
  rememberOrder(subtree);
  items = (subtree.children || []).map(toItem);
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
 *  This runs only straight after one of our own mutations, never on a plain read, so
 *  opening a new tab cannot quietly restructure a one-bookmark folder made by hand.
 *  Deepest folders go first, so nesting unwinds from the inside out. */
function firstThinFolder(node) {
  for (const child of node.children || []) {
    if (child.url) continue;
    const deeper = firstThinFolder(child);
    if (deeper) return deeper;
    if ((child.children || []).length <= 1) return child;
  }
  return null;
}

async function dissolveThinGroups() {
  for (let guard = 0; guard < 50; guard++) {
    const [tree] = await chrome.bookmarks.getSubTree(rootId);
    const thin = firstThinFolder(tree);
    if (!thin) return;

    const kids = thin.children || [];
    if (kids.length === 1) {
      await chrome.bookmarks.move(kids[0].id, { parentId: thin.parentId, index: thin.index });
    }
    await chrome.bookmarks.remove(thin.id);   // empty by now, so remove() is safe
  }
}

export const store = {
  get items() { return items; },
  get settings() { return settings; },
  get rootId() { return rootId; },

  async init() {
    const saved = await chrome.storage.local.get(['settings', 'icons', 'state', 'migrated']);
    settings = { ...DEFAULT_SETTINGS, ...(saved.settings || {}) };
    icons = saved.icons || {};

    const root = await resolveRoot();
    rootId = root.id;

    // One-time lift of anything the pre-bookmark version had stored.
    if (root.created && !saved.migrated && saved.state && saved.state.items?.length) {
      await importTree(saved.state.items, rootId);
      if (saved.state.settings) {
        settings = { ...settings, ...saved.state.settings };
        await chrome.storage.local.set({ settings });
      }
      await chrome.storage.local.set({ migrated: true });
    }

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
