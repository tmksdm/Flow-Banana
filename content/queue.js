/**
 * FlowBatch — Управление очередью промптов v0.10
 * 
 * ИЗМЕНЕНИЯ v0.10:
 * - Клик Create: двойная стратегия (page context React onClick + стандартный клик)
 * - Улучшено ожидание после Create: проверка сети
 * - Увеличены задержки для стабильности
 */
(() => {
  'use strict';
  const FB = window.FB;
  if (!FB) return;

  let resultObserver = null;
  let lastKnownAssetCount = 0;

  function setupResultObserver(callback) {
    if (resultObserver) resultObserver.disconnect();
    resultObserver = new MutationObserver(() => {
      const assets = FlowSelectors.getGeneratedAssets();
      const current = assets.images.length + assets.videos.length;
      if (current > lastKnownAssetCount) {
        const diff = current - lastKnownAssetCount;
        lastKnownAssetCount = current;
        console.log(`[FlowBatch] +${diff} новых ассетов (всего ${current})`);
        callback(assets, diff);
      }
    });
    resultObserver.observe(document.body, {
      childList: true, subtree: true,
      attributes: true, attributeFilter: ['src', 'style', 'class']
    });
  }

  async function waitForCreateReady(maxWait = 15000) {
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      const err = FlowSelectors.getPageError();
      if (err) throw new Error(`Ошибка Flow: "${err}"`);

      const btn = FlowSelectors.getGenerateButton();
      if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
        return btn;
      }
      await FB.sleep(500);
    }
    throw new Error('Кнопка Create заблокирована после ' + (maxWait / 1000) + 'с ожидания');
  }

  async function processOnePrompt(promptData) {
    const { prompt } = promptData;
    const { settings } = FB.state;
    let retries = 0;

    while (retries <= settings.maxRetries) {
      try {
        const short = prompt.substring(0, 50);
        console.log(`[FlowBatch] Промпт: "${short}..." (попытка ${retries + 1})`);
        FB.notifyPanel({ type: 'LOG', text: `Промпт: "${short}..." (попытка ${retries + 1})`, level: 'info' });

        // 1) Закрыть модалки
        console.log('[FlowBatch] [queue] Шаг 1: autoDismissModals...');
        await FB.autoDismissModals();

        // 2) Проверка ошибок
        const prevError = FlowSelectors.getPageError();
        if (prevError) {
          console.log('[FlowBatch] [queue] Ошибка от предыдущей попытки:', prevError);
          await FB.sleep(5000);
        }

        // 3) Найти поле ввода
        console.log('[FlowBatch] [queue] Шаг 2: ищем поле промпта...');
        const input = await FB.waitForElement(() => FlowSelectors.getPromptInput(), 15000);
        console.log('[FlowBatch] [queue] Шаг 2: поле найдено:', input.tagName, input.getAttribute('role'));

        // 4) Ввести текст
        console.log('[FlowBatch] [queue] Шаг 3: вводим текст...');
        const inputResult = await FB.setPromptText(input, prompt);
        
        // Увеличена задержка для Slate model sync + React re-render
        await FB.sleep(2000);

        // 5) Проверяем текст
        const actualText = FB.getCleanText(input);
        const rawText = (input.textContent || '').trim();
        console.log(`[FlowBatch] [queue] Шаг 3b: cleanText = "${actualText.substring(0, 60)}"`);
        console.log(`[FlowBatch] [queue] Шаг 3b: rawText = "${rawText.substring(0, 60)}"`);
        
        if (!actualText && !rawText.includes(prompt.substring(0, 15))) {
          console.warn('[FlowBatch] [queue] ВНИМАНИЕ: текст НЕ введён!');
          FB.notifyPanel({ type: 'LOG', text: 'ВНИМАНИЕ: текст не введён — Slate не принял ввод', level: 'warning' });
        }

        // 6) Ждём готовность кнопки Create
        console.log('[FlowBatch] [queue] Шаг 4: ждём готовность Create...');
        const createBtn = await waitForCreateReady(10000);
        console.log('[FlowBatch] [queue] Шаг 4: кнопка Create готова');

        // 7) Нажать Create — ДВОЙНАЯ СТРАТЕГИЯ v0.10
        console.log('[FlowBatch] [queue] Шаг 5: нажимаем Create (двойная стратегия)...');
        
        // Стратегия A: Клик через page context (React onClick props)
        let createResult = null;
        try {
          createResult = await FB.clickCreate();
          console.log('[FlowBatch] [queue] Шаг 5a: React click результат:', 
            createResult?.success ? 'УСПЕХ' : 'НЕУДАЧА', 
            'метод:', createResult?.method);
        } catch (e) {
          console.warn('[FlowBatch] [queue] Шаг 5a: React click ошибка:', e.message);
        }
        
        // Стратегия B: Стандартный клик (подстраховка)
        if (!createResult?.success) {
          console.log('[FlowBatch] [queue] Шаг 5b: стандартный клик...');
          await FB.clickElement(createBtn);
        }
        
        console.log('[FlowBatch] [queue] Шаг 5: клик выполнен');
        FB.notifyPanel({ type: 'LOG', text: 'Нажата кнопка Create', level: 'info' });

        // 8) Проверка ошибки после клика
        await FB.sleep(3000);
        const postClickError = FlowSelectors.getPageError();
        if (postClickError) {
          throw new Error(`Ошибка после Create: "${postClickError}"`);
        }

        // 9) Проверка сети — начался ли запрос генерации?
        console.log('[FlowBatch] [queue] Шаг 5c: проверяем сеть...');
        try {
          const netState = await FB.getNetworkState();
          console.log('[FlowBatch] [queue] Сеть:', JSON.stringify({
            pending: netState?.pending,
            generationDetected: netState?.generationDetected,
            recentCount: netState?.recent?.length
          }));
          
          if (netState?.recent && netState.recent.length > 0) {
            for (const req of netState.recent.slice(-5)) {
              console.log(`[FlowBatch] [queue] Сеть: ${req.method || '?'} ${req.url} → ${req.status} (${req.age}мс назад)`);
            }
          }
        } catch (e) {
          console.warn('[FlowBatch] [queue] Ошибка проверки сети:', e.message);
        }

        // 10) Ждём завершения генерации
        console.log('[FlowBatch] [queue] Шаг 6: ожидание завершения генерации...');
        const genTimeout = settings.mode.includes('video') ? 300000 : 120000;
        const genResult = await FB.waitForGenerationComplete(genTimeout);

        console.log(`[FlowBatch] [queue] Генерация завершена: "${short}..."`);
        FB.notifyPanel({ type: 'LOG', text: `Генерация завершена: "${short}..."`, level: 'success' });

        // 11) Авто-скачивание
        if (settings.autoDownload) {
          console.log('[FlowBatch] [queue] Шаг 7: авто-скачивание...');
          await FB.sleep(2000);
          await FB.triggerDownload(settings.downloadResolution);
        }

        return { success: true, prompt };
      } catch (error) {
        retries++;
        console.error(`[FlowBatch] [queue] Ошибка (попытка ${retries}):`, error.message);
        FB.notifyPanel({ type: 'LOG', text: `Ошибка: ${error.message}`, level: 'error' });
        if (retries > settings.maxRetries) return { success: false, prompt, error: error.message };
        await FB.sleep(3000 * retries);
      }
    }
  }

  FB.startQueue = async () => {
    if (FB.state.isRunning) return;
    FB.state.isRunning = true;
    FB.state.isPaused = false;
    console.log('[FlowBatch] [queue] Очередь запущена, промптов:', FB.state.queue.length);
    FB.notifyPanel({ type: 'STATUS_UPDATE', status: 'running', total: FB.state.queue.length, current: 0 });

    await FB.autoDismissModals();
    
    // ФОРМАТ
    console.log('[FlowBatch] [queue] Настройка формата...');
    await FB.setupFormat();
    await FB.sleep(500);

    // ULTRA
    console.log('[FlowBatch] [queue] Настройка ULTRA...');
    await FB.setupUltra();

    const cur = FlowSelectors.getGeneratedAssets();
    lastKnownAssetCount = cur.images.length + cur.videos.length;
    setupResultObserver((_, n) => FB.notifyPanel({ type: 'NEW_ASSETS', count: n }));

    for (let i = FB.state.currentIndex; i < FB.state.queue.length; i++) {
      if (!FB.state.isRunning) break;
      while (FB.state.isPaused) {
        await FB.sleep(1000);
        if (!FB.state.isRunning) break;
      }
      if (!FB.state.isRunning) break;

      FB.state.currentIndex = i;
      FB.notifyPanel({
        type: 'STATUS_UPDATE', status: 'running',
        total: FB.state.queue.length, current: i + 1,
        currentPrompt: FB.state.queue[i].prompt.substring(0, 80)
      });

      const result = await processOnePrompt(FB.state.queue[i]);
      FB.state.results.push(result);
      FB.notifyPanel({ type: 'PROMPT_COMPLETE', index: i, result });

      if (i < FB.state.queue.length - 1) await FB.sleep(FB.state.settings.delayBetweenPrompts);
    }

    FB.state.isRunning = false;
    if (resultObserver) resultObserver.disconnect();
    FB.notifyPanel({ type: 'STATUS_UPDATE', status: 'completed', total: FB.state.queue.length, current: FB.state.queue.length });
    console.log('[FlowBatch] [queue] Очередь завершена!');
  };

  FB.stopQueue = () => {
    FB.state.isRunning = false;
    FB.state.isPaused = false;
    if (resultObserver) resultObserver.disconnect();
    FB.notifyPanel({ type: 'STATUS_UPDATE', status: 'stopped' });
  };

  FB.pauseQueue = () => {
    FB.state.isPaused = true;
    FB.notifyPanel({ type: 'STATUS_UPDATE', status: 'paused' });
  };

  FB.resumeQueue = () => {
    FB.state.isPaused = false;
    FB.notifyPanel({ type: 'STATUS_UPDATE', status: 'running' });
  };
})();
