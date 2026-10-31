// 영상 자막(유튜브) 판단 로직(변경 기록 27): 자막 읽기·줄 묶기·지금 줄·낱말 나누기·가리기·장면 주소·키. DOM 을 만지지 않는 순수 함수만.
// classic script: globalThis.readglossVideo 로 등록한다(node --test 도 같은 파일을 import 해서 쓴다).
(() => {
  const ID_RE = /^[A-Za-z0-9_-]{11}$/; // 유튜브 영상 id
  const MAX_CUES = 5000;
  const MAX_LINE = 1000; // 다리 구·문장 text 상한과 같다
  const MAX_SIDE = 1500; // 문맥 앞뒤 상한(다리 context.mjs LIMITS)
  const MAX_TITLE = 200;
  const MAX_CLIP = 60; // 장면 구간 최대 길이(초). 다리 words.mjs 와 같다
  const MAX_TIME = 86_400;
  // 자동 생성 자막 줄 묶기: 쉼(초) · 줄 최대 낱말 · 줄 최대 길이(초) · 문장 부호로 끊을 최소 낱말 · 쉼표로 끊을 최소 낱말 · 마지막 낱말 뒤 여유(초)
  const ASR = { gap: 1.0, maxWords: 12, maxSec: 5.5, punctMin: 3, commaMin: 8, tail: 1.0 };
  const GRACE = 0.25; // 줄 끝을 조금 지나도 "지금 줄"로 본다(초)
  const PAUSE_EARLY = 0.08; // 줄마다 멈춤: 끝보다 이만큼 먼저 멈춘다(다음 줄 첫소리가 새지 않게)
  const PAUSE_LATE = 0.5; // 줄마다 멈춤: 끝을 이만큼 지나면 건너뛴 것으로 본다(초)
  const REPEAT_LEAD = 0.15; // 문장 반복: 줄 끝보다 이만큼 먼저 줄 시작으로 되감는다(초)
  const REPEAT_RESET = 0.30; // 문장 반복: 끝에서 이만큼 앞으로 돌아오면 다시 되감을 수 있게 표시를 지운다(초)
  const GAP_MIN = 0.4; // 틈 건너뛰기: 다음 줄까지 이만큼 비면 건너뛴다(초)
  const KO_NEAR = [0, 1, 2, 3, 4, -1]; // 한국어 줄을 미리 받을 순서(지금 줄 기준)

  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
  const round = (n, d = 3) => Math.round(n * 10 ** d) / 10 ** d;
  const cleanText = (s) => String(s ?? '').replace(/[​‎‏﻿]/g, '').replace(/\s+/g, ' ').trim();
  const clipEnd = (s, max) => (s.length > max ? s.slice(s.length - max) : s); // 앞 문맥은 가까운 쪽(끝)을 남긴다
  const clipStart = (s, max) => (s.length > max ? s.slice(0, max) : s);

  // 자막 주소의 쿼리: v(영상), lang, tlang(유튜브 자동 번역), kind(asr = 자동 생성), fmt
  function params(url) {
    try {
      const u = new URL(String(url), 'https://www.youtube.com');
      const g = (k) => u.searchParams.get(k) ?? '';
      return { v: g('v'), lang: g('lang').toLowerCase(), tlang: g('tlang').toLowerCase(), kind: g('kind').toLowerCase(), fmt: g('fmt').toLowerCase() };
    } catch {
      return { v: '', lang: '', tlang: '', kind: '', fmt: '' };
    }
  }

  const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  function decodeEntities(s) {
    return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
      }
      return NAMED[e.toLowerCase()] ?? m;
    });
  }
  const stripTags = (s) => String(s ?? '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '');
  const attr = (attrs, name) => {
    const m = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
    return m ? m[1] : null;
  };

  // 줄 목록 다듬기: 시각이 이상하거나 글이 빈 줄은 버리고, 시작 순으로, 같은 시각 줄은 합치고, 끝이 시작보다 앞이면 고친다.
  function normalizeCues(list) {
    const cues = (Array.isArray(list) ? list : [])
      .map((c) => ({ start: num(c?.start), end: num(c?.end), text: cleanText(c?.text) }))
      .filter((c) => c.start !== null && c.start >= 0 && c.start <= MAX_TIME && c.text)
      .sort((a, b) => a.start - b.start);
    const out = [];
    for (const c of cues) {
      const last = out[out.length - 1];
      if (last && Math.abs(last.start - c.start) < 0.01) {
        last.text = cleanText(`${last.text} ${c.text}`);
        last.end = Math.max(last.end ?? 0, c.end ?? 0);
        continue;
      }
      out.push({ ...c });
      if (out.length >= MAX_CUES) break;
    }
    for (let i = 0; i < out.length; i++) {
      const c = out[i];
      const next = out[i + 1];
      if (c.end === null || c.end <= c.start) c.end = next ? Math.max(next.start, c.start + 0.5) : c.start + 2;
      c.start = round(c.start);
      c.end = round(Math.min(c.end, MAX_TIME));
      c.text = clipStart(c.text, MAX_LINE);
    }
    return out;
  }

  // 자동 생성 자막: 낱말 [{ text, start }] -> 줄 [{ start, end, text }]. 규칙은 변경 기록 27-1.
  function groupWords(words) {
    const ws = (Array.isArray(words) ? words : [])
      .map((w) => ({ text: cleanText(w?.text), start: num(w?.start) }))
      .filter((w) => w.text && w.start !== null && w.start >= 0)
      .sort((a, b) => a.start - b.start);
    const lines = [];
    let cur = null;
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i];
      const prev = ws[i - 1];
      const brk = !cur
        || w.start - prev.start > ASR.gap
        || (/[.?!]["')\]”’]*$/.test(prev.text) && cur.words.length >= ASR.punctMin)
        || (/,["')\]”’]*$/.test(prev.text) && cur.words.length >= ASR.commaMin)
        || cur.words.length >= ASR.maxWords
        || w.start - cur.start >= ASR.maxSec;
      if (brk) {
        cur = { start: w.start, words: [] };
        lines.push(cur);
      }
      cur.words.push(w);
    }
    return normalizeCues(lines.map((l, j) => {
      const last = l.words[l.words.length - 1].start;
      const next = lines[j + 1]?.start;
      const end = next !== undefined && next - last <= ASR.tail ? next : last + ASR.tail;
      return { start: l.start, end: Math.max(end, l.start + 0.5), text: l.words.map((w) => w.text).join(' ') };
    }));
  }

  // 자동 자막 다듬기(28-17): AI 가 낱말 번호로 나눈 줄 {from,to,text} 이 0..n-1 을 빠짐·겹침 없이 덮는지 검사한다.
  // 번호가 어긋난 결과는 시각이 밀리므로 통째로 버린다(다리와 확장이 같은 규칙을 쓴다).
  function validPolish(lines, n) {
    if (!Array.isArray(lines) || !lines.length || !Number.isInteger(n) || n <= 0) return false;
    let next = 0;
    for (const l of lines) {
      if (!isObj(l)) return false;
      if (!Number.isInteger(l.from) || !Number.isInteger(l.to)) return false;
      if (l.from !== next || l.to < l.from || l.to >= n) return false;
      if (typeof l.text !== 'string' || !cleanText(l.text)) return false;
      next = l.to + 1;
    }
    return next === n;
  }

  // 다듬은 줄 {from,to,text} -> 자막 줄 [{start,end,text}]. 시각은 그 줄 첫 낱말과 다음 줄 첫 낱말(1초 안) 또는 마지막 낱말 + 1초.
  // words 는 [{t(초), w(낱말)}]. 번호가 틀리면 빈 목록을 돌려 지금 자막을 그대로 두게 한다.
  function polishedCues(words, lines) {
    const list = Array.isArray(words) ? words : [];
    const ws = list.map((w) => ({ t: num(w?.t), w: cleanText(w?.w) }));
    if (!ws.length || ws.some((w) => w.t === null || w.t < 0 || !w.w)) return [];
    if (!validPolish(lines, ws.length)) return [];
    const out = [];
    for (let j = 0; j < lines.length; j++) {
      const l = lines[j];
      const start = ws[l.from].t;
      const last = ws[l.to].t;
      const nextStart = j + 1 < lines.length ? ws[lines[j + 1].from].t : null;
      const end = nextStart !== null && nextStart > last && nextStart - last <= ASR.tail ? nextStart : last + ASR.tail;
      out.push({ start: round(start), end: round(Math.min(MAX_TIME, Math.max(end, start + 0.5))), text: cleanText(l.text) });
    }
    return normalizeCues(out);
  }

  // json3 에 낱말마다 시각(tOffsetMs)이나 자동 인식 점수(acAsrConf)가 있으면 자동 생성 자막이다.
  const json3HasWordTiming = (obj) => (Array.isArray(obj?.events) ? obj.events : []).some((ev) => Array.isArray(ev?.segs) && ev.segs.some((s) => isObj(s) && ('tOffsetMs' in s || 'acAsrConf' in s)));

  // json3 자동 생성 자막의 낱말 [{ text, start }]. 줄 묶기와 다듬기 요청이 같은 낱말 시각을 쓴다.
  function json3Words(obj) {
    const events = Array.isArray(obj?.events) ? obj.events : [];
    const words = [];
    for (const ev of events) {
      const t0 = num(ev?.tStartMs);
      if (t0 === null || !Array.isArray(ev.segs)) continue;
      for (const seg of ev.segs) {
        const text = cleanText(seg?.utf8);
        if (!text) continue; // aAppend 의 줄바꿈 이벤트 등
        words.push({ text, start: (t0 + (num(seg.tOffsetMs) ?? 0)) / 1000 });
      }
    }
    return words.sort((a, b) => a.start - b.start);
  }
  function parseJson3All(obj, asr) {
    if (asr) {
      const words = json3Words(obj);
      return { cues: groupWords(words), words };
    }
    const events = Array.isArray(obj?.events) ? obj.events : [];
    const cues = [];
    for (const ev of events) {
      const t0 = num(ev?.tStartMs);
      if (t0 === null || !Array.isArray(ev.segs)) continue;
      const text = ev.segs.map((s) => (typeof s?.utf8 === 'string' ? s.utf8 : '')).join('');
      const dur = num(ev?.dDurationMs) ?? 0;
      cues.push({ start: t0 / 1000, end: (t0 + dur) / 1000, text });
    }
    return { cues: normalizeCues(cues), words: null };
  }
  function parseJson3(obj, asr) {
    return parseJson3All(obj, asr).cues;
  }

  // srv3(<timedtext format="3"><body><p t d>…<s t>낱말</s>…</p>) 와 srv1(<transcript><text start dur>…</text>).
  function parseXml(body) {
    const s = String(body);
    if (/<transcript\b/i.test(s)) {
      const cues = [];
      for (const m of s.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
        const start = num(attr(m[1], 'start'));
        const dur = num(attr(m[1], 'dur')) ?? 0;
        if (start === null) continue;
        // srv1 은 글이 두 번 이스케이프된 일이 많다(&amp;#39;). 풀고 나서 나온 태그(<font>)도 걷는다.
        cues.push({ start, end: start + dur, text: stripTags(decodeEntities(decodeEntities(m[2]))) });
      }
      return { cues: normalizeCues(cues), asr: false };
    }
    const words = [];
    const cues = [];
    for (const m of s.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)) {
      const t = num(attr(m[1], 't'));
      const d = num(attr(m[1], 'd')) ?? 0;
      if (t === null) continue;
      const inner = m[2];
      if (/<s\b/.test(inner)) {
        for (const w of inner.matchAll(/<s\b([^>]*)>([\s\S]*?)<\/s>/g)) {
          const text = cleanText(stripTags(decodeEntities(stripTags(w[2]))));
          if (text) words.push({ text, start: (t + (num(attr(w[1], 't')) ?? 0)) / 1000 });
        }
      } else {
        cues.push({ start: t / 1000, end: (t + d) / 1000, text: stripTags(decodeEntities(stripTags(inner))) });
      }
    }
    if (words.length) return { cues: groupWords(words), asr: true, words: words.sort((a, b) => a.start - b.start) };
    return { cues: normalizeCues(cues), asr: false };
  }

  // WebVTT: "00:01.000 --> 00:03.000" 다음 줄들이 글. 낱말 시각 태그(<00:00:01.500>)·<c> 는 걷는다.
  const vttTime = (s) => {
    const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/.exec(s.trim());
    return m ? (Number(m[1] ?? 0) * 3600) + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000 : null;
  };
  function parseVtt(body) {
    const cues = [];
    const lines = String(body).replace(/\r\n?/g, '\n').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = /^\s*(\S+)\s+-->\s+(\S+)/.exec(lines[i]);
      if (!m) continue;
      const start = vttTime(m[1]);
      const end = vttTime(m[2]);
      const text = [];
      for (i++; i < lines.length && lines[i].trim() !== ''; i++) text.push(lines[i]);
      if (start !== null) cues.push({ start, end, text: stripTags(decodeEntities(text.join(' '))) });
    }
    return normalizeCues(cues);
  }

  // 자막 응답 하나 -> { videoId, lang, tlang, kind:'asr'|'manual', cues, words? } | null(못 읽음·빈 자막)
  function parseTrack(body, url) {
    if (typeof body !== 'string' || !body.trim()) return null;
    const p = params(url);
    // 유튜브 자동 번역(tlang)은 자동 생성 자막을 옮긴 것이라도 줄 단위로 온다(낱말 시각 없음)
    let asr = !p.tlang && p.kind === 'asr';
    let cues = null;
    let words = null;
    const s = body.trimStart();
    try {
      if (s[0] === '{') {
        const obj = JSON.parse(s);
        asr = asr || (!p.tlang && json3HasWordTiming(obj));
        const r = parseJson3All(obj, asr);
        cues = r.cues;
        words = r.words;
      } else if (s.startsWith('WEBVTT')) {
        cues = parseVtt(s);
      } else if (s[0] === '<') {
        const r = parseXml(s);
        cues = r.cues;
        asr = asr || r.asr;
        words = r.words ?? null;
      }
    } catch {
      return null;
    }
    if (!cues?.length) return null;
    // 다듬기 요청·적용은 낱말 시각이 있어야 한다. 응답 모양은 { t(초), w(낱말) }.
    const wordList = asr && words?.length
      ? words.map((w) => ({ t: round(w.start), w: w.text })).filter((w) => w.w && Number.isFinite(w.t) && w.t >= 0)
      : null;
    return { videoId: ID_RE.test(p.v) ? p.v : null, lang: p.lang, tlang: p.tlang, kind: asr ? 'asr' : 'manual', cues, ...(wordList?.length ? { words: wordList } : {}) };
  }

  // 트랙 언어: 유튜브 자동 번역이면 tlang, 아니면 lang. 둘 다 없으면 글자로 짐작한다(영어 글자가 한글보다 많으면 en).
  function langOf(track) {
    const l = (track?.tlang || track?.lang || '').split('-')[0];
    if (l) return l;
    const sample = (track?.cues ?? []).slice(0, 30).map((c) => c.text).join(' ');
    const en = (sample.match(/[A-Za-z]/g) ?? []).length;
    const ko = (sample.match(/[가-힣]/g) ?? []).length;
    return en > 0 && en > ko ? 'en' : ko > 0 ? 'ko' : '';
  }
  const isEnglish = (track) => langOf(track) === 'en';
  const isKorean = (track) => langOf(track) === 'ko';

  // 한 영상의 트랙들 -> { main: 영어(사람이 쓴 것 > 자동 생성, 같으면 나중에 받은 것), ko: 한국어(나중 것) }
  function pickTracks(tracks) {
    const list = Array.isArray(tracks) ? tracks.filter((t) => t && Array.isArray(t.cues) && t.cues.length) : [];
    const by = (a, b) => (a.kind === b.kind ? (b.ts ?? 0) - (a.ts ?? 0) : a.kind === 'manual' ? -1 : 1);
    const main = list.filter(isEnglish).sort(by)[0] ?? null;
    const ko = list.filter(isKorean).sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))[0] ?? null;
    return { main, ko };
  }

  // 영어 줄마다 시각이 가장 많이 겹치는 한국어 줄(없으면 '')
  function alignKo(main, ko) {
    const a = Array.isArray(main) ? main : [];
    const b = Array.isArray(ko) ? [...ko].sort((x, y) => x.start - y.start) : [];
    const out = new Array(a.length).fill('');
    let j = 0;
    for (let i = 0; i < a.length; i++) {
      while (j < b.length && b[j].end <= a[i].start) j++;
      let best = 0;
      for (let k = j; k < b.length && b[k].start < a[i].end; k++) {
        const ov = Math.min(a[i].end, b[k].end) - Math.max(a[i].start, b[k].start);
        if (ov > best) {
          best = ov;
          out[i] = b[k].text;
        }
      }
    }
    return out;
  }

  // 지금 줄: 시작이 t 보다 이른 마지막 줄의 번호(없으면 -1). 줄은 시작 순.
  function activeIndex(cues, t) {
    const list = Array.isArray(cues) ? cues : [];
    if (!list.length || !Number.isFinite(t) || t + 0.001 < list[0].start) return -1;
    let lo = 0;
    let hi = list.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (list[mid].start <= t + 0.001) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }
  // 그 줄이 아직 말하는 중인가(끝 + 여유 전). 아니면 다음 줄까지 옅게 둔다.
  const isLive = (cues, i, t) => Boolean(cues?.[i]) && t < cues[i].end + GRACE;

  // 줄 글 -> 낱말·사이 조각. 숫자에 붙은 글자(x86)·한 글자(a, I)·영어 아닌 글자가 섞인 낱말(café)은 누를 수 없는 조각으로 둔다
  // (사전 카드는 영어 글자 2~64자만 찾는다). 글자는 유니코드로 끊어서 café 가 caf 와 é 로 갈리지 않게 한다.
  const TOKEN = /\p{L}+(?:['’-]\p{L}+)*/gu;
  function tokenize(text) {
    const s = String(text ?? '');
    const out = [];
    let last = 0;
    for (const m of s.matchAll(TOKEN)) {
      const before = s[m.index - 1] ?? '';
      const after = s[m.index + m[0].length] ?? '';
      const word = /^[A-Za-z]+(?:['’-][A-Za-z]+)*$/.test(m[0]) && m[0].length >= 2 && m[0].length <= 64 && !/[0-9_]/.test(before) && !/[0-9_]/.test(after);
      if (!word) continue; // 아래 조각에 그대로 남는다
      if (m.index > last) out.push({ t: s.slice(last, m.index), w: false });
      out.push({ t: m[0], w: true, lower: m[0].toLowerCase().replace(/’/g, "'") });
      last = m.index + m[0].length;
    }
    if (last < s.length) out.push({ t: s.slice(last), w: false });
    return out;
  }

  // 영상 학습 모드(28-16): 보기 · 이해 · 듣기 · 조립. 설정 video.mode 와 막대 [모드] 가 이 순서로 돈다.
  const MODES = ['watch', 'understand', 'listen', 'build'];
  const MODE_LABEL = Object.freeze({ watch: '보기', understand: '이해', listen: '듣기', build: '조립' });
  // 조립 칩 섞기(28-16): 같은 seed 는 항상 같은 순서. 섞은 결과가 원래 순서와 같으면 다시 섞는다.
  // tokens 는 tokenize 결과(또는 아무 배열)이고, 돌려주는 값은 같은 항목을 다른 순서로 담은 새 배열이다.
  function seed32(seed) {
    const s = String(seed ?? '');
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }
  function random32(state) {
    let t = (state + 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return { state: t >>> 0, value: ((t ^ (t >>> 14)) >>> 0) / 4294967296 };
  }
  function shuffleTiles(tokens, seed) {
    const list = Array.isArray(tokens) ? tokens.slice() : [];
    const n = list.length;
    if (n <= 1) return list;
    let state = seed32(seed);
    const order = list.map((_, i) => i);
    const mix = () => {
      for (let i = n - 1; i > 0; i--) {
        const r = random32(state);
        state = r.state;
        const j = Math.floor(r.value * (i + 1));
        const tmp = order[i];
        order[i] = order[j];
        order[j] = tmp;
      }
    };
    // 원래 순서([0,1,…])와 같으면 다시 섞는다. 두 번 연속 같을 수 있으니 몇 번 더 시도한다(항목이 둘 이상일 때).
    for (let tries = 0; tries < 20; tries++) {
      mix();
      if (!order.every((v, i) => v === i)) break;
    }
    return order.map((i) => list[i]);
  }
  // 조립 채점(28-16): placed 가 answer 와 같은 차례·같은 항목이면 true. 앞부분만 맞는지는 answer 를 잘라서 본다.
  function tileCheck(placed, answer) {
    const a = Array.isArray(placed) ? placed : [];
    const b = Array.isArray(answer) ? answer : [];
    if (a.length !== b.length) return false;
    return a.every((v, i) => v === b[i]);
  }

  // 칠하기(28-9): p(모를 확률) 구간 경계·설정에서 고른 구간의 가장 낮은 경계·낱말 색.
  const BAND_EASY = 0.35;
  const BAND_HARD = 0.65;
  const BAND_MIN = Object.freeze({ easy: 0, medium: BAND_EASY, hard: BAND_HARD });
  function bandOf(p) {
    if (typeof p !== 'number' || !Number.isFinite(p)) return null;
    return p < BAND_EASY ? 'easy' : p < BAND_HARD ? 'medium' : 'hard';
  }
  // 고른 구간 중 가장 낮은 경계. 아무것도 안 골랐으면 null(칠하지 않는다).
  function minPFor(bands) {
    if (!isObj(bands)) return null;
    let min = null;
    for (const k of ['easy', 'medium', 'hard']) {
      if (bands[k] === true && (min === null || BAND_MIN[k] < min)) min = BAND_MIN[k];
    }
    return min;
  }
  // 우선순위: 복습 끝(초록) > 고른 구간(주황) > 저장만 됨(✓). 알아요는 칠하지 않는다.
  function tokenColor({ p, bands, saved, done, known } = {}) {
    if (done === true) return 'green';
    if (known === true) return null;
    const b = bandOf(p);
    if (b && isObj(bands) && bands[b] === true) return 'orange';
    if (saved === true) return 'check';
    return null;
  }

  // 저장한 구(8낱말 이하)가 줄 안에 들어 있으면 그 낱말들의 토큰 번호 범위를 돌려준다.
  // 대소문자·문장부호는 무시하고, 겹치는 구는 앞에서 시작하고 더 긴 것을 먼저 고른다. start·end 는 tokenize 결과의 조각 번호(포함).
  const PHRASE_MAX_WORDS = 8;
  const phraseWords = (text) => String(text ?? '').toLowerCase().replace(/’/g, "'").match(/[a-z]+(?:['-][a-z]+)*/g) ?? [];
  function phraseSpans(tokens, phrases) {
    const list = Array.isArray(tokens) ? tokens : [];
    const words = [];
    list.forEach((tk, k) => {
      if (tk?.w) words.push({ lower: String(tk.lower ?? tk.t ?? '').toLowerCase(), k });
    });
    const found = [];
    const entries = Array.isArray(phrases) ? phrases : Object.values(isObj(phrases) ? phrases : {});
    for (const p of entries) {
      const text = typeof p === 'string' ? p : isObj(p) && typeof p.text === 'string' ? p.text : null;
      if (text === null) continue;
      const pw = phraseWords(text);
      if (!pw.length || pw.length > PHRASE_MAX_WORDS) continue;
      for (let i = 0; i + pw.length <= words.length; i++) {
        let same = true;
        for (let j = 0; j < pw.length; j++) {
          if (words[i + j].lower !== pw[j]) {
            same = false;
            break;
          }
        }
        if (same) found.push({ from: i, to: i + pw.length - 1, p, text });
      }
    }
    found.sort((a, b) => a.from - b.from || (b.to - b.from) - (a.to - a.from));
    const spans = [];
    let last = -1;
    for (const f of found) {
      if (f.from <= last) continue; // 앞에서 고른 구와 겹치면 건너뛴다
      last = f.to;
      const span = { start: words[f.from].k, end: words[f.to].k };
      // 그리는 쪽이 알약 색·글을 알아야 해서 넣되, 범위만 보는 시험의 deepEqual 에는 안 걸리게 숨긴다.
      Object.defineProperties(span, {
        text: { value: f.text, enumerable: false },
        done: { value: f.p?.review?.done === true, enumerable: false },
      });
      spans.push(span);
    }
    return spans;
  }

  // 마우스 말풍선(28-6): 어려운 단어 칠하기(S.hard)가 있으면 그것을, 없으면 사전 응답(dict)을 쓴다.
  // dict 는 아직 안 물었으면 없을 수 있고, 사전에 없으면 found:false 다. saved 는 지금 단어장에 있는지.
  function tooltipModel({ word, hard, dict, saved } = {}) {
    const w = cleanText(word).toLowerCase();
    const h = isObj(hard) ? hard : null;
    const d = isObj(dict) ? dict : null;
    const hardGloss = cleanText(h?.gloss);
    const entryGloss = cleanText(d?.entries?.[0]?.senses?.[0]?.text);
    const dictGloss = cleanText(d?.gloss) || (d?.found === true ? entryGloss : '');
    const found = Boolean(hardGloss) || Boolean(cleanText(h?.lemma)) || d?.found === true;
    return {
      lemma: cleanText(h?.lemma) || cleanText(d?.lemma) || w,
      gloss: hardGloss || dictGloss,
      state: found ? 'found' : 'missing',
      saved: saved === true,
    };
  }

  // 가리기(28-8): 'off' | 'word'(고른 유형 낱말만) | 'line'(고른 유형 낱말이 든 줄 통째로).
  // 유형은 hard(어려운 낱말)·done(복습 끝난 낱말)·other(나머지). 조각마다 가릴지 돌려준다.
  const HIDE_MODES = ['off', 'word', 'line'];
  const HIDE_LABEL = { off: '끔', word: '낱말', line: '줄' };
  const HIDE_TYPES = Object.freeze({ hard: true, done: false, other: false });
  function hideTypes(raw) {
    const r = isObj(raw) ? raw : {};
    return {
      hard: typeof r.hard === 'boolean' ? r.hard : HIDE_TYPES.hard,
      done: typeof r.done === 'boolean' ? r.done : HIDE_TYPES.done,
      other: typeof r.other === 'boolean' ? r.other : HIDE_TYPES.other,
    };
  }
  // typeOf(낱말) -> 'hard'|'done'|'other'. 'line' 은 고른 유형이 하나라도 있으면 낱말 조각을 모두 가린다
  // (사이의 글자·숫자는 그리는 쪽이 줄 전체를 보고 가린다).
  function maskFlags(tokens, mode, typeOf = () => 'other', types) {
    const list = Array.isArray(tokens) ? tokens : [];
    if (mode !== 'word' && mode !== 'line') return list.map(() => false);
    const pick = hideTypes(types);
    const kind = typeof typeOf === 'function' ? typeOf : () => 'other';
    const flags = list.map((tk) => Boolean(tk?.w) && pick[kind(tk.lower)] === true);
    return mode === 'line' && flags.some(Boolean) ? list.map((tk) => Boolean(tk?.w)) : flags;
  }
  const nextHide = (mode) => HIDE_MODES[(HIDE_MODES.indexOf(mode) + 1) % HIDE_MODES.length] ?? 'off';

  // 리스닝 드릴(28-8): Space 를 뗀 뒤 0.28초 안에 다시 누르면 재생/정지 토글, 그 밖에는 자막 보이기.
  // now·lastUp 은 초. nextLastUp 은 누르기를 처리한 뒤의 뗀 시각이다(누르는 중이라 아직 없으므로 null).
  const DRILL_DOUBLE = 0.28;
  function drillSpace({ now, lastUp } = {}) {
    const t = num(now);
    const up = num(lastUp);
    const quick = t !== null && up !== null && t >= up && t - up <= DRILL_DOUBLE;
    return { action: quick ? 'toggle' : 'reveal', nextLastUp: null };
  }

  // 느리게 재생(28-3): 0.5~0.9, 0.05 단위. 숫자가 아니면 기본 0.75.
  const SLOW_MIN = 0.5;
  const SLOW_MAX = 0.9;
  const SLOW_STEP = 0.05;
  const SLOW_DEFAULT = 0.75;
  function clampSlowRate(v) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return SLOW_DEFAULT;
    const snapped = Math.round(Math.round(v / SLOW_STEP) * SLOW_STEP * 100) / 100;
    return Math.min(SLOW_MAX, Math.max(SLOW_MIN, snapped));
  }
  // Z·[느리게]: 1 이 아니면 1 로, 1 이면 느린 속도로. 유튜브 메뉴로 바꾼 속도도 1 이 아니면 1 로 돌린다.
  const nextRate = (current, slowRate) => (Number(current) === 1 ? clampSlowRate(slowRate) : 1);

  // 줄 키(입력칸 밖·고른 글 없음은 부르는 쪽이 본다). 자판과 무관하게 같은 자리(e.code)라 한글 자판이어도 된다.
  // 28-2 랭플릭스 배치: A 이전 줄 · S 이 줄 처음 · D 다음 줄 · R 문장 반복 · Q 구간 반복 · Z 느리게.
  // W·L·/ 는 자리만 잡아 두고 해당 티켓(T53d·T53e·T53j)에서 동작을 붙인다.
  const KEYS = { KeyA: 'prev', KeyS: 'repeat', KeyD: 'next', KeyR: 'repeatLine', KeyQ: 'loop', KeyZ: 'slow', KeyW: 'focusMode', KeyL: 'drill', Slash: 'panel' };
  function keyAction(e) {
    if (!e || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.isComposing || e.repeat) return null;
    return Object.hasOwn(KEYS, e.code) ? KEYS[e.code] : null;
  }
  // Shift 단독(28-2): 다른 키·마우스로 끊기지 않았고 0.6초 안에 떼면 이 줄 저장. 시각은 밀리초.
  const SHIFT_TAP_MS = 600;
  function shiftTapAction({ downAt, upAt, interrupted } = {}) {
    if (interrupted) return null;
    if (!Number.isFinite(downAt) || !Number.isFinite(upAt)) return null;
    const held = upAt - downAt;
    return held >= 0 && held <= SHIFT_TAP_MS ? 'saveLine' : null;
  }

  // 키보드 저장 모드(28-7): 줄의 첫 어려운 낱말 자리(없으면 첫 낱말). hardSet 은 Set 이나 Map(S.hard).
  // 자리 번호는 tokenize 결과의 조각 번호다. 낱말이 없으면 -1.
  function focusStart(tokens, hardSet) {
    const list = Array.isArray(tokens) ? tokens : [];
    const has = (w) => typeof hardSet?.has === 'function' && hardSet.has(w);
    let first = -1;
    for (let k = 0; k < list.length; k++) {
      const tk = list[k];
      if (!tk?.w) continue;
      if (first < 0) first = k;
      if (has(tk.lower)) return k;
    }
    return first;
  }
  // ←·→: 낱말 자리 목록(wordIdxs)에서 앞뒤로 한 칸, 끝에서 처음으로 돈다. 빈 목록이면 -1.
  function focusStep(wordIdxs, cur, step) {
    const list = (Array.isArray(wordIdxs) ? wordIdxs : []).filter((k) => Number.isInteger(k));
    if (!list.length) return -1;
    const at = list.indexOf(cur);
    const dir = step < 0 ? -1 : 1;
    if (at < 0) return dir > 0 ? list[0] : list[list.length - 1];
    return list[(at + dir + list.length) % list.length];
  }
  // 사용자가 멈춘 것만 자동 포커스한다: 줄마다 멈춤·장면 구간 끝·카드·hold 는 제외(28-7).
  function shouldAutoFocus({ on, pauseReason } = {}) {
    return on === true && pauseReason === 'user';
  }

  // 줄마다 멈춤: 켜져 있고, 이 줄에서 아직 안 멈췄고, 끝 바로 앞~조금 뒤면 멈춘다(그보다 많이 뒤면 건너뛴 것으로 본다).
  function shouldPauseEach({ on, cur, pausedFor, t, cues }) {
    const c = cues?.[cur];
    return Boolean(on && c && pausedFor !== cur && t >= c.end - PAUSE_EARLY && t < c.end + PAUSE_LATE);
  }

  // 매 틱 할 일(변경 기록 28-1, 초 단위): 구간 반복 > 문장 반복 > 줄마다 멈춤 > 틈 건너뛰기.
  // mem 은 앞 틱의 표시({ repeatedFor, gapTo })를 그대로 받아 이어 쓴다. pausedFor 는 줄마다 멈춤을 한 줄에 한 번만 하려고 받는다.
  function playbackStep(input) {
    const i = isObj(input) ? input : {};
    const list = Array.isArray(i.cues) ? i.cues : [];
    const t = num(i.t);
    const cur = Number.isInteger(i.cur) ? i.cur : -1;
    const st = isObj(i.settings) ? i.settings : {};
    const from = isObj(i.mem) ? i.mem : {};
    const mem = {
      repeatedFor: Number.isInteger(from.repeatedFor) ? from.repeatedFor : -1,
      gapTo: Number.isInteger(from.gapTo) ? from.gapTo : -1,
    };
    const none = () => ({ action: 'none', mem });
    if (t === null) return none();
    const cue = cur >= 0 && cur < list.length ? list[cur] : null;
    const range = isObj(i.range) && finite(i.range.start) && finite(i.range.end) && i.range.end > i.range.start ? i.range : null;

    // 반복 표시는 줄 끝에서 충분히 앞으로 돌아오면 지운다(되감은 뒤 다시 한 번 되감을 수 있게)
    if (cue && t < cue.end - REPEAT_RESET) mem.repeatedFor = -1;
    // 틈 표시는 그 줄 안으로 들어오면 지운다(같은 틈을 다음에 지날 때도 다시 건너뛰게)
    if (cue && mem.gapTo >= 0 && t < cue.end) mem.gapTo = -1;

    // ① 구간 반복
    if (range && t >= range.end) return { action: 'seek', to: range.start, reason: 'range', mem };

    // ② 문장 반복: 이 줄 끝에 닿으면 줄 시작으로 한 번만
    if (st.repeatLine && cue && t >= cue.end - REPEAT_LEAD && mem.repeatedFor !== cur) {
      mem.repeatedFor = cur;
      return { action: 'seek', to: cue.start, reason: 'repeat', mem };
    }

    // ③ 줄마다 멈춤: 지금 동작(끝 0.08초 전부터 0.5초 뒤까지, 한 줄에 한 번)
    const pausedFor = Number.isInteger(i.pausedFor) ? i.pausedFor : -1;
    if (st.pauseEach && cue && pausedFor !== cur && t >= cue.end - PAUSE_EARLY && t < cue.end + PAUSE_LATE) {
      return { action: 'pause', reason: 'pauseEach', mem };
    }

    // ④ 틈 건너뛰기: 지금 줄이 끝나고 다음 줄이 0.4초 넘게 비어 있으면 다음 줄 시작으로
    if (st.skipGaps && cue && cur + 1 < list.length) {
      const next = list[cur + 1];
      if (t >= cue.end && t < next.start && next.start - t >= GAP_MIN && mem.gapTo !== cur + 1) {
        mem.gapTo = cur + 1;
        const to = range && next.start >= range.end ? range.start : next.start; // 구간 밖으로 나가면 구간 시작으로
        return { action: 'seek', to, reason: 'gap', mem };
      }
    }
    return none();
  }

  // 1분 라운드(28-14): 대본을 줄 경계에서만 끊어 50~75초 묶음으로 나눈다.
  // 누적 길이가 min 이상이면 target 에 가장 가까운 줄 끝을 고르고, max 를 넘는 줄 끝은 쓰지 않는다.
  // 한 줄이 max 보다 길면 그 줄 하나가 한 라운드다(줄을 자르지 않는다). 빈 대본은 [].
  const ROUND_MIN = 50;
  const ROUND_TARGET = 60;
  const ROUND_MAX = 75;
  function rounds(cues, options = {}) {
    const list = Array.isArray(cues) ? cues : [];
    if (!list.length) return [];
    const o = isObj(options) ? options : {};
    const min = num(o.min) ?? ROUND_MIN;
    const target = num(o.target) ?? ROUND_TARGET;
    const max = num(o.max) ?? ROUND_MAX;
    const out = [];
    let from = 0;
    while (from < list.length) {
      const start = num(list[from]?.start);
      if (start === null) break;
      let best = -1;
      let bestDiff = Infinity;
      let to = from;
      for (; to < list.length; to++) {
        const end = num(list[to]?.end);
        if (end === null) break;
        const len = end - start;
        if (len > max) {
          if (to === from) best = from; // 한 줄이 max 보다 길면 그 줄 하나
          break; // max 를 넘기기 전 줄 끝에서 끊는다
        }
        if (len >= min) {
          const diff = Math.abs(len - target);
          if (diff < bestDiff) {
            bestDiff = diff;
            best = to;
          }
        }
      }
      if (best < 0) best = Math.max(from, Math.min(to - 1, list.length - 1));
      const end = num(list[best]?.end);
      if (end === null) break;
      out.push({ start, end, from, to: best });
      from = best + 1;
    }
    return out;
  }

  // 장면
  function parseT(v) {
    const s = String(v ?? '').trim();
    if (/^\d+(?:\.\d+)?s?$/.test(s)) return Math.floor(Number(s.replace(/s$/, '')));
    const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(s);
    return m && s ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
  }
  // 유튜브 영상 주소 -> { id, t } | null. youtube.com/watch?v= · youtu.be/<id>
  function parseScene(url) {
    if (typeof url !== 'string' || url.length > 2000) return null;
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
      const host = u.hostname.replace(/^(www|m)\./, '');
      let id = '';
      if (host === 'youtube.com' && u.pathname === '/watch') id = u.searchParams.get('v') ?? '';
      else if (host === 'youtu.be') id = u.pathname.slice(1);
      if (!ID_RE.test(id)) return null;
      return { id, t: parseT(u.searchParams.get('t')) };
    } catch {
      return null;
    }
  }
  const videoIdOf = (href) => parseScene(href)?.id ?? null;
  const sceneUrl = (id, sec) => `https://www.youtube.com/watch?v=${id}&t=${Math.max(0, Math.floor(Number(sec) || 0))}s`;

  // 장면 구간 { start, end }: 다리 words.mjs 와 같은 규칙(0 ≤ start < end ≤ 86400, 길이 ≤ 60)
  // 길이는 1/100초 정수로 잰다: 소수로 빼면 60.14 - 0.14 가 60.00000000000001 이 되어 60초 구간이 거절된다
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const cs = (v) => Math.round(v * 100);
  const validClip = (c) => isObj(c) && finite(c.start) && finite(c.end) && c.start >= 0 && c.end <= MAX_TIME && cs(c.end) > cs(c.start) && cs(c.end) - cs(c.start) <= MAX_CLIP * 100;
  function clipOfCue(cue) {
    const s = cs(cue.start);
    return { start: s / 100, end: Math.min(cs(cue.end), s + MAX_CLIP * 100) / 100 };
  }
  // 낱말 장면(t 만 있음)의 구간. t 는 줄 시작을 초 단위로 내린 값이라 [t, t+1) 안에서 시작한 첫 줄이 그 장면이다.
  // 그런 줄이 없으면 t 가 든 줄, 그것도 없으면 t 부터 6초.
  function clipAt(cues, t) {
    const list = Array.isArray(cues) ? cues : [];
    let i = activeIndex(list, t + 0.999);
    if (i >= 0 && list[i].start >= t - 0.001) {
      while (i > 0 && list[i - 1].start >= t - 0.001) i--;
      return clipOfCue(list[i]);
    }
    const c = list[i];
    return c && t < c.end ? clipOfCue(c) : { start: Math.max(0, t), end: Math.max(0, t) + 6 };
  }
  // 복습 카드 -> 장면 { id, t, clip, url } | null
  function sceneOf(card) {
    const s = parseScene(card?.url);
    if (!s) return null;
    const clip = validClip(card.clip) ? { start: card.clip.start, end: card.clip.end } : null;
    const t = clip ? Math.floor(clip.start) : s.t;
    return { id: s.id, t, clip, url: sceneUrl(s.id, t) };
  }

  // 줄 저장 메시지(다리 save-phrase)
  function lineMessage({ cue, ko = '', id, title = '' }) {
    const msg = { type: 'words', op: 'save-phrase', text: clipStart(cleanText(cue.text), MAX_LINE), translation: clipStart(cleanText(ko), 2000), kind: 'sentence', url: sceneUrl(id, cue.start) };
    const clip = clipOfCue(cue);
    if (validClip(clip)) msg.clip = clip; // 아주 짧은 줄(1/100초 안)은 구간 없이 — 틀린 구간이면 다리가 저장을 통째로 거절한다
    const t = clipStart(cleanText(title), MAX_TITLE);
    if (t) msg.title = t;
    return msg;
  }

  // 사전 카드·풀이의 문맥: 앞 3줄·뒤 3줄, 영상 제목
  function contextOf(cues, i, title = '') {
    const list = Array.isArray(cues) ? cues : [];
    const join = (a) => cleanText(a.map((c) => c.text).join(' '));
    return {
      before: clipEnd(join(list.slice(Math.max(0, i - 3), Math.max(0, i))), MAX_SIDE),
      after: clipStart(join(list.slice(i + 1, i + 4)), MAX_SIDE),
      title: clipStart(cleanText(title), MAX_TITLE),
    };
  }

  // 어려운 단어 묻기(/annotate 300개·본문 16KB 상한): from 줄부터 maxCues 줄 안에서 아직 안 물은 낱말, 글자 합 maxChars 까지
  function annotateBatch(cues, from, asked, { maxCues = 30, max = 300, maxChars = 12_000 } = {}) {
    const list = Array.isArray(cues) ? cues : [];
    const seen = new Set();
    const words = [];
    let chars = 0;
    const end = Math.min(list.length, Math.max(0, from) + maxCues);
    for (let i = Math.max(0, from); i < end && words.length < max; i++) {
      for (const tk of tokenize(list[i].text)) {
        if (!tk.w || seen.has(tk.lower) || asked?.has?.(tk.lower)) continue;
        if (chars + tk.lower.length + 3 > maxChars) return { words };
        seen.add(tk.lower);
        words.push(tk.lower);
        chars += tk.lower.length + 3; // 따옴표 둘과 쉼표
        if (words.length >= max) break;
      }
    }
    return { words };
  }

  // 어려운 단어 미리 보기: items(Map 낱말 -> { lemma, gloss }) 를 대본에서 처음 나온 순으로, 원형마다 하나, 횟수 포함
  function previewWords(cues, items, max = 60) {
    const get = (w) => (items instanceof Map ? items.get(w) : isObj(items) && Object.hasOwn(items, w) ? items[w] : undefined);
    const by = new Map();
    (Array.isArray(cues) ? cues : []).forEach((c, i) => {
      for (const tk of tokenize(c.text)) {
        if (!tk.w) continue;
        const it = get(tk.lower);
        if (!it) continue;
        const key = typeof it.lemma === 'string' && it.lemma ? it.lemma : tk.lower;
        const row = by.get(key);
        if (row) row.count++;
        else by.set(key, { word: tk.lower, lemma: key, gloss: typeof it.gloss === 'string' ? it.gloss : '', count: 1, first: i });
      }
    });
    return [...by.values()].slice(0, max);
  }

  // 다음에 번역할 줄 번호(-1 = 없음): 지금 줄 근처 먼저, all 이면 그 뒤로 끝까지, 다음에 처음부터
  function koPlan(n, cur, has, all = false) {
    const ok = (i) => i >= 0 && i < n && !has(i);
    const base = Math.max(0, cur);
    for (const d of KO_NEAR) if (ok(base + d)) return base + d;
    if (!all) return -1;
    for (let i = base + 5; i < n; i++) if (ok(i)) return i;
    for (let i = 0; i < base; i++) if (ok(i)) return i;
    return -1;
  }

  // 자막 글자 크기(px): 플레이어 높이 × 3.6% × 설정 %, 14~44
  const fontPx = (playerHeight, pct = 100) => Math.min(44, Math.max(14, Math.round((Number(playerHeight) || 0) * 0.036 * ((Number(pct) || 100) / 100))));

  // 0:05 · 12:34 · 1:02:03
  function fmtTime(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
  }

  // 영상 제목: "제목 - YouTube" 에서 뒤를 뗀다. 알림 수 "(3) 제목" 도 뗀다.
  const titleOf = (docTitle) => cleanText(String(docTitle ?? '').replace(/\s+-\s+YouTube$/, '').replace(/^\(\d+\)\s+/, '')).slice(0, MAX_TITLE);

  // 세로 컨트롤 막대(28-10): 설정 순서에서 모르는 이름을 빼고, 빠진 단추는 뒤에 붙인 뒤 숨김을 표시한다.
  // all 은 화면이 아는 모든 단추 이름(기본 순서 배열), order·hidden 은 저장된 설정이다.
  function barModel(order, hidden, all) {
    const names = [];
    const known = new Set();
    for (const k of Array.isArray(all) ? all : []) {
      if (typeof k === 'string' && k && !known.has(k)) {
        known.add(k);
        names.push(k);
      }
    }
    const out = [];
    const seen = new Set();
    const add = (k) => {
      if (!known.has(k) || seen.has(k)) return;
      seen.add(k);
      out.push(k);
    };
    for (const k of Array.isArray(order) ? order : []) add(k);
    for (const k of names) add(k); // 빠진 단추는 뒤에 붙인다
    const hid = new Set((Array.isArray(hidden) ? hidden : []).filter((k) => typeof k === 'string'));
    return out.map((name) => ({ name, hidden: hid.has(name) }));
  }
  // 진행 막대 위 좌표 -> 영상 시각(초). 폭이 0이거나 숫자가 아니면 0, 0~duration 으로 자른다.
  function xToTime(x, width, duration) {
    const px = num(x);
    const w = num(width);
    const d = num(duration);
    if (px === null || w === null || d === null || w <= 0 || d <= 0) return 0;
    return Math.min(d, Math.max(0, (px / w) * d));
  }

  // 자막 스타일(28-11): subType 에 따라 두 줄을 보일지, koAbove 면 한국어를 위에 둘지.
  const SUB_TYPES = ['dual', 'en', 'ko', 'none'];
  function subLayout({ subType, koAbove } = {}) {
    const t = SUB_TYPES.includes(subType) ? subType : 'dual';
    const showEn = t === 'dual' || t === 'en';
    const showKo = t === 'dual' || t === 'ko';
    return { showEn, showKo, order: koAbove === true ? ['ko', 'en'] : ['en', 'ko'] };
  }

  globalThis.readglossVideo = {
    ID_RE, ASR, GRACE, MAX_CLIP, MAX_ROUND: ROUND_MAX, ROUND_MIN, ROUND_TARGET, ROUND_MAX, HIDE_MODES, HIDE_LABEL, HIDE_TYPES, KEYS, SLOW_MIN, SLOW_MAX, SLOW_STEP, SLOW_DEFAULT, DRILL_DOUBLE, MODES, MODE_LABEL,
    params, decodeEntities, cleanText, normalizeCues, groupWords, parseJson3, parseXml, parseVtt, parseTrack,
    validPolish, polishedCues,
    langOf, isEnglish, isKorean, pickTracks, alignKo, activeIndex, isLive, tokenize, shuffleTiles, tileCheck, bandOf, minPFor, tokenColor, phraseSpans, tooltipModel, hideTypes, maskFlags, nextHide, drillSpace, clampSlowRate, nextRate, keyAction, shiftTapAction, focusStart, focusStep, shouldAutoFocus, shouldPauseEach, playbackStep,
    parseT, parseScene, videoIdOf, sceneUrl, validClip, clipOfCue, clipAt, sceneOf, lineMessage, contextOf, annotateBatch, previewWords, koPlan, fontPx, fmtTime, titleOf, barModel, xToTime, subLayout, rounds,
  };
})();
