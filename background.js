// ============================================================
// Flow Banana Automator — Background Service Worker
// Handles: side panel, CDP typing, downloads, message routing
// ============================================================

const CDP_VERSION = '1.3';
const attachedTabs = new Set();

// --- Side Panel ---
chrome.action.onClicked.addListener((tab) => {
  if (tab?.id) {
    chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

// --- CDP Debugger Helpers ---
function cdpAttach(tabId) {
  return new Promise((resolve) => {
    if (attachedTabs.has(tabId)) { resolve(true); return; }
    chrome.debugger.attach({ tabId }, CDP_VERSION, () => {
      const err = chrome.runtime.lastError?.message || '';
      if (err) {
        if (err.includes('already attached')) { attachedTabs.add(tabId); resolve(true); return; }
        resolve(false); return;
      }
      attachedTabs.add(tabId);
      resolve(true);
    });
  });
}

function cdpDetach(tabId) {
  return new Promise((resolve) => {
    if (!attachedTabs.has(tabId)) { resolve(true); return; }
    chrome.debugger.detach({ tabId }, () => {
      attachedTabs.delete(tabId);
      resolve(true);
    });
  });
}

function cdpSend(tabId, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      const err = chrome.runtime.lastError?.message || '';
      if (err) {
        if (err.includes('not attached')) attachedTabs.delete(tabId);
        reject(new Error(err));
        return;
      }
      resolve(result);
    });
  });
}

async function cdpEnsure(tabId) {
  if (!attachedTabs.has(tabId)) {
    await cdpAttach(tabId);
  }
}

// --- CDP Key helpers ---
function keyMeta(ch) {
  if (ch === '\n') return { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' };
  if (ch === ' ') return { key: ' ', code: 'Space', keyCode: 32, text: ' ' };
  if (/^[a-zA-Z]$/.test(ch)) {
    const upper = ch.toUpperCase();
    return { key: ch, code: `Key${upper}`, keyCode: upper.charCodeAt(0), text: ch };
  }
  return { key: ch, code: '', keyCode: ch.charCodeAt(0) || 0, text: ch };
}

// --- CDP Focus editor → clear → type → (optionally) click Create ---
async function cdpTypePrompt(tabId, text, options = {}) {
  const { clearFirst = true, submit = false } = options;
  
  await cdpEnsure(tabId);
  await cdpSend(tabId, 'Page.bringToFront', {});

  // 1. Find compose editor coordinates
  const probe = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      const editor =
        document.querySelector("[data-slate-editor='true'][contenteditable='true']") ||
        document.querySelector("[data-slate-editor='true'][contenteditable='plaintext-only']") ||
        document.querySelector("div[role='textbox'][contenteditable='true']");
      if (!editor) return { ok: false, error: 'EDITOR_NOT_FOUND' };
      const rect = editor.getBoundingClientRect();
      const x = Math.round(rect.left + Math.min(24, rect.width * 0.08));
      const y = Math.round(rect.top + rect.height * 0.5);
      editor.focus();
      
      // Find submit button
      let submitRect = null;
      const buttons = document.querySelectorAll('button, [role="button"]');
      for (const btn of buttons) {
        const icons = btn.querySelectorAll('i, .material-symbols-outlined');
        for (const icon of icons) {
          if (icon.textContent.trim() === 'arrow_forward') {
            const sr = btn.getBoundingClientRect();
            if (sr.width > 8 && sr.height > 8) {
              submitRect = { left: sr.left, top: sr.top, width: sr.width, height: sr.height };
            }
            break;
          }
        }
        if (submitRect) break;
      }
      
      return { ok: true, x, y, submitRect };
    }
  });

  const result = probe?.[0]?.result;
  if (!result?.ok) return { ok: false, error: result?.error || 'EDITOR_NOT_FOUND' };

  // 2. Click into editor
  const { x, y } = result;
  await cdpSend(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await cdpSend(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });

  // 3. Select All + Delete (clear)
  if (clearFirst) {
    // Ctrl+A (or Cmd+A on Mac)
    const modifiers = 2; // Ctrl
    await cdpSend(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers, windowsVirtualKeyCode: 65 });
    await cdpSend(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers, windowsVirtualKeyCode: 65 });
    await cdpSend(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await cdpSend(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await new Promise(r => setTimeout(r, 50));
  }

  // 4. Type text character by character
  for (const ch of text) {
    const meta = keyMeta(ch);
    await cdpSend(tabId, 'Input.dispatchKeyEvent', {
      type: 'keyDown', key: meta.key, code: meta.code, text: meta.text,
      windowsVirtualKeyCode: meta.keyCode, nativeVirtualKeyCode: meta.keyCode
    });
    await cdpSend(tabId, 'Input.dispatchKeyEvent', {
      type: 'char', key: meta.key, code: meta.code, text: meta.text,
      windowsVirtualKeyCode: meta.keyCode, nativeVirtualKeyCode: meta.keyCode
    });
    await cdpSend(tabId, 'Input.dispatchKeyEvent', {
      type: 'keyUp', key: meta.key, code: meta.code,
      windowsVirtualKeyCode: meta.keyCode, nativeVirtualKeyCode: meta.keyCode
    });
    // Small delay between keystrokes
    await new Promise(r => setTimeout(r, 12 + Math.random() * 18));
  }

  // 5. Optionally click Create button
  if (submit && result.submitRect) {
    await new Promise(r => setTimeout(r, 100));
    const sx = Math.round(result.submitRect.left + result.submitRect.width / 2);
    const sy = Math.round(result.submitRect.top + result.submitRect.height / 2);
    await cdpSend(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: sx, y: sy, button: 'left', clickCount: 1 });
    await cdpSend(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: sx, y: sy, button: 'left', clickCount: 1 });
  }

  return { ok: true };
}

// --- Download with custom filename ---
function downloadFile(url, filename) {
  return new Promise((resolve) => {
    chrome.downloads.download(
      { url, filename, conflictAction: 'uniquify' },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          resolve({ ok: true, downloadId });
        }
      }
    );
  });
}

// --- Message Router ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg?.type) return;

  switch (msg.type) {
    case 'CDP_TYPE_PROMPT': {
      const tabId = msg.tabId;
      if (!Number.isInteger(tabId)) {
        sendResponse({ ok: false, error: 'BAD_TAB_ID' });
        return true;
      }
      cdpTypePrompt(tabId, msg.text || '', {
        clearFirst: msg.clearFirst !== false,
        submit: !!msg.submit
      }).then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
      return true; // async
    }

    case 'CDP_DETACH': {
      const tabId = msg.tabId;
      if (Number.isInteger(tabId)) cdpDetach(tabId);
      sendResponse({ ok: true });
      return;
    }

    case 'DOWNLOAD_FILE': {
      downloadFile(msg.url, msg.filename)
        .then(sendResponse)
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true; // async
    }

    case 'GET_FLOW_TAB': {
      chrome.tabs.query({ url: 'https://labs.google/fx/*' }, (tabs) => {
        const flowTab = tabs?.find(t => t.url?.includes('/fx/'));
        sendResponse({ tabId: flowTab?.id || null, url: flowTab?.url || null });
      });
      return true; // async
    }

    case 'INJECT_SCRIPT': {
      const tabId = msg.tabId;
      if (!Number.isInteger(tabId)) {
        sendResponse({ ok: false, error: 'BAD_TAB_ID' });
        return true;
      }
      chrome.scripting.executeScript({
        target: { tabId },
        world: msg.world || 'MAIN',
        func: new Function('return (' + msg.funcBody + ')(...arguments)'),
        args: msg.args || []
      }).then(results => {
        sendResponse({ ok: true, result: results?.[0]?.result });
      }).catch(e => {
        sendResponse({ ok: false, error: e.message });
      });
      return true; // async
    }

    default:
      break;
  }
});
