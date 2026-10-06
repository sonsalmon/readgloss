// 드래그 번역·AI 문맥 뜻이 싣는 문맥(선택한 글 앞뒤, 글 제목·소제목)의 검증과 캐시 키.
// 문맥은 신뢰할 수 없는 데이터라 여기서 모양과 길이만 확인한다. 상한을 넘으면 자르지 않고 413 으로 돌려보낸다(확장의 selection-core.js 와 맞춘다).
import { createHash } from 'node:crypto';
import { normalizeText } from './translate.mjs';

export const LIMITS = { text: 1000, before: 1500, after: 1500, title: 200, headings: 5, heading: 200 };

// raw -> { context: null | { before, after, title, headings } } | { status: 400 | 413 }. 아무 글도 없으면 context 는 null.
export function parseContext(raw) {
  if (raw === undefined || raw === null) return { context: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { status: 400 };
  const str = (v) => (v === undefined ? '' : typeof v === 'string' ? normalizeText(v) : null);
  const before = str(raw.before);
  const after = str(raw.after);
  const title = str(raw.title);
  const list = raw.headings === undefined ? [] : raw.headings;
  if (before === null || after === null || title === null || !Array.isArray(list) || list.some((h) => typeof h !== 'string')) return { status: 400 };
  const headings = list.map(normalizeText).filter(Boolean);
  if (before.length > LIMITS.before || after.length > LIMITS.after || title.length > LIMITS.title || list.length > LIMITS.headings || headings.some((h) => h.length > LIMITS.heading)) return { status: 413 };
  return { context: before || after || title || headings.length ? { before, after, title, headings } : null };
}

// 글 + 문맥 + 켜진 분야 -> sha256. 앞뒤 문맥이 달라지면 번역도 달라질 수 있어 모두 키에 넣는다.
export const contextKey = (text, context, domainsKey = '') =>
  createHash('sha256').update(JSON.stringify([normalizeText(text), context?.before ?? '', context?.after ?? '', context?.title ?? '', context?.headings ?? [], domainsKey])).digest('hex');
