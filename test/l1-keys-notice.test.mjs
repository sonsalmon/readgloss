// 개선 루프(11-01): 키 안내를 설정 탭에서 다시 띄울 수 있다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('panel 소스: [키 안내 다시 보기] 가 keysNoticeSeen 을 끈다', () => {
  const code = readFileSync(new URL('../extension/panel.js', import.meta.url), 'utf8');
  assert.match(code, /text: '키 안내 다시 보기',\s*onclick: \(\) => ctx\.setSettings\(\{ video: \{ keysNoticeSeen: false \} \}\)/);
});

test('dict: 기본 시간 제한이면 처음 뜬 도우미의 첫 답은 15초까지 기다린다(맥 켠 직후 사전 읽기)', async () => {
  const { createDict } = await import('../bridge/dict.mjs');
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'rg-cold-'));
  const slow = join(dir, 'slow.mjs');
  // 첫 답만 3.5초 늦게, 그다음은 바로 답하는 가짜 도우미
  writeFileSync(slow, "let n=0;process.stdin.setEncoding('utf8');process.stdin.on('data',(d)=>{for(const w of d.split('\\n').filter(Boolean)){const out=JSON.stringify({found:false})+'\\n';if(n++===0)setTimeout(()=>process.stdout.write(out),3500);else process.stdout.write(out);}});");
  const d = createDict({ bin: process.execPath, args: [slow] });
  try {
    assert.deepEqual(await d.lookup('first'), { found: false }, '첫 답이 3초를 넘어도 기다린다');
    assert.deepEqual(await d.lookup('second'), { found: false });
  } finally {
    d.close();
  }
});
