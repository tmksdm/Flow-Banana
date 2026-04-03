/**
 * FlowBatch — Точка входа content script v0.4
 * Загружается ПОСЛЕДНИМ. Инициализирует перехватчик и авто-действия.
 */
(() => {
  'use strict';

  // Если уже загружен — выходим (state.js проверяет __flowbatch_loaded)
  if (!window.FB) return;

  // Ставим флаг загрузки
  window.__flowbatch_loaded = true;

  const FB = window.FB;

  // ─── Инъекция fetch/XHR перехватчика ──────────────────
  try {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('injected.js');
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
    console.log('[FlowBatch] Перехватчик fetch/XHR инъектирован');
  } catch (e) {
    console.error('[FlowBatch] Ошибка инъекции:', e);
  }

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

  console.log('[FlowBatch] Content script v0.4 загружен:', window.location.href);
})();
