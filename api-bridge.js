// ============================================================
// Flow Banana Automator — API Bridge (MAIN world)
// Provides: token refresh, reCAPTCHA, direct upscale API calls
// Communicates via window.postMessage with content.js
// ============================================================

(function () {
  if (window.__fbApiBridgeInstalled) return;
  window.__fbApiBridgeInstalled = true;

  const RECAPTCHA_SITE_KEY = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV';
  const API_BASE = 'https://aisandbox-pa.googleapis.com/v1';

  // ---- Helper: get access token ----
  async function getAccessToken() {
    try {
      // Flow has a built-in token refresh function
      if (typeof window.refreshAccessToken === 'function') {
        const result = await window.refreshAccessToken();
        // Can return string or object with accessToken field
        if (typeof result === 'string') return result;
        if (result?.accessToken) return result.accessToken;
        if (result?.access_token) return result.access_token;
        if (result?.token) return result.token;
        // If it's an object, try to find any string that looks like a token
        for (const val of Object.values(result || {})) {
          if (typeof val === 'string' && val.length > 30) return val;
        }
      }

      // Fallback: try to extract from existing fetch interceptor data
      // or from gapi auth
      if (window.gapi?.auth?.getToken) {
        const t = window.gapi.auth.getToken();
        if (t?.access_token) return t.access_token;
      }

      // Fallback: look for token in cookies or storage
      // (this is a last resort)
      return null;
    } catch (e) {
      console.error('[FlowBanana] getAccessToken error:', e);
      return null;
    }
  }

  // ---- Helper: get reCAPTCHA Enterprise token ----
  async function getRecaptchaToken(action = 'generate') {
    try {
      if (window.grecaptcha?.enterprise?.execute) {
        const token = await window.grecaptcha.enterprise.execute(RECAPTCHA_SITE_KEY, { action });
        return token;
      }
      // Fallback: try standard grecaptcha
      if (window.grecaptcha?.execute) {
        const token = await window.grecaptcha.execute(RECAPTCHA_SITE_KEY, { action });
        return token;
      }
      return null;
    } catch (e) {
      console.error('[FlowBanana] reCAPTCHA error:', e);
      return null;
    }
  }

  // ---- Extract projectId from URL ----
  function getProjectId() {
    const match = window.location.href.match(/\/project\/([^/?#]+)/);
    return match?.[1] || '';
  }

  // ---- Generate sessionId (UUID v4) ----
  function genSessionId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  // ---- Build clientContext ----
  function buildClientContext(recaptchaToken) {
    return {
      projectId: getProjectId(),
      tool: 'PINHOLE',
      userPaygateTier: 'PAYGATE_TIER_TWO',
      sessionId: genSessionId(),
      recaptchaContext: {
        token: recaptchaToken || '',
        applicationType: 'RECAPTCHA_APPLICATION_TYPE_WEB',
      },
    };
  }

  // ---- Image Upscale (Direct API) ----
  // Returns: { ok, encodedImage?, error? }
  async function upscaleImage(mediaId, resolution = '4k') {
    const accessToken = await getAccessToken();
    if (!accessToken) return { ok: false, error: 'NO_ACCESS_TOKEN' };

    const recaptchaToken = await getRecaptchaToken('generate');
    if (!recaptchaToken) return { ok: false, error: 'NO_RECAPTCHA_TOKEN' };

    const targetResolution = resolution === '4k'
      ? 'UPSAMPLE_IMAGE_RESOLUTION_4K'
      : 'UPSAMPLE_IMAGE_RESOLUTION_2K';

    const body = {
      mediaId,
      targetResolution,
      clientContext: buildClientContext(recaptchaToken),
    };

    try {
      // Use the native (non-intercepted) fetch to avoid recursive interception
      const _fetch = window.__fbNativeFetch || window.fetch;
      const resp = await _fetch(`${API_BASE}/flow/upsampleImage`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        return {
          ok: false,
          error: errData?.error?.message || `HTTP ${resp.status}`,
          code: resp.status,
          details: errData,
        };
      }

      const data = await resp.json();
      if (data?.encodedImage) {
        return { ok: true, encodedImage: data.encodedImage };
      }
      return { ok: false, error: 'NO_ENCODED_IMAGE_IN_RESPONSE', data };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ---- Video Upscale (Async — returns operation to poll) ----
  async function upscaleVideo(videoMediaId, resolution = '4k') {
    const accessToken = await getAccessToken();
    if (!accessToken) return { ok: false, error: 'NO_ACCESS_TOKEN' };

    const recaptchaToken = await getRecaptchaToken('generate');
    if (!recaptchaToken) return { ok: false, error: 'NO_RECAPTCHA_TOKEN' };

    const resEnum = resolution === '4k' ? 'VIDEO_RESOLUTION_4K' : 'VIDEO_RESOLUTION_1080P';
    const modelKey = resolution === '4k' ? 'veo_3_1_upsampler_4k' : 'veo_3_1_upsampler_1080p';

    const body = {
      requests: [{
        resolution: resEnum,
        videoModelKey: modelKey,
        videoMediaId,
        clientContext: buildClientContext(recaptchaToken),
      }],
    };

    try {
      const _fetch = window.__fbNativeFetch || window.fetch;
      const resp = await _fetch(`${API_BASE}/video:batchAsyncGenerateVideoUpsampleVideo`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        return { ok: false, error: errData?.error?.message || `HTTP ${resp.status}`, code: resp.status };
      }

      const data = await resp.json();
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ---- Video Status Poll ----
  async function checkVideoStatus(operationNames) {
    const accessToken = await getAccessToken();
    if (!accessToken) return { ok: false, error: 'NO_ACCESS_TOKEN' };

    try {
      const _fetch = window.__fbNativeFetch || window.fetch;
      const resp = await _fetch(`${API_BASE}/video:batchCheckAsyncVideoGenerationStatus`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ operationNames }),
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        return { ok: false, error: errData?.error?.message || `HTTP ${resp.status}` };
      }

      const data = await resp.json();
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ---- Save native fetch ref before interceptor replaces it ----
  // (interceptor.js may have already wrapped it; store original if available)
  if (!window.__fbNativeFetch) {
    // If interceptor stored it, great. Otherwise current fetch is fine for API bridge
    // because our own upscale calls won't match the interceptor patterns anyway.
    window.__fbNativeFetch = window.fetch;
  }

  // ---- Message handler: content.js sends commands here ----
  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.type !== 'FB_API_BRIDGE_CMD') return;

    let result;

    switch (msg.command) {
      case 'getAccessToken': {
        const token = await getAccessToken();
        result = { ok: !!token, token: token ? '***' : null, hasToken: !!token };
        break;
      }

      case 'upscaleImage': {
        result = await upscaleImage(msg.mediaId, msg.resolution || '4k');
        break;
      }

      case 'upscaleVideo': {
        result = await upscaleVideo(msg.videoMediaId, msg.resolution || '4k');
        break;
      }

      case 'checkVideoStatus': {
        result = await checkVideoStatus(msg.operationNames || []);
        break;
      }

      case 'ping': {
        result = { ok: true, pong: true };
        break;
      }

      default:
        result = { ok: false, error: 'UNKNOWN_COMMAND' };
    }

    // Send result back
    window.postMessage({
      type: 'FB_API_BRIDGE_RESULT',
      requestId: msg.requestId,
      result,
    }, '*');
  });

  console.log('[FlowBanana] API Bridge v3 installed');
})();
