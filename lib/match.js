// URL matching against Chrome style match patterns.
// Pure functions, no chrome APIs, so this is unit testable under Node.

import { GLOBAL_SCOPE, isValidPattern } from './schema.js';

// Turns one match pattern into a RegExp. Returns null for unusable patterns.
function patternToRegExp(pattern) {
  if (pattern === GLOBAL_SCOPE) {
    return /^(https?|file|ftp):\/\//i;
  }
  if (!isValidPattern(pattern)) return null;

  const schemeSplit = pattern.indexOf('://');
  const scheme = pattern.slice(0, schemeSplit);
  const rest = pattern.slice(schemeSplit + 3);
  const pathStart = rest.indexOf('/');
  const host = rest.slice(0, pathStart);
  const path = rest.slice(pathStart);

  const schemePart = scheme === '*' ? '(https?)' : escapeRegExp(scheme);

  // Chrome match patterns ignore the port, so a pattern written for a host has
  // to keep matching when the URL carries one, as it does on localhost or any
  // site served from a non standard port.
  const portPart = '(?::\\d+)?';

  let hostPart;
  if (host === '*') {
    hostPart = '[^/]+';
  } else if (host.startsWith('*.')) {
    // *.example.com matches example.com and any subdomain of it.
    const bare = escapeRegExp(host.slice(2));
    hostPart = `(?:[^/]+\\.)?${bare}${portPart}`;
  } else {
    hostPart = escapeRegExp(host) + portPart;
  }

  // Only * is a wildcard in the path. Everything else is literal.
  const pathPart = path
    .split('*')
    .map(escapeRegExp)
    .join('.*');

  return new RegExp(`^${schemePart}://${hostPart}${pathPart}$`, 'i');
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const regExpCache = new Map();

function cachedRegExp(pattern) {
  if (!regExpCache.has(pattern)) {
    regExpCache.set(pattern, patternToRegExp(pattern));
  }
  return regExpCache.get(pattern);
}

export function matchesPattern(url, pattern) {
  const regExp = cachedRegExp(pattern);
  if (!regExp) return false;
  // The query string and fragment are not part of match pattern comparison.
  return regExp.test(stripUrl(url));
}

export function matchesAny(url, patterns) {
  if (!Array.isArray(patterns)) return false;
  return patterns.some((pattern) => matchesPattern(url, pattern));
}

function stripUrl(url) {
  const hashIndex = url.indexOf('#');
  const clean = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const queryIndex = clean.indexOf('?');
  return queryIndex === -1 ? clean : clean.slice(0, queryIndex);
}

// Global snippets run first so a site specific snippet can override them.
// Within the same specificity, older snippets run first for a stable order.
export function sortForExecution(snippets) {
  return snippets.slice().sort((a, b) => {
    const aGlobal = a.patterns.includes(GLOBAL_SCOPE) ? 0 : 1;
    const bGlobal = b.patterns.includes(GLOBAL_SCOPE) ? 0 : 1;
    if (aGlobal !== bGlobal) return aGlobal - bGlobal;
    return a.created - b.created;
  });
}

// Suggests the match patterns offered in the manager's "Apply to" dropdown.
export function suggestPatterns(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return [{ label: 'All sites', pattern: GLOBAL_SCOPE }];
  }

  const host = parsed.hostname;
  const bare = host.replace(/^www\./, '');
  const path = parsed.pathname || '/';

  return [
    { label: `This site (${host})`, pattern: `*://${host}/*` },
    { label: `This site and subdomains (${bare})`, pattern: `*://*.${bare}/*` },
    { label: 'This exact page', pattern: `${parsed.protocol}//${host}${path}` },
    { label: 'All sites', pattern: GLOBAL_SCOPE },
  ];
}
