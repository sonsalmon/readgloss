import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// -------------------------------------------------------------
// 1. panel.js offsetLabel 순수 함수 단위 테스트
// -------------------------------------------------------------
globalThis.readglossSettings = {
  LEVELS: ['A2', 'B1', 'B2', 'C1', 'C2'],
  normalize: (o) => o,
  merge: (a, b) => ({ ...a, ...b }),
};

await import('../extension/panel.js');
const panelCore = globalThis.readglossPanelCore;

test('offsetLabel: 양수·음수·0·경계값 문구 검증', () => {
  assert.ok(typeof panelCore.offsetLabel === 'function', 'offsetLabel 함수 존재');

  // 양수: +부호, (주석 줄임)
  assert.equal(panelCore.offsetLabel(0.06), '자동 조절: +0.06 (주석 줄임)');
  assert.equal(panelCore.offsetLabel(0.03), '자동 조절: +0.03 (주석 줄임)');
  assert.equal(panelCore.offsetLabel(0.15), '자동 조절: +0.15 (주석 줄임)');

  // 음수: −부호(U+2212), (주석 늘림)
  assert.equal(panelCore.offsetLabel(-0.03), '자동 조절: −0.03 (주석 늘림)');
  assert.equal(panelCore.offsetLabel(-0.06), '자동 조절: −0.06 (주석 늘림)');
  assert.equal(panelCore.offsetLabel(-0.15), '자동 조절: −0.15 (주석 늘림)');
  assert.match(panelCore.offsetLabel(-0.03), /−0\.03/, '마이너스는 U+2212 기호 사용');

  // 0 및 빈 값: 0 (그대로)
  assert.equal(panelCore.offsetLabel(0), '자동 조절: 0 (그대로)');
  assert.equal(panelCore.offsetLabel(-0), '자동 조절: 0 (그대로)');
  assert.equal(panelCore.offsetLabel(null), '자동 조절: 0 (그대로)');
  assert.equal(panelCore.offsetLabel(undefined), '자동 조절: 0 (그대로)');
  assert.equal(panelCore.offsetLabel(''), '자동 조절: 0 (그대로)');
});

// -------------------------------------------------------------
// 2. background.js 실제 동작 및 중계 테스트 (모킹 기반)
// -------------------------------------------------------------
test('background.js: annotate-stats GET, POST(op, shown, seen), sender 검증, 401 재시도', async () => {
  const EXT_ID = 'test-extension-id-12345';
  const listeners = [];
  const storageData = { token: 'mock-token-1' };

  globalThis.chrome = {
    runtime: {
      id: EXT_ID,
      onMessage: {
        addListener(fn) {
          listeners.push(fn);
        },
      },
    },
    storage: {
      local: {
        async get(k) {
          return { [k]: storageData[k] };
        },
        async set(obj) {
          Object.assign(storageData, obj);
        },
      },
      session: { async get() { return {}; }, async set() {}, async remove() {} },
    },
    // background.js 가 맨 위에서 거는 리스너들(이 시험과 무관, 빈 흉내)
    action: { onClicked: { addListener() {} } },
    commands: { onCommand: { addListener() {} } },
    tabs: { onRemoved: { addListener() {} }, sendMessage() {}, update() {} },
    windows: { get: async () => ({}), update: async () => ({}), onRemoved: { addListener() {} } },
  };

  const fetched = [];
  let tokenRefreshed = false;
  globalThis.fetch = async (url, init = {}) => {
    fetched.push({ url, init });
    if (url.endsWith('/pair')) {
      tokenRefreshed = true;
      return { ok: true, status: 200, json: async () => ({ token: 'mock-fresh-token' }) };
    }
    if (url.endsWith('/annotate-stats')) {
      if (init.headers?.['X-Bridge-Token'] === 'stale-token') {
        return { ok: false, status: 401, json: async () => ({ error: 'unauthorized' }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ offset: 0.06, auto: true, last7: { shown: 10, seen: 5, missedLookups: 1 } }),
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  // background.js 로드
  await import(`../extension/background.js?t=${Date.now()}`);

  const dispatch = (msg, senderId = EXT_ID) =>
    new Promise((resolve) => {
      for (const fn of listeners) {
        const res = fn(msg, { id: senderId }, resolve);
        if (res === true) return;
      }
      resolve(undefined);
    });

  // 1) sender.id 불일치 시 무시
  const badSenderRes = await dispatch({ type: 'annotate-stats', op: 'get' }, 'evil-extension');
  assert.equal(badSenderRes, undefined, 'sender.id가 다르면 응답하지 않는다');

  // 2) op: 'get' -> GET /annotate-stats
  fetched.length = 0;
  const getRes = await dispatch({ type: 'annotate-stats', op: 'get' });
  assert.ok(getRes && !getRes.error);
  assert.equal(getRes.offset, 0.06);
  assert.equal(fetched.length, 1);
  assert.equal(fetched[0].url, 'http://127.0.0.1:47831/annotate-stats');
  assert.equal(fetched[0].init.method, undefined); // fetch 기본값은 GET
  assert.equal(fetched[0].init.headers['X-Bridge-Token'], 'mock-token-1');

  // 3) op: 'auto', on: true -> POST /annotate-stats
  fetched.length = 0;
  await dispatch({ type: 'annotate-stats', op: 'auto', on: true });
  assert.equal(fetched.length, 1);
  assert.equal(fetched[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(fetched[0].init.body), { op: 'auto', on: true });

  // 4) op: 'reset' -> POST /annotate-stats
  fetched.length = 0;
  await dispatch({ type: 'annotate-stats', op: 'reset' });
  assert.equal(fetched.length, 1);
  assert.equal(fetched[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(fetched[0].init.body), { op: 'reset' });

  // 5) shown/seen -> POST /annotate-stats
  fetched.length = 0;
  await dispatch({ type: 'annotate-stats', shown: ['apple'], seen: ['apple'] });
  assert.equal(fetched.length, 1);
  assert.equal(fetched[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(fetched[0].init.body), { shown: ['apple'], seen: ['apple'] });

  // 6) 401 재시도
  storageData.token = 'stale-token';
  fetched.length = 0;
  tokenRefreshed = false;
  const retryRes = await dispatch({ type: 'annotate-stats', op: 'get' });
  assert.ok(tokenRefreshed, '401 수신 시 /pair 로 토큰 재발급');
  assert.ok(retryRes && !retryRes.error);
  assert.equal(storageData.token, 'mock-fresh-token');
});

// -------------------------------------------------------------
// 3. annotate.js 구조 및 소스 검사
// -------------------------------------------------------------
test('annotate.js: shown 한 번, seen 0.6초·dblclick, 30초·pagehide 전송, 꺼짐이면 안 모음 검사', () => {
  const code = readFileSync(new URL('../extension/annotate.js', import.meta.url), 'utf8');

  // shown: visibility: visible 시점에 페이지당 한 번만 모음 (Set)
  assert.match(code, /label\.style\.visibility\s*=\s*['"]visible['"]/);
  assert.match(code, /statsPageShown/, 'shown 페이지당 1회 추적 Set 존재');
  assert.match(code, /statsShownQueue/, '전송용 shown 큐 존재');

  // seen: 마우스 이동 100ms 쓰로틀링, getClientRects, 0.6초 머묾
  assert.match(code, /mousemove/);
  assert.match(code, /capture:\s*true/);
  assert.match(code, /passive:\s*true/);
  assert.match(code, /100/, '100ms 쓰로틀링');
  assert.match(code, /getClientRects\(\)/, '마우스 좌표와 entry getClientRects 비교');
  assert.match(code, /600/, '0.6초(600ms) 연속 머묾');
  assert.match(code, /statsPageSeen/, 'seen 원형당 이 페이지에서 1회 추적 Set 존재');
  assert.match(code, /statsSeenQueue/, '전송용 seen 큐 존재');

  // seen: dblclick
  assert.match(code, /dblclick/, 'dblclick 이벤트 처리');

  // 전송: 30초마다, visibilitychange(hidden), pagehide
  assert.match(code, /30_?000/, '30초마다 전송');
  assert.match(code, /visibilitychange/, 'visibilitychange 이벤트 처리');
  assert.match(code, /hidden/, 'hidden 상태 확인');
  assert.match(code, /pagehide/, 'pagehide 이벤트 처리');
  assert.match(code, /chrome\.runtime\.sendMessage/, 'sendMessage 호출');
  assert.match(code, /['"]annotate-stats['"]/, '메시지 타입 annotate-stats');
  assert.match(code, /500/, '각 500개 상한');

  // 실패하면 버림(실패 무시)
  assert.match(code, /\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/);

  // 자동 주석이 꺼졌으면 모으지 않음 (!running 검사)
  assert.match(code, /!running/, '자동 주석 비활성 시 가드');
});

// -------------------------------------------------------------
// 4. panel.js 설정 탭 "내게 맞추기" 소스 및 구조 검사
// -------------------------------------------------------------
test('panel.js: 설정 탭 "내게 맞추기" 스위치·되돌리기·통계 표시 검사', () => {
  const panel = readFileSync(new URL('../extension/panel.js', import.meta.url), 'utf8');

  // "내게 맞추기" 섹션 제목
  assert.match(panel, /내게 맞추기/);

  // 스위치 "주석 양 자동 맞추기", op: 'auto'
  assert.match(panel, /주석 양 자동 맞추기/);
  assert.match(panel, /['"]auto['"]/);

  // 한 줄 "자동 조절: ...", [되돌리기] 버튼, op: 'reset'
  assert.match(panel, /되돌리기/);
  assert.match(panel, /['"]reset['"]/);

  // 작은 글 지난 7일 통계 문구
  assert.match(panel, /지난 7일:\s*뜬 주석/);
  assert.match(panel, /본 것/);
  assert.match(panel, /주석 없이 찾아본 단어/);

  // op:'get' 및 "다리에 연결하지 못했어요"
  assert.match(panel, /op:\s*['"]get['"]/);
  assert.match(panel, /다리에 연결하지 못했어요/);
});
