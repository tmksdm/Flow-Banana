/**
 * FlowBatch — Логика генерации v0.7
 * - setupFormat: расширенная диагностика (выводит текст каждой кнопки)
 * - setupFormat: ищет Image/Video по более широким паттернам (tab, span, div)
 */
(() => {
  'use strict';
  const FB = window.FB;
  if (!FB) return;

  /**
   * Ожидание завершения генерации v0.6 (без изменений)
   */
  FB.waitForGenerationComplete = (timeout = 300000) => {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      let wasGenerating = false;
      let stableCount = 0;
      const STABLE = 3;
      const START_GRACE_PERIOD = 20000;

      const check = () => {
        const errorMsg = FlowSelectors.getPageError();
        if (errorMsg) {
          return reject(new Error(`Ошибка Flow: "${errorMsg}"`));
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
        if (!wasGenerating && (Date.now() - start > START_GRACE_PERIOD)) {
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
   * Авто-закрытие модальных окон (без изменений)
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
   * Включение / выключение ULTRA-режима (без изменений)
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
   * Переключение формата генерации v0.7
   * Улучшения:
   * - Логирует ТЕКСТ каждой видимой кнопки при ошибке
   * - Ищет Image/Video по более широким селекторам (любой кликабельный элемент)
   * - Ищет в том числе по aria-label и data-атрибутам
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
      if (current.type === targetType && current.aspect === targetAspect) {
        console.log('[FlowBatch] setupFormat: формат уже верный, пропускаем');
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

    console.log('[FlowBatch] setupFormat: кликаем на комбо-кнопку...');
    await FB.clickElement(formatBtn);
    await FB.sleep(1500); // Увеличена задержка для анимации открытия панели

    // ── РАСШИРЕННАЯ ДИАГНОСТИКА: собираем ВСЕ видимые кликабельные элементы ──
    const wideSelector = 'button, [role="button"], [role="tab"], [role="radio"], [role="menuitem"], [role="option"], [role="menuitemradio"], [role="listbox"] > *, [role="tablist"] > *';
    const allClickable = FlowSelectors.deepQueryAll(wideSelector);
    const visibleClickable = allClickable.filter(el => el.offsetParent !== null);

    console.log(`[FlowBatch] setupFormat: всего кликабельных: ${allClickable.length}, видимых: ${visibleClickable.length}`);

    // Логируем КАЖДУЮ видимую кнопку для диагностики
    console.log('[FlowBatch] setupFormat: === ВИДИМЫЕ КЛИКАБЕЛЬНЫЕ ЭЛЕМЕНТЫ ===');
    visibleClickable.forEach((el, i) => {
      const raw = el.textContent.trim().substring(0, 60);
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute('role') || '';
      const ariaLabel = el.getAttribute('aria-label') || '';
      const ariaSelected = el.getAttribute('aria-selected') || '';
      const classes = el.className ? (typeof el.className === 'string' ? el.className : '').substring(0, 50) : '';
      console.log(`  [${i}] <${tag}> role="${role}" aria-label="${ariaLabel}" aria-selected="${ariaSelected}" class="${classes}" text="${raw}"`);
    });
    console.log('[FlowBatch] setupFormat: === КОНЕЦ СПИСКА ===');

    // ── Ищем кнопку типа (Image/Video) ──
    let typeButton = null;

    // Попытка 1: точное совпадение текста
    for (const el of visibleClickable) {
      const cleanText = FlowSelectors.cleanButtonText(el).trim();
      if (cleanText.toLowerCase() === targetType.toLowerCase()) {
        typeButton = el;
        console.log(`[FlowBatch] setupFormat: найдена по cleanText: "${cleanText}"`);
        break;
      }
    }

    // Попытка 2: текст содержит целевое слово (но не полная кнопка формата)
    if (!typeButton) {
      for (const el of visibleClickable) {
        const text = el.textContent.trim();
        // Пропускаем саму комбо-кнопку формата (она содержит "Video" или "Image" в составе)
        if (text.match(/(Video|Image)\s*crop/i)) continue;
        if (text.toLowerCase() === targetType.toLowerCase() ||
            text.toLowerCase().startsWith(targetType.toLowerCase() + ' ') ||
            text.toLowerCase().endsWith(' ' + targetType.toLowerCase())) {
          typeButton = el;
          console.log(`[FlowBatch] setupFormat: найдена по textContent: "${text}"`);
          break;
        }
      }
    }

    // Попытка 3: aria-label
    if (!typeButton) {
      for (const el of visibleClickable) {
        const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
        if (ariaLabel === targetType.toLowerCase() || ariaLabel.includes(targetType.toLowerCase())) {
          typeButton = el;
          console.log(`[FlowBatch] setupFormat: найдена по aria-label: "${ariaLabel}"`);
          break;
        }
      }
    }

    // Попытка 4: ищем среди ВСЕХ элементов (не только кликабельных)
    if (!typeButton) {
      const allElements = FlowSelectors.deepQueryAll('*');
      const visible = allElements.filter(el => el.offsetParent !== null && el.textContent.trim().length < 20);
      for (const el of visible) {
        const text = el.textContent.trim();
        if (text.toLowerCase() === targetType.toLowerCase() && el.children.length === 0) {
          // Нашли текстовый элемент — кликаем на него или на его родителя
          typeButton = el;
          console.log(`[FlowBatch] setupFormat: найдена как текстовый элемент <${el.tagName}>: "${text}"`);
          break;
        }
      }
    }

    if (typeButton) {
      console.log(`[FlowBatch] setupFormat: кликаем кнопку типа "${typeButton.textContent.trim().substring(0, 30)}"...`);
      await FB.clickElement(typeButton);
      await FB.sleep(800);
    } else {
      console.warn(`[FlowBatch] setupFormat: кнопка "${targetType}" НЕ НАЙДЕНА`);
      FB.notifyPanel({ type: 'LOG', text: `Кнопка "${targetType}" не найдена — см. лог`, level: 'warning' });
    }

    // ── Ищем aspect ratio ──
    const aspectButton = FlowSelectors.findAspectRatioOption(targetAspect);
    if (aspectButton) {
      console.log(`[FlowBatch] setupFormat: найден aspect ratio ${targetAspect}, кликаем...`);
      await FB.clickElement(aspectButton);
      await FB.sleep(500);
    } else {
      console.warn(`[FlowBatch] setupFormat: aspect ratio ${targetAspect} не найден`);
    }

    // ── Ищем count ──
    const countClickable = FlowSelectors.deepQueryAll('button, [role="button"], [role="tab"], [role="radio"], [role="menuitemradio"]');
    let countButton = null;
    for (const el of countClickable) {
      const text = el.textContent.trim();
      if ((text === `x${targetCount}` || text === `${targetCount}` || text === `×${targetCount}`) &&
          el.offsetParent !== null) {
        countButton = el;
        break;
      }
    }
    if (countButton) {
      console.log(`[FlowBatch] setupFormat: найден count x${targetCount}, кликаем...`);
      await FB.clickElement(countButton);
      await FB.sleep(300);
    }

    // Закрываем панель
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    await FB.sleep(500);

    // Проверяем результат
    const newFormat = FlowSelectors.getCurrentFormat();
    if (newFormat) {
      console.log(`[FlowBatch] setupFormat: итоговый формат → ${newFormat.type} ${newFormat.aspect} x${newFormat.count}`);
      FB.notifyPanel({ type: 'LOG', text: `Формат: ${newFormat.type} ${newFormat.aspect} x${newFormat.count}`, level: 'info' });
    }

    return true;
  };
})();
