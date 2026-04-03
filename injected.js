/**
 * FlowBatch — Скрипт, инъектируемый в page context
 * Перехватывает fetch/XHR для обнаружения URL сгенерированных файлов.
 * 
 * Этот скрипт запускается в контексте страницы (не расширения),
 * поэтому может перехватывать реальные сетевые запросы.
 */

(() => {
  'use strict';

  const INTERCEPTED_URLS = [];

  // ─── Перехват fetch ─────────────────────────────────
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);

    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';

      // Ищем URL сгенерированных ассетов (изображения / видео)
      if (
        url.includes('generativelanguage') ||
        url.includes('generated') ||
        url.includes('download') ||
        url.includes('blob') ||
        url.includes('image') && url.includes('output')
      ) {
        INTERCEPTED_URLS.push({
          url,
          timestamp: Date.now(),
          type: 'fetch'
        });

        // Отправляем в content script через CustomEvent
        window.dispatchEvent(new CustomEvent('flowbatch-intercepted', {
          detail: { url, type: 'fetch', timestamp: Date.now() }
        }));
      }
    } catch (e) {
      // Игнорируем ошибки перехвата
    }

    return response;
  };

  // ─── Перехват XMLHttpRequest ──────────────────────────
  const originalXHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._flowbatch_url = url;
    return originalXHROpen.call(this, method, url, ...rest);
  };

  const originalXHRSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', function () {
      try {
        const url = this._flowbatch_url || '';
        if (
          url.includes('generativelanguage') ||
          url.includes('generated') ||
          url.includes('download')
        ) {
          window.dispatchEvent(new CustomEvent('flowbatch-intercepted', {
            detail: { url, type: 'xhr', timestamp: Date.now() }
          }));
        }
      } catch (e) {}
    });
    return originalXHRSend.apply(this, args);
  };

  console.log('[FlowBatch] Fetch/XHR перехватчик активирован');
})();
