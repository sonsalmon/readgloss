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

// 복습 결과 적용 ('know' | 'again')
export function applyReview(review, result, today, now) {
  const isKnow = result === 'know';
  let box = 1;
  let done = false;
  let due = '';

  if (isKnow) {
    if (review.box >= 5) {
      box = 5;
      done = true;
    } else {
      box = review.box + 1;
      done = false;
    }
    due = addDays(today, INTERVALS[box]);
  } else {
    box = 1;
    done = false;
    due = addDays(today, 1);
  }

  return {
    box,
    due,
    last: now,
    done,
    count: (review.count ?? 0) + 1,
  };
}

// 오늘 복습 대상 여부
export function isDue(review, today) {
  return Boolean(review && !review.done && typeof review.due === 'string' && review.due <= today);
}

// review 객체 유효성 검증 및 정규화 (형식에 맞으면 객체, 틀리면 null)
export function isValidReview(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const { box, due, done, count, last } = v;
  if (!Number.isInteger(box) || box < 1 || box > 5) return null;
  if (typeof due !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(due)) return null;
  if (typeof done !== 'boolean') return null;
  if (!Number.isInteger(count) || count < 0) return null;
  if (typeof last !== 'number' || !Number.isFinite(last)) return null;
  return { box, due, done, count, last };
}
