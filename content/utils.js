/**
 * FlowBatch — Утилиты v0.9
 * 
 * КРИТИЧЕСКОЕ ИЗМЕНЕНИЕ: injected.js теперь работает через world: MAIN.
 * Стратегия ввода текста:
 *   0 (ОСНОВНАЯ): Через page context → Slate API (editor.insertText)
 *   1: Через page context → React onPaste handler
 *   2: Через page context → нативный paste из page context
 *   3 (fallback): execCommand insertText (без обновления Slate model)
 */
(() => {
  'use strict';
  const FB = window.FB;
  if (!FB) return;

  FB.sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  FB.waitForElement = (selectorFn, timeout = 30000, interval = 500) => {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        const el = typeof selectorFn === 'function'
          ? selectorFn()
          : FlowSelectors.deepQuery(selectorFn);
        if (el) return resolve(el);
        if (Date.now() - start > timeout) return reject(new Error(`Элемент не найден за ${timeout}мс`));
        setTimeout(check, interval);
      };
      check();
    });
  };

  function isSlateEditor(element) {
    if (!element) return false;
    if (element.hasAttribute('data-slate-editor') || element.hasAttribute('data-slate-node')) return true;
    if (element.querySelector('[data-slate-node], [data-slate-leaf], [data-slate-string]')) return true;
    return false;
  }

  function getCleanText(element) {
    if (!element) return '';
    if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
      return element.value || '';
    }

    const clone = element.cloneNode(true);
    clone.querySelectorAll(
      '[data-slate-placeholder], [data-placeholder], [aria-hidden="true"], .placeholder, [class*="placeholder"]'
    ).forEach(el => el.remove());

    let text = clone.textContent || '';

    const placeholder = element.getAttribute('placeholder') ||
                        element.getAttribute('data-placeholder') ||
                        element.getAttribute('aria-placeholder') || '';
    if (placeholder && text.trim() === placeholder.trim()) return '';
    if (placeholder && text.startsWith(placeholder)) text = text.substring(placeholder.length);

    return text.trim();
  }
  FB.getCleanText = getCleanText;

  /**
   * Ожидание готовности page context (injected.js)
   */
  async function waitForPageContext(timeout = 8000) {
    if (FB.isPageContextReady && FB.isPageContextReady()) return true;
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (FB.isPageContextReady && FB.isPageContextReady()) return true;
      await FB.sleep(200);
    }
    console.warn('[FlowBatch] Page context не готов за', timeout, 'мс');
    return false;
  }

  /**
   * Отправить запрос в page context и получить ответ
   */
  function requestPageContext(eventName, detail, timeout = 10000) {
    return new Promise((resolve) => {
      const requestId = eventName + '_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
      const responseEvent = eventName.replace('-request', '-response');

      const handler = (e) => {
        if (e.detail?.requestId === requestId) {
          window.removeEventListener(responseEvent, handler);
          resolve(e.detail);
        }
      };
      window.addEventListener(responseEvent, handler);

      setTimeout(() => {
        window.removeEventListener(responseEvent, handler);
        resolve({ success: false, reason: 'timeout' });
      }, timeout);

      window.dispatchEvent(new CustomEvent(eventName, {
        detail: { ...detail, requestId }
      }));
    });
  }
  FB.requestPageContext = requestPageContext;

  /**
   * Эмуляция ввода текста v0.9
   * 
   * Все стратегии кроме fallback идут через page context (injected.js),
   * где есть доступ к React Fiber и Slate Editor API.
   */
  FB.setPromptText = async (element, text) => {
    if (!element) throw new Error('Элемент промпта не найден');

    const slate = isSlateEditor(element);
    console.log('[FlowBatch] setPromptText v0.9: начинаем ввод текста...');
    console.log('[FlowBatch] setPromptText: Slate.js =', slate);
    console.log('[FlowBatch] setPromptText: целевой текст:', text.substring(0, 60));

    const isContentEditable = element.getAttribute('contenteditable') === 'true';

    // Для textarea/input
    if (!isContentEditable) {
      element.focus();
      const proto = element.tagName === 'TEXTAREA'
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(element, text);
      else element.value = text;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    // ═══ Основной путь: через page context (Стратегии A/B/C) ═══
    console.log('[FlowBatch] setPromptText: ожидаем page context...');
    const pcReady = await waitForPageContext(8000);

    if (pcReady) {
      console.log('[FlowBatch] setPromptText: page context готов, отправляем запрос...');

      // Фокус на элемент (нужен до любой стратегии)
      element.click();
      await FB.sleep(100);
      element.focus();
      await FB.sleep(200);

      const result = await requestPageContext('flowbatch-settext-request', { text }, 15000);
      console.log('[FlowBatch] setPromptText: результат page context:', JSON.stringify(result));

      if (result.success) {
        console.log(`[FlowBatch] setPromptText: ✓ УСПЕХ через ${result.method}`);
        
        // Ждём React re-render
        await FB.sleep(500);
        
        const afterText = getCleanText(element);
        console.log('[FlowBatch] setPromptText: после ввода cleanText =', afterText.substring(0, 60));
        return true;
      } else {
        console.warn('[FlowBatch] setPromptText: page context не смог вставить текст:', result.reason);
      }
    } else {
      console.warn('[FlowBatch] setPromptText: page context не готов, используем fallback');
    }

    // ═══ Fallback: execCommand (текст в DOM, но Slate model может не обновиться) ═══
    console.log('[FlowBatch] setPromptText: Fallback — execCommand insertText...');
    try {
      element.focus();
      await FB.sleep(150);
      document.execCommand('selectAll', false, null);
      await FB.sleep(200);

      const inserted = document.execCommand('insertText', false, text);
      console.log('[FlowBatch] setPromptText: insertText =', inserted);

      await FB.sleep(500);

      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));

      const afterEC = getCleanText(element);
      console.log('[FlowBatch] setPromptText: после execCommand, cleanText =', afterEC.substring(0, 60));

      if (afterEC.includes(text.substring(0, Math.min(20, text.length)))) {
        console.log('[FlowBatch] setPromptText: Fallback (execCommand) — текст в DOM ✓');
        console.warn('[FlowBatch] setPromptText: ⚠ Slate model может быть не обновлена!');
        return true;
      }
    } catch (e) {
      console.warn('[FlowBatch] setPromptText: Fallback ошибка:', e.message);
    }

    console.error('[FlowBatch] setPromptText: ❌ все стратегии исчерпаны');
    return false;
  };

  /**
   * Эмуляция клика — полная цепочка pointer/mouse событий
   */
  FB.clickElement = async (element, delay = 300) => {
    if (!element) throw new Error('Элемент для клика не найден');

    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await FB.sleep(150);

    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 };

    element.dispatchEvent(new PointerEvent('pointerdown', opts));
    element.dispatchEvent(new MouseEvent('mousedown', opts));
    await FB.sleep(50);
    element.dispatchEvent(new PointerEvent('pointerup', opts));
    element.dispatchEvent(new MouseEvent('mouseup', opts));
    element.dispatchEvent(new MouseEvent('click', opts));

    await FB.sleep(delay);
  };

  FB.notifyPanel = (message) => {
    chrome.runtime.sendMessage({ ...message, source: 'content' }).catch(() => {});
  };
})();
