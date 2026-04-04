// ============================================================
// Flow Banana Automator — Content Script
// Injected into labs.google/fx/* pages
// Bootstraps the API interceptor in MAIN world
// ============================================================

(function() {
  if (window.__flowBananaContentLoaded) return;
  window.__flowBananaContentLoaded = true;

  // Inject fetch interceptor into MAIN world
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('interceptor.js');
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);

  // Relay intercepted API messages to extension
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.type === 'FB_API_INTERCEPT') {
      chrome.runtime.sendMessage(event.data).catch(() => {});
    }
  });

  console.log('[FlowBanana] Content script loaded');
})();
