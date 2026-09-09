import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../extension/lib/dom-extractor.js', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(source, context);

function documentWith({ tables = [], frames = [] } = {}) {
  return {
    querySelectorAll(selector) {
      if (selector === 'table') return tables;
      if (selector === 'iframe') return frames;
      return [];
    },
  };
}

function visible(value) {
  return { ...value, getClientRects: () => [1] };
}

test('extracts a table from a visible same-origin iframe', () => {
  const cell = (textContent) => ({ textContent, cloneNode: () => ({ textContent, querySelectorAll: () => [] }) });
  const table = visible({
    rows: [{ cells: [cell(' نام   درس '), cell('استاد')] }],
  });
  const child = documentWith({ tables: [table] });
  const parent = documentWith({ frames: [visible({ contentDocument: child })] });
  const result = context.sadaDomExtractor.extractVisibleTables(parent);

  assert.equal(result.visibleFrames, 1);
  assert.equal(result.unreadableFrames, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(result.tables)), [{
    tableIndex: 0,
    framePath: 'top.0',
    rows: [['نام درس', 'استاد']],
  }]);
});

test('returns every visible table for the transcript parser', () => {
  const cell = (textContent) => ({ textContent, cloneNode: () => ({ textContent, querySelectorAll: () => [] }) });
  const first = visible({ rows: [{ cells: [cell('نام درس')] }] });
  const second = visible({ rows: [{ cells: [cell('نمره')] }] });
  const result = context.sadaDomExtractor.extractAllVisibleTables(documentWith({ tables: [first, second] }));
  assert.deepEqual(JSON.parse(JSON.stringify(result.tables.map((table) => table.rows))), [[['نام درس']], [['نمره']]]);
});

test('reports an unreadable visible frame without throwing', () => {
  const parent = documentWith({ frames: [visible({ contentDocument: null })] });
  const result = context.sadaDomExtractor.extractVisibleTables(parent);
  assert.equal(result.unreadableFrames, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(result.tables)), []);
});

test('extracts an accessible div-based grid', () => {
  const cells = (values) => values.map((textContent) => ({ textContent, cloneNode: () => ({ textContent, querySelectorAll: () => [] }) }));
  const rows = [
    { querySelectorAll: () => cells(['نام درس', 'استاد']) },
    { querySelectorAll: () => cells(['ریاضی ۱', 'استاد نمونه']) },
  ];
  const grid = visible({
    tagName: 'DIV',
    querySelector: () => null,
    querySelectorAll: () => rows,
  });
  const doc = documentWith();
  doc.querySelectorAll = (selector) => selector.includes('[role="grid"]') ? [grid] : [];

  const result = context.sadaDomExtractor.extractVisibleTables(doc);
  assert.deepEqual(JSON.parse(JSON.stringify(result.tables[0].rows)), [
    ['نام درس', 'استاد'],
    ['ریاضی ۱', 'استاد نمونه'],
  ]);
});

test('fingerprint changes when cell content changes without changing row count', () => {
  const cell1 = { textContent: 'نام درس', cloneNode: function() { return { textContent: this.textContent, querySelectorAll: () => [] }; } };
  const cell2 = { textContent: 'استاد', cloneNode: function() { return { textContent: this.textContent, querySelectorAll: () => [] }; } };
  const cell3 = { textContent: 'گروه', cloneNode: function() { return { textContent: this.textContent, querySelectorAll: () => [] }; } };
  const cell4 = { textContent: 'ظرفیت ۲', cloneNode: function() { return { textContent: this.textContent, querySelectorAll: () => [] }; } };
  const table = visible({ rows: [{ cells: [cell1, cell2, cell3, cell4] }] });
  const doc = documentWith({ tables: [table] });
  const result1 = context.sadaDomExtractor.extractVisibleTables(doc);
  const first = result1.fingerprint;
  cell4.textContent = 'ظرفیت ۱';
  const result2 = context.sadaDomExtractor.extractVisibleTables(doc);
  assert.notEqual(result2.fingerprint, first);
});

test('chooses the smallest stable table container for mutation observation', () => {
  const stableForm = {};
  const table = visible({ closest: () => stableForm, parentElement: {} });
  const doc = documentWith();
  doc.querySelectorAll = (selector) => selector === 'table, [role="grid"], [role="table"]' ? [table] : [];
  doc.querySelector = () => null;
  const roots = context.sadaDomExtractor.observationRoots(doc);
  assert.equal(roots.length, 1);
  assert.equal(roots[0], stableForm);
});

test('ignores loading indicators hidden by computed style', () => {
  const hiddenLoader = visible({
    ownerDocument: { defaultView: { getComputedStyle: () => ({ display: 'block', visibility: 'hidden', opacity: '1' }) } },
  });
  const doc = documentWith();
  doc.querySelectorAll = (selector) => selector.includes('[aria-busy="true"]') ? [hiddenLoader] : [];
  assert.equal(context.sadaDomExtractor.hasVisibleLoadingIndicator(doc), false);
});
