/**
 * FlowBatch — Очередь v0.11
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
      if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') return btn;
      await FB.sleep(500);
    }
    throw new Error('Кнопка Create заблокирована');
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

        // 1. Закрыть модалки
        await FB.autoDismissModals();

        // 2. Найти поле ввода
        const input = await FB.waitForElement(() => FlowSelectors.getPromptInput(), 15000);

        // 3. Ввести текст
        await FB.setPromptText(input, prompt);
        await FB.sleep(2000);

        // 4. Проверить текст
        const actualText = FB.getCleanText(input);
        if (!actualText.includes(prompt.substring(0, 15))) {
          console.warn('[FlowBatch] ⚠ Текст НЕ введён!');
        }

        // 5. Ждём кнопку Create
        const createBtn = await waitForCreateReady(10000);

        // 6. Кликаем Create (React + нативный)
        console.log('[FlowBatch] Кликаем Create...');
        let createResult = null;
        try {
          createResult = await FB.clickCreate();
        } catch (e) {
          console.warn('[FlowBatch] React click ошибка:', e.message);
        }

        if (!createResult?.success) {
          console.log('[FlowBatch] Fallback: стандартный клик');
          await FB.clickElement(createBtn);
        }

        FB.notifyPanel({ type: 'LOG', text: 'Create нажата', level: 'info' });

        // 7. Проверка ошибки
        await FB.sleep(3000);
        const postError = FlowSelectors.getPageError();
        if (postError) throw new Error(`Ошибка после Create: "${postError}"`);

        // 8. Ожидание генерации
        console.log('[FlowBatch] Ожидание генерации...');
        const genTimeout = settings.mode.includes('video') ? 300000 : 120000;
        await FB.waitForGenerationComplete(genTimeout);

        console.log(`[FlowBatch] ✅ Генерация завершена: "${short}..."`);
        FB.notifyPanel({ type: 'LOG', text: `✅ Генерация: "${short}..."`, level: 'success' });

        // 9. Скачивание
        if (settings.autoDownload) {
          await FB.sleep(2000);
          await FB.triggerDownload(settings.downloadResolution);
        }

        return { success: true, prompt };
      } catch (error) {
        retries++;
        console.error(`[FlowBatch] Ошибка (попытка ${retries}):`, error.message);
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
    console.log('[FlowBatch] Очередь запущена, промптов:', FB.state.queue.length);
    FB.notifyPanel({ type: 'STATUS_UPDATE', status: 'running', total: FB.state.queue.length, current: 0 });

    await FB.autoDismissModals();
    await FB.setupFormat();
    await FB.sleep(500);
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
    console.log('[FlowBatch] Очередь завершена!');
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
