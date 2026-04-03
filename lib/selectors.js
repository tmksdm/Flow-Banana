/**
 * FlowBatch — Модуль обнаружения DOM-элементов Google Flow
 * 
 * Google Flow использует обфусцированные CSS-классы, которые меняются при обновлениях.
 * Поэтому мы ищем элементы по:
 *   1. aria-атрибутам
 *   2. data-атрибутам
 *   3. структурным паттернам (роль + положение в DOM)
 *   4. текстовому содержимому
 * 
 * Каждый селектор — это функция, возвращающая элемент или null.
 * Это обеспечивает устойчивость к обновлениям интерфейса Flow.
 */

const FlowSelectors = {
  /**
   * Поле ввода промпта. 
   * Flow использует contenteditable div или textarea для промптов.
   */
  getPromptInput() {
    // Стратегия 1: contenteditable элемент в зоне промпта
    const contentEditable = document.querySelector(
      '[contenteditable="true"][role="textbox"]'
    );
    if (contentEditable) return contentEditable;

    // Стратегия 2: textarea
    const textarea = document.querySelector(
      'textarea[aria-label*="prompt" i], textarea[aria-label*="Prompt" i], textarea[placeholder*="Describe" i]'
    );
    if (textarea) return textarea;

    // Стратегия 3: любой contenteditable в зоне ввода
    const anyEditable = document.querySelector('[contenteditable="true"]');
    if (anyEditable) return anyEditable;

    // Стратегия 4: input с подходящим placeholder  
    const input = document.querySelector(
      'input[placeholder*="descri" i], input[placeholder*="prompt" i]'
    );
    return input || null;
  },

  /**
   * Кнопка "Generate" (запуск генерации)
   */
  getGenerateButton() {
    // Стратегия 1: aria-label
    const ariaBtn = document.querySelector(
      'button[aria-label*="Generate" i], button[aria-label*="Submit" i], button[aria-label*="Send" i]'
    );
    if (ariaBtn) return ariaBtn;

    // Стратегия 2: текстовое содержимое кнопки
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const text = btn.textContent.trim().toLowerCase();
      if (text === 'generate' || text.includes('generate')) {
        return btn;
      }
    }

    // Стратегия 3: иконка отправки (SVG send icon рядом с input)
    const sendIcon = document.querySelector(
      'button[data-testid*="send" i], button[data-testid*="generate" i]'
    );
    return sendIcon || null;
  },

  /**
   * Селектор модели (Nano Banana Pro / Veo 3.1 и т.д.)
   */
  getModelSelector() {
    // Ищем dropdown/button с текстом модели
    const modelNames = [
      'Nano Banana Pro', 'Nano Banana 2', 'Imagen 4',
      'Veo 3.1', 'Veo 3.1 Fast', 'Veo 3.1 Quality', 'Veo 2'
    ];

    const allButtons = document.querySelectorAll('button, [role="button"], [role="listbox"], [role="combobox"]');
    for (const el of allButtons) {
      const text = el.textContent.trim();
      for (const model of modelNames) {
        if (text.includes(model)) {
          return el;
        }
      }
    }
    return null;
  },

  /**
   * Переключатели режима: Image / Video
   */
  getModeToggle(mode = 'Video') {
    // Ищем табы/кнопки Image и Video
    const tabs = document.querySelectorAll('[role="tab"], [role="radio"], button');
    for (const tab of tabs) {
      const text = tab.textContent.trim().toLowerCase();
      if (text === mode.toLowerCase()) {
        return tab;
      }
    }
    return null;
  },

  /**
   * Контейнер результатов генерации (сетка изображений/видео)
   */
  getResultsContainer() {
    // Ищем grid-контейнер с результатами
    const grid = document.querySelector(
      '[role="grid"], [role="list"], [data-testid*="result" i], [data-testid*="output" i]'
    );
    return grid || null;
  },

  /**
   * Все сгенерированные ассеты (изображения / видео) в текущем проекте
   */
  getGeneratedAssets() {
    // Ищем img и video элементы в зоне результатов
    const images = document.querySelectorAll('img[src*="generated"], img[src*="blob:"], img[src*="googleusercontent"]');
    const videos = document.querySelectorAll('video source, video[src]');
    return {
      images: Array.from(images),
      videos: Array.from(videos)
    };
  },

  /**
   * Кнопка скачивания / меню "More" для ассета
   */
  getDownloadButton(assetElement) {
    // Ищем кнопку "more" (три точки) рядом с ассетом
    const parent = assetElement?.closest('[role="listitem"], [role="gridcell"]') || assetElement?.parentElement;
    if (!parent) return null;

    const moreBtn = parent.querySelector(
      'button[aria-label*="More" i], button[aria-label*="Download" i], [aria-label*="menu" i]'
    );
    return moreBtn || null;
  },

  /**
   * Опция "Download" в выпадающем меню
   */
  getDownloadMenuOption() {
    const menuItems = document.querySelectorAll(
      '[role="menuitem"], [role="option"], [role="menuitemradio"]'
    );
    for (const item of menuItems) {
      if (item.textContent.trim().toLowerCase().includes('download')) {
        return item;
      }
    }
    return null;
  },

  /**
   * Селектор разрешения скачивания (1K, 2K, 4K)
   */
  getResolutionOption(resolution = '4K') {
    const options = document.querySelectorAll(
      '[role="menuitem"], [role="option"], [role="menuitemradio"], [role="radio"], button'
    );
    for (const opt of options) {
      const text = opt.textContent.trim();
      if (text.includes(resolution) || text.includes(resolution.toLowerCase())) {
        return opt;
      }
    }
    return null;
  },

  /**
   * Индикатор загрузки / прогресса генерации
   */
  getLoadingIndicator() {
    const spinner = document.querySelector(
      '[role="progressbar"], [aria-busy="true"], [class*="spinner" i], [class*="loading" i]'
    );
    return spinner || null;
  },

  /**
   * Проверяет, идёт ли сейчас генерация
   */
  isGenerating() {
    const loading = this.getLoadingIndicator();
    if (loading) return true;

    // Альтернативная проверка: кнопка Generate отключена
    const genBtn = this.getGenerateButton();
    if (genBtn && (genBtn.disabled || genBtn.getAttribute('aria-disabled') === 'true')) {
      return true;
    }

    return false;
  },

  /**
   * Элемент выбора aspect ratio
   */
  getAspectRatioSelector() {
    const options = document.querySelectorAll('[role="radio"], [role="option"], button');
    const ratios = ['16:9', '9:16', '1:1', '4:3', '3:4'];
    const found = {};
    for (const opt of options) {
      const text = opt.textContent.trim();
      for (const ratio of ratios) {
        if (text.includes(ratio)) {
          found[ratio] = opt;
        }
      }
    }
    return found;
  },

  /**
   * Элемент выбора количества выходов (outputs per prompt)
   */
  getOutputCountSelector() {
    const options = document.querySelectorAll('[role="radio"], [role="option"], button');
    const counts = {};
    for (const opt of options) {
      const text = opt.textContent.trim();
      if (/^[1-4]$/.test(text)) {
        counts[text] = opt;
      }
    }
    return counts;
  }
};

// Экспортируем для content.js
if (typeof window !== 'undefined') {
  window.FlowSelectors = FlowSelectors;
}
