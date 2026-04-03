/**
 * FlowBatch — Утилиты v0.7
 * КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: setPromptText больше НЕ ТРОГАЕТ innerHTML!
 * 
 * Корневая причина "Prompt must be provided":
 *   innerHTML = '' уничтожала внутреннюю DOM-структуру contenteditable,
 *   к которой был привязан event listener фреймворка (Lit/Angular).
 *   После уничтожения фреймворк переставал видеть изменения.
 * 
 * Новая стратегия:
 *   Стратегия 0: selectAll → execCommand('insertText') — как если бы пользователь
 *     выделил всё (Ctrl+A) и напечатал текст. Placeholder заменяется автоматически.
 *   Стратегия 1: selectAll → ClipboardEvent paste (для фреймворков, слушающих paste)
 *   Стратегия 2: Посимвольный ввод через keyboard events из page context
 *   Стратегия 3: fallback — innerHTML + execCommand (предыдущий подход)
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
   * Получить "чистый" текст contenteditable, ИСКЛЮЧАЯ placeholder.
   */
  function getCleanText(element) {
    if (!element) return '';
    if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
      return element.value || '';
    }
    const clone = element.cloneNode(true);
    clone.querySelectorAll('[data-placeholder], [aria-hidden="true"], .placeholder, [class*="placeholder"]').forEach(el => el.remove());
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
   * Проверяет, видит ли Flow текст в поле (не пустая ли модель фреймворка).
   * Проверяем через: aria-label, textContent без placeholder, наличие текстовых нод.
   */
  function hasRealContent(element) {
    const text = getCleanText(element);
    if (text.length > 0) return true;
    // Проверяем textContent напрямую (может содержать placeholder)
    const raw = (element.textContent || '').trim();
    const placeholder = element.getAttribute('placeholder') ||
                        element.getAttribute('data-placeholder') ||
                        element.getAttribute('aria-placeholder') ||
                        'What do you want to create?';
    if (raw && raw !== placeholder && !raw.startsWith(placeholder.substring(0, 10))) return true;
    return false;
  }

  /**
   * Эмуляция ввода текста — многоуровневая стратегия v0.7
   * КЛЮЧЕВОЕ ИЗМЕНЕНИЕ: НЕ ТРОГАЕМ innerHTML!
   */
  FB.setPromptText = async (element, text) => {
    if (!element) throw new Error('Элемент промпта не найден');

    console.log('[FlowBatch] setPromptText v0.7: начинаем ввод текста...');
    console.log('[FlowBatch] setPromptText: целевой текст:', text.substring(0, 60));
    console.log('[FlowBatch] setPromptText: текущий innerHTML:', (element.innerHTML || '').substring(0, 120));
    console.log('[FlowBatch] setPromptText: текущий textContent:', (element.textContent || '').substring(0, 80));

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
      console.log('[FlowBatch] setPromptText: textarea/input — готово');
      return true;
    }

    // ── Для contenteditable ──

    // ═══ Стратегия 0 (ОСНОВНАЯ): selectAll → execCommand('insertText') ═══
    // Эмулирует Ctrl+A → печатание текста. Placeholder заменяется автоматически.
    // НЕ трогает innerHTML — сохраняет event binding фреймворка.
    console.log('[FlowBatch] setPromptText: Стратегия 0 — selectAll + insertText (без innerHTML)...');
    try {
      // 0a. Кликаем на элемент (как пользователь)
      element.click();
      await FB.sleep(100);

      // 0b. Focus
      element.focus();
      await FB.sleep(150);

      // 0c. SelectAll — выделяем всё содержимое (включая placeholder)
      const selResult = document.execCommand('selectAll', false, null);
      console.log('[FlowBatch] setPromptText: selectAll =', selResult);
      await FB.sleep(100);

      // 0d. Проверяем что selection есть
      const sel = window.getSelection();
      console.log('[FlowBatch] setPromptText: selection rangeCount =', sel.rangeCount,
                  ', toString =', (sel.toString() || '').substring(0, 40));

      // 0e. insertText — заменяет выделенный текст (trusted events!)
      const inserted = document.execCommand('insertText', false, text);
      console.log('[FlowBatch] setPromptText: insertText =', inserted);

      await FB.sleep(500);

      // 0f. Проверяем результат
      const currentText = getCleanText(element);
      console.log('[FlowBatch] setPromptText: текст после Стратегии 0:', currentText.substring(0, 60));

      if (currentText.includes(text.substring(0, Math.min(20, text.length)))) {
        console.log('[FlowBatch] setPromptText: Стратегия 0 — УСПЕХ');
        return true;
      }

      // Если текст не видим через getCleanText, проверяем raw
      if (element.textContent.includes(text.substring(0, Math.min(20, text.length)))) {
        console.log('[FlowBatch] setPromptText: Стратегия 0 — текст в DOM (проверка getCleanText может быть неточной)');
        return true;
      }
    } catch (e) {
      console.warn('[FlowBatch] setPromptText: Стратегия 0 ошибка:', e.message);
    }

    // ═══ Стратегия 1: ClipboardEvent paste ═══
    // Эмулирует Ctrl+V. Некоторые фреймворки слушают именно paste event.
    console.log('[FlowBatch] setPromptText: Стратегия 1 — ClipboardEvent paste...');
    try {
      element.focus();
      await FB.sleep(100);
      document.execCommand('selectAll', false, null);
      await FB.sleep(50);

      // Создаём DataTransfer с текстом
      const dataTransfer = new DataTransfer();
      dataTransfer.setData('text/plain', text);

      const pasteEvent = new ClipboardEvent('paste', {
        clipboardData: dataTransfer,
        bubbles: true,
        cancelable: true
      });

      // Диспатчим paste — фреймворк может обработать его и вставить текст
      const notCancelled = element.dispatchEvent(pasteEvent);
      console.log('[FlowBatch] setPromptText: paste dispatched, notCancelled =', notCancelled);

      // Если фреймворк отменил paste (preventDefault), он обработал его сам
      // Если не отменил — нужно вставить вручную через execCommand
      if (notCancelled) {
        // Фреймворк не обработал paste — вставляем сами
        document.execCommand('insertText', false, text);
      }

      await FB.sleep(500);

      const currentText1 = getCleanText(element);
      console.log('[FlowBatch] setPromptText: текст после Стратегии 1:', currentText1.substring(0, 60));

      if (currentText1.includes(text.substring(0, Math.min(20, text.length))) ||
          element.textContent.includes(text.substring(0, Math.min(20, text.length)))) {
        console.log('[FlowBatch] setPromptText: Стратегия 1 — УСПЕХ');
        return true;
      }
    } catch (e) {
      console.warn('[FlowBatch] setPromptText: Стратегия 1 ошибка:', e.message);
    }

    // ═══ Стратегия 2: Через page context (injected.js) ═══
    // Отправляем текст через CustomEvent в page context, где injected.js
    // может получить доступ к Angular/Lit контроллеру
    console.log('[FlowBatch] setPromptText: Стратегия 2 — через page context...');
    try {
      // Посылаем запрос в injected.js
      const requestId = 'settext_' + Date.now();
      
      const responsePromise = new Promise((resolve) => {
        const handler = (e) => {
          if (e.detail?.requestId === requestId) {
            window.removeEventListener('flowbatch-settext-response', handler);
            resolve(e.detail);
          }
        };
        window.addEventListener('flowbatch-settext-response', handler);
        // Timeout на 3 секунды
        setTimeout(() => {
          window.removeEventListener('flowbatch-settext-response', handler);
          resolve({ success: false, reason: 'timeout' });
        }, 3000);
      });

      window.dispatchEvent(new CustomEvent('flowbatch-settext-request', {
        detail: { text, requestId }
      }));

      const result = await responsePromise;
      console.log('[FlowBatch] setPromptText: Стратегия 2 результат:', JSON.stringify(result));

      if (result.success) {
        await FB.sleep(500);
        console.log('[FlowBatch] setPromptText: Стратегия 2 — УСПЕХ');
        return true;
      }
    } catch (e) {
      console.warn('[FlowBatch] setPromptText: Стратегия 2 ошибка:', e.message);
    }

    // ═══ Стратегия 3 (fallback): innerHTML очистка + execCommand ═══
    console.log('[FlowBatch] setPromptText: Стратегия 3 (fallback) — innerHTML + execCommand...');
    try {
      element.focus();
      await FB.sleep(100);
      element.innerHTML = '';
      element.textContent = '';
      await FB.sleep(100);

      element.focus();
      const sel3 = window.getSelection();
      const range3 = document.createRange();
      range3.setStart(element, 0);
      range3.collapse(true);
      sel3.removeAllRanges();
      sel3.addRange(range3);
      await FB.sleep(50);

      document.execCommand('insertText', false, text);
      await FB.sleep(300);

      // blur/focus для change detection
      element.blur();
      await FB.sleep(150);
      element.focus();
      await FB.sleep(150);

      const currentText3 = getCleanText(element);
      console.log('[FlowBatch] setPromptText: текст после Стратегии 3:', currentText3.substring(0, 60));

      if (currentText3.length > 0) {
        console.log('[FlowBatch] setPromptText: Стратегия 3 — УСПЕХ (но может не работать с фреймворком)');
        return true;
      }
    } catch (e) {
      console.warn('[FlowBatch] setPromptText: Стратегия 3 ошибка:', e.message);
    }

    console.error('[FlowBatch] setPromptText: все стратегии исчерпаны');
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
