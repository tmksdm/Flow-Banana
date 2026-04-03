/**
 * FlowBatch — Content Script v0.3
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
      maxRetries: 3,
      useUltra: true
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
   * Ожидание появления элемента (поддержка функции-селектора или CSS-строки)
   */
  function waitForElement(selectorFn, timeout = 30000, interval = 500) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const check = () => {
        const el = typeof selectorFn === 'function' ? selectorFn() : FlowSelectors.deepQuery(selectorFn);
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
   * Ожидание завершения генерации.
   * Стратегия:
   *  1. Сначала ждём, пока генерация НАЧНЁТСЯ (кнопка Create станет disabled / появится индикатор)
   *  2. Затем ждём, пока генерация ЗАВЕРШИТСЯ
   *  3. Дополнительный буфер 2с для рендера результатов
   */
  function waitForGenerationComplete(timeout = 300000) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let wasGenerating = false;
      let stableCount = 0;
      const STABLE_THRESHOLD = 3; // Считаем завершённой после 3 проверок подряд

      const check = () => {
        const isGenerating = FlowSelectors.isGenerating();

        if (isGenerating) {
          wasGenerating = true;
          stableCount = 0;
        }

        if (wasGenerating && !isGenerating) {
          stableCount++;
          if (stableCount >= STABLE_THRESHOLD) {
            // Буфер для рендера результатов
            setTimeout(() => resolve(true), 2000);
            return;
          }
        }

        if (Date.now() - startTime > timeout) {
          reject(new Error(`Генерация не завершилась за ${timeout / 1000}с`));
          return;
        }

        setTimeout(check, 1000);
      };

      // Начинаем проверки через 2с — даём время на начало генерации
      setTimeout(check, 2000);
    });
  }

  /**
   * Эмуляция ввода текста
   */
  function setPromptText(element, text) {
    if (!element) throw new Error('Элемент промпта не найден');

    element.focus();
    element.dispatchEvent(new FocusEvent('focus', { bubbles: true }));

    if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
      // Native input
      const nativeSetter = Object.getOwnPropertyDescriptor(
        element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        'value'
      )?.set;
      if (nativeSetter) {
        nativeSetter.call(element, text);
      } else {
        element.value = text;
      }
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      // contenteditable
      // Очищаем
      element.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);

      // Вводим текст через execCommand (работает с Angular/React binding)
      document.execCommand('insertText', false, text);

      // Дополнительные события для фреймворков
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true, cancelable: true, inputType: 'insertText', data: text
      }));
    }
  }

  /**
   * Эмуляция клика с полной цепочкой событий
   */
  async function clickElement(element, delay = 300) {
    if (!element) throw new Error('Элемент для клика не найден');

    // Скроллим в видимую область
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(150);

    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    const eventOpts = {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 0
    };

    element.dispatchEvent(new PointerEvent('pointerdown', eventOpts));
    element.dispatchEvent(new MouseEvent('mousedown', eventOpts));
    await sleep(50);
    element.dispatchEvent(new PointerEvent('pointerup', eventOpts));
    element.dispatchEvent(new MouseEvent('mouseup', eventOpts));
    element.dispatchEvent(new MouseEvent('click', eventOpts));

    await sleep(delay);
  }

  // ─── Авто-закрытие модальных окон ─────────────────────

  /**
   * Проверяет и закрывает модальные окна ("OK, got it" и т.д.)
   * Возвращает количество закрытых модалок
   */
  async function autoDismissModals(maxAttempts = 3) {
    let dismissed = 0;
    for (let i = 0; i < maxAttempts; i++) {
      if (FlowSelectors.dismissModals()) {
        dismissed++;
        await sleep(500);
      } else {
        break;
      }
    }
    if (dismissed > 0) {
      console.log(`[FlowBatch] Закрыто модальных окон: ${dismissed}`);
      notifyPanel({ type: 'LOG', text: `Закрыто модальных окон: ${dismissed}`, level: 'info' });
    }
    return dismissed;
  }

  // ─── Предварительная настройка параметров ──────────────

  /**
   * Настраивает формат генерации: кликает по комбо-кнопке формата
   * и выбирает нужный тип/aspect/count.
   *
   * Пока реализована как клик по комбо-кнопке, которая (предположительно)
   * открывает меню/панель настроек. Дальнейшая калибровка потребуется
   * после данных о структуре этого меню.
   */
  async function setupFormat() {
    const formatBtn = FlowSelectors.getFormatButton();
    if (!formatBtn) {
      console.warn('[FlowBatch] Комбо-кнопка формата не найдена');
      return false;
    }

    const current = FlowSelectors.getCurrentFormat();
    if (current) {
      const targetType = state.settings.mode.includes('video') ? 'Video' : 'Image';
      const targetAspect = state.settings.aspectRatio;
      const targetCount = state.settings.outputCount;

      // Проверяем, нужно ли менять настройки
      if (
        current.type?.toLowerCase() === targetType.toLowerCase() &&
        current.aspect === targetAspect &&
        current.count === targetCount
      ) {
        console.log('[FlowBatch] Формат уже соответствует настройкам');
        return true;
      }
    }

    // Кликаем по комбо-кнопке, чтобы открыть панель настроек
    await clickElement(formatBtn);
    await sleep(800);

    // TODO: после открытия меню — выбрать нужный тип, aspect ratio, count
    // Это потребует дополнительных данных о DOM внутри меню настроек
    console.log('[FlowBatch] Комбо-кнопка формата нажата. Дальнейшая настройка требует калибровки.');
    notifyPanel({ type: 'LOG', text: 'Открыта панель формата (нужна калибровка)', level: 'warning' });

    return true;
  }

  /**
   * Включение/выключение ULTRA-режима
   */
  async function setupUltra() {
    if (!state.settings.useUltra) return;

    const ultraBtn = FlowSelectors.getUltraButton();
    if (!ultraBtn) {
      console.warn('[FlowBatch] Кнопка ULTRA не найдена');
      return false;
    }

    const isActive = FlowSelectors.isUltraActive();
    if (state.settings.useUltra && !isActive) {
      await clickElement(ultraBtn);
      console.log('[FlowBatch] ULTRA-режим активирован');
      notifyPanel({ type: 'LOG', text: 'ULTRA-режим активирован', level: 'success' });
    } else if (!state.settings.useUltra && isActive) {
      await clickElement(ultraBtn);
      console.log('[FlowBatch] ULTRA-режим деактивирован');
      notifyPanel({ type: 'LOG', text: 'ULTRA-режим деактивирован', level: 'info' });
    }

    return true;
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

        // 0. Закрываем модальные окна
        await autoDismissModals();

        // 1. Найти поле ввода
        const input = await waitForElement(() => FlowSelectors.getPromptInput(), 15000);

        // 2. Ввести промпт
        setPromptText(input, prompt);
        await sleep(500);

        // 3. Нажать Create
        const generateBtn = await waitForElement(() => FlowSelectors.getGenerateButton(), 10000);

        // Убеждаемся, что кнопка не задизейблена
        if (generateBtn.disabled || generateBtn.getAttribute('aria-disabled') === 'true') {
          console.warn('[FlowBatch] Кнопка Create заблокирована, ждём...');
          await sleep(3000);
        }

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

        // Экспоненциальный backoff
        await sleep(3000 * retries);
      }
    }
  }

  // ─── Скачивание ───────────────────────────────────────

  async function triggerDownload(resolution = '4K') {
    try {
      const assets = FlowSelectors.getGeneratedAssets();
      const allAssets = [...assets.images, ...assets.videos];

      if (allAssets.length === 0) {
        // Пробуем получить URL из перехваченных fetch
        const recentUrls = state.interceptedUrls.filter(u =>
          Date.now() - u.timestamp < 60000
        );
        if (recentUrls.length > 0) {
          const lastUrl = recentUrls[recentUrls.length - 1].url;
          console.log('[FlowBatch] Скачивание через перехваченный URL:', lastUrl.substring(0, 80));
          chrome.runtime.sendMessage({
            type: 'DOWNLOAD_FILE',
            url: lastUrl,
            filename: `flowbatch_${Date.now()}.png`
          });
          notifyPanel({ type: 'LOG', text: 'Скачивание через перехваченный URL', level: 'info' });
          return;
        }

        console.warn('[FlowBatch] Нет ассетов для скачивания');
        notifyPanel({ type: 'LOG', text: 'Нет ассетов для скачивания', level: 'warning' });
        return;
      }

      // Скачиваем последние ассеты (количество = outputCount)
      const count = Math.min(state.settings.outputCount, allAssets.length);
      const toDownload = allAssets.slice(-count);

      for (const asset of toDownload) {
        const moreBtn = FlowSelectors.getMoreOptionsButton(asset);
        if (moreBtn) {
          await clickElement(moreBtn);
          await sleep(600);

          try {
            const downloadOption = await waitForElement(() => FlowSelectors.getDownloadMenuOption(), 5000);
            await clickElement(downloadOption);
            await sleep(600);

            // Пробуем выбрать разрешение
            try {
              const resOption = await waitForElement(() => FlowSelectors.getResolutionOption(resolution), 3000);
              if (resOption) {
                await clickElement(resOption);
                console.log(`[FlowBatch] Скачивание: ${resolution}`);
                notifyPanel({ type: 'LOG', text: `Скачивание запущено (${resolution})`, level: 'success' });
              }
            } catch (e) {
              // Разрешение не предлагается — скачивание запускается автоматически
              console.log('[FlowBatch] Скачивание запущено (без выбора разрешения)');
              notifyPanel({ type: 'LOG', text: 'Скачивание запущено', level: 'success' });
            }
          } catch (e) {
            console.warn('[FlowBatch] Опция Download не найдена в меню');
            notifyPanel({ type: 'LOG', text: 'Опция Download не найдена в меню', level: 'warning' });
          }

          await sleep(500);
        } else {
          // Fallback: пробуем скачать по src
          const src = asset.src || asset.querySelector?.('source')?.src;
          if (src && (src.startsWith('http') || src.startsWith('blob:'))) {
            const ext = asset.tagName === 'VIDEO' ? 'mp4' : 'png';
            chrome.runtime.sendMessage({
              type: 'DOWNLOAD_FILE',
              url: src,
              filename: `flowbatch_${Date.now()}.${ext}`
            });
            console.log('[FlowBatch] Скачивание по src:', src.substring(0, 80));
            notifyPanel({ type: 'LOG', text: 'Скачивание по прямому URL', level: 'info' });
          } else {
            console.warn('[FlowBatch] Кнопка More и src не найдены для ассета');
            notifyPanel({ type: 'LOG', text: 'Невозможно скачать ассет', level: 'warning' });
          }
        }
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

    // Закрываем модалки перед стартом
    await autoDismissModals();

    // Настраиваем формат (пока — попытка)
    // await setupFormat();

    // Включаем ULTRA (если нужно)
    await setupUltra();

    // Запоминаем текущее количество ассетов
    const currentAssets = FlowSelectors.getGeneratedAssets();
    lastKnownAssetCount = currentAssets.images.length + currentAssets.videos.length;

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
    if (resultObserver) resultObserver.disconnect();
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
        sendResponse({
          status: 'alive',
          isRunning: state.isRunning,
          isPaused: state.isPaused,
          version: '0.3'
        });
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
          ultraButton: !!FlowSelectors.getUltraButton(),
          ultraActive: FlowSelectors.isUltraActive(),
          formatButton: !!FlowSelectors.getFormatButton(),
          currentFormat: FlowSelectors.getCurrentFormat(),
          addMediaButton: !!FlowSelectors.getAddMediaButton(),
          loadingIndicator: !!FlowSelectors.getLoadingIndicator(),
          isGenerating: FlowSelectors.isGenerating(),
          hasModal: FlowSelectors.hasModal()
        });
        break;

      case 'DISCOVER_DOM':
        // Полная диагностика
        const basicCheck = {
          promptInput: !!FlowSelectors.getPromptInput(),
          generateButton: !!FlowSelectors.getGenerateButton(),
          ultraButton: !!FlowSelectors.getUltraButton(),
          ultraActive: FlowSelectors.isUltraActive(),
          formatButton: !!FlowSelectors.getFormatButton(),
          currentFormat: FlowSelectors.getCurrentFormat(),
          addMediaButton: !!FlowSelectors.getAddMediaButton(),
          loadingIndicator: !!FlowSelectors.getLoadingIndicator(),
          isGenerating: FlowSelectors.isGenerating(),
          hasModal: FlowSelectors.hasModal()
        };
        const discovery = FlowSelectors.discoverDOM();
        sendResponse({ ...basicCheck, discovery });
        break;

      case 'DISMISS_MODALS':
        autoDismissModals().then(count => sendResponse({ dismissed: count }));
        return true;

      default:
        sendResponse({ error: 'Неизвестный тип сообщения' });
    }
    return true;
  });

  // ─── Инициализация ────────────────────────────────────

  console.log('[FlowBatch] Content script v0.3 загружен:', window.location.href);

  // Инъектируем перехватчик
  injectInterceptor();

  // Восстанавливаем настройки
  chrome.storage.local.get(['flowbatch_settings'], (data) => {
    if (data.flowbatch_settings) {
      Object.assign(state.settings, data.flowbatch_settings);
      console.log('[FlowBatch] Настройки восстановлены');
    }
  });

  // Авто-закрытие модалок при загрузке страницы (через 3с)
  setTimeout(() => autoDismissModals(), 3000);

})();
