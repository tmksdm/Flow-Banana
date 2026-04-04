/**
 * FlowBatch — DOM-селекторы v0.11
 */
const FlowSelectors = (() => {

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

  const MATERIAL_ICON_PATTERN = /\b(arrow_forward|arrow_back|add|add_2|more_vert|more_horiz|search|filter_list|play_movies|settings_2|swap_horiz|crop_16_9|crop_portrait|crop_square|dashboard|check|close|edit|delete|download|upload|share|content_copy|undo|redo|visibility|visibility_off|expand_more|expand_less|chevron_left|chevron_right|info|warning|error|help|star|favorite|thumb_up|thumb_down|refresh|sync|loop|shuffle|pause|stop|radio_button_unchecked|radio_button_checked|check_box|check_box_outline_blank|aspect_ratio|image|videocam|photo|movie|photo_camera|photo_library|video_library|collections|perm_media|insert_photo|auto_awesome|brush|palette|tune|auto_fix_high|grid_view|arrow_drop_down|arrow_drop_up|menu|apps)\b/gi;

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
      if (btn.offsetParent === null) continue;
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
    const match = text.match(/(Video|Image)\s*(?:crop[\w_]*\s*)?([\d]+[_:][\d]+)\s*x\s*(\d+)/i);
    if (match) {
      return { type: match[1], aspect: match[2].replace('_', ':'), count: parseInt(match[3]) };
    }
    const matchLoose = text.match(/(Video|Image).*?(\d+:\d+|\d+_\d+).*?x(\d+)/i);
    if (matchLoose) {
      return { type: matchLoose[1], aspect: matchLoose[2].replace('_', ':'), count: parseInt(matchLoose[3]) };
    }
    return null;
  }

  function findTypeTab(targetType) {
    const target = targetType.toLowerCase();
    const tabs = deepQueryAll('[role="tab"]');
    for (const tab of tabs) {
      if (tab.offsetParent === null) continue;
      const cleanText = cleanButtonText(tab).toLowerCase();
      if (cleanText === target) return tab;
    }
    for (const tab of tabs) {
      if (tab.offsetParent === null) continue;
      const text = tab.textContent.trim().toLowerCase();
      if (text.includes(target) && !text.includes('crop')) return tab;
    }
    const allBtns = deepQueryAll('button, [role="button"], [role="tab"]');
    for (const btn of allBtns) {
      if (btn.offsetParent === null) continue;
      const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
      if (ariaLabel === target || ariaLabel.includes(target + ' mode') || ariaLabel.includes('switch to ' + target)) return btn;
    }
    console.warn(`[FlowBatch] findTypeTab: кнопка "${targetType}" НЕ найдена`);
    return null;
  }

  return {
    deepQuery,
    deepQueryAll,
    cleanButtonText,
    findButtonByCleanText,
    findByText,
    parseFormatButton,
    findTypeTab,

    getPromptInput() {
      let el = deepQuery('[contenteditable="true"][role="textbox"]');
      if (el) return el;
      el = deepQuery('[data-slate-editor="true"]');
      if (el) return el;
      el = deepQuery('[contenteditable="true"]');
      if (el) return el;
      const textareas = deepQueryAll('textarea').filter(t => !t.name?.includes('recaptcha'));
      if (textareas.length === 1) return textareas[0];
      if (textareas.length > 1) return textareas.reduce((a, b) => (b.offsetHeight > a.offsetHeight ? b : a));
      return null;
    },

    /**
     * Кнопка генерации — "arrow_forwardCreate"
     * ВАЖНО: НЕ путать с "add_2Create" (кнопка добавления)
     */
    getGenerateButton() {
      const buttons = deepQueryAll('button, [role="button"]');
      // Приоритет: кнопка с arrow_forward + Create
      for (const btn of buttons) {
        if (btn.offsetParent === null) continue;
        const raw = btn.textContent.trim();
        if (raw.includes('arrow_forward') && /create/i.test(raw)) return btn;
      }
      // Fallback: aria-label
      let el = deepQuery('button[aria-label*="Create" i], button[aria-label*="Generate" i]');
      if (el) return el;
      // Fallback: Create без add/add_2
      for (const btn of buttons) {
        if (btn.offsetParent === null) continue;
        const raw = btn.textContent.trim();
        if (/create/i.test(raw) && !raw.includes('add_2') && !raw.includes('add')) return btn;
      }
      return null;
    },

    getUltraButton() {
      let el = findButtonByCleanText(['ULTRA'], true);
      if (el) return el;
      el = deepQuery('button[aria-label*="Ultra" i], button[aria-label*="quality" i]');
      return el || null;
    },

    isUltraActive() {
      const btn = this.getUltraButton();
      if (!btn) return false;
      return (
        btn.getAttribute('aria-pressed') === 'true' ||
        btn.getAttribute('aria-selected') === 'true' ||
        btn.classList.toString().toLowerCase().includes('active') ||
        btn.classList.toString().toLowerCase().includes('selected')
      );
    },

    getFormatButton() {
      const buttons = deepQueryAll('button, [role="button"]');
      for (const btn of buttons) {
        if (btn.offsetParent === null) continue;
        const text = btn.textContent.trim();
        if (/(Video|Image)\s*(?:crop[\w_]*\s*)?[\d]+[_:][\d]+\s*x\s*\d+/i.test(text)) return btn;
      }
      return null;
    },

    getCurrentFormat() {
      return parseFormatButton(this.getFormatButton());
    },

    findAspectRatioOption(targetAspect) {
      const normalized = targetAspect.replace(':', '_');
      const allClickable = deepQueryAll('button, [role="button"], [role="tab"], [role="radio"], [role="menuitem"], [role="option"], [role="menuitemradio"]');
      for (const el of allClickable) {
        if (el.offsetParent === null) continue;
        const text = el.textContent.trim();
        const cleanText = cleanButtonText(el).toLowerCase();
        if (cleanText.includes(targetAspect) || cleanText.includes(normalized)) return el;
        if (text.includes(targetAspect) || text.includes(normalized) || text.includes(`crop_${normalized}`)) return el;
        const ariaLabel = el.getAttribute('aria-label') || '';
        if (ariaLabel.includes(targetAspect) || ariaLabel.includes(normalized)) return el;
      }
      return null;
    },

    getAddMediaButton() {
      let el = findButtonByCleanText(['Add Media']);
      if (el) return el;
      el = deepQuery('button[aria-label*="Add Media" i], button[aria-label*="Upload" i]');
      return el || null;
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
            if (clean.includes('more') || btn.getAttribute('aria-label')?.toLowerCase().includes('more')) return btn;
          }
        }
      }
      return null;
    },

    dismissModals() {
      const btn = findButtonByCleanText(['OK, got it', 'Got it', 'Dismiss', 'Close', 'OK'], true);
      if (btn && btn.offsetParent !== null) {
        btn.click();
        console.log('[FlowBatch] Закрыто модальное окно');
        return true;
      }
      return false;
    },

    hasModal() {
      for (const sel of ['[role="dialog"]', '[role="alertdialog"]', '[aria-modal="true"]']) {
        const modal = deepQuery(sel);
        if (modal && modal.offsetParent !== null) return true;
      }
      const btn = findButtonByCleanText(['OK, got it'], true);
      return !!(btn && btn.offsetParent !== null);
    },

    getPageError() {
      const errorTexts = [
        'Prompt must be provided', 'Something went wrong', 'An error occurred',
        'Rate limit exceeded', 'Too many requests', 'Service unavailable',
        'Failed to generate', 'Generation failed',
      ];
      const containers = deepQueryAll('[role="alert"], [role="status"], [class*="error"], [class*="snackbar"], [class*="toast"]');
      for (const container of containers) {
        if (container.offsetParent === null) continue;
        const text = container.textContent.trim();
        for (const errText of errorTexts) {
          if (text.includes(errText)) return errText;
        }
      }
      return null;
    },

    getGeneratedAssets() {
      const images = deepQueryAll('img').filter(img => {
        const src = img.src || '';
        if (!src) return false;
        if (img.naturalWidth > 0 && img.naturalWidth < 100) return false;
        if (img.width > 0 && img.width < 100) return false;
        return (
          src.includes('googleusercontent') || src.includes('blob:') ||
          src.includes('generated') || src.includes('lh3.') ||
          src.includes('lh4.') || src.includes('lh5.') ||
          (img.naturalWidth >= 256 || img.width >= 256)
        );
      });
      const videos = deepQueryAll('video');
      return { images, videos };
    },

    getDownloadMenuOption() {
      return findByText('[role="menuitem"], [role="option"], li, button', ['download', 'скачать']);
    },

    getResolutionOption(resolution = '4K') {
      const options = deepQueryAll('[role="menuitem"], [role="option"], [role="menuitemradio"], [role="radio"], button, li');
      for (const opt of options) {
        const text = opt.textContent.trim();
        if (text.includes(resolution) || text.includes(resolution.toLowerCase())) return opt;
      }
      return null;
    },

    getLoadingIndicator() {
      let el = deepQuery('[role="progressbar"], [aria-busy="true"]');
      if (el) return el;
      el = deepQuery('[class*="progress"], [class*="spinner"], [class*="loading"]');
      if (el && el.offsetParent !== null) return el;
      return null;
    },

    isGenerating() {
      if (this.getLoadingIndicator()) return true;
      const genBtn = this.getGenerateButton();
      if (genBtn) {
        if (genBtn.disabled) return true;
        if (genBtn.getAttribute('aria-disabled') === 'true') return true;
      }
      if (document.querySelector('[aria-busy="true"]')) return true;
      return false;
    },

    discoverDOM() {
      const buttons = deepQueryAll('button');
      const tabs = deepQueryAll('[role="tab"]');
      const buttonTexts = [];
      for (const btn of buttons.slice(0, 40)) {
        const raw = btn.textContent.trim().substring(0, 80);
        const clean = cleanButtonText(btn).substring(0, 60);
        if (raw) buttonTexts.push({ raw, clean, ariaLabel: btn.getAttribute('aria-label') || '' });
      }
      return {
        contentEditables: deepQueryAll('[contenteditable="true"]').length,
        textareas: deepQueryAll('textarea').length,
        buttons: buttons.length,
        tabs: tabs.length,
        textboxes: deepQueryAll('[role="textbox"]').length,
        buttonTexts,
        formatButton: this.getFormatButton()?.textContent.trim().substring(0, 80) || null,
        currentFormat: this.getCurrentFormat(),
        ultraButton: !!this.getUltraButton(),
        ultraActive: this.isUltraActive(),
        hasModal: this.hasModal(),
        pageError: this.getPageError(),
      };
    },
  };
})();

if (typeof window !== 'undefined') window.FlowSelectors = FlowSelectors;
