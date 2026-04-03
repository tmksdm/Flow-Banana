/**
 * FlowBatch — Утилиты: sleep, waitForElement, setPromptText, clickElement, notifyPanel
 */
(() => {
  'use strict';
  const FB = window.FB;
  if (!FB) return;

  FB.sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  /**
   * Ожидание появления элемента
   * @param {Function|string} selectorFn — функция или CSS-селектор
   */
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
   * Эмуляция ввода текста в contenteditable / input / textarea
   */
  FB.setPromptText = (element, text) => {
    if (!element) throw new Error('Элемент промпта не найден');

    element.focus();
    element.dispatchEvent(new FocusEvent('focus', { bubbles: true }));

    if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
      const proto = element.tagName === 'TEXTAREA'
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(element, text);
      else element.value = text;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      // contenteditable
      element.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      document.execCommand('insertText', false, text);
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true, cancelable: true, inputType: 'insertText', data: text
      }));
    }
  };

  /**
   * Эмуляция клика с полной цепочкой pointer/mouse событий
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

  /**
   * Отправка сообщения в side panel / background
   */
  FB.notifyPanel = (message) => {
    chrome.runtime.sendMessage({ ...message, source: 'content' }).catch(() => {});
  };
})();
