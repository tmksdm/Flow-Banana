/**
 * FlowBatch — Логика генерации: waitForGenerationComplete, autoDismissModals, setupUltra
 */
(() => {
  'use strict';
  const FB = window.FB;
  if (!FB) return;

  /**
   * Ожидание завершения генерации
   * Стратегия: ждём начало → ждём стабильное "не генерирует" (3 раза подряд)
   */
  FB.waitForGenerationComplete = (timeout = 300000) => {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      let wasGenerating = false;
      let stableCount = 0;
      const STABLE = 3;

      const check = () => {
        const generating = FlowSelectors.isGenerating();
        if (generating) { wasGenerating = true; stableCount = 0; }
        if (wasGenerating && !generating) {
          stableCount++;
          if (stableCount >= STABLE) {
            return setTimeout(() => resolve(true), 2000); // буфер для рендера
          }
        }
        if (Date.now() - start > timeout) {
          return reject(new Error(`Генерация не завершилась за ${timeout / 1000}с`));
        }
        setTimeout(check, 1000);
      };

      setTimeout(check, 2000); // 2с на старт генерации
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
   * Настройка формата генерации (пока — заглушка, нужна калибровка DOM меню)
   */
  FB.setupFormat = async () => {
    const btn = FlowSelectors.getFormatButton();
    if (!btn) { console.warn('[FlowBatch] Комбо-кнопка формата не найдена'); return false; }

    const current = FlowSelectors.getCurrentFormat();
    if (current) {
      const targetType = FB.state.settings.mode.includes('video') ? 'Video' : 'Image';
      const targetAspect = FB.state.settings.aspectRatio;
      const targetCount = FB.state.settings.outputCount;
      if (current.type?.toLowerCase() === targetType.toLowerCase()
        && current.aspect === targetAspect
        && current.count === targetCount) {
        console.log('[FlowBatch] Формат уже верный');
        return true;
      }
    }

    await FB.clickElement(btn);
    await FB.sleep(800);
    // TODO: навигация внутри меню формата — нужна калибровка
    console.log('[FlowBatch] Панель формата открыта (нужна калибровка)');
    FB.notifyPanel({ type: 'LOG', text: 'Панель формата открыта (нужна калибровка)', level: 'warning' });
    return true;
  };
})();
