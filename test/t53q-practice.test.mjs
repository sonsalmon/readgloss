// 과제 T53q(변경 기록 28-23): 로컬 연습 페이지. SRT 파서·자막 형식 고르기·다리의 /practice 토큰 예외.
import test from 'node:test';
import assert from 'node:assert/strict';
import { start } from '../fixtures/bridge-harness.mjs';

await import('../extension/video-core.js');
const V = globalThis.readglossVideo;

test('parseSrt: 쉼표 밀리초, 한 자막의 여러 줄은 공백으로, 번호 줄은 있어도 없어도 된다', () => {
  const body = [
    '1',
    '00:00:01,000 --> 00:00:03,500',
    'Hello',
    'world',
    '',
    '00:00:04,250 --> 00:00:06,000',
    '<b>Next</b> &amp; last',
    '',
  ].join('\r\n');
  assert.deepEqual(V.parseSrt(body), [
    { start: 1, end: 3.5, text: 'Hello world' },
    { start: 4.25, end: 6, text: 'Next & last' },
  ]);
});

test('parseSrt: BOM·시(hour)·끝 시각이 없는 줄을 다듬는다', () => {
  const body = '\uFEFF01:02:03,004 --> 01:02:05,006\nA line\n\n7\n01:03:00,000 --> 01:02:06,000\nBackwards\n';
  assert.deepEqual(V.parseSrt(body), [
    { start: 3723.004, end: 3725.006, text: 'A line' },
    { start: 3780, end: 3782, text: 'Backwards' },
  ]);
  assert.deepEqual(V.parseSrt(''), []);
});

test('subFormatOf: 파일 이름이 먼저, 모르면 내용으로 SRT·VTT·IMSC 를 고른다', () => {
  assert.equal(V.subFormatOf('clip.srt', ''), 'srt');
  assert.equal(V.subFormatOf('clip.SRT', 'WEBVTT'), 'srt');
  assert.equal(V.subFormatOf('clip.vtt', ''), 'vtt');
  assert.equal(V.subFormatOf('netflix.xml', ''), 'imsc');
  assert.equal(V.subFormatOf('captions.imsc', ''), 'imsc');
  assert.equal(V.subFormatOf('captions.ttml', ''), 'imsc');
  assert.equal(V.subFormatOf('', 'WEBVTT\n\n00:01.000 --> 00:02.000\nHi'), 'vtt');
  assert.equal(V.subFormatOf('captions.txt', '1\n00:00:01,000 --> 00:00:02,000\nHi'), 'srt');
  assert.equal(V.subFormatOf('', '<tt xmlns="http://www.w3.org/ns/ttml"><body></body></tt>'), 'imsc');
  assert.equal(V.subFormatOf('', ''), 'srt');
});

test('다리 GET /practice: 토큰 없이 200 HTML, 다른 경로는 여전히 401, Host 검사는 그대로', async () => {
  const s = await start();
  try {
    const page = await s.get('/practice', { headers: {} });
    assert.equal(page.status, 200);
    assert.match(page.headers['content-type'], /text\/html/);
    assert.match(page.text, /readgloss 로컬 연습/);
    assert.match(page.text, /id="readgloss-practice-player"/);
    assert.match(page.text, /source: 'readgloss-practice'/);
    assert.doesNotMatch(page.text, /<(?:script|link)[^>]+(?:src|href)=["']https?:/i, '외부 파일·CDN 없음');

    assert.equal((await s.get('/ping', { headers: {} })).status, 401);
    assert.equal((await s.get('/ping', { headers: s.auth })).status, 200);
    assert.equal((await s.post('/practice', {}, { headers: {} })).status, 405);
    assert.equal((await s.get('/practice', { headers: { Host: 'evil.example' } })).status, 403);
    assert.equal((await s.get('/practice', { headers: { Origin: 'https://example.com' } })).status, 403);
  } finally {
    await s.close();
  }
});
