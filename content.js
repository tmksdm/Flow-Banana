/**
 * FlowBatch — Content Script
 * Инъектируется в страницу Google Flow.
 * Управляет UI-автоматизацией, MutationObserver, и взаимодействием с popup/background.
 */

(() => {
  'use strict';

  // ─── Состояние ─────────────────────────────────────────
  const state = {
    isRunning: false,
    isPaused: false,
    queue: [],           // [{prompt, type, images?, settings?}]
    currentIndex: 0,
    results: [],         // [{prompt, urls: [], status}]
    settings: {
      mode: 'text-to-image',        // text-to-image | text-to-video | image-to-video
      model: 'Nano Banana Pro',
      aspectRatio: '16:9',
      outputCount: 2,
      downloadResolution: '4K',      // 1K | 2K | 4K
      autoDownload: true,
      delayBetweenPrompts: 5000,     // мс
      maxRetries: 3,
      concurrentPrompts: 1
    }
  };

  // ─── Утилиты ──────────────────────────────────────────
  
  /**
   * Ожидание с промисом
   */
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Ожидание появления элемента в DOM
   */
  function waitForElement(selectorFn, timeout = 30000, interval = 500) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      const check = () => {
        const el = typeof selectorFn === 'function' ? selectorFn() : document.querySelector(selectorFn);
        if (el) {
          resolve(el);
          return;
        }
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
   * Ожидание завершения генерации (исчезновения прогресс-бара)
   */
  function waitForGenerationComplete(timeout = 300000) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let wasGenerating = false;

      const check = () => {
        const isGenerating = FlowSelectors.isGenerating();

        if (isGenerating) {
          wasGenerating = true;
        }

        // Генерация началась и завершилась
        if (wasGenerating && !isGenerating) {
          // Даём немного времени DOM обновиться
          setTimeout(() => resolve(true), 2000);
          return;
        }

        if (Date.now() - startTime > timeout) {
          reject(new Error(`Генерация не завершилась за ${timeout / 1000}с`));
          return;
        }

        setTimeout(check, 1000);
      };

      // Небольшая задержка перед первой проверкой
      setTimeout(check, 2000);
    });
  }

  /**
   * Эмуляция ввода текста в contenteditable или textarea
   */
  function setPromptText(element, text) {
    if (!element) throw new Error('Элемент промпта не найден');

    // Очистка текущего содержимого
    element.focus();

    if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
      // Для стандартных полей
      element.value = '';
      element.value = text;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      // Для contenteditable
      // Выделяем всё и удаляем
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);

      // Вставляем текст
      document.execCommand('insertText', false, text);

      // Также диспатчим события
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: text
      }));
    }
  }

  /**
   * Эмуляция клика с задержкой
   */
  async function clickElement(element, delay = 300) {
    if (!element) throw new Error('Элемент для клика не найден');

    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(100);

    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    await sleep(delay);
  }

  // ─── MutationObserver: отслеживание новых результатов ───

  let resultObserver = null;
  let lastKnownAssetCount = 0;

  function setupResultObserver(callback) {
    if (resultObserver) {
      resultObserver.disconnect();
    }

    resultObserver = new MutationObserver((mutations) => {
      const assets = FlowSelectors.getGeneratedAssets();
      const currentCount = assets.images.length + assets.videos.length;

      if (currentCount > lastKnownAssetCount) {
        const newCount = currentCount - lastKnownAssetCount;
        lastKnownAssetCount = currentCount;
        console.log(`[FlowBatch] Обнаружено ${newCount} новых ассетов`);
        callback(assets, newCount);
      }
    });

    // Наблюдаем за всем body (Google Flow — SPA, элементы могут появляться где угодно)
    resultObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'style', 'class']
    });
  }

  // ─── Ядро: обработка одного промпта ──────────────────

  async function processOnePrompt(promptData) {
    const { prompt, type, images } = promptData;
    const { settings } = state;
    let retries = 0;

    while (retries <= settings.maxRetries) {
      try {
        console.log(`[FlowBatch] Обработка промпта: "${prompt.substring(0, 50)}..." (попытка ${retries + 1})`);

        // 1. Найти поле ввода
        const input = await waitForElement(() => FlowSelectors.getPromptInput(), 15000);

        // 2. Ввести промпт
        setPromptText(input, prompt);
        await sleep(500);

        // 3. Нажать Generate
        const generateBtn = await waitForElement(() => FlowSelectors.getGenerateButton(), 10000);
        await clickElement(generateBtn);

        // 4. Ожидание завершения генерации
        await waitForGenerationComplete(settings.mode.includes('video') ? 300000 : 120000);

        console.log(`[FlowBatch] Генерация завершена для: "${prompt.substring(0, 50)}..."`);

        // 5. Автоскачивание (если включено)
        if (settings.autoDownload) {
          await sleep(2000); // Ждём полную отрисовку
          await triggerDownload(settings.downloadResolution);
        }

        // Успех — выходим из цикла retry
        return { success: true, prompt };

      } catch (error) {
        retries++;
        console.error(`[FlowBatch] Ошибка (попытка ${retries}): ${error.message}`);
        
        if (retries > settings.maxRetries) {
          return { success: false, prompt, error: error.message };
        }

        // Ждём перед повторной попыткой
        await sleep(5000 * retries);
      }
    }
  }

  // ─── Скачивание с выбором разрешения ──────────────────

  async function triggerDownload(resolution = '4K') {
    try {
      // 1. Находим последний сгенерированный ассет
      const assets = FlowSelectors.getGeneratedAssets();
      const allAssets = [...assets.images, ...assets.videos];

      if (allAssets.length === 0) {
        console.warn('[FlowBatch] Нет ассетов для скачивания');
        return;
      }

      const lastAsset = allAssets[allAssets.length - 1];

      // 2. Открываем меню "More"
      const moreBtn = FlowSelectors.getDownloadButton(lastAsset);
      if (moreBtn) {
        await clickElement(moreBtn);
        await sleep(500);

        // 3. Кликаем "Download"
        const downloadOption = await waitForElement(() => FlowSelectors.getDownloadMenuOption(), 5000);
        await clickElement(downloadOption);
        await sleep(500);

        // 4. Выбираем разрешение
        const resOption = await waitForElement(() => FlowSelectors.getResolutionOption(resolution), 5000);
        if (resOption) {
          await clickElement(resOption);
          console.log(`[FlowBatch] Скачивание запущено: ${resolution}`);
        }
      } else {
        console.warn('[FlowBatch] Кнопка скачивания не найдена');
      }
    } catch (error) {
      console.error(`[FlowBatch] Ошибка скачивания: ${error.message}`);
    }
  }

  // ─── Управление очередью ──────────────────────────────

  async function startQueue() {
    if (state.isRunning) {
      console.warn('[FlowBatch] Очередь уже запущена');
      return;
    }

    state.isRunning = true;
    state.isPaused = false;
    
    notifyPopup({ type: 'STATUS_UPDATE', status: 'running', total: state.queue.length, current: 0 });

    // Настроим наблюдатель за результатами
    setupResultObserver((assets, newCount) => {
      notifyPopup({ type: 'NEW_ASSETS', count: newCount });
    });

    for (let i = state.currentIndex; i < state.queue.length; i++) {
      if (!state.isRunning) break;
      
      // Поддержка паузы
      while (state.isPaused) {
        await sleep(1000);
        if (!state.isRunning) break;
      }
      if (!state.isRunning) break;

      state.currentIndex = i;
      notifyPopup({ 
        type: 'STATUS_UPDATE', 
        status: 'running', 
        total: state.queue.length, 
        current: i + 1,
        currentPrompt: state.queue[i].prompt.substring(0, 80)
      });

      const result = await processOnePrompt(state.queue[i]);
      state.results.push(result);

      notifyPopup({ type: 'PROMPT_COMPLETE', index: i, result });

      // Задержка между промптами
      if (i < state.queue.length - 1) {
        console.log(`[FlowBatch] Задержка ${state.settings.delayBetweenPrompts}мс перед следующим промптом...`);
        await sleep(state.settings.delayBetweenPrompts);
      }
    }

    state.isRunning = false;
    notifyPopup({ type: 'STATUS_UPDATE', status: 'completed', total: state.queue.length, current: state.queue.length });
    console.log('[FlowBatch] Очередь завершена!');
  }

  function stopQueue() {
    state.isRunning = false;
    state.isPaused = false;
    if (resultObserver) resultObserver.disconnect();
    notifyPopup({ type: 'STATUS_UPDATE', status: 'stopped' });
  }

  function pauseQueue() {
    state.isPaused = true;
    notifyPopup({ type: 'STATUS_UPDATE', status: 'paused' });
  }

  function resumeQueue() {
    state.isPaused = false;
    notifyPopup({ type: 'STATUS_UPDATE', status: 'running' });
  }

  // ─── Коммуникация с popup и background ────────────────

  function notifyPopup(message) {
    chrome.runtime.sendMessage({ ...message, source: 'content' }).catch(() => {
      // popup может быть закрыт — это нормально
    });
  }

  /**
   * Обработка сообщений от popup / background
   */
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
        // Диагностика: проверяем какие элементы найдены
        sendResponse({
          promptInput: !!FlowSelectors.getPromptInput(),
          generateButton: !!FlowSelectors.getGenerateButton(),
          modelSelector: !!FlowSelectors.getModelSelector(),
          loadingIndicator: !!FlowSelectors.getLoadingIndicator(),
          isGenerating: FlowSelectors.isGenerating()
        });
        break;

      default:
        sendResponse({ error: 'Неизвестный тип сообщения' });
    }
    return true; // async sendResponse
  });

  // ─── Инициализация ────────────────────────────────────

  console.log('[FlowBatch] Content script загружен на:', window.location.href);

  // Восстанавливаем настройки из хранилища
  chrome.storage.local.get(['flowbatch_settings'], (data) => {
    if (data.flowbatch_settings) {
      Object.assign(state.settings, data.flowbatch_settings);
      console.log('[FlowBatch] Настройки восстановлены');
    }
  });

})();
