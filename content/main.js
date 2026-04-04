/**
 * FlowBatch — Точка входа content script v0.12
 */
(() => {
  'use strict';
  if (!window.FB) return;

  const FB = window.FB;
  let pageContextReady = false;

  window.addEventListener('flowbatch-page-ready', (e) => {
    pageContextReady = true;
    console.log('[FlowBatch] Page context подключён, v' + e.detail?.version);
  });

  if (window.__flowbatch_injected_v12) {
    pageContextReady = true;
    console.log('[FlowBatch] Page context уже загружен (v0.12)');
  }

  FB.isPageContextReady = () => pageContextReady;

  setTimeout(() => {
    if (!pageContextReady) {
      console.warn('[FlowBatch] ⚠ Page context НЕ загрузился за 5с!');
    }
  }, 5000);

  window.addEventListener('flowbatch-generation-started', () => {
    console.log('[FlowBatch] 🚀 Генерация стартовала (сеть)');
    FB.notifyPanel({ type: 'LOG', text: '🚀 Запрос генерации обнаружен', level: 'success' });
  });

  window.addEventListener('flowbatch-generation-response', () => {
    console.log('[FlowBatch] ✅ Ответ генерации (сеть)');
    FB.notifyPanel({ type: 'LOG', text: '✅ Ответ генерации получен', level: 'success' });
  });

  setTimeout(() => FB.autoDismissModals(), 3000);

  console.log('[FlowBatch] Content script v0.12 загружен:', window.location.href);
})();
