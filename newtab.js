/* Focus New Tab — split new tab page with Google on one half and speed dials on the other. */

const DEFAULT_SEARCH_URL = 'https://www.google.com/webhp?igu=1';

const DEFAULT_STATE = {
  version: 1,
  settings: {
    searchSide: 'right',     // which half holds the search frame
    splitRatio: 0.5,         // width of whichever pane sits on the left
    searchUrl: DEFAULT_SEARCH_URL,
    openInNewTab: false
  },
  items: []                  // [{id,type:'dial',title,url,icon?} | {id,type:'group',title,items:[dial]}]
};

let state = structuredClone(DEFAULT_STATE);
let openGroupId = null;

/* ---------------------------------------------------------------- elements */
const $ = (id) => document.getElementById(id);
const app = $('app');
const searchFrame = $('searchFrame');
const frameFallback = $('frameFallback');
const frameFallbackLink = $('frameFallbackLink');
const popOut = $('popOut');
const divider = $('divider');
const paneDials = $('paneDials');
const dialGrid = $('dialGrid');
const emptyHint = $('emptyHint');
const groupOverlay = $('groupOverlay');
const groupPanel = $('groupPanel');
const groupGrid = $('groupGrid');
const groupTitle = $('groupTitle');
const editOverlay = $('editOverlay');
const editForm = $('editForm');
const settingsOverlay = $('settingsOverlay');
const settingsForm = $('settingsForm');
const ctxMenu = $('ctxMenu');

/* ------------------------------------------------------------------ utils */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function normalizeUrl(raw) {
  const s = (raw || '').trim();
  if (!s) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^(about|chrome|edge|file):/i.test(s)
    ? s
    : 'https://' + s;
  try { return new URL(withScheme).href; } catch { return null; }
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url || ''; }
}

function hueOf(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return h;
}

function faviconUrl(pageUrl, size) {
  const u = new URL(chrome.runtime.getURL('/_favicon/'));
  u.searchParams.set('pageUrl', pageUrl);
  u.searchParams.set('size', String(size));
  return u.toString();
}

/* ---------------------------------------------------------------- storage */
async function loadState() {
  try {
    const stored = await chrome.storage.local.get('state');
    if (stored && stored.state) {
      state = {
        ...DEFAULT_STATE,
        ...stored.state,
        settings: { ...DEFAULT_STATE.settings, ...(stored.state.settings || {}) },
        items: Array.isArray(stored.state.items) ? stored.state.items : []
      };
    }
  } catch (err) {
    console.warn('Could not read saved state, starting fresh.', err);
  }
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    chrome.storage.local.set({ state }).catch((err) => console.warn('Save failed', err));
  }, 120);
}

/* ------------------------------------------------------------ item lookup */
function flatten(list, map = new Map()) {
  for (const item of list) {
    map.set(item.id, item);
    if (item.type === 'group') flatten(item.items, map);
  }
  return map;
}

/** Find an item plus the array that holds it. */
function locate(id, list = state.items) {
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

/** A group with 0 or 1 members stops being a group, like a phone home screen. */
function normalize() {
  for (let i = state.items.length - 1; i >= 0; i--) {
    const item = state.items[i];
    if (item.type !== 'group') continue;
    if (item.items.length === 0) {
      state.items.splice(i, 1);
      if (openGroupId === item.id) closeGroup();
    } else if (item.items.length === 1) {
      const only = item.items[0];
      state.items.splice(i, 1, only);
      if (openGroupId === item.id) closeGroup();
    }
  }
}

/* --------------------------------------------------------------- rendering */
function iconNode(dial, big) {
  const src = dial.icon || faviconUrl(dial.url, big ? 64 : 32);
  const img = document.createElement('img');
  img.src = src;
  img.alt = '';
  img.draggable = false;
  img.addEventListener('error', () => img.replaceWith(letterNode(dial)), { once: true });
  return img;
}

function letterNode(dial) {
  const name = dial.title || hostOf(dial.url) || '?';
  const el = document.createElement('div');
  el.className = 'letter';
  el.textContent = name.trim().charAt(0).toUpperCase() || '?';
  el.style.background = `hsl(${hueOf(name)} 55% 45%)`;
  return el;
}

function makeTile(item, container) {
  const el = document.createElement('div');
  el.className = 'tile' + (item.type === 'group' ? ' is-group' : '');
  el.dataset.id = item.id;
  el.dataset.container = container;
  el.setAttribute('role', 'listitem');
  el.title = item.type === 'group'
    ? `${item.title} — ${item.items.length} shortcuts`
    : `${item.title || hostOf(item.url)}\n${item.url}`;

  const icon = document.createElement('div');
  icon.className = 'tile-icon';
  if (item.type === 'group') {
    for (const child of item.items.slice(0, 4)) icon.appendChild(iconNode(child, false));
  } else {
    icon.appendChild(iconNode(item, true));
  }

  const label = document.createElement('div');
  label.className = 'tile-label';
  label.textContent = item.type === 'group' ? item.title : (item.title || hostOf(item.url));

  el.append(icon, label);
  return el;
}

function render() {
  dialGrid.replaceChildren(...state.items.map((it) => makeTile(it, 'root')));
  emptyHint.hidden = state.items.length > 0;
  if (openGroupId) renderGroup();
}

function renderGroup() {
  const group = flatten(state.items).get(openGroupId);
  if (!group || group.type !== 'group') { closeGroup(); return; }
  if (document.activeElement !== groupTitle) groupTitle.value = group.title;
  groupGrid.replaceChildren(...group.items.map((it) => makeTile(it, 'group')));
}

/* ------------------------------------------------------------------ layout */
function applyLayout() {
  const { searchSide, splitRatio } = state.settings;
  app.classList.toggle('search-right', searchSide !== 'left');
  app.classList.toggle('search-left', searchSide === 'left');
  app.style.setProperty('--split', (splitRatio * 100).toFixed(2) + '%');
}

function applySearchUrl() {
  const url = state.settings.searchUrl || DEFAULT_SEARCH_URL;
  frameFallbackLink.href = url;
  popOut.href = url;
  frameFallback.hidden = true;
  searchFrame.src = url;
}

// A frame that is merely slow must not be accused of refusing to load, so there is no
// timeout here. Chrome fires `error` when the navigation itself fails; an X-Frame-Options
// block fires `load` on an error document instead, which is why the pop-out button is
// always available rather than gated on detection.
searchFrame.addEventListener('load', () => { frameFallback.hidden = true; });
searchFrame.addEventListener('error', () => { frameFallback.hidden = false; });
$('frameNoticeClose').addEventListener('click', () => { frameFallback.hidden = true; });

/* --------------------------------------------------------- divider resize */
divider.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  divider.setPointerCapture(e.pointerId);
  document.body.classList.add('resizing');

  const move = (ev) => {
    const ratio = Math.min(0.85, Math.max(0.15, ev.clientX / window.innerWidth));
    state.settings.splitRatio = ratio;
    app.style.setProperty('--split', (ratio * 100).toFixed(2) + '%');
  };
  const up = () => {
    divider.removeEventListener('pointermove', move);
    divider.removeEventListener('pointerup', up);
    divider.removeEventListener('pointercancel', up);
    document.body.classList.remove('resizing');
    save();
  };
  divider.addEventListener('pointermove', move);
  divider.addEventListener('pointerup', up);
  divider.addEventListener('pointercancel', up);
});

divider.addEventListener('dblclick', () => {
  state.settings.splitRatio = 0.5;
  applyLayout();
  save();
});

divider.addEventListener('keydown', (e) => {
  const step = e.shiftKey ? 0.05 : 0.01;
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  const delta = e.key === 'ArrowLeft' ? -step : step;
  state.settings.splitRatio = Math.min(0.85, Math.max(0.15, state.settings.splitRatio + delta));
  applyLayout();
  save();
});

/* ------------------------------------------------------------ drag & drop */
let drag = null;

function onTilePointerDown(e) {
  if (e.button !== 0) return;
  const tile = e.target.closest('.tile');
  if (!tile) return;

  const entry = locate(tile.dataset.id);
  if (!entry) return;

  drag = {
    tile,
    id: tile.dataset.id,
    item: entry.item,
    container: tile.dataset.container,
    startX: e.clientX,
    startY: e.clientY,
    pointerId: e.pointerId,
    started: false,
    mergeTargetId: null,
    ghost: null
  };

  tile.setPointerCapture(e.pointerId);
  tile.addEventListener('pointermove', onTilePointerMove);
  tile.addEventListener('pointerup', onTilePointerUp);
  tile.addEventListener('pointercancel', onTilePointerUp);
}

function beginDrag(e) {
  drag.started = true;
  document.body.classList.add('dragging');
  hideCtxMenu();

  const rect = drag.tile.getBoundingClientRect();
  drag.offsetX = drag.startX - rect.left;
  drag.offsetY = drag.startY - rect.top;

  const ghost = drag.tile.cloneNode(true);
  ghost.classList.add('ghost');
  ghost.classList.remove('dragging');
  ghost.style.width = rect.width + 'px';
  document.body.appendChild(ghost);
  drag.ghost = ghost;

  drag.tile.classList.add('dragging');
  moveGhost(e.clientX, e.clientY);
}

function moveGhost(x, y) {
  drag.ghost.style.left = (x - drag.offsetX) + 'px';
  drag.ghost.style.top = (y - drag.offsetY) + 'px';
}

function onTilePointerMove(e) {
  if (!drag) return;

  if (!drag.started) {
    if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 6) return;
    beginDrag(e);
  }

  moveGhost(e.clientX, e.clientY);

  // Which grid is the pointer over? Dials can travel in and out of an open group.
  let targetGrid = dialGrid;
  if (openGroupId && !groupOverlay.hidden && drag.item.type === 'dial') {
    const r = groupPanel.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (inside) targetGrid = groupGrid;
  }
  if (drag.tile.parentElement !== targetGrid) {
    targetGrid.appendChild(drag.tile);
    drag.container = targetGrid === groupGrid ? 'group' : 'root';
    drag.tile.dataset.container = drag.container;
  }

  clearMergeHighlight();
  drag.mergeTargetId = null;

  const under = document.elementFromPoint(e.clientX, e.clientY);
  const overTile = under && under.closest ? under.closest('.tile') : null;

  if (overTile && overTile !== drag.tile && overTile.parentElement === targetGrid) {
    const r = overTile.getBoundingClientRect();
    const nearCentreX = Math.abs(e.clientX - (r.left + r.width / 2)) < r.width * 0.26;
    const nearCentreY = Math.abs(e.clientY - (r.top + r.height / 2)) < r.height * 0.28;
    const canMerge = drag.container === 'root' && drag.item.type === 'dial' && nearCentreX && nearCentreY;

    if (canMerge) {
      drag.mergeTargetId = overTile.dataset.id;
      overTile.classList.add('merge-target');
      return;
    }
    const before = e.clientX < r.left + r.width / 2;
    targetGrid.insertBefore(drag.tile, before ? overTile : overTile.nextSibling);
    return;
  }

  if (!overTile) {
    const slot = insertionPoint(targetGrid, e.clientX, e.clientY);
    if (slot !== drag.tile && slot !== drag.tile.nextSibling) targetGrid.insertBefore(drag.tile, slot);
  }
}

/** Nearest gap when the pointer sits between or past the tiles. */
function insertionPoint(grid, x, y) {
  const tiles = [...grid.children].filter((el) => el !== drag.tile);
  for (const tile of tiles) {
    const r = tile.getBoundingClientRect();
    if (y < r.bottom && x < r.left + r.width / 2) return tile;
    if (y < r.top) return tile;
  }
  return null; // append
}

function clearMergeHighlight() {
  for (const el of document.querySelectorAll('.tile.merge-target')) el.classList.remove('merge-target');
}

/** Read the DOM back into state so the visual order wins. */
function syncFromDom() {
  const map = flatten(state.items);
  const idsOf = (grid) => [...grid.children]
    .filter((el) => el.classList.contains('tile'))
    .map((el) => map.get(el.dataset.id))
    .filter(Boolean);

  if (openGroupId && !groupOverlay.hidden) {
    const group = map.get(openGroupId);
    if (group && group.type === 'group') group.items = idsOf(groupGrid);
  }
  state.items = idsOf(dialGrid);
}

function onTilePointerUp(e) {
  if (!drag) return;
  const d = drag;
  d.tile.removeEventListener('pointermove', onTilePointerMove);
  d.tile.removeEventListener('pointerup', onTilePointerUp);
  d.tile.removeEventListener('pointercancel', onTilePointerUp);
  drag = null;

  if (!d.started) {
    if (e.type === 'pointerup') activate(d.item, e);
    return;
  }

  d.ghost.remove();
  d.tile.classList.remove('dragging');
  document.body.classList.remove('dragging');
  clearMergeHighlight();

  syncFromDom();

  if (d.mergeTargetId && d.mergeTargetId !== d.id) merge(d.id, d.mergeTargetId);

  normalize();
  render();
  save();
}

/** Drop a dial onto another tile: join its group, or start a new one. */
function merge(dragId, targetId) {
  const dragged = locate(dragId);
  const target = locate(targetId);
  if (!dragged || !target || dragged.item.type !== 'dial') return;

  dragged.list.splice(dragged.index, 1);
  const t = locate(targetId); // index may have shifted after the splice
  if (!t) return;

  if (t.item.type === 'group') {
    t.item.items.push(dragged.item);
  } else {
    t.list.splice(t.index, 1, {
      id: uid(),
      type: 'group',
      title: 'Group',
      items: [t.item, dragged.item]
    });
  }
}

dialGrid.addEventListener('pointerdown', onTilePointerDown);
groupGrid.addEventListener('pointerdown', onTilePointerDown);

/* --------------------------------------------------------------- open item */
function activate(item, e) {
  if (item.type === 'group') { openGroup(item.id); return; }
  const newTab = state.settings.openInNewTab || e.ctrlKey || e.metaKey || e.shiftKey;
  if (newTab) window.open(item.url, '_blank', 'noreferrer');
  else location.href = item.url;
}

// Middle-click always opens a new tab.
for (const grid of [dialGrid, groupGrid]) {
  grid.addEventListener('auxclick', (e) => {
    if (e.button !== 1) return;
    const tile = e.target.closest('.tile');
    if (!tile) return;
    e.preventDefault();
    const entry = locate(tile.dataset.id);
    if (entry && entry.item.type === 'dial') window.open(entry.item.url, '_blank', 'noreferrer');
  });
  grid.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
}

/* -------------------------------------------------------------- group view */
function openGroup(id) {
  openGroupId = id;
  groupOverlay.hidden = false;
  renderGroup();
}

function closeGroup() {
  openGroupId = null;
  groupOverlay.hidden = true;
  groupGrid.replaceChildren();
}

groupOverlay.addEventListener('pointerdown', (e) => {
  if (e.target === groupOverlay) closeGroup();
});

groupTitle.addEventListener('input', () => {
  const group = flatten(state.items).get(openGroupId);
  if (!group) return;
  group.title = groupTitle.value.trim() || 'Group';
  const tile = dialGrid.querySelector(`.tile[data-id="${CSS.escape(group.id)}"] .tile-label`);
  if (tile) tile.textContent = group.title;
  save();
});

$('ungroupBtn').addEventListener('click', () => {
  const entry = locate(openGroupId);
  if (!entry || entry.item.type !== 'group') return;
  entry.list.splice(entry.index, 1, ...entry.item.items);
  closeGroup();
  render();
  save();
});

/* --------------------------------------------------------- add / edit form */
let editingId = null;

function openEdit(id) {
  editingId = id;
  const item = id ? flatten(state.items).get(id) : null;
  $('editTitle').textContent = item ? 'Edit shortcut' : 'Add shortcut';
  $('fieldUrl').value = item ? item.url : '';
  $('fieldName').value = item ? (item.title || '') : '';
  $('fieldIcon').value = item ? (item.icon || '') : '';
  editOverlay.hidden = false;
  $('fieldUrl').focus();
  $('fieldUrl').select();
}

editForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const url = normalizeUrl($('fieldUrl').value);
  if (!url) { $('fieldUrl').focus(); return; }
  const title = $('fieldName').value.trim() || hostOf(url);
  const icon = normalizeUrl($('fieldIcon').value) || undefined;

  if (editingId) {
    const entry = locate(editingId);
    if (entry) Object.assign(entry.item, { url, title, icon });
  } else {
    state.items.push({ id: uid(), type: 'dial', title, url, icon });
  }
  editOverlay.hidden = true;
  editingId = null;
  render();
  save();
});

$('addBtn').addEventListener('click', () => openEdit(null));

function addDial(url, title) {
  const href = normalizeUrl(url);
  if (!href) return false;
  state.items.push({ id: uid(), type: 'dial', title: (title || '').trim() || hostOf(href), url: href });
  render();
  save();
  return true;
}

/* ------------------------------------------------------------- settings UI */
$('settingsBtn').addEventListener('click', () => {
  settingsForm.querySelector(`input[name=side][value="${state.settings.searchSide}"]`).checked = true;
  $('fieldSearchUrl').value = state.settings.searchUrl;
  $('fieldNewTab').checked = !!state.settings.openInNewTab;
  settingsOverlay.hidden = false;
});

settingsForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const side = settingsForm.querySelector('input[name=side]:checked').value;
  const url = normalizeUrl($('fieldSearchUrl').value) || DEFAULT_SEARCH_URL;
  const urlChanged = url !== state.settings.searchUrl;

  state.settings.searchSide = side;
  state.settings.searchUrl = url;
  state.settings.openInNewTab = $('fieldNewTab').checked;

  settingsOverlay.hidden = true;
  applyLayout();
  if (urlChanged) applySearchUrl();
  save();
});

$('resetLayoutBtn').addEventListener('click', () => {
  state.settings.splitRatio = 0.5;
  applyLayout();
  save();
});

$('swapBtn').addEventListener('click', () => {
  state.settings.searchSide = state.settings.searchSide === 'left' ? 'right' : 'left';
  state.settings.splitRatio = 1 - state.settings.splitRatio;  // keep each pane its own width
  applyLayout();
  save();
});

for (const btn of document.querySelectorAll('[data-close]')) {
  btn.addEventListener('click', () => { btn.closest('.overlay').hidden = true; editingId = null; });
}
for (const overlay of [editOverlay, settingsOverlay]) {
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) { overlay.hidden = true; editingId = null; }
  });
}

/* ---------------------------------------------------------- context menu */
function showCtxMenu(x, y, entries) {
  ctxMenu.replaceChildren(...entries.map(([label, fn, danger]) => {
    const b = document.createElement('button');
    b.textContent = label;
    if (danger) b.className = 'danger';
    b.addEventListener('click', () => { hideCtxMenu(); fn(); });
    return b;
  }));
  ctxMenu.hidden = false;
  const r = ctxMenu.getBoundingClientRect();
  ctxMenu.style.left = Math.min(x, window.innerWidth - r.width - 8) + 'px';
  ctxMenu.style.top = Math.min(y, window.innerHeight - r.height - 8) + 'px';
}

function hideCtxMenu() { ctxMenu.hidden = true; }

for (const grid of [dialGrid, groupGrid]) {
  grid.addEventListener('contextmenu', (e) => {
    const tile = e.target.closest('.tile');
    if (!tile) return;
    e.preventDefault();
    const entry = locate(tile.dataset.id);
    if (!entry) return;
    const { item } = entry;

    const entries = [];
    if (item.type === 'dial') {
      entries.push(['Open in new tab', () => window.open(item.url, '_blank', 'noreferrer')]);
      entries.push(['Edit…', () => openEdit(item.id)]);
      if (tile.dataset.container === 'group') {
        entries.push(['Move out of group', () => {
          const e2 = locate(item.id);
          e2.list.splice(e2.index, 1);
          state.items.push(item);
          normalize();
          render();
          save();
        }]);
      }
    } else {
      entries.push(['Open group', () => openGroup(item.id)]);
      entries.push(['Ungroup', () => {
        const e2 = locate(item.id);
        e2.list.splice(e2.index, 1, ...item.items);
        render();
        save();
      }]);
    }
    entries.push(['Remove', () => {
      const e2 = locate(item.id);
      e2.list.splice(e2.index, 1);
      normalize();
      render();
      save();
    }, true]);

    showCtxMenu(e.clientX, e.clientY, entries);
  });
}

document.addEventListener('pointerdown', (e) => {
  if (!ctxMenu.hidden && !ctxMenu.contains(e.target)) hideCtxMenu();
}, true);

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!ctxMenu.hidden) { hideCtxMenu(); return; }
  if (!editOverlay.hidden) { editOverlay.hidden = true; editingId = null; return; }
  if (!settingsOverlay.hidden) { settingsOverlay.hidden = true; return; }
  if (!groupOverlay.hidden) closeGroup();
});

/* --------------------------------------- dropping a link from the browser */
let dropDepth = 0;

paneDials.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dropDepth++;
  paneDials.classList.add('drop-active');
});
paneDials.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});
paneDials.addEventListener('dragleave', () => {
  if (--dropDepth <= 0) { dropDepth = 0; paneDials.classList.remove('drop-active'); }
});
paneDials.addEventListener('drop', (e) => {
  e.preventDefault();
  dropDepth = 0;
  paneDials.classList.remove('drop-active');

  const dt = e.dataTransfer;
  const url = (dt.getData('text/uri-list') || dt.getData('text/plain') || '').split('\n')[0].trim();
  if (!url) return;

  let title = '';
  const html = dt.getData('text/html');
  if (html) {
    const a = new DOMParser().parseFromString(html, 'text/html').querySelector('a');
    if (a) title = a.textContent.trim().slice(0, 40);
  }
  addDial(url, title);
});

/* -------------------------------------------------------------------- boot */
(async function init() {
  await loadState();
  applyLayout();
  applySearchUrl();
  render();
})();
