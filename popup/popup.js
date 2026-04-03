/**
 * FlowBatch — Popup Script
 * Управление UI расширения, связь с content script.
 */

(() => {
  'use strict';

  // ─── DOM элементы ─────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const elements = {
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
    btnClearLog: $('#btn-clear-log'),
  };

  // ─── Состояние popup ──────────────────────────────────
  let activeTabId = null;
  let isConnected = false;

  // ─── Утилиты ──────────────────────────────────────────
  
  function log(text, level = 'info') {
    const entry = document.createElement('div');
    entry.className = `log-entry ${level}`;
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
    elements.logList.prepend(entry);
  }

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
      chrome.runtime.sendMessage(message, (response) => {
        resolve(response);
      });
    });
  }

  /**
   * Парсинг промптов: разделяем по двойным переносам строк
   */
  function parsePrompts(text) {
    return text
      .split(/\n\s*\n/)           // Разделяем по пустым строкам
      .map(p => p.trim())          // Убираем лишние пробелы
      .filter(p => p.length > 0);  // Убираем пустые
  }

  // ─── Подключение к content script ─────────────────────

  async function checkConnection() {
    try {
      // Получаем активную вкладку
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];

      if (!tab || !(
        tab.url.includes('labs.google/fx/tools/flow') || 
        tab.url.includes('flow.google')
      )) {
        setConnectionStatus(false, 'Откройте Google Flow для работы');
        return;
      }

      activeTabId = tab.id;

      // Пингуем content script
      const response = await sendToContent({ type: 'PING' });
      if (response && response.status === 'alive') {
        setConnectionStatus(true, 
          response.isRunning ? 'Генерация запущена...' : 'Подключено к Google Flow'
        );
        
        // Восстанавливаем состояние UI если очередь работает
        if (response.isRunning) {
          updateRunningUI(response.isPaused);
        }
      }
    } catch (error) {
      setConnectionStatus(false, 'Content script не загружен. Обновите страницу Flow.');
    }
  }

  function setConnectionStatus(connected, text) {
    isConnected = connected;
    elements.connectionStatus.className = `status-dot ${connected ? 'connected' : 'disconnected'}`;
    elements.statusText.textContent = text;
    elements.btnStart.disabled = !connected;
  }

  // ─── UI обновления ────────────────────────────────────

  function renderQueueList(prompts, results = []) {
    elements.queueList.innerHTML = '';
    prompts.forEach((prompt, i) => {
      const item = document.createElement('div');
      const result = results[i];
      let statusClass = '';
      let statusIcon = '⏳';

      if (result) {
        if (result.success) {
          statusClass = 'done';
          statusIcon = '✅';
        } else {
          statusClass = 'error';
          statusIcon = '❌';
        }
      }

      item.className = `queue-item ${statusClass}`;
      item.innerHTML = `
        <span class="index">#${i + 1}</span>
        <span class="prompt-text" title="${prompt}">${prompt}</span>
        <span class="status-icon">${statusIcon}</span>
      `;
      elements.queueList.appendChild(item);
    });
  }

  function updateProgress(current, total, currentPrompt = '') {
    elements.progressSection.classList.remove('hidden');
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    elements.progressBar.style.width = `${pct}%`;
    elements.progressText.textContent = `${current} / ${total}`;
    elements.progressCurrentPrompt.textContent = currentPrompt;
  }

  function updateRunningUI(isPaused = false) {
    elements.btnStart.classList.add('hidden');
    elements.btnStop.classList.remove('hidden');
    
    if (isPaused) {
      elements.btnPause.classList.add('hidden');
      elements.btnResume.classList.remove('hidden');
    } else {
      elements.btnPause.classList.remove('hidden');
      elements.btnResume.classList.add('hidden');
    }

    elements.connectionStatus.className = 'status-dot running';
  }

  function updateStoppedUI() {
    elements.btnStart.classList.remove('hidden');
    elements.btnPause.classList.add('hidden');
    elements.btnResume.classList.add('hidden');
    elements.btnStop.classList.add('hidden');
    elements.connectionStatus.className = `status-dot ${isConnected ? 'connected' : 'disconnected'}`;
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

  // ─── Обработчики событий ──────────────────────────────

  // Загрузка .txt файла
  elements.btnUpload.addEventListener('click', () => {
    elements.fileInput.click();
  });

  elements.fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      elements.promptsInput.value = event.target.result;
      const count = parsePrompts(event.target.result).length;
      elements.fileInfo.textContent = `${file.name} (${count} промптов)`;
      log(`Файл загружен: ${file.name}, ${count} промптов`);
    };
    reader.readAsText(file);
  });

  // Запуск очереди
  elements.btnStart.addEventListener('click', async () => {
    const text = elements.promptsInput.value.trim();
    if (!text) {
      log('Введите хотя бы один промпт', 'warning');
      return;
    }

    const prompts = parsePrompts(text);
    if (prompts.length === 0) {
      log('Не удалось распарсить промпты', 'error');
      return;
    }

    const queue = prompts.map(prompt => ({
      prompt,
      type: elements.modeSelect.value
    }));

    try {
      // Отправляем настройки
      await sendToContent({ type: 'SET_SETTINGS', settings: getSettingsFromUI() });

      // Отправляем очередь
      const result = await sendToContent({ type: 'SET_QUEUE', queue });
      log(`Очередь создана: ${result.count} промптов`, 'info');

      renderQueueList(prompts);

      // Запускаем
      await sendToContent({ type: 'START' });
      updateRunningUI();
      updateProgress(0, prompts.length);
      log('Генерация запущена!', 'success');

    } catch (error) {
      log(`Ошибка: ${error.message}`, 'error');
    }
  });

  // Пауза
  elements.btnPause.addEventListener('click', async () => {
    try {
      await sendToContent({ type: 'PAUSE' });
      updateRunningUI(true);
      log('Пауза', 'warning');
    } catch (e) {}
  });

  // Продолжить
  elements.btnResume.addEventListener('click', async () => {
    try {
      await sendToContent({ type: 'RESUME' });
      updateRunningUI(false);
      log('Возобновлено', 'info');
    } catch (e) {}
  });

  // Стоп
  elements.btnStop.addEventListener('click', async () => {
    try {
      await sendToContent({ type: 'STOP' });
      updateStoppedUI();
      log('Остановлено', 'warning');
    } catch (e) {}
  });

  // Сохранение настроек
  elements.btnSaveSettings.addEventListener('click', async () => {
    const settings = getSettingsFromUI();
    await sendToBackground({ type: 'SAVE_SETTINGS', settings });
    log('Настройки сохранены', 'success');
  });

  // Диагностика DOM
  elements.btnDiagnose.addEventListener('click', async () => {
    try {
      const result = await sendToContent({ type: 'CHECK_SELECTORS' });
      elements.diagnoseOutput.textContent = JSON.stringify(result, null, 2);
      log('Диагностика выполнена', 'info');
    } catch (error) {
      elements.diagnoseOutput.textContent = `Ошибка: ${error.message}`;
    }
  });

  // Очистка лога
  elements.btnClearLog.addEventListener('click', () => {
    elements.logList.innerHTML = '';
  });

  // ─── Получение настроек из UI ──────────────────────────
  function getSettingsFromUI() {
    return {
      mode: elements.modeSelect.value,
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

  // ─── Загрузка сохранённых настроек ─────────────────────
  async function loadSettings() {
    const result = await sendToBackground({ type: 'LOAD_SETTINGS' });
    if (result && result.settings) {
      const s = result.settings;
      if (s.mode) elements.modeSelect.value = s.mode;
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

  // ─── Прослушивание сообщений от content script ─────────
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
        } else if (message.status === 'paused') {
          updateRunningUI(true);
        }
        break;

      case 'PROMPT_COMPLETE':
        if (message.result?.success) {
          log(`✅ #${message.index + 1}: "${message.result.prompt?.substring(0, 50)}..."`, 'success');
        } else {
          log(`❌ #${message.index + 1}: ${message.result?.error || 'Неизвестная ошибка'}`, 'error');
        }
        break;

      case 'NEW_ASSETS':
        log(`Обнаружено ${message.count} новых ассетов`, 'info');
        break;
    }
  });

  // ─── Инициализация ─────────────────────────────────────
  loadSettings();
  checkConnection();

  // Периодическая проверка подключения
  setInterval(checkConnection, 5000);

})();
