// 저장된 메모를 마크다운 → 편집기 → 마크다운으로 왕복해 내용이 깨지지 않는지 센다.
// 데이터는 읽기만 한다. 출력은 건수와 차이 종류만(메모 내용은 찍지 않는다).
// 사용: node scripts/check-md-roundtrip.mjs [--data <폴더(기본 저장소 data/)>]
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { Window } from 'happy-dom';
import { loadData } from './data-source.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bundleFile = join(root, 'extension', 'vendor', 'tiptap.bundle.js');
const richInputFile = join(root, 'extension', 'rich-input.js');

// 마크다운에서 뜻이 같은 차이(이스케이프·줄 끝 공백)를 걷어낸다.
function unescapeMd(md) {
  return md.replace(/\\([\\`*_{}\[\]()#+\-.!~>|])/g, '$1');
}

function cleanLines(md) {
  return String(md ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}

function withoutBlankLines(md) {
  return md
    .split('\n')
    .filter((line) => line.trim() !== '')
    .join('\n');
}

function hasTable(md) {
  return /^\s*\|.*\|\s*$/m.test(md);
}

// 편집기를 세운다(확장의 묶음·덮개를 고전 스크립트처럼 읽는다).
function loadEditor() {
  if (!existsSync(bundleFile)) {
    throw new Error('extension/vendor/tiptap.bundle.js 가 없어요 — npm run build:vendor 를 먼저 실행하세요');
  }

  const window = new Window({ url: 'https://example.test' });
  globalThis.window = window;
  globalThis.document = window.document;
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  for (const key of Object.getOwnPropertyNames(window)) {
    if (!(key in globalThis)) {
      try {
        globalThis[key] = window[key];
      } catch {
        // 읽기 전용 전역은 건너뛴다.
      }
    }
  }
  globalThis.getSelection = window.getSelection.bind(window);
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);

  vm.runInThisContext(readFileSync(bundleFile, 'utf8'), { filename: 'tiptap.bundle.js' });
  vm.runInThisContext(readFileSync(richInputFile, 'utf8'), { filename: 'rich-input.js' });

  const create = globalThis.readglossRichInput?.create;
  if (typeof create !== 'function') {
    throw new Error('extension/rich-input.js 에서 readglossRichInput.create 를 찾지 못했어요');
  }
  return create;
}

// 왕복 한 건을 같은 글 / 뜻이 같은 차이 / 내용 손실로 나눈다.
export function classifyRoundtrip(input, output) {
  const before = cleanLines(input);
  const after = cleanLines(output);
  if (before === after) return { loss: false, kinds: [] };

  const beforeNoEsc = unescapeMd(before);
  const afterNoEsc = unescapeMd(after);

  // 빈 줄·이스케이프만 다르면 마크다운 뜻은 그대로다.
  if (withoutBlankLines(beforeNoEsc) === withoutBlankLines(afterNoEsc)) {
    const kinds = [];
    if (beforeNoEsc !== afterNoEsc) kinds.push('빈 줄');
    if (before !== beforeNoEsc || after !== afterNoEsc) kinds.push('이스케이프');
    return { loss: false, kinds };
  }

  // v1 은 표를 다루지 않는다. 표가 사라지면 내용 손실로 센다.
  if (hasTable(before) && !hasTable(after)) {
    return { loss: true, kinds: ['표 사라짐'] };
  }

  return { loss: true, kinds: ['내용 다름'] };
}

export function checkMemos(memos, create) {
  const result = {
    total: 0,
    same: 0,
    kinds: new Map(),
    loss: 0,
  };

  for (const memo of memos) {
    const text = memo?.text;
    if (typeof text !== 'string' || text.trim() === '') continue;
    result.total += 1;

    const el = create({ value: text });
    if (!el) throw new Error('rich-input 덮개를 만들지 못했어요 — 묶음 파일을 확인하세요');
    document.body.appendChild(el);
    let output;
    try {
      output = el.value;
    } finally {
      el.rgEditor?.destroy?.();
      el.remove?.();
    }

    const { loss, kinds } = classifyRoundtrip(text, output);
    if (!loss && kinds.length === 0) {
      result.same += 1;
      continue;
    }
    for (const kind of kinds) {
      result.kinds.set(kind, (result.kinds.get(kind) ?? 0) + 1);
    }
    if (loss) result.loss += 1;
  }

  return result;
}

function parseArgs(argv) {
  let dataDir = join(root, 'data');
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--data' && argv[i + 1]) {
      dataDir = resolve(argv[++i]);
    }
  }
  return { dataDir };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { dataDir } = parseArgs(process.argv.slice(2));

  let memos;
  try {
    memos = loadData(dataDir).memos ?? [];
  } catch (error) {
    console.error(`데이터를 읽지 못했어요: ${error?.message ?? error}`);
    process.exit(1);
  }

  const create = loadEditor();
  const result = checkMemos(memos, create);

  console.log(`메모 왕복 검사: ${result.total}건 (같음 ${result.same}건)`);
  const kinds = [...result.kinds.entries()].map(([kind, count]) => `${kind} ${count}건`);
  console.log(`차이(뜻 그대로): ${kinds.length ? kinds.join(' · ') : '없음'}`);
  console.log(`내용 손실: ${result.loss}건`);

  if (result.loss > 0) process.exit(1);
}
