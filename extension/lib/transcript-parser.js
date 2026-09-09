import { englishDigits, normalizeSourceText } from './normalize.js';
import { normalizeCourseName } from './course-units.js';

const aliases = {
  title: ['نام درس', 'عنوان درس', 'درس'],
  courseId: ['کد درس', 'شماره درس'],
  grade: ['نمره نهایی', 'نمره کل', 'نمره'],
  units: ['تعداد واحد', 'واحد'],
  theory: ['واحد نظری', 'تعداد واحد نظری', 'نظری', 'تئوری'],
  practical: ['واحد عملی', 'تعداد واحد عملی', 'عملی'],
  workshop: ['واحد کارگاهی', 'تعداد واحد کارگاهی', 'کارگاهی'],
};

function header(value) {
  return normalizeSourceText(value).toLocaleLowerCase('fa');
}

function column(headers, names) {
  return headers.findIndex((value) => names.includes(header(value)));
}

function numberAt(row, index) {
  const value = englishDigits(row[index] ?? '').replace('٫', '.').match(/-?\d+(?:[.,]\d+)?/);
  return value ? Number(value[0].replace(',', '.')) : null;
}

function valueAt(row, index) {
  return index < 0 ? '' : normalizeSourceText(row[index] ?? '');
}

export function transcriptSchema(rows) {
  const headerIndex = rows.slice(0, 5).findIndex((row) => {
    const headers = row.map(header);
    return column(headers, aliases.title) >= 0 && column(headers, aliases.grade) >= 0;
  });
  if (headerIndex < 0) return null;
  const headers = rows[headerIndex];
  const indexes = Object.fromEntries(Object.entries(aliases).map(([key, values]) => [key, column(headers, values)]));
  if (indexes.units < 0 && indexes.theory < 0 && indexes.practical < 0 && indexes.workshop < 0) return null;
  return { headerIndex, indexes };
}

export function parseTranscriptTables(tables) {
  const byCourse = new Map();
  let matchedTables = 0;
  let rowsSeen = 0;
  let rejected = 0;

  for (let tableIndex = 0; tableIndex < tables.length; tableIndex += 1) {
    const table = tables[tableIndex];
    const schema = transcriptSchema(table.rows ?? []);
    if (!schema) continue;
    matchedTables += 1;
    let dataRows = table.rows.slice(schema.headerIndex + 1);
    if (!dataRows.some((row) => valueAt(row, schema.indexes.title))) {
      const body = tables
        .map((candidate, index) => ({ candidate, distance: Math.abs(index - tableIndex) }))
        .filter(({ candidate, distance }) => distance && candidate.framePath === table.framePath)
        .sort((left, right) => left.distance - right.distance)
        .find(({ candidate }) => candidate.rows?.some((row) => row.length === table.rows[schema.headerIndex].length && valueAt(row, schema.indexes.title)))
        ?.candidate;
      dataRows = body?.rows ?? [];
    }
    for (const row of dataRows) {
      const title = valueAt(row, schema.indexes.title);
      if (!title || title === 'نام درس') continue;
      rowsSeen += 1;
      const grade = numberAt(row, schema.indexes.grade);
      const units = schema.indexes.units >= 0
        ? numberAt(row, schema.indexes.units)
        : ['theory', 'practical', 'workshop'].reduce((sum, key) => sum + (numberAt(row, schema.indexes[key]) ?? 0), 0);
      if (grade == null || grade < 10 || !Number.isFinite(units) || units <= 0) {
        rejected += 1;
        continue;
      }
      const courseId = valueAt(row, schema.indexes.courseId);
      const course = {
        id: courseId || normalizeCourseName(title),
        courseId: courseId || null,
        title,
        normalizedTitle: normalizeCourseName(title),
        units,
        grade,
        source: 'transcript',
      };
      const key = course.courseId || course.normalizedTitle;
      const existing = byCourse.get(key);
      if (!existing || course.grade > existing.grade) byCourse.set(key, course);
    }
  }

  return { courses: [...byCourse.values()], matchedTables, rowsSeen, rejected };
}
