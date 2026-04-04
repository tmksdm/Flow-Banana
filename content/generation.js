/**
 * FlowBatch — Логика генерации v0.8
 * ИСПРАВЛЕНИЯ:
 * - setupFormat: использует findTypeTab() вместо поиска по cleanText
 * - setupFormat: убрана "Попытка 4" с поиском <I> элемента (Material icon)
 * - waitForGenerationComplete: улучшено обнаружение (проверяем DOM изменения)
 */
(() => {
  'use strict';
  const FB = window.FB;
  if (!FB) return;

  /**
   * Ожидание завершения генерации v0.8
   * Улучшения: помимо isGenerating(), следим за появлением новых ассетов
   */
  FB.waitForGenerationComplete = (timeout = 300000) => {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      let wasGenerating = false;
      let stableCount = 0;
      const STABLE = 3;
      const START_GRACE_PERIOD = 30000; // Увеличено с 20с до 30с

      // Запоминаем начальное количество ассетов
      const initialAssets = FlowSelectors.getGeneratedAssets();
      const initialCount = initialAssets.images.length + initialAssets.videos.length;
      let newAssetsDetected = false;

      const check = () => {
        const errorMsg = FlowSelectors.getPageError();
        if (errorMsg) {
          return reject(new Error(`Ошибка Flow: "${errorMsg}"`));
        }

        // Проверяем появление новых ассетов
        const currentAssets = FlowSelectors.getGeneratedAssets();
        const currentCount = currentAssets.images.length + currentAssets.videos.length;
        if (currentCount > initialCount) {
          newAssetsDetected = true;
        }

        const generating = FlowSelectors.isGenerating();
        if (generating) { wasGenerating = true; stableCount = 0; }
        
        if (wasGenerating && !generating) {
          stableCount++;
          if (stableCount >= STABLE) {
            console.log('[FlowBatch] waitForGeneration: генерация завершена (стабильно)');
            return setTimeout(() => resolve(true), 2000);
          }
        }

        // Если новые ассеты появились и генерация не активна — считаем завершённой
        if (newAssetsDetected && !generating && stableCount >= 1) {
          console.log('[FlowBatch] waitForGeneration: новые ассеты обнаружены, генерация завершена');
          return setTimeout(() => resolve(true), 2000);
        }

        if (!wasGenerating && !newAssetsDetected && (Date.now() - start > START_GRACE_PERIOD)) {
          return reject(new Error(
            `Генерация не началась за ${START_GRACE_PERIOD / 1000}с — проверьте промпт и формат`
          ));
        }
        if (Date.now() - start > timeout) {
          return reject(new Error(`Генерация не завершилась за ${timeout / 1000}с`));
        }
        setTimeout(check, 1000);
      };

      setTimeout(check, 3000);
    });
  };

  /**
   * Авто-закрытие модальных окон
   */
  FB.autoDismissModals = async (maxAttempts = 3) => {
    let dismissed = 0;
    for (let i = 0; i < maxAttempts; i++) {
      if (FlowSelectors.dismissModals()) {
        dismissed++;
        await FB.sleep(500);
      } else break;
    }
    if (dismissed > 0) {
      console.log(`[FlowBatch] Закрыто модальных окон: ${dismissed}`);
      FB.notifyPanel({ type: 'LOG', text: `Закрыто модальных окон: ${dismissed}`, level: 'info' });
    }
    return dismissed;
  };

  /**
   * Включение / выключение ULTRA-режима
   */
  FB.setupUltra = async () => {
    const want = FB.state.settings.useUltra;
    const btn = FlowSelectors.getUltraButton();
    if (!btn) { console.warn('[FlowBatch] Кнопка ULTRA не найдена'); return false; }
    const isActive = FlowSelectors.isUltraActive();
    if (want && !isActive) {
      await FB.clickElement(btn);
      console.log('[FlowBatch] ULTRA активирован');
      FB.notifyPanel({ type: 'LOG', text: 'ULTRA-режим активирован', level: 'success' });
    } else if (!want && isActive) {
      await FB.clickElement(btn);
      console.log('[FlowBatch] ULTRA деактивирован');
      FB.notifyPanel({ type: 'LOG', text: 'ULTRA-режим деактивирован', level: 'info' });
    }
    return true;
  };

  /**
   * Переключение формата генерации v0.8
   * ИСПРАВЛЕНИЯ:
   * - Использует findTypeTab() для поиска кнопки Image/Video
   * - Не кликает на Material Icon элементы напрямую
   */
  FB.setupFormat = async () => {
    const targetMode = FB.state.settings.mode;
    const targetType = targetMode.includes('video') ? 'Video' : 'Image';
    const targetAspect = FB.state.settings.aspectRatio;
    const targetCount = FB.state.settings.outputCount;

    console.log(`[FlowBatch] setupFormat: цель → ${targetType} ${targetAspect} x${targetCount}`);

    const current = FlowSelectors.getCurrentFormat();
    if (current) {
      console.log(`[FlowBatch] setupFormat: текущий → ${current.type} ${current.aspect} x${current.count}`);
      if (current.type.toLowerCase() === targetType.toLowerCase() && current.aspect === targetAspect) {
        console.log('[FlowBatch] setupFormat: формат уже верный, пропускаем');
        return true;
      }
    }

    // ── Переключение типа (Image/Video) через tab-кнопку ──
    // Сначала проверяем, нужно ли переключать тип
    const needTypeSwitch = !current || current.type.toLowerCase() !== targetType.toLowerCase();
    
    if (needTypeSwitch) {
      console.log(`[FlowBatch] setupFormat: нужно переключить тип на "${targetType}"`);
      
      // Используем findTypeTab — специализированный поиск для Flow tabs
      const typeTab = FlowSelectors.findTypeTab(targetType);
      
      if (typeTab) {
        console.log(`[FlowBatch] setupFormat: кликаем tab "${typeTab.textContent.trim().substring(0, 30)}"...`);
        await FB.clickElement(typeTab);
        await FB.sleep(1000);
        
        // Проверяем что переключение сработало
        const afterSwitch = FlowSelectors.getCurrentFormat();
        if (afterSwitch) {
          console.log(`[FlowBatch] setupFormat: после переключения → ${afterSwitch.type} ${afterSwitch.aspect}`);
        }
      } else {
        console.warn(`[FlowBatch] setupFormat: tab "${targetType}" НЕ найден!`);
        FB.notifyPanel({ type: 'LOG', text: `Tab "${targetType}" не найден`, level: 'warning' });
        
        // Fallback: кликаем на комбо-кнопку формата и ищем в панели
        const formatBtn = FlowSelectors.getFormatButton();
        if (formatBtn) {
          console.log('[FlowBatch] setupFormat: пробуем через комбо-кнопку...');
          await FB.clickElement(formatBtn);
          await FB.sleep(1500);
          
          // Ищем tab в открытой панели
          const typeTabInPanel = FlowSelectors.findTypeTab(targetType);
          if (typeTabInPanel) {
            await FB.clickElement(typeTabInPanel);
            await FB.sleep(800);
          }
        }
      }
    }

    // ── Ищем aspect ratio (если нужно менять) ──
    const currentAfterType = FlowSelectors.getCurrentFormat();
    if (currentAfterType && currentAfterType.aspect === targetAspect) {
      console.log('[FlowBatch] setupFormat: aspect ratio уже верный');
    } else {
      // Открываем панель формата если ещё не открыта
      const formatBtn = FlowSelectors.getFormatButton();
      if (formatBtn) {
        await FB.clickElement(formatBtn);
        await FB.sleep(1500);
      }

      const aspectButton = FlowSelectors.findAspectRatioOption(targetAspect);
      if (aspectButton) {
        console.log(`[FlowBatch] setupFormat: найден aspect ratio ${targetAspect}, кликаем...`);
        await FB.clickElement(aspectButton);
        await FB.sleep(500);
      } else {
        console.warn(`[FlowBatch] setupFormat: aspect ratio ${targetAspect} не найден`);
      }

      // Закрываем панель
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      await FB.sleep(500);
    }

    // Проверяем результат
    const newFormat = FlowSelectors.getCurrentFormat();
    if (newFormat) {
      console.log(`[FlowBatch] setupFormat: итоговый формат → ${newFormat.type} ${newFormat.aspect} x${newFormat.count}`);
      FB.notifyPanel({ type: 'LOG', text: `Формат: ${newFormat.type} ${newFormat.aspect} x${newFormat.count}`, level: 'info' });
    }

    return true;
  };
})();
