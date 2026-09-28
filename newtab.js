/* Bifocal Tab — split new tab page with search on one half and bookmark-backed
 * speed dials on the other. */

import { store, find, hostOf, normalizeUrl, DEFAULT_SEARCH_URL } from './store.js';

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

/* --------------------------------------------------------------- rendering */
function iconNode(dial, big) {
  const img = document.createElement('img');
  img.src = dial.icon || faviconUrl(dial.url, big ? 64 : 32);
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
    for (const child of item.items.filter((c) => c.type === 'dial').slice(0, 4)) {
      icon.appendChild(iconNode(child, false));
    }
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
  dialGrid.replaceChildren(...store.items.map((it) => makeTile(it, 'root')));
  emptyHint.hidden = store.items.length > 0;
  if (openGroupId) renderGroup();
}

function renderGroup() {
  const group = find(openGroupId);
  if (!group || group.type !== 'group') { closeGroup(); return; }
  if (document.activeElement !== groupTitle) groupTitle.value = group.title;
  groupGrid.replaceChildren(...group.items.map((it) => makeTile(it, 'group')));
}

async function refresh() {
  await store.refresh();
  render();
}

/* ------------------------------------------------------------------ layout */
function applyLayout() {
  const { searchSide, splitRatio } = store.settings;
  app.classList.toggle('search-right', searchSide !== 'left');
  app.classList.toggle('search-left', searchSide === 'left');
  app.style.setProperty('--split', (splitRatio * 100).toFixed(2) + '%');
}

function applySearchUrl() {
  const url = store.settings.searchUrl || DEFAULT_SEARCH_URL;
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

  let ratio = store.settings.splitRatio;
  const move = (ev) => {
    ratio = Math.min(0.85, Math.max(0.15, ev.clientX / window.innerWidth));
    app.style.setProperty('--split', (ratio * 100).toFixed(2) + '%');
  };
  const up = () => {
    divider.removeEventListener('pointermove', move);
    divider.removeEventListener('pointerup', up);
    divider.removeEventListener('pointercancel', up);
    document.body.classList.remove('resizing');
    store.setSettings({ splitRatio: ratio });
  };
  divider.addEventListener('pointermove', move);
  divider.addEventListener('pointerup', up);
  divider.addEventListener('pointercancel', up);
});

divider.addEventListener('dblclick', async () => {
  await store.setSettings({ splitRatio: 0.5 });
  applyLayout();
});

divider.addEventListener('keydown', async (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  const step = (e.shiftKey ? 0.05 : 0.01) * (e.key === 'ArrowLeft' ? -1 : 1);
  await store.setSettings({
    splitRatio: Math.min(0.85, Math.max(0.15, store.settings.splitRatio + step))
  });
  applyLayout();
});

/* ------------------------------------------------------------ drag & drop */
let drag = null;

function onTilePointerDown(e) {
  if (e.button !== 0) return;
  const tile = e.target.closest('.tile');
  if (!tile) return;
  const item = find(tile.dataset.id);
  if (!item) return;

  drag = {
    tile,
    id: tile.dataset.id,
    item,
    container: tile.dataset.container,
    startX: e.clientX,
    startY: e.clientY,
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

  // Dials can travel in and out of an open group; a group itself stays at the root.
  let targetGrid = dialGrid;
  if (openGroupId && !groupOverlay.hidden && drag.item.type === 'dial') {
    const r = groupPanel.getBoundingClientRect();
    if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
      targetGrid = groupGrid;
    }
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
    const nearCentre = Math.abs(e.clientX - (r.left + r.width / 2)) < r.width * 0.26
                    && Math.abs(e.clientY - (r.top + r.height / 2)) < r.height * 0.28;

    if (drag.container === 'root' && drag.item.type === 'dial' && nearCentre) {
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
  for (const tile of [...grid.children].filter((el) => el !== drag.tile)) {
    const r = tile.getBoundingClientRect();
    if (y < r.bottom && x < r.left + r.width / 2) return tile;
    if (y < r.top) return tile;
  }
  return null; // append
}

function clearMergeHighlight() {
  for (const el of document.querySelectorAll('.tile.merge-target')) el.classList.remove('merge-target');
}

const idsIn = (grid) => [...grid.children]
  .filter((el) => el.classList.contains('tile'))
  .map((el) => el.dataset.id);

async function onTilePointerUp(e) {
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

  await store.applyDrop({
    rootIds: idsIn(dialGrid),
    groupId: openGroupId && !groupOverlay.hidden ? openGroupId : null,
    groupIds: openGroupId && !groupOverlay.hidden ? idsIn(groupGrid) : null,
    dragId: d.id,
    mergeTargetId: d.mergeTargetId
  });
  await refresh();
}

dialGrid.addEventListener('pointerdown', onTilePointerDown);
groupGrid.addEventListener('pointerdown', onTilePointerDown);

/* --------------------------------------------------------------- open item */
function activate(item, e) {
  if (item.type === 'group') { openGroup(item.id); return; }
  if (store.settings.openInNewTab || e.ctrlKey || e.metaKey || e.shiftKey) {
    window.open(item.url, '_blank', 'noreferrer');
  } else {
    location.href = item.url;
  }
}

for (const grid of [dialGrid, groupGrid]) {
  grid.addEventListener('auxclick', (e) => {
    if (e.button !== 1) return;
    const tile = e.target.closest('.tile');
    if (!tile) return;
    e.preventDefault();
    const item = find(tile.dataset.id);
    if (item && item.type === 'dial') window.open(item.url, '_blank', 'noreferrer');
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

let renameTimer = null;
groupTitle.addEventListener('input', () => {
  const id = openGroupId;
  const title = groupTitle.value.trim() || 'Group';
  const label = dialGrid.querySelector(`.tile[data-id="${CSS.escape(id)}"] .tile-label`);
  if (label) label.textContent = title;
  clearTimeout(renameTimer);
  renameTimer = setTimeout(() => store.rename(id, title), 400);
});

$('ungroupBtn').addEventListener('click', async () => {
  const id = openGroupId;
  closeGroup();
  await store.ungroup(id);
  await refresh();
});

/* --------------------------------------------------------- add / edit form */
let editingId = null;

function openEdit(id) {
  editingId = id;
  const item = id ? find(id) : null;
  $('editTitle').textContent = item ? 'Edit shortcut' : 'Add shortcut';
  $('fieldUrl').value = item ? item.url : '';
  $('fieldName').value = item ? (item.title || '') : '';
  $('fieldIcon').value = item ? (item.icon || '') : '';
  editOverlay.hidden = false;
  $('fieldUrl').focus();
  $('fieldUrl').select();
}

editForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = normalizeUrl($('fieldUrl').value);
  if (!url) { $('fieldUrl').focus(); return; }
  const title = $('fieldName').value.trim() || hostOf(url);
  const icon = normalizeUrl($('fieldIcon').value) || null;

  const id = editingId;
  editOverlay.hidden = true;
  editingId = null;

  if (id) await store.updateDial(id, { url, title, icon });
  else await store.addDial({ url, title, icon, parentId: openGroupId || undefined });
  await refresh();
});

$('addBtn').addEventListener('click', () => openEdit(null));

/* ------------------------------------------------------------- settings UI */
$('settingsBtn').addEventListener('click', () => {
  settingsForm.querySelector(`input[name=side][value="${store.settings.searchSide}"]`).checked = true;
  $('fieldSearchUrl').value = store.settings.searchUrl;
  $('fieldNewTab').checked = !!store.settings.openInNewTab;
  settingsOverlay.hidden = false;
});

settingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = normalizeUrl($('fieldSearchUrl').value) || DEFAULT_SEARCH_URL;
  const urlChanged = url !== store.settings.searchUrl;

  await store.setSettings({
    searchSide: settingsForm.querySelector('input[name=side]:checked').value,
    searchUrl: url,
    openInNewTab: $('fieldNewTab').checked
  });

  settingsOverlay.hidden = true;
  applyLayout();
  if (urlChanged) applySearchUrl();
});

$('resetLayoutBtn').addEventListener('click', async () => {
  await store.setSettings({ splitRatio: 0.5 });
  applyLayout();
});

$('swapBtn').addEventListener('click', async () => {
  await store.setSettings({
    searchSide: store.settings.searchSide === 'left' ? 'right' : 'left',
    splitRatio: 1 - store.settings.splitRatio   // keep each pane its own width
  });
  applyLayout();
});

for (const btn of document.querySelectorAll('[data-close]')) {
  btn.addEventListener('click', () => { btn.closest('.overlay').hidden = true; editingId = null; });
}
for (const overlay of [editOverlay, settingsOverlay]) {
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) { overlay.hidden = true; editingId = null; }
  });
}

/* ----------------------------------------------------------- context menu */
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
    const item = find(tile.dataset.id);
    if (!item) return;

    const entries = [];
    if (item.type === 'dial') {
      entries.push(['Open in new tab', () => window.open(item.url, '_blank', 'noreferrer')]);
      entries.push(['Edit…', () => openEdit(item.id)]);
      if (tile.dataset.container === 'group') {
        entries.push(['Move out of group', async () => {
          await store.moveTo(item.id, store.rootId);
          await refresh();
        }]);
      }
    } else {
      entries.push(['Open group', () => openGroup(item.id)]);
      entries.push(['Ungroup', async () => { await store.ungroup(item.id); await refresh(); }]);
    }
    entries.push([
      item.type === 'group' ? 'Delete group and contents' : 'Remove',
      async () => {
        if (item.type === 'group' && item.items.length
            && !confirm(`Delete "${item.title}" and its ${item.items.length} bookmarks?`)) return;
        await store.remove(item.id);
        if (openGroupId === item.id) closeGroup();
        await refresh();
      },
      true
    ]);

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
paneDials.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropDepth = 0;
  paneDials.classList.remove('drop-active');

  const dt = e.dataTransfer;
  const raw = (dt.getData('text/uri-list') || dt.getData('text/plain') || '').split('\n')[0];
  const url = normalizeUrl(raw);
  if (!url) return;

  let title = '';
  const html = dt.getData('text/html');
  if (html) {
    const a = new DOMParser().parseFromString(html, 'text/html').querySelector('a');
    if (a) title = a.textContent.trim().slice(0, 40);
  }
  await store.addDial({ url, title });
  await refresh();
});

/* -------------------------------------------------------------------- boot */
(async function init() {
  await store.init();
  applyLayout();
  applySearchUrl();
  render();

  // Edits made in the bookmark manager show up here. Never mid-drag, though: re-rendering
  // would destroy the tile the pointer has captured. The drop path refreshes anyway.
  store.onChange(() => {
    if (document.body.classList.contains('dragging')) return;
    render();
  });
})();
