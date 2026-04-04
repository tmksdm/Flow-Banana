/**
 * FlowBatch — Page Context Script v0.9
 * 
 * Запускается через "world": "MAIN" в manifest.json.
 * Работает в контексте страницы → полный доступ к:
 * - React Fiber tree
 * - Slate Editor instance
 * - Нативным обработчикам событий
 * 
 * Коммуникация с content script через window events (CustomEvent).
 */
(() => {
  'use strict';

  // Защита от двойной загрузки
  if (window.__flowbatch_injected_v09) return;
  window.__flowbatch_injected_v09 = true;

  console.log('[FlowBatch/page] Page context script v0.9 загружен');

  // ─── Кеш Slate Editor ──────────────────────────────────
  let cachedSlateEditor = null;
  let cachedEditorElement = null;

  // ─── Перехват fetch ─────────────────────────────────────
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      if (
        url.includes('generativelanguage') ||
        url.includes('generated') ||
        url.includes('download') ||
        (url.includes('image') && url.includes('output'))
      ) {
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

  // ─── Поиск React Fiber Root ────────────────────────────
  function findReactFiberKey(element) {
    if (!element) return null;
    return Object.keys(element).find(k =>
      k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')
    ) || null;
  }

  function findReactPropsKey(element) {
    if (!element) return null;
    return Object.keys(element).find(k =>
      k.startsWith('__reactProps$')
    ) || null;
  }

  // ─── Поиск Slate Editor через React Fiber ─────────────
  function findSlateEditor(domElement) {
    if (!domElement) return null;

    // Если кешированный ещё валиден
    if (cachedSlateEditor && cachedEditorElement === domElement) {
      try {
        if (typeof cachedSlateEditor.insertText === 'function') {
          return cachedSlateEditor;
        }
      } catch (e) {}
      cachedSlateEditor = null;
    }

    const fiberKey = findReactFiberKey(domElement);
    if (!fiberKey) {
      console.log('[FlowBatch/page] React Fiber не найден на элементе');
      return null;
    }

    let fiber = domElement[fiberKey];
    let maxDepth = 50;

    while (fiber && maxDepth-- > 0) {
      // Проверяем memoizedState (hooks chain)
      if (fiber.memoizedState) {
        let hookState = fiber.memoizedState;
        let hookDepth = 30;
        while (hookState && hookDepth-- > 0) {
          const val = hookState.memoizedState;

          // Slate Editor — объект с характерными методами
          if (isSlateEditorObject(val)) {
            console.log('[FlowBatch/page] Slate Editor найден в hooks (memoizedState)');
            cachedSlateEditor = val;
            cachedEditorElement = domElement;
            return val;
          }

          // Проверяем ref (useRef)
          if (val && typeof val === 'object' && val.current && isSlateEditorObject(val.current)) {
            console.log('[FlowBatch/page] Slate Editor найден в ref.current');
            cachedSlateEditor = val.current;
            cachedEditorElement = domElement;
            return val.current;
          }

          // Проверяем массивы (useMemo с зависимостями)
          if (Array.isArray(val)) {
            for (const item of val) {
              if (isSlateEditorObject(item)) {
                console.log('[FlowBatch/page] Slate Editor найден в useMemo array');
                cachedSlateEditor = item;
                cachedEditorElement = domElement;
                return item;
              }
            }
          }

          hookState = hookState.next;
        }
      }

      // Проверяем props
      const props = fiber.memoizedProps || fiber.pendingProps;
      if (props) {
        if (isSlateEditorObject(props.editor)) {
          console.log('[FlowBatch/page] Slate Editor найден в fiber.props.editor');
          cachedSlateEditor = props.editor;
          cachedEditorElement = domElement;
          return props.editor;
        }
        // Иногда editor передаётся как часть context
        for (const key of Object.keys(props)) {
          if (isSlateEditorObject(props[key])) {
            console.log(`[FlowBatch/page] Slate Editor найден в fiber.props.${key}`);
            cachedSlateEditor = props[key];
            cachedEditorElement = domElement;
            return props[key];
          }
        }
      }

      // Проверяем stateNode
      if (fiber.stateNode && isSlateEditorObject(fiber.stateNode)) {
        console.log('[FlowBatch/page] Slate Editor найден в stateNode');
        cachedSlateEditor = fiber.stateNode;
        cachedEditorElement = domElement;
        return fiber.stateNode;
      }

      fiber = fiber.return;
    }

    console.warn('[FlowBatch/page] Slate Editor НЕ найден (прошли', 50 - maxDepth, 'уровней fiber)');
    return null;
  }

  function isSlateEditorObject(val) {
    if (!val || typeof val !== 'object') return false;
    // Slate Editor имеет: children (массив), selection, onChange, apply, insertText, deleteBackward
    return (
      typeof val.insertText === 'function' &&
      typeof val.apply === 'function' &&
      typeof val.deleteBackward === 'function' &&
      Array.isArray(val.children)
    );
  }

  // ─── Получить React onPaste handler для элемента ──────
  function getReactPasteHandler(domElement) {
    const propsKey = findReactPropsKey(domElement);
    if (!propsKey) return null;
    const props = domElement[propsKey];
    if (props && typeof props.onPaste === 'function') {
      return props.onPaste;
    }
    return null;
  }

  // ─── Установка текста через Slate API ──────────────────
  /**
   * Стратегия A: Прямой вызов Slate Editor API
   * - Slate.Transforms.select(editor, []) → выделить всё
   * - editor.deleteFragment() → удалить
   * - editor.insertText(text) → вставить
   * - editor.onChange() → уведомить React
   */
  function setTextViaSlateAPI(editor, text) {
    try {
      console.log('[FlowBatch/page] setTextViaSlateAPI: начинаем...');
      console.log('[FlowBatch/page] editor.children:', JSON.stringify(editor.children).substring(0, 200));
      console.log('[FlowBatch/page] editor.selection:', JSON.stringify(editor.selection));

      // 1) Выделяем весь документ
      // Slate.Transforms.select реализуется через editor.apply с операцией set_selection
      const hasContent = editor.children.some(node => {
        if (node.children) {
          return node.children.some(child => (child.text || '').length > 0);
        }
        return (node.text || '').length > 0;
      });

      if (hasContent) {
        // Находим конец документа
        const lastNodeIndex = editor.children.length - 1;
        const lastNode = editor.children[lastNodeIndex];
        const lastChildIndex = lastNode.children ? lastNode.children.length - 1 : 0;
        const lastChild = lastNode.children ? lastNode.children[lastChildIndex] : lastNode;
        const lastOffset = (lastChild.text || '').length;

        // Устанавливаем selection на весь документ
        const anchor = { path: [0, 0], offset: 0 };
        const focus = { path: [lastNodeIndex, lastChildIndex], offset: lastOffset };

        editor.apply({
          type: 'set_selection',
          properties: editor.selection,
          newProperties: { anchor, focus }
        });

        console.log('[FlowBatch/page] Selection установлен:', JSON.stringify({ anchor, focus }));

        // 2) Удаляем выделенный текст
        editor.deleteFragment();
        console.log('[FlowBatch/page] deleteFragment выполнен');
      }

      // 3) Вставляем новый текст
      // Сначала убедимся что selection установлен
      if (!editor.selection) {
        editor.apply({
          type: 'set_selection',
          properties: null,
          newProperties: {
            anchor: { path: [0, 0], offset: 0 },
            focus: { path: [0, 0], offset: 0 }
          }
        });
      }

      editor.insertText(text);
      console.log('[FlowBatch/page] insertText выполнен');

      // 4) Trigger onChange чтобы React увидел изменения
      if (typeof editor.onChange === 'function') {
        editor.onChange();
        console.log('[FlowBatch/page] onChange вызван');
      }

      console.log('[FlowBatch/page] editor.children после:', JSON.stringify(editor.children).substring(0, 200));
      return true;
    } catch (e) {
      console.error('[FlowBatch/page] setTextViaSlateAPI ошибка:', e.message, e.stack);
      return false;
    }
  }

  /**
   * Стратегия B: Вызов React onPaste handler напрямую
   * Создаём фейковый React SyntheticEvent с clipboardData
   */
  function setTextViaReactPaste(domElement, text) {
    try {
      const onPaste = getReactPasteHandler(domElement);
      if (!onPaste) {
        console.log('[FlowBatch/page] React onPaste handler не найден');
        return false;
      }

      console.log('[FlowBatch/page] Вызываем React onPaste напрямую...');

      // Сначала selectAll + delete чтобы заменить содержимое
      domElement.focus();
      document.execCommand('selectAll', false, null);

      // Создаём фейковый event похожий на React SyntheticEvent
      const dt = new DataTransfer();
      dt.setData('text/plain', text);

      const fakeEvent = {
        clipboardData: dt,
        preventDefault: () => {},
        stopPropagation: () => {},
        nativeEvent: new ClipboardEvent('paste', {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
        }),
        type: 'paste',
        target: domElement,
        currentTarget: domElement,
        bubbles: true,
        cancelable: true,
        defaultPrevented: false,
        eventPhase: 3,
        isTrusted: false,
        timeStamp: Date.now(),
        persist: () => {},
        isDefaultPrevented: () => false,
        isPropagationStopped: () => false,
      };

      onPaste(fakeEvent);
      console.log('[FlowBatch/page] React onPaste вызван');
      return true;
    } catch (e) {
      console.error('[FlowBatch/page] setTextViaReactPaste ошибка:', e.message);
      return false;
    }
  }

  // ─── Обработчик запросов от content script ─────────────
  window.addEventListener('flowbatch-settext-request', (e) => {
    const { text, requestId } = e.detail || {};
    if (!text || !requestId) return;

    console.log('[FlowBatch/page] Получен запрос settext:', text.substring(0, 50));

    const respond = (data) => {
      window.dispatchEvent(new CustomEvent('flowbatch-settext-response', {
        detail: { requestId, ...data }
      }));
    };

    try {
      const element = document.querySelector('[contenteditable="true"][role="textbox"]');
      if (!element) {
        respond({ success: false, reason: 'element_not_found' });
        return;
      }

      // ── Стратегия A: Slate Editor API ──
      const editor = findSlateEditor(element);
      if (editor) {
        console.log('[FlowBatch/page] Стратегия A: Slate Editor API');
        const result = setTextViaSlateAPI(editor, text);
        if (result) {
          // Проверяем результат через editor.children
          const editorText = editor.children
            .map(n => (n.children || [n]).map(c => c.text || '').join(''))
            .join('\n')
            .trim();

          if (editorText.includes(text.substring(0, Math.min(20, text.length)))) {
            respond({ success: true, method: 'slate-api', editorText: editorText.substring(0, 60) });
            return;
          } else {
            console.warn('[FlowBatch/page] Slate API: текст в editor.children не совпадает:', editorText.substring(0, 60));
          }
        }
      }

      // ── Стратегия B: React onPaste ──
      console.log('[FlowBatch/page] Стратегия B: React onPaste');
      const pasteResult = setTextViaReactPaste(element, text);
      if (pasteResult) {
        // Даём время React на re-render
        setTimeout(() => {
          const domText = (element.textContent || '').trim();
          const editorText = editor ? editor.children
            .map(n => (n.children || [n]).map(c => c.text || '').join(''))
            .join('\n')
            .trim() : domText;

          if (editorText.includes(text.substring(0, Math.min(20, text.length))) ||
              domText.includes(text.substring(0, Math.min(20, text.length)))) {
            respond({ success: true, method: 'react-paste', editorText: editorText.substring(0, 60) });
          } else {
            respond({ success: false, reason: 'react-paste-no-effect', domText: domText.substring(0, 60) });
          }
        }, 500);
        return;
      }

      // ── Стратегия C: Диспатч paste из page context ──
      console.log('[FlowBatch/page] Стратегия C: нативный paste из page context');
      element.focus();
      document.execCommand('selectAll', false, null);

      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      const pasteEvent = new ClipboardEvent('paste', {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
        composed: true,
      });
      const cancelled = !element.dispatchEvent(pasteEvent);
      console.log('[FlowBatch/page] paste dispatched, cancelled:', cancelled);

      setTimeout(() => {
        const domText = (element.textContent || '').trim();
        if (domText.includes(text.substring(0, Math.min(20, text.length)))) {
          respond({ success: true, method: 'native-paste-page', domText: domText.substring(0, 60) });
        } else {
          respond({ success: false, reason: 'all_strategies_failed', domText: domText.substring(0, 60) });
        }
      }, 500);

    } catch (err) {
      console.error('[FlowBatch/page] Ошибка:', err);
      respond({ success: false, reason: err.message });
    }
  });

  // ─── Диагностика ──────────────────────────────────────
  window.addEventListener('flowbatch-diagnose-request', (e) => {
    const { requestId } = e.detail || {};

    try {
      const element = document.querySelector('[contenteditable="true"][role="textbox"]');
      const fiberKey = element ? findReactFiberKey(element) : null;
      const propsKey = element ? findReactPropsKey(element) : null;
      const editor = element ? findSlateEditor(element) : null;
      const onPaste = element ? getReactPasteHandler(element) : null;

      // Собираем информацию о tabs
      const tabs = document.querySelectorAll('[role="tab"]');
      const tabInfo = Array.from(tabs).map(t => ({
        text: t.textContent.trim().substring(0, 50),
        ariaSelected: t.getAttribute('aria-selected'),
        ariaLabel: t.getAttribute('aria-label') || '',
        className: t.className.substring(0, 80),
        visible: t.offsetParent !== null,
        tagName: t.tagName,
        rect: (() => { const r = t.getBoundingClientRect(); return { top: r.top, left: r.left, w: r.width, h: r.height }; })()
      }));

      const result = {
        requestId,
        found: !!element,
        hasFiber: !!fiberKey,
        hasProps: !!propsKey,
        hasSlateEditor: !!editor,
        hasOnPaste: !!onPaste,
        editorChildren: editor ? JSON.stringify(editor.children).substring(0, 300) : null,
        editorSelection: editor ? JSON.stringify(editor.selection) : null,
        editorMethods: editor ? Object.keys(editor).filter(k => typeof editor[k] === 'function').sort() : [],
        tabs: tabInfo,
        tabsCount: tabs.length,
        reactVersion: window.React?.version || 'not exposed',
      };

      window.dispatchEvent(new CustomEvent('flowbatch-diagnose-response', {
        detail: result
      }));
    } catch (err) {
      window.dispatchEvent(new CustomEvent('flowbatch-diagnose-response', {
        detail: { requestId, error: err.message }
      }));
    }
  });

  // Сигнал content script что page context загружен
  window.dispatchEvent(new CustomEvent('flowbatch-page-ready', { detail: { version: '0.9' } }));

})();
