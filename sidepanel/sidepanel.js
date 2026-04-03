/**
 * FlowBatch — Side Panel Script
 * Управление UI расширения, связь с content script.
 * Side Panel НЕ закрывается при кликах на страницу — идеально для мониторинга очереди.
 */

(() => {
  'use strict';

  // ─── DOM-элементы ─────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const el = {
    connectionStatus: $('#connection-status'),
    statusText: $('#status-text'),
    modeSelect: $('#mode-select'),
    promptsInput: $('#prompts-input'),
    btnUpload: $('#btn-upload'),
    fileInput: $('#file-input'),
    fileInfo: $('#file-info'),
    progressSection: $('#progress-section'),
    progressBar: $('#progress-bar'),
    progressText: $('#progress-text'),
    progressCurrentPrompt: $('#progress-current-prompt'),
    btnStart: $('#btn-start'),
    btnPause: $('#btn-pause'),
    btnResume: $('#btn-resume'),
    btnStop: $('#btn-stop'),
    queueList: $('#queue-list'),
    btnSaveSettings: $('#btn-save-settings'),
    btnDiagnose: $('#btn-diagnose'),
    diagnoseOutput: $('#diagnose-output'),
    logList: $('#log-list'),
    logCounter: $('#log-counter'),
    btnClearLog: $('#btn-clear-log'),
  };

  // ─── Состояние ────────────────────────────────────────
  let activeTabId = null;
  let isConnected = false;
  let logCount = 0;

  // ─── Утилиты ──────────────────────────────────────────

  function log(text, level = 'info') {
    const entry = document.createElement('div');
    entry.className = `log-entry ${level}`;
    const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    entry.textContent = `[${time}] ${text}`;
    el.logList.prepend(entry);
    logCount++;
    el.logCounter.textContent = `${logCount} записей`;
  }

  /**
   * Отправка сообщения в content script активной вкладки
   */
  function sendToContent(message) {
    return new Promise((resolve, reject) => {
      if (!activeTabId) {
        reject(new Error('Нет активной вкладки Flow'));
        return;
      }
      chrome.tabs.sendMessage(activeTabId, message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  }

  function sendToBackground(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, resolve);
    });
  }

  /**
   * Парсинг промптов: разделяем по двойным переносам строк
   */
  function parsePrompts(text) {
    return text
      .split(/\n\s*\n/)
      .map(p => p.trim())
      .filter(p => p.length > 0);
  }

  // ─── Подключение к content script ─────────────────────

  async function checkConnection() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];

      if (!tab || !(
        tab.url?.includes('labs.google/fx/tools/flow') ||
        tab.url?.includes('flow.google')
      )) {
        setConnectionStatus(false, 'Откройте Google Flow для работы');
        return;
      }

      activeTabId = tab.id;

      const response = await sendToContent({ type: 'PING' });
      if (response?.status === 'alive') {
        setConnectionStatus(true,
          response.isRunning
            ? (response.isPaused ? 'На паузе' : 'Генерация идёт...')
            : 'Подключено к Google Flow'
        );

        if (response.isRunning) {
          updateRunningUI(response.isPaused);
        }
      }
    } catch (error) {
      setConnectionStatus(false, 'Content script не найден. Обновите страницу Flow.');
    }
  }

  function setConnectionStatus(connected, text) {
    isConnected = connected;
    el.connectionStatus.className = `status-dot ${connected ? 'connected' : 'disconnected'}`;
    el.statusText.textContent = text;
    el.btnStart.disabled = !connected;
  }

  // ─── UI обновления ────────────────────────────────────

  function renderQueueList(prompts, results = []) {
    el.queueList.innerHTML = '';
    prompts.forEach((prompt, i) => {
      const item = document.createElement('div');
      const result = results[i];
      let statusClass = '';
      let statusIcon = '⏳';

      if (result) {
        statusClass = result.success ? 'done' : 'error';
        statusIcon = result.success ? '✅' : '❌';
      }

      item.className = `queue-item ${statusClass}`;
      item.innerHTML = `
        <span class="index">#${i + 1}</span>
        <span class="prompt-text" title="${prompt}">${prompt}</span>
        <span class="status-icon">${statusIcon}</span>
      `;
      el.queueList.appendChild(item);
    });
  }

  function updateProgress(current, total, currentPrompt = '') {
    el.progressSection.classList.remove('hidden');
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    el.progressBar.style.width = `${pct}%`;
    el.progressText.textContent = `${current} / ${total}`;
    el.progressCurrentPrompt.textContent = currentPrompt;
  }

  function updateRunningUI(isPaused = false) {
    el.btnStart.classList.add('hidden');
    el.btnStop.classList.remove('hidden');

    if (isPaused) {
      el.btnPause.classList.add('hidden');
      el.btnResume.classList.remove('hidden');
    } else {
      el.btnPause.classList.remove('hidden');
      el.btnResume.classList.add('hidden');
    }

    el.connectionStatus.className = 'status-dot running';
  }

  function updateStoppedUI() {
    el.btnStart.classList.remove('hidden');
    el.btnPause.classList.add('hidden');
    el.btnResume.classList.add('hidden');
    el.btnStop.classList.add('hidden');
    el.connectionStatus.className = `status-dot ${isConnected ? 'connected' : 'disconnected'}`;
  }

  // ─── Табы ──────────────────────────────────────────────

  $$('.tab').forEach(tab => {
    tab.addEventListener('click', () => {

      $$('.tab').forEach(t => t.classList.remove('active'));

      $$('.tab-content').forEach(tc => tc.classList.remove('active'));
      tab.classList.add('active');
      $(`#tab-${tab.dataset.tab}`).classList.add('active');
    });
  });

  // ─── Обработчики ──────────────────────────────────────

  // Загрузка .txt
  el.btnUpload.addEventListener('click', () => el.fileInput.click());

  el.fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      el.promptsInput.value = evt.target.result;
      const count = parsePrompts(evt.target.result).length;
      el.fileInfo.textContent = `${file.name} (${count} промптов)`;
      log(`Файл загружен: ${file.name}, ${count} промптов`);
    };
    reader.readAsText(file);
  });

  // Запуск очереди
  el.btnStart.addEventListener('click', async () => {
    const text = el.promptsInput.value.trim();
    if (!text) {
      log('Введите хотя бы один промпт!', 'warning');
      return;
    }

    const prompts = parsePrompts(text);
    if (prompts.length === 0) {
      log('Не удалось распарсить промпты', 'error');
      return;
    }

    const queue = prompts.map(prompt => ({
      prompt,
      type: el.modeSelect.value
    }));

    try {
      await sendToContent({ type: 'SET_SETTINGS', settings: getSettingsFromUI() });
      const result = await sendToContent({ type: 'SET_QUEUE', queue });
      log(`Очередь: ${result.count} промптов`, 'info');

      renderQueueList(prompts);

      await sendToContent({ type: 'START' });
      updateRunningUI();
      updateProgress(0, prompts.length);
      log('Генерация запущена!', 'success');
    } catch (error) {
      log(`Ошибка: ${error.message}`, 'error');
    }
  });

  // Пауза / Продолжить / Стоп
  el.btnPause.addEventListener('click', async () => {
    try {
      await sendToContent({ type: 'PAUSE' });
      updateRunningUI(true);
      log('Пауза', 'warning');
    } catch (e) { log(`Ошибка паузы: ${e.message}`, 'error'); }
  });

  el.btnResume.addEventListener('click', async () => {
    try {
      await sendToContent({ type: 'RESUME' });
      updateRunningUI(false);
      log('Возобновлено', 'info');
    } catch (e) { log(`Ошибка: ${e.message}`, 'error'); }
  });

  el.btnStop.addEventListener('click', async () => {
    try {
      await sendToContent({ type: 'STOP' });
      updateStoppedUI();
      log('Остановлено', 'warning');
    } catch (e) { log(`Ошибка: ${e.message}`, 'error'); }
  });

  // Сохранение настроек
  el.btnSaveSettings.addEventListener('click', async () => {
    const settings = getSettingsFromUI();
    await sendToBackground({ type: 'SAVE_SETTINGS', settings });
    log('Настройки сохранены', 'success');
  });

  // ─── ДИАГНОСТИКА DOM (Discovery Mode) ─────────────────
  el.btnDiagnose.addEventListener('click', async () => {
    el.diagnoseOutput.classList.remove('hidden');
    el.diagnoseOutput.textContent = 'Сканирование DOM...\n';

    try {
      const result = await sendToContent({ type: 'DISCOVER_DOM' });

      let output = '═══ ДИАГНОСТИКА DOM ═══\n\n';

      // Базовые селекторы
      output += '── Основные элементы ──\n';
      output += `Поле промпта:     ${result.promptInput ? '✅ Найдено' : '❌ Не найдено'}\n`;
      output += `Кнопка Generate:  ${result.generateButton ? '✅ Найдено' : '❌ Не найдено'}\n`;
      output += `Селектор модели:  ${result.modelSelector ? '✅ Найдено' : '❌ Не найдено'}\n`;
      output += `Индикатор загрузки: ${result.loadingIndicator ? '✅' : '⚪ Нет'}\n`;
      output += `Генерация идёт:   ${result.isGenerating ? '🔄 Да' : '⚪ Нет'}\n\n`;

      // Найденные интерактивные элементы
      if (result.discovery) {
        const d = result.discovery;

        output += '── Обнаруженные элементы ──\n';
        output += `contenteditable:  ${d.contentEditables || 0} шт.\n`;
        output += `textarea:         ${d.textareas || 0} шт.\n`;
        output += `button:           ${d.buttons || 0} шт.\n`;
        output += `[role="tab"]:     ${d.tabs || 0} шт.\n`;
        output += `[role="radio"]:   ${d.radios || 0} шт.\n`;
        output += `[role="textbox"]: ${d.textboxes || 0} шт.\n`;
        output += `Shadow Roots:     ${d.shadowRoots || 0} шт.\n\n`;

        // Детали кнопок
        if (d.buttonTexts && d.buttonTexts.length > 0) {
          output += '── Тексты кнопок (первые 30) ──\n';
          d.buttonTexts.forEach((t, i) => {
            output += `  ${i + 1}. "${t}"\n`;
          });
          output += '\n';
        }

        // Contenteditable детали
        if (d.contentEditableDetails && d.contentEditableDetails.length > 0) {
          output += '── ContentEditable элементы ──\n';
          d.contentEditableDetails.forEach((item, i) => {
            output += `  ${i + 1}. tag=${item.tag} role="${item.role}" aria-label="${item.ariaLabel}" placeholder="${item.placeholder}"\n`;
          });
          output += '\n';
        }

        // Textarea детали
        if (d.textareaDetails && d.textareaDetails.length > 0) {
          output += '── Textarea элементы ──\n';
          d.textareaDetails.forEach((item, i) => {
            output += `  ${i + 1}. aria-label="${item.ariaLabel}" placeholder="${item.placeholder}" name="${item.name}"\n`;
          });
          output += '\n';
        }

        // Tabs
        if (d.tabTexts && d.tabTexts.length > 0) {
          output += '── Табы [role="tab"] ──\n';
          d.tabTexts.forEach((t, i) => {
            output += `  ${i + 1}. "${t}"\n`;
          });
          output += '\n';
        }

        // Aria-label кнопки
        if (d.ariaButtons && d.ariaButtons.length > 0) {
          output += '── Кнопки с aria-label ──\n';
          d.ariaButtons.forEach((item, i) => {
            output += `  ${i + 1}. [aria-label="${item}"] \n`;
          });
          output += '\n';
        }
      }

      el.diagnoseOutput.textContent = output;
      log('Диагностика DOM выполнена', 'success');
    } catch (error) {
      el.diagnoseOutput.textContent = `ОШИБКА: ${error.message}\n\nУбедитесь, что:\n1. Открыта страница Google Flow\n2. Страница полностью загружена\n3. Попробуйте обновить страницу (F5)`;
      log(`Ошибка диагностики: ${error.message}`, 'error');
    }
  });

  // Очистка лога
  el.btnClearLog.addEventListener('click', () => {
    el.logList.innerHTML = '';
    logCount = 0;
    el.logCounter.textContent = '0 записей';
  });

  // ─── Настройки ─────────────────────────────────────────

  function getSettingsFromUI() {
    return {
      mode: el.modeSelect.value,
      model: $('#setting-model').value,
      videoModel: $('#setting-video-model').value,
      aspectRatio: $('#setting-aspect').value,
      downloadResolution: $('#setting-resolution').value,
      outputCount: parseInt($('#setting-outputs').value),
      delayBetweenPrompts: parseInt($('#setting-delay').value) * 1000,
      maxRetries: parseInt($('#setting-retries').value),
      autoDownload: $('#setting-autodownload').checked
    };
  }

  async function loadSettings() {
    const result = await sendToBackground({ type: 'LOAD_SETTINGS' });
    if (result?.settings) {
      const s = result.settings;
      if (s.mode) el.modeSelect.value = s.mode;
      if (s.model) $('#setting-model').value = s.model;
      if (s.videoModel) $('#setting-video-model').value = s.videoModel;
      if (s.aspectRatio) $('#setting-aspect').value = s.aspectRatio;
      if (s.downloadResolution) $('#setting-resolution').value = s.downloadResolution;
      if (s.outputCount) $('#setting-outputs').value = s.outputCount;
      if (s.delayBetweenPrompts) $('#setting-delay').value = s.delayBetweenPrompts / 1000;
      if (s.maxRetries) $('#setting-retries').value = s.maxRetries;
      if (s.autoDownload !== undefined) $('#setting-autodownload').checked = s.autoDownload;
    }
  }

  // ─── Сообщения от content script ──────────────────────
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (message.source !== 'content') return;

    switch (message.type) {
      case 'STATUS_UPDATE':
        if (message.status === 'running') {
          updateRunningUI();
          updateProgress(message.current, message.total, message.currentPrompt);
          setConnectionStatus(true, `Генерация: ${message.current}/${message.total}`);
        } else if (message.status === 'completed') {
          updateStoppedUI();
          setConnectionStatus(true, 'Очередь завершена!');
          log('Все промпты обработаны!', 'success');
        } else if (message.status === 'stopped') {
          updateStoppedUI();
          setConnectionStatus(true, 'Остановлено');
        } else if (message.status === 'paused') {
          updateRunningUI(true);
          setConnectionStatus(true, 'На паузе');
        }
        break;

      case 'PROMPT_COMPLETE':
        if (message.result?.success) {
          log(`✅ #${message.index + 1}: "${message.result.prompt?.substring(0, 60)}..."`, 'success');
        } else {
          log(`❌ #${message.index + 1}: ${message.result?.error || 'Неизвестная ошибка'}`, 'error');
        }
        break;

      case 'NEW_ASSETS':
        log(`Новые ассеты: ${message.count} шт.`, 'info');
        break;

      case 'LOG':
        log(message.text, message.level || 'info');
        break;
    }
  });

  // ─── Инициализация ─────────────────────────────────────
  loadSettings();
  checkConnection();

  // Проверяем подключение каждые 3 секунды
  setInterval(checkConnection, 3000);

  log('Side Panel загружен', 'info');
})();
