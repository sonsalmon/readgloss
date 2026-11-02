// 확장에서 쓰는 Tiptap 조각을 한 묶음으로 내보낸다.
// scripts/build-vendor.mjs 가 extension/vendor/tiptap.bundle.js 로 묶는다.
import { Editor, Extension, InputRule } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { Placeholder, CharacterCount } from '@tiptap/extensions';
import { DOMSerializer } from '@tiptap/pm/model';

globalThis.readglossTiptap = {
  Editor,
  Extension,
  InputRule,
  StarterKit,
  Markdown,
  TaskList,
  TaskItem,
  Placeholder,
  CharacterCount,
  DOMSerializer,
};
