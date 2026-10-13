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
  const { op, lemma, word, gloss, sentence, url, text, translation, context, title, id, kind, memo, page } = msg; // 구·문장(save-phrase·unsave-phrase) 필드는 T14, kind('expression'|'sentence')는 T17, memo 는 T19
  const init = op === 'get' ? { headers: { 'X-Bridge-Token': token } } : { method: 'POST', headers: { 'X-Bridge-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify({ op, lemma, word, gloss, sentence, url, text, translation, context, title, id, kind, memo, page }) };
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
  const { op, id, name, aliases, definition, related, task, scrapId } = msg;
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
      body: JSON.stringify({ op, id, name, aliases, definition, related, task, scrapId }),
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
