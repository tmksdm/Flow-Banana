// ============================================================
// Flow Banana Automator — Content Script
// Injected into labs.google/fx/* pages
// Bootstraps interceptor.js and api-bridge.js in MAIN world
// Relays messages between MAIN world and extension background
// ============================================================

(function () {
  if (window.__flowBananaContentLoaded) return;
  window.__flowBananaContentLoaded = true;

  // ---- Inject a MAIN-world script ----
  function injectScript(filename) {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL(filename);
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
  }

  // Order matters: interceptor first (wraps fetch), then api-bridge (saves native fetch ref)
  // Actually, api-bridge needs to save the *native* fetch before interceptor wraps it.
  // So inject api-bridge FIRST.
  injectScript('api-bridge.js');

  // Small delay to ensure api-bridge captures native fetch
  setTimeout(() => {
    injectScript('interceptor.js');
  }, 50);

  // ---- Relay: MAIN world → extension ----
  // Forwards FB_API_INTERCEPT and FB_API_BRIDGE_RESULT to the extension
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;

    if (msg?.type === 'FB_API_INTERCEPT') {
      // Forward to extension (sidepanel listens)
      chrome.runtime.sendMessage(msg).catch(() => {});
    }

    if (msg?.type === 'FB_API_BRIDGE_RESULT') {
      // Forward to extension (sidepanel listens)
      chrome.runtime.sendMessage(msg).catch(() => {});
    }
  });

  // ---- Relay: extension → MAIN world ----
  // Sidepanel sends FB_API_BRIDGE_CMD via chrome.tabs.sendMessage → here → postMessage
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'FB_API_BRIDGE_CMD') {
      window.postMessage(msg, '*');
      sendResponse({ ok: true, relayed: true });
      return;
    }

    // Also handle direct DOM queries from sidepanel
    if (msg?.type === 'DOM_QUERY') {
      try {
        const result = handleDomQuery(msg);
        sendResponse(result);
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
      return;
    }
  });

  // ---- DOM query handlers ----
  function handleDomQuery(msg) {
    switch (msg.query) {
      case 'isEditorReady': {
        const editor = document.querySelector('[data-slate-editor="true"]');
        return { ok: true, ready: !!editor };
      }
      case 'getProjectId': {
        const match = window.location.href.match(/\/project\/([^/?#]+)/);
        return { ok: true, projectId: match?.[1] || '' };
      }
      default:
        return { ok: false, error: 'UNKNOWN_QUERY' };
    }
  }

  console.log('[FlowBanana] Content script v3 loaded');
})();
