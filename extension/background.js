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

async function lookup({ word, sentence, force }, retried = false) {
  const token = await getToken(retried);
  if (!token) return { error: 'pair-failed' };
  const res = await bridgeFetch('/lookup', {
    method: 'POST',
    headers: { 'X-Bridge-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ word, sentence, force: force === true }),
  });
  if (res.status === 401 && !retried) return lookup({ word, sentence, force }, true); // 토큰이 바뀌었으면 한 번만 다시 pair
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { error: data.error || `http-${res.status}` };
  return { gloss: data.gloss, cached: data.cached };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || msg?.type !== 'lookup') return;
  lookup(msg).then(sendResponse, (e) => sendResponse({ error: e instanceof BridgeOff ? 'bridge-off' : 'internal' }));
  return true; // 비동기 응답
});

// 더블클릭 사전 카드: 맥 영한사전 조회(/dict). 구독 호출이 아니라 즉시·무료.
async function dict({ word }, retried = false) {
  const token = await getToken(retried);
  if (!token) return { error: 'pair-failed' };
  const res = await bridgeFetch('/dict', {
    method: 'POST',
    headers: { 'X-Bridge-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ word }),
  });
  if (res.status === 401 && !retried) return dict({ word }, true);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { error: data.error || `http-${res.status}` };
  return data;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || msg?.type !== 'dict') return;
  dict(msg).then(sendResponse, (e) => sendResponse({ error: e instanceof BridgeOff ? 'bridge-off' : 'internal' }));
  return true; // 비동기 응답
});

// --- 문단 번역(T2): 위 lookup 과 같은 흐름. content script 의 'translate' 요청을 다리 /translate 로 전달한다. ---
async function translate({ text, force }, retried = false) {
  const token = await getToken(retried);
  if (!token) return { error: 'pair-failed' };
  const res = await bridgeFetch('/translate', {
    method: 'POST',
    headers: { 'X-Bridge-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, force: force === true }),
  });
  if (res.status === 401 && !retried) return translate({ text, force }, true);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { error: data.error || `http-${res.status}` };
  return { translation: data.translation, cached: data.cached };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || msg?.type !== 'translate') return;
  translate(msg).then(sendResponse, (e) => sendResponse({ error: e instanceof BridgeOff ? 'bridge-off' : 'internal' }));
  return true; // 비동기 응답
});

// --- 자동 주석(T3): content script 의 'annotate' 요청(단어 목록)을 다리 /annotate(맥 사전)로 전달한다. ---
async function annotate({ words, level }, retried = false) {
  const token = await getToken(retried);
  if (!token) return { error: 'pair-failed' };
  const res = await bridgeFetch('/annotate', {
    method: 'POST',
    headers: { 'X-Bridge-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ words, level }),
  });
  if (res.status === 401 && !retried) return annotate({ words, level }, true);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { error: data.error || `http-${res.status}` };
  return { items: data.items };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || msg?.type !== 'annotate') return;
  annotate(msg).then(sendResponse, (e) => sendResponse({ error: e instanceof BridgeOff ? 'bridge-off' : 'internal' }));
  return true; // 비동기 응답
});

// --- 내 단어(T7): content script·패널의 'words' 요청을 다리 /words 로 전달한다. op:'get' 은 GET, 나머지는 POST. ---
async function words(msg, retried = false) {
  const token = await getToken(retried);
  if (!token) return { error: 'pair-failed' };
  const { op, lemma, word, gloss, sentence, url } = msg;
  const init = op === 'get' ? { headers: { 'X-Bridge-Token': token } } : { method: 'POST', headers: { 'X-Bridge-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify({ op, lemma, word, gloss, sentence, url }) };
  const res = await bridgeFetch('/words', init);
  if (res.status === 401 && !retried) return words(msg, true);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { error: data.error || `http-${res.status}` };
  return data;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || msg?.type !== 'words') return;
  words(msg).then(sendResponse, (e) => sendResponse({ error: e instanceof BridgeOff ? 'bridge-off' : 'internal' }));
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
