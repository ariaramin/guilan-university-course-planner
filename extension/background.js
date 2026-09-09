import { createCachedCourseDataset } from './lib/course-cache.js';
import { courseDatasetFingerprint, extractionDiagnostic } from './lib/freshness.js';
import { normalizeGroup } from './lib/normalize.js';
import { parseSadaTables } from './lib/sada-parser.js';
import { parseTranscriptTables } from './lib/transcript-parser.js';

const CONTENT_VERSION = '1.1.0';
const SADA_ORIGIN = 'https://sada.guilan.ac.ir';
const latestRequestByTab = new Map();
const inFlightTabs = new Set();

class LiveExtractionError extends Error {
  constructor(code, stage) {
    super(code);
    this.code = code;
    this.stage = stage;
  }
}

function supportedUrl(value) {
  try { return new URL(value).origin === SADA_ORIGIN; } catch { return false; }
}

function safeSourceUrl(value) {
  try {
    const url = new URL(value);
    return supportedUrl(value) ? `${url.origin}${url.pathname}` : '';
  } catch { return ''; }
}

async function sourceTabs() {
  const stored = await chrome.storage.session.get(['plannerLaunchTabId', 'sadaSourceTabId']);
  const pinnedId = stored.plannerLaunchTabId ?? stored.sadaSourceTabId;
  if (Number.isInteger(pinnedId)) {
    try { return [await chrome.tabs.get(pinnedId)]; } catch { /* fall through to a live SADA tab */ }
  }
  const tabs = await chrome.tabs.query({ url: `${SADA_ORIGIN}/*` });
  if (!tabs.length) throw new LiveExtractionError('NO_ACTIVE_TAB', 'tab_lookup');
  return [tabs.find((tab) => tab.active) ?? tabs.at(-1)];
}

const withTimeout = (promise, ms) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), ms))
]);

async function pingContentScript(tabId, requestId) {
  const response = await withTimeout(
    chrome.tabs.sendMessage(tabId, { type: 'PING_SADA_CONTENT_SCRIPT', requestId }),
    2000
  );
  if (response?.requestId !== requestId || response.ready !== true || typeof response.version !== 'string' || response.type !== 'PONG_SADA_CONTENT_SCRIPT') {
    throw new LiveExtractionError('INVALID_RESPONSE', 'handshake');
  }
  return response;
}

async function ensureContentScript(tab, requestId, diagnostic) {
  try {
    const response = await pingContentScript(tab.id, requestId);
    if (response.version !== CONTENT_VERSION) {
      diagnostic.contentVersion = response.version;
      throw new LiveExtractionError('CONTENT_SCRIPT_VERSION_MISMATCH', 'handshake');
    }
    diagnostic.handshake = 'ready';
    diagnostic.contentVersion = response.version;
    return;
  } catch (error) {
    if (error instanceof LiveExtractionError && error.code === 'CONTENT_SCRIPT_VERSION_MISMATCH') throw error;
    diagnostic.handshake = 'missing';
  }
  try {
    diagnostic.injectionAttempted = true;
    await withTimeout(
      chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['lib/dom-extractor.js', 'content.js'] }),
      3000
    );
  } catch {
    throw new LiveExtractionError('SCRIPT_INJECTION_FAILED', 'injection');
  }
  try {
    const response = await pingContentScript(tab.id, requestId);
    if (response.version !== CONTENT_VERSION) throw new LiveExtractionError('CONTENT_SCRIPT_VERSION_MISMATCH', 'handshake_after_injection');
    diagnostic.handshake = 'ready-after-injection';
    diagnostic.contentVersion = response.version;
  } catch {
    throw new LiveExtractionError('CONTENT_SCRIPT_UNAVAILABLE', 'handshake_after_injection');
  }
}

async function commitExtraction(extraction, trigger, tab) {
  if (!extraction || extraction.requestId !== latestRequestByTab.get(tab.id)) return { requestId: extraction?.requestId, stale: true };
  if (extraction.success === false) throw new LiveExtractionError(extraction.errorCode ?? 'LIVE_EXTRACTION_FAILED', 'content_extraction');
  if (trigger !== 'observer' && extraction.readiness !== 'stable') {
    throw new LiveExtractionError(extraction.errorCode ?? 'TABLE_NOT_READY', 'readiness');
  }
  if (!Array.isArray(extraction.tables) || !extraction.tables.length) throw new LiveExtractionError('TABLE_NOT_FOUND', 'table_lookup');
  if (!Number.isFinite(extraction.extractedAt) || extraction.extractedAt <= 0) throw new LiveExtractionError('INVALID_RESPONSE', 'timestamp');

  const parsed = parseSadaTables(extraction.tables);
  if (!parsed.groups.length) throw new LiveExtractionError('TABLE_NOT_FOUND', 'parsing');
  const groups = parsed.groups.map(normalizeGroup);
  const fingerprint = courseDatasetFingerprint(groups);
  const sourceUrl = safeSourceUrl(extraction.sourceUrl || tab.url);
  if (!sourceUrl) throw new LiveExtractionError('INVALID_RESPONSE', 'source_url');
  const selectedTerms = [...new Set(groups.map((group) => group.termId).filter(Boolean))];
  const selectedTerm = selectedTerms.length === 1 ? selectedTerms[0] : null;
  const stored = await chrome.storage.local.get('cachedCourseDataset');
  if (latestRequestByTab.get(tab.id) !== extraction.requestId) return { requestId: extraction.requestId, stale: true };

  const dataset = createCachedCourseDataset({
    courses: parsed.groups,
    extractedAt: extraction.extractedAt,
    sourceUrl,
    fingerprint,
    selectedTerm,
  });
  const changed = stored.cachedCourseDataset?.fingerprint !== fingerprint;
  const diagnostic = {
    ...extractionDiagnostic(extraction),
    trigger,
    sourceUrl,
    previousFingerprint: stored.cachedCourseDataset?.fingerprint ?? null,
    currentFingerprint: fingerprint,
    cacheSchemaVersion: dataset.schemaVersion,
    cacheTimestampValid: true,
  };
  if (changed) {
    await chrome.storage.local.set({ cachedCourseDataset: dataset, lastLiveDiagnostics: diagnostic });
  } else {
    await chrome.storage.local.set({ lastLiveDiagnostics: diagnostic });
  }
  return {
    requestId: extraction.requestId,
    success: true,
    groups,
    fingerprint,
    changed,
    meta: dataset,
    diagnostic,
  };
}

async function refreshFromTab(tab, requestId, trigger) {
  if (!tab?.id) throw new LiveExtractionError('NO_ACTIVE_TAB', 'tab_lookup');
  if (!supportedUrl(tab.url)) throw new LiveExtractionError('UNSUPPORTED_PAGE', 'url_validation');
  latestRequestByTab.set(tab.id, requestId);
  inFlightTabs.add(tab.id);
  const diagnostic = {
    requestId,
    trigger,
    sourceUrl: safeSourceUrl(tab.url),
    handshake: 'not-started',
    contentVersion: null,
    expectedContentVersion: CONTENT_VERSION,
    injectionAttempted: false,
  };
  try {
    await ensureContentScript(tab, requestId, diagnostic);
    diagnostic.stage = 'extraction';
    const extraction = await withTimeout(
      chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_CURRENT_COURSES', requestId }),
      8000
    );
    if (latestRequestByTab.get(tab.id) !== requestId) return { requestId, stale: true };
    const result = await commitExtraction(extraction, trigger, tab);
    return { ...result, diagnostic: { ...diagnostic, ...result.diagnostic } };
  } catch (error) {
    if (globalThis.__SADA_DEBUG_LIVE__) console.debug('SADA live extraction', { ...diagnostic, stage: error.stage, technicalError: error.message });
    error.diagnostic = { ...diagnostic, stage: error.stage ?? 'unknown' };
    throw error;
  } finally {
    if (latestRequestByTab.get(tab.id) === requestId) inFlightTabs.delete(tab.id);
  }
}

async function refreshFromSource(requestId, trigger) {
  const [tab] = await sourceTabs();
  const result = await refreshFromTab(tab, requestId, trigger);
  await chrome.storage.session.set({ sadaSourceTabId: tab.id, plannerLaunchTabId: tab.id });
  return result;
}

function completionKey(course) {
  return course.courseId || course.normalizedTitle;
}

async function extractCompletedCourses(requestId) {
  const [tab] = await sourceTabs();
  if (!tab?.id || !supportedUrl(tab.url)) throw new LiveExtractionError('UNSUPPORTED_PAGE', 'url_validation');
  const diagnostic = { requestId, sourceUrl: safeSourceUrl(tab.url), handshake: 'not-started' };
  await ensureContentScript(tab, requestId, diagnostic);
  const extraction = await withTimeout(
    chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_COMPLETED_COURSES', requestId }),
    8000,
  );
  if (extraction?.success === false) throw new LiveExtractionError(extraction.errorCode ?? 'TRANSCRIPT_EXTRACTION_FAILED', 'transcript_extraction');
  if (extraction?.requestId !== requestId || !Array.isArray(extraction?.tables)) {
    throw new LiveExtractionError('INVALID_RESPONSE', 'transcript_extraction');
  }
  const parsed = parseTranscriptTables(extraction?.tables ?? []);
  if (!parsed.matchedTables) throw new LiveExtractionError('TRANSCRIPT_NOT_FOUND', 'transcript_parsing');
  const stored = await chrome.storage.local.get('completedCourses');
  const merged = new Map((stored.completedCourses ?? [])
    .filter((course) => completionKey(course))
    .map((course) => [completionKey(course), course]));
  for (const course of parsed.courses) {
    const previous = merged.get(completionKey(course));
    if (!previous || course.grade >= previous.grade) merged.set(completionKey(course), course);
  }
  const courses = [...merged.values()];
  await chrome.storage.local.set({ completedCourses: courses });
  await chrome.storage.session.set({ sadaSourceTabId: tab.id, plannerLaunchTabId: tab.id });
  return { requestId, success: true, courses, extracted: parsed.courses.length, diagnostic: { ...diagnostic, ...parsed } };
}

chrome.action.onClicked.addListener(async (tab) => {
  await chrome.storage.session.set({
    plannerLaunchTabId: tab.id ?? null,
    ...(tab.id && supportedUrl(tab.url) ? { sadaSourceTabId: tab.id } : {}),
  });
  await chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'REFRESH_LIVE_COURSES') {
    void refreshFromSource(message.requestId, message.trigger ?? 'manual')
      .then(sendResponse)
      .catch((error) => sendResponse({
        requestId: message.requestId,
        success: false,
        errorCode: error instanceof LiveExtractionError ? error.code : 'LIVE_EXTRACTION_FAILED',
        diagnostic: error.diagnostic ?? { requestId: message.requestId, stage: error.stage ?? 'unknown' },
      }));
    return true;
  }

  if (message?.type === 'EXTRACT_COMPLETED_COURSES') {
    void extractCompletedCourses(message.requestId)
      .then(sendResponse)
      .catch((error) => sendResponse({
        requestId: message.requestId,
        success: false,
        errorCode: error instanceof LiveExtractionError ? error.code : 'TRANSCRIPT_EXTRACTION_FAILED',
      }));
    return true;
  }

  if (message?.type === 'SADA_TABLES_CHANGED' && sender.tab?.id) {
    if (inFlightTabs.has(sender.tab.id)) {
      sendResponse({ ok: false, retry: true });
      return;
    }
    void (async () => {
      try {
        const tab = await chrome.tabs.get(sender.tab.id);
        latestRequestByTab.set(tab.id, message.extraction.requestId);
        await commitExtraction(message.extraction, 'observer', tab);
        sendResponse({ ok: true });
      } catch {
        sendResponse({ ok: false });
      }
    })();
    return true;
  }
});
