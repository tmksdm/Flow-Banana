// ============================================================
// Flow Banana Automator — Side Panel Controller v3
// Event-driven: listens for API interceptions to detect
// generation completion, then upscales and downloads
// ============================================================

const $ = (sel) => document.querySelector(sel);

// ---- Logging ----
const LOG_ICONS = { info: '⚪', success: '🟢', warn: '🟡', error: '🔴' };
function log(msg, level = 'info') {
  const el = $('#log');
  const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
  el.textContent += `${time} ${LOG_ICONS[level] || '⚪'} ${msg}\n`;
  el.scrollTop = el.scrollHeight;
}

// ============================================================
// STATE
// ============================================================
const state = {
  isRunning: false,
  stopRequested: false,
  flowTabId: null,
  queue: [],          // [{ prompt, status, images: [], detail: '' }]
  currentIndex: -1,

  // Event-driven: pending promise resolvers for API interception
  pendingGenResolve: null,   // Resolved when batchGenerate response arrives
  pendingBridgeResolvers: new Map(), // requestId → { resolve, timer }
};

// ============================================================
// UI
// ============================================================
function setStatus(text, type = 'ready') {
  const el = $('#status');
  el.textContent = text;
  el.className = `status-${type}`;
}

function renderQueue() {
  const list = $('#queueList');
  const count = $('#queueCount');
  count.textContent = state.queue.length;

  if (state.queue.length === 0) {
    list.innerHTML = '<div style="color:var(--text-dim);text-align:center;padding:12px;">No prompts in queue</div>';
    return;
  }

  list.innerHTML = state.queue.map((item, i) => {
    const detailHtml = item.detail ? `<span class="detail">${item.detail}</span>` : '';
    return `
    <div class="queue-item">
      <span class="idx">${i + 1}</span>
      <span class="status-dot dot-${item.status}"></span>
      <span class="prompt-text" title="${escapeHtml(item.prompt)}">${escapeHtml(item.prompt)}</span>
      ${detailHtml}
    </div>`;
  }).join('');
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function updateButtons() {
  $('#btnStart').disabled = state.isRunning;
  $('#btnStop').disabled = !state.isRunning;
}

// ============================================================
// COMMUNICATION HELPERS
// ============================================================

// Send message to background service worker
function sendBg(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(resp || { ok: false, error: 'NO_RESPONSE' });
      }
    });
  });
}

// Find the active Flow tab
async function findFlowTab() {
  const resp = await sendBg({ type: 'GET_FLOW_TAB' });
  state.flowTabId = resp?.tabId || null;
  return state.flowTabId;
}

// Execute function in Flow tab MAIN world
async function execInFlow(funcBody, args = []) {
  if (!state.flowTabId) {
    await findFlowTab();
    if (!state.flowTabId) throw new Error('No Flow tab found');
  }
  const resp = await sendBg({
    type: 'INJECT_SCRIPT',
    tabId: state.flowTabId,
    world: 'MAIN',
    funcBody: funcBody.toString(),
    args,
  });
  if (!resp?.ok) throw new Error(resp?.error || 'Injection failed');
  return resp.result;
}

// Send command to API bridge (via background → content → MAIN world)
// Returns a promise that resolves when the bridge posts back
function callApiBridge(command, params = {}, timeoutMs = 120000) {
  return new Promise(async (resolve) => {
    if (!state.flowTabId) {
      await findFlowTab();
      if (!state.flowTabId) { resolve({ ok: false, error: 'NO_FLOW_TAB' }); return; }
    }

    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Set up timeout
    const timer = setTimeout(() => {
      state.pendingBridgeResolvers.delete(requestId);
      resolve({ ok: false, error: 'TIMEOUT' });
    }, timeoutMs);

    // Register resolver
    state.pendingBridgeResolvers.set(requestId, { resolve, timer });

    // Send command through content script
    const msg = {
      type: 'FB_API_BRIDGE_CMD',
      command,
      requestId,
      ...params,
    };

    await sendBg({ type: 'SEND_TO_TAB', tabId: state.flowTabId, payload: msg });
  });
}

// ============================================================
// GENERATION DETECTION (Event-driven)
// ============================================================

// Wait for batchGenerateImages response from interceptor
// Returns: array of { mediaGenerationId, imageBytes?, mimeType? }
function waitForBatchGenerate(timeoutMs = 180000) {
  return new Promise((resolve) => {
    // If there's already a pending waiter, clear it
    if (state.pendingGenResolve) {
      state.pendingGenResolve(null);
    }

    const timer = setTimeout(() => {
      state.pendingGenResolve = null;
      resolve(null); // timeout — caller should fallback
    }, timeoutMs);

    state.pendingGenResolve = (data) => {
      clearTimeout(timer);
      state.pendingGenResolve = null;
      resolve(data);
    };
  });
}

// ============================================================
// MESSAGE LISTENER (intercepts from content.js/background)
// ============================================================

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg?.type) return;

  // ---- API Interception events ----
  if (msg.type === 'FB_API_INTERCEPT') {
    handleApiIntercept(msg);
  }

  // ---- API Bridge results ----
  if (msg.type === 'FB_API_BRIDGE_RESULT') {
    const entry = state.pendingBridgeResolvers.get(msg.requestId);
    if (entry) {
      clearTimeout(entry.timer);
      state.pendingBridgeResolvers.delete(msg.requestId);
      entry.resolve(msg.result);
    }
  }
});

function handleApiIntercept(msg) {
  const { apiType } = msg;

  if (apiType === 'batchGenerate') {
    log(`API: batchGenerateImages → ${msg.imageCount || 0} images detected`);
    if (state.pendingGenResolve && msg.mediaIds?.length > 0) {
      state.pendingGenResolve(msg.mediaIds);
    }
  } else if (apiType === 'videoGenerate') {
    log(`API: videoGenerate → ${msg.operations?.length || 0} operations`);
  } else if (apiType === 'statusCheck') {
    log(`API: statusCheck`);
  } else {
    log(`API: ${apiType}`);
  }
}

// ============================================================
// TYPE + SUBMIT via CDP
// ============================================================
async function typeAndSubmit(text) {
  if (!state.flowTabId) await findFlowTab();
  const resp = await sendBg({
    type: 'CDP_TYPE_PROMPT',
    tabId: state.flowTabId,
    text,
    clearFirst: true,
    submit: true,
  });
  return resp;
}

// ============================================================
// APPLY SETTINGS (mode, count, ratio)
// ============================================================
async function applySettings() {
  const mode = $('#modeSelect').value;
  const count = $('#countSelect').value;
  const ratio = $('#ratioSelect').value;

  log(`Settings: mode=${mode}, count=x${count}, ratio=${ratio}`);

  try {
    // 1. Open settings menu
    await execInFlow(function () {
      const btns = document.querySelectorAll('button[aria-haspopup="menu"]');
      for (const btn of btns) {
        if (btn.querySelector('[data-type="button-overlay"]')) { btn.click(); return true; }
        const text = btn.textContent.toLowerCase();
        if (text.includes('banana') || text.includes('veo') || text.includes('crop_')) { btn.click(); return true; }
      }
      // Fallback: look for any settings-like button with crop icon
      const allBtns = document.querySelectorAll('button');
      for (const btn of allBtns) {
        if (btn.textContent.includes('crop_') || btn.textContent.includes('tune')) {
          btn.click(); return true;
        }
      }
      return false;
    });

    await sleep(500);

    // 2. Mode tab
    const modeTab = {
      'text-to-image': 'IMAGE',
      'text-to-video': 'VIDEO',
    }[mode] || 'IMAGE';
    await execInFlow(function (tab) {
      const btn = document.querySelector(`button[role="tab"][id*="-trigger-${tab}"]`);
      if (btn) btn.click();
    }, [modeTab]);
    await sleep(200);

    // 3. Count tab
    await execInFlow(function (count) {
      const btn = document.querySelector(`button[role="tab"][id*="-trigger-${count}"]`);
      if (btn) btn.click();
    }, [count]);
    await sleep(200);

    // 4. Ratio tab
    const ratioMap = {
      '16:9': 'LANDSCAPE', '9:16': 'PORTRAIT', '1:1': 'SQUARE',
      '4:3': 'FOUR_THREE', '3:4': 'THREE_FOUR'
    };
    await execInFlow(function (ratioTab) {
      const btn = document.querySelector(`button[role="tab"][id*="-trigger-${ratioTab}"]`);
      if (btn) btn.click();
    }, [ratioMap[ratio] || 'LANDSCAPE']);
    await sleep(200);

    // 5. Close menu
    await execInFlow(function () {
      document.body.click();
    });
    await sleep(300);

    log('Settings applied', 'success');
  } catch (e) {
    log(`Settings error: ${e.message}`, 'error');
  }
}

// ============================================================
// UPSCALE + DOWNLOAD
// ============================================================

function sanitizeFilename(prompt, index, suffix = '') {
  let name = prompt.substring(0, 80)
    .replace(/[<>:"/\\|?*\n\r]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  if (!name) name = 'image';
  return `FlowBanana/${name}_${index + 1}${suffix}.jpg`;
}

async function upscaleAndDownloadImage(mediaId, prompt, imgIndex, resolution) {
  log(`  Upscaling image ${imgIndex + 1} to ${resolution}...`);

  const result = await callApiBridge('upscaleImage', {
    mediaId,
    resolution,
  }, 120000); // 2 min timeout for 4K

  if (!result?.ok) {
    log(`  Upscale failed: ${result?.error || 'unknown'}`, 'error');
    return false;
  }

  if (!result.encodedImage) {
    log(`  Upscale returned no image data`, 'error');
    return false;
  }

  log(`  Upscale done (${Math.round(result.encodedImage.length / 1024)}KB base64). Downloading...`);

  // Download via background
  const filename = sanitizeFilename(prompt, imgIndex, `_${resolution}`);
  const dlResp = await sendBg({
    type: 'DOWNLOAD_BASE64',
    base64: result.encodedImage,
    filename,
    mimeType: 'image/jpeg',
  });

  if (dlResp?.ok) {
    log(`  Downloaded: ${filename}`, 'success');
    return true;
  } else {
    log(`  Download failed: ${dlResp?.error}`, 'error');
    return false;
  }
}

async function downloadOriginalImage(imageBytes, mimeType, prompt, imgIndex) {
  if (!imageBytes) {
    log(`  No original image bytes for image ${imgIndex + 1}`, 'warn');
    return false;
  }

  const filename = sanitizeFilename(prompt, imgIndex, '_1k');
  const dlResp = await sendBg({
    type: 'DOWNLOAD_BASE64',
    base64: imageBytes,
    filename,
    mimeType: mimeType || 'image/jpeg',
  });

  if (dlResp?.ok) {
    log(`  Downloaded original: ${filename}`, 'success');
    return true;
  } else {
    log(`  Download failed: ${dlResp?.error}`, 'error');
    return false;
  }
}

// ============================================================
// PROCESS SINGLE PROMPT
// ============================================================
async function processPrompt(index) {
  const item = state.queue[index];
  item.status = 'running';
  item.detail = 'generating...';
  renderQueue();

  const shortPrompt = item.prompt.substring(0, 50) + (item.prompt.length > 50 ? '…' : '');
  log(`[${index + 1}/${state.queue.length}] "${shortPrompt}"`);

  try {
    // ---- 1. Start listening for batchGenerate BEFORE submitting ----
    const genPromise = waitForBatchGenerate(180000); // 3 min max

    // ---- 2. Type and submit ----
    const typeResult = await typeAndSubmit(item.prompt);
    if (!typeResult?.ok) {
      throw new Error(typeResult?.error || 'CDP type failed');
    }
    log(`  Prompt submitted. Waiting for generation...`);

    // ---- 3. Wait for generation to complete ----
    const mediaIds = await genPromise;

    if (!mediaIds || mediaIds.length === 0) {
      log(`  No mediaIds received (timeout or no interception). Trying fallback...`, 'warn');
      // Fallback: wait a fixed time and hope for the best
      item.status = 'done';
      item.detail = 'done (no download — no mediaIds)';
      renderQueue();
      return;
    }

    log(`  Generation complete: ${mediaIds.length} images received`);
    item.images = mediaIds;

    // ---- 4. Upscale + Download ----
    const downloadRes = $('#downloadRes').value;

    if (downloadRes === 'none') {
      item.status = 'done';
      item.detail = `${mediaIds.length} images (no download)`;
      renderQueue();
      return;
    }

    item.status = 'upscaling';
    item.detail = `upscaling ${mediaIds.length} images to ${downloadRes}...`;
    renderQueue();
    setStatus(`Upscaling ${mediaIds.length} images to ${downloadRes}...`, 'upscaling');

    let downloaded = 0;
    for (let i = 0; i < mediaIds.length; i++) {
      if (state.stopRequested) break;

      const img = mediaIds[i];

      if (downloadRes === '1k') {
        // Download original (base64 from generation response)
        const ok = await downloadOriginalImage(img.imageBytes, img.mimeType, item.prompt, i);
        if (ok) downloaded++;
      } else {
        // Upscale to 2K or 4K via direct API
        const ok = await upscaleAndDownloadImage(img.mediaGenerationId, item.prompt, i, downloadRes);
        if (ok) downloaded++;

        // Small delay between upscale calls to avoid rate limiting
        if (i < mediaIds.length - 1) await sleep(2000);
      }
    }

    item.status = 'done';
    item.detail = `${downloaded}/${mediaIds.length} downloaded`;
    log(`  [${index + 1}] Done: ${downloaded}/${mediaIds.length} images`, 'success');

  } catch (e) {
    item.status = 'failed';
    item.detail = e.message;
    log(`  [${index + 1}] Failed: ${e.message}`, 'error');
  }

  renderQueue();
}

// ============================================================
// QUEUE RUNNER
// ============================================================
async function runQueue() {
  state.isRunning = true;
  state.stopRequested = false;
  updateButtons();
  setStatus('Starting...', 'running');

  // Find Flow tab
  await findFlowTab();
  if (!state.flowTabId) {
    log('No Flow tab found! Open labs.google/fx first.', 'error');
    setStatus('No Flow tab found', 'error');
    state.isRunning = false;
    updateButtons();
    return;
  }
  log(`Flow tab: ${state.flowTabId}`);

  // Test API bridge connectivity
  log('Testing API bridge...');
  const pingResult = await callApiBridge('ping', {}, 5000);
  if (!pingResult?.ok) {
    log('API bridge not responding. Reloading may help.', 'error');
    setStatus('API bridge error', 'error');
    state.isRunning = false;
    updateButtons();
    return;
  }
  log('API bridge OK', 'success');

  // Apply settings
  await applySettings();
  await sleep(500);

  // Process queue
  const delayBetween = (parseInt($('#delayBetween').value) || 3) * 1000;

  for (let i = 0; i < state.queue.length; i++) {
    if (state.stopRequested) {
      log('Stopped by user', 'warn');
      // Mark remaining as pending
      for (let j = i; j < state.queue.length; j++) {
        if (state.queue[j].status === 'pending') break; // already pending
      }
      break;
    }

    state.currentIndex = i;
    setStatus(`Processing ${i + 1}/${state.queue.length}...`, 'running');
    await processPrompt(i);

    // Delay between prompts
    if (i < state.queue.length - 1 && !state.stopRequested) {
      log(`Waiting ${delayBetween / 1000}s before next prompt...`);
      await sleep(delayBetween);
    }
  }

  // Cleanup
  state.isRunning = false;
  updateButtons();

  const done = state.queue.filter(q => q.status === 'done').length;
  const failed = state.queue.filter(q => q.status === 'failed').length;
  const totalImages = state.queue.reduce((sum, q) => sum + (q.images?.length || 0), 0);
  setStatus(`Done: ${done}/${state.queue.length} prompts, ${totalImages} images`, done > 0 ? 'ready' : 'error');
  log(`Queue finished: ${done} done, ${failed} failed, ${totalImages} total images`, done > 0 ? 'success' : 'warn');

  // Detach CDP
  if (state.flowTabId) {
    sendBg({ type: 'CDP_DETACH', tabId: state.flowTabId });
  }
}

// ============================================================
// EVENT LISTENERS
// ============================================================

$('#btnStart').addEventListener('click', () => {
  const text = $('#prompts').value.trim();
  if (!text) { log('No prompts entered', 'warn'); return; }

  state.queue = text.split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(prompt => ({ prompt, status: 'pending', images: [], detail: '' }));

  if (state.queue.length === 0) { log('No valid prompts', 'warn'); return; }

  log(`Loaded ${state.queue.length} prompts`);
  renderQueue();
  runQueue();
});

$('#btnStop').addEventListener('click', () => {
  state.stopRequested = true;
  log('Stop requested...', 'warn');
  setStatus('Stopping...', 'error');
});

$('#btnTestBridge').addEventListener('click', async () => {
  log('Testing API bridge connectivity...');
  await findFlowTab();
  if (!state.flowTabId) {
    log('No Flow tab found', 'error');
    return;
  }

  const ping = await callApiBridge('ping', {}, 5000);
  if (ping?.ok) {
    log('API bridge: connected', 'success');
  } else {
    log(`API bridge: ${ping?.error || 'no response'}`, 'error');
  }

  // Test access token
  const tokenResult = await callApiBridge('getAccessToken', {}, 10000);
  if (tokenResult?.hasToken) {
    log('Access token: available', 'success');
  } else {
    log('Access token: NOT available', 'error');
  }
});

$('#btnClearLog').addEventListener('click', () => {
  $('#log').textContent = '';
});

// ============================================================
// UTILITY
// ============================================================
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ============================================================
// INIT
// ============================================================
renderQueue();
updateButtons();
log('Flow Banana Automator v3.0 ready');
log('1. Open labs.google/fx in a tab');
log('2. Enter prompts (one per line)');
log('3. Choose settings and click Start');
