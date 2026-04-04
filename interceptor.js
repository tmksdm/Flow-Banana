// ============================================================
// Flow Banana Automator — Fetch Interceptor (MAIN world)
// Monitors API calls, parses batchGenerateImages responses
// to extract mediaGenerationId for upscaling
// ============================================================

(function () {
  if (window.__fbInterceptorInstalled) return;
  window.__fbInterceptorInstalled = true;

  const nativeFetch = window.fetch.bind(window);

  // ---- URL classification ----
  const API_PATTERNS = [
    { key: 'batchGenerate',  re: /batchgenerateimages/i },
    { key: 'upsample',       re: /upsampleimage/i },
    { key: 'videoGenerate',  re: /generatevideo|batchasyncgeneratevideo(?!upsample)/i },
    { key: 'videoUpsample',  re: /batchasyncgeneratevideoupsamplevideo/i },
    { key: 'statusCheck',    re: /batchcheckasync|generationstatus|videogenerationstatus/i },
  ];

  function classifyUrl(url) {
    const lower = (url || '').toLowerCase();
    for (const p of API_PATTERNS) {
      if (p.re.test(lower)) return p.key;
    }
    return null;
  }

  // ---- Deep search for mediaGenerationId in any nested structure ----
  function extractMediaIds(obj, depth = 0) {
    if (depth > 12 || !obj || typeof obj !== 'object') return [];
    const ids = [];

    if (Array.isArray(obj)) {
      for (const item of obj) {
        ids.push(...extractMediaIds(item, depth + 1));
      }
      return ids;
    }

    // Direct property
    if (typeof obj.mediaGenerationId === 'string' && obj.mediaGenerationId.length > 5) {
      ids.push({
        mediaGenerationId: obj.mediaGenerationId,
        // Try to get associated base64 thumbnail (1K original)
        imageBytes: obj.image?.imageBytes || obj.imageBytes || null,
        mimeType: obj.image?.mimeType || obj.mimeType || 'image/jpeg',
      });
    }

    // Recurse into all object values
    for (const val of Object.values(obj)) {
      if (val && typeof val === 'object') {
        ids.push(...extractMediaIds(val, depth + 1));
      }
    }
    return ids;
  }

  // ---- Extract video operation names for polling ----
  function extractVideoOps(obj, depth = 0) {
    if (depth > 10 || !obj || typeof obj !== 'object') return [];
    const ops = [];
    if (Array.isArray(obj)) {
      for (const item of obj) ops.push(...extractVideoOps(item, depth + 1));
      return ops;
    }
    if (typeof obj.name === 'string' && obj.name.includes('operation')) {
      ops.push({ name: obj.name, done: !!obj.done });
    }
    for (const val of Object.values(obj)) {
      if (val && typeof val === 'object') {
        ops.push(...extractVideoOps(val, depth + 1));
      }
    }
    return ops;
  }

  // ---- Post message to content script ----
  function emit(apiType, payload) {
    window.postMessage({
      type: 'FB_API_INTERCEPT',
      apiType,
      ...payload,
      timestamp: Date.now(),
    }, '*');
  }

  // ---- Intercept fetch ----
  window.fetch = async function (...args) {
    const req = args[0];
    const url = typeof req === 'string' ? req : req?.url || '';
    const apiType = classifyUrl(url);

    if (!apiType) return nativeFetch.apply(this, args);

    let response;
    try {
      response = await nativeFetch.apply(this, args);
    } catch (e) {
      emit(apiType, { error: e.message, endpoint: url });
      throw e;
    }

    // Clone and parse response asynchronously (don't block the app)
    try {
      const clone = response.clone();

      // batchGenerateImages returns JSON with generated images
      if (apiType === 'batchGenerate') {
        clone.json().then(data => {
          const mediaIds = extractMediaIds(data);
          emit('batchGenerate', {
            endpoint: url,
            mediaIds,
            imageCount: mediaIds.length,
            rawKeys: Object.keys(data),
          });
          console.log('[FlowBanana] batchGenerate intercepted:', mediaIds.length, 'images');
        }).catch(() => {});

      } else if (apiType === 'upsample') {
        // upsample returns { encodedImage: "base64..." }
        clone.json().then(data => {
          emit('upsample', {
            endpoint: url,
            hasEncodedImage: !!data?.encodedImage,
            encodedImageLength: data?.encodedImage?.length || 0,
          });
        }).catch(() => {});

      } else if (apiType === 'videoGenerate') {
        clone.json().then(data => {
          const ops = extractVideoOps(data);
          emit('videoGenerate', {
            endpoint: url,
            operations: ops,
          });
        }).catch(() => {});

      } else if (apiType === 'videoUpsample') {
        clone.json().then(data => {
          const ops = extractVideoOps(data);
          emit('videoUpsample', {
            endpoint: url,
            operations: ops,
          });
        }).catch(() => {});

      } else if (apiType === 'statusCheck') {
        clone.json().then(data => {
          emit('statusCheck', {
            endpoint: url,
            data,
          });
        }).catch(() => {});

      } else {
        clone.json().then(data => {
          emit(apiType, { endpoint: url, data });
        }).catch(() => {});
      }
    } catch (_) {
      // Silently fail — never break the app
    }

    return response;
  };

  console.log('[FlowBanana] API interceptor v3 installed');
})();
