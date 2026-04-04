/**
 * FlowBatch — Утилиты v0.8
 * 
 * КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ #2: Google Flow использует Slate.js editor.
 * 
 * Slate.js НЕ реагирует на execCommand('insertText') для обновления своей модели.
 * Текст появляется в DOM, но Slate model остаётся пустым → Flow не видит промпт.
 * 
 * Решение: Эмулировать PASTE event с DataTransfer.
 * Slate перехватывает paste и вызывает editor.insertData(clipboardData),
 * что корректно обновляет и DOM и внутреннюю модель.
 * 
 * Стратегия ввода (v0.8):
 *   0: ClipboardEvent paste — основная для Slate.js
 *   1: beforeinput + insertText из page context 
 *   2: execCommand('insertText') — fallback для не-Slate редакторов
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

  /**
   * Определяет, является ли элемент Slate.js editor
   */
  function isSlateEditor(element) {
    if (!element) return false;
    if (element.hasAttribute('data-slate-editor') || element.hasAttribute('data-slate-node')) return true;
    // Проверяем дочерние элементы на Slate-специфичные атрибуты
    if (element.querySelector('[data-slate-node], [data-slate-leaf], [data-slate-string]')) return true;
    return false;
  }

  /**
   * Получить "чистый" текст contenteditable, ИСКЛЮЧАЯ placeholder.
   */
  function getCleanText(element) {
    if (!element) return '';
    if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
      return element.value || '';
    }

    // Для Slate.js: placeholder отображается как span с data-slate-placeholder
    const clone = element.cloneNode(true);
    clone.querySelectorAll(
      '[data-slate-placeholder], [data-placeholder], [aria-hidden="true"], .placeholder, [class*="placeholder"]'
    ).forEach(el => el.remove());
    
    let text = clone.textContent || '';
    
    // Дополнительная проверка на placeholder
    const placeholder = element.getAttribute('placeholder') ||
                        element.getAttribute('data-placeholder') ||
                        element.getAttribute('aria-placeholder') || '';
    if (placeholder && text.trim() === placeholder.trim()) return '';
    if (placeholder && text.startsWith(placeholder)) text = text.substring(placeholder.length);
    
    return text.trim();
  }
  FB.getCleanText = getCleanText;

  /**
   * Эмуляция ввода текста — v0.8 с поддержкой Slate.js
   * 
   * Порядок стратегий:
   * 0. ClipboardEvent paste (для Slate.js)
   * 1. beforeinput InputEvent из page context (для Slate.js)
   * 2. execCommand insertText (для обычных contenteditable)
   */
  FB.setPromptText = async (element, text) => {
    if (!element) throw new Error('Элемент промпта не найден');

    const slate = isSlateEditor(element);
    console.log('[FlowBatch] setPromptText v0.8: начинаем ввод текста...');
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

    // ═══ Стратегия 0 (ОСНОВНАЯ): ClipboardEvent paste ═══
    // Slate.js перехватывает paste и вызывает ReactEditor.insertData(),
    // что корректно обновляет Slate model.
    console.log('[FlowBatch] setPromptText: Стратегия 0 — ClipboardEvent paste...');
    try {
      // 0a. Focus и клик
      element.click();
      await FB.sleep(150);
      element.focus();
      await FB.sleep(200);

      // 0b. Выделить всё существующее содержимое (для замены)
      // Используем Ctrl+A через KeyboardEvent — Slate обрабатывает это через hotkeys
      document.execCommand('selectAll', false, null);
      await FB.sleep(300); // Ждём Slate selectionchange (throttle 100ms + debounce 0)

      // 0c. Удалить выделенное (очистить поле)
      // Для пустого поля (только placeholder) — это безопасная no-op
      const currentClean = getCleanText(element);
      if (currentClean.length > 0) {
        document.execCommand('delete', false, null);
        await FB.sleep(300);
        console.log('[FlowBatch] setPromptText: старый текст удалён');
      }

      // 0d. Создаём DataTransfer с текстом
      const dataTransfer = new DataTransfer();
      dataTransfer.setData('text/plain', text);

      // 0e. Диспатчим paste event
      // Slate ловит paste через React's onPaste и вызывает editor.insertData(clipboardData)
      const pasteEvent = new ClipboardEvent('paste', {
        clipboardData: dataTransfer,
        bubbles: true,
        cancelable: true,
        composed: true,
      });

      const wasCancelled = !element.dispatchEvent(pasteEvent);
      console.log('[FlowBatch] setPromptText: paste dispatched, defaultPrevented =', wasCancelled);

      // Если Slate отменил paste (preventDefault) — он обработал его через insertData
      // Если НЕ отменил — paste не был обработан Slate

      await FB.sleep(500);

      // 0f. Проверяем результат
      const afterPaste = getCleanText(element);
      console.log('[FlowBatch] setPromptText: после paste, cleanText =', afterPaste.substring(0, 60));

      if (afterPaste.includes(text.substring(0, Math.min(20, text.length)))) {
        console.log('[FlowBatch] setPromptText: Стратегия 0 (paste) — УСПЕХ ✓');
        return true;
      }

      // Если paste не сработал (не отменён), Slate мог не его обработать
      if (!wasCancelled) {
        console.log('[FlowBatch] setPromptText: paste НЕ был перехвачен Slate, пробуем insertFromPaste...');
        
        // Попробуем через beforeinput с inputType='insertFromPaste'
        const dt2 = new DataTransfer();
        dt2.setData('text/plain', text);
        
        const beforeInputEvent = new InputEvent('beforeinput', {
          inputType: 'insertFromPaste',
          dataTransfer: dt2,
          bubbles: true,
          cancelable: true,
          composed: true,
        });
        element.dispatchEvent(beforeInputEvent);
        
        await FB.sleep(500);
        const afterBI = getCleanText(element);
        console.log('[FlowBatch] setPromptText: после beforeinput insertFromPaste, cleanText =', afterBI.substring(0, 60));
        
        if (afterBI.includes(text.substring(0, Math.min(20, text.length)))) {
          console.log('[FlowBatch] setPromptText: Стратегия 0b (beforeinput paste) — УСПЕХ ✓');
          return true;
        }
      }

      console.log('[FlowBatch] setPromptText: Стратегия 0 не сработала, переходим к 1');
    } catch (e) {
      console.warn('[FlowBatch] setPromptText: Стратегия 0 ошибка:', e.message);
    }

    // ═══ Стратегия 1: beforeinput insertText из page context ═══
    // Slate нативно слушает beforeinput на элементе.
    // Диспатчим из page context через injected.js для лучшей совместимости.
    console.log('[FlowBatch] setPromptText: Стратегия 1 — через page context (injected.js)...');
    try {
      const requestId = 'settext_' + Date.now();
      
      const responsePromise = new Promise((resolve) => {
        const handler = (e) => {
          if (e.detail?.requestId === requestId) {
            window.removeEventListener('flowbatch-settext-response', handler);
            resolve(e.detail);
          }
        };
        window.addEventListener('flowbatch-settext-response', handler);
        setTimeout(() => {
          window.removeEventListener('flowbatch-settext-response', handler);
          resolve({ success: false, reason: 'timeout' });
        }, 5000);
      });

      window.dispatchEvent(new CustomEvent('flowbatch-settext-request', {
        detail: { text, requestId }
      }));

      const result = await responsePromise;
      console.log('[FlowBatch] setPromptText: Стратегия 1 результат:', JSON.stringify(result));

      if (result.success) {
        await FB.sleep(500);
        const afterPC = getCleanText(element);
        if (afterPC.includes(text.substring(0, Math.min(20, text.length)))) {
          console.log('[FlowBatch] setPromptText: Стратегия 1 (page context) — УСПЕХ ✓');
          return true;
        }
      }
    } catch (e) {
      console.warn('[FlowBatch] setPromptText: Стратегия 1 ошибка:', e.message);
    }

    // ═══ Стратегия 2: execCommand insertText (fallback) ═══
    console.log('[FlowBatch] setPromptText: Стратегия 2 — execCommand insertText...');
    try {
      element.focus();
      await FB.sleep(150);
      document.execCommand('selectAll', false, null);
      await FB.sleep(200);

      const inserted = document.execCommand('insertText', false, text);
      console.log('[FlowBatch] setPromptText: insertText =', inserted);

      await FB.sleep(500);

      // Дополнительно: fire input event для совместимости
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));

      const afterEC = getCleanText(element);
      console.log('[FlowBatch] setPromptText: после execCommand, cleanText =', afterEC.substring(0, 60));

      if (afterEC.includes(text.substring(0, Math.min(20, text.length)))) {
        console.log('[FlowBatch] setPromptText: Стратегия 2 (execCommand) — УСПЕХ ✓');
        return true;
      }
    } catch (e) {
      console.warn('[FlowBatch] setPromptText: Стратегия 2 ошибка:', e.message);
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
