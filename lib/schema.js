// Snippet shape, defaults, and validation.
// Kept free of chrome APIs so it can be unit tested under plain Node.

export const TYPES = ['css', 'js'];
export const TIMINGS = ['document_start', 'dom_ready', 'load'];

export const GLOBAL_SCOPE = '<all_urls>';

// CSS wants to land before first paint so the page never flashes unstyled.
// JS usually touches elements that do not exist that early, so it waits.
export function defaultTiming(type) {
  return type === 'css' ? 'document_start' : 'load';
}

export function newId() {
  return 's_' + Math.random().toString(36).slice(2, 10);
}

export function createSnippet(partial = {}) {
  const type = TYPES.includes(partial.type) ? partial.type : 'css';
  const now = Date.now();
  return {
    id: partial.id || newId(),
    name: partial.name || 'Untitled snippet',
    type,
    patterns: Array.isArray(partial.patterns) && partial.patterns.length
      ? partial.patterns.slice()
      : [GLOBAL_SCOPE],
    code: typeof partial.code === 'string' ? partial.code : '',
    enabled: partial.enabled !== false,
    timing: TIMINGS.includes(partial.timing) ? partial.timing : defaultTiming(type),
    keepAlive: partial.keepAlive === true,
    created: partial.created || now,
    updated: partial.updated || now,
    lastError: partial.lastError || null,
  };
}

// Returns an array of problem strings. Empty array means the record is usable.
export function validateSnippet(record, label = 'snippet') {
  const problems = [];

  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return [`${label} is not an object`];
  }
  if (typeof record.id !== 'string' || !record.id) {
    problems.push(`${label} is missing a string id`);
  }
  if (typeof record.name !== 'string' || !record.name.trim()) {
    problems.push(`${label} is missing a name`);
  }
  if (!TYPES.includes(record.type)) {
    problems.push(`${label} has type "${record.type}", expected css or js`);
  }
  if (typeof record.code !== 'string') {
    problems.push(`${label} has no code string`);
  }
  if (!Array.isArray(record.patterns) || record.patterns.length === 0) {
    problems.push(`${label} needs at least one match pattern`);
  } else {
    for (const pattern of record.patterns) {
      if (typeof pattern !== 'string' || !pattern) {
        problems.push(`${label} has a pattern that is not a string`);
        continue;
      }
      const patternProblem = describePatternProblem(pattern);
      if (patternProblem) {
        problems.push(`${label} pattern "${pattern}": ${patternProblem}`);
      }
    }
  }
  if (record.timing !== undefined && !TIMINGS.includes(record.timing)) {
    problems.push(`${label} has timing "${record.timing}", expected one of ${TIMINGS.join(', ')}`);
  }
  if (record.enabled !== undefined && typeof record.enabled !== 'boolean') {
    problems.push(`${label} enabled must be true or false`);
  }
  if (record.keepAlive !== undefined && typeof record.keepAlive !== 'boolean') {
    problems.push(`${label} keepAlive must be true or false`);
  }

  return problems;
}

// Explains why a match pattern is unusable, or returns null when it is fine.
// Mirrors the Chrome match pattern rules closely enough to catch typos early.
export function describePatternProblem(pattern) {
  if (pattern === GLOBAL_SCOPE) return null;

  const schemeSplit = pattern.indexOf('://');
  if (schemeSplit === -1) {
    return 'missing :// between scheme and host';
  }

  const scheme = pattern.slice(0, schemeSplit);
  if (!['*', 'http', 'https', 'file', 'ftp'].includes(scheme)) {
    return `scheme "${scheme}" is not supported`;
  }

  const rest = pattern.slice(schemeSplit + 3);
  const pathStart = rest.indexOf('/');
  if (pathStart === -1) {
    return 'missing a path, add a trailing /* to match the whole site';
  }

  const host = rest.slice(0, pathStart);
  if (scheme !== 'file' && !host) {
    return 'missing a host';
  }
  if (host.includes('*') && host !== '*' && !host.startsWith('*.')) {
    return 'a * in the host is only allowed as the leading *. label';
  }
  if (host.startsWith('*.') && host.slice(2).includes('*')) {
    return 'only one * is allowed in the host';
  }

  return null;
}

export function isValidPattern(pattern) {
  return describePatternProblem(pattern) === null;
}
