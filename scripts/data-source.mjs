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

        raw.close();
        return { words, mydict, scraps };
      }
    } catch {
      // 오류 시 아래 JSON 폴백으로 이동
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

  return { words, mydict, scraps };
}
