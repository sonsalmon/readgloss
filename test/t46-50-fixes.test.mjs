// T46~50 검증 지적 고침 시험 (B1·B2·S1·S2·N1~N6·N8)
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBridge } from '../bridge/server.mjs';
import { renderMemo } from '../scripts/export-notes.mjs';

await import('../extension/memo-core.js');
const { tableQuoteFrom } = globalThis.readglossMemo;

const rd = (p) => readFileSync(new URL(`../extension/${p}`, import.meta.url), 'utf8');
const selectionSrc = rd('selection.js');
const padSrc = rd('memo-pad.js');
const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const MINE = `chrome-extension://${EXT}`;

test('N1: 코드 블록은 첫 줄 들여쓰기를 보존하고 앞뒤 빈 줄만 지운다', () => {
  const out = renderMemo({ url: 'https://e.com/', quote: { exact: '\n\n    indented()\n  two\n\n', code: { block: true, lang: 'python' } } });
  assert.equal(out, '```python\n    indented()\n  two\n```');
});

test('N2: 글 속 ``` 가 있으면 펜스가 더 길고, 인라인은 백틱 수와 안쪽 공백을 맞춘다', () => {
  const block = renderMemo({ url: 'u', quote: { exact: 'a\n```\nb', code: { block: true, lang: '' } } });
  assert.equal(block, '````\na\n```\nb\n````');
  const inl = renderMemo({ url: 'u', quote: { exact: 'a``b', code: { block: false } } });
  assert.equal(inl, '```a``b```');
  const edge = renderMemo({ url: 'u', quote: { exact: '`x`', code: { block: false } } });
  assert.equal(edge, '`` `x` ``');
  assert.equal(renderMemo({ url: 'u', quote: { exact: 'ls -l', code: { block: false } } }), '`ls -l`');
});

test('N4: tableQuoteFrom 이 무엇을 잘랐는지 cut 으로 알려 준다', () => {
  const mk = (cols, rows, len) => Array.from({ length: rows }, () => ({ selected: true, cells: Array.from({ length: cols }, () => ({ text: 'x'.repeat(len) })) }));
  assert.deepEqual(tableQuoteFrom(mk(2, 31, 3)).cut, { rows: true, cols: false, chars: false });
  assert.deepEqual(tableQuoteFrom(mk(9, 2, 3)).cut, { rows: false, cols: true, chars: false });
  assert.deepEqual(tableQuoteFrom(mk(2, 2, 301)).cut, { rows: false, cols: false, chars: true });
  const ok = tableQuoteFrom(mk(2, 2, 3));
  assert.equal(ok.truncated, false);
  assert.deepEqual(ok.cut, { rows: false, cols: false, chars: false });
  assert.match(padSrc, /표가 커서 일부만 담았어요\(30줄·8칸·칸 300자까지\)/);
});

test('N3: /memos 는 8칸x30줄 칸 300자 표 메모도 200 (본문 24KB 넘음)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rg-t4650-'));
  const bridge = createBridge({
    ask: async () => '{}', askTranslate: async () => '{}', askContext: async () => '{}',
    cacheFile: join(dir, 'cache.json'), tokenFile: join(dir, 'token'),
    learningDir: join(dir, 'learning'), extensionId: EXT,
    dict: { lookup: async () => ({ found: false }), close: () => {} },
    mt: { translate: async () => '', close: () => {} },
  });
  const port = await bridge.listen(0);
  try {
    const token = readFileSync(join(dir, 'token'), 'utf8');
    const cell = 'x'.repeat(300); // 영문 기준(한글 칸은 글자당 3바이트라 96KB 를 넘을 수 있음)
    const body = JSON.stringify({
      op: 'save', text: '큰 표', url: 'https://example.com/big',
      quote: { exact: 'big table', prefix: '', suffix: '', table: { head: Array(8).fill(cell), rows: Array.from({ length: 30 }, () => Array(8).fill(cell)) } },
    });
    assert.ok(Buffer.byteLength(body) > 24 * 1024);
    const status = await new Promise((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/memos', headers: { Host: '127.0.0.1:47831', 'X-Bridge-Token': token, Origin: MINE } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      r.on('error', reject);
      r.end(body);
    });
    assert.equal(status, 200);
  } finally {
    await bridge.close();
  }
});

test('B1: scrapRange 는 이미 스크랩된 글이면 save 를 보내지 않는다', () => {
  const fn = selectionSrc.slice(selectionSrc.indexOf('async function scrapRange'), selectionSrc.indexOf('async function saveScrap'));
  assert.match(fn, /if \(existing\) return \{ ok: true, scrap: existing \}/);
  assert.ok(fn.indexOf('if (existing) return') < fn.indexOf('submitScrap('));
  assert.ok(fn.indexOf('if (existing) return') < fn.indexOf('fetchGuessedTask'));
});

test('N5: 번역을 close 전에 읽어 scrapRange 에 넘긴다', () => {
  const fn = padSrc.slice(padSrc.indexOf('function handleMemoOpen'), padSrc.indexOf('// 선택이 비었으면 지금처럼 토글'));
  assert.ok(fn.indexOf('currentTranslation') < fn.indexOf('readglossSelectionUi?.close?.()'));
  assert.match(fn, /scrapRange\?\.\(cloned, \{ translation \}\)/);
  assert.match(selectionSrc, /async function scrapRange\(range, \{ translation: givenTranslation = '', mark = null \} = \{\}\)/);
  assert.match(selectionSrc, /scrapRange: \(range, opts\) => scrapRange\(range, opts\)/);
});

test('B2: 메모장 개념 갱신 리스너는 detail.id 없는 이벤트와 편집 중 이벤트를 무시한다', () => {
  const i = padSrc.indexOf("addEventListener('readgloss:concepts-updated'");
  const fn = padSrc.slice(i, i + 700);
  assert.match(fn, /\(e\) =>/);
  assert.match(fn, /if \(!e\.detail\?\.id \|\| activeConceptEditId\) return/);
  // 메모장 안 자동 저장이 쏘는 이벤트는 detail 이 없어야 한다
  assert.equal((padSrc.match(/new CustomEvent\('readgloss:concepts-updated'\)/g) || []).length, 2);
});

test('S1: 닫힌 메모장에서 코드 블록 인용하면 다시 그린 뒤 언어 고르기로 포커스', () => {
  assert.match(padSrc, /let pendingCodeLangKey = null/);
  assert.match(padSrc, /if \(focusCodeLang\) pendingCodeLangKey = targetKey;/);
  const fn = padSrc.slice(padSrc.indexOf('function applyActiveSection'), padSrc.indexOf('// activeSectionKey 계산'));
  assert.match(fn, /pendingCodeLangKey\)/);
  assert.match(fn, /\.sec-quote-lang-select/);
  // 다시 그리기 중간에 비우지 않는다 — 불러오기 끝(rebuildSectionsUI 뒤)에서만 비운다(재검증 S1)
  assert.doesNotMatch(fn, /pendingCodeLangKey = null/);
  assert.match(padSrc, /rebuildSectionsUI\(\);\s*if \(targetSectionKey\) \{\s*applyActiveSection\(true\);\s*\}\s*\}\s*pendingCodeLangKey = null;/);
});

test('S2: 언어 고르기 칸 키 처리는 ⌘·Ctrl·Alt 가 눌리면 건너뛴다', () => {
  assert.match(padSrc, /classList\?\.contains\('sec-quote-lang-select'\) && !e\.metaKey && !e\.ctrlKey && !e\.altKey/);
});

test('N6·N8: document keydown 은 값싼 걸러내기 뒤에 계산하고 shadow 편집 영역도 입력칸으로 본다', () => {
  const i = padSrc.indexOf("document.addEventListener('keydown', (e) => {\n    // 값싼 걸러내기");
  assert.ok(i > 0);
  const fn = padSrc.slice(i, i + 1600);
  assert.ok(fn.indexOf("e.code !== 'KeyC') return") > 0);
  assert.ok(fn.indexOf("e.code !== 'KeyC') return") < fn.indexOf('window.getSelection'));
  assert.ok(fn.indexOf("e.code !== 'KeyC') return") < fn.indexOf('e.composedPath'));
  assert.match(fn, /n\?\.isContentEditable === true/);
  assert.match(fn, /\['input', 'textarea', 'select'\]/);
});
