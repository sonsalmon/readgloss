// bridge/tutor-quote.mjs
// Aside 튜터 대화 기록(messages.jsonl)에서 튜터 답변을 찾아 날짜·시간·제목을 돌려준다.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const TUTOR_SKILL = 'skills/user/tutor-here/SKILL.md';
const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

// 튜터 호출 메시지 앞의 마크다운 링크 제거 ([$Tutor Here](...) 제거)
function stripTutorLink(text) {
  return text.replace(/^\s*\[[^\]]*\]\([^)]*\)\s*/, '');
}

// 비교 전에 양쪽 글을 같은 모양으로: 마크다운 표시(**, __, *, _, `, [글](주소) -> 글, 줄머리 #·>·-·1.) 제거 및 공백을 하나로
export function stripMarkdownForQuote(text) {
  if (typeof text !== 'string') return '';
  // 1. [글](주소) -> 글
  let s = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  // 2. 줄머리 #, >, - , 1. (숫자.)
  s = s.replace(/^[ \t]*(?:#{1,6}\s*|>+\s*|-\s+|\d+\.\s+)/gm, '');
  // 3. **, __, *, _, ` 제거
  s = s.replace(/(\*\*|__|\*|_|`)/g, '');
  // 4. 공백을 하나로
  return s.replace(/\s+/g, ' ').trim();
}

// 서울 시간대 (UTC+9) YYYY-MM-DD 및 HH:MM 포맷팅
function formatSeoulDateTime(timestamp) {
  const seoulMs = timestamp + 9 * 60 * 60 * 1000;
  const d = new Date(seoulMs);
  const iso = d.toISOString();
  return {
    date: iso.slice(0, 10),
    time: iso.slice(11, 16),
  };
}

// 질문 본문에서 80자 이내의 제목 생성
function computeQuestionTitle(turn) {
  const rawContent = turn.raw_content || '';
  const cleanContent = stripTutorLink(rawContent).trim();
  const selComment = (turn.selection?.comment || '').trim();

  let fullQ = '';
  if (cleanContent) {
    fullQ = cleanContent;
  } else if (selComment) {
    fullQ = selComment;
  } else {
    fullQ = '(고른 글만 보냄)';
  }

  const lines = fullQ.split(/\r?\n/);
  const firstLine = lines.length > 0 ? lines[0].trim() : '(고른 글만 보냄)';
  if (firstLine.length > 80) {
    return firstLine.slice(0, 80) + '…';
  }
  return firstLine;
}

// messages.jsonl 파일 파싱 및 튜터 세션 턴 추출
function parseSessionFile(filePath) {
  let content = '';
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }

  const lines = content.split(/\r?\n/);
  const turns = [];
  let pendingMetadata = null;
  let lastTab = null;

  for (const rawLine of lines) {
    try {
      const line = rawLine.trim();
      if (!line) continue;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) continue;

      const role = obj.role;
      const ts = obj.timestamp;

      if (role === 'user-message-metadata') {
        pendingMetadata = obj;
        const attachments = Array.isArray(obj.attachments) ? obj.attachments : [];
        for (const att of attachments) {
          if (att && typeof att === 'object' && att.type === 'tab') {
            lastTab = {
              name: String(att.name ?? '').trim(),
              url: String(att.url ?? '').trim(),
            };
            break;
          }
        }
      } else if (role === 'user') {
        // 기록의 시각이 숫자가 아니면(문자열 등) 그 줄만 건너뛴다
        if (typeof ts !== 'number' || !Number.isFinite(ts)) continue;

        let sel = null;
        if (pendingMetadata) {
          const attachments = Array.isArray(pendingMetadata.attachments) ? pendingMetadata.attachments : [];
          for (const att of attachments) {
            if (att && typeof att === 'object' && att.type === 'selection') {
              sel = {
                text: String(att.text ?? ''),
                comment: String(att.comment ?? '').trim(),
                sourceKind: String(att.sourceKind ?? '').trim(),
              };
              break;
            }
          }
        }

        let rawContent = '';
        if (Array.isArray(obj.content)) {
          rawContent = obj.content
            .filter((c) => c && typeof c === 'object' && c.type === 'text')
            .map((c) => String(c.text ?? ''))
            .join('\n');
        } else if (typeof obj.content === 'string') {
          rawContent = obj.content;
        }

        turns.push({
          timestamp: ts,
          raw_content: rawContent,
          selection: sel,
          tab: lastTab,
          assistant_replies: [],
        });
        pendingMetadata = null;
      } else if (role === 'assistant') {
        if (turns.length > 0) {
          const contentObj = obj.content;
          if (Array.isArray(contentObj)) {
            for (const item of contentObj) {
              if (
                item &&
                typeof item === 'object' &&
                item.type === 'toolCall' &&
                item.name === 'read_file' &&
                String(item.arguments?.path ?? '').includes(TUTOR_SKILL)
              ) {
                turns[turns.length - 1].tutor = true;
              }
            }
            const texts = contentObj
              .filter((item) => item && typeof item === 'object' && item.type === 'text' && item.text)
              .map((item) => String(item.text));
            if (texts.length > 0) {
              turns[turns.length - 1].assistant_replies.push(texts.join('\n\n'));
            }
          } else if (typeof contentObj === 'string' && contentObj.trim()) {
            turns[turns.length - 1].assistant_replies.push(contentObj.trim());
          }
        }
      }
    } catch {
      // 한 줄 파싱 오류가 다음 줄 파싱을 멈추지 않음
      continue;
    }
  }

  let firstTutorIdx = -1;
  for (let i = 0; i < turns.length; i++) {
    if (turns[i].raw_content.includes(TUTOR_SKILL) || turns[i].tutor) {
      firstTutorIdx = i;
      break;
    }
  }

  if (firstTutorIdx === -1) {
    return [];
  }
  return turns.slice(firstTutorIdx);
}

// 튜터 인용 검색기 생성
export function createTutorQuote({
  sessionsDir = join(homedir(), '.aside', 'u', '0', 'sessions'),
  now = Date.now,
} = {}) {
  const getNow = typeof now === 'function' ? now : () => (typeof now === 'number' ? now : Date.now());

  function find(rawText) {
    if (typeof rawText !== 'string') return { found: false };
    const text = rawText.trim().replace(/\s+/g, ' ');
    if (text.length < 15 || text.length > 2000) return { found: false };
    const normTarget = stripMarkdownForQuote(rawText);
    if (!normTarget) return { found: false };

    try {
      if (!existsSync(sessionsDir)) return { found: false };
      const nowMs = getNow();

      let entries = [];
      try {
        entries = readdirSync(sessionsDir, { withFileTypes: true });
      } catch {
        return { found: false };
      }

      // 최근 2일(48시간) 안에 바뀐(mtime) 각 세션 폴더 안 messages.jsonl 파일 수집
      const candidateFiles = [];
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const jsonlPath = join(sessionsDir, e.name, 'messages.jsonl');
        try {
          const st = statSync(jsonlPath);
          if (nowMs - st.mtimeMs <= TWO_DAYS_MS) {
            candidateFiles.push({ path: jsonlPath, mtimeMs: st.mtimeMs });
          }
        } catch {
          // 파일 없거나 접근 오류 무시
        }
      }

      // 최신 수정 파일부터 탐색
      candidateFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);

      for (const file of candidateFiles) {
        try {
          const tutorTurns = parseSessionFile(file.path);
          for (const turn of tutorTurns) {
            for (const reply of turn.assistant_replies) {
              const normReply = stripMarkdownForQuote(reply);
              if (normReply.includes(normTarget)) {
                const { date, time } = formatSeoulDateTime(turn.timestamp);
                const title = computeQuestionTitle(turn);
                return {
                  found: true,
                  date,
                  time,
                  title,
                };
              }
            }
          }
        } catch {
          // 한 파일 오류가 나머지 세션 검색을 멈추지 않음
          continue;
        }
      }
    } catch {
      // 오류가 발생해도 서버 장애로 이어지지 않고 found: false 반환
      return { found: false };
    }

    return { found: false };
  }

  return {
    find,
  };
}
