/**
 * FlowBatch — Адаптивные DOM-селекторы для Google Flow
 * v0.4 — Добавлены: getPageError, findAspectRatioOption
 */

const FlowSelectors = (() => {

  // ─── DOM helpers (без изменений) ──────────────────────

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

  const MATERIAL_ICON_PATTERN = /\b(arrow_forward|arrow_back|add|more_vert|more_horiz|search|filter_list|play_movies|settings_2|swap_horiz|crop_16_9|crop_portrait|crop_square|dashboard|check|close|edit|delete|download|upload|share|content_copy|undo|redo|visibility|visibility_off|expand_more|expand_less|chevron_left|chevron_right|info|warning|error|help|star|favorite|thumb_up|thumb_down|refresh|sync|loop|shuffle|skip_next|skip_previous|fast_forward|fast_rewind|pause|stop|fiber_manual_record|radio_button_unchecked|radio_button_checked|check_box|check_box_outline_blank|indeterminate_check_box|crop_3_2|crop_7_5|crop_din|crop_free|crop_landscape|crop_original|crop_rotate|aspect_ratio)\b/gi;

  function cleanButtonText(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('[class*="material"], .mat-icon, [class*="icon"], [aria-hidden="true"]').forEach(ic => ic.remove());
    let text = clone.textContent.trim();
    text = text.replace(MATERIAL_ICON_PATTERN, '').trim();
    text = text.replace(/\s{2,}/g, ' ').trim();
    return text;
  }

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

  function parseFormatButton(btn) {
    if (!btn) return null;
    const text = btn.textContent.trim();
    const match = text.match(/(Video|Image)\s*(?:crop_[\w]*\s*)?([\d]+[_:][\d]+)\s*x\s*(\d+)/i);
    if (match) {
      return {
        type: match[1],
        aspect: match[2].replace('_', ':'),
        count: parseInt(match[3]),
      };
    }
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

    deepQuery,
    deepQueryAll,
    cleanButtonText,
    findButtonByCleanText,
    findByText,
    parseFormatButton,

    getPromptInput() {
      let el = deepQuery('[contenteditable="true"][role="textbox"]');
      if (el) return el;
      el = deepQuery('[contenteditable="true"]');
      if (el) return el;
      const textareas = deepQueryAll('textarea');
      const filtered = textareas.filter(t => !t.name?.includes('recaptcha'));
      if (filtered.length === 1) return filtered[0];
      if (filtered.length > 1) {
        return filtered.reduce((a, b) => (b.offsetHeight > a.offsetHeight ? b : a));
      }
      return null;
    },

    getGenerateButton() {
      let el = deepQuery('button[aria-label*="Create" i], button[aria-label*="Generate" i]');
      if (el) return el;
      el = findButtonByCleanText(['Create'], true);
      if (el) return el;
      el = findByText('button', ['create']);
      if (el) return el;
      el = findButtonByCleanText(['Generate', 'Submit', 'Send']);
      if (el) return el;
      return null;
    },

    getUltraButton() {
      let el = findButtonByCleanText(['ULTRA'], true);
      if (el) return el;
      el = deepQuery('button[aria-label*="Ultra" i], button[aria-label*="quality" i]');
      if (el) return el;
      return null;
    },

    isUltraActive() {
      const btn = this.getUltraButton();
      if (!btn) return false;
      return (
        btn.getAttribute('aria-pressed') === 'true' ||
        btn.getAttribute('aria-selected') === 'true' ||
        btn.classList.toString().toLowerCase().includes('active') ||
        btn.classList.toString().toLowerCase().includes('selected') ||
        btn.classList.toString().toLowerCase().includes('toggled')
      );
    },

    getFormatButton() {
      const buttons = deepQueryAll('button, [role="button"]');
      for (const btn of buttons) {
        const text = btn.textContent.trim();
        if (/(Video|Image)\s*(?:crop[\w_]*\s*)?[\d]+[_:][\d]+\s*x\s*\d+/i.test(text)) {
          return btn;
        }
      }
      return null;
    },

    getCurrentFormat() {
      return parseFormatButton(this.getFormatButton());
    },

    /**
     * НОВОЕ v0.4: Найти кнопку aspect ratio в открытой панели формата
     * Ищет по тексту "16:9", "9:16", "1:1" и иконкам crop_
     */
    findAspectRatioOption(targetAspect) {
      // targetAspect: "16:9", "9:16", "1:1"
      const normalized = targetAspect.replace(':', '_'); // "16_9"
      const allClickable = deepQueryAll('button, [role="button"], [role="tab"], [role="radio"], [role="menuitem"], [role="option"], [role="menuitemradio"]');
      
      for (const el of allClickable) {
        if (el.offsetParent === null) continue; // Пропускаем невидимые
        const text = el.textContent.trim();
        // Проверяем: "16:9", "16_9", "crop_16_9", aria-label
        if (text.includes(targetAspect) || text.includes(normalized) || text.includes(`crop_${normalized}`)) {
          return el;
        }
        const ariaLabel = el.getAttribute('aria-label') || '';
        if (ariaLabel.includes(targetAspect) || ariaLabel.includes(normalized)) {
          return el;
        }
      }
      return null;
    },

    getAddMediaButton() {
      let el = findButtonByCleanText(['Add Media']);
      if (el) return el;
      el = deepQuery('button[aria-label*="Add Media" i], button[aria-label*="Upload" i]');
      return el || null;
    },

    getScenebuilderButton() {
      return findButtonByCleanText(['Scenebuilder']);
    },

    getGoBackButton() {
      return findButtonByCleanText(['Go Back']);
    },

    getSortFilterButton() {
      return findButtonByCleanText(['Sort & Filter', 'Sort']);
    },

    getDashboardButton() {
      return findButtonByCleanText(['View full dashboard', 'dashboard']);
    },

    getSwapFramesButton() {
      return findButtonByCleanText(['Swap first and last frames', 'Swap']);
    },

    getMoreOptionsButton(contextElement) {
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
      return null;
    },

    getTileGridSettingsButton() {
      return findButtonByCleanText(['View Tile Grid Settings', 'Tile Grid']);
    },

    dismissModals() {
      const dismissTexts = ['OK, got it', 'Got it', 'Dismiss', 'Close', 'OK'];
      const btn = findButtonByCleanText(dismissTexts, true);
      if (btn && btn.offsetParent !== null) {
        btn.click();
        console.log('[FlowBatch] Закрыто модальное окно');
        return true;
      }
      return false;
    },

    hasModal() {
      const modalSelectors = ['[role="dialog"]', '[role="alertdialog"]', '[aria-modal="true"]'];
      for (const sel of modalSelectors) {
        const modal = deepQuery(sel);
        if (modal && modal.offsetParent !== null) return true;
      }
      const btn = findButtonByCleanText(['OK, got it'], true);
      return !!(btn && btn.offsetParent !== null);
    },

    // ─── НОВОЕ v0.4: Обнаружение ошибок на странице ──────

    /**
     * Проверяет наличие сообщений об ошибке на странице Flow.
     * Возвращает текст ошибки или null.
     */
    getPageError() {
      // Ищем известные тексты ошибок
      const errorTexts = [
        'Prompt must be provided',
        'Something went wrong',
        'An error occurred',
        'Rate limit exceeded',
        'Too many requests',
        'Service unavailable',
        'Failed to generate',
        'Generation failed',
      ];

      // Ищем в элементах с ролью alert или с классами error/warning
      const errorContainers = deepQueryAll(
        '[role="alert"], [role="status"], [class*="error"], [class*="snackbar"], [class*="toast"], [class*="notification"], [class*="banner"]'
      );

      for (const container of errorContainers) {
        if (container.offsetParent === null) continue; // невидимый
        const text = container.textContent.trim();
        for (const errText of errorTexts) {
          if (text.includes(errText)) {
            return errText;
          }
        }
      }

      // Fallback: ищем в body по тексту (осторожно — только среди видимых элементов малого размера)
      const allElements = deepQueryAll('div, span, p');
      for (const el of allElements) {
        if (el.offsetParent === null) continue;
        if (el.children.length > 3) continue; // пропускаем контейнеры
        const text = el.textContent.trim();
        if (text.length > 200) continue; // слишком длинный текст — не ошибка
        for (const errText of errorTexts) {
          if (text.includes(errText)) {
            return errText;
          }
        }
      }

      return null;
    },

    // ─── Для скачивания ──────────────────────────────────

    getGeneratedAssets() {
      const images = deepQueryAll('img').filter(img => {
        const src = img.src || '';
        if (!src) return false;
        if (img.naturalWidth > 0 && img.naturalWidth < 100) return false;
        if (img.width > 0 && img.width < 100) return false;
        return (
          src.includes('googleusercontent') ||
          src.includes('blob:') ||
          src.includes('generated') ||
          src.includes('lh3.') ||
          src.includes('lh4.') ||
          src.includes('lh5.') ||
          (img.naturalWidth >= 256 || img.width >= 256)
        );
      });
      const videos = deepQueryAll('video');
      return { images, videos };
    },

    getDownloadButton(assetElement) {
      return this.getMoreOptionsButton(assetElement);
    },

    getDownloadMenuOption() {
      return findByText('[role="menuitem"], [role="option"], li, button', ['download', 'скачать']);
    },

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

    getLoadingIndicator() {
      let el = deepQuery('[role="progressbar"], [aria-busy="true"]');
      if (el) return el;
      el = deepQuery('.mat-progress-bar, .mat-spinner, [class*="progress"], [class*="spinner"], [class*="loading"]');
      if (el && el.offsetParent !== null) return el;
      return null;
    },

    isGenerating() {
      if (this.getLoadingIndicator()) return true;
      const genBtn = this.getGenerateButton();
      if (genBtn) {
        if (genBtn.disabled) return true;
        if (genBtn.getAttribute('aria-disabled') === 'true') return true;
        const classes = genBtn.classList.toString().toLowerCase();
        if (classes.includes('disabled') || classes.includes('loading')) return true;
      }
      if (document.querySelector('[aria-busy="true"]')) return true;
      return false;
    },

    // ─── Расширенная диагностика ─────────────────────────

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

    discoverDOM() {
      const contentEditables = deepQueryAll('[contenteditable="true"]');
      const textareas = deepQueryAll('textarea');
      const buttons = deepQueryAll('button');
      const tabs = deepQueryAll('[role="tab"]');
      const radios = deepQueryAll('[role="radio"]');
      const textboxes = deepQueryAll('[role="textbox"]');
      const shadowRoots = this.countShadowRoots();

      const buttonTexts = [];
      for (const btn of buttons) {
        if (buttonTexts.length >= 40) break;
        const raw = btn.textContent.trim().substring(0, 80);
        const clean = cleanButtonText(btn).substring(0, 60);
        if (raw) {
          buttonTexts.push({ raw, clean, ariaLabel: btn.getAttribute('aria-label') || '' });
        }
      }

      const contentEditableDetails = contentEditables.map(el => ({
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role') || '',
        ariaLabel: el.getAttribute('aria-label') || '',
        placeholder: el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || '',
        innerText: (el.innerText || '').substring(0, 80),
        childNodes: el.childNodes.length,
        children: el.children.length,
        firstChildTag: el.firstElementChild?.tagName || 'none',
      }));

      const textareaDetails = textareas.map(el => ({
        ariaLabel: el.getAttribute('aria-label') || '',
        placeholder: el.getAttribute('placeholder') || '',
        name: el.getAttribute('name') || '',
      }));

      const tabTexts = tabs.map(t => t.textContent.trim().substring(0, 40));

      const formatButton = this.getFormatButton();
      const currentFormat = this.getCurrentFormat();
      const ultraButton = this.getUltraButton();
      const ultraActive = this.isUltraActive();
      const hasModal = this.hasModal();
      const pageError = this.getPageError();

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
        pageError,
      };
    },
  };

})();

if (typeof window !== 'undefined') {
  window.FlowSelectors = FlowSelectors;
}
