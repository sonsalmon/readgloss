// bridge/db.mjs
// Node 내장 node:sqlite DatabaseSync를 쓴 점(nodes)·선(edges) 그래프 저장소와 JSON 이전.
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  key TEXT,
  data TEXT,
  ts INTEGER
);
CREATE TABLE IF NOT EXISTS edges (
  src TEXT NOT NULL,
  dst TEXT NOT NULL,
  kind TEXT NOT NULL,
  ts INTEGER,
  PRIMARY KEY (src, dst, kind)
);
CREATE INDEX IF NOT EXISTS idx_nodes_kind ON nodes(kind);
CREATE INDEX IF NOT EXISTS idx_nodes_kind_key ON nodes(kind, key);
CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(dst, kind);
`;

const safeJsonParse = (str) => {
  if (typeof str !== 'string') return null;
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
};

const serializeData = (data) => {
  if (data === undefined || data === null) return null;
  if (typeof data === 'object') return JSON.stringify(data);
  return String(data);
};

export function openDb(file) {
  const existed = file !== ':memory:' && existsSync(file);
  if (file !== ':memory:') {
    mkdirSync(dirname(file), { recursive: true });
  }
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL;');
  raw.exec('PRAGMA foreign_keys = ON;');
  raw.exec(SCHEMA);

  const stmtPut = raw.prepare(`
    INSERT INTO nodes (id, kind, key, data, ts)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      kind = excluded.kind,
      key = excluded.key,
      data = excluded.data,
      ts = excluded.ts
  `);

  const stmtGet = raw.prepare('SELECT id, kind, key, data, ts FROM nodes WHERE id = ?');
  const stmtByKind = raw.prepare('SELECT id, kind, key, data, ts FROM nodes WHERE kind = ?');
  const stmtByKey = raw.prepare('SELECT id, kind, key, data, ts FROM nodes WHERE kind = ? AND key = ? LIMIT 1');

  const stmtDelEdges = raw.prepare('DELETE FROM edges WHERE src = ? OR dst = ?');
  const stmtDelNode = raw.prepare('DELETE FROM nodes WHERE id = ?');

  const stmtLink = raw.prepare(`
    INSERT INTO edges (src, dst, kind, ts)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(src, dst, kind) DO UPDATE SET
      ts = excluded.ts
  `);

  const stmtUnlink = raw.prepare('DELETE FROM edges WHERE src = ? AND dst = ? AND kind = ?');

  const stmtOutAll = raw.prepare('SELECT src, dst, kind, ts FROM edges WHERE src = ?');
  const stmtOutKind = raw.prepare('SELECT src, dst, kind, ts FROM edges WHERE src = ? AND kind = ?');

  const stmtInAll = raw.prepare('SELECT src, dst, kind, ts FROM edges WHERE dst = ?');
  const stmtInKind = raw.prepare('SELECT src, dst, kind, ts FROM edges WHERE dst = ? AND kind = ?');

  const mapNode = (row) => (row ? { id: row.id, kind: row.kind, key: row.key, data: safeJsonParse(row.data), ts: row.ts } : null);
  const mapEdge = (row) => ({ src: row.src, dst: row.dst, kind: row.kind, ts: row.ts });

  const db = {
    file,
    existed,
    raw,
    put({ id, kind, key = null, data = null, ts = Date.now() }) {
      if (typeof id !== 'string' || !id) throw new Error('node id must be a non-empty string');
      if (typeof kind !== 'string' || !kind) throw new Error('node kind must be a non-empty string');
      stmtPut.run(id, kind, key ?? null, serializeData(data), Number.isFinite(ts) ? ts : Date.now());
    },
    get(id) {
      if (typeof id !== 'string' || !id) return null;
      return mapNode(stmtGet.get(id));
    },
    byKind(kind) {
      if (typeof kind !== 'string' || !kind) return [];
      return stmtByKind.all(kind).map(mapNode);
    },
    byKey(kind, key) {
      if (typeof kind !== 'string' || typeof key !== 'string') return null;
      return mapNode(stmtByKey.get(kind, key));
    },
    del(id) {
      if (typeof id !== 'string' || !id) return;
      stmtDelEdges.run(id, id);
      stmtDelNode.run(id);
    },
    link(src, dst, kind, ts = Date.now()) {
      if (typeof src !== 'string' || typeof dst !== 'string' || typeof kind !== 'string') {
        throw new Error('src, dst, and kind must be strings');
      }
      stmtLink.run(src, dst, kind, Number.isFinite(ts) ? ts : Date.now());
    },
    unlink(src, dst, kind) {
      if (typeof src !== 'string' || typeof dst !== 'string' || typeof kind !== 'string') return;
      stmtUnlink.run(src, dst, kind);
    },
    out(src, kind) {
      if (typeof src !== 'string') return [];
      const rows = kind !== undefined && kind !== null ? stmtOutKind.all(src, kind) : stmtOutAll.all(src);
      return rows.map(mapEdge);
    },
    in(dst, kind) {
      if (typeof dst !== 'string') return [];
      const rows = kind !== undefined && kind !== null ? stmtInKind.all(dst, kind) : stmtInAll.all(dst);
      return rows.map(mapEdge);
    },
    close() {
      raw.close();
    },
  };

  return db;
}

// --- 옛 JSON 파싱 보조 함수들 ---

const WORD_RE = /^[A-Za-z][A-Za-z'’-]{0,63}$/;
const PHRASE_ID = /^[0-9a-f]{12}$/;
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const isLemma = (k) => typeof k === 'string' && WORD_RE.test(k) && k === k.toLowerCase();
const tsVal = (v) => (Number.isFinite(v?.ts) ? v.ts : 0);
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);
const memoOf = (v) => (typeof v?.memo === 'string' && v.memo.length <= 1000 ? v.memo : '');
const withMemo = (m) => (m ? { memo: m } : {});
const info = (v) => ({
  word: str(v?.word, 64) ?? '',
  gloss: str(v?.gloss, 200) ?? '',
  sentence: str(v?.sentence, 1000) ?? '',
  url: str(v?.url, 2000) ?? '',
});

function loadWordsData(file) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return { saved: new Map(), known: new Map(), history: [], phrases: new Map() };
  }
  let v;
  try {
    v = JSON.parse(raw);
  } catch {
    return { saved: new Map(), known: new Map(), history: [], phrases: new Map() };
  }
  if (!isObj(v)) {
    return { saved: new Map(), known: new Map(), history: [], phrases: new Map() };
  }

  const known = new Map(
    Object.entries(isObj(v.known) ? v.known : {})
      .filter(([k, val]) => isLemma(k) && isObj(val))
      .map(([k, val]) => [k, { ts: tsVal(val) }]),
  );

  const saved = new Map(
    Object.entries(isObj(v.saved) ? v.saved : {})
      .filter(([k, val]) => isLemma(k) && isObj(val))
      .map(([k, val]) => [k, { ...info(val), ...withMemo(memoOf(val)), ts: tsVal(val) }]),
  );

  const history = (Array.isArray(v.history) ? v.history : [])
    .filter((h) => isObj(h) && isLemma(h.lemma))
    .map((h) => ({ lemma: h.lemma, ...info(h), ts: tsVal(h) }))
    .filter((h, i, a) => a.findIndex((x) => x.lemma === h.lemma) === i)
    .slice(0, 200);

  const KINDS = ['expression', 'sentence'];
  const phrases = new Map(
    Object.entries(isObj(v.phrases) ? v.phrases : {})
      .filter(([k, val]) => PHRASE_ID.test(k) && isObj(val) && typeof val.text === 'string' && val.text)
      .map(([k, val]) => [
        k,
        {
          id: k,
          text: str(val.text, 1000),
          translation: str(val.translation, 2000) ?? '',
          kind: KINDS.includes(val.kind) ? val.kind : 'sentence',
          ...(typeof val.sentence === 'string' && val.sentence && { sentence: val.sentence.slice(0, 1000) }),
          ...(isObj(val.context) && { context: val.context }),
          ...(val.url && { url: str(val.url, 2000) }),
          ...(val.title && { title: str(val.title, 200) }),
          ...withMemo(memoOf(val)),
          ts: tsVal(val),
        },
      ]),
  );

  return { saved, known, history, phrases };
}

const KEY_RE = /^[a-z0-9 '’.-]+$/;
const cleanKey = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');
function normalizeMydictKey(s) {
  if (typeof s !== 'string') return null;
  const k = cleanKey(s).toLowerCase();
  return k && k.length <= 80 && KEY_RE.test(k) ? k : null;
}

function loadMydictData(file) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return new Map();
  }
  let v;
  try {
    v = JSON.parse(raw);
  } catch {
    return new Map();
  }
  const entries = isObj(v?.entries) ? v.entries : {};
  const map = new Map();
  for (const [k, val] of Object.entries(entries)) {
    if (normalizeMydictKey(k) === k && isObj(val) && typeof val.ko === 'string' && val.ko) {
      map.set(k, {
        ko: str(val.ko, 80) ?? '',
        exp: str(val.exp, 120) ?? '',
        note: str(val.note, 200) ?? '',
        url: str(val.url, 2000) ?? '',
        title: str(val.title, 200) ?? '',
        ts: Number.isFinite(val.ts) ? val.ts : 0,
      });
    }
  }
  return map;
}

const SCRAP_ID_RE = /^[0-9a-f]{12}$/;
const TASK_RE = /^(?:S\d-\d{2}[a-z]?|BUF-\d{2})$/;

function isValidStoredScrap(s) {
  return (
    s &&
    typeof s === 'object' &&
    typeof s.id === 'string' &&
    SCRAP_ID_RE.test(s.id) &&
    (s.task === null || (typeof s.task === 'string' && TASK_RE.test(s.task))) &&
    typeof s.url === 'string' &&
    typeof s.title === 'string' &&
    Array.isArray(s.headings) &&
    s.quote &&
    typeof s.quote.exact === 'string' &&
    Number.isFinite(s.pos) &&
    typeof s.translation === 'string' &&
    typeof s.memo === 'string' &&
    Number.isFinite(s.ts)
  );
}

function loadScrapsData(file) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return new Map();
  }
  let v;
  try {
    v = JSON.parse(raw);
  } catch {
    return new Map();
  }
  const map = new Map();
  if (v && typeof v === 'object' && v.v === 1 && isObj(v.scraps)) {
    for (const [k, s] of Object.entries(v.scraps)) {
      if (s && s.id === k && isValidStoredScrap(s)) {
        map.set(k, {
          id: s.id,
          task: s.task,
          url: s.url,
          title: s.title,
          headings: [...s.headings],
          quote: { exact: s.quote.exact, prefix: s.quote.prefix ?? '', suffix: s.quote.suffix ?? '' },
          pos: s.pos,
          translation: s.translation,
          memo: s.memo,
          ts: s.ts,
        });
      }
    }
  }
  return map;
}

// --- migrateJson 구현 ---

export function migrateJson({ db, dataDir, log = console.log, now = Date.now, hook }) {
  // 건너뛰기 판단은 meta 행이 있는지로만 한다.
  const migratedRow = db.raw.prepare("SELECT value FROM meta WHERE key = 'migrated_at'").get();
  if (migratedRow) {
    return { ok: true, skipped: true };
  }

  const wordsFile = join(dataDir, 'words.json');
  const mydictFile = join(dataDir, 'mydict.json');
  const scrapsFile = join(dataDir, 'scraps.json');

  const hasWords = existsSync(wordsFile);
  const hasMydict = existsSync(mydictFile);
  const hasScraps = existsSync(scrapsFile);

  const { saved, known, history, phrases } = hasWords ? loadWordsData(wordsFile) : { saved: new Map(), known: new Map(), history: [], phrases: new Map() };
  const mydict = hasMydict ? loadMydictData(mydictFile) : new Map();
  const scraps = hasScraps ? loadScrapsData(scrapsFile) : new Map();

  const before = {
    saved: saved.size,
    known: known.size,
    history: history.length,
    phrases: phrases.size,
    mydict: mydict.size,
    scraps: scraps.size,
  };

  db.raw.exec('BEGIN TRANSACTION');
  let afterCounts = null;
  const tsSuffix = now();
  try {
    // 이전 잔여 점·선이 있으면 같은 트랜잭션 안에서 먼저 지운다.
    db.raw.exec('DELETE FROM edges;');
    db.raw.exec('DELETE FROM nodes;');

    // 1. word 점들 (단어장·아는 단어·최근 찾은 단어)
    const allLemmas = new Set([...saved.keys(), ...known.keys(), ...history.map((h) => h.lemma)]);
    for (const lemma of allLemmas) {
      const s = saved.get(lemma) || null;
      const k = known.get(lemma) || null;
      const h = history.find((x) => x.lemma === lemma) || null;
      const tsMax = Math.max(s?.ts || 0, k?.ts || 0, h?.ts || 0);
      db.put({
        id: `word:${lemma}`,
        kind: 'word',
        key: lemma,
        data: {
          ...(s && { saved: s }),
          ...(k && { known: k }),
          ...(h && { history: h }),
        },
        ts: tsMax,
      });
    }

    // 2. phrase 점들 (구·문장)
    for (const [id, p] of phrases) {
      db.put({
        id,
        kind: 'phrase',
        key: p.text,
        data: p,
        ts: p.ts,
      });
    }

    // 3. mydict 점들 (내 사전)
    for (const [key, m] of mydict) {
      db.put({
        id: `mydict:${key}`,
        kind: 'mydict',
        key,
        data: m,
        ts: m.ts,
      });
    }

    // 4. scrap 점들, task 점 및 in_task 선
    for (const [id, s] of scraps) {
      db.put({
        id,
        kind: 'scrap',
        key: s.url,
        data: s,
        ts: s.ts,
      });
      if (s.task) {
        const taskId = `task:${s.task}`;
        if (!db.get(taskId)) {
          db.put({
            id: taskId,
            kind: 'task',
            key: s.task,
            data: { id: s.task },
            ts: s.ts,
          });
        }
        db.link(id, taskId, 'in_task', s.ts);
      }
    }

    // 시험/디버그용 hook
    if (typeof hook === 'function') {
      hook({ db, words: { saved, known, history, phrases }, mydict, scraps });
    }

    // 개수 검증
    const wordNodes = db.byKind('word');
    let afterSaved = 0;
    let afterKnown = 0;
    let afterHistory = 0;
    for (const w of wordNodes) {
      if (w.data?.saved) afterSaved++;
      if (w.data?.known) afterKnown++;
      if (w.data?.history) afterHistory++;
    }
    const afterPhrases = db.byKind('phrase').length;
    const afterMydict = db.byKind('mydict').length;
    const afterScraps = db.byKind('scrap').length;

    const after = {
      saved: afterSaved,
      known: afterKnown,
      history: afterHistory,
      phrases: afterPhrases,
      mydict: afterMydict,
      scraps: afterScraps,
    };

    for (const k of ['saved', 'known', 'history', 'phrases', 'mydict', 'scraps']) {
      if (before[k] !== after[k]) {
        throw new Error(`이전 개수 불일치(${k}): 전 ${before[k]} != 후 ${after[k]}`);
      }
    }

    // COMMIT 바로 전에 ('migrated_at', <ts>)를 넣는다.
    db.raw.prepare("INSERT INTO meta (key, value) VALUES ('migrated_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(tsSuffix));
    db.raw.exec('COMMIT');
    afterCounts = after;
  } catch (err) {
    try {
      db.raw.exec('ROLLBACK');
    } catch {}
    try {
      db.close();
    } catch {}
    if (db.file && db.file !== ':memory:' && existsSync(db.file)) {
      try {
        unlinkSync(db.file);
        if (existsSync(`${db.file}-wal`)) unlinkSync(`${db.file}-wal`);
        if (existsSync(`${db.file}-shm`)) unlinkSync(`${db.file}-shm`);
      } catch {}
    }
    log(`이전 실패: ${err.message}`);
    return { ok: false, error: err.message };
  }

  // COMMIT과 migrated_at이 들어간 뒤에는 db를 절대 지우지 않는다.
  // 이름 바꾸기는 별도 try로 감싼다.
  const renames = [];
  const filesToRename = [
    { exists: hasWords, original: wordsFile, target: `${wordsFile}.migrated-${tsSuffix}` },
    { exists: hasMydict, original: mydictFile, target: `${mydictFile}.migrated-${tsSuffix}` },
    { exists: hasScraps, original: scrapsFile, target: `${scrapsFile}.migrated-${tsSuffix}` },
  ];

  let renameSuccess = true;
  try {
    for (const item of filesToRename) {
      if (item.exists) {
        renameSync(item.original, item.target);
        renames.push(item);
      }
    }
  } catch (renameErr) {
    renameSuccess = false;
    // 하나라도 실패하면 이미 바꾼 이름을 원래대로 되돌린다 (되돌리기 실패는 오류 로그만).
    for (const item of renames.reverse()) {
      try {
        renameSync(item.target, item.original);
      } catch (revertErr) {
        console.error(`이름 되돌리기 실패: ${item.target} -> ${item.original}: ${revertErr.message}`);
      }
    }
    console.error(`이전 후 JSON 파일 이름 바꾸기 실패: ${renameErr.message}`);
  }

  log(`이전 완료: 단어장 ${afterCounts.saved}개, 아는 단어 ${afterCounts.known}개, 최근 ${afterCounts.history}개, 구 ${afterCounts.phrases}개, 내 사전 ${afterCounts.mydict}개, 스크랩 ${afterCounts.scraps}개`);

  if (!renameSuccess) {
    return { ok: true, counts: afterCounts, renamed: false };
  }
  return { ok: true, counts: afterCounts };
}
