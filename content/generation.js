/**
 * FlowBatch — Логика генерации v0.6
 * - waitForGenerationComplete: добавлен early-exit если генерация не стартовала,
 *   и проверка error-сообщений на странице
 * - setupFormat: реализовано переключение Video ↔ Image через DOM
 * - setupUltra: без изменений
 */
(() => {
  'use strict';
  const FB = window.FB;
  if (!FB) return;

  /**
   * Ожидание завершения генерации v0.6
   * 
   * Улучшения:
   * - Early exit: если через startGracePeriod секунд генерация не началась → ошибка
   * - Проверка error-сообщений на странице
   * - Стабильная проверка (3 раза подряд "не генерирует" после того, как генерация была)
   */
  FB.waitForGenerationComplete = (timeout = 300000) => {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      let wasGenerating = false;
      let stableCount = 0;
      const STABLE = 3;
      const START_GRACE_PERIOD = 20000; // 20с на начало генерации

      const check = () => {
        // Проверяем ошибки на странице
        const errorMsg = FlowSelectors.getPageError();
        if (errorMsg) {
          return reject(new Error(`Ошибка Flow: "${errorMsg}"`));
        }

        const generating = FlowSelectors.isGenerating();
        
        if (generating) { 
          wasGenerating = true; 
          stableCount = 0; 
        }
        
        if (wasGenerating && !generating) {
          stableCount++;
          if (stableCount >= STABLE) {
            console.log('[FlowBatch] waitForGeneration: генерация завершена (стабильно)');
            return setTimeout(() => resolve(true), 2000); // буфер для рендера
          }
        }

        // Early exit: генерация не началась за START_GRACE_PERIOD
        if (!wasGenerating && (Date.now() - start > START_GRACE_PERIOD)) {
          return reject(new Error(
            `Генерация не началась за ${START_GRACE_PERIOD / 1000}с — проверьте промпт и формат`
          ));
        }

        // Общий timeout
        if (Date.now() - start > timeout) {
          return reject(new Error(`Генерация не завершилась за ${timeout / 1000}с`));
        }

        setTimeout(check, 1000);
      };

      setTimeout(check, 3000); // 3с grace period перед первой проверкой
    });
  };

  /**
   * Авто-закрытие модальных окон ("OK, got it" и т.д.)
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
   * Переключение формата генерации (Video ↔ Image, aspect ratio, count)
   * 
   * Стратегия:
   * 1. Определить текущий формат из комбо-кнопки
   * 2. Если тип уже правильный — skip
   * 3. Кликнуть на комбо-кнопку → откроется панель настроек формата
   * 4. В панели найти tab/button "Image" или "Video" по тексту
   * 5. Кликнуть, затем выбрать aspect ratio
   * 6. Закрыть панель (клик вне неё или Escape)
   */
  FB.setupFormat = async () => {
    const targetMode = FB.state.settings.mode; // 'text-to-image', 'text-to-video', etc.
    const targetType = targetMode.includes('video') ? 'Video' : 'Image';
    const targetAspect = FB.state.settings.aspectRatio; // '16:9', '9:16', '1:1'
    const targetCount = FB.state.settings.outputCount;  // 1, 2, 3, 4

    console.log(`[FlowBatch] setupFormat: цель → ${targetType} ${targetAspect} x${targetCount}`);

    // Проверяем текущий формат
    const current = FlowSelectors.getCurrentFormat();
    if (current) {
      console.log(`[FlowBatch] setupFormat: текущий → ${current.type} ${current.aspect} x${current.count}`);
      if (current.type === targetType && current.aspect === targetAspect) {
        console.log('[FlowBatch] setupFormat: формат уже верный');
        return true;
      }
    }

    // Кликаем на комбо-кнопку формата
    const formatBtn = FlowSelectors.getFormatButton();
    if (!formatBtn) {
      console.warn('[FlowBatch] setupFormat: комбо-кнопка формата не найдена');
      FB.notifyPanel({ type: 'LOG', text: 'Кнопка формата не найдена', level: 'warning' });
      return false;
    }

    console.log('[FlowBatch] setupFormat: кликаем на комбо-кнопку формата...');
    await FB.clickElement(formatBtn);
    await FB.sleep(1000); // ждём открытия панели

    // Ищем панель/popup/dropdown, которая появилась
    // Пробуем найти элементы "Image" и "Video" в появившемся меню
    const allClickable = FlowSelectors.deepQueryAll('button, [role="button"], [role="tab"], [role="radio"], [role="menuitem"], [role="option"], [role="menuitemradio"]');
    
    let typeButton = null;
    for (const el of allClickable) {
      const text = el.textContent.trim();
      // Ищем точное совпадение с "Image" или "Video" (в зависимости от цели)
      if (text === targetType || text.toLowerCase() === targetType.toLowerCase()) {
        typeButton = el;
        break;
      }
    }

    if (!typeButton) {
      // Попробуем найти по тексту внутри
      for (const el of allClickable) {
        const cleanText = FlowSelectors.cleanButtonText(el).toLowerCase();
        if (cleanText === targetType.toLowerCase()) {
          typeButton = el;
          break;
        }
      }
    }

    if (typeButton) {
      console.log(`[FlowBatch] setupFormat: найдена кнопка типа "${typeButton.textContent.trim()}", кликаем...`);
      await FB.clickElement(typeButton);
      await FB.sleep(500);
    } else {
      console.warn(`[FlowBatch] setupFormat: кнопка "${targetType}" не найдена в панели формата`);
      // Логируем все видимые кнопки для диагностики
      const visibleButtons = allClickable.filter(el => el.offsetParent !== null).map(el => el.textContent.trim().substring(0, 40));
      console.log('[FlowBatch] setupFormat: видимые кнопки:', visibleButtons.slice(0, 20));
      FB.notifyPanel({ type: 'LOG', text: `Кнопка "${targetType}" не найдена. Видимые: ${visibleButtons.slice(0, 5).join(', ')}`, level: 'warning' });
    }

    // Ищем aspect ratio
    const aspectButton = FlowSelectors.findAspectRatioOption(targetAspect);
    if (aspectButton) {
      console.log(`[FlowBatch] setupFormat: найден aspect ratio ${targetAspect}, кликаем...`);
      await FB.clickElement(aspectButton);
      await FB.sleep(500);
    } else {
      console.warn(`[FlowBatch] setupFormat: aspect ratio ${targetAspect} не найден`);
    }

    // Ищем count (количество выходов)
    // Обычно это кнопки "x1", "x2", "x3", "x4" или "1", "2", "3", "4"
    const countClickable = FlowSelectors.deepQueryAll('button, [role="button"], [role="tab"], [role="radio"], [role="menuitemradio"]');
    let countButton = null;
    for (const el of countClickable) {
      const text = el.textContent.trim();
      if (text === `x${targetCount}` || text === `${targetCount}` || text === `×${targetCount}`) {
        // Убеждаемся что это видимая кнопка в панели формата
        if (el.offsetParent !== null) {
          countButton = el;
          break;
        }
      }
    }
    if (countButton) {
      console.log(`[FlowBatch] setupFormat: найден count x${targetCount}, кликаем...`);
      await FB.clickElement(countButton);
      await FB.sleep(300);
    }

    // Закрываем панель — клик вне неё или Escape
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    await FB.sleep(300);

    // Проверяем результат
    const newFormat = FlowSelectors.getCurrentFormat();
    if (newFormat) {
      console.log(`[FlowBatch] setupFormat: итоговый формат → ${newFormat.type} ${newFormat.aspect} x${newFormat.count}`);
      FB.notifyPanel({ type: 'LOG', text: `Формат: ${newFormat.type} ${newFormat.aspect} x${newFormat.count}`, level: 'info' });
    }

    return true;
  };
})();
