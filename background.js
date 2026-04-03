/**
 * FlowBatch — Background Service Worker v0.4
 * Side Panel только для Flow, toggle по иконке расширения.
 */

// URL-паттерны Flow
const FLOW_PATTERNS = [
  'labs.google/fx/tools/flow',
  'flow.google'
];

function isFlowUrl(url) {
  if (!url) return false;
  return FLOW_PATTERNS.some(p => url.includes(p));
}

// ─── Состояние Side Panel (open/closed) по табам ────────
const panelOpenTabs = new Set();

// ─── При установке ──────────────────────────────────────
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[FlowBatch] Расширение установлено');
    chrome.storage.local.set({
      flowbatch_settings: {
        mode: 'text-to-image',
        model: 'Nano Banana Pro',
        videoModel: 'Veo 3.1 Fast',
        aspectRatio: '16:9',
        outputCount: 2,
        downloadResolution: '4K',
        autoDownload: true,
        delayBetweenPrompts: 5000,
        maxRetries: 3,
        useUltra: true
      }
    });
  }
});

// ─── Управление доступностью Side Panel по URL ──────────

/**
 * Включаем / выключаем Side Panel в зависимости от URL текущего таба
 */
async function updateSidePanelForTab(tabId, url) {
  try {
    const flow = isFlowUrl(url);
    await chrome.sidePanel.setOptions({
      tabId,
      enabled: flow
    });
    // Если таб не Flow и панель была открыта — она закроется автоматически
    if (!flow) {
      panelOpenTabs.delete(tabId);
    }
  } catch (e) {
    // Игнорируем ошибки для невалидных табов
  }
}

// При переключении таба
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    await updateSidePanelForTab(tabId, tab.url);
  } catch (_) {}
});

// При обновлении URL таба
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    await updateSidePanelForTab(tabId, tab.url);
  }
});

// При закрытии таба — чистим
chrome.tabs.onRemoved.addListener((tabId) => {
  panelOpenTabs.delete(tabId);
});

// ─── Клик по иконке → toggle Side Panel ─────────────────
chrome.action.onClicked.addListener(async (tab) => {
  if (!isFlowUrl(tab.url)) {
    // Не Flow — ничего не делаем (можно показать уведомление)
    return;
  }

  if (panelOpenTabs.has(tab.id)) {
    // Панель открыта → закрываем
    // Трюк: disable → панель закрывается, потом сразу enable обратно
    await chrome.sidePanel.setOptions({ tabId: tab.id, enabled: false });
    panelOpenTabs.delete(tab.id);
    // Re-enable через 300мс, чтобы можно было открыть снова
    setTimeout(async () => {
      try {
        const t = await chrome.tabs.get(tab.id);
        if (isFlowUrl(t.url)) {
          await chrome.sidePanel.setOptions({ tabId: tab.id, enabled: true });
        }
      } catch (_) {}
    }, 300);
  } else {
    // Панель закрыта → открываем
    await chrome.sidePanel.setOptions({ tabId: tab.id, enabled: true });
    await chrome.sidePanel.open({ tabId: tab.id });
    panelOpenTabs.add(tab.id);
  }
});

// ─── Обработка сообщений ────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.source === 'content') return;

  switch (message.type) {
    case 'DOWNLOAD_FILE':
      chrome.downloads.download({
        url: message.url,
        filename: message.filename || undefined,
        saveAs: false
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ success: true, downloadId });
        }
      });
      return true;

    case 'SAVE_SETTINGS':
      chrome.storage.local.set({ flowbatch_settings: message.settings }, () => {
        sendResponse({ success: true });
      });
      return true;

    case 'LOAD_SETTINGS':
      chrome.storage.local.get(['flowbatch_settings'], (data) => {
        sendResponse({ settings: data.flowbatch_settings || {} });
      });
      return true;

    case 'GET_ACTIVE_TAB':
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        sendResponse({ tab: tabs[0] || null });
      });
      return true;

    case 'PANEL_OPENED':
      // Side panel уведомляет, что открыт
      if (sender.tab?.id) panelOpenTabs.add(sender.tab.id);
      else {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]) panelOpenTabs.add(tabs[0].id);
        });
      }
      sendResponse({ ok: true });
      return true;

    case 'PANEL_CLOSED':
      if (sender.tab?.id) panelOpenTabs.delete(sender.tab.id);
      sendResponse({ ok: true });
      return true;
  }
});

// ─── Отслеживание завершения скачиваний ─────────────────
chrome.downloads.onChanged.addListener((delta) => {
  if (delta.state && delta.state.current === 'complete') {
    console.log(`[FlowBatch] Скачивание завершено: ${delta.id}`);
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'DOWNLOAD_COMPLETE', downloadId: delta.id
        }).catch(() => {});
      }
    });
  }
});
