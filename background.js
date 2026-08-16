// Service worker. Resolves which snippets match a URL, performs the privileged
// injection calls, and keeps content scripts informed when snippets change.

import * as storage from './lib/storage.js';

// Tracks CSS we have inserted so we can pull it back out on toggle off.
// Shape: tabId -> Map(snippetId -> { css, frameId })
const insertedCss = new Map();

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: String(error && error.message || error) }));
  // Returning true keeps the message channel open for the async reply.
  return true;
});

async function handleMessage(message, sender) {
  switch (message && message.type) {
    case 'getMatching': {
      const url = message.url || (sender.tab && sender.tab.url);
      if (!url) return { ok: true, snippets: [] };
      const snippets = await storage.getMatching(url);
      return { ok: true, snippets };
    }

    case 'runJs': {
      // The content script asks us to run a JS snippet because only the
      // background has access to chrome.scripting with world: MAIN.
      const tabId = sender.tab && sender.tab.id;
      if (typeof tabId !== 'number') return { ok: false, error: 'No tab' };
      return runJsSnippet(tabId, message.snippet, sender.frameId || 0);
    }

    case 'applyCss': {
      const tabId = sender.tab && sender.tab.id;
      if (typeof tabId !== 'number') return { ok: false, error: 'No tab' };
      return applyCss(tabId, message.snippet, sender.frameId || 0);
    }

    case 'reportError': {
      await storage.recordError(message.id, message.message);
      return { ok: true };
    }

    case 'clearError': {
      await storage.clearError(message.id);
      return { ok: true };
    }

    case 'openManager': {
      const url = chrome.runtime.getURL('manager/manager.html')
        + (message.id ? `?id=${encodeURIComponent(message.id)}` : '')
        + (message.newFor ? `?new=${encodeURIComponent(message.newFor)}` : '');
      await chrome.tabs.create({ url });
      return { ok: true };
    }

    default:
      return { ok: false, error: `Unknown message type: ${message && message.type}` };
  }
}

// ---------------------------------------------------------------------------
// Injection
// ---------------------------------------------------------------------------

async function applyCss(tabId, snippet, frameId) {
  try {
    await chrome.scripting.insertCSS({
      target: { tabId, frameIds: [frameId] },
      css: snippet.code,
      origin: 'USER',
    });

    if (!insertedCss.has(tabId)) insertedCss.set(tabId, new Map());
    insertedCss.get(tabId).set(snippet.id, { css: snippet.code, frameId });

    await storage.clearError(snippet.id);
    return { ok: true };
  } catch (error) {
    const message = String(error && error.message || error);
    await storage.recordError(snippet.id, message);
    return { ok: false, error: message };
  }
}

async function removeCss(tabId, snippetId) {
  const forTab = insertedCss.get(tabId);
  const entry = forTab && forTab.get(snippetId);
  if (!entry) return;

  try {
    await chrome.scripting.removeCSS({
      target: { tabId, frameIds: [entry.frameId] },
      css: entry.css,
      origin: 'USER',
    });
  } catch {
    // The tab may be gone or navigated. Nothing to clean up in that case.
  }
  forTab.delete(snippetId);
}

// Running arbitrary user code under Manifest V3 is the hardest part of this
// extension, because every route that turns a string into code is blocked:
//
//   new Function / eval in the service worker  blocked by the extension CSP
//   new Function / eval in a content script    blocked by the extension CSP
//   new Function / eval in the page            blocked by the page CSP
//
// What does work is chrome.scripting.executeScript with a real function, which
// Chrome injects as genuine code. So the snippet body is carried into the page
// as a plain string argument to a fixed injector function, which then puts it
// in a <script> element. Normal sites run it happily.
//
// Sites that send a strict Content-Security-Policy header block that script
// element. For those, and only those, a declarativeNetRequest rule strips the
// CSP header. That rule is scoped to the sites the user actually has a JS
// snippet for, so security elsewhere is untouched. See ensureCspRules.

// Injected into the page's own world. Self contained: it cannot close over
// anything defined here, because Chrome serialises it and runs it in the page.
function injectSnippet(code, id) {
  const helperSource = `
    (function () {
      const jinset = {
        id: ${JSON.stringify(id)},
        keep(el) {
          if (el && el.setAttribute) el.setAttribute('data-jinset', jinset.id);
          return el;
        },
        once(key) {
          const flag = 'jinset:' + jinset.id + ':' + (key || 'default');
          if (document.documentElement.hasAttribute(flag)) return false;
          document.documentElement.setAttribute(flag, '1');
          return true;
        },
        gone(key) {
          const flag = 'jinset:' + jinset.id + ':' + (key || 'default');
          document.documentElement.removeAttribute(flag);
        },
      };
      try {
        ${code}
      } catch (error) {
        document.documentElement.setAttribute(
          'data-jinset-error-' + jinset.id,
          String((error && error.message) || error),
        );
      }
    })();
  `;

  try {
    const script = document.createElement('script');
    script.textContent = helperSource;
    (document.head || document.documentElement).append(script);
    script.remove();

    const errorKey = 'data-jinset-error-' + id;
    const message = document.documentElement.getAttribute(errorKey);
    if (message) {
      document.documentElement.removeAttribute(errorKey);
      return { error: message };
    }
    return { ok: true };
  } catch (error) {
    return { error: String((error && error.message) || error) };
  }
}

async function runJsSnippet(tabId, snippet, frameId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      world: 'MAIN',
      func: injectSnippet,
      args: [snippet.code, snippet.id],
    });

    const result = results && results[0] && results[0].result;
    if (result && result.error) {
      await storage.recordError(snippet.id, result.error);
      return { ok: false, error: result.error };
    }

    await storage.clearError(snippet.id);
    return { ok: true };
  } catch (error) {
    const message = String(error && error.message || error);
    await storage.recordError(snippet.id, message);
    return { ok: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// Content Security Policy
// ---------------------------------------------------------------------------

// Some sites send a CSP that blocks the script element used above. Removing
// that header lets snippets run, but it also weakens the site, so it is done
// only for origins where the user actually has an enabled JS snippet.
const CSP_RULE_OFFSET = 1000;

async function ensureCspRules() {
  const all = await storage.getAll();

  // Only JS snippets need this. CSS goes through insertCSS, which the page CSP
  // does not govern.
  const patterns = new Set();
  for (const snippet of all) {
    if (snippet.type !== 'js' || !snippet.enabled) continue;
    for (const pattern of snippet.patterns) patterns.add(pattern);
  }

  const rules = [...patterns].map((pattern, index) => ({
    id: CSP_RULE_OFFSET + index,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      responseHeaders: [
        { header: 'content-security-policy', operation: 'remove' },
        { header: 'content-security-policy-report-only', operation: 'remove' },
      ],
    },
    condition: {
      ...conditionForPattern(pattern),
      resourceTypes: ['main_frame', 'sub_frame'],
    },
  }));

  const existing = await chrome.declarativeNetRequest.getSessionRules();
  const staleIds = existing
    .filter((rule) => rule.id >= CSP_RULE_OFFSET)
    .map((rule) => rule.id);

  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: staleIds,
      addRules: rules,
    });
  } catch (error) {
    console.warn('Jinset could not update CSP rules:', error);
  }
}

// declarativeNetRequest has its own condition syntax rather than match
// patterns. requestDomains is used where possible, because it handles ports and
// subdomains correctly, which a urlFilter string does not.
function conditionForPattern(pattern) {
  if (pattern === '<all_urls>') return { urlFilter: '*' };

  const schemeSplit = pattern.indexOf('://');
  if (schemeSplit === -1) return { urlFilter: '*' };

  const rest = pattern.slice(schemeSplit + 3);
  const pathStart = rest.indexOf('/');
  const host = (pathStart === -1 ? rest : rest.slice(0, pathStart)).replace(/^\*\./, '');

  if (!host || host === '*') return { urlFilter: '*' };

  // requestDomains matches the domain and its subdomains, and it ignores the
  // port, which a bare IP with a port would otherwise fail to match.
  return { requestDomains: [host] };
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

// Single page apps change the URL without a page load. The content script
// stays alive, so we tell it to re-evaluate which snippets now apply.
chrome.webNavigation.onHistoryStateUpdated.addListener(async (details) => {
  if (details.frameId !== 0) return;
  notifyTab(details.tabId, { type: 'urlChanged', url: details.url });
});

chrome.webNavigation.onReferenceFragmentUpdated.addListener(async (details) => {
  if (details.frameId !== 0) return;
  notifyTab(details.tabId, { type: 'urlChanged', url: details.url });
});

function notifyTab(tabId, message) {
  chrome.tabs.sendMessage(tabId, message).catch(() => {
    // No content script on this tab, for example a chrome:// page. Ignore.
  });
}

// A full page load wipes injected CSS, so drop our bookkeeping for that tab,
// then apply anything that asked to run at document start.
//
// This happens here rather than in the content script because the content
// script has to ask us which snippets match, and that round trip is slow enough
// that the page can finish loading first. Injecting from this side is the only
// way document_start actually means document start.
chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) return;
  insertedCss.delete(details.tabId);
  await applyDocumentStart(details.tabId, details.url, details.frameId);
});

async function applyDocumentStart(tabId, url, frameId) {
  if (!url || !/^(https?|file|ftp):/.test(url)) return;

  let matching;
  try {
    matching = await storage.getMatching(url);
  } catch {
    return;
  }

  for (const snippet of matching) {
    const timing = snippet.timing || (snippet.type === 'css' ? 'document_start' : 'load');
    if (timing !== 'document_start') continue;

    if (snippet.type === 'css') {
      await applyCss(tabId, snippet, frameId);
    } else {
      await runJsSnippet(tabId, snippet, frameId);
    }
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  insertedCss.delete(tabId);
});

// ---------------------------------------------------------------------------
// Live updates when snippets change
// ---------------------------------------------------------------------------

// When the user toggles or edits a snippet, push the change to open tabs so it
// takes effect without a manual reload.
// Reapplying touches the insertedCss bookkeeping and makes several awaited
// calls per tab. Two overlapping runs would interleave those steps and leave
// stale rules behind, so runs are queued and never overlap.
let reapplyQueue = Promise.resolve();

function queueReapply() {
  reapplyQueue = reapplyQueue.then(reapplyEverywhere).catch((error) => {
    console.warn('Jinset could not reapply snippets:', error);
  });
  return reapplyQueue;
}

async function reapplyEverywhere() {
  await ensureCspRules();

  const tabs = await chrome.tabs.query({});

  for (const tab of tabs) {
    if (typeof tab.id !== 'number' || !tab.url) continue;
    if (!/^https?:|^file:|^ftp:/.test(tab.url)) continue;

    // CSS is cheap to reapply and hard to diff reliably, so the safe move is
    // to pull everything we put in this tab and lay down the current set again.
    // That covers edits, toggles, deletions, and pattern changes in one path.
    const applying = insertedCss.get(tab.id);
    if (applying) {
      for (const snippetId of [...applying.keys()]) {
        await removeCss(tab.id, snippetId);
      }
    }

    const matching = await storage.getMatching(tab.url);
    for (const snippet of matching) {
      if (snippet.type !== 'css') continue;
      await applyCss(tab.id, snippet, 0);
    }

    notifyTab(tab.id, { type: 'snippetsChanged' });
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.snippets) return;

  const before = changes.snippets.oldValue || [];
  const after = changes.snippets.newValue || [];

  // Snippet runs write lastError back to storage. Reapplying for those would
  // loop forever, so they are ignored here.
  if (onlyErrorsChanged(before, after)) return;

  queueReapply();
});

// Snippet runs write lastError back to storage, which would otherwise bounce
// straight back here and cause an endless reapply loop.
function onlyErrorsChanged(before, after) {
  if (before.length !== after.length) return false;
  const beforeById = new Map(before.map((snippet) => [snippet.id, snippet]));

  for (const snippet of after) {
    const previous = beforeById.get(snippet.id);
    if (!previous) return false;
    const a = { ...previous, lastError: null, updated: 0 };
    const b = { ...snippet, lastError: null, updated: 0 };
    if (JSON.stringify(a) !== JSON.stringify(b)) return false;
  }
  return true;
}

// First install opens the manager so the extension is not a mystery.
chrome.runtime.onInstalled.addListener((details) => {
  ensureCspRules();
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('manager/manager.html?welcome=1') });
  }
});

// Session rules do not survive a browser restart, so rebuild them on startup
// and whenever this worker wakes up.
chrome.runtime.onStartup.addListener(() => { ensureCspRules(); });
ensureCspRules();
