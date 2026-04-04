/**
 * FlowBatch — Скрипт в page context v0.8
 * 
 * НОВОЕ v0.8:
 * - Установка текста через paste event (для Slate.js)
 * - Поиск React Fiber для прямого доступа к Slate editor
 * - Улучшенная диагностика фреймворка
 */
(() => {
  'use strict';

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

  // ─── Поиск Slate Editor instance через React Fiber ────
  function findSlateEditor(domElement) {
    if (!domElement) return null;
    
    // React Fiber key начинается с __reactFiber$ или __reactInternalInstance$
    const fiberKey = Object.keys(domElement).find(k => 
      k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')
    );
    
    if (!fiberKey) {
      console.log('[FlowBatch/injected] React Fiber не найден на элементе');
      return null;
    }

    let fiber = domElement[fiberKey];
    let maxDepth = 30;

    // Идём вверх по Fiber tree, ищем компонент с editor
    while (fiber && maxDepth-- > 0) {
      // Slate Editable component хранит editor в memoizedState через useSlate hook
      if (fiber.memoizedState) {
        let hookState = fiber.memoizedState;
        let hookDepth = 20;
        while (hookState && hookDepth-- > 0) {
          const val = hookState.memoizedState;
          // Slate editor имеет характерные методы: insertText, deleteBackward, apply, onChange
          if (val && typeof val === 'object' && 
              typeof val.insertText === 'function' && 
              typeof val.deleteBackward === 'function' &&
              typeof val.apply === 'function') {
            console.log('[FlowBatch/injected] Slate Editor найден через React Fiber!');
            return val;
          }
          // Проверяем queue (некоторые версии React)
          if (val && val.queue && val.queue.lastRenderedState) {
            const qState = val.queue.lastRenderedState;
            if (qState && typeof qState.insertText === 'function') {
              console.log('[FlowBatch/injected] Slate Editor найден через queue!');
              return qState;
            }
          }
          hookState = hookState.next;
        }
      }
      
      // Проверяем pendingProps и memoizedProps
      const props = fiber.memoizedProps || fiber.pendingProps;
      if (props?.editor && typeof props.editor.insertText === 'function') {
        console.log('[FlowBatch/injected] Slate Editor найден в props!');
        return props.editor;
      }
      
      fiber = fiber.return;
    }

    console.log('[FlowBatch/injected] Slate Editor НЕ найден в Fiber tree');
    return null;
  }

  // ─── Установка текста из page context ──────────────────
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

      // ── Попытка 1: Прямой доступ к Slate Editor ──
      const editor = findSlateEditor(element);
      if (editor) {
        try {
          console.log('[FlowBatch/injected] Используем Slate Editor API напрямую');
          
          // Импортируем Transforms и Editor из Slate
          // Slate editor instance имеет все нужные методы
          
          // Выделить всё
          if (editor.selection) {
            // Slate Transforms.select(editor, []) — выделяет весь документ
            const point = { path: [0, 0], offset: 0 };
            const endOfDoc = (() => {
              try {
                // Находим конец документа
                const lastChild = editor.children[editor.children.length - 1];
                if (lastChild && lastChild.children) {
                  const lastText = lastChild.children[lastChild.children.length - 1];
                  return { path: [editor.children.length - 1, lastChild.children.length - 1], offset: (lastText.text || '').length };
                }
                return { path: [0, 0], offset: 0 };
              } catch (e) {
                return { path: [0, 0], offset: 0 };
              }
            })();
            
            editor.selection = { anchor: point, focus: endOfDoc };
          }
          
          // Удалить содержимое
          if (editor.selection) {
            editor.deleteFragment();
          }
          
          // Вставить текст
          editor.insertText(text);
          
          // Trigger change
          if (editor.onChange) editor.onChange();
          
          const resultText = (element.textContent || '').trim();
          console.log('[FlowBatch/injected] После Slate API, textContent:', resultText.substring(0, 60));
          
          window.dispatchEvent(new CustomEvent('flowbatch-settext-response', {
            detail: { requestId, success: true, method: 'slate-api', textContent: resultText.substring(0, 60) }
          }));
          return;
        } catch (slateErr) {
          console.warn('[FlowBatch/injected] Ошибка Slate API:', slateErr.message);
        }
      }

      // ── Попытка 2: Paste через page context ──
      console.log('[FlowBatch/injected] Пробуем paste из page context...');
      
      element.focus();
      
      // SelectAll
      document.execCommand('selectAll', false, null);
      
      setTimeout(() => {
        // Создаём DataTransfer
        const dt = new DataTransfer();
        dt.setData('text/plain', text);
        
        // Paste event
        const pasteEvent = new ClipboardEvent('paste', {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
          composed: true,
        });
        
        const cancelled = !element.dispatchEvent(pasteEvent);
        console.log('[FlowBatch/injected] paste dispatched from page context, cancelled:', cancelled);
        
        setTimeout(() => {
          const resultText = (element.textContent || '').trim();
          console.log('[FlowBatch/injected] после paste, textContent:', resultText.substring(0, 60));
          
          // Проверяем что текст вставлен
          const success = resultText.includes(text.substring(0, Math.min(20, text.length)));
          
          window.dispatchEvent(new CustomEvent('flowbatch-settext-response', {
            detail: { 
              requestId, 
              success,
              method: cancelled ? 'paste-intercepted' : 'paste-fallback',
              textContent: resultText.substring(0, 60)
            }
          }));
        }, 500);
      }, 200);

    } catch (err) {
      console.error('[FlowBatch/injected] Ошибка:', err);
      window.dispatchEvent(new CustomEvent('flowbatch-settext-response', {
        detail: { requestId, success: false, reason: err.message }
      }));
    }
  });

  // ─── Диагностика фреймворка v0.8 ────────────────────
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

      const isSlate = !!(
        element.hasAttribute('data-slate-editor') || 
        element.hasAttribute('data-slate-node') ||
        element.querySelector('[data-slate-node]')
      );

      const fiberKey = Object.keys(element).find(k => 
        k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')
      );
      
      const slateEditor = findSlateEditor(element);
      
      const hasZone = !!window.Zone;
      const hasNg = !!window.ng;
      const hasLit = !!window.litElementVersions || !!window.litHtmlVersions;
      const hasReact = !!fiberKey;

      window.dispatchEvent(new CustomEvent('flowbatch-diagnose-response', {
        detail: {
          requestId,
          found: true,
          isSlate,
          hasReact,
          hasSlateEditor: !!slateEditor,
          slateEditorMethods: slateEditor ? Object.keys(slateEditor).filter(k => typeof slateEditor[k] === 'function').slice(0, 20) : [],
          hasZone,
          hasNg,
          hasLit,
          innerHTML: (element.innerHTML || '').substring(0, 200),
          childNodes: element.childNodes.length,
        }
      }));
    } catch (err) {
      window.dispatchEvent(new CustomEvent('flowbatch-diagnose-response', {
        detail: { requestId, error: err.message }
      }));
    }
  });

  console.log('[FlowBatch] Fetch/XHR перехватчик + Slate.js paste support активирован (v0.8)');
})();
