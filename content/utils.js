/**
 * FlowBatch — Утилиты v0.6
 * ПОЛНОСТЬЮ ПЕРЕРАБОТАН setPromptText:
 *   Стратегия 1: innerHTML очистка + execCommand insertText (trusted events)
 *   Стратегия 2: Посимвольный ввод через execCommand (медленнее, но надёжнее)
 *   Стратегия 3: InputEvent dispatching (для фреймворков, читающих beforeinput)
 * Добавлен blur/focus цикл для принудительного change detection
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
   * Placeholder может быть отдельным span/div с aria-hidden или с классом placeholder.
   * Или может рендериться через textContent самого элемента, когда поле пустое.
   */
  function getCleanText(element) {
    if (!element) return '';
    // Для input/textarea — просто value
    if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
      return element.value || '';
    }
    // Для contenteditable: клонируем, удаляем placeholder-элементы
    const clone = element.cloneNode(true);
    // Удаляем элементы, которые выглядят как placeholder
    clone.querySelectorAll('[data-placeholder], [aria-hidden="true"], .placeholder, [class*="placeholder"]').forEach(el => el.remove());
    let text = clone.textContent || '';
    // Если текст совпадает с placeholder атрибутом — значит поле пустое
    const placeholder = element.getAttribute('placeholder') || 
                        element.getAttribute('data-placeholder') || 
                        element.getAttribute('aria-placeholder') || '';
    if (placeholder && text.trim() === placeholder.trim()) {
      return '';
    }
    // Убираем placeholder если он в начале текста
    if (placeholder && text.startsWith(placeholder)) {
      text = text.substring(placeholder.length);
    }
    return text.trim();
  }
  FB.getCleanText = getCleanText;

  /**
   * Эмуляция ввода текста — многоуровневая стратегия v0.6
   * 
   * Ключевое изменение: сначала innerHTML очистка (удаляет placeholder-элементы),
   * затем execCommand с trusted events, затем blur/focus для change detection.
   */
  FB.setPromptText = async (element, text) => {
    if (!element) throw new Error('Элемент промпта не найден');

    console.log('[FlowBatch] setPromptText v0.6: начинаем ввод текста...');
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
      console.log('[FlowBatch] setPromptText: textarea/input — готово');
      return true;
    }

    // ── Для contenteditable ──

    // ═══ Стратегия 1: innerHTML очистка + execCommand ═══
    console.log('[FlowBatch] setPromptText: Стратегия 1 — innerHTML + execCommand...');
    try {
      // 1a. Focus
      element.focus();
      await FB.sleep(100);

      // 1b. Полная очистка DOM (удаляет placeholder и всё содержимое)
      element.innerHTML = '';
      element.textContent = '';
      
      // 1c. Уведомляем фреймворк об очистке через beforeinput/input (они isTrusted=false, но некоторые фреймворки не проверяют)
      element.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true, cancelable: true, inputType: 'deleteContentBackward'
      }));
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true, cancelable: false, inputType: 'deleteContentBackward'
      }));
      await FB.sleep(100);

      // 1d. Убеждаемся что фокус на элементе, ставим курсор
      element.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.setStart(element, 0);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      await FB.sleep(50);

      // 1e. Вставка через execCommand — генерирует TRUSTED beforeinput + input events
      const inserted = document.execCommand('insertText', false, text);
      console.log('[FlowBatch] setPromptText: execCommand insertText =', inserted);
      
      await FB.sleep(300);

      // 1f. Проверяем результат
      const currentText = getCleanText(element);
      console.log('[FlowBatch] setPromptText: текст после Стратегии 1:', currentText.substring(0, 60));
      
      if (currentText.length > 0 && currentText.includes(text.substring(0, 20))) {
        // 1g. Blur/Focus цикл — заставить фреймворк обновить модель
        console.log('[FlowBatch] setPromptText: blur/focus цикл...');
        element.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
        await FB.sleep(100);
        element.focus();
        element.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
        await FB.sleep(100);
        
        console.log('[FlowBatch] setPromptText: Стратегия 1 — УСПЕХ');
        return true;
      }
    } catch (e) {
      console.warn('[FlowBatch] setPromptText: Стратегия 1 ошибка:', e.message);
    }

    // ═══ Стратегия 2: Посимвольный ввод через execCommand ═══
    console.log('[FlowBatch] setPromptText: Стратегия 2 — посимвольный ввод...');
    try {
      element.focus();
      element.innerHTML = '';
      element.textContent = '';
      await FB.sleep(100);

      // Ставим курсор
      const sel2 = window.getSelection();
      const range2 = document.createRange();
      range2.setStart(element, 0);
      range2.collapse(true);
      sel2.removeAllRanges();
      sel2.addRange(range2);

      // Посимвольно через execCommand (trusted events для каждого символа)
      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        document.execCommand('insertText', false, char);
        // Каждые 10 символов — пауза для фреймворка
        if (i % 10 === 9) await FB.sleep(5);
      }
      
      await FB.sleep(300);

      const currentText2 = getCleanText(element);
      console.log('[FlowBatch] setPromptText: текст после Стратегии 2:', currentText2.substring(0, 60));

      if (currentText2.length > 0) {
        element.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
        await FB.sleep(100);
        element.focus();
        await FB.sleep(100);
        console.log('[FlowBatch] setPromptText: Стратегия 2 — УСПЕХ');
        return true;
      }
    } catch (e) {
      console.warn('[FlowBatch] setPromptText: Стратегия 2 ошибка:', e.message);
    }

    // ═══ Стратегия 3: InputEvent dispatching + textContent ═══
    console.log('[FlowBatch] setPromptText: Стратегия 3 — InputEvent dispatching...');
    try {
      element.focus();
      
      // Очищаем и вставляем текст напрямую
      while (element.firstChild) element.removeChild(element.firstChild);
      const textNode = document.createTextNode(text);
      element.appendChild(textNode);
      
      // Полный набор событий для перехвата фреймворком
      element.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true, cancelable: true, inputType: 'insertText', data: text
      }));
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true, cancelable: false, inputType: 'insertText', data: text
      }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      
      // Эмулируем нажатие клавиши (пробел + backspace) для "пробуждения"
      element.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, keyCode: 32 }));
      element.dispatchEvent(new KeyboardEvent('keypress', { key: ' ', code: 'Space', bubbles: true, keyCode: 32 }));
      element.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true, keyCode: 32 }));
      
      await FB.sleep(200);

      // Blur/Focus
      element.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
      await FB.sleep(100);
      element.focus();
      
      console.log('[FlowBatch] setPromptText: Стратегия 3 — выполнено (проверка по месту)');
      return true;
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
