/**
 * FlowBatch — Логика скачивания сгенерированных ассетов
 */
(() => {
  'use strict';
  const FB = window.FB;
  if (!FB) return;

  FB.triggerDownload = async (resolution = '4K') => {
    try {
      const assets = FlowSelectors.getGeneratedAssets();
      const all = [...assets.images, ...assets.videos];

      if (all.length === 0) {
        // Fallback: перехваченные fetch-URL за последние 60с
        const recent = FB.state.interceptedUrls.filter(u => Date.now() - u.timestamp < 60000);
        if (recent.length > 0) {
          const url = recent[recent.length - 1].url;
          console.log('[FlowBatch] Скачивание через перехваченный URL:', url.substring(0, 80));
          chrome.runtime.sendMessage({ type: 'DOWNLOAD_FILE', url, filename: `flowbatch_${Date.now()}.png` });
          FB.notifyPanel({ type: 'LOG', text: 'Скачивание через перехваченный URL', level: 'info' });
          return;
        }
        console.warn('[FlowBatch] Нет ассетов для скачивания');
        FB.notifyPanel({ type: 'LOG', text: 'Нет ассетов для скачивания', level: 'warning' });
        return;
      }

      const count = Math.min(FB.state.settings.outputCount, all.length);
      const toDownload = all.slice(-count);

      for (const asset of toDownload) {
        const moreBtn = FlowSelectors.getMoreOptionsButton(asset);
        if (moreBtn) {
          await FB.clickElement(moreBtn);
          await FB.sleep(600);

          try {
            const dlOption = await FB.waitForElement(() => FlowSelectors.getDownloadMenuOption(), 5000);
            await FB.clickElement(dlOption);
            await FB.sleep(600);

            try {
              const resOpt = await FB.waitForElement(() => FlowSelectors.getResolutionOption(resolution), 3000);
              if (resOpt) {
                await FB.clickElement(resOpt);
                console.log(`[FlowBatch] Скачивание: ${resolution}`);
                FB.notifyPanel({ type: 'LOG', text: `Скачивание (${resolution})`, level: 'success' });
              }
            } catch (_) {
              console.log('[FlowBatch] Скачивание запущено (без выбора разрешения)');
              FB.notifyPanel({ type: 'LOG', text: 'Скачивание запущено', level: 'success' });
            }
          } catch (_) {
            console.warn('[FlowBatch] Опция Download не найдена в меню');
            FB.notifyPanel({ type: 'LOG', text: 'Опция Download не найдена', level: 'warning' });
          }
          await FB.sleep(500);

        } else {
          // Fallback: скачивание по src
          const src = asset.src || asset.querySelector?.('source')?.src;
          if (src && (src.startsWith('http') || src.startsWith('blob:'))) {
            const ext = asset.tagName === 'VIDEO' ? 'mp4' : 'png';
            chrome.runtime.sendMessage({
              type: 'DOWNLOAD_FILE', url: src, filename: `flowbatch_${Date.now()}.${ext}`
            });
            console.log('[FlowBatch] Скачивание по src:', src.substring(0, 80));
            FB.notifyPanel({ type: 'LOG', text: 'Скачивание по прямому URL', level: 'info' });
          } else {
            console.warn('[FlowBatch] Невозможно скачать ассет');
            FB.notifyPanel({ type: 'LOG', text: 'Невозможно скачать ассет', level: 'warning' });
          }
        }
      }
    } catch (error) {
      console.error('[FlowBatch] Ошибка скачивания:', error.message);
      FB.notifyPanel({ type: 'LOG', text: `Ошибка скачивания: ${error.message}`, level: 'error' });
    }
  };
})();
