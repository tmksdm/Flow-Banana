// ============================================================
// Flow Banana Automator — Side Panel Controller
// Manages queue, orchestrates generation workflow
// ============================================================

const $ = (sel) => document.querySelector(sel);
const log = (msg, level = 'info') => {
  const el = $('#log');
  const time = new Date().toLocaleTimeString();
  const prefix = { info: '⚪', success: '🟢', warn: '🟡', error: '🔴' }[level] || '⚪';
  el.textContent += `${time} ${prefix} ${msg}\n`;
  el.scrollTop = el.scrollHeight;
};

// --- State ---
const state = {
  isRunning: false,
  stopRequested: false,
  flowTabId: null,
  queue: [],       // Array of { prompt, status: 'pending'|'running'|'done'|'failed' }
  currentIndex: 0,
  apiInterceptions: new Map()  // genId → response data
};

// --- UI Updates ---
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

  list.innerHTML = state.queue.map((item, i) => `
    <div class="queue-item">
      <span class="idx">${i + 1}</span>
      <span class="status-dot dot-${item.status}"></span>
      <span class="prompt-text" title="${item.prompt}">${item.prompt}</span>
    </div>
  `).join('');
}

function updateButtons() {
  $('#btnStart').disabled = state.isRunning || state.queue.length === 0;
  $('#btnStop').disabled = !state.isRunning;
}

// --- Find Flow Tab ---
async function findFlowTab() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_FLOW_TAB' }, (resp) => {
      state.flowTabId = resp?.tabId || null;
      resolve(state.flowTabId);
    });
  });
}

// --- Execute script in Flow tab (MAIN world) ---
async function execInFlow(funcBody, args = []) {
  if (!state.flowTabId) {
    await findFlowTab();
    if (!state.flowTabId) throw new Error('No Flow tab found');
  }
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      type: 'INJECT_SCRIPT',
      tabId: state.flowTabId,
      world: 'MAIN',
      funcBody: funcBody.toString(),
      args
    }, (resp) => {
      if (resp?.ok) resolve(resp.result);
      else reject(new Error(resp?.error || 'Injection failed'));
    });
  });
}

// --- Type prompt via CDP ---
async function typePrompt(text, submit = false) {
  if (!state.flowTabId) await findFlowTab();
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({
      type: 'CDP_TYPE_PROMPT',
      tabId: state.flowTabId,
      text,
      clearFirst: true,
      submit
    }, (resp) => resolve(resp));
  });
}

// --- Apply settings (mode, count, ratio) via UI clicks ---
async function applySettings() {
  const mode = $('#modeSelect').value;
  const count = $('#countSelect').value;
  const ratio = $('#ratioSelect').value;
  
  log(`Applying settings: mode=${mode}, count=x${count}, ratio=${ratio}`);
  
  try {
    await execInFlow(function(mode, count, ratio) {
      // Helper: find and click visible element matching selector
      const clickIfVisible = (selector) => {
        const el = document.querySelector(selector);
        if (el && el.getBoundingClientRect().width > 0) {
          el.click();
          return true;
        }
        return false;
      };
      
      // Helper: find settings trigger button
      const findSettingsBtn = () => {
        const btns = document.querySelectorAll('button[aria-haspopup="menu"]');
        for (const btn of btns) {
          if (btn.querySelector('[data-type="button-overlay"]')) return btn;
          const text = btn.textContent.toLowerCase();
          if (text.includes('banana') || text.includes('veo') || text.includes('crop_')) return btn;
        }
        return null;
      };

      // 1. Open settings menu
      const settingsBtn = findSettingsBtn();
      if (!settingsBtn) return { ok: false, error: 'Settings button not found' };
      settingsBtn.click();
      
      return { ok: true, settingsClicked: true };
    }, [mode, count, ratio]);
    
    // Wait for menu to open, then apply individual settings
    await new Promise(r => setTimeout(r, 500));
    
    // Apply mode tab
    const modeTab = {
      'text-to-image': 'IMAGE',
      'text-to-video': 'VIDEO',
      'image-to-video': 'VIDEO_FRAMES'
    }[mode] || 'IMAGE';
    
    await execInFlow(function(modeTab) {
      const tabBtn = document.querySelector(`button[role="tab"][id*="-trigger-${modeTab}"]`);
      if (tabBtn) tabBtn.click();
    }, [modeTab]);
    
    await new Promise(r => setTimeout(r, 200));
    
    // Apply count
    await execInFlow(function(count) {
      const countBtn = document.querySelector(`button[role="tab"][id*="-trigger-${count}"]`);
      if (countBtn) countBtn.click();
    }, [count]);
    
    await new Promise(r => setTimeout(r, 200));
    
    // Apply ratio
    const ratioMap = { '16:9': 'LANDSCAPE', '9:16': 'PORTRAIT', '1:1': 'SQUARE', '4:3': 'FOUR_THREE', '3:4': 'THREE_FOUR' };
    const ratioTab = ratioMap[ratio] || 'LANDSCAPE';
    await execInFlow(function(ratioTab) {
      const ratioBtn = document.querySelector(`button[role="tab"][id*="-trigger-${ratioTab}"]`);
      if (ratioBtn) ratioBtn.click();
    }, [ratioTab]);
    
    // Close menu by clicking outside
    await new Promise(r => setTimeout(r, 200));
    await execInFlow(function() {
      document.body.click();
    }, []);
    
    log('Settings applied', 'success');
    return true;
  } catch (e) {
    log(`Failed to apply settings: ${e.message}`, 'error');
    return false;
  }
}

// --- Wait for generation to complete ---
async function waitForGeneration(timeoutSec) {
  log(`Waiting up to ${timeoutSec}s for generation...`);
  const start = Date.now();
  const timeoutMs = timeoutSec * 1000;
  
  // Poll for new results appearing on the page
  while (Date.now() - start < timeoutMs) {
    if (state.stopRequested) return false;
    await new Promise(r => setTimeout(r, 3000));
    // Check for completion signals from API interceptor
    // TODO: Implement proper completion detection via FB_API_INTERCEPT messages
  }
  return true;
}

// --- Process single prompt ---
async function processPrompt(index) {
  const item = state.queue[index];
  item.status = 'running';
  renderQueue();
  
  log(`[${index + 1}/${state.queue.length}] Sending: "${item.prompt.substring(0, 50)}..."`);
  
  try {
    // Type and submit
    const result = await typePrompt(item.prompt, true);
    if (!result?.ok) {
      throw new Error(result?.error || 'CDP type failed');
    }
    
    log(`[${index + 1}] Prompt submitted`, 'success');
    
    // Wait for generation
    const waitTime = parseInt($('#waitTime').value) || 15;
    await waitForGeneration(waitTime);
    
    item.status = 'done';
    log(`[${index + 1}] Generation complete`, 'success');
  } catch (e) {
    item.status = 'failed';
    log(`[${index + 1}] Failed: ${e.message}`, 'error');
  }
  
  renderQueue();
}

// --- Main queue runner ---
async function runQueue() {
  state.isRunning = true;
  state.stopRequested = false;
  updateButtons();
  setStatus('Running...', 'running');
  
  // Find Flow tab
  await findFlowTab();
  if (!state.flowTabId) {
    log('No Flow tab found! Open labs.google/fx first.', 'error');
    setStatus('No Flow tab found', 'error');
    state.isRunning = false;
    updateButtons();
    return;
  }
  log(`Flow tab found: ${state.flowTabId}`);
  
  // Apply initial settings
  await applySettings();
  await new Promise(r => setTimeout(r, 500));
  
  // Process queue
  for (let i = 0; i < state.queue.length; i++) {
    if (state.stopRequested) {
      log('Stopped by user', 'warn');
      break;
    }
    
    state.currentIndex = i;
    await processPrompt(i);
    
    // Small delay between prompts
    if (i < state.queue.length - 1 && !state.stopRequested) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  
  // Cleanup
  state.isRunning = false;
  updateButtons();
  
  const done = state.queue.filter(q => q.status === 'done').length;
  const failed = state.queue.filter(q => q.status === 'failed').length;
  setStatus(`Done: ${done} complete, ${failed} failed`, done > 0 ? 'ready' : 'error');
  log(`Queue finished: ${done} done, ${failed} failed`, done > 0 ? 'success' : 'warn');
  
  // Detach CDP
  if (state.flowTabId) {
    chrome.runtime.sendMessage({ type: 'CDP_DETACH', tabId: state.flowTabId });
  }
}

// --- Event Listeners ---
$('#btnStart').addEventListener('click', () => {
  const text = $('#prompts').value.trim();
  if (!text) { log('No prompts entered', 'warn'); return; }
  
  // Parse prompts (one per line, blank lines ignored)
  state.queue = text.split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(prompt => ({ prompt, status: 'pending' }));
  
  if (state.queue.length === 0) { log('No valid prompts', 'warn'); return; }
  
  log(`Loaded ${state.queue.length} prompts into queue`);
  renderQueue();
  runQueue();
});

$('#btnStop').addEventListener('click', () => {
  state.stopRequested = true;
  log('Stop requested...', 'warn');
  setStatus('Stopping...', 'error');
});

// Listen for API interceptions from content script
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'FB_API_INTERCEPT') {
    log(`API: ${msg.apiType} intercepted`, 'info');
    // Store for completion detection
    state.apiInterceptions.set(Date.now(), msg);
  }
});

// --- Init ---
renderQueue();
updateButtons();
log('Flow Banana Automator v2.0 ready');
