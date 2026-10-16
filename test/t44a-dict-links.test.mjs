import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// selection-core.js는 text.js에 의존(cleanSelection 등). classic script이므로 import 후 전역에서 읽는다.
await import('../extension/text.js');
await import('../extension/selection-core.js');

const { dictLinks } = globalThis.readglossSelection;

test('dictLinks: 낱말 하나에 대해 4개 사전 링크(YouGlish·네이버·Oxford·Cambridge)를 반환한다', () => {
  const links = dictLinks('exploit');
  assert.equal(links.length, 4);

  const [yg, nv, ox, cb] = links;
  assert.deepEqual(yg, {
    id: 'youglish',
    label: 'YouGlish',
    url: 'https://youglish.com/pronounce/exploit/english',
  });
  assert.deepEqual(nv, {
    id: 'naver',
    label: '네이버',
    url: 'https://en.dict.naver.com/#/search?query=exploit',
  });
  assert.deepEqual(ox, {
    id: 'oxford',
    label: 'Oxford',
    url: 'https://www.oxfordlearnersdictionaries.com/search/english/?q=exploit',
  });
  assert.deepEqual(cb, {
    id: 'cambridge',
    label: 'Cambridge',
    url: 'https://dictionary.cambridge.org/search/english/direct/?q=exploit',
  });
});

test('dictLinks: 구(phrase)와 공백 정리(앞뒤·연속 공백 정규화)', () => {
  const links = dictLinks('  state   of the\nart  ');
  assert.equal(links.length, 4);
  const q = encodeURIComponent('state of the art');
  assert.equal(links[0].url, `https://youglish.com/pronounce/${q}/english`);
  assert.equal(links[1].url, `https://en.dict.naver.com/#/search?query=${q}`);
  assert.equal(links[2].url, `https://www.oxfordlearnersdictionaries.com/search/english/?q=${q}`);
  assert.equal(links[3].url, `https://dictionary.cambridge.org/search/english/direct/?q=${q}`);
});

test('dictLinks: 특수문자는 encodeURIComponent 로 안전하게 인코딩된다', () => {
  const text = `rock & roll? "yes"`;
  const links = dictLinks(text);
  assert.equal(links.length, 4);
  const q = encodeURIComponent(text);
  assert.ok(links.every((l) => l.url.includes(q)));
  assert.ok(links[0].url.includes('%26'));
  assert.ok(links[1].url.includes('%3F'));
  assert.ok(links[2].url.includes('%22'));
});

test('dictLinks: 80자 경계 검사 — 80자 이하는 반환, 80자 초과는 빈 배열', () => {
  const exact80 = 'a'.repeat(80);
  assert.equal(dictLinks(exact80).length, 4);

  const over80 = 'a'.repeat(81);
  assert.deepEqual(dictLinks(over80), []);

  // 공백 정리 후 80자이면 반환
  const spaced80 = `  ${'b'.repeat(80)}  `;
  assert.equal(dictLinks(spaced80).length, 4);

  // 공백 정리 후에도 81자이면 빈 배열
  const spaced81 = `  ${'b'.repeat(81)}  `;
  assert.deepEqual(dictLinks(spaced81), []);
});

test('dictLinks: 빈 글 또는 비문자열 입력 시 빈 배열', () => {
  assert.deepEqual(dictLinks(''), []);
  assert.deepEqual(dictLinks('   '), []);
  assert.deepEqual(dictLinks('\n\t\r'), []);
  assert.deepEqual(dictLinks(null), []);
  assert.deepEqual(dictLinks(undefined), []);
  assert.deepEqual(dictLinks(123), []);
  assert.deepEqual(dictLinks({}), []);
});

test('소스 검사: content.js 와 selection.js 가 dictLinks 를 사용하고 새 탭 및 보안 속성을 준수한다', () => {
  const contentSrc = readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8');
  const selectionSrc = readFileSync(new URL('../extension/selection.js', import.meta.url), 'utf8');

  // content.js 검사
  assert.match(contentSrc, /dictLinks(\?\.)?\(/, 'content.js가 dictLinks를 호출해야 함');
  assert.match(contentSrc, /target\s*=\s*['"]_blank['"]/, 'content.js 링크에 target="_blank"가 설정되어야 함');
  assert.match(contentSrc, /rel\s*=\s*['"]noopener noreferrer['"]/, 'content.js 링크에 rel="noopener noreferrer"가 설정되어야 함');
  assert.doesNotMatch(contentSrc, /\.innerHTML\s*=/, 'content.js에 innerHTML 할당이 없어야 함');

  // selection.js 검사
  assert.match(selectionSrc, /dictLinks(\?\.)?\(/, 'selection.js가 dictLinks를 호출해야 함');
  assert.match(selectionSrc, /target\s*=\s*['"]_blank['"]/, 'selection.js 링크에 target="_blank"가 설정되어야 함');
  assert.match(selectionSrc, /rel\s*=\s*['"]noopener noreferrer['"]/, 'selection.js 링크에 rel="noopener noreferrer"가 설정되어야 함');
  assert.doesNotMatch(selectionSrc, /\.innerHTML\s*=/, 'selection.js에 innerHTML 할당이 없어야 함');
});
