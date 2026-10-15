// bridge/structure.mjs
// 문장 구조: 전치사 + 관계사 구절의 문장 뼈대 분석 및 한국어 풀이.
import { createHash } from 'node:crypto';
import { AiParseError } from './parse.mjs';
import { normalizeText, parseJsonObject } from './translate.mjs';

const MAX_SKELETON_ITEMS = 8;
const MAX_SKELETON_TEXT = 300;
const MAX_PHRASE = 200;
const MAX_KO = 600;

const ALLOWED_ROLES = new Set(['주어', '동사', '목적어', '보어', '수식']);

const STRUCTURE_TASK =
  '과제: 영어 문장의 뼈대(주어·동사·목적어·보어, 그리고 큰 수식 덩어리)를 원문 조각으로 나누고, phrase(예: "for which")가 무엇을 가리키며 문장 안에서 어떤 역할인지 한국어 한 줄로 풀고, 문장 전체를 자연스러운 한국어로 번역. ' +
  '출력 JSON 한 줄 {"skeleton":[{"role":"주어|동사|목적어|보어|수식","text":"..."}],"phrase":"for which = ...","ko":"..."}.';

// 전치사 목록 (spec.md 21-1 정본)
const PREPS =
  'in|on|at|for|of|to|from|by|with|under|through|during|without|about|over|into|upon|within|among|between|across|behind|beyond|via|against|toward|towards';

const PREP_WHICH_RE = new RegExp(`^(?:${PREPS})\\s+which$`, 'i');
const PREP_WHOM_RE = new RegExp(`^(?:${PREPS})\\s+whom$`, 'i');
const PREP_WHOSE_RE = new RegExp(`^(?:${PREPS})\\s+whose$`, 'i');

// 구절 분류: 'prep+which' | 'prep+whom' | 'prep+whose' | 'extent-to-which' | 'degree-to-which' | 'way-in-which' | 'other'
export function patternOf(phrase) {
  if (typeof phrase !== 'string') return 'other';
  const norm = phrase.trim().replace(/\s+/g, ' ').toLowerCase();
  if (/^(?:the\s+)?extent\s+to\s+which$/.test(norm)) return 'extent-to-which';
  if (/^(?:the\s+)?degree\s+to\s+which$/.test(norm)) return 'degree-to-which';
  if (/^(?:the\s+)?way\s+in\s+which$/.test(norm)) return 'way-in-which';
  if (PREP_WHICH_RE.test(norm)) return 'prep+which';
  if (PREP_WHOM_RE.test(norm)) return 'prep+whom';
  if (PREP_WHOSE_RE.test(norm)) return 'prep+whose';
  return 'other';
}

// 프롬프트 생성: 과제 설명 + 입력 JSON 마지막 줄
export function buildStructurePrompt({ sentence, phrase, title }) {
  const normSentence = normalizeText(sentence);
  const normPhrase = normalizeText(phrase);
  const normTitle = typeof title === 'string' && title.trim() ? normalizeText(title) : '';
  const input = {
    sentence: normSentence,
    phrase: normPhrase,
    ...(normTitle ? { title: normTitle } : {}),
  };
  return `${STRUCTURE_TASK}\n${JSON.stringify(input)}`;
}

// AI 출력 파싱: skeleton(역할 5종·text<=300, 최대 8개), phrase<=200, ko<=600. 깨졌으면 AiParseError
export function parseStructure(text) {
  const obj = parseJsonObject(text);
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new AiParseError('parse: not object');
  }

  if (!Array.isArray(obj.skeleton)) {
    throw new AiParseError('parse: bad skeleton');
  }

  const skeleton = [];
  for (const item of obj.skeleton) {
    if (
      item &&
      typeof item === 'object' &&
      typeof item.role === 'string' &&
      ALLOWED_ROLES.has(item.role) &&
      typeof item.text === 'string'
    ) {
      const trimmedText = item.text.trim();
      if (trimmedText.length >= 1 && trimmedText.length <= MAX_SKELETON_TEXT) {
        skeleton.push({ role: item.role, text: trimmedText });
      }
    }
    if (skeleton.length === MAX_SKELETON_ITEMS) break;
  }

  if (skeleton.length === 0) {
    throw new AiParseError('parse: empty skeleton');
  }

  if (typeof obj.phrase !== 'string') {
    throw new AiParseError('parse: bad phrase');
  }
  const phrase = obj.phrase.trim();
  if (!phrase || phrase.length > MAX_PHRASE) {
    throw new AiParseError('parse: bad phrase');
  }

  if (typeof obj.ko !== 'string') {
    throw new AiParseError('parse: bad ko');
  }
  const ko = obj.ko.trim();
  if (!ko || ko.length > MAX_KO) {
    throw new AiParseError('parse: bad ko');
  }

  return { skeleton, phrase, ko };
}

// 캐시 열쇠 = sha1(정리한 sentence + '\u0000' + 소문자 phrase)
export function structureKey(sentence, phrase) {
  const normSentence = normalizeText(sentence);
  const lowerPhrase = normalizeText(phrase).toLowerCase();
  return createHash('sha1').update(normSentence + '\0' + lowerPhrase).digest('hex');
}

// createStructure({ cache, ask, db, now }) -> explain({ sentence, phrase, title, force })
export function createStructure({ cache, ask, db, now = Date.now }) {
  async function explain({ sentence, phrase, title, force = false }) {
    const key = structureKey(sentence, phrase);
    let hitResult = null;

    if (!force && cache) {
      try {
        const hit = JSON.parse(cache.get(key) ?? 'null');
        if (
          hit &&
          Array.isArray(hit.skeleton) &&
          typeof hit.phrase === 'string' &&
          typeof hit.ko === 'string'
        ) {
          hitResult = hit;
        }
      } catch {
        // 깨진 캐시 항목은 무시하고 AI 호출로 진행
      }
    }

    let parsed;
    let cached = false;
    if (hitResult) {
      parsed = hitResult;
      cached = true;
    } else {
      const prompt = buildStructurePrompt({ sentence, phrase, title });
      const raw = await ask(prompt);
      parsed = parseStructure(raw);
      if (cache) {
        cache.set(key, JSON.stringify(parsed));
      }
    }

    // 열 때마다 sstat 누적
    const pattern = patternOf(phrase);
    const nowTs = typeof now === 'function' ? now() : now;
    let opened = 1;

    if (db) {
      const id = `ss_${pattern}`;
      const existing = db.get(id);
      const prevOpened =
        typeof existing?.data?.opened === 'number' && Number.isFinite(existing.data.opened)
          ? existing.data.opened
          : 0;
      opened = prevOpened + 1;
      db.put({
        id,
        kind: 'sstat',
        key: pattern,
        data: {
          opened,
          lastOpened: nowTs,
        },
        ts: nowTs,
      });
    }

    return {
      skeleton: parsed.skeleton,
      phrase: parsed.phrase,
      ko: parsed.ko,
      pattern,
      opened,
      cached,
    };
  }

  // stats() -> { patterns: [{ pattern, opened }] } 많은 순
  function stats() {
    if (!db) {
      return { patterns: [] };
    }
    const nodes = db.byKind('sstat');
    const patterns = nodes.map((n) => {
      const d = n.data || {};
      return {
        pattern: n.key || n.id.replace(/^ss_/, ''),
        opened: typeof d.opened === 'number' && Number.isFinite(d.opened) ? d.opened : 0,
      };
    });
    patterns.sort((a, b) => b.opened - a.opened);
    return { patterns };
  }

  explain.explain = explain;
  explain.stats = stats;
  return explain;
}
