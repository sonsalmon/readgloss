// scripts/data-source.mjs
// data/readgloss.db 또는 JSON 파일에서 저장 데이터를 읽어온다.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function readJson(file) {
  try {
    const raw = readFileSync(file, 'utf8');
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

export function loadData(dataDir) {
  const dbFile = join(dataDir, 'readgloss.db');
  if (existsSync(dbFile)) {
    let raw = null;
    try {
      raw = new DatabaseSync(dbFile, { readOnly: true });
      const metaRow = raw.prepare("SELECT value FROM meta WHERE key = 'migrated_at'").get();
      if (metaRow && metaRow.value) {
        // words
        const words = { saved: {}, known: {}, history: [], phrases: {} };
        const wordRows = raw.prepare("SELECT id, kind, key, data, ts FROM nodes WHERE kind = 'word'").all();
        const historyItems = [];
        for (const r of wordRows) {
          let d = null;
          try {
            d = JSON.parse(r.data);
          } catch {}
          if (d && typeof d === 'object') {
            if (d.saved) words.saved[r.key] = d.saved;
            if (d.known) words.known[r.key] = d.known;
            if (d.history) historyItems.push(d.history);
          }
        }
        historyItems.sort((a, b) => b.ts - a.ts);
        words.history = historyItems;

        const phraseRows = raw.prepare("SELECT id, kind, key, data, ts FROM nodes WHERE kind = 'phrase'").all();
        for (const r of phraseRows) {
          try {
            words.phrases[r.id] = JSON.parse(r.data);
          } catch {}
        }

        // mydict
        const mydict = { entries: {} };
        const mydictRows = raw.prepare("SELECT id, kind, key, data, ts FROM nodes WHERE kind = 'mydict'").all();
        for (const r of mydictRows) {
          try {
            mydict.entries[r.key] = JSON.parse(r.data);
          } catch {}
        }

        // scraps
        const scraps = { v: 1, scraps: {} };
        const scrapRows = raw.prepare("SELECT id, kind, key, data, ts FROM nodes WHERE kind = 'scrap'").all();
        for (const r of scrapRows) {
          try {
            scraps.scraps[r.id] = JSON.parse(r.data);
          } catch {}
        }

        // memos
        const memos = [];
        const memoRows = raw.prepare("SELECT id, kind, key, data, ts FROM nodes WHERE kind = 'memo'").all();
        for (const r of memoRows) {
          try {
            const d = JSON.parse(r.data);
            if (d && typeof d === 'object') {
              memos.push({
                id: r.id,
                ...d,
                ts: Number.isFinite(d.ts) ? d.ts : r.ts,
              });
            }
          } catch {}
        }

        raw.close();
        raw = null;
        return { words, mydict, scraps, memos };
      }
    } catch (e) {
      throw new Error(`readgloss.db 를 열거나 읽을 수 없어요: ${dbFile} (${e?.message ?? e})`);
    } finally {
      if (raw) {
        try {
          raw.close();
        } catch {}
      }
    }
  }

  // db가 없거나 migrated_at이 없으면 JSON에서 읽는다
  const wordsRaw = readJson(join(dataDir, 'words.json'));
  const mydictRaw = readJson(join(dataDir, 'mydict.json'));
  const scrapsRaw = readJson(join(dataDir, 'scraps.json'));

  const words = {
    saved: wordsRaw.saved && typeof wordsRaw.saved === 'object' ? wordsRaw.saved : {},
    known: wordsRaw.known && typeof wordsRaw.known === 'object' ? wordsRaw.known : {},
    history: Array.isArray(wordsRaw.history) ? wordsRaw.history : [],
    phrases: wordsRaw.phrases && typeof wordsRaw.phrases === 'object' ? wordsRaw.phrases : {},
  };
  const mydict = {
    entries: mydictRaw.entries && typeof mydictRaw.entries === 'object' ? mydictRaw.entries : {},
  };
  const scraps = {
    v: scrapsRaw.v ?? 1,
    scraps: scrapsRaw.scraps && typeof scrapsRaw.scraps === 'object' ? scrapsRaw.scraps : {},
  };
  const memos = [];

  return { words, mydict, scraps, memos };
}

// readgloss.db를 읽기 전용으로 연다. 파일이 없거나 migrated_at이 없으면 null, 열기·읽기 실패면 던진다.
export function openReadDb(dataDir) {
  const dbFile = join(dataDir, 'readgloss.db');
  if (!existsSync(dbFile)) return null;

  let raw = null;
  try {
    raw = new DatabaseSync(dbFile, { readOnly: true });
    const metaRow = raw.prepare("SELECT value FROM meta WHERE key = 'migrated_at'").get();
    if (!metaRow || !metaRow.value) {
      raw.close();
      return null;
    }
  } catch (e) {
    if (raw) {
      try {
        raw.close();
      } catch {}
    }
    throw new Error(`readgloss.db 를 열거나 읽을 수 없어요: ${dbFile} (${e?.message ?? e})`);
  }

  const stmtGet = raw.prepare('SELECT id, kind, key, data, ts FROM nodes WHERE id = ?');
  const stmtByKind = raw.prepare('SELECT id, kind, key, data, ts FROM nodes WHERE kind = ?');
  const stmtByKey = raw.prepare('SELECT id, kind, key, data, ts FROM nodes WHERE kind = ? AND key = ? LIMIT 1');
  const stmtOutAll = raw.prepare('SELECT src, dst, kind, ts FROM edges WHERE src = ?');
  const stmtOutKind = raw.prepare('SELECT src, dst, kind, ts FROM edges WHERE src = ? AND kind = ?');
  const stmtInAll = raw.prepare('SELECT src, dst, kind, ts FROM edges WHERE dst = ?');
  const stmtInKind = raw.prepare('SELECT src, dst, kind, ts FROM edges WHERE dst = ? AND kind = ?');

  const safeJsonParse = (str) => {
    if (typeof str !== 'string') return null;
    try {
      return JSON.parse(str);
    } catch {
      return str;
    }
  };
  const mapNode = (row) => (row ? { id: row.id, kind: row.kind, key: row.key, data: safeJsonParse(row.data), ts: row.ts } : null);
  const mapEdge = (row) => ({ src: row.src, dst: row.dst, kind: row.kind, ts: row.ts });

  return {
    file: dbFile,
    readOnly: true,
    raw,
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
}

// 학습노트 내보내기를 위해 단어·메모·스크랩 외에 개념(concept) 및 공부 시간(dwell) 목록까지 포함하여 읽는다.
export function loadNotesData(dataDir) {
  const base = loadData(dataDir);
  const concepts = [];
  const dwell = [];
  let db = null;
  try {
    db = openReadDb(dataDir);
    if (db) {
      const nodes = db.byKind('concept');
      for (const n of nodes) {
        if (!n) continue;
        const d = n.data && typeof n.data === 'object' ? n.data : {};
        const fromScrapEdges = db.out(n.id, 'from_scrap');
        const appears = [];
        for (const e of fromScrapEdges) {
          const scrapNode = db.get(e.dst);
          if (scrapNode && scrapNode.kind === 'scrap' && scrapNode.data) {
            appears.push(scrapNode.data);
          }
        }
        appears.sort((a, b) => (a.ts || 0) - (b.ts || 0));
        concepts.push({
          id: n.id,
          key: n.key,
          ts: n.ts,
          name: d.name || n.key || '',
          aliases: Array.isArray(d.aliases) ? [...d.aliases] : [],
          tags: Array.isArray(d.tags) ? [...d.tags] : [],
          definition: typeof d.definition === 'string' ? d.definition : '',
          later: (d.definition ?? '') === '',
          seen: d.seen && typeof d.seen === 'object' ? d.seen : null,
          firstTask: d.firstTask ?? null,
          firstUrl: d.firstUrl ?? null,
          firstTitle: d.firstTitle ?? null,
          appears,
        });
      }

      const dwellNodes = db.byKind('dwell');
      for (const n of dwellNodes) {
        if (!n) continue;
        const d = n.data && typeof n.data === 'object' ? n.data : {};
        dwell.push({
          date: typeof d.date === 'string' ? d.date : '',
          url: typeof d.url === 'string' ? d.url : (typeof n.key === 'string' ? n.key : ''),
          title: typeof d.title === 'string' ? d.title : '',
          headings: Array.isArray(d.headings) ? [...d.headings] : [],
          seconds: typeof d.seconds === 'number' && Number.isFinite(d.seconds) ? d.seconds : 0,
          task: d.task ?? null,
        });
      }
    }
  } catch {
    // db 읽기 오류 시 빈 concepts, dwell 로 fallback
  } finally {
    if (db) {
      try {
        db.close();
      } catch {}
    }
  }

  return {
    ...base,
    concepts,
    dwell,
  };
}
