// The manager tab. Everything that needs real typing happens here.

import * as storage from '../lib/storage.js';
import { suggestPatterns } from '../lib/match.js';
import {
  GLOBAL_SCOPE,
  describePatternProblem,
  defaultTiming,
  createSnippet,
} from '../lib/schema.js';
import { createEditor } from '../vendor/codemirror/editor.js';

const el = {
  tree: document.getElementById('tree'),
  search: document.getElementById('search'),
  placeholder: document.getElementById('placeholder'),
  pane: document.getElementById('editor-pane'),
  name: document.getElementById('name'),
  enabled: document.getElementById('enabled'),
  saveState: document.getElementById('save-state'),
  applyTo: document.getElementById('apply-to'),
  type: document.getElementById('type'),
  timing: document.getElementById('timing'),
  keepAlive: document.getElementById('keep-alive'),
  patternRow: document.getElementById('pattern-row'),
  patternInput: document.getElementById('pattern-input'),
  patternHint: document.getElementById('pattern-hint'),
  notice: document.getElementById('notice'),
  editorHost: document.getElementById('editor-host'),
  hint: document.getElementById('hint'),
  toast: document.getElementById('toast'),
  importFile: document.getElementById('import-file'),
};

let snippets = [];
let currentId = null;
let editor = null;
let saveTimer = null;
let suppressChange = false;

// ---------------------------------------------------------------- helpers

function current() {
  return snippets.find((snippet) => snippet.id === currentId) || null;
}

function toast(message, isError = false) {
  el.toast.textContent = message;
  el.toast.classList.toggle('error', isError);
  el.toast.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.toast.hidden = true; }, 2600);
}

function setSaveState(text) {
  el.saveState.textContent = text;
  if (text === 'Saved') {
    clearTimeout(setSaveState.timer);
    setSaveState.timer = setTimeout(() => { el.saveState.textContent = ''; }, 1600);
  }
}

// ------------------------------------------------------------------ tree

function renderTree() {
  const query = el.search.value.trim().toLowerCase();
  const visible = query
    ? snippets.filter((snippet) =>
        snippet.name.toLowerCase().includes(query)
        || snippet.patterns.join(' ').toLowerCase().includes(query))
    : snippets;

  el.tree.replaceChildren();

  if (visible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'tree-label';
    empty.textContent = query ? 'No matches' : 'No snippets yet';
    el.tree.append(empty);
    return;
  }

  for (const group of storage.groupByScope(visible)) {
    const wrap = document.createElement('div');
    wrap.className = 'tree-group';

    const label = document.createElement('div');
    label.className = 'tree-label';
    label.textContent = group.label;
    label.title = group.scope;
    wrap.append(label);

    for (const snippet of group.snippets) {
      wrap.append(treeItem(snippet));
    }
    el.tree.append(wrap);
  }
}

function treeItem(snippet) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tree-item';
  if (snippet.id === currentId) button.classList.add('active');
  if (!snippet.enabled) button.classList.add('disabled');

  const dot = document.createElement('span');
  dot.className = 'dot';
  if (snippet.lastError) {
    dot.classList.add('err');
    dot.title = snippet.lastError.message;
  } else if (snippet.enabled) {
    dot.classList.add('on');
  }

  const name = document.createElement('span');
  name.className = 'tree-name';
  name.textContent = snippet.name;

  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.textContent = snippet.type;

  button.append(dot, name, tag);
  button.addEventListener('click', () => select(snippet.id));
  return button;
}

// ---------------------------------------------------------------- editor

function ensureEditor() {
  if (editor) return editor;
  editor = createEditor({
    parent: el.editorHost,
    doc: '',
    type: 'css',
    onChange: (value) => {
      if (suppressChange) return;
      queueSave({ code: value });
    },
  });
  // Follow the system theme if it changes while the tab is open.
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', (event) => editor.setDark(event.matches));
  return editor;
}

function select(id) {
  currentId = id;
  const snippet = current();
  if (!snippet) {
    showPlaceholder();
    return;
  }

  el.placeholder.hidden = true;
  el.pane.hidden = false;

  suppressChange = true;
  el.name.value = snippet.name;
  el.enabled.checked = snippet.enabled;
  el.type.value = snippet.type;
  el.timing.value = snippet.timing;
  el.keepAlive.checked = snippet.keepAlive;

  buildApplyToOptions(snippet);
  syncTypeVisibility(snippet.type);
  showError(snippet);
  updateHint(snippet);

  ensureEditor();
  editor.setLanguage(snippet.type);
  editor.setValue(snippet.code);
  suppressChange = false;

  renderTree();
}

function showPlaceholder() {
  currentId = null;
  el.pane.hidden = true;
  el.placeholder.hidden = false;
  renderTree();
}

function syncTypeVisibility(type) {
  const isJs = type === 'js';
  for (const node of document.querySelectorAll('.js-only')) {
    node.hidden = !isJs;
  }
}

function showError(snippet) {
  if (snippet.lastError) {
    el.notice.hidden = false;
    el.notice.textContent = `Last run failed: ${snippet.lastError.message}`;
  } else {
    el.notice.hidden = true;
    el.notice.textContent = '';
  }
}

function updateHint(snippet) {
  if (snippet.type === 'css') {
    el.hint.textContent = 'CSS applies as soon as you type, on every open tab that matches.';
    return;
  }
  const parts = [
    'Runs in the page context with full access to the site’s own JavaScript.',
    'Changes apply on the next page load or route change.',
  ];
  if (snippet.keepAlive) {
    parts.push('Keep alive re-runs this snippet when the page removes elements you tagged with jinset.keep().');
  }
  el.hint.textContent = parts.join(' ');
}

// -------------------------------------------------------------- apply to

function buildApplyToOptions(snippet) {
  const pattern = snippet.patterns[0] || GLOBAL_SCOPE;
  const options = [];

  // Offer suggestions based on the snippet's own pattern, so the dropdown
  // still makes sense when reopening a snippet from a different tab.
  const sample = patternToSampleUrl(pattern);
  if (sample) {
    for (const suggestion of suggestPatterns(sample)) options.push(suggestion);
  } else {
    options.push({ label: 'All sites', pattern: GLOBAL_SCOPE });
  }

  const known = new Set(options.map((option) => option.pattern));
  if (!known.has(pattern)) {
    options.unshift({ label: `Current: ${pattern}`, pattern });
  }
  options.push({ label: 'Custom pattern…', pattern: '__custom__' });

  el.applyTo.replaceChildren();
  for (const option of options) {
    const node = document.createElement('option');
    node.value = option.pattern;
    node.textContent = option.label;
    el.applyTo.append(node);
  }
  el.applyTo.value = pattern;

  el.patternRow.hidden = true;
  el.patternInput.value = pattern;
  validatePattern();
}

// Rebuilds a plausible URL from a pattern so the dropdown can offer the same
// four choices it would for a live tab.
function patternToSampleUrl(pattern) {
  if (pattern === GLOBAL_SCOPE) return null;
  const schemeSplit = pattern.indexOf('://');
  if (schemeSplit === -1) return null;
  const scheme = pattern.slice(0, schemeSplit) === '*' ? 'https' : pattern.slice(0, schemeSplit);
  const rest = pattern.slice(schemeSplit + 3);
  const pathStart = rest.indexOf('/');
  const host = (pathStart === -1 ? rest : rest.slice(0, pathStart)).replace(/^\*\./, '');
  const path = pathStart === -1 ? '/' : rest.slice(pathStart).replace(/\*/g, '');
  if (!host || host === '*') return null;
  return `${scheme}://${host}${path || '/'}`;
}

function validatePattern() {
  const value = el.patternInput.value.trim();
  const problem = value ? describePatternProblem(value) : 'pattern cannot be empty';
  if (problem) {
    el.patternInput.classList.add('invalid');
    el.patternHint.classList.add('error');
    el.patternHint.textContent = problem;
    return false;
  }
  el.patternInput.classList.remove('invalid');
  el.patternHint.classList.remove('error');
  el.patternHint.textContent = 'Valid pattern';
  return true;
}

// ------------------------------------------------------------------ save

function queueSave(changes) {
  const snippet = current();
  if (!snippet) return;

  Object.assign(snippet, changes);
  setSaveState('Saving');

  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await storage.save({ id: snippet.id, ...changes });
    setSaveState('Saved');
  }, 300);
}

async function saveNow(changes) {
  const snippet = current();
  if (!snippet) return;
  Object.assign(snippet, changes);
  await storage.save({ id: snippet.id, ...changes });
  setSaveState('Saved');
}

// --------------------------------------------------------------- actions

async function createNew({ type = 'css', url = null } = {}) {
  const patterns = url ? [suggestPatterns(url)[0].pattern] : [GLOBAL_SCOPE];
  const name = url ? `${new URL(url).hostname} ${type.toUpperCase()}` : `New ${type.toUpperCase()} snippet`;

  const snippet = createSnippet({
    name,
    type,
    patterns,
    code: type === 'css' ? '' : starterJs(),
    timing: defaultTiming(type),
  });

  await storage.save(snippet);
  snippets = await storage.getAll();
  select(snippet.id);
  el.name.select();
}

function starterJs() {
  return [
    '// Runs in the page context. jinset helpers are available:',
    '//   jinset.keep(el)   tag an element so Keep alive can restore it',
    '//   jinset.once(key)  return false if this already ran on this view',
    '',
  ].join('\n');
}

async function deleteCurrent() {
  const snippet = current();
  if (!snippet) return;
  const ok = confirm(`Delete "${snippet.name}"? This cannot be undone.`);
  if (!ok) return;

  await storage.remove(snippet.id);
  snippets = await storage.getAll();
  showPlaceholder();
  toast('Snippet deleted');
}

async function exportAll() {
  const data = await storage.exportAll();
  if (!data.snippets.length) {
    toast('Nothing to export yet', true);
    return;
  }

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `jinset-snippets-${stamp()}.json`;
  link.click();
  URL.revokeObjectURL(url);
  toast(`Exported ${data.snippets.length} snippet${data.snippets.length === 1 ? '' : 's'}`);
}

function stamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

async function importFrom(file) {
  const text = await file.text();
  const result = storage.parseImport(text);

  if (!result.ok) {
    const first = result.problems.slice(0, 3).join('. ');
    const more = result.problems.length > 3 ? ` and ${result.problems.length - 3} more` : '';
    toast(`Import failed: ${first}${more}`, true);
    return;
  }

  const { added, replaced } = await storage.applyImport(result.snippets);
  snippets = await storage.getAll();
  renderTree();
  toast(`Imported ${added} new, replaced ${replaced}`);
}

// ------------------------------------------------------------------ wire

el.name.addEventListener('input', () => {
  queueSave({ name: el.name.value.trim() || 'Untitled snippet' });
  renderTree();
});

el.enabled.addEventListener('change', () => saveNow({ enabled: el.enabled.checked }));

el.type.addEventListener('change', async () => {
  const type = el.type.value;
  syncTypeVisibility(type);
  editor.setLanguage(type);
  // Timing defaults differ per type, so follow the new default unless the user
  // has already moved it away from the old one.
  const snippet = current();
  const wasDefault = snippet.timing === defaultTiming(snippet.type);
  const timing = wasDefault ? defaultTiming(type) : snippet.timing;
  el.timing.value = timing;
  await saveNow({ type, timing });
  updateHint(current());
});

el.timing.addEventListener('change', () => saveNow({ timing: el.timing.value }));

el.keepAlive.addEventListener('change', async () => {
  await saveNow({ keepAlive: el.keepAlive.checked });
  updateHint(current());
});

el.applyTo.addEventListener('change', () => {
  if (el.applyTo.value === '__custom__') {
    el.patternRow.hidden = false;
    el.patternInput.focus();
    el.patternInput.select();
    return;
  }
  el.patternRow.hidden = true;
  el.patternInput.value = el.applyTo.value;
  saveNow({ patterns: [el.applyTo.value] });
  renderTree();
});

el.patternInput.addEventListener('input', () => {
  if (!validatePattern()) return;
  queueSave({ patterns: [el.patternInput.value.trim()] });
  renderTree();
});

el.search.addEventListener('input', renderTree);

document.getElementById('delete').addEventListener('click', deleteCurrent);
document.getElementById('new-snippet').addEventListener('click', () => createNew());
document.getElementById('placeholder-new').addEventListener('click', () => createNew());
document.getElementById('export').addEventListener('click', exportAll);

document.getElementById('import').addEventListener('click', () => el.importFile.click());
el.importFile.addEventListener('change', async () => {
  const file = el.importFile.files && el.importFile.files[0];
  if (file) await importFrom(file);
  el.importFile.value = '';
});

// Keep the tab in step when another surface, like the popup, changes something.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !changes.snippets) return;
  snippets = await storage.getAll();
  const snippet = current();
  if (snippet) {
    // Refresh only the parts the user is not actively editing.
    el.enabled.checked = snippet.enabled;
    showError(snippet);
  }
  renderTree();
});

// ------------------------------------------------------------------ start

async function init() {
  snippets = await storage.getAll();

  const params = new URLSearchParams(location.search);
  const requestedId = params.get('id');
  const requestedNew = params.get('new');
  const forUrl = params.get('for');

  renderTree();

  if (requestedNew) {
    await createNew({ type: requestedNew, url: forUrl });
  } else if (requestedId && snippets.some((snippet) => snippet.id === requestedId)) {
    select(requestedId);
  } else if (params.get('welcome') && snippets.length === 0) {
    showPlaceholder();
  } else {
    showPlaceholder();
  }

  // Clean the URL so a refresh does not create another snippet.
  if (requestedNew || requestedId) {
    history.replaceState(null, '', location.pathname);
  }
}

init();
