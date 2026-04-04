/**
 * FlowBatch — Логика генерации v0.10
 * 
 * ИЗМЕНЕНИЯ v0.10:
 * - waitForGenerationComplete: использует сетевой трекер (flowbatch-generation-started/response events)
 * - waitForGenerationComplete: увеличен grace period, добавлено детальное логирование
 * - setupFormat: при отсутствии role="tab" элементов пропускает переключение типа
 *   (пользователь должен быть на нужной вкладке Flow)
 * - Новая функция clickCreate: клик Create через React props из page context
 */
(() => {
  'use strict';
  const FB = window.FB;
  if (!FB) return;

  /**
   * Клик кнопки Create через page context (React onClick)
   * Возвращает объект с результатом и состоянием сети
   */
  FB.clickCreate = async () => {
    console.log('[FlowBatch] clickCreate v0.10: отправляем в page context...');
    
    const result = await FB.requestPageContext('flowbatch-click-request', {
      selector: 'CREATE_BUTTON'
    }, 10000);
    
    console.log('[FlowBatch] clickCreate результат:', JSON.stringify(result));
    return result;
  };

  /**
   * Получить состояние сетевого трекера из page context
   */
  FB.getNetworkState = async () => {
    return FB.requestPageContext('flowbatch-network-state-request', {}, 5000);
  };

  /**
   * Ожидание завершения генерации v0.10
   * 
   * Улучшения:
   * - Использует события flowbatch-generation-started/response от injected.js
   * - Отслеживает сетевую активность через networkTracker
   * - Мониторит DOM (новые ассеты, progressbar, disabled кнопки)
   * - Расширен grace period и улучшено логирование
   */
  FB.waitForGenerationComplete = (timeout = 300000) => {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      let generationStarted = false;
      let generationResponseReceived = false;
      let stableCount = 0;
      const STABLE = 3;
      const START_GRACE_PERIOD = 45000; // Увеличено до 45с — даём время на сетевой запрос

      // Запоминаем начальное количество ассетов
      const initialAssets = FlowSelectors.getGeneratedAssets();
      const initialCount = initialAssets.images.length + initialAssets.videos.length;
      let newAssetsDetected = false;
      let lastLogTime = 0;

      // Слушаем события от page context (сетевой трекер)
      const onGenStarted = () => {
        generationStarted = true;
        console.log('[FlowBatch] waitForGeneration: 🚀 сетевой сигнал — генерация стартовала!');
      };
      const onGenResponse = () => {
        generationResponseReceived = true;
        console.log('[FlowBatch] waitForGeneration: ✅ сетевой сигнал — ответ генерации получен!');
      };

      window.addEventListener('flowbatch-generation-started', onGenStarted);
      window.addEventListener('flowbatch-generation-response', onGenResponse);

      const cleanup = () => {
        window.removeEventListener('flowbatch-generation-started', onGenStarted);
        window.removeEventListener('flowbatch-generation-response', onGenResponse);
      };

      const check = async () => {
        const elapsed = Date.now() - start;

        // Проверяем ошибку
        const errorMsg = FlowSelectors.getPageError();
        if (errorMsg) {
          cleanup();
          return reject(new Error(`Ошибка Flow: "${errorMsg}"`));
        }

        // Проверяем новые ассеты
        const currentAssets = FlowSelectors.getGeneratedAssets();
        const currentCount = currentAssets.images.length + currentAssets.videos.length;
        if (currentCount > initialCount) {
          newAssetsDetected = true;
        }

        // DOM-индикаторы генерации
        const generating = FlowSelectors.isGenerating();
        if (generating) {
          generationStarted = true;
          stableCount = 0;
        }

        // Логирование каждые 10 секунд
        if (Date.now() - lastLogTime > 10000) {
          lastLogTime = Date.now();
          console.log(`[FlowBatch] waitForGeneration [${Math.round(elapsed / 1000)}с]: ` +
            `started=${generationStarted} response=${generationResponseReceived} ` +
            `domGenerating=${generating} newAssets=${newAssetsDetected} ` +
            `assets=${currentCount}/${initialCount} stable=${stableCount}`);
        }

        // Генерация завершена: есть новые ассеты + не генерируется
        if (newAssetsDetected && !generating) {
          stableCount++;
          if (stableCount >= STABLE) {
            console.log('[FlowBatch] waitForGeneration: ✅ завершено — новые ассеты + стабильно');
            cleanup();
            return setTimeout(() => resolve(true), 2000);
          }
        }

        // Генерация завершена: сетевой ответ получен + не генерируется + стабильно
        if (generationResponseReceived && !generating) {
          stableCount++;
          if (stableCount >= 2) {
            // Ждём ещё чуть-чуть для рендера ассетов в DOM
            console.log('[FlowBatch] waitForGeneration: ✅ завершено — сетевой ответ + стабильно');
            cleanup();
            return setTimeout(() => resolve(true), 3000);
          }
        }

        // Генерация стартовала (DOM disabled кнопка) но завершилась
        if (generationStarted && !generating && !newAssetsDetected && !generationResponseReceived) {
          stableCount++;
          if (stableCount >= STABLE + 2) {
            // Может быть ошибка генерации без ассетов
            console.log('[FlowBatch] waitForGeneration: ⚠ генерация стартовала но нет ассетов — завершаем');
            cleanup();
            return setTimeout(() => resolve(false), 2000);
          }
        }

        // Не генерируется — сбрасываем стабильность
        if (generating) {
          stableCount = 0;
        }

        // Таймаут на старт
        if (!generationStarted && !newAssetsDetected && elapsed > START_GRACE_PERIOD) {
          // Попробуем проверить сеть через page context
          try {
            const netState = await FB.getNetworkState();
            if (netState?.generationDetected) {
              generationStarted = true;
              console.log('[FlowBatch] waitForGeneration: 🔄 сетевой трекер подтвердил генерацию (запоздалый)');
            } else {
              console.log('[FlowBatch] waitForGeneration: ❌ сетевой трекер не видит генерации');
              console.log('[FlowBatch] waitForGeneration: последние запросы:', JSON.stringify(netState?.recent || []));
              cleanup();
              return reject(new Error(
                `Генерация не началась за ${Math.round(START_GRACE_PERIOD / 1000)}с — проверьте промпт и формат. ` +
                `Сетевых запросов генерации не обнаружено.`
              ));
            }
          } catch (e) {
            cleanup();
            return reject(new Error(`Генерация не началась за ${Math.round(START_GRACE_PERIOD / 1000)}с`));
          }
        }

        // Общий таймаут
        if (elapsed > timeout) {
          cleanup();
          return reject(new Error(`Генерация не завершилась за ${Math.round(timeout / 1000)}с`));
        }

        setTimeout(check, 2000);
      };

      // Первая проверка через 3с
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
   * Переключение формата генерации v0.10
   * 
   * ИЗМЕНЕНИЯ:
   * - Если role="tab" нет на странице — пропускаем переключение типа с предупреждением
   * - Используем scan-ui для поиска Image/Video элементов
   * - Aspect ratio: более агрессивный поиск
   */
  FB.setupFormat = async () => {
    const targetMode = FB.state.settings.mode;
    const targetType = targetMode.includes('video') ? 'Video' : 'Image';
    const targetAspect = FB.state.settings.aspectRatio;
    const targetCount = FB.state.settings.outputCount;

    console.log(`[FlowBatch] setupFormat v0.10: цель → ${targetType} ${targetAspect} x${targetCount}`);

    const current = FlowSelectors.getCurrentFormat();
    if (current) {
      console.log(`[FlowBatch] setupFormat: текущий → ${current.type} ${current.aspect} x${current.count}`);
      if (current.type.toLowerCase() === targetType.toLowerCase() && current.aspect === targetAspect) {
        console.log('[FlowBatch] setupFormat: формат уже верный, пропускаем');
        return true;
      }
    }

    // ── Переключение типа (Image/Video) ──
    const needTypeSwitch = !current || current.type.toLowerCase() !== targetType.toLowerCase();
    
    if (needTypeSwitch) {
      console.log(`[FlowBatch] setupFormat: нужно переключить тип на "${targetType}"`);
      
      // Стратегия 1: findTypeTab (role="tab")
      let typeTab = FlowSelectors.findTypeTab(targetType);
      
      if (!typeTab) {
        // Стратегия 2: scan-ui через page context
        console.log('[FlowBatch] setupFormat: role="tab" не найден, запускаем scan-ui...');
        
        try {
          const scanResult = await FB.requestPageContext('flowbatch-scan-ui-request', {}, 10000);
          console.log('[FlowBatch] setupFormat: scan-ui нашёл Image/Video элементов:', scanResult.imageVideoCount);
          
          if (scanResult.imageVideo && scanResult.imageVideo.length > 0) {
            console.log('[FlowBatch] setupFormat: Image/Video элементы:', JSON.stringify(scanResult.imageVideo));
            
            // Ищем кликабельный элемент с нужным типом
            for (const item of scanResult.imageVideo) {
              const text = item.text.toLowerCase();
              if (text.includes(targetType.toLowerCase()) && (item.clickable || item.parentRole === 'tab')) {
                // Пробуем кликнуть
                const targetEl = document.querySelector(`${item.tag}[class="${item.classes}"]`) || 
                                 document.evaluate(`//${item.tag}[contains(text(),"${targetType}")]`, 
                                   document, null, XPathResult.FIRST_ORDERED_NODE_TYPE).singleNodeValue;
                if (targetEl) {
                  await FB.clickElement(targetEl);
                  await FB.sleep(1000);
                  console.log('[FlowBatch] setupFormat: клик на найденный элемент');
                  break;
                }
              }
            }
          } else {
            console.log('[FlowBatch] setupFormat: scan-ui toolbar элементов:', scanResult.toolbarCount);
            if (scanResult.toolbar && scanResult.toolbar.length > 0) {
              // Логируем все элементы для отладки
              for (const item of scanResult.toolbar.slice(0, 15)) {
                console.log(`[FlowBatch] setupFormat: toolbar: "${item.text}" tag=${item.tag} role=${item.role} onClick=${item.hasOnClick}`);
              }
            }
          }
        } catch (e) {
          console.warn('[FlowBatch] setupFormat: scan-ui ошибка:', e.message);
        }
      }
      
      if (!typeTab) {
        console.warn(`[FlowBatch] setupFormat: ⚠ переключатель "${targetType}" не найден.`);
        console.warn('[FlowBatch] setupFormat: Убедитесь что нужный тип (Image/Video) уже выбран в интерфейсе Flow.');
        FB.notifyPanel({ 
          type: 'LOG', 
          text: `⚠ Переключатель "${targetType}" не найден. Убедитесь что нужный тип уже выбран.`, 
          level: 'warning' 
        });
      } else {
        console.log(`[FlowBatch] setupFormat: кликаем tab "${typeTab.textContent.trim().substring(0, 30)}"...`);
        await FB.clickElement(typeTab);
        await FB.sleep(1000);
      }
    }

    // ── Aspect ratio ──
    const currentAfterType = FlowSelectors.getCurrentFormat();
    if (currentAfterType && currentAfterType.aspect === targetAspect) {
      console.log('[FlowBatch] setupFormat: aspect ratio уже верный');
    } else {
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

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      await FB.sleep(500);
    }

    const newFormat = FlowSelectors.getCurrentFormat();
    if (newFormat) {
      console.log(`[FlowBatch] setupFormat: итоговый формат → ${newFormat.type} ${newFormat.aspect} x${newFormat.count}`);
      FB.notifyPanel({ type: 'LOG', text: `Формат: ${newFormat.type} ${newFormat.aspect} x${newFormat.count}`, level: 'info' });
    } else {
      console.warn('[FlowBatch] setupFormat: не удалось определить итоговый формат');
    }

    return true;
  };
})();
