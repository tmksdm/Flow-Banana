/**
 * FlowBatch — Точка входа content script v0.7
 * 
 * ИСПРАВЛЕНИЕ: Инъекция injected.js через blob URL для обхода CSP.
 * CSP страницы labs.google блокирует script src от chrome-extension://,
 * но blob: URL может пройти (или используем inline script).
 */
(() => {
  'use strict';

  if (!window.FB) return;
  window.__flowbatch_loaded = true;

  const FB = window.FB;

  // ─── Инъекция fetch/XHR перехватчика ──────────────────
  // Метод 1: fetch код файла и инъектировать как inline script через blob URL
  async function injectPageScript() {
    try {
      const scriptUrl = chrome.runtime.getURL('injected.js');
      const response = await fetch(scriptUrl);
      const code = await response.text();

      // Способ A: blob URL
      const blob = new Blob([code], { type: 'application/javascript' });
      const blobUrl = URL.createObjectURL(blob);
      const script = document.createElement('script');
      script.src = blobUrl;
      script.onload = () => {
        script.remove();
        URL.revokeObjectURL(blobUrl);
        console.log('[FlowBatch] Перехватчик fetch/XHR инъектирован (blob)');
      };
      script.onerror = () => {
        // Способ B: если blob тоже заблокирован, попробуем textContent
        script.remove();
        URL.revokeObjectURL(blobUrl);
        console.warn('[FlowBatch] blob-инъекция не сработала, пробуем inline...');
        
        const inlineScript = document.createElement('script');
        inlineScript.textContent = code;
        (document.head || document.documentElement).appendChild(inlineScript);
        inlineScript.remove();
        console.log('[FlowBatch] Перехватчик инъектирован (inline)');
      };
      (document.head || document.documentElement).appendChild(script);
    } catch (e) {
      console.error('[FlowBatch] Ошибка инъекции:', e);
      // Способ C: Используем chrome.scripting из background
      // (требует дополнительной настройки)
    }
  }

  injectPageScript();

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

  console.log('[FlowBatch] Content script v0.7 загружен:', window.location.href);
})();
