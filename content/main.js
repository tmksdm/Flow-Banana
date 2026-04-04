/**
 * FlowBatch — Точка входа content script v0.10
 */
(() => {
  'use strict';

  if (!window.FB) return;
  window.__flowbatch_loaded = true;

  const FB = window.FB;

  // ─── Ждём готовность page context скрипта ──────────────
  let pageContextReady = false;

  window.addEventListener('flowbatch-page-ready', (e) => {
    pageContextReady = true;
    console.log('[FlowBatch] Page context script подключён, версия:', e.detail?.version);
  });

  // Проверяем — может он уже загрузился раньше нас
  if (window.__flowbatch_injected_v10) {
    pageContextReady = true;
    console.log('[FlowBatch] Page context script уже был загружен (v0.10)');
  }

  FB.isPageContextReady = () => pageContextReady;

  setTimeout(() => {
    if (!pageContextReady) {
      console.warn('[FlowBatch] ⚠ Page context script НЕ загрузился за 5с!');
      FB.notifyPanel({ type: 'LOG', text: 'ВНИМАНИЕ: page context script не загрузился', level: 'warning' });
    }
  }, 5000);

  // ─── Слушаем перехваченные URL от injected.js ─────────
  window.addEventListener('flowbatch-intercepted', (e) => {
    const data = e.detail;
    if (data?.url) {
      FB.state.interceptedUrls.push(data);
      console.log('[FlowBatch] Перехвачен URL:', data.type, data.method || '', data.status || '', data.url.substring(0, 100));
      FB.notifyPanel({ type: 'LOG', text: `Перехвачен: ${data.type} ${data.method || ''} ${data.url.substring(0, 80)}`, level: 'info' });
    }
  });

  // ─── Слушаем события генерации ─────────────────────────
  window.addEventListener('flowbatch-generation-started', (e) => {
    console.log('[FlowBatch] 🚀 Генерация стартовала (сеть)');
    FB.notifyPanel({ type: 'LOG', text: '🚀 Сетевой запрос генерации обнаружен', level: 'success' });
  });

  window.addEventListener('flowbatch-generation-response', (e) => {
    console.log('[FlowBatch] ✅ Ответ генерации (сеть)');
    FB.notifyPanel({ type: 'LOG', text: '✅ Ответ генерации получен', level: 'success' });
  });

  // ─── Авто-закрытие модалок при загрузке ────────────────
  setTimeout(() => FB.autoDismissModals(), 3000);

  console.log('[FlowBatch] Content script v0.10 загружен:', window.location.href);
})();
