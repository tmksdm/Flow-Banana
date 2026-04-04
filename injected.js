/**
 * FlowBatch — Page Context Script v0.12
 * 
 * Фиксы v0.12:
 * - _isGenerationRequest: ТОЛЬКО batchGenerate/flowMedia:batch — НЕ credits, batchLog, recommendations
 * - Добавлен обработчик flowbatch-download-request для скачивания через fetch в page context
 * - Добавлен обработчик flowbatch-discover-assets-request для исследования DOM ассетов
 */
(() => {
  'use strict';

  if (window.__flowbatch_injected_v12) return;
  window.__flowbatch_injected_v12 = true;
  console.log('[FlowBatch/page] Page context script v0.12 загружен');

  let cachedSlateEditor = null;
  let cachedEditorElement = null;

  // ─── Сетевой трекер ────────────────────────────────────
  const networkTracker = {
    pendingRequests: 0,
    lastRequestTime: 0,
    lastResponseTime: 0,
    recentRequests: [],
    generationSignalDetected: false,
    lastGenerationResponseUrl: null,

    onRequestStart(url, method) {
      this.pendingRequests++;
      this.lastRequestTime = Date.now();
      this.recentRequests.push({ url, method, status: 'pending', time: Date.now() });
      if (this.recentRequests.length > 30) this.recentRequests.shift();

      if (this._isGenerationRequest(url, method)) {
        this.generationSignalDetected = true;
        console.log('[FlowBatch/page] 🚀 Обнаружен запрос генерации:', method, url.substring(0, 120));
        window.dispatchEvent(new CustomEvent('flowbatch-generation-started', {
          detail: { url, method, timestamp: Date.now() }
        }));
      }
    },

    onRequestEnd(url, status) {
      this.pendingRequests = Math.max(0, this.pendingRequests - 1);
      this.lastResponseTime = Date.now();
      const entry = this.recentRequests.findLast(r => r.url === url && r.status === 'pending');
      if (entry) entry.status = status;

      if (this._isGenerationRequest(url, 'POST')) {
        this.lastGenerationResponseUrl = url;
        console.log('[FlowBatch/page] ✅ Ответ генерации:', status, url.substring(0, 120));
        window.dispatchEvent(new CustomEvent('flowbatch-generation-response', {
          detail: { url, status, timestamp: Date.now() }
        }));
      }
    },

    /**
     * УЖЕСТОЧЁННЫЙ фильтр v0.12:
     * Только реальные запросы генерации, НЕ логирование/credits/recommendations
     */
    _isGenerationRequest(url, method) {
      const u = url.toLowerCase();
      // Исключаем шум
      if (u.includes('/credits')) return false;
      if (u.includes('batchlog')) return false;
      if (u.includes('batchlogfrontendevents')) return false;
      if (u.includes('fetchuserrecommendations')) return false;
      if (u.includes('fetchuseracknowledgement')) return false;
      if (u.includes('/auth/')) return false;
      if (u.includes('recaptcha')) return false;
      // Только настоящие запросы генерации
      return (
        u.includes('batchgenerate') ||          // batchGenerateImages, batchGenerateVideos
        u.includes('flowmedia:batch') ||         // flowMedia:batch*
        u.includes('/generate') ||               // другие generate endpoints
        u.includes('/prediction') ||
        u.includes('generativelanguage') ||
        u.includes('aiplatform') ||
        u.includes('/imagen') ||
        u.includes('/veo')
      );
    },

    resetGenerationSignal() {
      this.generationSignalDetected = false;
      this.lastGenerationResponseUrl = null;
    },

    getState() {
      return {
        pending: this.pendingRequests,
        generationDetected: this.generationSignalDetected,
        lastGenerationUrl: this.lastGenerationResponseUrl,
        recent: this.recentRequests.slice(-10).map(r => ({
          url: r.url.substring(0, 80),
          method: r.method,
          status: r.status,
          age: Date.now() - r.time
        }))
      };
    }
  };

  // ─── Перехват fetch ────────────────────────────────────
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
    const method = args[1]?.method || (typeof args[0] === 'object' ? args[0]?.method : null) || 'GET';
    networkTracker.onRequestStart(url, method);
    try {
      const response = await originalFetch.apply(this, args);
      networkTracker.onRequestEnd(url, response.status);
      return response;
    } catch (err) {
      networkTracker.onRequestEnd(url, 'error');
      throw err;
    }
  };

  // ─── Перехват XHR ─────────────────────────────────────
  const originalXHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._fb_url = url;
    this._fb_method = method;
    networkTracker.onRequestStart(url, method);
    return originalXHROpen.call(this, method, url, ...rest);
  };
  const originalXHRSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', function () {
      networkTracker.onRequestEnd(this._fb_url || '', this.status);
    });
    this.addEventListener('error', function () {
      networkTracker.onRequestEnd(this._fb_url || '', 'error');
    });
    return originalXHRSend.apply(this, args);
  };

  // ─── React helpers ─────────────────────────────────────
  function findReactFiberKey(el) {
    if (!el) return null;
    return Object.keys(el).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')) || null;
  }

  function findReactPropsKey(el) {
    if (!el) return null;
    return Object.keys(el).find(k => k.startsWith('__reactProps$')) || null;
  }

  function clickViaReact(element) {
    if (!element) return false;
    const propsKey = findReactPropsKey(element);
    if (propsKey) {
      const props = element[propsKey];
      if (typeof props?.onClick === 'function') {
        const rect = element.getBoundingClientRect();
        props.onClick({
          type: 'click', target: element, currentTarget: element,
          bubbles: true, cancelable: true, defaultPrevented: false,
          preventDefault: () => {}, stopPropagation: () => {},
          nativeEvent: new MouseEvent('click', { bubbles: true }),
          clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
          persist: () => {}, isDefaultPrevented: () => false, isPropagationStopped: () => false,
        });
        console.log('[FlowBatch/page] clickViaReact: onClick через props ✓');
        return true;
      }
    }
    const fiberKey = findReactFiberKey(element);
    if (fiberKey) {
      let fiber = element[fiberKey];
      let depth = 15;
      while (fiber && depth-- > 0) {
        const fp = fiber.memoizedProps || fiber.pendingProps;
        if (fp && typeof fp.onClick === 'function') {
          const rect = element.getBoundingClientRect();
          fp.onClick({
            type: 'click', target: element, currentTarget: element,
            bubbles: true, cancelable: true, defaultPrevented: false,
            preventDefault: () => {}, stopPropagation: () => {},
            nativeEvent: new MouseEvent('click', { bubbles: true }),
            clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
            persist: () => {}, isDefaultPrevented: () => false, isPropagationStopped: () => false,
          });
          console.log('[FlowBatch/page] clickViaReact: onClick через fiber tree ✓');
          return true;
        }
        fiber = fiber.return;
      }
    }
    console.log('[FlowBatch/page] clickViaReact: onClick не найден');
    element.click();
    return false;
  }

  // ─── Slate Editor ──────────────────────────────────────
  function isSlateEditorObject(val) {
    if (!val || typeof val !== 'object') return false;
    return typeof val.insertText === 'function' && typeof val.apply === 'function' && Array.isArray(val.children);
  }

  function findSlateEditor(domElement) {
    if (!domElement) return null;
    if (cachedSlateEditor && cachedEditorElement === domElement) {
      try { if (typeof cachedSlateEditor.insertText === 'function') return cachedSlateEditor; } catch (e) {}
      cachedSlateEditor = null;
    }
    const fiberKey = findReactFiberKey(domElement);
    if (!fiberKey) return null;
    let fiber = domElement[fiberKey];
    let maxDepth = 50;
    while (fiber && maxDepth-- > 0) {
      if (fiber.memoizedState) {
        let hs = fiber.memoizedState;
        let hd = 30;
        while (hs && hd-- > 0) {
          const val = hs.memoizedState;
          if (isSlateEditorObject(val)) { cachedSlateEditor = val; cachedEditorElement = domElement; return val; }
          if (val?.current && isSlateEditorObject(val.current)) { cachedSlateEditor = val.current; cachedEditorElement = domElement; return val.current; }
          if (Array.isArray(val)) { for (const item of val) { if (isSlateEditorObject(item)) { cachedSlateEditor = item; cachedEditorElement = domElement; return item; } } }
          hs = hs.next;
        }
      }
      const props = fiber.memoizedProps || fiber.pendingProps;
      if (props) {
        for (const key of Object.keys(props)) {
          if (isSlateEditorObject(props[key])) { cachedSlateEditor = props[key]; cachedEditorElement = domElement; return props[key]; }
        }
      }
      fiber = fiber.return;
    }
    return null;
  }

  // ─── Ввод текста через Slate ───────────────────────────
  function setTextViaSlateAPI(editor, text) {
    try {
      const hasContent = editor.children.some(n => (n.children || [n]).some(c => (c.text || '').length > 0));
      if (hasContent) {
        const lastNodeIdx = editor.children.length - 1;
        const lastNode = editor.children[lastNodeIdx];
        const lastChildIdx = lastNode.children ? lastNode.children.length - 1 : 0;
        const lastChild = lastNode.children ? lastNode.children[lastChildIdx] : lastNode;
        const lastOffset = (lastChild.text || '').length;
        editor.apply({ type: 'set_selection', properties: editor.selection, newProperties: { anchor: { path: [0, 0], offset: 0 }, focus: { path: [lastNodeIdx, lastChildIdx], offset: lastOffset } } });
        editor.deleteFragment();
      }
      if (!editor.selection) {
        editor.apply({ type: 'set_selection', properties: null, newProperties: { anchor: { path: [0, 0], offset: 0 }, focus: { path: [0, 0], offset: 0 } } });
      }
      editor.insertText(text);
      if (typeof editor.onChange === 'function') editor.onChange();
      const editorText = editor.children.map(n => (n.children || [n]).map(c => c.text || '').join('')).join('\n').trim();
      console.log('[FlowBatch/page] Slate insertText ✓, текст:', editorText.substring(0, 50));
      return true;
    } catch (e) {
      console.error('[FlowBatch/page] Slate ошибка:', e.message);
      return false;
    }
  }

  // ─── Обработчик settext ────────────────────────────────
  window.addEventListener('flowbatch-settext-request', (e) => {
    const { text, requestId } = e.detail || {};
    if (!text || !requestId) return;

    const respond = (data) => {
      window.dispatchEvent(new CustomEvent('flowbatch-settext-response', { detail: { requestId, ...data } }));
    };

    try {
      const element = document.querySelector('[contenteditable="true"][role="textbox"]');
      if (!element) return respond({ success: false, reason: 'element_not_found' });

      const editor = findSlateEditor(element);
      if (editor) {
        const result = setTextViaSlateAPI(editor, text);
        if (result) {
          const editorText = editor.children.map(n => (n.children || [n]).map(c => c.text || '').join('')).join('\n').trim();
          if (editorText.includes(text.substring(0, Math.min(20, text.length)))) {
            return respond({ success: true, method: 'slate-api', editorText: editorText.substring(0, 60) });
          }
        }
      }

      // Fallback: React onPaste
      const propsKey = findReactPropsKey(element);
      const onPaste = propsKey ? element[propsKey]?.onPaste : null;
      if (typeof onPaste === 'function') {
        element.focus();
        document.execCommand('selectAll', false, null);
        const dt = new DataTransfer();
        dt.setData('text/plain', text);
        onPaste({
          clipboardData: dt, preventDefault: () => {}, stopPropagation: () => {},
          nativeEvent: new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }),
          type: 'paste', target: element, currentTarget: element,
          bubbles: true, cancelable: true, persist: () => {},
          isDefaultPrevented: () => false, isPropagationStopped: () => false,
        });
        return setTimeout(() => {
          const domText = (element.textContent || '').trim();
          respond(domText.includes(text.substring(0, 20))
            ? { success: true, method: 'react-paste', editorText: domText.substring(0, 60) }
            : { success: false, reason: 'react-paste-no-effect' });
        }, 500);
      }

      respond({ success: false, reason: 'no_strategy_worked' });
    } catch (err) {
      respond({ success: false, reason: err.message });
    }
  });

  // ─── Обработчик click-create ───────────────────────────
  window.addEventListener('flowbatch-click-request', (e) => {
    const { selector, requestId } = e.detail || {};
    if (!requestId) return;

    const respond = (data) => {
      window.dispatchEvent(new CustomEvent('flowbatch-click-response', { detail: { requestId, ...data } }));
    };

    try {
      networkTracker.resetGenerationSignal();
      let element = null;

      if (selector === 'CREATE_BUTTON') {
        const allBtns = document.querySelectorAll('button, [role="button"]');
        for (const btn of allBtns) {
          if (btn.offsetParent === null || btn.disabled) continue;
          const text = btn.textContent.trim();
          if (text.includes('arrow_forward') && /Create/i.test(text)) {
            element = btn;
            break;
          }
        }
        if (!element) {
          for (const btn of allBtns) {
            if (btn.offsetParent === null || btn.disabled) continue;
            const text = btn.textContent.trim();
            if (/Create/i.test(text) && !text.includes('add_2') && !text.includes('add')) {
              element = btn;
              break;
            }
          }
        }
        if (element) {
          console.log('[FlowBatch/page] Кнопка Create найдена:', element.textContent.trim().substring(0, 40));
        }
      } else if (selector) {
        element = document.querySelector(selector);
      }

      if (!element) return respond({ success: false, reason: 'element_not_found' });

      const reactClicked = clickViaReact(element);
      setTimeout(() => element.click(), 100);

      setTimeout(() => {
        respond({ success: true, method: reactClicked ? 'react-props' : 'native-click', networkState: networkTracker.getState() });
      }, 2000);

    } catch (err) {
      respond({ success: false, reason: err.message });
    }
  });

  // ─── Обработчик discover-assets: исследование DOM ассетов ───
  window.addEventListener('flowbatch-discover-assets-request', (e) => {
    const { requestId } = e.detail || {};
    const respond = (data) => {
      window.dispatchEvent(new CustomEvent('flowbatch-discover-assets-response', { detail: { requestId, ...data } }));
    };

    try {
      // Найти все img на странице, которые могут быть результатами генерации
      const allImages = document.querySelectorAll('img');
      const assetInfo = [];

      for (const img of allImages) {
        const src = img.src || '';
        if (!src) continue;
        if (img.naturalWidth > 0 && img.naturalWidth < 100) continue;
        if (img.width > 0 && img.width < 100) continue;

        // Поднимаемся по DOM и ищем кнопки рядом
        const nearbyButtons = [];
        let container = img.parentElement;
        let depth = 0;
        while (container && depth < 6) {
          const btns = container.querySelectorAll('button, [role="button"]');
          for (const btn of btns) {
            if (btn.offsetParent === null) continue;
            nearbyButtons.push({
              text: btn.textContent.trim().substring(0, 60),
              ariaLabel: btn.getAttribute('aria-label') || '',
              role: btn.getAttribute('role') || '',
              depth
            });
          }
          if (nearbyButtons.length > 0 && depth > 2) break;
          container = container.parentElement;
          depth++;
        }

        assetInfo.push({
          src: src.substring(0, 100),
          width: img.naturalWidth || img.width,
          height: img.naturalHeight || img.height,
          alt: (img.alt || '').substring(0, 50),
          parentTag: img.parentElement?.tagName,
          parentRole: img.parentElement?.getAttribute('role') || '',
          nearbyButtons: nearbyButtons.slice(0, 10)
        });
      }

      // Также ищем кнопки download на странице
      const downloadButtons = [];
      const allBtns = document.querySelectorAll('button, [role="button"], [role="menuitem"]');
      for (const btn of allBtns) {
        const text = btn.textContent.trim().toLowerCase();
        const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
        if (text.includes('download') || text.includes('скачать') ||
            ariaLabel.includes('download') || ariaLabel.includes('скачать') ||
            text === 'save' || ariaLabel.includes('save')) {
          downloadButtons.push({
            text: btn.textContent.trim().substring(0, 60),
            ariaLabel: btn.getAttribute('aria-label') || '',
            visible: btn.offsetParent !== null,
            tag: btn.tagName,
            role: btn.getAttribute('role') || ''
          });
        }
      }

      respond({
        totalImages: allImages.length,
        assets: assetInfo.slice(0, 15),
        downloadButtons,
        hasOverlay: !!document.querySelector('[role="dialog"], [aria-modal="true"]')
      });
    } catch (err) {
      respond({ error: err.message });
    }
  });

  // ─── Обработчик download: скачивание через fetch с авторизацией ───
  window.addEventListener('flowbatch-download-request', (e) => {
    const { url, requestId } = e.detail || {};
    if (!url || !requestId) return;

    const respond = (data) => {
      window.dispatchEvent(new CustomEvent('flowbatch-download-response', { detail: { requestId, ...data } }));
    };

    (async () => {
      try {
        console.log('[FlowBatch/page] Скачивание через fetch:', url.substring(0, 80));
        const response = await originalFetch(url, { credentials: 'include' });
        if (!response.ok) {
          return respond({ success: false, reason: `HTTP ${response.status}` });
        }
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const contentType = response.headers.get('content-type') || blob.type || '';
        respond({
          success: true,
          blobUrl,
          contentType,
          size: blob.size
        });
      } catch (err) {
        respond({ success: false, reason: err.message });
      }
    })();
  });

  // ─── Обработчик click-element: клик по произвольному элементу ───
  window.addEventListener('flowbatch-click-element-request', (e) => {
    const { selector, index, requestId } = e.detail || {};
    if (!requestId) return;

    const respond = (data) => {
      window.dispatchEvent(new CustomEvent('flowbatch-click-element-response', { detail: { requestId, ...data } }));
    };

    try {
      let element = null;
      if (selector) {
        const elements = document.querySelectorAll(selector);
        element = elements[index || 0] || elements[0];
      }
      if (!element) return respond({ success: false, reason: 'element_not_found' });

      clickViaReact(element);
      respond({ success: true });
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
      window.dispatchEvent(new CustomEvent('flowbatch-scan-ui-response', { detail: { requestId, ...data } }));
    };
    try {
      const promptEl = document.querySelector('[contenteditable="true"][role="textbox"]');
      const toolbarElements = [];
      if (promptEl) {
        let container = promptEl.parentElement;
        let depth = 0;
        while (container && depth < 8) {
          const clickables = container.querySelectorAll('button, [role="button"], [role="tab"]');
          for (const el of clickables) {
            if (el === promptEl || el.contains(promptEl)) continue;
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) continue;
            const propsKey = findReactPropsKey(el);
            toolbarElements.push({
              tag: el.tagName, role: el.getAttribute('role') || '',
              text: el.textContent.trim().substring(0, 60),
              hasOnClick: propsKey ? typeof el[propsKey]?.onClick === 'function' : false,
              depth
            });
          }
          container = container.parentElement;
          depth++;
        }
      }
      respond({ toolbarCount: toolbarElements.length, toolbar: toolbarElements.slice(0, 30) });
    } catch (err) {
      respond({ error: err.message });
    }
  });

  // ─── Диагностика ──────────────────────────────────────
  window.addEventListener('flowbatch-diagnose-request', (e) => {
    const { requestId } = e.detail || {};
    try {
      const element = document.querySelector('[contenteditable="true"][role="textbox"]');
      const editor = element ? findSlateEditor(element) : null;
      window.dispatchEvent(new CustomEvent('flowbatch-diagnose-response', {
        detail: {
          requestId, found: !!element,
          hasSlateEditor: !!editor,
          editorChildren: editor ? JSON.stringify(editor.children).substring(0, 300) : null,
          networkState: networkTracker.getState(),
        }
      }));
    } catch (err) {
      window.dispatchEvent(new CustomEvent('flowbatch-diagnose-response', { detail: { requestId, error: err.message } }));
    }
  });

  window.dispatchEvent(new CustomEvent('flowbatch-page-ready', { detail: { version: '0.12' } }));
})();
