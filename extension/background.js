// service worker: content script 의 요청을 다리(127.0.0.1:47831)로 전달한다. 상태는 토큰 하나뿐(chrome.storage.local).
const BRIDGE = 'http://127.0.0.1:47831';

class BridgeOff extends Error {}

async function bridgeFetch(path, init) {
  try {
    return await fetch(BRIDGE + path, init);
  } catch {
    throw new BridgeOff(); // 다리가 꺼져 있거나 막힘(네트워크 오류)
  }
}

async function getToken(fresh) {
  if (!fresh) {
    const { token } = await chrome.storage.local.get('token');
    if (token) return token;
  }
  // POST 라서 브라우저가 Origin: chrome-extension://<id> 를 붙인다. 다리는 그 값이 내 확장일 때만 토큰을 준다.
  const res = await bridgeFetch('/pair', { method: 'POST' });
  if (!res.ok) return null;
  const { token } = await res.json();
  await chrome.storage.local.set({ token });
  return token;
}

// 공부 기록(T14)용 페이지: content script 가 실어 준 page 를 그대로(길이만 자른다). 없으면 메시지를 보낸 프레임 주소만이라도.
function pageOf(msg, sender) {
  const p = msg.page && typeof msg.page === 'object' ? msg.page : {};
  const url = typeof p.url === 'string' ? p.url : sender.url;
  return typeof url === 'string' && url ? { url: url.slice(0, 2000), title: typeof p.title === 'string' ? p.title.slice(0, 200) : '' } : undefined;
}

async function lookup({ word, sentence, force, context, wide, page }, retried = false) {
  const token = await getToken(retried);
  if (!token) return { error: 'pair-failed' };
  const res = await bridgeFetch('/lookup', {
    method: 'POST',
    headers: { 'X-Bridge-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ word, sentence, force: force === true, context, wide: wide === true, page }), // 문맥은 있으면 그대로(없으면 JSON 에서 빠진다)
  });
  if (res.status === 401 && !retried) return lookup({ word, sentence, force, context, wide, page }, true); // 토큰이 바뀌었으면 한 번만 다시 pair
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { error: data.error || `http-${res.status}` };
  return { gloss: data.gloss, cached: data.cached };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || msg?.type !== 'lookup') return;
  lookup({ ...msg, page: pageOf(msg, sender) }).then(sendResponse, (e) => sendResponse({ error: e instanceof BridgeOff ? 'bridge-off' : 'internal' }));
  return true; // 비동기 응답
});

// 더블클릭 사전 카드: 맥 영한사전 조회(/dict). 구독 호출이 아니라 즉시·무료.
async function dict({ word, host, domains, nolog, page }, retried = false) {
  const token = await getToken(retried);
  if (!token) return { error: 'pair-failed' };
  const res = await bridgeFetch('/dict', {
    method: 'POST',
    headers: { 'X-Bridge-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ word, host, domains, ...(nolog === true ? { nolog: true } : {}), page }), // 용어집 힌트·nolog 는 있으면 그대로 넘긴다(없으면 JSON 에서 빠진다)
  });
  if (res.status === 401 && !retried) return dict({ word, host, domains, nolog, page }, true);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { error: data.error || `http-${res.status}` };
  return data;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || msg?.type !== 'dict') return;
  dict({ ...msg, page: pageOf(msg, sender) }).then(sendResponse, (e) => sendResponse({ error: e instanceof BridgeOff ? 'bridge-off' : 'internal' }));
  return true; // 비동기 응답
});

// --- 문단 번역(T2): 위 lookup 과 같은 흐름. content script 의 'translate' 요청을 다리 /translate 로 전달한다. ---
async function translate({ text, force, bulk, host, domains, page }, retried = false) {
  const token = await getToken(retried);
  if (!token) return { error: 'pair-failed' };
  const res = await bridgeFetch('/translate', {
    method: 'POST',
    headers: { 'X-Bridge-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, force: force === true, bulk: bulk === true, host, domains, page }),
  });
  if (res.status === 401 && !retried) return translate({ text, force, bulk, host, domains, page }, true);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { error: data.error || `http-${res.status}` };
  return { translation: data.translation, expressions: data.expressions, cached: data.cached }; // expressions: 기억할 표현(T17, 없을 수 있다)
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || msg?.type !== 'translate') return;
  translate({ ...msg, page: pageOf(msg, sender) }).then(sendResponse, (e) => sendResponse({ error: e instanceof BridgeOff ? 'bridge-off' : 'internal' }));
  return true; // 비동기 응답
});

// --- 드래그 번역(T12): 'mt'(맥 번역, 기기 안·무료)와 'translate-context'(앞뒤 문맥을 보고 AI 가 번역)를 다리로 그대로 전달한다. ---
async function relay(path, body, retried = false) {
  const token = await getToken(retried);
  if (!token) return { error: 'pair-failed' };
  const res = await bridgeFetch(path, { method: 'POST', headers: { 'X-Bridge-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (res.status === 401 && !retried) return relay(path, body, true);
  const data = await res.json().catch(() => ({}));
  return res.ok ? data : { error: data.error || `http-${res.status}` };
}

const RELAYS = {
  mt: ({ text, domains, page }) => relay('/mt', { text, domains, page }),
  'translate-context': ({ text, context, force, domains, wide, page }) => relay('/translate-context', { text, context, force: force === true, domains, wide: wide === true, page }),
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !Object.hasOwn(RELAYS, msg?.type)) return;
  RELAYS[msg.type]({ ...msg, page: pageOf(msg, sender) }).then(sendResponse, (e) => sendResponse({ error: e instanceof BridgeOff ? 'bridge-off' : 'internal' }));
  return true; // 비동기 응답
});

// --- 자동 주석(T3): content script 의 'annotate' 요청(단어 목록)을 다리 /annotate(맥 사전)로 전달한다. ---
async function annotate({ words, level, host, domains, acronyms, page }, retried = false) {
  const token = await getToken(retried);
  if (!token) return { error: 'pair-failed' };
  const res = await bridgeFetch('/annotate', {
    method: 'POST',
    headers: { 'X-Bridge-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ words, level, host, domains, acronyms, page }),
  });
  if (res.status === 401 && !retried) return annotate({ words, level, host, domains, acronyms, page }, true);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { error: data.error || `http-${res.status}` };
  return { items: data.items };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || msg?.type !== 'annotate') return;
  annotate({ ...msg, page: pageOf(msg, sender) }).then(sendResponse, (e) => sendResponse({ error: e instanceof BridgeOff ? 'bridge-off' : 'internal' }));
  return true; // 비동기 응답
});

// --- 내 단어(T7): content script·패널의 'words' 요청을 다리 /words 로 전달한다. op:'get' 은 GET, 나머지는 POST. ---
async function words(msg, retried = false) {
  const token = await getToken(retried);
  if (!token) return { error: 'pair-failed' };
  const { op, lemma, word, gloss, sentence, url, text, translation, context, title, id, kind, memo, page, headings } = msg; // 구·문장(save-phrase·unsave-phrase) 필드는 T14, kind('expression'|'sentence')는 T17, memo 는 T19, headings 는 T33a
  const init = op === 'get' ? { headers: { 'X-Bridge-Token': token } } : { method: 'POST', headers: { 'X-Bridge-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify({ op, lemma, word, gloss, sentence, url, text, translation, context, title, id, kind, memo, page, headings }) };
  const res = await bridgeFetch('/words', init);
  if (res.status === 401 && !retried) return words(msg, true);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { error: data.error || `http-${res.status}` };
  return data;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || msg?.type !== 'words') return;
  words({ ...msg, page: pageOf(msg, sender) }).then(sendResponse, (e) => sendResponse({ error: e instanceof BridgeOff ? 'bridge-off' : 'internal' }));
  return true; // 비동기 응답
});

// --- 스크랩(T24): content script·패널의 'scraps' 요청을 다리 /scraps 로 전달한다. op:'get' 은 GET, 나머지는 POST. ---
async function scraps(msg, retried = false) {
  const token = await getToken(retried);
  if (!token) return { error: 'pair-failed' };
  const { op, url, id, task, title, headings, quote, pos, translation, memo, page } = msg;
  let path = '/scraps';
  let init;
  if (op === 'get') {
    if (url) path += `?url=${encodeURIComponent(url)}`;
    init = { headers: { 'X-Bridge-Token': token } };
  } else {
    init = {
      method: 'POST',
      headers: { 'X-Bridge-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ op, url, id, task, title, headings, quote, pos, translation, memo, page }),
    };
  }
  const res = await bridgeFetch(path, init);
  if (res.status === 401 && !retried) return scraps(msg, true);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { error: data.error || `http-${res.status}` };
  return data;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || msg?.type !== 'scraps') return;
  scraps({ ...msg, page: pageOf(msg, sender) }).then(sendResponse, (e) => sendResponse({ error: e instanceof BridgeOff ? 'bridge-off' : 'internal' }));
  return true; // 비동기 응답
});

// --- 개념(T28): content script·패널의 'concepts' 요청을 다리 /concepts 로 전달한다. op:'names' 는 ?names=1, op:'get' 은 GET, 나머지는 POST. ---
async function concepts(msg, retried = false) {
  const token = await getToken(retried);
  if (!token) return { error: 'pair-failed' };
  const { op, id, name, aliases, tags, definition, related, task, scrapId, seen } = msg;
  let path = '/concepts';
  let init;
  if (op === 'names') {
    path += '?names=1';
    init = { headers: { 'X-Bridge-Token': token } };
  } else if (op === 'get') {
    init = { headers: { 'X-Bridge-Token': token } };
  } else {
    init = {
      method: 'POST',
      headers: { 'X-Bridge-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ op, id, name, aliases, tags, definition, related, task, scrapId, seen }),
    };
  }
  const res = await bridgeFetch(path, init);
  if (res.status === 401 && !retried) return concepts(msg, true);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ...data, error: data.error || `http-${res.status}`, status: res.status };
  return data;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || msg?.type !== 'concepts') return;
  concepts(msg).then(sendResponse, (e) => sendResponse({ error: e instanceof BridgeOff ? 'bridge-off' : 'internal' }));
  return true; // 비동기 응답
});

// --- URL 열기: 지금 탭 주소 갱신 (개념 상세 "본 곳" 클릭 등) ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || msg?.type !== 'open-url') return;
  const { url } = msg;
  if (!url || sender.tab?.id == null) {
    sendResponse({ error: 'invalid-url' });
    return;
  }
  chrome.tabs.update(sender.tab.id, { url });
  sendResponse({ ok: true });
  return true;
});

// --- 스크랩 점프(T25): 다른 페이지 스크랩으로 이동할 때 session storage 에 pendingScrap 저장 후 탭 주소 갱신 ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || msg?.type !== 'scrap-jump') return;
  const { url, id, task } = msg;
  if (!url || sender.tab?.id == null) {
    sendResponse({ error: 'invalid-jump' });
    return;
  }
  const pendingScrap = { url, id, task: task ?? null };
  const storage = chrome.storage.session ?? chrome.storage.local;
  storage.set({ pendingScrap }).then(() => {
    chrome.tabs.update(sender.tab.id, { url });
    sendResponse({ ok: true });
  }).catch((e) => {
    sendResponse({ error: e?.message || 'storage-error' });
  });
  return true; // 비동기 응답
});

// --- 스크랩 점프 대기(T25): 새 페이지의 content script 가 'scrap-pending' 으로 묻는다. session 에서 꺼내 주고 지운다(주소 확인은 content script). ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || msg?.type !== 'scrap-pending') return;
  const storage = chrome.storage.session ?? chrome.storage.local;
  storage.get('pendingScrap').then(async (data) => {
    await storage.remove('pendingScrap');
    sendResponse({ pending: data?.pendingScrap ?? null });
  }).catch(() => sendResponse({ pending: null }));
  return true; // 비동기 응답
});

// --- 내 사전·공부 기록(T14): 'mydict'(op:'get' 은 GET, 나머지 set·delete 는 POST /mydict)와 'study'(GET /study?days=N)를 다리로 전달한다. ---
async function mydict(msg, retried = false) {
  const token = await getToken(retried);
  if (!token) return { error: 'pair-failed' };
  const { op, key, ko, exp, note, url, title, page } = msg;
  const init = op === 'get' ? { headers: { 'X-Bridge-Token': token } } : { method: 'POST', headers: { 'X-Bridge-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify({ op, key, ko, exp, note, url, title, page }) };
  const res = await bridgeFetch('/mydict', init);
  if (res.status === 401 && !retried) return mydict(msg, true);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { error: data.error || `http-${res.status}` };
  return data;
}

async function study({ days }, retried = false) {
  const token = await getToken(retried);
  if (!token) return { error: 'pair-failed' };
  const n = Number.isInteger(days) ? Math.min(Math.max(days, 1), 60) : 7;
  const res = await bridgeFetch(`/study?days=${n}`, { headers: { 'X-Bridge-Token': token } });
  if (res.status === 401 && !retried) return study({ days }, true);
  const data = await res.json().catch(() => ({}));
  return res.ok ? data : { error: data.error || `http-${res.status}` };
}

const FLOWS = { mydict: (msg, sender) => mydict({ ...msg, page: pageOf(msg, sender) }), study: (msg) => study(msg) };
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !Object.hasOwn(FLOWS, msg?.type)) return;
  FLOWS[msg.type](msg, sender).then(sendResponse, (e) => sendResponse({ error: e instanceof BridgeOff ? 'bridge-off' : 'internal' }));
  return true; // 비동기 응답
});

// --- 패널(T6b): 헤더의 다리 상태 점. /ping 은 토큰이 필요해서 다른 요청과 같은 흐름으로 보낸다. ---
async function ping(retried = false) {
  const token = await getToken(retried);
  if (!token) return { error: 'pair-failed' };
  const res = await bridgeFetch('/ping', { headers: { 'X-Bridge-Token': token } });
  if (res.status === 401 && !retried) return ping(true);
  return res.ok ? { ok: true } : { error: `http-${res.status}` };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || msg?.type !== 'ping') return;
  ping().then(sendResponse, (e) => sendResponse({ error: e instanceof BridgeOff ? 'bridge-off' : 'internal' }));
  return true; // 비동기 응답
});

// 툴바 아이콘을 누르면 그 탭의 패널을 연다(떠 있는 버튼을 숨겨도 열 수 있게). sendMessage 는 'tabs' 권한이 필요 없고,
// content script 가 없는 페이지(chrome:// 등)에서는 거절되니 삼킨다.
chrome.action.onClicked.addListener((tab) => {
  if (tab.id != null) chrome.tabs.sendMessage(tab.id, { type: 'open-panel' }).catch(() => {});
});

// --- 메모(T29b): content script·패널의 'memos' 요청을 다리 /memos 로 전달한다. op:'get' 은 GET, 나머지는 POST. ---
async function memos(msg, retried = false) {
  const token = await getToken(retried);
  if (!token) return { error: 'pair-failed' };
  const { op, url, id, text, title, headings, para, pos, selection, task, page, quote } = msg;
  let path = '/memos';
  let init;
  if (op === 'get') {
    if (url) path += `?url=${encodeURIComponent(url)}`;
    init = { headers: { 'X-Bridge-Token': token } };
  } else {
    init = {
      method: 'POST',
      headers: { 'X-Bridge-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ op, url, id, text, title, headings, para, pos, selection, task, page, quote }),
    };
  }
  const res = await bridgeFetch(path, init);
  if (res.status === 401 && !retried) return memos(msg, true);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { error: data.error || `http-${res.status}` };
  return data;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || msg?.type !== 'memos') return;
  memos({ ...msg, page: pageOf(msg, sender) }).then(sendResponse, (e) => sendResponse({ error: e instanceof BridgeOff ? 'bridge-off' : 'internal' }));
  return true; // 비동기 응답
});

// --- 튜터 인용(T37b): content script 의 'tutor-quote' 요청을 다리 /tutor-quote 로 전달한다. ---
async function tutorQuote(msg, retried = false) {
  const token = await getToken(retried);
  if (!token) return { error: 'pair-failed' };
  const { text } = msg;
  const res = await bridgeFetch('/tutor-quote', {
    method: 'POST',
    headers: { 'X-Bridge-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (res.status === 401 && !retried) return tutorQuote(msg, true);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { error: data.error || `http-${res.status}` };
  return data;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || msg?.type !== 'tutor-quote') return;
  tutorQuote(msg).then(sendResponse, (e) => sendResponse({ error: e instanceof BridgeOff ? 'bridge-off' : 'internal' }));
  return true; // 비동기 응답
});


// --- 메모 점프(T29b): 다른 페이지 메모로 이동할 때 session storage 에 pendingMemo 저장 후 탭 주소 갱신 ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || msg?.type !== 'memo-jump') return;
  const { url, id, para, quote, pos } = msg;
  if (!url || sender.tab?.id == null) {
    sendResponse({ error: 'invalid-jump' });
    return;
  }
  const pendingMemo = { url, id, para: para ?? null, quote: quote ?? null, pos: pos ?? 0 }; // 인용이 있으면 인용 자리로(변경 기록 14-4)
  const storage = chrome.storage.session ?? chrome.storage.local;
  storage.set({ pendingMemo }).then(() => {
    chrome.tabs.update(sender.tab.id, { url });
    sendResponse({ ok: true });
  }).catch((e) => {
    sendResponse({ error: e?.message || 'storage-error' });
  });
  return true; // 비동기 응답
});

// --- 메모 점프 대기(T29b): 새 페이지의 content script 가 'memo-pending' 으로 묻는다. session 에서 꺼내 주고 지운다. ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || msg?.type !== 'memo-pending') return;
  const storage = chrome.storage.session ?? chrome.storage.local;
  storage.get('pendingMemo').then(async (data) => {
    await storage.remove('pendingMemo');
    sendResponse({ pending: data?.pendingMemo ?? null });
  }).catch(() => sendResponse({ pending: null }));
  return true; // 비동기 응답
});

// --- 메모장 탭별 세션 상태(T29b): 열림·쓰던 글 보관 ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;
  const tabId = sender.tab?.id;
  if (tabId == null) return;
  const key = `memo_tab_${tabId}`;
  const storage = chrome.storage.session ?? chrome.storage.local;

  if (msg.type === 'memo-state-get') {
    storage.get(key).then((data) => {
      sendResponse(data?.[key] ?? { open: false, text: '', drafts: {}, quotes: {}, stash: {} });
    }).catch(() => sendResponse({ open: false, text: '', drafts: {}, quotes: {}, stash: {} }));
    return true; // 비동기 응답
  }

  if (msg.type === 'memo-state-set') {
    const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
    // 변경 기록 14-3: 쓰던 글·인용은 소제목 칸별로 탭 상태에 둔다
    const state = { open: !!msg.open, text: typeof msg.text === 'string' ? msg.text : '', drafts: obj(msg.drafts), quotes: obj(msg.quotes), stash: obj(msg.stash) };
    storage.set({ [key]: state }).then(() => {
      sendResponse({ ok: true });
    }).catch(() => sendResponse({ error: 'storage-error' }));
    return true; // 비동기 응답
  }
});

chrome.tabs.onRemoved?.addListener((tabId) => {
  const storage = chrome.storage.session ?? chrome.storage.local;
  storage.remove(`memo_tab_${tabId}`).catch(() => {});
});

// --- 단축키 커맨드 중계(T29b): memo-open, memo-list 명령을 해당 탭으로 전달 ---
chrome.commands?.onCommand?.addListener((cmd, tab) => {
  if (tab?.id != null) {
    chrome.tabs.sendMessage(tab.id, { type: 'memo-command', cmd }).catch(() => {});
  }
});

// --- 공부 모드(T33a, 16-6): 전체 화면 전환 및 이전 창 상태(normal/maximized) 복원 ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || msg?.type !== 'study-mode') return;
  const windowId = sender.tab?.windowId;
  if (windowId == null) {
    sendResponse({ ok: false, error: 'no-window' });
    return;
  }
  const storage = chrome.storage.session ?? chrome.storage.local;
  const key = `study_mode_win_${windowId}`;

  (async () => {
    try {
      if (msg.on) {
        const cur = await chrome.windows.get(windowId);
        if (cur.state && cur.state !== 'fullscreen') {
          await storage.set({ [key]: cur.state });
        }
        const updated = await chrome.windows.update(windowId, { state: 'fullscreen' });
        sendResponse({ ok: true, state: updated?.state ?? 'fullscreen' });
      } else {
        const data = await storage.get(key);
        const prevState = data?.[key] || 'normal';
        await storage.remove(key);
        const updated = await chrome.windows.update(windowId, { state: prevState });
        sendResponse({ ok: true, state: updated?.state ?? prevState });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e?.message || 'window-update-failed' });
    }
  })();
  return true; // 비동기 응답
});

chrome.windows?.onRemoved?.addListener((winId) => {
  const storage = chrome.storage.session ?? chrome.storage.local;
  storage.remove(`study_mode_win_${winId}`).catch(() => {});
});

// --- 섹션별 공부 시간(T40a): content script 의 'study-time' 요청을 다리 /study-time 으로 전달한다. op:'get' 은 GET ?from=&to=, 나머지는 POST. ---
async function studyTime(msg, retried = false) {
  const token = await getToken(retried);
  if (!token) return { error: 'pair-failed' };
  const { op, items, from, to } = msg;
  let path = '/study-time';
  let init;
  if (op === 'get') {
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    const qs = q.toString();
    if (qs) path += `?${qs}`;
    init = { headers: { 'X-Bridge-Token': token } };
  } else {
    init = {
      method: 'POST',
      headers: { 'X-Bridge-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ op, items }),
    };
  }
  const res = await bridgeFetch(path, init);
  if (res.status === 401 && !retried) return studyTime(msg, true);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { error: data.error || `http-${res.status}` };
  return data;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || msg?.type !== 'study-time') return;
  studyTime(msg).then(sendResponse, (e) => sendResponse({ error: e instanceof BridgeOff ? 'bridge-off' : 'internal' }));
  return true; // 비동기 응답
});

// --- 주석 통계 및 내게 맞추기(T41b): content script·패널의 'annotate-stats' 요청을 다리 /annotate-stats 로 전달한다. ---
async function annotateStats(msg, retried = false) {
  const token = await getToken(retried);
  if (!token) return { error: 'pair-failed' };
  const { op, on, shown, seen } = msg;
  let path = '/annotate-stats';
  let init;
  if (op === 'get') {
    init = { headers: { 'X-Bridge-Token': token } };
  } else {
    const body = {};
    if (op !== undefined) body.op = op;
    if (on !== undefined) body.on = on;
    if (shown !== undefined) body.shown = shown;
    if (seen !== undefined) body.seen = seen;
    init = {
      method: 'POST',
      headers: { 'X-Bridge-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    };
  }
  const res = await bridgeFetch(path, init);
  if (res.status === 401 && !retried) return annotateStats(msg, true);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { error: data.error || `http-${res.status}` };
  return data;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || msg?.type !== 'annotate-stats') return;
  annotateStats(msg).then(sendResponse, (e) => sendResponse({ error: e instanceof BridgeOff ? 'bridge-off' : 'internal' }));
  return true; // 비동기 응답
});



