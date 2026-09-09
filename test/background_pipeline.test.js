import assert from 'node:assert/strict';
import test from 'node:test';

function offeredTable({ capacity, instructor = 'استاد تازه' }) {
  return {
    requestId: '', success: true, readiness: 'stable', extractedAt: Date.now(), pagePath: '/OfferShow.aspx',
    sourceUrl: 'https://sada.guilan.ac.ir/Dashboard',
    rowCount: 1, selectorFound: true, observerStatus: 'connected', durationMs: 20,
    tables: [{
      tableIndex: 0, framePath: 'top.0',
      rows: [
        ['نام درس', 'استاد', 'برنامه زمانی', 'ظرفیت مانده', 'کد درس'],
        ['ریاضی عمومی گروه ۱', instructor, 'شنبه 08:00 - 10:00', String(capacity), '101'],
      ],
    }],
  };
}

test('live background pipeline replaces stale cache, rejects late responses, and detects same-count edits', async () => {
  const local = {};
  const session = { sadaSourceTabId: 7 };
  const pending = new Map();
  let runtimeListener;
  globalThis.chrome = {
    action: { onClicked: { addListener() {} } },
    runtime: {
      onMessage: { addListener(listener) { runtimeListener = listener; } },
      openOptionsPage: async () => {},
    },
    tabs: {
      query: async () => [{ id: 7, active: true }],
      get: async () => ({ id: 7, url: 'https://sada.guilan.ac.ir/Dashboard' }),
      sendMessage: (_tabId, message) => message.type === 'PING_SADA_CONTENT_SCRIPT'
        ? Promise.resolve({ type: 'PONG_SADA_CONTENT_SCRIPT', requestId: message.requestId, ready: true, version: '1.1.0' })
        : new Promise((resolve) => pending.set(message.requestId, resolve)),
    },
    scripting: { executeScript: async () => {} },
    storage: {
      session: {
        get: async () => ({ ...session }),
        set: async (values) => Object.assign(session, values),
      },
      local: {
        get: async (key) => typeof key === 'string' ? { [key]: local[key] } : { ...local },
        set: async (values) => Object.assign(local, values),
      },
    },
  };

  await import(`../extension/background.js?integration=${Date.now()}`);
  const request = (requestId) => new Promise((resolve) => {
    assert.equal(runtimeListener({ type: 'REFRESH_LIVE_COURSES', requestId, trigger: 'manual' }, {}, resolve), true);
  });
  const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

  const older = request('older');
  const newer = request('newer');
  await nextTurn();
  pending.get('newer')({ ...offeredTable({ capacity: 2 }), requestId: 'newer' });
  const freshResponse = await newer;
  assert.equal(freshResponse.changed, true);
  assert.equal(local.cachedCourseDataset.courses[0].capacity, 2);
  assert.equal(typeof local.cachedCourseDataset.extractedAt, 'number');

  pending.get('older')({ ...offeredTable({ capacity: 9, instructor: 'پاسخ دیررس' }), requestId: 'older' });
  assert.equal((await older).stale, true);
  assert.equal(local.cachedCourseDataset.courses[0].capacity, 2);
  assert.equal(local.cachedCourseDataset.courses[0].instructor, 'استاد تازه');

  const edited = request('same-count-edit');
  await nextTurn();
  pending.get('same-count-edit')({ ...offeredTable({ capacity: 1 }), requestId: 'same-count-edit' });
  const editedResponse = await edited;
  assert.equal(editedResponse.changed, true);
  assert.notEqual(editedResponse.fingerprint, freshResponse.fingerprint);
  assert.equal(local.cachedCourseDataset.courses.length, 1);
  assert.equal(local.cachedCourseDataset.courses[0].capacity, 1);

  delete globalThis.chrome;
});
