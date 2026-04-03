/**
 * FlowBatch — Обработчик сообщений между content script и side panel / background
 */
(() => {
  'use strict';
  const FB = window.FB;
  if (!FB) return;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'PING':
        sendResponse({ status: 'alive', isRunning: FB.state.isRunning, isPaused: FB.state.isPaused, version: '0.4' });
        break;

      case 'SET_QUEUE':
        FB.state.queue = message.queue || [];
        FB.state.currentIndex = 0;
        FB.state.results = [];
        sendResponse({ success: true, count: FB.state.queue.length });
        break;

      case 'SET_SETTINGS':
        Object.assign(FB.state.settings, message.settings);
        sendResponse({ success: true });
        break;

      case 'START':
        FB.startQueue();
        sendResponse({ success: true });
        break;

      case 'STOP':
        FB.stopQueue();
        sendResponse({ success: true });
        break;

      case 'PAUSE':
        FB.pauseQueue();
        sendResponse({ success: true });
        break;

      case 'RESUME':
        FB.resumeQueue();
        sendResponse({ success: true });
        break;

      case 'GET_STATE':
        sendResponse({
          isRunning: FB.state.isRunning, isPaused: FB.state.isPaused,
          total: FB.state.queue.length, current: FB.state.currentIndex,
          results: FB.state.results, settings: FB.state.settings
        });
        break;

      case 'CHECK_SELECTORS':
        sendResponse({
          promptInput: !!FlowSelectors.getPromptInput(),
          generateButton: !!FlowSelectors.getGenerateButton(),
          ultraButton: !!FlowSelectors.getUltraButton(),
          ultraActive: FlowSelectors.isUltraActive(),
          formatButton: !!FlowSelectors.getFormatButton(),
          currentFormat: FlowSelectors.getCurrentFormat(),
          addMediaButton: !!FlowSelectors.getAddMediaButton(),
          loadingIndicator: !!FlowSelectors.getLoadingIndicator(),
          isGenerating: FlowSelectors.isGenerating(),
          hasModal: FlowSelectors.hasModal()
        });
        break;

      case 'DISCOVER_DOM': {
        const basic = {
          promptInput: !!FlowSelectors.getPromptInput(),
          generateButton: !!FlowSelectors.getGenerateButton(),
          ultraButton: !!FlowSelectors.getUltraButton(),
          ultraActive: FlowSelectors.isUltraActive(),
          formatButton: !!FlowSelectors.getFormatButton(),
          currentFormat: FlowSelectors.getCurrentFormat(),
          addMediaButton: !!FlowSelectors.getAddMediaButton(),
          loadingIndicator: !!FlowSelectors.getLoadingIndicator(),
          isGenerating: FlowSelectors.isGenerating(),
          hasModal: FlowSelectors.hasModal()
        };
        const discovery = FlowSelectors.discoverDOM();
        sendResponse({ ...basic, discovery });
        break;
      }

      case 'DISMISS_MODALS':
        FB.autoDismissModals().then(count => sendResponse({ dismissed: count }));
        return true;

      default:
        sendResponse({ error: 'Неизвестный тип сообщения' });
    }
    return true;
  });
})();
