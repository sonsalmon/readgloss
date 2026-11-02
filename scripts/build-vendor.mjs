// Tiptap 묶음 파일을 만든다: vendor-src/tiptap-entry.js → extension/vendor/tiptap.bundle.js
// 확장에는 빌드 단계를 두지 않고, 이 스크립트로 다시 만든 결과만 커밋한다.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'extension', 'vendor');
const outFile = join(outDir, 'tiptap.bundle.js');
const licenseFile = join(outDir, 'tiptap.LICENSE');

const BANNER = '/* Tiptap 3.32.2 (MIT) — npm run build:vendor 로 다시 만든다 */';

mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [join(root, 'vendor-src', 'tiptap-entry.js')],
  outfile: outFile,
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'chrome120',
  platform: 'browser',
  banner: { js: BANNER },
  legalComments: 'none',
});

// @tiptap/core 의 라이선스 사본. LICENSE.md 가 없으면 LICENSE 를 쓴다.
const coreDir = join(root, 'node_modules', '@tiptap', 'core');
const sourceLicense = ['LICENSE.md', 'LICENSE']
  .map((name) => join(coreDir, name))
  .find((file) => existsSync(file));
if (!sourceLicense) {
  throw new Error('@tiptap/core 라이선스 파일을 찾지 못했다');
}
copyFileSync(sourceLicense, licenseFile);

console.log(`묶음 완료: ${outFile}`);
console.log(`라이선스 복사: ${licenseFile}`);
