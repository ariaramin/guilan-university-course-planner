import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyGenderEligibility, genderEligible, parseGenderRestriction, parseSadaTables, parseSessions,
} from '../extension/lib/sada-parser.js';

const tables = [{
  tableIndex: 0,
  rows: [
    ['ردیف', 'نام درس', 'استاد', 'برنامه زمانی', 'زمان امتحان', 'مقطع', 'ترم', 'ظرفیت مانده', 'کد درس'],
    ['۱', 'برنامه نویسی کامپیوتر گروه ۱', 'صادق اسکندری', 'چهارشنبه ۱۴:۰۰ - ۲۰:۰۰', '۱۴۰۵/۰۵/۱۰ ۰۹:۰۰ - ۱۱:۰۰', 'کارشناسی پیوسته', '۱۴۰۴۳', '۱', '۱۲۵۶۷۷۰۲'],
    ['۲', 'فیزیک ۲ گروه ۱', 'هانیه مرادمهر', 'دوشنبه ۱۲:۰۰ - ۰۸:۰۰', '', 'کارشناسی پیوسته', '۱۴۰۴۳', '۰', '۱۲۵۶۷۷۰۳'],
  ],
}];

test('parses the confirmed SADA offered-course columns', () => {
  const result = parseSadaTables(tables);
  assert.equal(result.groups.length, 2);
  assert.deepEqual(result.groups[0], {
    id: '12567702-1', courseId: '12567702', title: 'برنامه نویسی کامپیوتر', groupNumber: '1',
    rawTitle: 'برنامه نویسی کامپیوتر گروه ۱',
    instructor: 'صادق اسکندری', units: 0, unitsKnown: false, capacity: 1, available: true,
    degree: 'کارشناسی پیوسته', termId: '14043',
    genderEligibility: 'unspecified', genderRestriction: null,
    genderDiagnostics: {
      rawSources: ['', 'برنامه نویسی کامپیوتر گروه ۱'],
      normalizedSources: ['', 'برنامه نویسی کامپیوتر گروه 1'],
      detectedPhrases: [], finalEligibility: 'unspecified',
    },
    sessions: [{ day: 4, start: 840, end: 1200, week: 'all' }],
    exam: { date: '1405-05-10', calendar: 'jalali', start: 540, end: 660, location: null, weekday: null, raw: '1405/05/10 09:00 - 11:00' },
    tuition: null,
    sourceWarnings: [],
  });
  assert.equal(result.groups[1].available, false);
});

test('accepts only explicit gender restrictions', () => {
  assert.equal(parseGenderRestriction('ویژه آقایان'), 'male');
  assert.equal(parseGenderRestriction('بانوان'), 'female');
  assert.equal(parseGenderRestriction('مختص خواهران'), 'female');
  assert.equal(parseGenderRestriction('کلاس عمومی بانوان و آقایان'), null);
});

test('normalizes real SADA gender labels including singular words and invisible punctuation', () => {
  const male = [
    '(فقط مرد) دانش خانواده و جمعیت',
    '（فقط\u200cمرد） دانش خانواده و جمعیت',
    '\u202bویژه آقايان\u202c',
    'ویژه آقا\u200fیان',
    'مختصِ برادران',
  ];
  const female = ['فقط زن', 'مخصوص زنان', 'ویژه بانوان', 'مختص\u00a0خواهران'];
  male.forEach((value) => assert.equal(parseGenderRestriction(value), 'male', value));
  female.forEach((value) => assert.equal(parseGenderRestriction(value), 'female', value));
});

test('classifies conflicting gender signals as ambiguous and fails closed for specific filters', () => {
  const result = classifyGenderEligibility('فقط مرد - ویژه بانوان');
  assert.equal(result.eligibility, 'ambiguous');
  assert.deepEqual(result.detected, ['male', 'female']);
  assert.equal(genderEligible('ambiguous', 'male'), false);
  assert.equal(genderEligible('ambiguous', 'female'), false);
  assert.equal(genderEligible('ambiguous', ''), true);
});

test('gender filtering includes unspecified courses for either selection', () => {
  assert.equal(genderEligible('female', ''), true);
  assert.equal(genderEligible(null, 'male'), true);
  assert.equal(genderEligible('male', 'male'), true);
  assert.equal(genderEligible('female', 'male'), false);
});

test('reads an explicit gender column into the course model', () => {
  const restricted = structuredClone(tables);
  restricted[0].rows[0].push('جنسیت مجاز');
  restricted[0].rows[1].push('بانوان');
  restricted[0].rows[2].push('');
  const result = parseSadaTables(restricted);
  assert.equal(result.groups[0].genderRestriction, 'female');
  assert.equal(result.groups[1].genderRestriction, null);
});

test('cleans a detected restriction from the displayed title while preserving the raw source', () => {
  const restricted = structuredClone(tables);
  restricted[0].rows[1][1] = '（فقط\u200cمرد） دانش خانواده و جمعیت گروه ۱';
  const [group] = parseSadaTables(restricted).groups;
  assert.equal(group.title, 'دانش خانواده و جمعیت');
  assert.equal(group.rawTitle, '（فقط\u200cمرد） دانش خانواده و جمعیت گروه ۱');
  assert.equal(group.genderEligibility, 'male');
  assert.equal(group.genderDiagnostics.finalEligibility, 'male');
});

test('keeps an ambiguous record visible without a gender filter and records a warning', () => {
  const restricted = structuredClone(tables);
  restricted[0].rows[1][1] = 'فقط مرد - ویژه بانوان - درس آزمایشی گروه ۱';
  const [group] = parseSadaTables(restricted).groups;
  assert.equal(group.genderEligibility, 'ambiguous');
  assert.match(group.sourceWarnings.join(' '), /مبهم/);
  assert.equal(genderEligible(group.genderEligibility, ''), true);
  assert.equal(genderEligible(group.genderEligibility, 'male'), false);
});

test('parses multiple sessions and odd/even weeks', () => {
  assert.deepEqual(parseSessions('شنبه 08:00-10:00 ** دوشنبه 10:00 تا 12:00'), [
    { day: 0, start: 480, end: 600, week: 'all' },
    { day: 2, start: 600, end: 720, week: 'all' },
  ]);
});

test('fails closed when required headers are absent', () => {
  assert.match(parseSadaTables([{ rows: [['چیز دیگر']] }]).error, /پیدا نشد/);
});

test('supports grids that split headers and body into separate tables', () => {
  const split = [
    { tableIndex: 0, rows: [tables[0].rows[0]] },
    { tableIndex: 1, rows: [tables[0].rows[1], tables[0].rows[2]] },
  ];
  const result = parseSadaTables(split);
  assert.equal(result.groups.length, 2);
  assert.match(result.warnings.join(' '), /دو جدول جدا/);
});

test('ignores a trailing action cell in a split SADA body table', () => {
  const split = [
    { tableIndex: 0, rows: [tables[0].rows[0]] },
    { tableIndex: 1, rows: tables[0].rows.slice(1).map((row) => [...row, 'انتخاب']) },
  ];
  const result = parseSadaTables(split);
  assert.equal(result.groups.length, 2);
});
