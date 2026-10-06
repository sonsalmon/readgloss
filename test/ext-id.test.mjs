import test from 'node:test';
import assert from 'node:assert/strict';
import { extensionIdFromKey } from '../bridge/ext-id.mjs';

// 키 -> ID 기대값은 함수가 아니라 셸로 따로 계산했다:
// base64 -d | shasum -a 256 | cut -c1-32 | tr 0-9a-f a-p
const KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvSy+Nk/Nn3mIuDXdngejJpfJ5e672FH0uKY3FLXt9Ry0lEk9aCCK5SLVlTPpIQlLZ3d5/MXq2DfXoky8Nqg8ElPpufkw/QZXPkxOvzKAZxrlpWtWBqm9CY+3Rsm1oyp99Wv+i2I5k8WznvQ4hXDOja84yBDqZ39y2hmX7VF8a/5HUZiS3A8vru8PDDJRqy5ev56DasIKkAsxjSKvmmvbkkJH3v77coptXaw5DQV0oJ62V8fbz01BfnVF3WxlXe/X1w85Mj3EnwPQZnZWKfHQKvFLGB6umzqlpzTv8ur/934itRUlydRdVrn6fKJP9+yCNkWwizsBTonGnMplxNdgSQIDAQAB';
const EXPECTED = 'bmkoabpndmngeoibdfeoidhedhepmchd';

test('공개키(base64)에서 크롬 확장 ID를 계산한다', () => {
  assert.equal(extensionIdFromKey(KEY), EXPECTED);
});

test('ID는 a-p 32글자다', () => {
  assert.match(extensionIdFromKey(KEY), /^[a-p]{32}$/);
});
