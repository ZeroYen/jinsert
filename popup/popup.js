// The popup is for toggling snippets on and off quickly. Anything that needs
// real typing happens in the manager tab.

import * as storage from '../lib/storage.js';
import { matchesAny } from '../lib/match.js';
import { GLOBAL_SCOPE } from '../lib/schema.js';

const listEl = document.getElementById('list');
const hostEl = document.getElementById('host');

let currentTab = null;

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;

  const url = tab && tab.url;
  const injectable = url && /^(https?|file|ftp):/.test(url);

  if (!injectable) {
    hostEl.textContent = 'this page';
    renderNotInjectable();
    return;
  }

  hostEl.textContent = new URL(url).hostname || url;
  await render();
}

async function render() {
  const url = currentTab.url;
  const all = await storage.getAll();
  const matching = all.filter((snippet) => matchesAny(url, snippet.patterns));

  if (matching.length === 0) {
    renderEmpty();
    return;
  }

  const site = matching.filter((snippet) => !snippet.patterns.includes(GLOBAL_SCOPE));
  const global = matching.filter((snippet) => snippet.patterns.includes(GLOBAL_SCOPE));

  listEl.replaceChildren();
  if (site.length) {
    listEl.append(groupLabel('This site'), ...site.map(row));
  }
  if (global.length) {
    listEl.append(groupLabel('All sites'), ...global.map(row));
  }
}

function groupLabel(text) {
  const el = document.createElement('div');
  el.className = 'group-label';
  el.textContent = text;
  return el;
}

function row(snippet) {
  const el = document.createElement('div');
  el.className = 'row';

  const label = document.createElement('label');
  label.className = 'switch';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = snippet.enabled;
  input.setAttribute('aria-label', `Enable ${snippet.name}`);
  const track = document.createElement('span');
  label.append(input, track);

  const main = document.createElement('div');
  main.className = 'row-main';

  const name = document.createElement('div');
  name.className = 'row-name';
  name.textContent = snippet.name;

  const meta = document.createElement('div');
  meta.className = 'row-meta';

  const type = document.createElement('span');
  type.className = 'badge';
  type.textContent = snippet.type;
  meta.append(type);

  if (snippet.keepAlive) {
    meta.append(' ');
    const keep = document.createElement('span');
    keep.className = 'badge';
    keep.textContent = 'keep alive';
    meta.append(keep);
  }

  if (snippet.lastError) {
    meta.append(' ');
    const error = document.createElement('span');
    error.className = 'badge err';
    error.textContent = 'error';
    error.title = snippet.lastError.message;
    meta.append(error);
  }

  main.append(name, meta);
  el.append(label, main);

  input.addEventListener('change', async (event) => {
    event.stopPropagation();
    await storage.setEnabled(snippet.id, input.checked);
    // Turning a JS snippet off cannot undo what it already did on this page.
    if (!input.checked && snippet.type === 'js') {
      note(el, 'Takes effect on next load');
    }
  });

  // Clicking the row, but not the switch, opens the snippet for editing.
  el.addEventListener('click', (event) => {
    if (event.target === input) return;
    openManager({ id: snippet.id });
  });

  return el;
}

function note(rowEl, text) {
  const meta = rowEl.querySelector('.row-meta');
  if (!meta || meta.dataset.noted) return;
  meta.dataset.noted = '1';
  const span = document.createElement('span');
  span.className = 'row-meta';
  span.textContent = ` ${text}`;
  meta.append(span);
}

function renderEmpty() {
  listEl.replaceChildren();
  const wrap = document.createElement('div');
  wrap.className = 'empty';
  const line = document.createElement('p');
  line.textContent = 'No snippets run on this site yet.';
  wrap.append(line);
  listEl.append(wrap);
}

function renderNotInjectable() {
  listEl.replaceChildren();
  const wrap = document.createElement('div');
  wrap.className = 'empty';
  const line = document.createElement('p');
  line.textContent = 'Chrome does not allow extensions to run on this page.';
  wrap.append(line);
  listEl.append(wrap);
  document.getElementById('new-css').disabled = true;
  document.getElementById('new-js').disabled = true;
}

function openManager(params) {
  const url = new URL(chrome.runtime.getURL('manager/manager.html'));
  for (const [key, value] of Object.entries(params)) {
    if (value != null) url.searchParams.set(key, value);
  }
  chrome.tabs.create({ url: url.toString() });
  window.close();
}

document.getElementById('manage').addEventListener('click', () => openManager({}));

document.getElementById('new-css').addEventListener('click', () => {
  openManager({ new: 'css', for: currentTab && currentTab.url });
});

document.getElementById('new-js').addEventListener('click', () => {
  openManager({ new: 'js', for: currentTab && currentTab.url });
});

init();
