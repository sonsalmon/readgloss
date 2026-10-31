// bridge/review.mjs
// 복습 고리(간격 반복) 순수 함수 및 유효성 검사.
import { dateOf } from '../scripts/export-day.mjs';

// 상자별 다음 복습 간격 일수
export const INTERVALS = {
  1: 1,
  2: 2,
  3: 4,
  4: 8,
  5: 16,
};

// 복습 유형(28-19). 뒤집기·고르기·듣기·빈칸 타이핑.
export const REVIEW_MODE_IDS = ['flip', 'choice', 'listen', 'type'];

// 유형 배열 정리: 아는 이름만 남기고 같은 이름은 한 번만.
const modeList = (v) => (Array.isArray(v) ? [...new Set(v.filter((m) => REVIEW_MODE_IDS.includes(m)))] : []);

// 이 카드에 쓸 수 있는 유형(28-19): 뒤집기·듣기는 늘, 고르기는 확장이 보낸 modes 를 믿고,
// 빈칸은 낱말이면 저장 문장이 있을 때·구면 기본형(base)이 있을 때.
export function availableModes(card) {
  if (!card || typeof card !== 'object') return ['flip', 'listen'];
  const sent = Array.isArray(card.modes) ? card.modes : [];
  const out = ['flip'];
  if (sent.includes('choice')) out.push('choice');
  out.push('listen');
  const typingText = card.type === 'phrase' ? card.base : card.sentence;
  if (typeof typingText === 'string' && typingText.trim()) out.push('type');
  return out;
}

// 날짜 더하기(서울 날짜 YYYY-MM-DD 문자열)
export function addDays(todayStr, days) {
  const [y, m, d] = todayStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days, 12, 0, 0);
  return dateOf(dt.getTime());
}

// 새 항목의 초기 복습 상태
export function initialReview(today) {
  return {
    box: 1,
    due: today,
    last: 0,
    done: false,
    count: 0,
  };
}

// 복습 결과 적용 ('know' | 'again' | 'hold').
// 4번째 인자는 예전처럼 now(밀리초) 하나이거나 { mode, modes } 객체다(28-19).
// mode 가 없으면 예전 그대로(영어 튜터 호환). hold 는 상자·날짜·기록을 그대로 둔다.
export function applyReview(review, result, today, nowOrOptions, maybeOptions) {
  const options = nowOrOptions && typeof nowOrOptions === 'object' ? nowOrOptions : (maybeOptions ?? {});
  const now = typeof nowOrOptions === 'number' && Number.isFinite(nowOrOptions)
    ? nowOrOptions
    : (Number.isFinite(options.now) ? options.now : Date.now());
  const mode = REVIEW_MODE_IDS.includes(options.mode) ? options.mode : undefined;
  const modes = modeList(options.modes);
  const hadPassed = Array.isArray(review?.passed);
  let passed = modeList(review?.passed);

  if (result === 'hold') return { ...review };

  const isKnow = result === 'know';
  let box = 1;
  let done = false;
  let due = '';

  if (isKnow) {
    if (mode) passed = [...new Set([...passed, mode])];
    if (review.box >= 5) {
      box = 5;
      if (mode && modes.length) {
        // 확장이 보낸 유형을 모두 맞혀야 복습 끝. 아니면 상자 5 에서 다음 날 남은 유형으로.
        done = modes.every((m) => passed.includes(m));
        due = addDays(today, done ? INTERVALS[5] : 1);
      } else {
        // 옛 호출(mode 없음): 상자 5 에서 know 면 바로 done.
        done = true;
        due = addDays(today, INTERVALS[5]);
      }
    } else {
      box = review.box + 1;
      done = false;
      due = addDays(today, INTERVALS[box]);
    }
  } else {
    box = 1;
    done = false;
    due = addDays(today, 1);
    if (mode || hadPassed) passed = [];
  }

  const next = {
    box,
    due,
    last: now,
    done,
    count: (review.count ?? 0) + 1,
  };
  // passed 는 새 호출(mode 있음)이나 이미 쓰던 상태에서만 더한다(옛 응답 모양 유지).
  if (mode || hadPassed) next.passed = passed;
  return next;
}

// 오늘 복습 대상 여부
export function isDue(review, today) {
  return Boolean(review && !review.done && typeof review.due === 'string' && review.due <= today);
}

// review 객체 유효성 검증 및 정규화 (형식에 맞으면 객체, 틀리면 null)
export function isValidReview(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const { box, due, done, count, last, passed } = v;
  if (!Number.isInteger(box) || box < 1 || box > 5) return null;
  if (typeof due !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(due)) return null;
  if (typeof done !== 'boolean') return null;
  if (!Number.isInteger(count) || count < 0) return null;
  if (typeof last !== 'number' || !Number.isFinite(last)) return null;
  if (passed !== undefined && (!Array.isArray(passed) || !passed.every((m) => REVIEW_MODE_IDS.includes(m)))) return null;
  return { box, due, done, count, last, ...(passed !== undefined && { passed: modeList(passed) }) };
}
