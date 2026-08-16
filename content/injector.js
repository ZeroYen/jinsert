// Content script. Runs at document_start on every page.
//
// It owns three things: when a snippet runs, whether it runs again after the
// page navigates without reloading, and the optional watchdog that puts a
// snippet back when the site tears it out.
//
// This file is a classic script, not a module, because content scripts declared
// in the manifest cannot use import. It talks to the background worker for
// anything privileged.

(() => {
  'use strict';

  // Snippets already applied on this URL, so a re-run does not double apply.
  const applied = new Set();

  // Active watchdogs, keyed by snippet id, so we can tear them down.
  const watchdogs = new Map();

  let currentUrl = location.href;
  let pending = null;

  // -------------------------------------------------------------------------
  // Applying snippets
  // -------------------------------------------------------------------------

  async function fetchSnippets() {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'getMatching',
        url: location.href,
      });
      return (response && response.snippets) || [];
    } catch {
      // The worker may be asleep or the extension was reloaded. Nothing to do.
      return [];
    }
  }

  async function applySnippet(snippet) {
    if (applied.has(snippet.id)) return;
    applied.add(snippet.id);

    if (snippet.type === 'css') {
      // CSS goes through the background because insertCSS is privileged.
      // It is applied once and then stays until removed, so no watchdog.
      send({ type: 'applyCss', snippet });
      return;
    }

    await runJs(snippet);

    if (snippet.keepAlive) {
      startWatchdog(snippet);
    }
  }

  async function runJs(snippet) {
    // Main world execution has to happen from the background worker, since a
    // content script cannot reach into the page's own JavaScript context.
    return send({ type: 'runJs', snippet });
  }

  function send(message) {
    return chrome.runtime.sendMessage(message).catch(() => null);
  }

  // -------------------------------------------------------------------------
  // Timing
  // -------------------------------------------------------------------------

  // Resolves once the document has reached the requested readiness point.
  function waitFor(timing) {
    if (timing === 'document_start') return Promise.resolve();

    if (timing === 'dom_ready') {
      if (document.readyState !== 'loading') return Promise.resolve();
      return new Promise((resolve) => {
        document.addEventListener('DOMContentLoaded', resolve, { once: true });
      });
    }

    // 'load'
    if (document.readyState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      window.addEventListener('load', resolve, { once: true });
    });
  }

  // On the very first pass the background worker has already handled anything
  // marked document_start, from the navigation event, which fires earlier than
  // this script can ask for a snippet list. Later passes, after a route change
  // or an edit, are ours to run because no navigation event accompanies them.
  let skipDocumentStart = true;

  async function applyAll() {
    const snippets = await fetchSnippets();
    const startedWithSkip = skipDocumentStart;
    skipDocumentStart = false;

    if (!snippets.length) return;

    // Group by timing so each group waits once rather than once per snippet.
    const groups = new Map();
    for (const snippet of snippets) {
      const timing = snippet.timing || (snippet.type === 'css' ? 'document_start' : 'load');
      if (startedWithSkip && timing === 'document_start') {
        // Already applied by the worker. Record it so a later pass does not
        // treat it as new work.
        applied.add(snippet.id);
        if (snippet.type === 'js' && snippet.keepAlive) startWatchdog(snippet);
        continue;
      }
      if (!groups.has(timing)) groups.set(timing, []);
      groups.get(timing).push(snippet);
    }

    for (const [timing, group] of groups) {
      // Each timing group runs on its own schedule, so a snippet waiting for
      // load never holds up one that wanted document_start.
      waitFor(timing).then(async () => {
        for (const snippet of group) {
          await applySnippet(snippet);
        }
      });
    }
  }

  // -------------------------------------------------------------------------
  // Keep alive watchdog
  // -------------------------------------------------------------------------

  // Watches the document and re-runs the snippet when the page removes the
  // elements it created. This is opt in, because a subtree observer on a busy
  // site fires constantly.
  //
  // A snippet declares what to guard by calling jinset.keep(element) or by
  // setting data-jinset on the elements it creates. When none of those
  // elements are in the document any more, the snippet runs again.
  function startWatchdog(snippet) {
    stopWatchdog(snippet.id);

    const marker = `[data-jinset="${snippet.id}"]`;
    let timer = null;
    let armed = false;
    let reruns = 0;
    const debounceMs = 250;

    // A snippet that rebuilds itself in a loop, because the page keeps deleting
    // its work, would otherwise fight the site forever. This caps the argument.
    const maxReruns = 20;

    const check = () => {
      timer = null;

      if (document.querySelector(marker)) {
        // The snippet's elements are in the document, so from now on their
        // absence means the page removed them.
        armed = true;
        return;
      }

      // Before the snippet has ever marked anything there is nothing to guard.
      // The watchdog stays idle rather than re-running blindly.
      if (!armed) return;

      armed = false;
      if (reruns >= maxReruns) {
        stopWatchdog(snippet.id);
        return;
      }
      reruns += 1;

      // The snippet's own once() guards refer to work that no longer exists,
      // so clear them or the re-run would decide there was nothing to do.
      clearOnceFlags(snippet.id);
      runJs(snippet);
    };

    const schedule = () => {
      if (timer) return;
      timer = setTimeout(check, debounceMs);
    };

    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    watchdogs.set(snippet.id, {
      clear: () => {
        if (timer) clearTimeout(timer);
        observer.disconnect();
      },
    });

    // The snippet runs through the background worker, so its elements do not
    // exist yet when this is called. Arming has to wait for them to appear,
    // and polling briefly is more reliable than one guess at how long that
    // takes. The observer covers everything after the first sighting.
    let attempts = 0;
    const arm = () => {
      if (!watchdogs.has(snippet.id)) return;
      if (document.querySelector(marker)) {
        armed = true;
        return;
      }
      attempts += 1;
      if (attempts < 20) setTimeout(arm, 100);
    };
    arm();
  }

  // The once() helper records its guards as attributes on <html>, which the
  // content script can see even though the snippet itself ran in the main
  // world. Clearing them lets a snippet rebuild after its work was removed.
  function clearOnceFlags(id) {
    const prefix = `jinset:${id}:`;
    const root = document.documentElement;
    for (const name of [...root.getAttributeNames()]) {
      if (name.startsWith(prefix)) root.removeAttribute(name);
    }
  }

  function stopWatchdog(id) {
    const entry = watchdogs.get(id);
    if (!entry) return;
    entry.clear();
    watchdogs.delete(id);
  }

  function stopAllWatchdogs() {
    for (const id of [...watchdogs.keys()]) stopWatchdog(id);
  }

  // -------------------------------------------------------------------------
  // Navigation and change handling
  // -------------------------------------------------------------------------

  function onUrlChanged(url) {
    if (url === currentUrl) return;
    currentUrl = url;

    // A route change means a different set of snippets may apply, and any
    // JS snippet that ran against the old view needs to run again.
    stopAllWatchdogs();
    for (const id of applied) clearOnceFlags(id);
    applied.clear();

    // Debounce, because some apps fire several history events in a row.
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = null;
      applyAll();
    }, 50);
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (!message) return;

    if (message.type === 'urlChanged') {
      onUrlChanged(message.url || location.href);
    }

    if (message.type === 'snippetsChanged') {
      // The user edited or toggled something. Re-evaluate from scratch.
      stopAllWatchdogs();
      for (const id of applied) clearOnceFlags(id);
      applied.clear();
      applyAll();
    }
  });

  // Some apps change the URL without the history events the worker sees, so
  // this is a cheap safety net for the cases webNavigation misses.
  window.addEventListener('popstate', () => onUrlChanged(location.href));

  // Start.
  applyAll();
})();
