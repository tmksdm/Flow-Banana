/**
 * FlowBatch — Адаптивные DOM-селекторы для Google Flow
 * v0.3 — Калиброваны по реальному DOM (2026-04)
 *
 * Реальная структура Flow:
 *   - Промпт: div[contenteditable="true"][role="textbox"]
 *   - Кнопка генерации: кнопка с текстом "Create" (иконка arrow_forward + "Create")
 *   - Качество: кнопка "ULTRA"
 *   - Формат: комбо-кнопка вида "{Type}{icon}{aspect}x{count}", напр. "Videocrop_16_9x1"
 *   - Добавить медиа: кнопка "Add Media" (иконка add)
 *   - Модальные окна: "OK, got it"
 *   - Material Icons рендерятся как текст внутри элементов (склеиваются с label)
 *
 * Shadow DOM: 0 Shadow Roots обнаружено (не используется).
 */

const FlowSelectors = (() => {

  // ─── DOM helpers ──────────────────────────────────────

  /**
   * Рекурсивный querySelector с обходом Shadow DOM
   */
  function deepQuery(selector, root = document) {
    const result = root.querySelector(selector);
    if (result) return result;
    const all = root.querySelectorAll('*');
    for (const el of all) {
      if (el.shadowRoot) {
        const found = deepQuery(selector, el.shadowRoot);
        if (found) return found;
      }
    }
    return null;
  }

  /**
   * Рекурсивный querySelectorAll с обходом Shadow DOM
   */
  function deepQueryAll(selector, root = document) {
    const results = [...root.querySelectorAll(selector)];
    const all = root.querySelectorAll('*');
    for (const el of all) {
      if (el.shadowRoot) {
        results.push(...deepQueryAll(selector, el.shadowRoot));
      }
    }
    return results;
  }

  /**
   * Получить "чистый" текст кнопки без Material Icons.
   * Material Icons рендерятся как <span> с текстом-идентификатором иконки
   * (arrow_forward, add, play_movies и т.д.).
   * Стратегия: убираем из textContent известные паттерны Material Icon names.
   */
  const MATERIAL_ICON_PATTERN = /\b(arrow_forward|arrow_back|add|more_vert|more_horiz|search|filter_list|play_movies|settings_2|swap_horiz|crop_16_9|crop_portrait|crop_square|dashboard|check|close|edit|delete|download|upload|share|content_copy|undo|redo|visibility|visibility_off|expand_more|expand_less|chevron_left|chevron_right|info|warning|error|help|star|favorite|thumb_up|thumb_down|refresh|sync|loop|shuffle|skip_next|skip_previous|fast_forward|fast_rewind|pause|stop|fiber_manual_record|radio_button_unchecked|radio_button_checked|check_box|check_box_outline_blank|indeterminate_check_box|crop_3_2|crop_7_5|crop_din|crop_free|crop_landscape|crop_original|crop_rotate|aspect_ratio)\b/gi;

  function cleanButtonText(el) {
    // Клонируем, чтобы не модифицировать DOM
    const clone = el.cloneNode(true);
    // Удаляем элементы, которые являются Material Icons (обычно <span> с классом material-icons*)
    clone.querySelectorAll('[class*="material"], .mat-icon, [class*="icon"], [aria-hidden="true"]').forEach(ic => ic.remove());
    let text = clone.textContent.trim();
    // Дополнительно убираем известные icon-имена из текста
    text = text.replace(MATERIAL_ICON_PATTERN, '').trim();
    // Убираем множественные пробелы
    text = text.replace(/\s{2,}/g, ' ').trim();
    return text;
  }

  /**
   * Поиск кнопки по "чистому" тексту (без Material Icons)
   */
  function findButtonByCleanText(textOrTexts, exact = false) {
    const texts = Array.isArray(textOrTexts) ? textOrTexts : [textOrTexts];
    const buttons = deepQueryAll('button, [role="button"]');
    for (const btn of buttons) {
      const clean = cleanButtonText(btn).toLowerCase();
      const raw = btn.textContent.trim().toLowerCase();
      for (const t of texts) {
        const target = t.toLowerCase();
        if (exact) {
          if (clean === target || raw === target) return btn;
        } else {
          if (clean.includes(target) || raw.includes(target)) return btn;
        }
      }
    }
    return null;
  }

  /**
   * Поиск элемента по тексту среди набора элементов
   */
  function findByText(selector, textOrTexts, exact = false) {
    const texts = Array.isArray(textOrTexts) ? textOrTexts : [textOrTexts];
    const elements = deepQueryAll(selector);
    for (const el of elements) {
      const elText = el.textContent.trim().toLowerCase();
      for (const t of texts) {
        if (exact ? elText === t.toLowerCase() : elText.includes(t.toLowerCase())) {
          return el;
        }
      }
    }
    return null;
  }

  /**
   * Парсинг комбо-кнопки формата: "Videocrop_16_9x1" → { type, aspect, count }
   */
  function parseFormatButton(btn) {
    if (!btn) return null;
    const text = btn.textContent.trim();
    // Паттерн: (Video|Image)(crop_icon)(aspect)x(count)
    // Реальный текст: "Videocrop_16_9x1" или "Imagecrop_16_9x2"
    const match = text.match(/(Video|Image)\s*(?:crop_[\w]*\s*)?([\d]+[_:][\d]+)\s*x\s*(\d+)/i);
    if (match) {
      return {
        type: match[1],                                    // "Video" | "Image"
        aspect: match[2].replace('_', ':'),               // "16:9"
        count: parseInt(match[3]),                         // 1
      };
    }
    // Запасной вариант — попытка парсинга менее строгим паттерном
    const matchLoose = text.match(/(Video|Image).*?(\d+:\d+|\d+_\d+).*?x(\d+)/i);
    if (matchLoose) {
      return {
        type: matchLoose[1],
        aspect: matchLoose[2].replace('_', ':'),
        count: parseInt(matchLoose[3]),
      };
    }
    return null;
  }

  // ─── Селекторы ────────────────────────────────────────

  return {

    // Экспортируем хелперы для использования в content.js
    deepQuery,
    deepQueryAll,
    cleanButtonText,
    findButtonByCleanText,
    findByText,
    parseFormatButton,

    /**
     * Поле ввода промпта
     * Реальный DOM: div[contenteditable="true"][role="textbox"]
     */
    getPromptInput() {
      // 1: contenteditable + role="textbox" (основной — подтверждён)
      let el = deepQuery('[contenteditable="true"][role="textbox"]');
      if (el) return el;

      // 2: просто contenteditable
      el = deepQuery('[contenteditable="true"]');
      if (el) return el;

      // 3: textarea (кроме recaptcha)
      const textareas = deepQueryAll('textarea');
      const filtered = textareas.filter(t => !t.name?.includes('recaptcha'));
      if (filtered.length === 1) return filtered[0];
      if (filtered.length > 1) {
        return filtered.reduce((a, b) => (b.offsetHeight > a.offsetHeight ? b : a));
      }

      return null;
    },

    /**
     * Кнопка генерации (Create)
     * Реальный DOM: кнопка с текстом "arrow_forwardCreate" (Material Icon + "Create")
     */
    getGenerateButton() {
      // 1: по aria-label
      let el = deepQuery('button[aria-label*="Create" i], button[aria-label*="Generate" i]');
      if (el) return el;

      // 2: по чистому тексту — ищем "Create"
      el = findButtonByCleanText(['Create'], true);
      if (el) return el;

      // 3: по сырому тексту (включая Material Icons prefix)
      el = findByText('button', ['create']);
      if (el) return el;

      // 4: по тексту Generate / Submit / Send (fallback для других версий)
      el = findButtonByCleanText(['Generate', 'Submit', 'Send']);
      if (el) return el;

      return null;
    },

    /**
     * Кнопка качества "ULTRA"
     * Реальный DOM: кнопка с текстом "ULTRA"
     */
    getUltraButton() {
      // 1: точное совпадение
      let el = findButtonByCleanText(['ULTRA'], true);
      if (el) return el;

      // 2: по aria-label
      el = deepQuery('button[aria-label*="Ultra" i], button[aria-label*="quality" i]');
      if (el) return el;

      return null;
    },

    /**
     * Проверка, активен ли ULTRA-режим
     */
    isUltraActive() {
      const btn = this.getUltraButton();
      if (!btn) return false;
      // Проверяем aria-pressed, aria-selected, class содержащий active/selected
      return (
        btn.getAttribute('aria-pressed') === 'true' ||
        btn.getAttribute('aria-selected') === 'true' ||
        btn.classList.toString().toLowerCase().includes('active') ||
        btn.classList.toString().toLowerCase().includes('selected') ||
        btn.classList.toString().toLowerCase().includes('toggled')
      );
    },

    /**
     * Комбо-кнопка формата: "Videocrop_16_9x1"
     * Содержит тип контента, aspect ratio и количество выходов
     */
    getFormatButton() {
      const buttons = deepQueryAll('button, [role="button"]');
      for (const btn of buttons) {
        const text = btn.textContent.trim();
        // Ищем паттерн Video/Image + aspect + xN
        if (/(Video|Image)\s*(?:crop[\w_]*\s*)?[\d]+[_:][\d]+\s*x\s*\d+/i.test(text)) {
          return btn;
        }
      }
      return null;
    },

    /**
     * Получить текущий формат из комбо-кнопки
     */
    getCurrentFormat() {
      return parseFormatButton(this.getFormatButton());
    },

    /**
     * Кнопка "Add Media" (для Image-to-Video)
     * Реальный DOM: кнопка с текстом "addAdd Media"
     */
    getAddMediaButton() {
      let el = findButtonByCleanText(['Add Media']);
      if (el) return el;

      el = deepQuery('button[aria-label*="Add Media" i], button[aria-label*="Upload" i]');
      return el || null;
    },

    /**
     * Кнопка "Scenebuilder"
     * Реальный DOM: "play_moviesScenebuilder"
     */
    getScenebuilderButton() {
      return findButtonByCleanText(['Scenebuilder']);
    },

    /**
     * Кнопка "Go Back"
     * Реальный DOM: "arrow_backGo Back"
     */
    getGoBackButton() {
      return findButtonByCleanText(['Go Back']);
    },

    /**
     * Кнопка "Sort & Filter"
     */
    getSortFilterButton() {
      return findButtonByCleanText(['Sort & Filter', 'Sort']);
    },

    /**
     * Кнопка "View full dashboard"
     */
    getDashboardButton() {
      return findButtonByCleanText(['View full dashboard', 'dashboard']);
    },

    /**
     * Кнопка "Swap first and last frames"
     */
    getSwapFramesButton() {
      return findButtonByCleanText(['Swap first and last frames', 'Swap']);
    },

    /**
     * Кнопка "More options" (контекстное меню ассета)
     * Реальный DOM: "more_vertMore options" или "more_vertMore"
     */
    getMoreOptionsButton(contextElement) {
      // Если передан контекстный элемент — ищем ближайшую кнопку "More"
      if (contextElement) {
        const parent = contextElement.closest('[role="listitem"], [role="gridcell"], [role="article"]')
          || contextElement.parentElement?.parentElement
          || contextElement.parentElement;
        if (parent) {
          const btns = parent.querySelectorAll('button, [role="button"]');
          for (const btn of btns) {
            const clean = cleanButtonText(btn).toLowerCase();
            if (clean.includes('more') || btn.getAttribute('aria-label')?.toLowerCase().includes('more')) {
              return btn;
            }
          }
        }
      }

      // Глобальный поиск — все кнопки "More" (но осторожно, их может быть много)
      return null;
    },

    /**
     * Кнопка "View Tile Grid Settings"
     */
    getTileGridSettingsButton() {
      return findButtonByCleanText(['View Tile Grid Settings', 'Tile Grid']);
    },

    /**
     * Закрыть модальные окна: "OK, got it" и подобные
     * Возвращает true, если модальное окно было закрыто
     */
    dismissModals() {
      const dismissTexts = ['OK, got it', 'Got it', 'Dismiss', 'Close', 'OK'];
      const btn = findButtonByCleanText(dismissTexts, true);
      if (btn && btn.offsetParent !== null) { // offsetParent !== null = видимый
        btn.click();
        console.log('[FlowBatch] Закрыто модальное окно');
        return true;
      }
      return false;
    },

    /**
     * Проверка наличия модального окна
     */
    hasModal() {
      const modalSelectors = [
        '[role="dialog"]',
        '[role="alertdialog"]',
        '[aria-modal="true"]',
      ];
      for (const sel of modalSelectors) {
        const modal = deepQuery(sel);
        if (modal && modal.offsetParent !== null) return true;
      }
      // Проверяем наличие кнопки "OK, got it" как признак модалки
      const btn = findButtonByCleanText(['OK, got it'], true);
      return !!(btn && btn.offsetParent !== null);
    },

    // ─── Для скачивания ──────────────────────────────────

    /**
     * Сгенерированные ассеты (изображения и видео)
     */
    getGeneratedAssets() {
      const images = deepQueryAll('img').filter(img => {
        const src = img.src || '';
        // Исключаем мелкие иконки, placeholder и UI-элементы
        if (!src) return false;
        if (img.naturalWidth > 0 && img.naturalWidth < 100) return false;
        if (img.width > 0 && img.width < 100) return false;
        // Включаем googleusercontent, blob, generated, lh3
        return (
          src.includes('googleusercontent') ||
          src.includes('blob:') ||
          src.includes('generated') ||
          src.includes('lh3.') ||
          src.includes('lh4.') ||
          src.includes('lh5.') ||
          // Fallback: большие картинки
          (img.naturalWidth >= 256 || img.width >= 256)
        );
      });

      const videos = deepQueryAll('video');

      return { images, videos };
    },

    /**
     * Кнопка скачивания конкретного ассета
     */
    getDownloadButton(assetElement) {
      return this.getMoreOptionsButton(assetElement);
    },

    /**
     * Опция "Download" в выпадающем меню
     */
    getDownloadMenuOption() {
      return findByText('[role="menuitem"], [role="option"], li, button', ['download', 'скачать']);
    },

    /**
     * Селектор разрешения в меню скачивания
     */
    getResolutionOption(resolution = '4K') {
      const options = deepQueryAll('[role="menuitem"], [role="option"], [role="menuitemradio"], [role="radio"], button, li');
      for (const opt of options) {
        const text = opt.textContent.trim();
        if (text.includes(resolution) || text.includes(resolution.toLowerCase())) {
          return opt;
        }
      }
      return null;
    },

    // ─── Статус генерации ────────────────────────────────

    /**
     * Индикатор загрузки / прогрессбар
     */
    getLoadingIndicator() {
      // Стандартные ARIA-индикаторы
      let el = deepQuery('[role="progressbar"], [aria-busy="true"]');
      if (el) return el;

      // Material Design progress indicators
      el = deepQuery('.mat-progress-bar, .mat-spinner, [class*="progress"], [class*="spinner"], [class*="loading"]');
      if (el && el.offsetParent !== null) return el;

      return null;
    },

    /**
     * Идёт ли генерация
     */
    isGenerating() {
      // 1: Есть прогрессбар
      if (this.getLoadingIndicator()) return true;

      // 2: Кнопка Create задизейблена
      const genBtn = this.getGenerateButton();
      if (genBtn) {
        if (genBtn.disabled) return true;
        if (genBtn.getAttribute('aria-disabled') === 'true') return true;
        // Проверяем классы, которые могут указывать на disabled состояние
        const classes = genBtn.classList.toString().toLowerCase();
        if (classes.includes('disabled') || classes.includes('loading')) return true;
      }

      // 3: Есть aria-busy на body или main content area
      if (document.querySelector('[aria-busy="true"]')) return true;

      return false;
    },

    // ─── Расширенная диагностика ─────────────────────────

    /**
     * Подсчёт Shadow Roots
     */
    countShadowRoots(root = document) {
      let count = 0;
      const all = root.querySelectorAll('*');
      for (const el of all) {
        if (el.shadowRoot) {
          count++;
          count += this.countShadowRoots(el.shadowRoot);
        }
      }
      return count;
    },

    /**
     * Полная диагностика DOM для Discovery Mode
     */
    discoverDOM() {
      const contentEditables = deepQueryAll('[contenteditable="true"]');
      const textareas = deepQueryAll('textarea');
      const buttons = deepQueryAll('button');
      const tabs = deepQueryAll('[role="tab"]');
      const radios = deepQueryAll('[role="radio"]');
      const textboxes = deepQueryAll('[role="textbox"]');
      const shadowRoots = this.countShadowRoots();

      // Тексты кнопок (до 40) — и raw и clean
      const buttonTexts = [];
      for (const btn of buttons) {
        if (buttonTexts.length >= 40) break;
        const raw = btn.textContent.trim().substring(0, 80);
        const clean = cleanButtonText(btn).substring(0, 60);
        if (raw) {
          buttonTexts.push({ raw, clean, ariaLabel: btn.getAttribute('aria-label') || '' });
        }
      }

      // ContentEditable
      const contentEditableDetails = contentEditables.map(el => ({
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role') || '',
        ariaLabel: el.getAttribute('aria-label') || '',
        placeholder: el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || '',
      }));

      // Textareas
      const textareaDetails = textareas.map(el => ({
        ariaLabel: el.getAttribute('aria-label') || '',
        placeholder: el.getAttribute('placeholder') || '',
        name: el.getAttribute('name') || '',
      }));

      // Tabs
      const tabTexts = tabs.map(t => t.textContent.trim().substring(0, 40));

      // Формат текущей генерации
      const formatButton = this.getFormatButton();
      const currentFormat = this.getCurrentFormat();

      // ULTRA статус
      const ultraButton = this.getUltraButton();
      const ultraActive = this.isUltraActive();

      // Модальные окна
      const hasModal = this.hasModal();

      return {
        contentEditables: contentEditables.length,
        textareas: textareas.length,
        buttons: buttons.length,
        tabs: tabs.length,
        radios: radios.length,
        textboxes: textboxes.length,
        shadowRoots,
        buttonTexts,
        contentEditableDetails,
        textareaDetails,
        tabTexts,
        formatButton: formatButton ? formatButton.textContent.trim().substring(0, 80) : null,
        currentFormat,
        ultraButton: !!ultraButton,
        ultraActive,
        hasModal,
      };
    },
  };

})();

// Экспорт для content.js
if (typeof window !== 'undefined') {
  window.FlowSelectors = FlowSelectors;
}
