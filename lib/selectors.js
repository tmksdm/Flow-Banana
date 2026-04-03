/**
 * FlowBatch — Адаптивные DOM-селекторы для Google Flow
 *
 * Стратегия поиска (в порядке приоритета):
 *   1. aria-атрибуты
 *   2. role + structural patterns
 *   3. текстовое содержимое
 *   4. fallback через структурный обход
 *
 * Все методы поддерживают Shadow DOM через рекурсивный обход.
 */

const FlowSelectors = (() => {

  // ─── Shadow DOM helpers ───────────────────────────────

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

  // ─── Селекторы ────────────────────────────────────────

  return {
    /**
     * Поле ввода промпта
     */
    getPromptInput() {
      // 1: contenteditable + role="textbox"
      let el = deepQuery('[contenteditable="true"][role="textbox"]');
      if (el) return el;

      // 2: textarea с подходящими атрибутами
      el = deepQuery('textarea[aria-label*="prompt" i], textarea[aria-label*="Prompt" i], textarea[placeholder*="Describe" i], textarea[placeholder*="describe" i]');
      if (el) return el;

      // 3: любой contenteditable
      el = deepQuery('[contenteditable="true"]');
      if (el) return el;

      // 4: textarea (любая)
      const textareas = deepQueryAll('textarea');
      if (textareas.length === 1) return textareas[0];
      // Если несколько — берём самую большую (по offsetHeight)
      if (textareas.length > 1) {
        return textareas.reduce((a, b) => (b.offsetHeight > a.offsetHeight ? b : a));
      }

      // 5: input
      el = deepQuery('input[placeholder*="descri" i], input[placeholder*="prompt" i]');
      return el || null;
    },

    /**
     * Кнопка "Generate"
     */
    getGenerateButton() {
      // 1: aria-label
      let el = deepQuery('button[aria-label*="Generate" i], button[aria-label*="Submit" i], button[aria-label*="Send" i], button[aria-label*="Create" i]');
      if (el) return el;

      // 2: по тексту
      el = findByText('button', ['generate', 'create', 'submit']);
      if (el) return el;

      // 3: data-testid
      el = deepQuery('button[data-testid*="send" i], button[data-testid*="generate" i], button[data-testid*="submit" i]');
      return el || null;
    },

    /**
     * Селектор модели
     */
    getModelSelector() {
      const modelNames = [
        'nano banana pro', 'nano banana 2', 'imagen 4',
        'veo 3.1', 'veo 3.1 fast', 'veo 3.1 quality', 'veo 2'
      ];

      const candidates = deepQueryAll('button, [role="button"], [role="listbox"], [role="combobox"]');
      for (const el of candidates) {
        const text = el.textContent.trim().toLowerCase();
        for (const model of modelNames) {
          if (text.includes(model)) return el;
        }
      }
      return null;
    },

    /**
     * Переключатель режима Image / Video
     */
    getModeToggle(mode = 'Video') {
      return findByText('[role="tab"], [role="radio"], button', [mode]);
    },

    /**
     * Сгенерированные ассеты
     */
    getGeneratedAssets() {
      const images = deepQueryAll('img[src*="generated"], img[src*="blob:"], img[src*="googleusercontent"], img[src*="lh3."]');
      const videos = deepQueryAll('video source, video[src]');
      return {
        images: images.filter(img => {
          const src = img.src || '';
          // Исключаем иконки и мелкие картинки
          return src && img.naturalWidth > 100;
        }),
        videos: Array.from(videos)
      };
    },

    /**
     * Кнопка скачивания для конкретного ассета
     */
    getDownloadButton(assetElement) {
      const parent = assetElement?.closest('[role="listitem"], [role="gridcell"], [role="article"]') || assetElement?.parentElement?.parentElement;
      if (!parent) return null;

      return parent.querySelector('button[aria-label*="More" i], button[aria-label*="Download" i], button[aria-label*="menu" i], button[aria-label*="Action" i]');
    },

    /**
     * Опция "Download" в меню
     */
    getDownloadMenuOption() {
      return findByText('[role="menuitem"], [role="option"], [role="menuitemradio"]', ['download', 'скачать']);
    },

    /**
     * Селектор разрешения
     */
    getResolutionOption(resolution = '4K') {
      const options = deepQueryAll('[role="menuitem"], [role="option"], [role="menuitemradio"], [role="radio"], button');
      for (const opt of options) {
        const text = opt.textContent.trim();
        if (text.includes(resolution) || text.includes(resolution.toLowerCase())) {
          return opt;
        }
      }
      return null;
    },

    /**
     * Индикатор загрузки
     */
    getLoadingIndicator() {
      return deepQuery('[role="progressbar"], [aria-busy="true"]');
    },

    /**
     * Идёт ли генерация
     */
    isGenerating() {
      if (this.getLoadingIndicator()) return true;

      const genBtn = this.getGenerateButton();
      if (genBtn && (genBtn.disabled || genBtn.getAttribute('aria-disabled') === 'true')) {
        return true;
      }

      return false;
    },

    /**
     * Aspect ratio options
     */
    getAspectRatioSelector() {
      const ratios = ['16:9', '9:16', '1:1', '4:3', '3:4'];
      const found = {};
      const options = deepQueryAll('[role="radio"], [role="option"], button');
      for (const opt of options) {
        const text = opt.textContent.trim();
        for (const ratio of ratios) {
          if (text.includes(ratio)) found[ratio] = opt;
        }
      }
      return found;
    },

    /**
     * Output count selector
     */
    getOutputCountSelector() {
      const counts = {};
      const options = deepQueryAll('[role="radio"], [role="option"], button');
      for (const opt of options) {
        const text = opt.textContent.trim();
        if (/^[1-4]$/.test(text)) counts[text] = opt;
      }
      return counts;
    }
  };

})();

// Для content.js
if (typeof window !== 'undefined') {
  window.FlowSelectors = FlowSelectors;
}
