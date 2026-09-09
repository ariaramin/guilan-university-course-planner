import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const content = readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8');
const background = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../extension/dashboard.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../extension/dashboard.html', import.meta.url), 'utf8');

test('content extraction waits for stable rows and monitors dynamic table replacement', () => {
  assert.match(content, /MutationObserver/);
  assert.match(content, /result\.fingerprint === lastPublishedFingerprint/);
  assert.match(content, /readiness\.rowCount > 0/);
  assert.match(content, /hasVisibleLoadingIndicator/);
  assert.match(content, /readiness: 'timeout'|finish\(finalResult, 'timeout'/);
  assert.match(content, /SADA_TABLES_CHANGED/);
  assert.match(content, /connectLiveObserver\(\)/);
});

test('background handshakes, validates live tables, and atomically publishes the course dataset', () => {
  assert.match(background, /PING_SADA_CONTENT_SCRIPT/);
  assert.match(background, /chrome\.scripting\.executeScript/);
  assert.match(background, /parseSadaTables\(extraction\.tables\)/);
  assert.match(background, /courseDatasetFingerprint\(groups\)/);
  assert.match(background, /latestRequestByTab\.get\(tab\.id\) !== extraction\.requestId/);
  assert.match(background, /cachedCourseDataset: dataset/);
  assert.doesNotMatch(background, /lastExtraction/);
});

test('dashboard refreshes on open and focus, rejects stale responses, and labels cached fallback', () => {
  assert.match(html, /id="refresh-courses"/);
  assert.match(html, /class="loading-spinner"/);
  assert.match(readFileSync(new URL('../extension/dashboard.css', import.meta.url), 'utf8'), /\.refresh-courses\[aria-busy="true"\] \.loading-spinner/);
  assert.match(dashboard, /نمایش اطلاعات مختص ردیف‌های قابل‌مشاهده/);
  assert.match(dashboard, /requestLiveCourses\('open'\)/);
  assert.match(dashboard, /addEventListener\('focus'/);
  assert.match(dashboard, /liveRequestGate\.isLatest\(requestId\)/);
  assert.match(dashboard, /آخرین اطلاعات ذخیره‌شده/);
  assert.match(dashboard, /readCachedCourseDataset/);
  assert.doesNotMatch(dashboard, /lastExtraction/);
});
