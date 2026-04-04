/**
 * FlowBatch — Генерация v0.11
 * 
 * Фиксы v0.11:
 * - waitForGenerationComplete: НЕ завершает рано пока нет ответа сервера
 * - После ответа ждёт появления ассетов до 20с
 */
(() => {
  'use strict';
  const FB = window.FB;
  if (!FB) return;

  FB.clickCreate = async () => {
    console.log('[FlowBatch] clickCreate v0.11...');
    const result = await FB.requestPageContext('flowbatch-click-request', { selector: 'CREATE_BUTTON' }, 10000);
    console.log('[FlowBatch] clickCreate результат:', JSON.stringify(result));
    return result;
  };

  FB.getNetworkState = async () => {
    return FB.requestPageContext('flowbatch-network-state-request', {}, 5000);
  };

  FB.waitForGenerationComplete = (timeout = 300000) => {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      let generationStarted = false;
      let generationResponseReceived = false;
      let responseReceivedAt = 0;
      let lastLogTime = 0;
      const START_GRACE_PERIOD = 45000;

      const initialAssets = FlowSelectors.getGeneratedAssets();
      const initialCount = initialAssets.images.length + initialAssets.videos.length;

      const onGenStarted = () => {
        generationStarted = true;
        console.log('[FlowBatch] waitForGen: 🚀 генерация стартовала!');
      };
      const onGenResponse = () => {
        generationResponseReceived = true;
        responseReceivedAt = Date.now();
        console.log('[FlowBatch] waitForGen: ✅ ответ сервера получен!');
      };

      window.addEventListener('flowbatch-generation-started', onGenStarted);
      window.addEventListener('flowbatch-generation-response', onGenResponse);

      const cleanup = () => {
        window.removeEventListener('flowbatch-generation-started', onGenStarted);
        window.removeEventListener('flowbatch-generation-response', onGenResponse);
      };

      const check = async () => {
        const elapsed = Date.now() - start;

        // Ошибка
        const errorMsg = FlowSelectors.getPageError();
        if (errorMsg) { cleanup(); return reject(new Error(`Ошибка Flow: "${errorMsg}"`)); }

        // Новые ассеты?
        const currentAssets = FlowSelectors.getGeneratedAssets();
        const currentCount = currentAssets.images.length + currentAssets.videos.length;
        const newAssetsDetected = currentCount > initialCount;

        // DOM-индикатор генерации
        const generating = FlowSelectors.isGenerating();
        if (generating) generationStarted = true;

        // Лог каждые 10с
        if (Date.now() - lastLogTime > 10000) {
          lastLogTime = Date.now();
          console.log(`[FlowBatch] waitForGen [${Math.round(elapsed / 1000)}с]: ` +
            `started=${generationStarted} response=${generationResponseReceived} ` +
            `generating=${generating} newAssets=${newAssetsDetected} assets=${currentCount}/${initialCount}`);
        }

        // ═══ Условия завершения ═══

        // 1. Новые ассеты появились + не генерируется → ГОТОВО
        if (newAssetsDetected && !generating) {
          console.log('[FlowBatch] waitForGen: ✅ новые ассеты обнаружены!');
          cleanup();
          return setTimeout(() => resolve(true), 2000);
        }

        // 2. Ответ сервера получен → ждём ассеты до 20с
        if (generationResponseReceived && !generating) {
          const sinceResponse = Date.now() - responseReceivedAt;
          if (newAssetsDetected) {
            console.log('[FlowBatch] waitForGen: ✅ ответ + ассеты');
            cleanup();
            return setTimeout(() => resolve(true), 2000);
          }
          if (sinceResponse > 20000) {
            console.log('[FlowBatch] waitForGen: ✅ ответ получен, ассетов нет в DOM (20с)');
            cleanup();
            return setTimeout(() => resolve(true), 1000);
          }
          // Иначе продолжаем ждать ассеты
        }

        // 3. Генерация стартовала, ответа нет → просто ждём (НЕ завершаем рано!)
        // (ничего не делаем, продолжаем цикл)

        // 4. Генерация НЕ стартовала → grace period
        if (!generationStarted && !newAssetsDetected && elapsed > START_GRACE_PERIOD) {
          try {
            const netState = await FB.getNetworkState();
            if (netState?.generationDetected) {
              generationStarted = true;
              console.log('[FlowBatch] waitForGen: 🔄 сетевой трекер подтвердил генерацию');
            } else {
              console.log('[FlowBatch] waitForGen: ❌ генерация не обнаружена за', Math.round(START_GRACE_PERIOD / 1000), 'с');
              cleanup();
              return reject(new Error('Генерация не началась — сетевых запросов не обнаружено.'));
            }
          } catch (e) {
            cleanup();
            return reject(new Error('Генерация не началась за ' + Math.round(START_GRACE_PERIOD / 1000) + 'с'));
          }
        }

        // 5. Общий таймаут
        if (elapsed > timeout) {
          cleanup();
          return reject(new Error('Генерация не завершилась за ' + Math.round(timeout / 1000) + 'с'));
        }

        setTimeout(check, 2000);
      };

      setTimeout(check, 3000);
    });
  };

  FB.autoDismissModals = async (maxAttempts = 3) => {
    let dismissed = 0;
    for (let i = 0; i < maxAttempts; i++) {
      if (FlowSelectors.dismissModals()) { dismissed++; await FB.sleep(500); } else break;
    }
    if (dismissed > 0) {
      console.log(`[FlowBatch] Закрыто модальных: ${dismissed}`);
      FB.notifyPanel({ type: 'LOG', text: `Закрыто модальных окон: ${dismissed}`, level: 'info' });
    }
  };

  FB.setupUltra = async () => {
    const want = FB.state.settings.useUltra;
    const btn = FlowSelectors.getUltraButton();
    if (!btn) { console.warn('[FlowBatch] Кнопка ULTRA не найдена'); return false; }
    const isActive = FlowSelectors.isUltraActive();
    if (want && !isActive) { await FB.clickElement(btn); console.log('[FlowBatch] ULTRA активирован'); }
    else if (!want && isActive) { await FB.clickElement(btn); console.log('[FlowBatch] ULTRA деактивирован'); }
    return true;
  };

  FB.setupFormat = async () => {
    const targetMode = FB.state.settings.mode;
    const targetType = targetMode.includes('video') ? 'Video' : 'Image';
    const targetAspect = FB.state.settings.aspectRatio;
    console.log(`[FlowBatch] setupFormat: цель → ${targetType} ${targetAspect}`);

    const current = FlowSelectors.getCurrentFormat();
    if (current) {
      console.log(`[FlowBatch] setupFormat: текущий → ${current.type} ${current.aspect}`);
      if (current.type.toLowerCase() === targetType.toLowerCase() && current.aspect === targetAspect) {
        console.log('[FlowBatch] setupFormat: формат верный ✓');
        return true;
      }
    }

    // Переключение типа
    const needTypeSwitch = !current || current.type.toLowerCase() !== targetType.toLowerCase();
    if (needTypeSwitch) {
      const typeTab = FlowSelectors.findTypeTab(targetType);
      if (typeTab) {
        await FB.clickElement(typeTab);
        await FB.sleep(1000);
      } else {
        console.warn(`[FlowBatch] setupFormat: переключатель "${targetType}" не найден — убедитесь что тип выбран вручную`);
        FB.notifyPanel({ type: 'LOG', text: `⚠ Переключатель "${targetType}" не найден`, level: 'warning' });
      }
    }

    // Aspect ratio
    const currentAfterType = FlowSelectors.getCurrentFormat();
    if (!currentAfterType || currentAfterType.aspect !== targetAspect) {
      const formatBtn = FlowSelectors.getFormatButton();
      if (formatBtn) { await FB.clickElement(formatBtn); await FB.sleep(1500); }
      const aspectBtn = FlowSelectors.findAspectRatioOption(targetAspect);
      if (aspectBtn) {
        await FB.clickElement(aspectBtn);
        await FB.sleep(500);
      }
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      await FB.sleep(500);
    }

    const final = FlowSelectors.getCurrentFormat();
    if (final) console.log(`[FlowBatch] setupFormat: итог → ${final.type} ${final.aspect} x${final.count}`);
    return true;
  };
})();
