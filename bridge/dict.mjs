// 맥 사전 도우미(native/macdict)와 주고받고, 사전 평문을 카드용 구조로 바꾼다.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export class DictUnavailableError extends Error {}
export class DictError extends Error {}

const POS_WORDS = '대명사|명사|타동사|자동사|동사|형용사|부사|전치사|접속사|감탄사|조동사|관사|접두사|접미사|수사';
const NOTE = '(?:\\([^)]*\\)|（[^）]*）)';
// 품사 표지: 앞이 글머리·공백·마침표·')' 이고, 뒤에 "명사형" 같은 말 이음이 오지 않는 것. 품사 묶음("동사, 타동사")과 곧바로 붙은 괄호 주석(활용형)까지 한 덩어리로 잡는다.
// ponytail: 뒤 글자 제외 목록은 흔한 조사·접미만. 어긋나면 품사 배지가 하나 더 생길 뿐 글은 그대로 남는다.
const POS_RE = new RegExp(`(?<![^\\s.)])((?:${POS_WORDS})(?:,\\s*(?:${POS_WORDS}))*)(?![형의를은는이가로와과도에적화])(${NOTE})?`, 'g');
const NUM_RE = /(?<!\S)(?:(\d{1,2})\.|([①-⑳]))/g;
const HEAD_RE = /^(.{1,60}?) \| (.{0,80}?) \| ([\s\S]*)$/;
const ETYM_RE = /^\s*(【[^】]*】)\s*/;

function splitSenses(body) {
  const marks = [];
  let expect = 1;
  for (const m of body.matchAll(NUM_RE)) {
    const n = m[1] ? Number(m[1]) : m[2].codePointAt(0) - 0x2460 + 1;
    if (n === expect) {
      marks.push({ n, at: m.index, end: m.index + m[0].length });
      expect++;
    }
  }
  if (marks.length === 0) return [{ num: null, text: body.trim() }];
  const lead = body.slice(0, marks[0].at).trim();
  return marks.map((mk, i) => {
    const text = body.slice(mk.end, marks[i + 1]?.at ?? body.length).trim();
    return { num: mk.n, text: i === 0 && lead ? `${lead} ${text}` : text };
  });
}

// "sing a person's exploits남의 공적" 처럼 영어 바로 뒤에 한글이 붙은 예문에 공백 하나를 넣는다.
const spaceBeforeKo = (s) => s.replace(/([A-Za-z0-9.!?'")\]])(?=[가-힣])/, '$1 ');

function toSense(pos, posNote, { num, text }) {
  const [def, ...ex] = text.split('▸').map((s) => s.trim());
  return { pos, posNote, num, text: def, examples: ex.filter(Boolean).map(spaceBeforeKo) };
}

// { headword, homograph, text } (도우미 출력의 표제어 하나) -> 카드용 구조. 모르는 모양이면 평문 전체를 한 뜻으로 둔다.
export function parseEntry({ headword, homograph, text }) {
  let rest = String(text ?? '');
  let pron = '';
  let head = '';
  const hm = HEAD_RE.exec(rest);
  if (hm) {
    head = hm[1];
    pron = hm[2].trim();
    rest = hm[3];
  }
  let etym = '';
  const em = ETYM_RE.exec(rest);
  if (em) {
    etym = em[1];
    rest = rest.slice(em[0].length);
  }
  const marks = [...rest.matchAll(POS_RE)];
  if (!hm && marks.length) {
    head = rest.slice(0, marks[0].index).trim();
    rest = rest.slice(marks[0].index);
    marks.splice(0, marks.length, ...rest.matchAll(POS_RE));
  }
  if (!homograph) {
    const n = /\s(\d{1,2})$/.exec(head);
    homograph = n ? Number(n[1]) : 0;
  }
  const sections = marks.map((m, i) => ({
    pos: m[1],
    note: m[2] ?? '',
    body: rest.slice(m.index + m[0].length, marks[i + 1]?.index ?? rest.length),
  }));
  // 본문이 비어 바로 다음 품사가 이어지는 묶음("동사(활용)" + "자동사")은 합친다
  const merged = [];
  for (let i = 0; i < sections.length; i++) {
    let s = { ...sections[i] };
    while (!s.body.trim() && i + 1 < sections.length) {
      const nx = sections[++i];
      s = { pos: `${s.pos} · ${nx.pos}`, note: s.note || nx.note, body: nx.body };
    }
    merged.push(s);
  }
  const senses = merged.length
    ? merged.flatMap((s) => splitSenses(s.body).map((x) => toSense(s.pos, s.note, x)))
    : [toSense('', '', { num: null, text: rest.trim() })];
  return { headword, pron, homograph, etym, senses, raw: String(text ?? '') };
}

const DEFAULT_BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'native', 'macdict');
const TIMEOUT_MS = 3000;
// 맥을 켠 직후 도우미가 처음 뜰 때는 사전을 읽느라 3초를 넘길 수 있다(첫 시험 실행에서 실연동 6개가 한꺼번에 실패).
// 그래서 띄운 뒤 첫 답까지만 길게 기다린다. 시간 제한을 직접 준 호출(가짜 도우미 시험)은 그 값을 그대로 쓴다.
const COLD_TIMEOUT_MS = 15000;

// 상주 도우미를 처음 요청 때 띄우고, 한 줄씩 직렬로 주고받는다. 죽거나 3초(처음 뜬 뒤 첫 답은 15초) 안에 답이 없으면 정리하고 다음 요청 때 다시 띄운다.
export function createDict({ bin = DEFAULT_BIN, args = [], timeoutMs = TIMEOUT_MS, coldTimeoutMs = timeoutMs === TIMEOUT_MS ? COLD_TIMEOUT_MS : timeoutMs } = {}) {
  let child = null;
  let warm = false; // 지금 도우미가 한 번이라도 답했는가
  let pending = null; // { resolve, reject, timer }
  let buf = '';
  let chain = Promise.resolve();

  const fail = (err) => {
    if (!pending) return;
    const p = pending;
    pending = null;
    clearTimeout(p.timer);
    p.reject(err);
  };

  function ensure() {
    if (child) return child;
    if (!existsSync(bin)) throw new DictUnavailableError(bin);
    const c = spawn(bin, args, { stdio: ['pipe', 'pipe', 'ignore'] });
    buf = '';
    warm = false;
    c.stdout.setEncoding('utf8');
    c.stdout.on('data', (d) => {
      if (child !== c) return; // 버린 도우미의 늦은 출력
      buf += d;
      const i = buf.indexOf('\n');
      if (i < 0 || !pending) return;
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      const p = pending;
      pending = null;
      clearTimeout(p.timer);
      warm = true;
      try {
        p.resolve(JSON.parse(line));
      } catch {
        p.reject(new DictError('bad-json'));
      }
    });
    c.stdin.on('error', () => {}); // 죽은 자식에게 쓰다 나는 EPIPE 는 exit 쪽에서 처리한다
    // 이미 버린 도우미(타임아웃으로 죽인 것)의 늦은 exit 가 새 요청을 망치지 않게, 현재 도우미일 때만 처리한다
    c.on('error', () => {
      if (child !== c) return;
      child = null;
      fail(new DictUnavailableError(bin));
    });
    c.on('exit', () => {
      if (child !== c) return;
      child = null;
      fail(new DictError('helper-exited'));
    });
    child = c;
    return c;
  }

  function ask(word) {
    return new Promise((resolve, reject) => {
      let c;
      try {
        c = ensure();
      } catch (e) {
        return reject(e);
      }
      const timer = setTimeout(() => {
        fail(new DictError('timeout'));
        c.kill(); // 응답이 밀린 도우미는 버린다(다음 요청이 새로 띄운다)
        if (child === c) child = null;
      }, warm ? timeoutMs : coldTimeoutMs);
      pending = { resolve, reject, timer };
      c.stdin.write(`${word}\n`);
    });
  }

  return {
    // word -> { found:false } | { found:true, entries:[parseEntry 결과] }
    lookup(word) {
      const run = chain.then(() => ask(word));
      chain = run.catch(() => {});
      return run.then((r) => (r?.found && Array.isArray(r.entries) && r.entries.length ? { found: true, entries: r.entries.map(parseEntry) } : { found: false }));
    },
    close() {
      child?.kill();
      child = null;
    },
  };
}
