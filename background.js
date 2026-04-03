/**
 * FlowBatch — Background Service Worker (Manifest V3)
 * Координирует скачивания, хранит глобальное состояние, управляет Side Panel.
 */

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
        maxRetries: 3
      }
    });
  }

  // Разрешаем Side Panel на наших URL
  chrome.sidePanel.setOptions({
    enabled: true
  });
});

// ─── Клик по иконке расширения → открыть Side Panel ─────
chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ tabId: tab.id });
});

// ─── Обработка сообщений ────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Сообщения от content script — пробрасываем в side panel
  if (message.source === 'content') {
    // Side panel слушает через onMessage — он получит автоматически
    return;
  }

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
  }
});

// ─── Отслеживание завершения скачиваний ─────────────────
chrome.downloads.onChanged.addListener((delta) => {
  if (delta.state && delta.state.current === 'complete') {
    console.log(`[FlowBatch] Скачивание завершено: ${delta.id}`);
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'DOWNLOAD_COMPLETE',
          downloadId: delta.id
        }).catch(() => {});
      }
    });
  }
});
