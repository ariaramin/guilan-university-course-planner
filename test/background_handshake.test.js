import assert from 'node:assert/strict';
import test from 'node:test';

const table = (requestId) => ({
  requestId, success: true, readiness: 'stable', extractedAt: Date.now(), pagePath: '/Dashboard',
  sourceUrl: 'https://sada.guilan.ac.ir/Dashboard', rowCount: 1, selectorFound: true,
  observerStatus: 'connected', durationMs: 10,
  tables: [{ tableIndex: 0, framePath: 'top.0', rows: [
    ['نام درس', 'برنامه زمانی', 'کد درس'], ['ریاضی گروه ۱', 'شنبه 08:00 - 10:00', '1'],
  ] }],
});

async function boot({ tab, sendMessage, inject = async () => {} }) {
  let listener;
  const local = {};
  const session = tab ? { sadaSourceTabId: tab.id } : {};
  globalThis.chrome = {
    action: { onClicked: { addListener() {} } },
    runtime: { onMessage: { addListener(value) { listener = value; } }, openOptionsPage: async () => {} },
    tabs: {
      query: async () => tab ? [tab] : [],
      get: async () => {
        if (!tab) throw new Error('No tab');
        return tab;
      },
      sendMessage,
    },
    scripting: { executeScript: inject },
    storage: {
      session: { get: async () => ({ ...session }), set: async (value) => Object.assign(session, value) },
      local: { get: async (key) => ({ [key]: local[key] }), set: async (value) => Object.assign(local, value) },
    },
  };
  await import(`../extension/background.js?handshake=${crypto.randomUUID()}`);
  return {
    local,
    request: (requestId = crypto.randomUUID()) => new Promise((resolve) => {
      listener({ type: 'REFRESH_LIVE_COURSES', requestId, trigger: 'open' }, {}, resolve);
    }),
    extractCompleted: (requestId = crypto.randomUUID()) => new Promise((resolve) => {
      listener({ type: 'EXTRACT_COMPLETED_COURSES', requestId }, {}, resolve);
    }),
  };
}

test('handshakes before extraction when the content script is already active', async () => {
  const calls = [];
  const app = await boot({
    tab: { id: 1, url: 'https://sada.guilan.ac.ir/Dashboard' },
    sendMessage: async (_id, message) => {
      calls.push(message.type);
      return message.type === 'PING_SADA_CONTENT_SCRIPT'
        ? { type: 'PONG_SADA_CONTENT_SCRIPT', requestId: message.requestId, ready: true, version: '1.1.1' }
        : table(message.requestId);
    },
  });
  assert.equal((await app.request('ready')).errorCode, undefined);
  assert.deepEqual(calls, ['PING_SADA_CONTENT_SCRIPT', 'EXTRACT_CURRENT_COURSES']);
});

test('injects once on a supported page with no receiver, then repeats the handshake', async () => {
  let injected = 0;
  let pingCount = 0;
  const app = await boot({
    tab: { id: 2, url: 'https://sada.guilan.ac.ir/Dashboard' },
    inject: async ({ files }) => { injected += 1; assert.deepEqual(files, ['lib/dom-extractor.js', 'content.js']); },
    sendMessage: async (_id, message) => {
      if (message.type === 'PING_SADA_CONTENT_SCRIPT' && pingCount++ === 0) throw new Error('Could not establish connection. Receiving end does not exist.');
      return message.type === 'PING_SADA_CONTENT_SCRIPT'
        ? { type: 'PONG_SADA_CONTENT_SCRIPT', requestId: message.requestId, ready: true, version: '1.1.1' }
        : table(message.requestId);
    },
  });
  assert.equal((await app.request('inject')).errorCode, undefined);
  assert.equal(injected, 1);
  assert.equal(pingCount, 2);
});

test('asks for a SADA reload when the active content script is outdated', async () => {
  const app = await boot({
    tab: { id: 5, url: 'https://sada.guilan.ac.ir/Dashboard' },
    sendMessage: async (_id, message) => ({
      type: 'PONG_SADA_CONTENT_SCRIPT', requestId: message.requestId, ready: true, version: '0.9.2',
    }),
  });
  assert.equal((await app.request('outdated')).errorCode, 'CONTENT_SCRIPT_VERSION_MISMATCH');
});

test('stores passed courses from SADA tables that split headers from rows', async () => {
  const app = await boot({
    tab: { id: 6, url: 'https://sada.guilan.ac.ir/Dashboard' },
    sendMessage: async (_id, message) => message.type === 'PING_SADA_CONTENT_SCRIPT'
      ? { type: 'PONG_SADA_CONTENT_SCRIPT', requestId: message.requestId, ready: true, version: '1.1.1' }
      : {
        requestId: message.requestId, success: true, tables: [
          { framePath: 'top.0', rows: [['کد درس', 'نام درس', 'نمره', 'تئوری', 'عملی', 'کارگاهی']] },
          { framePath: 'top.0', rows: [
            ['101', 'ریاضی ۱', '18', '3', '0', '0'],
            ['102', 'فیزیک ۱', '9', '3', '0', '0'],
          ] },
        ],
      },
  });
  const response = await app.extractCompleted('transcript');
  assert.equal(response.success, true);
  assert.equal(response.extracted, 1);
  assert.deepEqual(app.local.completedCourses.map(({ courseId, units }) => ({ courseId, units })), [{ courseId: '101', units: 3 }]);
});

test('maps injection failure, unsupported pages, and no tab to stable error codes', async (t) => {
  await t.test('failed injection', async () => {
    const app = await boot({
      tab: { id: 3, url: 'https://sada.guilan.ac.ir/Dashboard' },
      inject: async () => { throw new Error('technical injection failure'); },
      sendMessage: async () => { throw new Error('Could not establish connection. Receiving end does not exist.'); },
    });
    const response = await app.request('failed-injection');
    assert.equal(response.errorCode, 'SCRIPT_INJECTION_FAILED');
    assert.doesNotMatch(JSON.stringify(response), /Receiving end does not exist/);
  });
  await t.test('unsupported page', async () => {
    const app = await boot({ tab: { id: 4, url: 'https://example.com/' }, sendMessage: async () => {} });
    assert.equal((await app.request('unsupported')).errorCode, 'UNSUPPORTED_PAGE');
  });
  await t.test('no active tab', async () => {
    const app = await boot({ tab: null, sendMessage: async () => {} });
    assert.equal((await app.request('no-tab')).errorCode, 'NO_ACTIVE_TAB');
  });
});
