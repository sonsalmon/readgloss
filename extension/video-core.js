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

  // json3 에 낱말마다 시각(tOffsetMs)이나 자동 인식 점수(acAsrConf)가 있으면 자동 생성 자막이다.
  const json3HasWordTiming = (obj) => (Array.isArray(obj?.events) ? obj.events : []).some((ev) => Array.isArray(ev?.segs) && ev.segs.some((s) => isObj(s) && ('tOffsetMs' in s || 'acAsrConf' in s)));

  function parseJson3(obj, asr) {
    const events = Array.isArray(obj?.events) ? obj.events : [];
    if (asr) {
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
      return groupWords(words);
    }
    const cues = [];
    for (const ev of events) {
      const t0 = num(ev?.tStartMs);
      if (t0 === null || !Array.isArray(ev.segs)) continue;
      const text = ev.segs.map((s) => (typeof s?.utf8 === 'string' ? s.utf8 : '')).join('');
      const dur = num(ev.dDurationMs) ?? 0;
      cues.push({ start: t0 / 1000, end: (t0 + dur) / 1000, text });
    }
    return normalizeCues(cues);
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
    return words.length ? { cues: groupWords(words), asr: true } : { cues: normalizeCues(cues), asr: false };
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

  // 자막 응답 하나 -> { videoId, lang, tlang, kind:'asr'|'manual', cues } | null(못 읽음·빈 자막)
  function parseTrack(body, url) {
    if (typeof body !== 'string' || !body.trim()) return null;
    const p = params(url);
    // 유튜브 자동 번역(tlang)은 자동 생성 자막을 옮긴 것이라도 줄 단위로 온다(낱말 시각 없음)
    let asr = !p.tlang && p.kind === 'asr';
    let cues = null;
    const s = body.trimStart();
    try {
      if (s[0] === '{') {
        const obj = JSON.parse(s);
        asr = asr || (!p.tlang && json3HasWordTiming(obj));
        cues = parseJson3(obj, asr);
      } else if (s.startsWith('WEBVTT')) {
        cues = parseVtt(s);
      } else if (s[0] === '<') {
        const r = parseXml(s);
        cues = r.cues;
        asr = asr || r.asr;
      }
    } catch {
      return null;
    }
    if (!cues?.length) return null;
    return { videoId: ID_RE.test(p.v) ? p.v : null, lang: p.lang, tlang: p.tlang, kind: asr ? 'asr' : 'manual', cues };
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

  // 가리기: 'off' | 'hard'(isHard 인 낱말) | 'all'(낱말 전부). 조각마다 가릴지.
  const HIDE_MODES = ['off', 'hard', 'all'];
  const HIDE_LABEL = { off: '끔', hard: '어려운 단어', all: '문장' };
  function maskFlags(tokens, mode, isHard = () => false) {
    return (Array.isArray(tokens) ? tokens : []).map((tk) => Boolean(tk?.w) && (mode === 'all' || (mode === 'hard' && isHard(tk.lower) === true)));
  }
  const nextHide = (mode) => HIDE_MODES[(HIDE_MODES.indexOf(mode) + 1) % HIDE_MODES.length] ?? 'off';

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

  globalThis.readglossVideo = {
    ID_RE, ASR, GRACE, MAX_CLIP, HIDE_MODES, HIDE_LABEL, KEYS, SLOW_MIN, SLOW_MAX, SLOW_STEP, SLOW_DEFAULT,
    params, decodeEntities, cleanText, normalizeCues, groupWords, parseJson3, parseXml, parseVtt, parseTrack,
    langOf, isEnglish, isKorean, pickTracks, alignKo, activeIndex, isLive, tokenize, maskFlags, nextHide, clampSlowRate, nextRate, keyAction, shiftTapAction, shouldPauseEach, playbackStep,
    parseT, parseScene, videoIdOf, sceneUrl, validClip, clipOfCue, clipAt, sceneOf, lineMessage, contextOf, annotateBatch, previewWords, koPlan, fontPx, fmtTime, titleOf,
  };
})();
