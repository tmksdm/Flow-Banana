/**
 * FlowBatch — Background Service Worker v0.5
 * Исправлено: sidePanel открывается через setPanelBehavior, без open().
 */

// ─── При запуске: настраиваем поведение Side Panel ──────
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .then(() => console.log('[FlowBatch] Side Panel: openPanelOnActionClick = true'))
  .catch(e => console.error('[FlowBatch] setPanelBehavior ошибка:', e));

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
