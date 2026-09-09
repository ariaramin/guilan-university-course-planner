import { parseChartFile, reconcileChart } from './lib/chart-parser.js';
import { readCachedCourseDataset } from './lib/course-cache.js';
import { normalizeCourseName, validUnits } from './lib/course-units.js';

import { createRequestGate } from './lib/freshness.js';
import { englishDigits, normalizeGroup } from './lib/normalize.js';
import { calculateGapsForSessions, formatGapsForDay } from './lib/free-time.js';
import { IntegerInputHandler } from './lib/numeric-input.js';
import {
  formatCapacity, formatDegreeTerm, formatDuration, formatExam, formatSessions, formatTerm, formatTuition, persianDigits,
} from './lib/presentation.js';
import {
  classifyGenderEligibility, cleanGenderRestrictionLabel, genderFilterDecision,
} from './lib/sada-parser.js';
import { groupedRows, variableVisibleRange } from './lib/virtual-list.js';

const $ = (selector) => document.querySelector(selector);
$('#app-version').textContent = `نسخه ${persianDigits(chrome.runtime.getManifest().version)}`;
const days = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
const chartLabels = {
  matched: 'تطبیق قطعی', probable_match: 'تطبیق احتمالی', not_in_chart: 'خارج از چارت',
  unmatched_chart_item: 'در ارائه‌ها پیدا نشد', needs_review: 'نیازمند بررسی',
};
const collapsedGroups = new Set();
const requiredGroupIds = new Set();
const preferredGroupIds = new Set();
const excludedGroupIds = new Set();
let baseGroups = [];
let groups = [];
let schedules = [];
let chartItems = [];
let chartDiagnostics = null;
let pendingChartItems = null;
let pendingChartDiagnostics = null;
let pendingManualMatches = null;
let chartReviewLimit = 100;
let manualMatches = {};
let visibleItems = [];
let visibleScheduleCount = 8;
const comparedScheduleSignatures = new Set();
const groupSearchIndex = new Map();
const confirmedChartCourseIds = new Set();
let groupsVersion = 0;
let filterCache = { key: '', value: [] };
let refreshTimer = null;
let activeWorker = null;
let runId = 0;
let renderFrame = 0;
let printing = false;
let dataStateMessages = [];
let dataStatus = 'loading-live';
let cachedResult = { status: 'empty', dataset: null };
let appliedFingerprint = '';
let appliedExtractedAt = 0;
let latestLiveRequestId = '';
let lastLiveRequestAt = 0;
let unitOverrides = {};
let completedCourses = [];
let completedCourseIds = new Set();
let completedCourseNames = new Set();
let completedCoursesVersion = 0;
const CACHE_STALE_AFTER_MS = 15 * 60 * 1000;
let targetUnitsHandler = null;
let targetCountHandler = null;
let mammothLoadingPromise = null;

function ensureMammoth() {
  if (globalThis.mammoth) return Promise.resolve();
  if (mammothLoadingPromise) return mammothLoadingPromise;
  mammothLoadingPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'vendor/mammoth.browser.min.js';
    script.onload = () => {
      mammothLoadingPromise = null;
      resolve();
    };
    script.onerror = () => {
      mammothLoadingPromise = null;
      reject(new Error('بارگذاری کتابخانه mammoth با مشکل مواجه شد.'));
    };
    document.head.append(script);
  });
  return mammothLoadingPromise;
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = persianDigits(text);
  return element;
}

function setStatus(message, kind = '') {
  $('#status').textContent = persianDigits(message);
  $('#status').dataset.kind = kind;
}

function genderMatchesFilter(group, selectedFilter) {
  const decision = genderFilterDecision(group.genderEligibility, selectedFilter);
  if (globalThis.__SADA_DEBUG_GENDER__ && group.genderEligibility !== 'unspecified') {
    console.debug('SADA gender decision', {
      ...group.genderDiagnostics,
      selectedFilter: selectedFilter || 'all',
      included: decision.included,
      reason: decision.reason,
    });
  }
  return decision.included;
}

function normalizeStoredGroup(group) {
  if (group.genderEligibility) return normalizeGroup(group);
  const classification = classifyGenderEligibility(group.rawTitle ?? group.title);
  const genderEligibility = group.genderRestriction ?? classification.eligibility;
  const ambiguous = genderEligibility === 'ambiguous';
  return normalizeGroup({
    ...group,
    title: cleanGenderRestrictionLabel(group.title, classification) || group.title,
    genderEligibility,
    genderDiagnostics: group.genderDiagnostics ?? {
      rawSources: classification.sources.map((source) => source.raw),
      normalizedSources: classification.sources.map((source) => source.normalized),
      detectedPhrases: classification.phrases,
      finalEligibility: genderEligibility,
    },
    sourceWarnings: ambiguous
      ? [...new Set([...(group.sourceWarnings ?? []), 'محدودیت جنسیت در منبع مبهم یا متناقض است.'])]
      : group.sourceWarnings,
  });
}

function showEmpty(container, message) {
  const empty = node('div', 'empty');
  empty.setAttribute('role', 'status');
  const logo = document.createElement('img');
  logo.src = 'assets/university-of-guilan-logo.jpg';
  logo.alt = '';
  logo.width = 1467;
  logo.height = 1750;
  logo.loading = 'lazy';
  logo.decoding = 'async';
  logo.setAttribute('aria-hidden', 'true');
  empty.append(logo, node('p', '', message));
  container.replaceChildren(empty);
}

function normalizedCourseId(value) {
  return englishDigits(value ?? '').replace(/[^\p{L}\p{N}]+/gu, '').toLocaleLowerCase('fa');
}

function normalizeCompletedCourses(courses) {
  const byCourse = new Map();
  for (const course of courses ?? []) {
    const title = String(course?.title ?? '').trim();
    const normalizedTitle = normalizeCourseName(title);
    const courseId = normalizedCourseId(course?.courseId);
    if (!normalizedTitle && !courseId) continue;
    const units = Number(course?.units);
    const grade = Number(course?.grade);
    const completed = {
      id: courseId || normalizedTitle,
      courseId: courseId || null,
      title,
      normalizedTitle,
      units: Number.isFinite(units) && units > 0 ? units : null,
      grade: Number.isFinite(grade) ? grade : null,
      source: course?.source === 'transcript' ? 'transcript' : 'manual',
    };
    const key = completed.courseId || completed.normalizedTitle;
    const existing = byCourse.get(key);
    if (!existing || (completed.grade ?? -Infinity) >= (existing.grade ?? -Infinity)) byCourse.set(key, completed);
  }
  completedCourses = [...byCourse.values()];
  completedCourseIds = new Set(completedCourses.map((course) => course.courseId).filter(Boolean));
  completedCourseNames = new Set(completedCourses.map((course) => course.normalizedTitle).filter(Boolean));
  completedCoursesVersion += 1;
}

function isCompleted(group) {
  return completedCourseIds.has(normalizedCourseId(group.courseId)) || completedCourseNames.has(groupSearchIndex.get(group.id).title);
}

function passedIds() {
  return [...new Set(groups.filter(isCompleted).map((group) => group.courseId))];
}

function renderCompletedCourses() {
  const summary = completedCourses.length
    ? `${persianDigits(completedCourses.length)} درس از پیشنهادها حذف می‌شود`
    : 'هنوز درسی ثبت نشده است';
  $('#completed-courses-summary').textContent = summary;
  const fragment = document.createDocumentFragment();
  for (const course of completedCourses) {
    const row = node('div', 'completed-course-row');
    const details = [course.units ? `${persianDigits(course.units)} واحد` : null, course.grade != null ? `نمره ${persianDigits(course.grade)}` : 'ثبت دستی']
      .filter(Boolean).join(' · ');
    row.append(node('strong', '', course.title || course.courseId), node('span', '', details));
    const remove = node('button', 'button-ghost danger', 'حذف');
    remove.type = 'button';
    remove.dataset.removeCompletedCourse = course.id;
    remove.setAttribute('aria-label', `حذف ${course.title || course.courseId} از درس‌های گذرانده‌شده`);
    row.append(remove);
    fragment.append(row);
  }
  $('#completed-courses-list').replaceChildren(fragment);
}



function filterGroups() {
  const key = [
    groupsVersion, $('#title-filter').value, $('#instructor-filter').value, $('#day-filter').value,
    $('#unit-filter').value, $('#degree-filter').value, $('#term-filter').value, $('#gender-filter').value,
    $('#chart-filter').value, $('#sort-by').value, completedCoursesVersion,
    $('#capacity-only').checked, $('#show-full').checked,
    [...requiredGroupIds].sort().join(','),
  ].join('\u0000');
  if (key === filterCache.key) return filterCache.value;
  const title = normalizeCourseName($('#title-filter').value);
  const instructor = normalizeCourseName($('#instructor-filter').value);
  const day = $('#day-filter').value === '' ? null : Number($('#day-filter').value);
  const unit = $('#unit-filter').value;
  const degree = $('#degree-filter').value;
  const term = $('#term-filter').value;
  const gender = $('#gender-filter').value;
  const chart = $('#chart-filter').value;
  const result = groups.filter((group) =>
    (!title || groupSearchIndex.get(group.id).title.includes(title)) &&
    (!instructor || groupSearchIndex.get(group.id).instructor.includes(instructor)) &&
    (day == null || group.sessions.some((session) => session.day === day)) &&
    (!unit || (unit === 'unknown' ? !group.unitsKnown : unit === 'known' ? group.unitsKnown : unit === '4' ? group.units >= 4 : group.units === Number(unit))) &&
    (!degree || group.degree === degree) && (!term || group.termId === term) &&
    genderMatchesFilter(group, gender) &&
    (!chart || (chart === 'matched' ? confirmedChartCourseIds.has(group.courseId) : !confirmedChartCourseIds.has(group.courseId))) &&
    (!$('#capacity-only').checked || (group.capacity ?? 0) > 0) &&

    ($('#show-full').checked || group.available !== false) && !isCompleted(group),
  );
  const chartWeight = (group) => group.chartStatus === 'matched' ? 3 : group.chartStatus === 'probable_match' ? 2 : group.chartStatus === 'needs_review' ? 1 : 0;
  const sort = $('#sort-by').value;
  filterCache = { key, value: result.sort((left, right) => {
    if (sort === 'capacity') return (right.capacity ?? -1) - (left.capacity ?? -1);
    if (sort === 'units') return Number(right.unitsKnown) - Number(left.unitsKnown) || right.units - left.units;
    if (sort === 'chart') return chartWeight(right) - chartWeight(left);
    return left.title.localeCompare(right.title, 'fa');
  }) };
  return filterCache.value;
}

function groupLabel(key) {
  const groupBy = $('#group-by').value;
  if (key === 'unknown') return 'نامشخص';
  if (groupBy === 'day') return days[Number(key)] ?? 'زمان نامشخص';
  if (groupBy === 'chart') return chartLabels[key] ?? key;
  return key;
}

function badge(status) {
  const value = node('span', 'badge', chartLabels[status] ?? 'نامشخص');
  value.dataset.status = status ?? '';
  return value;
}

function actionButton(action, label, group) {
  const button = node('button', '', label);
  button.type = 'button';
  button.dataset.action = action;
  button.dataset.groupId = group.id;
  const set = action === 'required' ? requiredGroupIds : action === 'preferred' ? preferredGroupIds : excludedGroupIds;
  button.setAttribute('aria-pressed', String(set.has(group.id)));
  return button;
}

function courseRow(group) {
  const row = node('div', 'grid-row');
  row.setAttribute('role', 'row');
  const inChart = confirmedChartCourseIds.has(group.courseId);
  row.dataset.chartMatch = String(inChart);
  const titleCell = node('div', 'cell cell-title');
  const titleLine = node('div', 'course-title-line');
  const detail = node('button', 'detail-button', group.title);
  detail.type = 'button'; detail.dataset.detailId = group.id;
  titleLine.append(detail);
  if (inChart) {
    const chartBadge = node('span', 'chart-course-badge', 'در چارت شما');
    chartBadge.title = 'این درس در فایل چارت بارگذاری‌شده پیدا شده است.';
    chartBadge.setAttribute('aria-label', chartBadge.title);
    titleLine.append(chartBadge);
  }
  titleCell.append(titleLine);
  const titleMeta = node('div', 'course-title-meta');
  if (group.groupNumber) titleMeta.append(node('small', '', `گروه ${persianDigits(group.groupNumber)}`));
  if (!group.unitsKnown) titleMeta.append(node('span', 'gender-badge', 'تعداد واحد مشخص نیست'));
  if (group.genderEligibility === 'male' || group.genderEligibility === 'female') {
    titleMeta.append(node('span', 'gender-badge', group.genderEligibility === 'male' ? 'ویژه آقایان' : 'ویژه بانوان'));
  } else if (group.genderEligibility === 'ambiguous') titleMeta.append(node('span', 'gender-badge', 'جنسیت مبهم'));
  if (titleMeta.children.length) titleCell.append(titleMeta);
  if (group.available === false) titleCell.append(node('span', 'course-reason', 'ظرفیت این درس تکمیل شده است.'));
  const instructor = node('div', 'cell', group.instructor || 'اعلام نشده');
  const time = node('div', 'cell cell-time', formatSessions(group.sessions));
  const exam = node('div', 'cell cell-exam', formatExam(group.exam));
  const degree = node('div', 'cell', group.degree || 'اعلام نشده');
  const term = node('div', 'cell numeric', formatTerm(group.termId));
  const capacity = node('div', 'cell numeric', formatCapacity(group.capacity));
  const tuition = node('div', 'cell', formatTuition(group.tuition));
  row.append(titleCell, instructor, time, exam, degree, term, capacity, tuition);
  for (const cell of row.children) cell.setAttribute('role', 'gridcell');
  return row;
}

let lastRenderedState = {
  start: -1,
  end: -1,
  offset: -1,
  totalHeight: -1,
  itemKeys: '',
  groupBy: '',
  groupsVersion: -1,
};

function renderVirtualWindow() {
  const scroll = $('#course-scroll');
  const range = variableVisibleRange({
    items: visibleItems, heightFor: (item) => item.type === 'group' ? 48 : 72,
    scrollTop: scroll.scrollTop, viewportHeight: scroll.clientHeight || 600,
    overscan: 7,
  });
  
  const groupBy = $('#group-by').value;
  const sliced = visibleItems.slice(range.start, range.end);
  const itemKeys = sliced.map(item => {
    if (item.type === 'group') {
      const expanded = !collapsedGroups.has(`${groupBy}:${item.key}`);
      return `g:${item.key}:${item.count}:${expanded}`;
    } else {
      return `c:${item.group.id}:${item.group.available}:${item.group.capacity}:${item.group.units}`;
    }
  }).join('|');

  const spacerHeight = Math.max(range.totalHeight, scroll.clientHeight);

  if (
    range.start === lastRenderedState.start &&
    range.end === lastRenderedState.end &&
    range.offset === lastRenderedState.offset &&
    range.totalHeight === lastRenderedState.totalHeight &&
    groupBy === lastRenderedState.groupBy &&
    groupsVersion === lastRenderedState.groupsVersion &&
    itemKeys === lastRenderedState.itemKeys
  ) {
    $('#course-spacer').style.height = `${spacerHeight}px`;
    $('#course-list').style.transform = `translateY(${range.offset}px)`;
    return;
  }

  lastRenderedState = {
    start: range.start,
    end: range.end,
    offset: range.offset,
    totalHeight: range.totalHeight,
    itemKeys,
    groupBy,
    groupsVersion,
  };

  $('#course-spacer').style.height = `${spacerHeight}px`;
  $('#course-list').style.transform = `translateY(${range.offset}px)`;
  const fragment = document.createDocumentFragment();
  for (const item of sliced) {
    if (item.type === 'group') {
      const header = node('button', 'group-row');
      header.type = 'button'; header.dataset.groupKey = item.key;
      header.setAttribute('aria-expanded', String(!collapsedGroups.has(`${groupBy}:${item.key}`)));
      header.append(node('span', '', groupLabel(item.key)), node('span', '', `${persianDigits(item.count)} درس`));
      fragment.append(header);
    } else fragment.append(courseRow(item.group));
  }
  $('#course-list').replaceChildren(fragment);
}

function renderCourses(items, resetScroll = false) {
  $('#course-count').textContent = `${persianDigits(items.length)} از ${persianDigits(groups.length)} درس`;
  visibleItems = groupedRows(items, $('#group-by').value, collapsedGroups);
  const scroll = $('#course-scroll');
  scroll.setAttribute('aria-rowcount', String(visibleItems.length));
  if (resetScroll) scroll.scrollTop = 0;
  if (!visibleItems.length) {
    $('#course-spacer').style.height = '100%';
    $('#course-list').style.transform = '';
    showEmpty($('#course-list'), 'با این فیلترها درسی پیدا نشد.');
    return;
  }
  renderVirtualWindow();
}

function unitDescription(schedule, target) {
  const base = schedule.units === target ? 'دقیقاً مطابق تعداد واحد هدف'
    : schedule.units < target ? `${persianDigits(target - schedule.units)} واحد کمتر از هدف`
    : `${persianDigits(schedule.units - target)} واحد بیشتر از هدف`;
  return schedule.unitsComplete ? base : `${base} (بدون احتساب دروس نامشخص)`;
}

function scheduleSignature(schedule) {
  return schedule.groups.map((group) => group.id).sort().join('|');
}

function weeklyRows(schedule) {
  const byDay = new Map();
  for (const group of schedule.groups) {
    for (const session of group.sessions) byDay.set(session.day, [...(byDay.get(session.day) ?? []), { group, session }]);
  }
  const container = node('div', 'week-table');
  for (const [day, entries] of [...byDay].sort(([left], [right]) => left - right)) {
    const row = node('div', 'week-day');
    row.append(node('strong', '', days[day]), node('span', '', entries.sort((a, b) => a.session.start - b.session.start).map(({ group, session }) =>
      `${group.title}، ${persianDigits(Math.floor(session.start / 60))}:${persianDigits(String(session.start % 60).padStart(2, '0'))} تا ${persianDigits(Math.floor(session.end / 60))}:${persianDigits(String(session.end % 60).padStart(2, '0'))}`,
    ).join(' · ')));
    container.append(row);
  }
  return container;
}

function renderComparison() {
  const compared = schedules.filter((schedule) => comparedScheduleSignatures.has(scheduleSignature(schedule))).slice(0, 2);
  const container = $('#comparison');
  container.hidden = !compared.length;
  if (!compared.length) { container.replaceChildren(); return; }
  const title = node('h3', '', 'مقایسه برنامه‌ها');
  const selectedNames = compared.map((schedule) => `برنامه ${persianDigits(schedules.indexOf(schedule) + 1)}`).join(' و ');
  if (compared.length === 1) {
    container.replaceChildren(title, node('p', 'comparison-note', `${selectedNames} انتخاب شد؛ یک برنامه دیگر انتخاب کنید.`));
    return;
  }
  const grid = node('div', 'comparison-grid');
  const values = (schedule) => [
    `${persianDigits(schedule.units)} واحد`,
    `${persianDigits(schedule.groups.length)} درس`, `${persianDigits(schedule.attendanceDays)} روز`,
    formatDuration(schedule.gapMinutes),
  ];
  grid.append(node('strong', '', 'معیار'), node('strong', '', 'برنامه ۱'), node('strong', '', 'برنامه ۲'));
  ['مجموع واحد', 'تعداد درس', 'روز حضور', 'فاصله کلاس‌ها'].forEach((label, index) => {
    grid.append(node('span', '', label), node('span', '', values(compared[0])[index]), node('span', '', values(compared[1])[index]));
  });
  container.replaceChildren(title, node('p', 'comparison-note', `${selectedNames} انتخاب شده‌اند.`), grid);
}

function renderSchedules(items, target) {
  schedules = items;
  const signatures = new Set(items.map(scheduleSignature));
  for (const signature of [...comparedScheduleSignatures]) if (!signatures.has(signature)) comparedScheduleSignatures.delete(signature);
  for (const button of document.querySelectorAll('.exports button')) button.disabled = !items.length;
  if (!items.length) {
    showEmpty($('#results'), 'برنامه‌ای با این شرایط پیدا نشد.');
    renderComparison();
    return;
  }
  const fragment = document.createDocumentFragment();
  items.slice(0, visibleScheduleCount).forEach((schedule, index) => {
    const signature = scheduleSignature(schedule);
    const section = node('article', 'schedule');
    section.dataset.signature = signature;
    section.dataset.compared = String(comparedScheduleSignatures.has(signature));
    const head = node('div', 'schedule-head');
    const title = node('h3', '', `برنامه ${persianDigits(index + 1)}`);
    if (index === 0) title.append(node('span', 'best-label', 'پیشنهاد بهتر'));
    head.append(title, node('span', 'unit-badge', `${persianDigits(schedule.units)} واحد${schedule.unitsComplete ? '' : ' + نامشخص'}`));
    const metrics = node('div', 'schedule-metrics');
    for (const [value, label] of [
      [persianDigits(schedule.groups.length), 'درس'], [persianDigits(schedule.attendanceDays), 'روز حضور'],
      [formatDuration(schedule.gapMinutes), 'فاصله کلاس‌ها'],
    ]) { const metric = node('div'); metric.append(node('strong', '', value), node('span', '', label)); metrics.append(metric); }
    
    const gapsContainer = node('div', 'schedule-gaps');
    const gapsTitle = node('div', 'schedule-gaps-title', 'فاصله بین کلاس‌ها:');
    const gapsList = node('div', 'schedule-gaps-list');
    const daysWithClasses = new Set(schedule.groups.flatMap(g => g.sessions.map(s => s.day)));
    let hasIncompleteTimes = false;
    let hasAnyGaps = false;
    for (const group of schedule.groups) {
      if (group.sessions.some(s => s.start == null || s.end == null)) {
        hasIncompleteTimes = true;
      }
    }
    if (hasIncompleteTimes) {
      gapsList.append(node('div', 'schedule-gaps-warning', 'محاسبه فاصله برای برخی کلاس‌ها ممکن نبود.'));
      hasAnyGaps = true;
    } else {
      for (let dayIndex = 0; dayIndex <= 6; dayIndex++) {
        if (!daysWithClasses.has(dayIndex)) continue;
        const daySessions = schedule.groups.flatMap(g => 
          g.sessions.filter(s => s.day === dayIndex)
        );
        const gaps = calculateGapsForSessions(daySessions);
        const formattedGaps = formatGapsForDay(gaps);
        const gapsItem = node('div', 'schedule-gaps-item', `${days[dayIndex]}: ${formattedGaps}`);
        gapsList.append(gapsItem);
        hasAnyGaps = true;
      }
    }
    if (hasAnyGaps) {
      gapsContainer.append(gapsTitle, gapsList);
      section.append(head, node('p', 'schedule-meta', `${unitDescription(schedule, target)} · بدون تداخل قطعی امتحان`), metrics, weeklyRows(schedule), gapsContainer);
    } else {
      section.append(head, node('p', 'schedule-meta', `${unitDescription(schedule, target)} · بدون تداخل قطعی امتحان`), metrics, weeklyRows(schedule));
    }
    const detail = document.createElement('details');
    const summary = document.createElement('summary'); summary.textContent = 'مشاهده جزئیات'; detail.append(summary);
    for (const group of schedule.groups) {
      const course = node('div', 'schedule-course');
      course.append(node('strong', '', group.title), node('small', '', `${formatSessions(group.sessions)} · ${group.instructor || 'استاد اعلام نشده'}`));
      detail.append(course);
    }
    const controls = node('div', 'schedule-controls');
    const compared = comparedScheduleSignatures.has(signature);
    const compare = node('button', '', compared ? 'حذف از مقایسه' : 'مقایسه'); compare.type = 'button'; compare.dataset.compareSchedule = signature;
    compare.setAttribute('aria-pressed', String(compared)); compare.setAttribute('aria-label', `${compared ? 'حذف' : 'افزودن'} برنامه ${persianDigits(index + 1)} ${compared ? 'از' : 'به'} مقایسه`);
    const pdf = node('button', '', 'دانلود PDF'); pdf.type = 'button'; pdf.dataset.printSchedule = signature; pdf.setAttribute('aria-label', `دانلود PDF برنامه ${persianDigits(index + 1)}`);
    controls.append(compare, pdf); section.append(detail, controls);
    fragment.append(section);
  });
  if (items.length > visibleScheduleCount) { const more = node('button', 'load-more', 'نمایش برنامه‌های بیشتر'); more.type = 'button'; more.dataset.loadMore = 'true'; fragment.append(more); }
  $('#results').replaceChildren(fragment);
  renderComparison();
}

function targetUnits() {
  if (targetUnitsHandler && !targetUnitsHandler.isValid()) return null;
  const raw = englishDigits($('#target-units').value).trim();
  const value = raw === '' ? 20 : Number(raw);
  return Number.isInteger(value) && value >= 1 && value <= 24 ? value : null;
}

function targetCount() {
  if (targetCountHandler && !targetCountHandler.isValid()) return null;
  const raw = englishDigits($('#target-count').value).trim();
  const value = raw === '' ? null : Number(raw);
  return Number.isInteger(value) && value >= 1 && value <= 15 ? value : null;
}

function abortWorker() {
  activeWorker?.terminate(); activeWorker = null; runId += 1;
  $('#generation-indicator').dataset.loading = 'false';
  $('#results').setAttribute('aria-busy', 'false');
}

function updateDataMessage() {
  const missing = groups.filter((group) => !group.unitsKnown).length;
  const matched = confirmedChartCourseIds.size;
  $('#summary-courses').textContent = persianDigits(groups.length);
  $('#summary-chart').textContent = persianDigits(matched);
  $('#summary-partial').textContent = persianDigits(missing);
  const messages = [...dataStateMessages];
  if (baseGroups.length) messages.push(missing
    ? `${persianDigits(missing)} درس نیاز به تعیین واحد دارد و در پیشنهادها استفاده نمی‌شود.`
    : 'تعداد واحد همه درس‌ها مشخص است.');
  else if (!messages.length) messages.push('هنوز فهرست درسی دریافت نشده است.');
  $('#data-message').replaceChildren(...messages.map((message) => node('span', '', message)));
}

function renderActiveFilters() {
  const definitions = [
    ['title-filter', 'نام درس', $('#title-filter').value], ['instructor-filter', 'استاد', $('#instructor-filter').value],
    ['day-filter', 'روز', $('#day-filter').selectedOptions[0]?.textContent, $('#day-filter').value !== ''],
    ['degree-filter', 'مقطع', $('#degree-filter').value], ['term-filter', 'ترم', persianDigits($('#term-filter').value)],
    ['unit-filter', 'واحد', $('#unit-filter').selectedOptions[0]?.textContent, $('#unit-filter').value !== ''],
    ['gender-filter', 'جنسیت', $('#gender-filter').selectedOptions[0]?.textContent, $('#gender-filter').value !== ''],
    ['chart-filter', 'چارت', $('#chart-filter').selectedOptions[0]?.textContent, $('#chart-filter').value !== ''],
    ['capacity-only', 'دارای ظرفیت', '', $('#capacity-only').checked],
    ['show-full', 'تکمیل‌ظرفیت', '', $('#show-full').checked],
  ];
  const fragment = document.createDocumentFragment();
  for (const [id, label, value, active = Boolean(value)] of definitions) {
    if (!active) continue;
    const chip = node('span', 'filter-chip', value ? `${label}: ${value}` : label);
    const clear = node('button', '', '×'); clear.type = 'button'; clear.dataset.clearFilter = id; clear.setAttribute('aria-label', `حذف فیلتر ${label}`); chip.append(clear); fragment.append(chip);
  }
  $('#active-filters').replaceChildren(fragment);

  const advancedSummary = document.querySelector('.advanced-filters summary');
  const hasAdvancedActive = $('#target-count').value.trim() !== '';
  if (hasAdvancedActive && !advancedSummary.querySelector('.active-dot')) {
    const dot = document.createElement('span');
    dot.className = 'active-dot';
    advancedSummary.append(dot);
  } else if (!hasAdvancedActive) {
    advancedSummary.querySelector('.active-dot')?.remove();
  }
}

async function savePreferences() {
  await chrome.storage.local.set({
    plannerPreferences: {
      targetUnits: englishDigits($('#target-units').value), targetCount: englishDigits($('#target-count').value), title: $('#title-filter').value,
      instructor: $('#instructor-filter').value, day: $('#day-filter').value,
      unit: $('#unit-filter').value, degree: $('#degree-filter').value, term: $('#term-filter').value,
      gender: $('#gender-filter').value, chartFilter: $('#chart-filter').value,
      sort: $('#sort-by').value, group: $('#group-by').value,
      showFull: $('#show-full').checked,
      capacityOnly: $('#capacity-only').checked,
      prioritizeChart: $('#prioritize-chart').checked,
      requiredGroupIds: [...requiredGroupIds], preferredGroupIds: [...preferredGroupIds], excludedGroupIds: [...excludedGroupIds],
    },
  });
}

function generate(items, target) {
  abortWorker();
  const currentRun = runId;
  $('#generation-indicator').textContent = 'در حال ساخت برنامه‌ها…';
  const targetUnits = target;
  const count = targetCount();
  $('#generation-indicator').dataset.loading = 'true';
  $('#results').setAttribute('aria-busy', 'true');
  setStatus('در حال ساخت برنامه‌ها…');
  activeWorker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  activeWorker.onmessage = ({ data }) => {
    if (currentRun !== runId) return;
    activeWorker?.terminate(); activeWorker = null;
    $('#generation-indicator').dataset.loading = 'false'; $('#results').setAttribute('aria-busy', 'false');
    if (data.error) {
      $('#generation-indicator').textContent = 'دریافت پیشنهادها کامل نشد.';
      setStatus('دریافت پیشنهادها با مشکل روبه‌رو شد. فیلترها را بررسی و دوباره تلاش کنید.', 'error'); return;
    }
    visibleScheduleCount = 8;
    renderSchedules(data.schedules, target);
    $('#generation-indicator').textContent = data.schedules.length ? 'برنامه‌ها به‌روز شدند.' : 'برنامه‌ای پیدا نشد.';
    setStatus(data.schedules.length
      ? 'برنامه‌ها بر اساس آخرین تغییرات شما به‌روزرسانی شدند.'
      : 'برنامه‌ای با این شرایط پیدا نشد.', data.schedules.length ? 'success' : '');
  };
  activeWorker.onerror = () => {
    if (currentRun !== runId) return;
    abortWorker();
    $('#generation-indicator').textContent = 'دریافت پیشنهادها کامل نشد.'; $('#generation-indicator').dataset.loading = 'false'; $('#results').setAttribute('aria-busy', 'false');
    setStatus('دریافت پیشنهادها با مشکل روبه‌رو شد. داده‌ها محفوظ‌اند؛ دوباره تلاش کنید.', 'error');
  };
  activeWorker.postMessage({ groups: items, options: {
    targetUnits: target, targetCount: count, maxUnits: 30, maxCourses: 15,
    requiredGroupIds: [...requiredGroupIds], preferredGroupIds: [...preferredGroupIds],
    passedCourseIds: passedIds(), limit: 20, prioritizeChart: $('#prioritize-chart').checked,
  } });
}

async function refresh({ resetScroll = false } = {}) {
  const target = targetUnits();
  const items = filterGroups();
  renderCourses(items, resetScroll);
  updateDataMessage();
  renderActiveFilters();
  void savePreferences().catch(() => setStatus('ذخیره تنظیمات مرورگر با مشکل روبه‌رو شد.', 'error'));
  if (target == null || (targetUnitsHandler && !targetUnitsHandler.isValid()) || (targetCountHandler && !targetCountHandler.isValid())) {
    abortWorker(); showEmpty($('#results'), 'تعداد واحد هدف باید عددی بین ۱ تا ۲۴ باشد.'); setStatus('تعداد واحد هدف یا تعداد درس معتبر نیست.', 'error'); return;
  }
  if (!baseGroups.length) {
    abortWorker();
    showEmpty($('#results'), dataStatus === 'loading-live' ? 'در حال دریافت فهرست فعلی دروس…' : 'هنوز درسی برای ساخت برنامه دریافت نشده است.');
    if (dataStatus !== 'loading-live') setStatus('هنوز درسی برای نمایش پیدا نشده است.');
    return;
  }
  const candidates = items.filter((group) => !excludedGroupIds.has(group.id));
  if (!candidates.length) {
    abortWorker(); showEmpty($('#results'), 'همه درس‌ها با فیلتر یا انتخاب حذف کنار گذاشته شده‌اند.'); setStatus('درسی برای پیشنهاد باقی نمانده است.'); return;
  }
  generate(candidates, target);
}

function requestRefresh(resetScroll = true) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => void refresh({ resetScroll }), 250);
}

function rebuildGroups() {
  const reconciled = reconcileChart(baseGroups, chartItems, manualMatches);
  groups = reconciled.groups.map((group) => {
    const override = unitOverrides[group.courseId];
    if (!override) return group;
    const chartItem = chartItems.find((item) => item.id === override.chartItemId);
    return {
      ...group,
      units: override.units,
      unitsKnown: true,
      unitMatch: {
        courseId: group.courseId,
        rawTitle: group.rawTitle ?? group.title,
        normalizedTitle: normalizeCourseName(group.title),
        matchedTitle: chartItem?.name ?? group.title,
        units: override.units,
        strategy: 'alias',
        confidence: 1,
      },
    };
  });
  chartItems = reconciled.items;
  groupsVersion += 1;
  filterCache = { key: '', value: [] };
  groupSearchIndex.clear();
  confirmedChartCourseIds.clear();
  for (const group of groups) {
    groupSearchIndex.set(group.id, { title: normalizeCourseName(group.title), instructor: normalizeCourseName(group.instructor ?? '') });
    if (group.chartStatus === 'matched') confirmedChartCourseIds.add(group.courseId);
  }
  fillFacet('#degree-filter', groups.map((group) => group.degree));
  fillFacet('#term-filter', groups.map((group) => group.termId));
  renderUnitReview();
  if (globalThis.__SADA_DEBUG_UNITS__) {
    console.debug('SADA unit matching', Object.fromEntries(Object.entries(Object.groupBy(groups, (group) => group.unitMatch?.strategy ?? 'unresolved')).map(([strategy, items]) => [strategy, items.length])));
  }
}

function renderUnitReview() {
  const unresolved = [...new Map(groups.filter((group) => !group.unitsKnown).map((group) => [group.courseId, group])).values()];
  const panel = $('#unit-review-panel');
  panel.hidden = !unresolved.length;
  $('#unit-review-summary').textContent = unresolved.length ? `${persianDigits(unresolved.length)} درس در پیشنهادها استفاده نمی‌شود` : '';
  const candidates = chartItems.filter((item) => Number(item.units) > 0 && item.status !== 'needs_review');
  const fragment = document.createDocumentFragment();
  for (const group of unresolved) {
    const row = node('div', 'unit-review-row'); row.dataset.courseId = group.courseId;
    const name = node('div', 'unit-review-name');
    name.append(node('strong', '', group.title), node('small', '', `عنوان تطبیق: ${normalizeCourseName(group.title)}`));
    const chartLabel = node('label'); chartLabel.append(node('span', '', 'درس متناظر در چارت'));
    const select = document.createElement('select'); select.dataset.unitChart = 'true';
    select.append(new Option('انتخاب از چارت', ''), ...candidates.map((item) => new Option(`${item.name} — ${persianDigits(item.units)} واحد`, item.id)));
    chartLabel.append(select);
    const unitLabel = node('label'); unitLabel.append(node('span', '', 'تعداد واحد'));
    const input = document.createElement('input'); input.type = 'text'; input.dataset.unitValue = 'true'; input.setAttribute('aria-label', `تعداد واحد ${group.title}`);
    const errorSpan = node('span', 'input-error-msg');
    unitLabel.append(input, errorSpan);
    const save = node('button', 'button-primary', 'ثبت اصلاح'); save.type = 'button'; save.dataset.unitSave = 'true';
    row.append(name, chartLabel, unitLabel, save); fragment.append(row);
    new IntegerInputHandler(input, {
      min: 1, max: 10, required: true, label: 'تعداد واحد', errorContainer: errorSpan
    });
  }
  $('#unit-review-list').replaceChildren(fragment);
}

function fillFacet(selector, values) {
  const select = $(selector);
  const selected = select.value;
  const options = [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fa'));
  select.replaceChildren(new Option(selector === '#degree-filter' ? 'همه مقاطع' : 'همه ترم‌ها', ''), ...options.map((value) => new Option(persianDigits(value), value)));
  if (options.includes(selected)) select.value = selected;
}

function chartStats() {
  const reviewedItems = pendingChartItems ?? chartItems;
  const diagnostics = pendingChartDiagnostics ?? chartDiagnostics;
  if (!reviewedItems.length) {
    $('#chart-stats').replaceChildren();
    $('#chart-review').hidden = true;
    $('#chart-diagnostics').hidden = true;
    renderChartReview();
    return;
  }
  const stats = [
    ['درس شناسایی‌شده', reviewedItems.length],
    ['اطلاعات ناقص', reviewedItems.filter((item) => item.status === 'needs_review').length],
    ['ردیف تکراری', reviewedItems.filter((item) => item.candidateUnits?.length).length],
    ['واحد پیدا نشده', reviewedItems.filter((item) => !(Number(item.units) > 0)).length],
    ['تطبیق قطعی', reviewedItems.filter((item) => item.status === 'matched').length],
  ];
  $('#chart-stats').replaceChildren(...stats.map(([label, count]) => node('span', 'stat', `${label}: ${persianDigits(count)}`)));
  $('#chart-review').hidden = !reviewedItems.length;
  renderChartDiagnostics(diagnostics);
  renderChartReview();
}

function renderChartDiagnostics(diagnostics) {
  const values = diagnostics && [
    ['روش استخراج', diagnostics.strategy === 'xml' ? 'XML مستقیم' : 'HTML پشتیبان'],
    ['جدول پیدا‌شده', diagnostics.tablesFound ?? 0],
    ['ردیف بررسی‌شده', diagnostics.rowsFound ?? 0],
    ['الگوی ستونی', diagnostics.schemasDetected ?? 0],
    ['ادغام افقی', diagnostics.horizontalMerges ?? 0],
    ['ادغام عمودی', diagnostics.verticalMerges ?? 0],
    ['ردیف ردشده', diagnostics.rejectedRows?.length ?? 0],
    ['رکورد تکراری', diagnostics.duplicateRecords ?? 0],
    ['مقدار عددی نامعتبر', diagnostics.malformedNumericValues ?? 0],
  ];
  $('#chart-diagnostics').hidden = !values;
  $('#chart-diagnostics-list').replaceChildren(...(values ?? []).flatMap(([label, value]) => [node('dt', '', label), node('dd', '', value)]));
}

function renderChartReview() {
  const list = $('#chart-review-list');
  const reviewedItems = pendingChartItems ?? chartItems;
  if (!reviewedItems.length) { list.replaceChildren(); return; }
  const fragment = document.createDocumentFragment();
  for (const item of reviewedItems.slice(0, chartReviewLimit)) {
    const row = node('div', 'review-row'); row.dataset.itemId = item.id;
    const name = document.createElement('input'); name.value = persianDigits(item.name); name.dataset.field = 'name'; name.setAttribute('aria-label', 'نام درس در چارت');
    const units = document.createElement('input'); units.type = 'text'; units.inputMode = 'decimal'; units.value = item.units == null ? '' : persianDigits(item.units); units.dataset.field = 'units'; units.setAttribute('aria-label', 'تعداد واحد');
    row.append(name, units, badge(item.status));
    const match = node('div', 'review-action');
    const matchedGroup = groups.find((group) => group.courseId === item.matchCourseId);
    if (item.status === 'probable_match' && matchedGroup) {
      match.append(node('span', '', `پیشنهاد: ${matchedGroup.title}`));
      const confirm = node('button', '', 'تأیید تطبیق'); confirm.type = 'button'; confirm.dataset.confirmId = item.id; confirm.dataset.courseId = matchedGroup.courseId; match.append(confirm);
    } else match.append(node('small', '', matchedGroup ? `← ${matchedGroup.title}` : item.note || 'برای تطبیق، نام را ویرایش کنید.'));
    const remove = node('button', 'button-ghost danger', 'حذف'); remove.type = 'button'; remove.dataset.removeChartItem = item.id; match.append(remove);
    row.append(match); fragment.append(row);
  }
  if (reviewedItems.length > chartReviewLimit) {
    const more = node('button', 'button-secondary review-more', `نمایش ${Math.min(100, reviewedItems.length - chartReviewLimit)} مورد بعد`);
    more.type = 'button'; more.dataset.moreChart = 'true'; fragment.append(more);
  }
  list.replaceChildren(fragment);
}

async function persistChart() {
  await chrome.storage.local.set({ chartData: { items: chartItems, diagnostics: chartDiagnostics, manualMatches, savedAt: Date.now() } });
}

async function processChart(file) {
  $('#chart-progress').dataset.kind = '';
  $('#chart-panel').open = true;
  $('#chart-progress').textContent = 'در حال بارگذاری موتور چارت…';
  $('#chart-file-meta').textContent = persianDigits(`${file.name} · ${(file.size / 1024).toFixed(1).replace('.', '٫')} کیلوبایت`);
  $('#remove-chart').hidden = true;
  try {
    await ensureMammoth();
    $('#chart-progress').textContent = 'در حال خواندن و بررسی جدول‌های فایل…';
    const parsed = await parseChartFile(file);
    pendingChartDiagnostics = parsed.diagnostics ?? null;
    chartReviewLimit = 100;
    pendingChartItems = reconcileChart(baseGroups, parsed, {}).items;
    pendingManualMatches = {};
    $('#confirm-chart').hidden = false;
    $('#chart-progress').textContent = pendingChartDiagnostics?.recordsNeedingReview
      ? 'بعضی ردیف‌ها با اطمینان کامل تفسیر نشدند؛ لطفاً موارد علامت‌خورده را بازبینی کنید.'
      : 'چارت خوانده شد؛ پس از بازبینی، آن را تأیید و اعمال کنید.';
    $('#chart-summary-action').textContent = `${persianDigits(pendingChartItems.length)} درس آماده بازبینی`;
    $('#remove-chart').hidden = false;
    chartStats();
  } catch (error) {
    $('#chart-progress').dataset.kind = 'error';
    $('#chart-progress').textContent = error instanceof Error ? error.message : 'نتوانستیم اطلاعات قابل‌استفاده‌ای از این فایل پیدا کنیم. لطفاً ساختار جدول یا فرمت فایل را بررسی کنید.';
    setStatus('فایل انتخاب‌شده قابل خواندن نیست. لطفاً فایل دیگری انتخاب کنید.', 'error');
  } finally { $('#chart-file').value = ''; }
}

function openDetail(group) {
  const container = $('#course-detail');
  container.replaceChildren(node('h2', '', group.title));
  const list = node('dl', 'detail-list');
  const details = [
    ['استاد', group.instructor || 'اعلام نشده'], ['زمان کلاس', formatSessions(group.sessions)],
    ['امتحان', formatExam(group.exam)], ['مقطع و ترم', formatDegreeTerm(group.degree, group.termId)],
    ['تعداد واحد', group.unitsKnown ? `${persianDigits(group.units)} واحد` : 'نامشخص'],
    ['ظرفیت', formatCapacity(group.capacity)], ['شهریه', formatTuition(group.tuition)],
    ['وضعیت چارت', chartLabels[group.chartStatus]], ['یادداشت داده', (group.sourceWarnings ?? []).join('، ') || 'ندارد'],
  ];
  if (group.genderEligibility === 'male' || group.genderEligibility === 'female') {
    details.splice(6, 0, ['جنسیت مجاز', group.genderEligibility === 'male' ? 'ویژه آقایان' : 'ویژه بانوان']);
  } else if (group.genderEligibility === 'ambiguous') details.splice(6, 0, ['جنسیت مجاز', 'مبهم؛ در فیلتر جنسیتی نمایش داده نمی‌شود']);
  for (const [label, value] of details) list.append(node('dt', '', label), node('dd', '', value));
  const actions = node('div', 'detail-actions');
  actions.append(actionButton('required', 'اجباری', group), actionButton('preferred', 'ترجیح', group), actionButton('excluded', 'حذف از پیشنهادها', group));
  container.append(list, node('h3', '', 'نقش درس در پیشنهادها'), actions); $('#course-dialog').showModal();
}

function exportRows() {
  const compared = schedules.filter((schedule) => comparedScheduleSignatures.has(scheduleSignature(schedule)));
  return (compared.length ? compared : schedules).flatMap((schedule, index) => schedule.groups.map((group) => [persianDigits(index + 1), persianDigits(schedule.units), persianDigits(group.title), persianDigits(group.instructor ?? ''), formatSessions(group.sessions), formatExam(group.exam), formatDegreeTerm(group.degree, group.termId), formatCapacity(group.capacity), formatTuition(group.tuition)]));
}

function download(content, type, name) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = Object.assign(document.createElement('a'), { href: url, download: name }); link.click(); URL.revokeObjectURL(url);
}



async function printSchedules(items) {
  if (printing) return;
  if (!items.length) return;
  const popup = window.open('about:blank', '_blank');
  if (!popup) { setStatus('ساخت فایل PDF با مشکل روبه‌رو شد. دوباره تلاش کنید.', 'error'); return; }
  printing = true;
  for (const button of document.querySelectorAll('[data-print-schedule]')) button.disabled = true;
  setStatus('در حال آماده‌کردن فایل PDF…');
  const key = `print-${crypto.randomUUID()}`;
  try {
    const printable = items.map((schedule) => ({ ...schedule, printNumber: schedules.indexOf(schedule) + 1 }));
    const { buildPrintModel } = await import('./lib/print-model.js');
    await chrome.storage.session.set({ [key]: buildPrintModel(printable) });
    popup.location.href = chrome.runtime.getURL(`print.html?key=${encodeURIComponent(key)}`);
  } catch {
    popup.close();
    setStatus('ساخت فایل PDF با مشکل روبه‌رو شد. دوباره تلاش کنید.', 'error');
  } finally {
    printing = false;
    for (const button of document.querySelectorAll('[data-print-schedule]')) button.disabled = false;
  }
}

function toggleGroupAction(button) {
  const selected = button.dataset.action === 'required' ? requiredGroupIds : button.dataset.action === 'preferred' ? preferredGroupIds : excludedGroupIds;
  const id = button.dataset.groupId;
  if (selected.has(id)) selected.delete(id);
  else {
    selected.add(id);
    if (button.dataset.action === 'excluded') { requiredGroupIds.delete(id); preferredGroupIds.delete(id); }
    else excludedGroupIds.delete(id);
  }
  $('#course-dialog').close();
  requestRefresh(false);
}

$('#course-scroll').addEventListener('scroll', () => {
  cancelAnimationFrame(renderFrame); renderFrame = requestAnimationFrame(renderVirtualWindow);
});
$('#course-list').addEventListener('click', (event) => {
  const groupHeader = event.target.closest('[data-group-key]');
  if (groupHeader) {
    const key = `${$('#group-by').value}:${groupHeader.dataset.groupKey}`;
    collapsedGroups.has(key) ? collapsedGroups.delete(key) : collapsedGroups.add(key); requestRefresh(false); return;
  }
  const detail = event.target.closest('[data-detail-id]');
  if (detail) { const group = groups.find((item) => item.id === detail.dataset.detailId); if (group) openDetail(group); return; }
});

$('#course-dialog').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-group-id]');
  if (button) toggleGroupAction(button);
});


for (const selector of ['#title-filter', '#instructor-filter']) $(selector).addEventListener('input', (event) => { event.target.value = persianDigits(event.target.value); requestRefresh(); });
for (const selector of ['#day-filter', '#unit-filter', '#degree-filter', '#term-filter', '#gender-filter', '#chart-filter', '#sort-by', '#group-by', '#capacity-only', '#show-full', '#prioritize-chart']) $(selector).addEventListener('change', () => requestRefresh());

let filterReturnFocus = null;
function setFilterSheet(open) {
  if (open) filterReturnFocus = document.activeElement;
  $('#filter-panel').classList.toggle('is-open', open); $('#filter-scrim').classList.toggle('is-open', open);
  $('#filter-toggle').setAttribute('aria-expanded', String(open));
  if (open) {
    $('#filter-panel').setAttribute('role', 'dialog');
    $('#filter-panel').setAttribute('aria-modal', 'true');
    $('#filter-panel').setAttribute('aria-label', 'فیلتر درس‌ها');
  } else {
    $('#filter-panel').removeAttribute('role');
    $('#filter-panel').removeAttribute('aria-modal');
    $('#filter-panel').removeAttribute('aria-label');
  }
  document.body.classList.toggle('sheet-open', open);
  if (open) requestAnimationFrame(() => $('#filter-close').focus());
  else if (filterReturnFocus instanceof HTMLElement) filterReturnFocus.focus();
}
$('#filter-toggle').addEventListener('click', () => setFilterSheet(true));
$('#filter-close').addEventListener('click', () => setFilterSheet(false));
$('#filter-scrim').addEventListener('click', () => setFilterSheet(false));
document.addEventListener('keydown', (event) => {
  const panel = $('#filter-panel');
  if (!panel.classList.contains('is-open')) return;
  if (event.key === 'Escape') { setFilterSheet(false); return; }
  if (event.key !== 'Tab') return;
  const focusable = [...panel.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')]
    .filter((element) => element.getClientRects().length > 0);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});
window.addEventListener('message', (event) => {
  if (event.origin !== location.origin || event.data?.kind !== 'schedule-print') return;
  setStatus(event.data.ok ? 'فایل برنامه با موفقیت آماده شد.' : 'ساخت فایل PDF با مشکل روبه‌رو شد. دوباره تلاش کنید.', event.data.ok ? 'success' : 'error');
});
$('#active-filters').addEventListener('click', (event) => {
  const button = event.target.closest('[data-clear-filter]'); if (!button) return;
  const control = document.getElementById(button.dataset.clearFilter);
  if (control.type === 'checkbox') control.checked = false; else control.value = '';
  requestRefresh();
});

$('#results').addEventListener('click', async (event) => {
  const more = event.target.closest('[data-load-more]');
  if (more) { visibleScheduleCount += 8; renderSchedules(schedules, targetUnits()); return; }
  const compare = event.target.closest('[data-compare-schedule]');
  if (compare) {
    const signature = compare.dataset.compareSchedule;
    const selected = comparedScheduleSignatures.has(signature);
    if (!selected && comparedScheduleSignatures.size >= 2) { setStatus('حداکثر دو برنامه قابل مقایسه است؛ ابتدا یکی را حذف کنید.'); return; }
    selected ? comparedScheduleSignatures.delete(signature) : comparedScheduleSignatures.add(signature);
    compare.textContent = selected ? 'مقایسه' : 'حذف از مقایسه';
    compare.setAttribute('aria-pressed', String(!selected));
    compare.setAttribute('aria-label', `${selected ? 'افزودن' : 'حذف'} این برنامه ${selected ? 'به' : 'از'} مقایسه`);
    compare.closest('.schedule').dataset.compared = String(!selected);
    renderComparison();
    setStatus(selected ? 'برنامه از مقایسه حذف شد.' : 'برنامه برای مقایسه انتخاب شد.', 'success');
    return;
  }
  const print = event.target.closest('[data-print-schedule]');
  if (print) { const schedule = schedules.find((item) => scheduleSignature(item) === print.dataset.printSchedule); if (schedule) await printSchedules([schedule]); return; }
});

$('#chart-file').addEventListener('change', (event) => { const [file] = event.target.files; if (file) void processChart(file); });
for (const type of ['dragenter', 'dragover']) $('#chart-drop').addEventListener(type, (event) => { event.preventDefault(); $('#chart-drop').dataset.drag = 'true'; });
for (const type of ['dragleave', 'drop']) $('#chart-drop').addEventListener(type, (event) => { event.preventDefault(); $('#chart-drop').dataset.drag = 'false'; });
$('#chart-drop').addEventListener('drop', (event) => { const [file] = event.dataTransfer.files; if (file) void processChart(file); });
$('#remove-chart').addEventListener('click', async () => {
  if (pendingChartItems) {
    pendingChartItems = null; pendingChartDiagnostics = null; pendingManualMatches = null;
    $('#confirm-chart').hidden = true; $('#chart-progress').textContent = chartItems.length ? 'چارت قبلی همچنان فعال است.' : '';
    $('#chart-file-meta').textContent = chartItems.length ? `چارت ذخیره‌شده · ${persianDigits(chartItems.length)} درس` : 'هنوز فایلی انتخاب نشده است.';
    $('#chart-summary-action').textContent = chartItems.length ? `${persianDigits(chartItems.length)} درس آماده` : 'افزودن فایل';
    chartStats(); return;
  }
  chartItems = []; chartDiagnostics = null; manualMatches = {}; rebuildGroups(); await chrome.storage.local.remove('chartData');
  $('#confirm-chart').hidden = true;
  $('#chart-file-meta').textContent = 'هنوز فایلی انتخاب نشده است.'; $('#chart-progress').textContent = ''; $('#chart-summary-action').textContent = 'افزودن فایل'; $('#remove-chart').hidden = true; chartStats(); requestRefresh(false);
});
$('#confirm-chart').addEventListener('click', async () => {
  if (!pendingChartItems?.length) return;
  chartItems = pendingChartItems; chartDiagnostics = pendingChartDiagnostics;
  manualMatches = pendingManualMatches ?? {};
  pendingChartItems = null; pendingChartDiagnostics = null; pendingManualMatches = null;
  rebuildGroups(); await persistChart(); $('#confirm-chart').hidden = true;
  $('#chart-progress').textContent = 'چارت تأیید شد و در ساخت پیشنهادها اعمال می‌شود.';
  $('#chart-summary-action').textContent = `${persianDigits(chartItems.length)} درس آماده`;
  chartStats(); requestRefresh(false);
});
$('#chart-review-list').addEventListener('change', async (event) => {
  const row = event.target.closest('[data-item-id]'); if (!row) return;
  const reviewedItems = pendingChartItems ?? chartItems;
  const item = reviewedItems.find((entry) => entry.id === row.dataset.itemId); if (!item) return;
  if (event.target.dataset.field === 'name') {
    item.name = event.target.value.trim(); item.status = 'unmatched_chart_item'; item.matchCourseId = null; item.confidence = 0;
  }
  if (event.target.dataset.field === 'units') {
    event.target.value = persianDigits(englishDigits(event.target.value));
    const units = Number(englishDigits(event.target.value).replace('٫', '.'));
    if (units > 0 && units <= 10) {
      item.units = units; item.status = 'unmatched_chart_item'; delete item.candidateUnits; delete item.note;
    }
  }
  if (!pendingChartItems) { rebuildGroups(); await persistChart(); requestRefresh(false); }
  chartStats();
});
$('#chart-review-list').addEventListener('click', async (event) => {
  if (event.target.closest('[data-more-chart]')) { chartReviewLimit += 100; renderChartReview(); return; }
  const remove = event.target.closest('[data-remove-chart-item]');
  if (remove) {
    const target = pendingChartItems ?? chartItems;
    const index = target.findIndex((item) => item.id === remove.dataset.removeChartItem);
    if (index >= 0) target.splice(index, 1);
    delete (pendingChartItems ? pendingManualMatches : manualMatches)[remove.dataset.removeChartItem];
    if (pendingChartItems && !pendingChartItems.length) { $('#confirm-chart').hidden = true; $('#chart-progress').textContent = 'همه ردیف‌ها حذف شدند؛ فایل دیگری انتخاب کنید.'; }
    if (!pendingChartItems) { rebuildGroups(); await persistChart(); requestRefresh(false); }
    chartStats(); return;
  }
  const button = event.target.closest('[data-confirm-id]'); if (!button) return;
  if (pendingChartItems) {
    pendingManualMatches[button.dataset.confirmId] = button.dataset.courseId;
    const item = pendingChartItems.find((entry) => entry.id === button.dataset.confirmId);
    if (item) { item.matchCourseId = button.dataset.courseId; item.status = 'matched'; item.confidence = 1; }
  } else {
    manualMatches[button.dataset.confirmId] = button.dataset.courseId; rebuildGroups(); await persistChart(); requestRefresh(false);
  }
  chartStats();
});

$('#unit-review-list').addEventListener('change', (event) => {
  const select = event.target.closest('[data-unit-chart]');
  if (!select) return;
  const item = chartItems.find((candidate) => candidate.id === select.value);
  const input = select.closest('[data-course-id]').querySelector('[data-unit-value]');
  if (item) input.value = persianDigits(item.units);
});

$('#unit-review-list').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-unit-save]');
  if (!button) return;
  const row = button.closest('[data-course-id]');
  try {
    const units = validUnits(englishDigits(row.querySelector('[data-unit-value]').value).replace('٫', '.'));
    unitOverrides[row.dataset.courseId] = {
      units,
      chartItemId: row.querySelector('[data-unit-chart]').value || null,
      savedAt: Date.now(),
    };
    await chrome.storage.local.set({ unitOverrides });
    rebuildGroups();
    requestRefresh(false);
    setStatus('تعداد واحد ثبت شد و پیشنهادها دوباره ساخته می‌شوند.', 'success');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'تعداد واحد معتبر نیست.', 'error');
  }
});

async function persistCompletedCourses() {
  await chrome.storage.local.set({ completedCourses });
}

$('#manual-completed-course').addEventListener('submit', async (event) => {
  event.preventDefault();
  const title = $('#completed-course-title').value.trim();
  if (!title) return;
  try {
    const rawUnits = englishDigits($('#completed-course-units').value).replace('٫', '.').trim();
    const units = rawUnits ? validUnits(rawUnits) : null;
    normalizeCompletedCourses([...completedCourses, {
      title,
      courseId: $('#completed-course-code').value,
      units,
      source: 'manual',
    }]);
    await persistCompletedCourses();
    renderCompletedCourses();
    event.target.reset();
    requestRefresh(false);
    setStatus('درس گذرانده‌شده ثبت و از پیشنهادها حذف شد.', 'success');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'اطلاعات درس معتبر نیست.', 'error');
  }
});

$('#completed-courses-list').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-remove-completed-course]');
  if (!button) return;
  completedCourses = completedCourses.filter((course) => course.id !== button.dataset.removeCompletedCourse);
  normalizeCompletedCourses(completedCourses);
  await persistCompletedCourses();
  renderCompletedCourses();
  requestRefresh(false);
  setStatus('درس از فهرست گذرانده‌شده‌ها حذف شد.', 'success');
});

$('#extract-completed-courses').addEventListener('click', async () => {
  const button = $('#extract-completed-courses');
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  setStatus('در حال استخراج درس‌های گذرانده‌شده از کارنامه…');
  try {
    const response = await chrome.runtime.sendMessage({ type: 'EXTRACT_COMPLETED_COURSES', requestId: crypto.randomUUID() });
    if (response?.success === false || !response?.success) throw new Error(response?.errorCode ?? 'TRANSCRIPT_EXTRACTION_FAILED');
    normalizeCompletedCourses(response.courses);
    renderCompletedCourses();
    requestRefresh(false);
    setStatus(response.extracted
      ? `${persianDigits(response.extracted)} درس پاس‌شده از کارنامه استخراج شد.`
      : 'جدول کارنامه خوانده شد؛ درس پاس‌شدهٔ جدیدی پیدا نشد.', 'success');
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    const message = code === 'TRANSCRIPT_NOT_FOUND'
      ? 'جدول «دروس ترمی» پیدا نشد؛ در تب اصلی سادا کارنامه ترمی را باز کنید.'
      : code === 'CONTENT_SCRIPT_VERSION_MISMATCH'
        ? 'افزونه یا صفحهٔ سادا قدیمی است؛ افزونه و سپس صفحهٔ سادا را Reload کنید.'
        : 'استخراج کارنامه کامل نشد. صفحه «کارنامه ترمی ← دروس ترمی» را باز و دوباره تلاش کنید.';
    setStatus(message, 'error');
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
});



function formattedUpdateTime(value) {
  if (!Number.isFinite(value) || value <= 0) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date();
  const time = new Intl.DateTimeFormat('fa-IR', { hour: '2-digit', minute: '2-digit' }).format(date);
  if (date.toDateString() === today.toDateString()) return `امروز، ساعت ${time}`;
  return new Intl.DateTimeFormat('fa-IR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function errorMessage(errorCode) {
  if (['NO_ACTIVE_TAB', 'UNSUPPORTED_PAGE'].includes(errorCode)) {
    return 'برای دریافت دروس، صفحه فهرست دروس سامانه سادا را باز کنید.';
  }
  if (['CONTENT_SCRIPT_UNAVAILABLE', 'SCRIPT_INJECTION_FAILED', 'CONTENT_SCRIPT_VERSION_MISMATCH'].includes(errorCode)) {
    return 'برای اتصال افزونه، صفحه سامانه را یکبار بازخوانی کنید.';
  }
  if (['TABLE_NOT_FOUND', 'TABLE_STRUCTURE_UNSUPPORTED', 'NO_VALID_ROWS', 'PARSING_FAILED'].includes(errorCode)) {
    return 'جدول قابلخواندن دروس در این صفحه پیدا نشد.';
  }
  if (['TABLE_NOT_READY', 'EXTRACTION_TIMEOUT'].includes(errorCode)) {
    return 'دریافت اطلاعات جدید ممکن نشد؛ آخرین اطلاعات ذخیرهشده نمایش داده میشود.';
  }
  return 'دریافت اطلاعات جدید ممکن نشد؛ آخرین اطلاعات ذخیرهشده نمایش داده میشود.';
}

function cacheStateMessages(result) {
  const extractedAt = result.dataset?.extractedAt;
  const formatted = formattedUpdateTime(extractedAt);
  if (!formatted) return ['آخرین اطلاعات ذخیره‌شده نمایش داده می‌شود.', 'زمان آخرین به‌روزرسانی این داده‌ها مشخص نیست.'];
  const stale = Date.now() - extractedAt > CACHE_STALE_AFTER_MS;
  dataStatus = stale ? 'stale' : 'cached';
  return [
    'آخرین اطلاعات ذخیره‌شده نمایش داده می‌شود.',
    `آخرین به‌روزرسانی: ${formatted}`,
    ...(stale ? ['این اطلاعات بیش از ۱۵ دقیقه پیش دریافت شده است.'] : []),
  ];
}

function applyCourseDataset(rawGroups, fingerprint, extractedAt = 0) {
  if (Number.isFinite(extractedAt) && extractedAt > 0 && extractedAt < appliedExtractedAt) return false;
  try {
    const isUnchanged = fingerprint && fingerprint === appliedFingerprint;
    appliedExtractedAt = Number.isFinite(extractedAt) ? Math.max(appliedExtractedAt, extractedAt) : appliedExtractedAt;
    if (isUnchanged) {
      return true;
    }
    baseGroups = rawGroups.map(normalizeStoredGroup);
    appliedFingerprint = fingerprint ?? appliedFingerprint;
    rebuildGroups();
    requestRefresh();
    return true;
  } catch {
    setStatus('اطلاعات استخراج‌شده معتبر نبود.', 'error');
    return false;
  }
}

let liveRequestGate;
function useCachedFallback(errorCode, diagnostic = {}) {
  setStatus(errorMessage(errorCode), 'error');
  const checked = cachedResult.dataset?.schemaVersion > 0
    ? readCachedCourseDataset({ cachedCourseDataset: cachedResult.dataset }, { sourceUrl: diagnostic.sourceUrl })
    : cachedResult;
  if (!checked.dataset?.courses?.length || ['invalid', 'provisional', 'legacy-invalid-time'].includes(checked.status)) {
    dataStatus = ['NO_ACTIVE_TAB', 'UNSUPPORTED_PAGE'].includes(errorCode) ? 'unavailable' : 'error';
    dataStateMessages = ['دریافت اطلاعات جدید ممکن نشد.', 'اطلاعات ذخیره‌شده معتبری وجود ندارد.'];
    updateDataMessage();
    return;
  }
  dataStatus = 'cached';
  applyCourseDataset(checked.dataset.courses, checked.dataset.fingerprint, checked.dataset.extractedAt ?? 0);
  dataStateMessages = ['دریافت اطلاعات جدید ممکن نشد.', ...cacheStateMessages(checked)];
  updateDataMessage();
}

async function requestLiveCourses(trigger = 'manual') {
  const now = Date.now();
  if (trigger !== 'manual' && now - lastLiveRequestAt < 1500) return;
  lastLiveRequestAt = now;
  const requestId = crypto.randomUUID();
  latestLiveRequestId = requestId;
  liveRequestGate.begin(requestId);
  $('#refresh-courses').disabled = true;
  $('#refresh-courses').setAttribute('aria-busy', 'true');
  dataStatus = 'loading-live';
  dataStateMessages = ['در حال دریافت آخرین فهرست دروس…'];
  updateDataMessage();
  setStatus('در حال دریافت آخرین فهرست دروس…');
  const withTimeout = (promise, ms) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), ms))
  ]);

  try {
    const response = await withTimeout(
      chrome.runtime.sendMessage({ type: 'REFRESH_LIVE_COURSES', requestId, trigger }),
      10000
    );
    if (!liveRequestGate.isLatest(requestId) || response?.stale) return;
    if (response?.success === false || response?.errorCode) {
      useCachedFallback(response.errorCode ?? 'LIVE_EXTRACTION_FAILED', response.diagnostic);
      return;
    }
    const isNewResponse = liveRequestGate.accept(response);
    if (isNewResponse && response.fingerprint !== appliedFingerprint) {
      applyCourseDataset(response.groups, response.fingerprint, response.meta?.extractedAt);
    }
    cachedResult = { status: 'valid', dataset: response.meta };
    dataStatus = 'fresh';
    dataStateMessages = [`آخرین به‌روزرسانی: ${formattedUpdateTime(response.meta?.extractedAt)}`, 'نمایش اطلاعات مختص ردیف‌های قابل‌مشاهده در صفحه فعلی سامانه است.'];
    updateDataMessage();
    if (globalThis.__SADA_DEBUG_LIVE__) console.debug('SADA live refresh', response.diagnostic);
    setStatus('فهرست دروس با اطلاعات فعلی سامانه به‌روزرسانی شد.', 'success');
  } catch {
    if (!liveRequestGate.isLatest(requestId)) return;
    useCachedFallback('LIVE_EXTRACTION_FAILED');
  } finally {
    if (latestLiveRequestId === requestId) {
      $('#refresh-courses').disabled = false;
      $('#refresh-courses').removeAttribute('aria-busy');
    }
  }
}

$('#refresh-courses').addEventListener('click', () => void requestLiveCourses('manual'));

const stored = await chrome.storage.local.get([
  'cachedCourseDataset', 'rawGroups', 'courseDataMeta', 'lastImportedAt',
  'plannerPreferences', 'chartData', 'unitOverrides', 'completedCourses',
]);
cachedResult = readCachedCourseDataset(stored);
if (cachedResult.status === 'migrated') {
  await chrome.storage.local.set({ cachedCourseDataset: cachedResult.dataset });
  await chrome.storage.local.remove(['rawGroups', 'courseDataMeta', 'lastImportedAt']);
}
if (cachedResult.status === 'valid' || cachedResult.status === 'migrated' || cachedResult.status === 'provisional') {
  const dataset = cachedResult.dataset;
  if (dataset && Array.isArray(dataset.courses) && dataset.courses.length > 0) {
    applyCourseDataset(dataset.courses, dataset.fingerprint, dataset.extractedAt ?? 0);
    dataStatus = 'cached';
    dataStateMessages = cacheStateMessages(cachedResult);
    updateDataMessage();
  }
}
liveRequestGate = createRequestGate();
dataStateMessages = ['در حال دریافت آخرین فهرست دروس…'];
chartItems = stored.chartData?.items ?? [];
chartDiagnostics = stored.chartData?.diagnostics ?? null;
manualMatches = stored.chartData?.manualMatches ?? {};
unitOverrides = stored.unitOverrides ?? {};
normalizeCompletedCourses(stored.completedCourses);
rebuildGroups();
renderCompletedCourses();
if (chartItems.length) { $('#chart-file-meta').textContent = `چارت ذخیره‌شده · ${persianDigits(chartItems.length)} درس`; $('#chart-summary-action').textContent = `${persianDigits(chartItems.length)} درس آماده`; $('#remove-chart').hidden = false; $('#chart-progress').textContent = 'اطلاعات چارت ذخیره‌شده آماده است.'; chartStats(); }

const preferences = stored.plannerPreferences ?? {};
$('#target-units').value = persianDigits(preferences.targetUnits || '20'); $('#target-count').value = persianDigits(preferences.targetCount ?? ''); $('#title-filter').value = preferences.title ?? ''; $('#instructor-filter').value = preferences.instructor ?? '';
targetUnitsHandler = new IntegerInputHandler($('#target-units'), {
  min: 1, max: 24, required: true, label: 'تعداد واحد', errorContainerId: 'target-units-error',
  onValidInput: () => requestRefresh()
});
targetCountHandler = new IntegerInputHandler($('#target-count'), {
  min: 1, max: 15, required: false, label: 'تعداد درس', errorContainerId: 'target-count-error',
  onValidInput: () => requestRefresh()
});
$('#day-filter').value = preferences.day ?? ''; $('#unit-filter').value = preferences.unit ?? '';
$('#sort-by').value = preferences.sort ?? 'name'; $('#group-by').value = preferences.group ?? ''; $('#show-full').checked = preferences.showFull ?? false;
$('#gender-filter').value = preferences.gender ?? ''; $('#chart-filter').value = preferences.chartFilter ?? (preferences.chartOnly ? 'matched' : '');
$('#capacity-only').checked = preferences.capacityOnly ?? false;
$('#prioritize-chart').checked = preferences.prioritizeChart ?? true;
fillFacet('#degree-filter', groups.map((group) => group.degree)); fillFacet('#term-filter', groups.map((group) => group.termId));
$('#degree-filter').value = preferences.degree ?? ''; $('#term-filter').value = preferences.term ?? '';
for (const id of preferences.requiredGroupIds ?? []) requiredGroupIds.add(id);
for (const id of preferences.preferredGroupIds ?? []) preferredGroupIds.add(id);
for (const id of preferences.excludedGroupIds ?? []) excludedGroupIds.add(id);
await refresh();

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes.completedCourses) {
    normalizeCompletedCourses(changes.completedCourses.newValue);
    renderCompletedCourses();
    requestRefresh(false);
  }
  const dataset = changes.cachedCourseDataset?.newValue;
  if (!dataset || dataset.extractedAt < appliedExtractedAt) return;
  const result = readCachedCourseDataset({ cachedCourseDataset: dataset });
  if (result.status !== 'valid') return;
  cachedResult = result;
  applyCourseDataset(dataset.courses, dataset.fingerprint, dataset.extractedAt);
  dataStatus = 'fresh';
  dataStateMessages = [`آخرین به‌روزرسانی: ${formattedUpdateTime(dataset.extractedAt)}`, 'نمایش اطلاعات مختص ردیف‌های قابل‌مشاهده در صفحه فعلی سامانه است.'];
  updateDataMessage();
});

window.addEventListener('focus', () => void requestLiveCourses('focus'));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void requestLiveCourses('focus');
});
void requestLiveCourses('open');
