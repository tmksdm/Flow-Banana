/**
 * FlowBatch — Логика скачивания v0.12
 *
 * Стратегия скачивания:
 * 1. Попробовать UI: найти кнопки download/more у ассета → меню → разрешение
 * 2. Fallback: скачать через fetch в page context (с cookies/auth) → blob → chrome.downloads
 * 3. Last resort: скачать по src напрямую через chrome.downloads
 */
(() => {
  'use strict';
  const FB = window.FB;
  if (!FB) return;

  /**
   * Получить список НОВЫХ ассетов (изображений), появившихся после определённого момента.
   * Сравниваем с массивом src-ов, которые были ДО генерации.
   */
  FB.getNewAssets = (previousSrcs = []) => {
    const assets = FlowSelectors.getGeneratedAssets();
    const all = [...assets.images, ...assets.videos];
    const prevSet = new Set(previousSrcs);
    return all.filter(el => {
      const src = el.src || el.querySelector?.('source')?.src || '';
      return src && !prevSet.has(src);
    });
  };

  /**
   * Запомнить текущие src ассетов (вызывается ПЕРЕД генерацией)
   */
  FB.snapshotAssetSrcs = () => {
    const assets = FlowSelectors.getGeneratedAssets();
    const all = [...assets.images, ...assets.videos];
    return all.map(el => el.src || el.querySelector?.('source')?.src || '').filter(Boolean);
  };

  /**
   * Попробовать скачать через UI Google Flow (кнопка download рядом с ассетом)
   */
  async function tryDownloadViaUI(assetElement, resolution = '4K') {
    // Стратегия A: Ищем кнопку download / more рядом с ассетом
    let container = assetElement.parentElement;
    let depth = 0;
    
    while (container && depth < 8) {
      const btns = container.querySelectorAll('button, [role="button"]');
      
      for (const btn of btns) {
        if (btn.offsetParent === null) continue;
        const text = btn.textContent.trim().toLowerCase();
        const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
        
        // Прямая кнопка download
        if (text.includes('download') || ariaLabel.includes('download')) {
          console.log('[FlowBatch] Найдена кнопка download у ассета');
          await FB.clickElement(btn);
          await FB.sleep(1000);
          
          // Пробуем выбрать разрешение
          const resOption = FlowSelectors.getResolutionOption(resolution);
          if (resOption) {
            await FB.clickElement(resOption);
            console.log(`[FlowBatch] Скачивание: ${resolution} через UI`);
            FB.notifyPanel({ type: 'LOG', text: `Скачивание ${resolution} через UI`, level: 'success' });
            return true;
          }
          // Если разрешение не нашли — возможно скачивание уже началось
          console.log('[FlowBatch] Скачивание через UI (без выбора разрешения)');
          FB.notifyPanel({ type: 'LOG', text: 'Скачивание через UI', level: 'success' });
          return true;
        }
        
        // Кнопка more_vert / more_horiz (три точки)
        if (text.includes('more_vert') || text.includes('more_horiz') || 
            ariaLabel.includes('more') || ariaLabel.includes('options') || ariaLabel.includes('menu')) {
          console.log('[FlowBatch] Найдена кнопка more у ассета, открываем меню...');
          await FB.clickElement(btn);
          await FB.sleep(800);
          
          // Ищем пункт Download в меню
          const dlOption = FlowSelectors.getDownloadMenuOption();
          if (dlOption) {
            await FB.clickElement(dlOption);
            await FB.sleep(800);
            
            // Пробуем выбрать разрешение
            const resOption = FlowSelectors.getResolutionOption(resolution);
            if (resOption) {
              await FB.clickElement(resOption);
              console.log(`[FlowBatch] Скачивание: ${resolution} через меню`);
              FB.notifyPanel({ type: 'LOG', text: `Скачивание ${resolution} через меню`, level: 'success' });
              return true;
            }
            console.log('[FlowBatch] Скачивание через меню (без разрешения)');
            return true;
          }
          
          // Закрыть меню если Download не найден
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
          await FB.sleep(300);
        }
      }
      
      container = container.parentElement;
      depth++;
    }
    
    return false;
  }

  /**
   * Скачать один ассет через fetch в page context (с авторизацией)
   */
  async function downloadViaFetch(src, index) {
    console.log('[FlowBatch] Скачивание через fetch:', src.substring(0, 80));
    
    const result = await FB.requestPageContext('flowbatch-download-request', { url: src }, 30000);
    
    if (result.success && result.blobUrl) {
      const ext = (result.contentType || '').includes('video') ? 'mp4' : 
                  (result.contentType || '').includes('webp') ? 'webp' : 'png';
      const filename = `flowbatch_${Date.now()}_${index}.${ext}`;
      
      chrome.runtime.sendMessage({
        type: 'DOWNLOAD_FILE',
        url: result.blobUrl,
        filename
      });
      
      console.log(`[FlowBatch] ✅ Скачивание запущено: ${filename} (${Math.round(result.size / 1024)}KB)`);
      FB.notifyPanel({ type: 'LOG', text: `Скачивание: ${filename}`, level: 'success' });
      return true;
    }
    
    console.warn('[FlowBatch] Fetch-скачивание не удалось:', result.reason);
    return false;
  }

  /**
   * Скачать напрямую по src через chrome.downloads
   */
  function downloadViaSrc(src, index) {
    const isVideo = src.includes('video') || src.includes('.mp4');
    const ext = isVideo ? 'mp4' : 'png';
    const filename = `flowbatch_${Date.now()}_${index}.${ext}`;
    
    chrome.runtime.sendMessage({
      type: 'DOWNLOAD_FILE',
      url: src,
      filename
    });
    
    console.log(`[FlowBatch] Скачивание по src: ${filename}`);
    FB.notifyPanel({ type: 'LOG', text: `Скачивание (прямой URL): ${filename}`, level: 'info' });
    return true;
  }

  /**
   * Главная функция скачивания v0.12
   * @param {string} resolution - целевое разрешение ('4K', '2K', '1K')
   * @param {string[]} previousSrcs - массив src до генерации (для определения новых)
   */
  FB.triggerDownload = async (resolution = '4K', previousSrcs = null) => {
    try {
      console.log('[FlowBatch] === Начало скачивания v0.12 ===');
      console.log('[FlowBatch] Разрешение:', resolution);
      
      // Определяем какие ассеты новые
      let toDownload;
      if (previousSrcs && previousSrcs.length > 0) {
        toDownload = FB.getNewAssets(previousSrcs);
        console.log(`[FlowBatch] Новых ассетов: ${toDownload.length} (было: ${previousSrcs.length})`);
      } else {
        // Fallback: берём последние N ассетов
        const assets = FlowSelectors.getGeneratedAssets();
        const all = [...assets.images, ...assets.videos];
        const count = Math.min(FB.state.settings.outputCount, all.length);
        toDownload = all.slice(-count);
        console.log(`[FlowBatch] Берём последние ${count} ассетов из ${all.length}`);
      }
      
      if (toDownload.length === 0) {
        console.warn('[FlowBatch] Нет новых ассетов для скачивания');
        FB.notifyPanel({ type: 'LOG', text: '⚠ Нет новых ассетов для скачивания', level: 'warning' });
        
        // Попробуем запустить discovery чтобы понять DOM
        const discovery = await FB.requestPageContext('flowbatch-discover-assets-request', {}, 10000);
        console.log('[FlowBatch] Asset discovery:', JSON.stringify(discovery).substring(0, 500));
        return;
      }
      
      let downloaded = 0;
      
      for (let i = 0; i < toDownload.length; i++) {
        const asset = toDownload[i];
        const src = asset.src || asset.querySelector?.('source')?.src || '';
        
        console.log(`[FlowBatch] Ассет ${i + 1}/${toDownload.length}: ${src.substring(0, 80)}`);
        
        // Стратегия 1: UI (кнопки download / more_vert)
        const uiSuccess = await tryDownloadViaUI(asset, resolution);
        if (uiSuccess) {
          downloaded++;
          await FB.sleep(2000);
          continue;
        }
        
        // Стратегия 2: Fetch через page context (с авторизацией)
        if (src && src.startsWith('http')) {
          const fetchSuccess = await downloadViaFetch(src, i + 1);
          if (fetchSuccess) {
            downloaded++;
            await FB.sleep(1000);
            continue;
          }
        }
        
        // Стратегия 3: Прямое скачивание по src
        if (src && (src.startsWith('http') || src.startsWith('blob:'))) {
          downloadViaSrc(src, i + 1);
          downloaded++;
          await FB.sleep(500);
          continue;
        }
        
        console.warn(`[FlowBatch] ❌ Не удалось скачать ассет ${i + 1}`);
        FB.notifyPanel({ type: 'LOG', text: `❌ Не удалось скачать ассет ${i + 1}`, level: 'error' });
      }
      
      console.log(`[FlowBatch] === Скачивание завершено: ${downloaded}/${toDownload.length} ===`);
      FB.notifyPanel({ type: 'LOG', text: `Скачано: ${downloaded}/${toDownload.length}`, level: downloaded > 0 ? 'success' : 'warning' });
      
    } catch (error) {
      console.error('[FlowBatch] Ошибка скачивания:', error.message);
      FB.notifyPanel({ type: 'LOG', text: `Ошибка скачивания: ${error.message}`, level: 'error' });
    }
  };

  /**
   * Диагностика DOM ассетов — для отладки из панели
   */
  FB.discoverAssets = async () => {
    const result = await FB.requestPageContext('flowbatch-discover-assets-request', {}, 10000);
    return result;
  };
})();
