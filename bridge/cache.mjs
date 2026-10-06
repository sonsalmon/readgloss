import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// 단어(소문자 키) -> 한국어 뜻. 파일 하나(JSON). 깨졌으면 빈 캐시로 시작한다.
export function createCache(file) {
  const map = new Map();
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') map.set(k, v);
    }
  } catch {
    // 파일 없음/깨짐: 빈 캐시
  }
  return {
    get: (key) => map.get(key),
    set(key, gloss) {
      map.set(key, gloss);
      mkdirSync(dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(Object.fromEntries(map)));
      renameSync(tmp, file); // 원자적 교체
    },
  };
}
