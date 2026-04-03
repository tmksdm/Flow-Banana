/**
 * FlowBatch — Управление очередью промптов v0.5
 * Добавлены подробные логи для отладки
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
        console.log(`[FlowBatch] +${diff} новых ассетов`);
        callback(assets, diff);
      }
    });
    resultObserver.observe(document.body, {
      childList: true, subtree: true,
      attributes: true, attributeFilter: ['src', 'style', 'class']
    });
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

        // 2) Найти поле ввода
        console.log('[FlowBatch] [queue] Шаг 2: ищем поле промпта...');
        const input = await FB.waitForElement(() => FlowSelectors.getPromptInput(), 15000);
        console.log('[FlowBatch] [queue] Шаг 2: поле найдено:', input.tagName, input.getAttribute('role'));

        // 3) Ввести текст
        console.log('[FlowBatch] [queue] Шаг 3: вводим текст...');
        await FB.setPromptText(input, prompt);
        await FB.sleep(800); // ← увеличен с 500 до 800 для Angular

        // 4) Проверяем, что текст появился
        const actualText = input.textContent || input.innerText || input.value || '';
        console.log(`[FlowBatch] [queue] Шаг 3b: текст в поле = "${actualText.substring(0, 50)}"`);
        if (actualText.trim().length === 0) {
          console.warn('[FlowBatch] [queue] ВНИМАНИЕ: текст не появился в поле!');
          FB.notifyPanel({ type: 'LOG', text: 'ВНИМАНИЕ: текст не появился в поле ввода', level: 'warning' });
        }

        // 5) Найти кнопку Create
        console.log('[FlowBatch] [queue] Шаг 4: ищем кнопку Create...');
        const createBtn = await FB.waitForElement(() => FlowSelectors.getGenerateButton(), 10000);
        console.log('[FlowBatch] [queue] Шаг 4: кнопка найдена, disabled =', createBtn.disabled, 
          ', aria-disabled =', createBtn.getAttribute('aria-disabled'));

        // 6) Если кнопка заблокирована — ждём
        if (createBtn.disabled || createBtn.getAttribute('aria-disabled') === 'true') {
          console.warn('[FlowBatch] [queue] Кнопка Create заблокирована! Ждём 5с...');
          FB.notifyPanel({ type: 'LOG', text: 'Кнопка Create заблокирована, ждём...', level: 'warning' });
          await FB.sleep(5000);
          
          // Повторная проверка
          const createBtn2 = FlowSelectors.getGenerateButton();
          if (createBtn2 && (createBtn2.disabled || createBtn2.getAttribute('aria-disabled') === 'true')) {
            console.error('[FlowBatch] [queue] Кнопка всё ещё заблокирована после ожидания');
            FB.notifyPanel({ type: 'LOG', text: 'Create всё ещё заблокирована — возможно текст не распознан Flow', level: 'error' });
            throw new Error('Кнопка Create заблокирована — Flow не видит введённый текст');
          }
        }

        // 7) Нажать Create
        console.log('[FlowBatch] [queue] Шаг 5: нажимаем Create...');
        await FB.clickElement(createBtn);
        console.log('[FlowBatch] [queue] Шаг 5: клик выполнен');
        FB.notifyPanel({ type: 'LOG', text: 'Нажата кнопка Create', level: 'info' });

        // 8) Ждём завершения генерации
        console.log('[FlowBatch] [queue] Шаг 6: ожидание завершения генерации...');
        const genTimeout = settings.mode.includes('video') ? 300000 : 120000;
        await FB.waitForGenerationComplete(genTimeout);

        console.log(`[FlowBatch] [queue] Генерация завершена: "${short}..."`);
        FB.notifyPanel({ type: 'LOG', text: `Генерация завершена: "${short}..."`, level: 'success' });

        // 9) Авто-скачивание
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
