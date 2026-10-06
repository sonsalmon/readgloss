import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCache } from '../bridge/cache.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'rg-cache-'));

test('없는 파일이면 빈 캐시로 시작', () => {
  const c = createCache(join(tmp(), 'cache.json'));
  assert.equal(c.get('word'), undefined);
});

test('set 한 값은 새 인스턴스에서도 읽힌다(파일에 남는다)', () => {
  const f = join(tmp(), 'sub', 'cache.json');
  createCache(f).set('payload', '페이로드');
  assert.equal(createCache(f).get('payload'), '페이로드');
});

test('저장은 임시 파일 뒤 rename 이라 tmp 찌꺼기가 남지 않는다', () => {
  const d = tmp();
  createCache(join(d, 'cache.json')).set('a', '가');
  assert.deepEqual(readdirSync(d), ['cache.json']);
});

test('파일이 깨졌으면 비우고 시작, 다음 set 으로 복구', () => {
  const d = tmp();
  const f = join(d, 'cache.json');
  writeFileSync(f, '{깨짐');
  const c = createCache(f);
  assert.equal(c.get('a'), undefined);
  c.set('a', '가');
  assert.deepEqual(JSON.parse(readFileSync(f, 'utf8')), { a: '가' });
});

test('JSON 이지만 객체가 아니거나 문자열이 아닌 값은 버린다', () => {
  const d = tmp();
  const f = join(d, 'cache.json');
  writeFileSync(f, '[1,2]');
  assert.equal(createCache(f).get('0'), undefined);
  writeFileSync(f, '{"ok":"좋음","bad":5}');
  const c = createCache(f);
  assert.equal(c.get('ok'), '좋음');
  assert.equal(c.get('bad'), undefined);
});

test('조상 객체 속성(constructor 등)을 단어로 조회해도 캐시 적중이 아니다', () => {
  const c = createCache(join(tmp(), 'cache.json'));
  assert.equal(c.get('constructor'), undefined);
  assert.equal(c.get('__proto__'), undefined);
  c.set('__proto__', 'x');
  assert.equal(c.get('__proto__'), 'x');
  assert.equal(({}).x, undefined);
});
