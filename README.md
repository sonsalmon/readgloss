# readgloss

A browser extension that helps a Korean learner read English on the web — and on video — without leaving the page.

Double-click a word to get its dictionary meaning, let difficult words carry a small gloss above them as you read, translate a paragraph in place, and save words, phrases and sentences into a personal vocabulary that comes back for review.

Built and used daily by its author as a personal learning tool, developed iteratively with AI coding agents (spec-driven tickets, independent verification, 1,400+ automated tests).

## What it does

- **Word lookup** — double-click any word for a macOS English–Korean dictionary card (native Swift helper), with an optional AI button for a context-aware meaning.
- **Adaptive annotation** — words likely to be unknown *to you* get a small gloss above them (ruby-style). The level adapts per word from your lookup history; glossary overlays add domain terms (math, ML, security).
- **In-place translation** — translate a paragraph or a whole page in place, or drag-select text for macOS translation plus an AI "in context" translation.
- **Video subtitles** — a dual-subtitle layer for YouTube and Netflix: click a word in the English line for its card, save phrases/sentences together with the scene clip, hide lines for listening practice, and review saved scenes later.
- **Personal vocabulary** — wordbook, known-word marking, saved phrases / sentences / concepts, a Notion-style memo pad, and scrap highlights with quotes.
- **Review** — spaced review boxes bring old words back a few at a time; study time is tracked per site and section.
- **Private by design** — all learning data lives in a local SQLite database on your own machine (`data/`, git-ignored). The only outbound calls are the AI features, which run through your own AI coding subscription via the local bridge.

## How it works

| Part | What it is |
|---|---|
| `extension/` | Chromium extension (content scripts, side panel, settings) — plain JavaScript, no build step |
| `bridge/` | Local Node.js server that talks to the macOS dictionary/translation helpers and the AI backend, and owns the SQLite store |
| `native/` | Small Swift helpers wrapping macOS Dictionary and Translation services |
| `docs/` | The living spec (`docs/spec.md`) and progress log (`docs/PROGRESS.md`) the project is built against |
| `test/`, `e2e/` | Node test-runner suites plus a fake-YouTube end-to-end harness |

## Getting started (macOS)

```sh
npm install
npm run build:native   # builds the Swift dictionary + translation helpers (needs Xcode tools)
npm test               # runs the test suite
```

Then load the `extension/` folder as an unpacked extension in a Chromium browser and start the bridge (`node bridge/server.mjs`, or install the launchd agent described in `docs/PROGRESS.md`).

## Status

Personal project under active development — built for one user's daily English reading and speaking study, and evolving ticket by ticket.

## License

Apache License 2.0 — see [LICENSE](LICENSE).
