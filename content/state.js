/**
 * FlowBatch — Глобальное состояние и конфигурация
 * Должен загружаться ПЕРВЫМ из content-модулей (после lib/selectors.js)
 */
(() => {
  'use strict';

  if (window.__flowbatch_loaded) return;

  // Центральный namespace
  window.FB = window.FB || {};

  FB.state = {
    isRunning: false,
    isPaused: false,
    queue: [],
    currentIndex: 0,
    results: [],
    interceptedUrls: [],
    settings: {
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
  };

  // Восстанавливаем настройки из storage
  chrome.storage.local.get(['flowbatch_settings'], (data) => {
    if (data.flowbatch_settings) {
      Object.assign(FB.state.settings, data.flowbatch_settings);
      console.log('[FlowBatch] Настройки восстановлены');
    }
  });
})();
