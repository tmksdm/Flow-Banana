/**
 * FlowBatch — Скрипт в page context v0.7
 * 
 * НОВОЕ: Помимо перехвата fetch/XHR, теперь может:
 * - Устанавливать текст в contenteditable из page context
 * - Искать Angular/Lit контроллеры и обновлять модель напрямую
 * - Исследовать фреймворк-специфичные свойства элементов
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
      if (
        url.includes('generativelanguage') ||
        url.includes('generated') ||
        url.includes('download') ||
        url.includes('blob') ||
        (url.includes('image') && url.includes('output'))
      ) {
        INTERCEPTED_URLS.push({ url, timestamp: Date.now(), type: 'fetch' });
        window.dispatchEvent(new CustomEvent('flowbatch-intercepted', {
          detail: { url, type: 'fetch', timestamp: Date.now() }
        }));
      }
    } catch (e) {}
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

  // ─── Установка текста из page context ──────────────────
  // Слушаем запросы от content script через CustomEvent
  window.addEventListener('flowbatch-settext-request', (e) => {
    const { text, requestId } = e.detail || {};
    if (!text || !requestId) return;

    console.log('[FlowBatch/injected] Получен запрос на установку текста:', text.substring(0, 40));

    try {
      const element = document.querySelector('[contenteditable="true"][role="textbox"]');
      if (!element) {
        window.dispatchEvent(new CustomEvent('flowbatch-settext-response', {
          detail: { requestId, success: false, reason: 'element not found' }
        }));
        return;
      }

      // ── Попытка 1: Поиск Angular/Lit controller ──
      let frameworkFound = false;

      // Angular: __ngContext__
      if (element.__ngContext__ || element['__ng_context__']) {
        console.log('[FlowBatch/injected] Найден Angular context!');
        frameworkFound = true;
        // Angular использует формы/модели — но мы не можем легко достучаться до FormControl
        // Поэтому просто сообщаем
      }

      // Lit: __litPart, _$litPart$
      const litKeys = Object.keys(element).filter(k => k.includes('lit') || k.includes('Lit'));
      if (litKeys.length > 0) {
        console.log('[FlowBatch/injected] Найдены Lit-ключи:', litKeys);
        frameworkFound = true;
      }

      // Собираем информацию о всех нестандартных свойствах элемента
      const interestingKeys = Object.keys(element).filter(k => 
        k.startsWith('__') || k.startsWith('_$') || k.includes('ng') || 
        k.includes('lit') || k.includes('react') || k.includes('vue') ||
        k.includes('zone') || k.includes('model')
      );
      console.log('[FlowBatch/injected] Интересные свойства элемента:', interestingKeys);

      // ── Попытка 2: Ввод через полную эмуляцию (из page context, события будут trusted-like) ──
      // focus + selectAll + insertText — стандартный подход
      element.focus();

      // SelectAll
      document.execCommand('selectAll', false, null);

      // Ждём немного
      setTimeout(() => {
        // insertText
        const result = document.execCommand('insertText', false, text);
        console.log('[FlowBatch/injected] insertText result:', result);
        console.log('[FlowBatch/injected] element.textContent after:', (element.textContent || '').substring(0, 60));

        window.dispatchEvent(new CustomEvent('flowbatch-settext-response', {
          detail: { 
            requestId, 
            success: result, 
            frameworkKeys: interestingKeys,
            textContent: (element.textContent || '').substring(0, 60)
          }
        }));
      }, 200);

    } catch (err) {
      console.error('[FlowBatch/injected] Ошибка:', err);
      window.dispatchEvent(new CustomEvent('flowbatch-settext-response', {
        detail: { requestId, success: false, reason: err.message }
      }));
    }
  });

  // ─── Диагностика фреймворка ──────────────────────────
  // Слушаем запрос на диагностику
  window.addEventListener('flowbatch-diagnose-request', (e) => {
    const { requestId } = e.detail || {};
    try {
      const element = document.querySelector('[contenteditable="true"][role="textbox"]');
      if (!element) {
        window.dispatchEvent(new CustomEvent('flowbatch-diagnose-response', {
          detail: { requestId, found: false }
        }));
        return;
      }

      // Собираем ВСЕ ключи элемента
      const allKeys = [];
      for (const key in element) {
        if (key.startsWith('__') || key.startsWith('_$') || key.startsWith('on')) continue;
        // Пропускаем стандартные DOM-свойства
      }
      
      // Нестандартные ключи (фреймворк-специфичные)
      const ownKeys = Object.keys(element).filter(k => !k.startsWith('on'));
      const protoKeys = [];
      let proto = Object.getPrototypeOf(element);
      while (proto && proto !== HTMLElement.prototype && proto !== Element.prototype) {
        protoKeys.push(...Object.getOwnPropertyNames(proto).filter(k => k.startsWith('_') || k.startsWith('$')));
        proto = Object.getPrototypeOf(proto);
      }

      // Event listeners (через getEventListeners если доступен — только в DevTools)
      const hasGetEventListeners = typeof getEventListeners === 'function';

      // Проверяем Zone.js (Angular)
      const hasZone = !!window.Zone;
      const hasNg = !!window.ng;
      const hasLit = !!window.litElementVersions || !!window.litHtmlVersions;

      window.dispatchEvent(new CustomEvent('flowbatch-diagnose-response', {
        detail: {
          requestId,
          found: true,
          ownKeys,
          protoKeysCount: protoKeys.length,
          hasZone,
          hasNg,
          hasLit,
          hasGetEventListeners,
          innerHTML: (element.innerHTML || '').substring(0, 200),
          childNodes: element.childNodes.length,
          firstChildType: element.firstChild?.nodeType,
          firstChildTag: element.firstElementChild?.tagName || null,
        }
      }));
    } catch (err) {
      window.dispatchEvent(new CustomEvent('flowbatch-diagnose-response', {
        detail: { requestId, error: err.message }
      }));
    }
  });

  console.log('[FlowBatch] Fetch/XHR перехватчик + текстовый ввод активирован (v0.7)');
})();
