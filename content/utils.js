/**
 * FlowBatch — Утилиты v0.5
 * Улучшен setPromptText: несколько стратегий ввода для Angular/Lit
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
   * Эмуляция ввода текста — многоуровневая стратегия
   * Стратегия 1: execCommand (классика)
   * Стратегия 2: DataTransfer paste (обходит фреймворки)
   * Стратегия 3: посимвольный ввод через InputEvent
   */
  FB.setPromptText = async (element, text) => {
    if (!element) throw new Error('Элемент промпта не найден');

    console.log('[FlowBatch] setPromptText: начинаем ввод текста...');

    // Фокус
    element.focus();
    element.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    await FB.sleep(100);

    if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
      // Для textarea/input — стандартный метод
      const proto = element.tagName === 'TEXTAREA'
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(element, text);
      else element.value = text;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      console.log('[FlowBatch] setPromptText: textarea/input — готово');
      return;
    }

    // ── Для contenteditable ──

    // Очистка текущего содержимого
    element.focus();
    
    // Стратегия 1: execCommand
    try {
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      await FB.sleep(50);
      
      const inserted = document.execCommand('insertText', false, text);
      if (inserted) {
        console.log('[FlowBatch] setPromptText: execCommand insertText — OK');
        // Дополнительные события для Angular
        element.dispatchEvent(new InputEvent('input', {
          bubbles: true, cancelable: true, inputType: 'insertText', data: text
        }));
        await FB.sleep(200);
        
        // Проверяем, что текст реально появился
        const currentText = element.textContent || element.innerText || '';
        if (currentText.trim().length > 0) {
          console.log('[FlowBatch] setPromptText: текст подтверждён через execCommand');
          return;
        }
      }
    } catch (e) {
      console.warn('[FlowBatch] setPromptText: execCommand не сработал:', e.message);
    }

    // Стратегия 2: DataTransfer paste (симуляция Ctrl+V)
    try {
      console.log('[FlowBatch] setPromptText: пробуем paste через DataTransfer...');
      element.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      await FB.sleep(50);

      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dt
      });
      element.dispatchEvent(pasteEvent);
      await FB.sleep(200);

      const currentText2 = element.textContent || element.innerText || '';
      if (currentText2.trim().length > 0) {
        console.log('[FlowBatch] setPromptText: paste DataTransfer — OK');
        element.dispatchEvent(new InputEvent('input', {
          bubbles: true, cancelable: true, inputType: 'insertFromPaste', data: text
        }));
        return;
      }
    } catch (e) {
      console.warn('[FlowBatch] setPromptText: paste не сработал:', e.message);
    }

    // Стратегия 3: Прямое назначение + каскад событий
    console.log('[FlowBatch] setPromptText: прямое назначение textContent...');
    element.textContent = '';
    await FB.sleep(50);
    element.textContent = text;

    // Стреляем всей цепочкой событий
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new InputEvent('input', {
      bubbles: true, cancelable: true, inputType: 'insertText', data: text
    }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ' ', code: 'Space' }));
    element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ' ', code: 'Space' }));
    
    await FB.sleep(200);
    console.log('[FlowBatch] setPromptText: прямое назначение — выполнено');
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
