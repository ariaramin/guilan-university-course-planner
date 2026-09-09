(() => {
  if (globalThis.__guilanPlannerContent) return;

  const CONTENT_VERSION = '1.1.0';
  const extractor = globalThis.sadaDomExtractor;
  const STABILITY_MS = 350;
  const EXTRACTION_TIMEOUT_MS = 6500;
  const OBSERVER_DEBOUNCE_MS = 300;

  let liveObserver = null;
  let observerTimer = null;
  let lastPublishedFingerprint = '';
  let isProcessingLiveUpdate = false;
  let pendingLiveUpdate = false;

  globalThis.__guilanPlannerContent = { version: CONTENT_VERSION };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'PING_SADA_CONTENT_SCRIPT') {
      sendResponse({
        type: 'PONG_SADA_CONTENT_SCRIPT',
        requestId: message.requestId,
        ready: true,
        version: CONTENT_VERSION,
        pageUrl: location.href,
      });
      return;
    }
    if (message?.type === 'PING_CONTENT_SCRIPT') {
      sendResponse({ requestId: message.requestId, ready: true, version: CONTENT_VERSION });
      return;
    }
    if (message?.type === 'EXTRACT_COMPLETED_COURSES') {
      try {
        const extraction = extractor.extractAllVisibleTables(document);
        sendResponse({ requestId: message.requestId, success: true, extractedAt: Date.now(), ...pageMetadata(), ...extraction });
      } catch {
        sendResponse({ requestId: message.requestId, success: false, errorCode: 'TRANSCRIPT_EXTRACTION_FAILED', ...pageMetadata() });
      }
      return;
    }
    if (!['EXTRACT_CURRENT_COURSES', 'EXTRACT_TABLES'].includes(message?.type)) return;
    void waitForStableExtraction(message.requestId ?? crypto.randomUUID())
      .then((result) => sendResponse(result.readiness === 'stable'
        ? { ...result, success: true }
        : { requestId: message.requestId, success: false, errorCode: result.errorCode ?? 'EXTRACTION_TIMEOUT', ...pageMetadata() }))
      .catch((error) => {
        if (globalThis.__SADA_DEBUG_LIVE__) console.debug('SADA content extraction', { requestId: message.requestId, technicalError: error.message });
        sendResponse({ requestId: message.requestId, success: false, errorCode: 'LIVE_EXTRACTION_FAILED', ...pageMetadata() });
      });
    return true;
  });

  function pageMetadata() {
    return {
      pageTitle: document.title,
      pagePath: location.pathname,
      sourceUrl: `${location.origin}${location.pathname}`,
    };
  }

  function scheduleLiveUpdate() {
    clearTimeout(observerTimer);
    pendingLiveUpdate = true;
    observerTimer = setTimeout(() => void processLiveUpdate(), OBSERVER_DEBOUNCE_MS);
  }

  function connectLiveObserver() {
    if (liveObserver) return;
    liveObserver = new MutationObserver(() => scheduleLiveUpdate());
    for (const root of extractor.observationRoots(document)) {
      liveObserver.observe(root, { childList: true, subtree: true, characterData: true, attributes: true });
    }
  }

  function currentExtraction(requestId, startedAt) {
    const result = extractor.extractVisibleTables(document);
    return {
      requestId,
      extractedAt: Date.now(),
      durationMs: Math.round(performance.now() - startedAt),
      observerStatus: liveObserver ? 'connected' : 'initializing',
      loadingVisible: extractor.hasVisibleLoadingIndicator(document),
      ...pageMetadata(),
      ...result,
    };
  }

  async function waitForStableExtraction(requestId) {
    const startedAt = performance.now();
    return new Promise((resolve) => {
      let settled = false;
      let timeout = null;
      let stabilityTimer = null;
      let transientObserver = null;

      const handleFrameLoad = (event) => { if (event.target?.tagName === 'IFRAME') evaluate(); };

      const finish = (result, readiness, errorCode = null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        clearTimeout(stabilityTimer);
        transientObserver?.disconnect();
        document.removeEventListener('load', handleFrameLoad, true);
        lastPublishedFingerprint = result.fingerprint;
        connectLiveObserver();
        resolve({ ...result, readiness, errorCode, observerStatus: 'connected' });
      };

      // Ensure the timeout cannot be bypassed by synchronous exceptions during setup
      timeout = setTimeout(() => {
        if (settled) return;
        const finalResult = currentExtraction(requestId, startedAt);
        let errorCode = 'EXTRACTION_TIMEOUT';
        if (!finalResult.selectorFound) errorCode = 'TABLE_NOT_FOUND';
        else if (finalResult.loadingVisible) errorCode = 'TABLE_NOT_READY';
        else if (finalResult.rowCount === 0) errorCode = 'NO_VALID_ROWS';
        finish(finalResult, 'timeout', errorCode);
      }, EXTRACTION_TIMEOUT_MS);

      const evaluate = () => {
        if (settled) return;
        try {
          const readiness = extractor.checkTableReadiness(document);
          const ready = readiness.selectorFound && readiness.rowCount > 0 && !readiness.loadingVisible;
          if (ready) {
            const result = currentExtraction(requestId, startedAt);
            finish(result, 'stable');
          }
        } catch (error) {
          if (globalThis.__SADA_DEBUG_LIVE__) console.debug('SADA evaluation error', error);
        }
      };

      try {
        transientObserver = new MutationObserver(() => {
          clearTimeout(stabilityTimer);
          stabilityTimer = setTimeout(evaluate, STABILITY_MS);
        });

        for (const root of extractor.observationRoots(document)) {
          if (root instanceof Node) {
            transientObserver.observe(root, { childList: true, subtree: true, characterData: true, attributes: true });
          }
        }
      } catch (error) {
        if (globalThis.__SADA_DEBUG_LIVE__) console.debug('SADA observer setup error', error);
      }

      document.addEventListener('load', handleFrameLoad, true);
      stabilityTimer = setTimeout(evaluate, STABILITY_MS);
    });
  }

  async function processLiveUpdate() {
    if (isProcessingLiveUpdate) return;
    isProcessingLiveUpdate = true;
    pendingLiveUpdate = false;

    try {
      const startedAt = performance.now();
      const readiness = extractor.checkTableReadiness(document);

      if (!readiness.selectorFound || readiness.rowCount === 0 || readiness.loadingVisible) {
        return;
      }

      const result = currentExtraction(`observer-${Date.now()}`, startedAt);

      if (result.fingerprint === lastPublishedFingerprint) {
        return;
      }

      const response = await chrome.runtime.sendMessage({
        type: 'SADA_TABLES_CHANGED',
        extraction: { ...result, success: true, readiness: 'stable', observerStatus: 'connected' },
      });
      if (response?.ok) lastPublishedFingerprint = result.fingerprint;
      else if (response?.retry) pendingLiveUpdate = true;
    } catch {
      // Ignored
    } finally {
      isProcessingLiveUpdate = false;
      if (pendingLiveUpdate) scheduleLiveUpdate();
    }
  }

  addEventListener('pagehide', () => {
    liveObserver?.disconnect();
    liveObserver = null;
    clearTimeout(observerTimer);
  });
  document.addEventListener('load', (event) => {
    if (event.target?.tagName !== 'IFRAME') return;
    scheduleLiveUpdate();
  }, true);
})();
