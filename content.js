/**
 * FlowBatch — Content Script
 * Инъектируется в страницу Google Flow.
 * Управляет UI-автоматизацией, MutationObserver, и взаимодействием с side panel/background.
 */

(() => {
  'use strict';

  // ═══ Предотвращаем повторную загрузку ═══
  if (window.__flowbatch_loaded) return;
  window.__flowbatch_loaded = true;

  // ─── Состояние ─────────────────────────────────────────
  const state = {
    isRunning: false,
    isPaused: false,
    queue: [],
    currentIndex: 0,
    results: [],
    interceptedUrls: [],
    settings: {
      mode: 'text-to-image',
      model: 'Nano Banana Pro',
      videoModel: 'Veo 3.1 Fast',
      aspectRatio: '16:9',
      outputCount: 2,
      downloadResolution: '4K',
      autoDownload: true,
      delayBetweenPrompts: 5000,
      maxRetries: 3
    }
  };

  // ─── Инъекция перехватчика fetch/XHR ──────────────────
  function injectInterceptor() {
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('injected.js');
      script.onload = () => script.remove();
      (document.head || document.documentElement).appendChild(script);
      console.log('[FlowBatch] Перехватчик fetch/XHR инъектирован');
    } catch (e) {
      console.error('[FlowBatch] Ошибка инъекции:', e);
    }
  }

  // Слушаем перехваченные URL от injected.js
  window.addEventListener('flowbatch-intercepted', (e) => {
    const data = e.detail;
    if (data?.url) {
      state.interceptedUrls.push(data);
      console.log('[FlowBatch] Перехвачен URL:', data.url.substring(0, 100));
      notifyPanel({ type: 'LOG', text: `Перехвачен: ${data.type} ${data.url.substring(0, 80)}...`, level: 'info' });
    }
  });

  // ─── Утилиты ──────────────────────────────────────────

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Рекурсивный querySelector с обходом Shadow DOM
   */
  function deepQuery(selector, root = document) {
    const result = root.querySelector(selector);
    if (result) return result;

    // Обходим shadow roots
    const allElements = root.querySelectorAll('*');
    for (const el of allElements) {
      if (el.shadowRoot) {
        const found = deepQuery(selector, el.shadowRoot);
        if (found) return found;
      }
    }
    return null;
  }

  /**
   * Рекурсивный querySelectorAll с обходом Shadow DOM
   */
  function deepQueryAll(selector, root = document) {
    const results = [...root.querySelectorAll(selector)];

    const allElements = root.querySelectorAll('*');
    for (const el of allElements) {
      if (el.shadowRoot) {
        results.push(...deepQueryAll(selector, el.shadowRoot));
      }
    }
    return results;
  }

  /**
   * Подсчёт Shadow Roots на странице
   */
  function countShadowRoots(root = document) {
    let count = 0;
    const all = root.querySelectorAll('*');
    for (const el of all) {
      if (el.shadowRoot) {
        count++;
        count += countShadowRoots(el.shadowRoot);
      }
    }
    return count;
  }

  /**
   * Ожидание появления элемента (с поддержкой Shadow DOM)
   */
  function waitForElement(selectorFn, timeout = 30000, interval = 500) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const check = () => {
        const el = typeof selectorFn === 'function' ? selectorFn() : deepQuery(selectorFn);
        if (el) { resolve(el); return; }
        if (Date.now() - startTime > timeout) {
          reject(new Error(`Элемент не найден за ${timeout}мс`));
          return;
        }
        setTimeout(check, interval);
      };
      check();
    });
  }

  /**
   * Ожидание завершения генерации
   */
  function waitForGenerationComplete(timeout = 300000) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let wasGenerating = false;

      const check = () => {
        const isGenerating = FlowSelectors.isGenerating();

        if (isGenerating) wasGenerating = true;

        if (wasGenerating && !isGenerating) {
          setTimeout(() => resolve(true), 2000);
          return;
        }

        if (Date.now() - startTime > timeout) {
          reject(new Error(`Генерация не завершилась за ${timeout / 1000}с`));
          return;
        }

        setTimeout(check, 1000);
      };

      setTimeout(check, 2000);
    });
  }

  /**
   * Эмуляция ввода текста
   */
  function setPromptText(element, text) {
    if (!element) throw new Error('Элемент промпта не найден');

    element.focus();

    if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
      element.value = '';
      element.value = text;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      // contenteditable
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      document.execCommand('insertText', false, text);
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true, cancelable: true, inputType: 'insertText', data: text
      }));
    }
  }

  /**
   * Эмуляция клика
   */
  async function clickElement(element, delay = 300) {
    if (!element) throw new Error('Элемент для клика не найден');

    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(100);

    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    await sleep(delay);
  }

  // ─── MutationObserver ─────────────────────────────────

  let resultObserver = null;
  let lastKnownAssetCount = 0;

  function setupResultObserver(callback) {
    if (resultObserver) resultObserver.disconnect();

    resultObserver = new MutationObserver(() => {
      const assets = FlowSelectors.getGeneratedAssets();
      const currentCount = assets.images.length + assets.videos.length;

      if (currentCount > lastKnownAssetCount) {
        const newCount = currentCount - lastKnownAssetCount;
        lastKnownAssetCount = currentCount;
        console.log(`[FlowBatch] +${newCount} новых ассетов`);
        callback(assets, newCount);
      }
    });

    resultObserver.observe(document.body, {
      childList: true, subtree: true,
      attributes: true, attributeFilter: ['src', 'style', 'class']
    });
  }

  // ─── Discovery Mode: сканирование DOM ─────────────────

  function discoverDOM() {
    const contentEditables = deepQueryAll('[contenteditable="true"]');
    const textareas = deepQueryAll('textarea');
    const buttons = deepQueryAll('button');
    const tabs = deepQueryAll('[role="tab"]');
    const radios = deepQueryAll('[role="radio"]');
    const textboxes = deepQueryAll('[role="textbox"]');
    const shadowRoots = countShadowRoots();

    // Тексты кнопок (первые 30 непустых)
    const buttonTexts = [];
    for (const btn of buttons) {
      const text = btn.textContent.trim().substring(0, 60);
      if (text && buttonTexts.length < 30) {
        buttonTexts.push(text);
      }
    }

    // Детали contenteditable
    const contentEditableDetails = contentEditables.map(el => ({
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || '',
      ariaLabel: el.getAttribute('aria-label') || '',
      placeholder: el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || '',
    }));

    // Детали textarea
    const textareaDetails = textareas.map(el => ({
      ariaLabel: el.getAttribute('aria-label') || '',
      placeholder: el.getAttribute('placeholder') || '',
      name: el.getAttribute('name') || '',
    }));

    // Тексты табов
    const tabTexts = tabs.map(t => t.textContent.trim().substring(0, 40));

    // Кнопки с aria-label
    const ariaButtons = [];
    for (const btn of buttons) {
      const label = btn.getAttribute('aria-label');
      if (label && ariaButtons.length < 30) {
        ariaButtons.push(label);
      }
    }

    return {
      contentEditables: contentEditables.length,
      textareas: textareas.length,
      buttons: buttons.length,
      tabs: tabs.length,
      radios: radios.length,
      textboxes: textboxes.length,
      shadowRoots,
      buttonTexts,
      contentEditableDetails,
      textareaDetails,
      tabTexts,
      ariaButtons,
    };
  }

  // ─── Обработка одного промпта ─────────────────────────

  async function processOnePrompt(promptData) {
    const { prompt } = promptData;
    const { settings } = state;
    let retries = 0;

    while (retries <= settings.maxRetries) {
      try {
        const shortPrompt = prompt.substring(0, 50);
        console.log(`[FlowBatch] Промпт: "${shortPrompt}..." (попытка ${retries + 1})`);
        notifyPanel({ type: 'LOG', text: `Промпт: "${shortPrompt}..." (попытка ${retries + 1})`, level: 'info' });

        // 1. Найти поле ввода
        const input = await waitForElement(() => FlowSelectors.getPromptInput(), 15000);

        // 2. Ввести промпт
        setPromptText(input, prompt);
        await sleep(500);

        // 3. Нажать Generate
        const generateBtn = await waitForElement(() => FlowSelectors.getGenerateButton(), 10000);
        await clickElement(generateBtn);

        // 4. Ждём завершения генерации
        const genTimeout = settings.mode.includes('video') ? 300000 : 120000;
        await waitForGenerationComplete(genTimeout);

        console.log(`[FlowBatch] Генерация завершена: "${shortPrompt}..."`);
        notifyPanel({ type: 'LOG', text: `Генерация завершена: "${shortPrompt}..."`, level: 'success' });

        // 5. Авто-скачивание
        if (settings.autoDownload) {
          await sleep(2000);
          await triggerDownload(settings.downloadResolution);
        }

        return { success: true, prompt };

      } catch (error) {
        retries++;
        console.error(`[FlowBatch] Ошибка (попытка ${retries}):`, error.message);
        notifyPanel({ type: 'LOG', text: `Ошибка: ${error.message}`, level: 'error' });

        if (retries > settings.maxRetries) {
          return { success: false, prompt, error: error.message };
        }

        await sleep(5000 * retries);
      }
    }
  }

  // ─── Скачивание ───────────────────────────────────────

  async function triggerDownload(resolution = '4K') {
    try {
      const assets = FlowSelectors.getGeneratedAssets();
      const allAssets = [...assets.images, ...assets.videos];

      if (allAssets.length === 0) {
        console.warn('[FlowBatch] Нет ассетов для скачивания');
        return;
      }

      const lastAsset = allAssets[allAssets.length - 1];

      const moreBtn = FlowSelectors.getDownloadButton(lastAsset);
      if (moreBtn) {
        await clickElement(moreBtn);
        await sleep(500);

        const downloadOption = await waitForElement(() => FlowSelectors.getDownloadMenuOption(), 5000);
        await clickElement(downloadOption);
        await sleep(500);

        const resOption = await waitForElement(() => FlowSelectors.getResolutionOption(resolution), 5000);
        if (resOption) {
          await clickElement(resOption);
          console.log(`[FlowBatch] Скачивание: ${resolution}`);
          notifyPanel({ type: 'LOG', text: `Скачивание запущено (${resolution})`, level: 'success' });
        }
      } else {
        console.warn('[FlowBatch] Кнопка скачивания не найдена');
        notifyPanel({ type: 'LOG', text: 'Кнопка скачивания не найдена', level: 'warning' });
      }
    } catch (error) {
      console.error('[FlowBatch] Ошибка скачивания:', error.message);
      notifyPanel({ type: 'LOG', text: `Ошибка скачивания: ${error.message}`, level: 'error' });
    }
  }

  // ─── Управление очередью ──────────────────────────────

  async function startQueue() {
    if (state.isRunning) return;

    state.isRunning = true;
    state.isPaused = false;

    notifyPanel({ type: 'STATUS_UPDATE', status: 'running', total: state.queue.length, current: 0 });

    setupResultObserver((assets, newCount) => {
      notifyPanel({ type: 'NEW_ASSETS', count: newCount });
    });

    for (let i = state.currentIndex; i < state.queue.length; i++) {
      if (!state.isRunning) break;

      while (state.isPaused) {
        await sleep(1000);
        if (!state.isRunning) break;
      }
      if (!state.isRunning) break;

      state.currentIndex = i;
      notifyPanel({
        type: 'STATUS_UPDATE',
        status: 'running',
        total: state.queue.length,
        current: i + 1,
        currentPrompt: state.queue[i].prompt.substring(0, 80)
      });

      const result = await processOnePrompt(state.queue[i]);
      state.results.push(result);

      notifyPanel({ type: 'PROMPT_COMPLETE', index: i, result });

      if (i < state.queue.length - 1) {
        await sleep(state.settings.delayBetweenPrompts);
      }
    }

    state.isRunning = false;
    notifyPanel({ type: 'STATUS_UPDATE', status: 'completed', total: state.queue.length, current: state.queue.length });
    console.log('[FlowBatch] Очередь завершена!');
  }

  function stopQueue() {
    state.isRunning = false;
    state.isPaused = false;
    if (resultObserver) resultObserver.disconnect();
    notifyPanel({ type: 'STATUS_UPDATE', status: 'stopped' });
  }

  function pauseQueue() {
    state.isPaused = true;
    notifyPanel({ type: 'STATUS_UPDATE', status: 'paused' });
  }

  function resumeQueue() {
    state.isPaused = false;
    notifyPanel({ type: 'STATUS_UPDATE', status: 'running' });
  }

  // ─── Коммуникация ─────────────────────────────────────

  function notifyPanel(message) {
    chrome.runtime.sendMessage({ ...message, source: 'content' }).catch(() => {});
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'PING':
        sendResponse({ status: 'alive', isRunning: state.isRunning, isPaused: state.isPaused });
        break;

      case 'SET_QUEUE':
        state.queue = message.queue || [];
        state.currentIndex = 0;
        state.results = [];
        sendResponse({ success: true, count: state.queue.length });
        break;

      case 'SET_SETTINGS':
        Object.assign(state.settings, message.settings);
        sendResponse({ success: true });
        break;

      case 'START':
        startQueue();
        sendResponse({ success: true });
        break;

      case 'STOP':
        stopQueue();
        sendResponse({ success: true });
        break;

      case 'PAUSE':
        pauseQueue();
        sendResponse({ success: true });
        break;

      case 'RESUME':
        resumeQueue();
        sendResponse({ success: true });
        break;

      case 'GET_STATE':
        sendResponse({
          isRunning: state.isRunning,
          isPaused: state.isPaused,
          total: state.queue.length,
          current: state.currentIndex,
          results: state.results,
          settings: state.settings
        });
        break;

      case 'CHECK_SELECTORS':
        sendResponse({
          promptInput: !!FlowSelectors.getPromptInput(),
          generateButton: !!FlowSelectors.getGenerateButton(),
          modelSelector: !!FlowSelectors.getModelSelector(),
          loadingIndicator: !!FlowSelectors.getLoadingIndicator(),
          isGenerating: FlowSelectors.isGenerating()
        });
        break;

      case 'DISCOVER_DOM':
        // Полная диагностика DOM с discovery mode
        const basicCheck = {
          promptInput: !!FlowSelectors.getPromptInput(),
          generateButton: !!FlowSelectors.getGenerateButton(),
          modelSelector: !!FlowSelectors.getModelSelector(),
          loadingIndicator: !!FlowSelectors.getLoadingIndicator(),
          isGenerating: FlowSelectors.isGenerating()
        };
        const discovery = discoverDOM();
        sendResponse({ ...basicCheck, discovery });
        break;

      default:
        sendResponse({ error: 'Неизвестный тип сообщения' });
    }
    return true;
  });

  // ─── Инициализация ────────────────────────────────────

  console.log('[FlowBatch] Content script загружен:', window.location.href);

  // Инъектируем перехватчик
  injectInterceptor();

  // Восстанавливаем настройки
  chrome.storage.local.get(['flowbatch_settings'], (data) => {
    if (data.flowbatch_settings) {
      Object.assign(state.settings, data.flowbatch_settings);
      console.log('[FlowBatch] Настройки восстановлены');
    }
  });

})();
