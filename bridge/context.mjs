// 드래그 번역·AI 문맥 뜻이 싣는 문맥(선택한 글 앞뒤, 글 제목·소제목)의 검증과 캐시 키.
// 문맥은 신뢰할 수 없는 데이터라 여기서 모양과 길이만 확인한다. 상한을 넘으면 자르지 않고 413 으로 돌려보낸다(확장의 selection-core.js 와 맞춘다).
import { createHash } from 'node:crypto';
import { normalizeText } from './translate.mjs';

export const LIMITS = { text: 1000, before: 1500, after: 1500, title: 200, headings: 5, heading: 200 };
// "더 넓은 문맥"(wide) 요청의 상한. 앞뒤 글과 목차만 늘고, 제목·선택한 글은 그대로다.
export const WIDE_LIMITS = { ...LIMITS, before: 6000, after: 6000, headings: 20 };

// raw -> { context: null | { before, after, title, headings } } | { status: 400 | 413 }. 아무 글도 없으면 context 는 null.
export function parseContext(raw, wide = false) {
  const lim = wide ? WIDE_LIMITS : LIMITS;
  if (raw === undefined || raw === null) return { context: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { status: 400 };
  const str = (v) => (v === undefined ? '' : typeof v === 'string' ? normalizeText(v) : null);
  const before = str(raw.before);
  const after = str(raw.after);
  const title = str(raw.title);
  const list = raw.headings === undefined ? [] : raw.headings;
  if (before === null || after === null || title === null || !Array.isArray(list) || list.some((h) => typeof h !== 'string')) return { status: 400 };
  const headings = list.map(normalizeText).filter(Boolean);
  if (before.length > lim.before || after.length > lim.after || title.length > lim.title || list.length > lim.headings || headings.some((h) => h.length > lim.heading)) return { status: 413 };
  return { context: before || after || title || headings.length ? { before, after, title, headings } : null };
}

// 요청 본문의 wide 값 -> true | false | null(boolean 이 아님). 없으면 false.
export const parseWide = (v) => (v === undefined || v === null ? false : typeof v === 'boolean' ? v : null);

// 글 + 문맥 + 켜진 분야 -> sha256. 앞뒤 문맥이 달라지면 번역도 달라질 수 있어 모두 키에 넣는다.
// wide(더 넓은 문맥으로 물은 것)와 mine(내 사전 용어 지정 문자열)은 있을 때만 키에 더한다: 없는 요청의 키는 예전 그대로.
export const contextKey = (text, context, domainsKey = '', { wide = false, mine = '' } = {}) =>
  createHash('sha256')
    .update(JSON.stringify([normalizeText(text), context?.before ?? '', context?.after ?? '', context?.title ?? '', context?.headings ?? [], domainsKey, ...(wide ? ['wide'] : []), ...(mine ? [`mine:${mine}`] : [])]))
    .digest('hex');
