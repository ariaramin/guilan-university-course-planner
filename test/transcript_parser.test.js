import assert from 'node:assert/strict';
import test from 'node:test';

import { parseTranscriptTables } from '../extension/lib/transcript-parser.js';

test('keeps only passed transcript courses and sums theory, practical, and workshop units', () => {
  const result = parseTranscriptTables([
    { rows: [
      ['کد درس', 'نام درس', 'واحد نظری', 'واحد عملی', 'واحد کارگاهی', 'نمره نهایی'],
      ['101', 'ریاضی عمومی', '2', '1', '0', '9.75'],
      ['101', 'ریاضی عمومی', '2', '1', '0', '۱۷٫۵'],
    ] },
    { rows: [
      ['نام درس', 'تعداد واحد', 'نمره'],
      ['آزمایشگاه فیزیک', '1', '10'],
    ] },
  ]);

  assert.equal(result.matchedTables, 2);
  assert.equal(result.rejected, 1);
  assert.deepEqual(result.courses.map(({ courseId, title, units, grade }) => ({ courseId, title, units, grade })), [
    { courseId: '101', title: 'ریاضی عمومی', units: 3, grade: 17.5 },
    { courseId: null, title: 'آزمایشگاه فیزیک', units: 1, grade: 10 },
  ]);
});

test('reads SADA term transcripts with a separate header and body table', () => {
  const result = parseTranscriptTables([
    { framePath: 'top.0', rows: [[
      'ترم', 'کد درس', 'نام درس', 'نمره', 'وضعیت نمره', 'تئوری', 'عملی', 'کارگاهی', 'طریقه اخذ', 'تاریخ اخذ',
    ]] },
    { framePath: 'top.0', rows: [
      ['14021', '12151007', 'ریاضی 1', '17.50', 'قبول', '3', '0', '0', 'انتخاب واحد', '1402/07/22'],
      ['14021', '18101014', 'تفسیر موضوعی قرآن', '8', 'مردود', '2', '0', '0', 'انتخاب واحد', '1402/07/22'],
    ] },
  ]);

  assert.deepEqual(result.courses.map(({ courseId, title, units }) => ({ courseId, title, units })), [
    { courseId: '12151007', title: 'ریاضی 1', units: 3 },
  ]);
});
