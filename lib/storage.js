// The only module that talks to chrome.storage.
// Everything else goes through these functions.

import { createSnippet, validateSnippet, GLOBAL_SCOPE } from './schema.js';
import { matchesAny, sortForExecution } from './match.js';

const KEY = 'snippets';
const EXPORT_FORMAT = 'jinset.snippets.v1';

// Records are held as a flat array under one key. Scope grouping is derived
// from each snippet's patterns when the UI needs it, so there is one source of
// truth and no chance of a snippet drifting out of sync with its scope.
export async function getAll() {
  const bag = await chrome.storage.local.get(KEY);
  const list = bag[KEY];
  return Array.isArray(list) ? list : [];
}

export async function setAll(snippets) {
  await chrome.storage.local.set({ [KEY]: snippets });
  return snippets;
}

export async function getById(id) {
  const all = await getAll();
  return all.find((snippet) => snippet.id === id) || null;
}

export async function save(partial) {
  const all = await getAll();
  const index = all.findIndex((snippet) => snippet.id === partial.id);

  if (index === -1) {
    const created = createSnippet(partial);
    all.push(created);
    await setAll(all);
    return created;
  }

  const updated = { ...all[index], ...partial, updated: Date.now() };
  all[index] = updated;
  await setAll(all);
  return updated;
}

export async function remove(id) {
  const all = await getAll();
  await setAll(all.filter((snippet) => snippet.id !== id));
}

export async function setEnabled(id, enabled) {
  return save({ id, enabled });
}

export async function recordError(id, message) {
  const all = await getAll();
  const index = all.findIndex((snippet) => snippet.id === id);
  if (index === -1) return;

  const current = all[index].lastError;
  const next = message ? { message: String(message), at: Date.now() } : null;

  // Writing an unchanged value would still fire a storage change, and the
  // listener that reapplies snippets would then trigger another run, which
  // would clear the error again. Skipping the no op write breaks that loop.
  if (!current && !next) return;
  if (current && next && current.message === next.message) return;

  all[index] = { ...all[index], lastError: next };
  await setAll(all);
}

export async function clearError(id) {
  return recordError(id, null);
}

// Snippets that should run on a given URL, already in execution order.
export async function getMatching(url, { enabledOnly = true } = {}) {
  const all = await getAll();
  const matching = all.filter((snippet) => {
    if (enabledOnly && !snippet.enabled) return false;
    return matchesAny(url, snippet.patterns);
  });
  return sortForExecution(matching);
}

// Groups snippets by their first pattern for the manager sidebar.
// Global sits at the top, then remaining scopes alphabetically.
export function groupByScope(snippets) {
  const groups = new Map();
  for (const snippet of snippets) {
    const scope = snippet.patterns.includes(GLOBAL_SCOPE)
      ? GLOBAL_SCOPE
      : snippet.patterns[0];
    if (!groups.has(scope)) groups.set(scope, []);
    groups.get(scope).push(snippet);
  }

  const scopes = [...groups.keys()].sort((a, b) => {
    if (a === GLOBAL_SCOPE) return -1;
    if (b === GLOBAL_SCOPE) return 1;
    return a.localeCompare(b);
  });

  return scopes.map((scope) => ({
    scope,
    label: scope === GLOBAL_SCOPE ? 'All sites' : scopeLabel(scope),
    snippets: groups.get(scope).sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

function scopeLabel(pattern) {
  const schemeSplit = pattern.indexOf('://');
  if (schemeSplit === -1) return pattern;
  const rest = pattern.slice(schemeSplit + 3);
  const pathStart = rest.indexOf('/');
  const host = pathStart === -1 ? rest : rest.slice(0, pathStart);
  return host.replace(/^\*\./, '');
}

export async function exportAll() {
  const snippets = await getAll();
  return {
    format: EXPORT_FORMAT,
    exported: Date.now(),
    snippets,
  };
}

// Validates before writing anything. A bad file changes nothing.
// Returns { ok, added, replaced, problems }.
export function parseImport(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, problems: [`File is not valid JSON: ${error.message}`] };
  }

  // Accept both a full export object and a bare array of snippets.
  const list = Array.isArray(parsed) ? parsed : parsed && parsed.snippets;
  if (!Array.isArray(list)) {
    return {
      ok: false,
      problems: ['File does not contain a snippets array'],
    };
  }
  if (list.length === 0) {
    return { ok: false, problems: ['File contains no snippets'] };
  }

  const problems = [];
  const snippets = [];
  list.forEach((record, index) => {
    const label = `Snippet ${index + 1}`;
    const found = validateSnippet(record, label);
    if (found.length) {
      problems.push(...found);
      return;
    }
    snippets.push(createSnippet(record));
  });

  if (problems.length) return { ok: false, problems };
  return { ok: true, snippets, problems: [] };
}

// Merge strategy: same id replaces, everything else is added.
export async function applyImport(snippets) {
  const all = await getAll();
  const byId = new Map(all.map((snippet) => [snippet.id, snippet]));

  let added = 0;
  let replaced = 0;
  for (const snippet of snippets) {
    if (byId.has(snippet.id)) replaced += 1;
    else added += 1;
    byId.set(snippet.id, snippet);
  }

  await setAll([...byId.values()]);
  return { added, replaced };
}
