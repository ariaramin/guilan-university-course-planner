import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../extension/dashboard.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('../extension/dashboard.js', import.meta.url), 'utf8');
const printScript = readFileSync(new URL('../extension/print.js', import.meta.url), 'utf8');
const printCss = readFileSync(new URL('../extension/print.css', import.meta.url), 'utf8');
const logo = readFileSync(new URL('../extension/assets/university-of-guilan-logo.jpg', import.meta.url));

test('dashboard has automatic generation with a default 20-unit target', () => {
  assert.match(html, /id="target-units"[^>]*value="۲۰"/);
  assert.doesNotMatch(html, /ساخت برنامه‌ها/);
  assert.match(script, /new Worker/);
  assert.match(script, /setTimeout\(\(\) => void refresh\(\{ resetScroll \}\), 250\)/);
});

test('dashboard does not expose raw JSON or internal course identifiers', () => {
  assert.doesNotMatch(html, /گروه‌های درسی \(JSON\)|شناسه درس|id="data"/);
  assert.doesNotMatch(html, /تنظیم برنامه|id="unit-file"|id="setup-title"/);
  assert.match(html, /چارت درسی من/);
});

test('dashboard ships local Persian typography and Word chart support', () => {
  const css = readFileSync(new URL('../extension/dashboard.css', import.meta.url), 'utf8');
  assert.match(html, /accept="\.docx,\.doc,/);
  assert.doesNotMatch(html, /\.pdf|application\/pdf|\.xlsx|\.csv/);
  assert.match(script, /vendor\/mammoth\.browser\.min\.js/);
  assert.match(css, /@font-face/);
  assert.match(css, /font-family:\s*Vazirmatn/);
  assert.doesNotMatch(css, /https?:\/\//);
});

test('dashboard only exposes the virtualized RTL table view', () => {
  const css = readFileSync(new URL('../extension/dashboard.css', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /card-view|table-view|نوع نمایش/);
  assert.doesNotMatch(script, /data-view|compactCourseQuery/);
  assert.doesNotMatch(css, /data-view="card"|view-toggle/);
  assert.match(css, /position: sticky/);
  assert.match(css, /min-width: 1180px/);
});

test('dashboard exposes button-based comparison and essential schedule actions only', () => {
  assert.match(script, /data-compare-schedule/);
  assert.match(script, /aria-pressed/);
  assert.doesNotMatch(script, /data-select-schedule|data-save-schedule|savedScheduleSignatures|compareInput\.type = 'checkbox'/);
  assert.match(html, /id="comparison"/);
  assert.match(script, /دانلود PDF/);
  assert.match(script, /buildPrintModel/);
  assert.doesNotMatch(script, /کمترین ظرفیت/);
});

test('dashboard exposes chart workflow and a true virtualized course viewport', () => {
  assert.match(html, /id="chart-file"/);
  assert.match(html, /id="chart-review"/);
  assert.match(html, /id="chart-diagnostics"/);
  assert.match(html, /id="confirm-chart"[^>]*hidden/);
  assert.match(script, /pendingChartItems/);
  assert.match(script, /dataset\.moreChart/);
  assert.match(script, /dataset\.removeChartItem/);
  assert.match(html, /id="course-spacer"/);
  assert.match(script, /variableVisibleRange/);
  assert.match(script, /slice\(range\.start, range\.end\)/);
});

test('print view is local, Persian, and paginated for A4 PDF output', () => {
  assert.match(printScript, /برنامه‌ریز انتخاب واحد/);
  assert.match(printScript, /زمان و مکان امتحان/);
  assert.match(printScript, /window\.print\(\)/);
  assert.match(printCss, /@page\s*\{\s*size:\s*A4\s*landscape/);
  assert.match(printCss, /thead\s*\{\s*display:\s*table-header-group/);
  assert.match(printCss, /break-after: page/);
});

test('official supplied branding is local, proportioned, accessible, and independently disclosed', () => {
  assert.ok(logo.length > 300_000);
  assert.equal(createHash('sha256').update(logo).digest('hex'), '42fa4feeb23d222ab1b133118091f2db5c4e7ab7767f8a3cdd58faaa161be0c4');
  assert.match(html, /assets\/university-of-guilan-logo\.jpg/);
  assert.match(html, /alt="نشان دانشگاه گیلان"/);
  assert.match(html, /width="1467" height="1750"/);
  assert.match(html, /این ابزار مستقل است و وابستگی رسمی به دانشگاه گیلان ندارد/);
  assert.match(printScript, /assets\/university-of-guilan-logo\.jpg/);
});

test('accessibility and motion contracts cover navigation, mobile modal focus, and reduced motion', () => {
  const css = readFileSync(new URL('../extension/dashboard.css', import.meta.url), 'utf8');
  assert.match(html, /class="skip-link"/);
  assert.match(html, /aria-describedby="course-table-hint"/);
  assert.match(script, /setAttribute\('aria-modal', 'true'\)/);
  assert.match(script, /event\.key !== 'Tab'/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /overflow-x: clip/);
});

test('content, chart, and gender refinements remain concise and explicit', () => {
  const description = 'ابزاری محلی برای مرور درس‌های ارائه‌شده، تطبیق چارت و پیشنهاد انتخاب‌های بدون تداخل، بدون ارسال داده به سرور خارجی';
  assert.equal(html.split(description).length - 1, 1);
  assert.match(html, /class="product-description"/);
  assert.match(html, /id="gender-filter">[\s\S]*?<option value="">همه<\/option>[\s\S]*?<option value="male">آقایان<\/option>[\s\S]*?<option value="female">بانوان<\/option>/);
  assert.match(html, /id="chart-filter"/);
  assert.doesNotMatch(html, /id="chart-only"/);
  assert.match(script, /group\.chartStatus === 'matched'/);
  assert.match(script, /در چارت شما/);
  assert.match(script, /groupSearchIndex/);
  assert.match(script, /filterCache/);
});

test('unresolved units have a correction flow and never advertise partial schedules', () => {
  assert.match(html, /id="unit-review-panel"/);
  assert.match(script, /data-unit-chart/);
  assert.match(script, /data-unit-value/);
  assert.match(script, /unitOverrides/);
  assert.match(script, /تعداد واحد مشخص نیست/);
  assert.doesNotMatch(`${html}\n${script}`, /محاسبه جزئی/);
});

test('completed courses can be entered manually or extracted from the term transcript', () => {
  assert.match(html, /id="extract-completed-courses"/);
  assert.match(html, /id="manual-completed-course"/);
  assert.match(script, /EXTRACT_COMPLETED_COURSES/);
  assert.match(script, /completedCourses/);
  assert.match(script, /isCompleted\(group\)/);
});
