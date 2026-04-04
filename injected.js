/**
 * FlowBatch — Page Context Script v0.10
 * 
 * ИЗМЕНЕНИЯ v0.10:
 * - Добавлен детальный мониторинг ВСЕХ fetch/XHR (логирование method, url, status)
 * - Добавлена функция clickViaReact — клик через React props (__reactProps$)
 * - Добавлен глобальный трекер сетевой активности (для определения начала генерации)
 * - Добавлена команда "scan-ui" для глубокого сканирования toolbar/кнопок
 * - Добавлена команда "click-create-react" для клика Create через React
 */
(() => {
  'use strict';

  if (window.__flowbatch_injected_v10) return;
  window.__flowbatch_injected_v10 = true;

  console.log('[FlowBatch/page] Page context script v0.10 загружен');

  // ─── Кеш Slate Editor ──────────────────────────────────
  let cachedSlateEditor = null;
  let cachedEditorElement = null;

  // ─── Трекер сетевой активности ─────────────────────────
  // Используется для определения начала/завершения генерации
  const networkTracker = {
    pendingRequests: 0,
    lastRequestTime: 0,
    lastResponseTime: 0,
    recentRequests: [], // последние 30 запросов {url, method, status, time}
    generationSignalDetected: false,
    
    onRequestStart(url, method) {
      this.pendingRequests++;
      this.lastRequestTime = Date.now();
      this.recentRequests.push({ url, method, status: 'pending', time: Date.now() });
      if (this.recentRequests.length > 30) this.recentRequests.shift();
      
      // Детектируем запрос генерации
      if (this._isGenerationRequest(url, method)) {
        this.generationSignalDetected = true;
        console.log('[FlowBatch/page] 🚀 Обнаружен запрос генерации:', method, url.substring(0, 100));
        window.dispatchEvent(new CustomEvent('flowbatch-generation-started', {
          detail: { url, method, timestamp: Date.now() }
        }));
      }
    },
    
    onRequestEnd(url, status) {
      this.pendingRequests = Math.max(0, this.pendingRequests - 1);
      this.lastResponseTime = Date.now();
      
      // Обновляем статус в recentRequests
      const entry = this.recentRequests.findLast(r => r.url === url && r.status === 'pending');
      if (entry) entry.status = status;
      
      // Детектируем ответ генерации
      if (this._isGenerationRequest(url, 'response')) {
        console.log('[FlowBatch/page] ✅ Ответ генерации получен:', status, url.substring(0, 100));
        window.dispatchEvent(new CustomEvent('flowbatch-generation-response', {
          detail: { url, status, timestamp: Date.now() }
        }));
      }
    },
    
    _isGenerationRequest(url, method) {
      const u = url.toLowerCase();
      return (
        u.includes('generate') ||
        u.includes('prediction') ||
        u.includes('generativelanguage') ||
        u.includes('aiplatform') ||
        u.includes('imagen') ||
        u.includes('veo') ||
        (u.includes('api') && (u.includes('create') || u.includes('run'))) ||
        (method === 'POST' && (u.includes('model') || u.includes('endpoint')))
      );
    },
    
    resetGenerationSignal() {
      this.generationSignalDetected = false;
    },
    
    getState() {
      return {
        pending: this.pendingRequests,
        lastReqAge: Date.now() - this.lastRequestTime,
        lastRespAge: Date.now() - this.lastResponseTime,
        generationDetected: this.generationSignalDetected,
        recent: this.recentRequests.slice(-10).map(r => ({
          url: r.url.substring(0, 80),
          method: r.method,
          status: r.status,
          age: Date.now() - r.time
        }))
      };
    }
  };

  // ─── Перехват fetch ─────────────────────────────────────
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
    const method = args[1]?.method || (typeof args[0] === 'object' ? args[0]?.method : null) || 'GET';
    
    networkTracker.onRequestStart(url, method);
    
    try {
      const response = await originalFetch.apply(this, args);
      
      networkTracker.onRequestEnd(url, response.status);
      
      // Уведомление content script о важных запросах
      if (
        url.includes('generativelanguage') ||
        url.includes('generated') ||
        url.includes('download') ||
        url.includes('generate') ||
        url.includes('prediction') ||
        (url.includes('image') && url.includes('output'))
      ) {
        window.dispatchEvent(new CustomEvent('flowbatch-intercepted', {
          detail: { url, method, status: response.status, type: 'fetch', timestamp: Date.now() }
        }));
      }
      
      return response;
    } catch (err) {
      networkTracker.onRequestEnd(url, 'error');
      throw err;
    }
  };

  // ─── Перехват XMLHttpRequest ──────────────────────────
  const originalXHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._flowbatch_url = url;
    this._flowbatch_method = method;
    networkTracker.onRequestStart(url, method);
    return originalXHROpen.call(this, method, url, ...rest);
  };

  const originalXHRSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', function () {
      try {
        const url = this._flowbatch_url || '';
        networkTracker.onRequestEnd(url, this.status);
        
        if (
          url.includes('generativelanguage') ||
          url.includes('generated') ||
          url.includes('download') ||
          url.includes('generate')
        ) {
          window.dispatchEvent(new CustomEvent('flowbatch-intercepted', {
            detail: { url, method: this._flowbatch_method, status: this.status, type: 'xhr', timestamp: Date.now() }
          }));
        }
      } catch (e) {}
    });
    this.addEventListener('error', function () {
      networkTracker.onRequestEnd(this._flowbatch_url || '', 'error');
    });
    return originalXHRSend.apply(this, args);
  };

  // ─── React Fiber / Props helpers ───────────────────────
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

  // ─── Клик через React props (onClick) ──────────────────
  /**
   * Вызывает React onClick handler напрямую через __reactProps$.
   * Это обходит проблему с isTrusted: false.
   */
  function clickViaReact(element) {
    if (!element) return false;
    
    const propsKey = findReactPropsKey(element);
    if (propsKey) {
      const props = element[propsKey];
      if (typeof props?.onClick === 'function') {
        const rect = element.getBoundingClientRect();
        const syntheticEvent = {
          type: 'click',
          target: element,
          currentTarget: element,
          bubbles: true,
          cancelable: true,
          defaultPrevented: false,
          preventDefault: () => {},
          stopPropagation: () => {},
          nativeEvent: new MouseEvent('click', { bubbles: true }),
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          persist: () => {},
          isDefaultPrevented: () => false,
          isPropagationStopped: () => false,
        };
        props.onClick(syntheticEvent);
        console.log('[FlowBatch/page] clickViaReact: onClick вызван через props');
        return true;
      }
    }
    
    // Fallback: ищем onClick в fiber tree (вверх по дереву)
    const fiberKey = findReactFiberKey(element);
    if (fiberKey) {
      let fiber = element[fiberKey];
      let depth = 10;
      while (fiber && depth-- > 0) {
        const fiberProps = fiber.memoizedProps || fiber.pendingProps;
        if (fiberProps && typeof fiberProps.onClick === 'function') {
          const rect = element.getBoundingClientRect();
          fiberProps.onClick({
            type: 'click',
            target: element,
            currentTarget: element,
            bubbles: true,
            cancelable: true,
            defaultPrevented: false,
            preventDefault: () => {},
            stopPropagation: () => {},
            nativeEvent: new MouseEvent('click', { bubbles: true }),
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
            persist: () => {},
            isDefaultPrevented: () => false,
            isPropagationStopped: () => false,
          });
          console.log('[FlowBatch/page] clickViaReact: onClick найден в fiber tree');
          return true;
        }
        fiber = fiber.return;
      }
    }
    
    console.log('[FlowBatch/page] clickViaReact: onClick не найден, используем нативный click()');
    element.click();
    return true;
  }

  // ─── Поиск Slate Editor через React Fiber ─────────────
  function findSlateEditor(domElement) {
    if (!domElement) return null;

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
      if (fiber.memoizedState) {
        let hookState = fiber.memoizedState;
        let hookDepth = 30;
        while (hookState && hookDepth-- > 0) {
          const val = hookState.memoizedState;

          if (isSlateEditorObject(val)) {
            console.log('[FlowBatch/page] Slate Editor найден в hooks (memoizedState)');
            cachedSlateEditor = val;
            cachedEditorElement = domElement;
            return val;
          }

          if (val && typeof val === 'object' && val.current && isSlateEditorObject(val.current)) {
            console.log('[FlowBatch/page] Slate Editor найден в ref.current');
            cachedSlateEditor = val.current;
            cachedEditorElement = domElement;
            return val.current;
          }

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

      const props = fiber.memoizedProps || fiber.pendingProps;
      if (props) {
        for (const key of Object.keys(props)) {
          if (isSlateEditorObject(props[key])) {
            console.log(`[FlowBatch/page] Slate Editor найден в fiber.props.${key}`);
            cachedSlateEditor = props[key];
            cachedEditorElement = domElement;
            return props[key];
          }
        }
      }

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
    return (
      typeof val.insertText === 'function' &&
      typeof val.apply === 'function' &&
      typeof val.deleteBackward === 'function' &&
      Array.isArray(val.children)
    );
  }

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
  function setTextViaSlateAPI(editor, text) {
    try {
      console.log('[FlowBatch/page] setTextViaSlateAPI: начинаем...');
      console.log('[FlowBatch/page] editor.children:', JSON.stringify(editor.children).substring(0, 200));
      console.log('[FlowBatch/page] editor.selection:', JSON.stringify(editor.selection));

      const hasContent = editor.children.some(node => {
        if (node.children) {
          return node.children.some(child => (child.text || '').length > 0);
        }
        return (node.text || '').length > 0;
      });

      if (hasContent) {
        const lastNodeIndex = editor.children.length - 1;
        const lastNode = editor.children[lastNodeIndex];
        const lastChildIndex = lastNode.children ? lastNode.children.length - 1 : 0;
        const lastChild = lastNode.children ? lastNode.children[lastChildIndex] : lastNode;
        const lastOffset = (lastChild.text || '').length;

        const anchor = { path: [0, 0], offset: 0 };
        const focus = { path: [lastNodeIndex, lastChildIndex], offset: lastOffset };

        editor.apply({
          type: 'set_selection',
          properties: editor.selection,
          newProperties: { anchor, focus }
        });

        console.log('[FlowBatch/page] Selection установлен:', JSON.stringify({ anchor, focus }));
        editor.deleteFragment();
        console.log('[FlowBatch/page] deleteFragment выполнен');
      }

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

  function setTextViaReactPaste(domElement, text) {
    try {
      const onPaste = getReactPasteHandler(domElement);
      if (!onPaste) {
        console.log('[FlowBatch/page] React onPaste handler не найден');
        return false;
      }

      console.log('[FlowBatch/page] Вызываем React onPaste напрямую...');
      domElement.focus();
      document.execCommand('selectAll', false, null);

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

  // ─── Обработчик settext ────────────────────────────────
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

      const editor = findSlateEditor(element);
      if (editor) {
        console.log('[FlowBatch/page] Стратегия A: Slate Editor API');
        const result = setTextViaSlateAPI(editor, text);
        if (result) {
          const editorText = editor.children
            .map(n => (n.children || [n]).map(c => c.text || '').join(''))
            .join('\n')
            .trim();

          if (editorText.includes(text.substring(0, Math.min(20, text.length)))) {
            respond({ success: true, method: 'slate-api', editorText: editorText.substring(0, 60) });
            return;
          } else {
            console.warn('[FlowBatch/page] Slate API: текст не совпадает:', editorText.substring(0, 60));
          }
        }
      }

      console.log('[FlowBatch/page] Стратегия B: React onPaste');
      const pasteResult = setTextViaReactPaste(element, text);
      if (pasteResult) {
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
      element.dispatchEvent(pasteEvent);

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

  // ─── Обработчик click-create-react ─────────────────────
  window.addEventListener('flowbatch-click-request', (e) => {
    const { selector, requestId } = e.detail || {};
    if (!requestId) return;

    const respond = (data) => {
      window.dispatchEvent(new CustomEvent('flowbatch-click-response', {
        detail: { requestId, ...data }
      }));
    };

    try {
      // Сбрасываем сигнал генерации перед кликом
      networkTracker.resetGenerationSignal();
      
      let element = null;
      if (selector === 'CREATE_BUTTON') {
        // Ищем кнопку Create
        const allBtns = document.querySelectorAll('button, [role="button"]');
        for (const btn of allBtns) {
          if (btn.offsetParent === null) continue;
          const text = btn.textContent.trim();
          // "arrow_forwardCreate" → содержит "Create"
          if (/\bCreate\b/i.test(text)) {
            element = btn;
            break;
          }
        }
      } else if (selector) {
        element = document.querySelector(selector);
      }

      if (!element) {
        respond({ success: false, reason: 'element_not_found' });
        return;
      }

      console.log('[FlowBatch/page] clickViaReact для:', element.textContent.trim().substring(0, 40));
      
      // Попытка 1: React onClick через props
      const reactClicked = clickViaReact(element);
      
      // Попытка 2: нативный click() как подстраховка
      setTimeout(() => {
        element.click();
      }, 100);
      
      // Даём время на сетевой запрос
      setTimeout(() => {
        respond({
          success: true,
          method: reactClicked ? 'react-props' : 'native-click',
          networkState: networkTracker.getState()
        });
      }, 2000);
      
    } catch (err) {
      respond({ success: false, reason: err.message });
    }
  });

  // ─── Обработчик network-state ──────────────────────────
  window.addEventListener('flowbatch-network-state-request', (e) => {
    const { requestId } = e.detail || {};
    window.dispatchEvent(new CustomEvent('flowbatch-network-state-response', {
      detail: { requestId, ...networkTracker.getState() }
    }));
  });

  // ─── Обработчик scan-ui ────────────────────────────────
  window.addEventListener('flowbatch-scan-ui-request', (e) => {
    const { requestId } = e.detail || {};
    
    const respond = (data) => {
      window.dispatchEvent(new CustomEvent('flowbatch-scan-ui-response', {
        detail: { requestId, ...data }
      }));
    };
    
    try {
      const promptEl = document.querySelector('[contenteditable="true"][role="textbox"]');
      
      // Ищем toolbar / control area рядом с промптом
      // Поднимаемся вверх от промпта и сканируем соседние элементы
      const toolbarElements = [];
      
      if (promptEl) {
        let container = promptEl.parentElement;
        let depth = 0;
        
        while (container && depth < 8) {
          // Ищем все кликабельные элементы в контейнере
          const clickables = container.querySelectorAll('button, [role="button"], [role="tab"], [role="radio"], [role="menuitem"], [role="option"], a[href], [tabindex="0"]');
          
          for (const el of clickables) {
            if (el === promptEl) continue;
            if (el.contains(promptEl)) continue;
            
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) continue;
            
            const text = el.textContent.trim().substring(0, 60);
            const propsKey = findReactPropsKey(el);
            const hasOnClick = propsKey ? typeof el[propsKey]?.onClick === 'function' : false;
            
            toolbarElements.push({
              tag: el.tagName,
              role: el.getAttribute('role') || '',
              ariaLabel: el.getAttribute('aria-label') || '',
              ariaSelected: el.getAttribute('aria-selected'),
              ariaPressed: el.getAttribute('aria-pressed'),
              text: text,
              hasOnClick,
              visible: el.offsetParent !== null,
              rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
              depth
            });
          }
          
          container = container.parentElement;
          depth++;
        }
      }
      
      // Также ищем ВСЕ элементы на странице содержащие "Image" или "Video"
      const imageVideoElements = [];
      const allElements = document.querySelectorAll('*');
      for (const el of allElements) {
        if (el.children.length > 5) continue; // пропускаем контейнеры
        const text = el.textContent.trim();
        if (text.length > 80) continue;
        const lower = text.toLowerCase();
        
        if ((lower === 'image' || lower === 'video' || 
             lower === 'imageimage' || lower === 'videocamvideo' ||
             /^(image|video)\s*$/i.test(lower)) && el.offsetParent !== null) {
          
          const rect = el.getBoundingClientRect();
          imageVideoElements.push({
            tag: el.tagName,
            role: el.getAttribute('role') || '',
            text: text,
            classes: el.className?.toString?.()?.substring(0, 80) || '',
            parentTag: el.parentElement?.tagName || '',
            parentRole: el.parentElement?.getAttribute('role') || '',
            clickable: (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' || 
                       el.getAttribute('role') === 'tab' || el.getAttribute('tabindex') !== null),
            rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }
          });
        }
      }
      
      respond({
        toolbarCount: toolbarElements.length,
        toolbar: toolbarElements.slice(0, 50), // ограничиваем
        imageVideoCount: imageVideoElements.length,
        imageVideo: imageVideoElements
      });
    } catch (err) {
      respond({ error: err.message });
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

      const tabs = document.querySelectorAll('[role="tab"]');
      const tabInfo = Array.from(tabs).map(t => ({
        text: t.textContent.trim().substring(0, 50),
        ariaSelected: t.getAttribute('aria-selected'),
        ariaLabel: t.getAttribute('aria-label') || '',
        visible: t.offsetParent !== null,
        tagName: t.tagName,
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
        networkState: networkTracker.getState(),
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

  // Сигнал content script
  window.dispatchEvent(new CustomEvent('flowbatch-page-ready', { detail: { version: '0.10' } }));

})();
