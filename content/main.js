/**
 * FlowBatch — Точка входа content script v0.9
 * 
 * ИЗМЕНЕНИЕ v0.9: injected.js теперь загружается через "world": "MAIN"
 * в manifest.json — ручная инъекция через blob/inline больше не нужна.
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
  // (world: MAIN скрипты могут выполниться в любом порядке)
  FB.isPageContextReady = () => pageContextReady;

  // Таймаут: если через 5с page context не подключился — предупреждаем
  setTimeout(() => {
    if (!pageContextReady) {
      console.warn('[FlowBatch] ⚠ Page context script НЕ загрузился за 5с!');
      console.warn('[FlowBatch] Проверьте что injected.js указан в manifest.json с "world": "MAIN"');
      FB.notifyPanel({ type: 'LOG', text: 'ВНИМАНИЕ: page context script не загрузился', level: 'warning' });
    }
  }, 5000);

  // ─── Слушаем перехваченные URL от injected.js ─────────
  window.addEventListener('flowbatch-intercepted', (e) => {
    const data = e.detail;
    if (data?.url) {
      FB.state.interceptedUrls.push(data);
      console.log('[FlowBatch] Перехвачен URL:', data.url.substring(0, 100));
      FB.notifyPanel({ type: 'LOG', text: `Перехвачен: ${data.type} ${data.url.substring(0, 80)}...`, level: 'info' });
    }
  });

  // ─── Авто-закрытие модалок при загрузке ────────────────
  setTimeout(() => FB.autoDismissModals(), 3000);

  console.log('[FlowBatch] Content script v0.9 загружен:', window.location.href);
})();
