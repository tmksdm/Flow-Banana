// ============================================================
// Flow Banana Automator — Fetch Interceptor (MAIN world)
// Monitors API calls for generation completion and upscaling
// ============================================================

(function() {
  if (window.__fbInterceptorInstalled) return;
  window.__fbInterceptorInstalled = true;

  const nativeFetch = window.fetch.bind(window);

  const API_PATTERNS = {
    batchGenerate: /batchgenerateimages/i,
    upsample: /upsampleimage/i,
    videoGenerate: /generatevideo|batchasyncgenerate/i,
    statusCheck: /batchcheckasync|generationstatus|videogenerationstatus/i
  };

  function classifyUrl(url) {
    const lower = (url || '').toLowerCase();
    if (API_PATTERNS.upsample.test(lower)) return 'upsample';
    if (API_PATTERNS.batchGenerate.test(lower)) return 'batchGenerate';
    if (API_PATTERNS.videoGenerate.test(lower)) return 'videoGenerate';
    if (API_PATTERNS.statusCheck.test(lower)) return 'statusCheck';
    return null;
  }

  window.fetch = async function(...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
    const type = classifyUrl(url);

    if (!type) return nativeFetch.apply(this, args);

    const response = await nativeFetch.apply(this, args);
    
    // Clone and read the response for interception
    try {
      const clone = response.clone();
      clone.json().then(data => {
        window.postMessage({
          type: 'FB_API_INTERCEPT',
          apiType: type,
          endpoint: url,
          data: data,
          timestamp: Date.now()
        }, '*');
      }).catch(() => {});
    } catch (e) {
      // Silently fail - don't break the app
    }

    return response;
  };

  console.log('[FlowBanana] API interceptor installed');
})();
