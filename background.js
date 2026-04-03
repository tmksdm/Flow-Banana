/**
 * FlowBatch — Background Service Worker (Manifest V3)
 * Координирует скачивания, хранит глобальное состояние, проксирует сообщения.
 */

// ─── Слушатель установки ───────────────────────────────
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[FlowBatch] Расширение установлено');

    // Устанавливаем настройки по умолчанию
    chrome.storage.local.set({
      flowbatch_settings: {
        mode: 'text-to-image',
        model: 'Nano Banana Pro',
        aspectRatio: '16:9',
        outputCount: 2,
        downloadResolution: '4K',
        autoDownload: true,
        delayBetweenPrompts: 5000,
        maxRetries: 3,
        concurrentPrompts: 1
      }
    });
  }
});

// ─── Обработка сообщений ───────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.source === 'content') {
    // Сообщения от content script — пересылаем в popup если открыт
    // (popup слушает через свой onMessage)
    return;
  }

  switch (message.type) {
    case 'DOWNLOAD_FILE':
      // Программное скачивание файла через chrome.downloads API
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
      return true; // async

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
    // Уведомляем content script
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
