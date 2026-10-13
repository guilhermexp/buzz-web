import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { detectMentionQuery, type MentionQuery } from "@/features/chat/lib/composer-mentions";

/** An active `@query` in the editor, with its document range. */
export type EditorMentionQuery = MentionQuery & { from: number; to: number };

/** Detect an `@query` that ends at a collapsed caret inside the current text block. */
export function editorMentionQuery(
  editor: Editor,
  knownNames: string[],
): EditorMentionQuery | null {
  const { selection } = editor.state;
  if (!selection.empty || editor.isActive("code") || editor.isActive("codeBlock")) return null;
  const { $from } = selection;
  // Hard breaks are one position wide; "\n" keeps string offsets equal to positions.
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "\n");
  const query = detectMentionQuery(before, before.length, knownNames);
  if (!query) return null;
  const blockStart = $from.start();
  return { ...query, from: blockStart + query.startIndex, to: blockStart + query.endIndex };
}

/**
 * Replace the active query with the literal label and one separator (desktop mention editor
 * contract), keeping active marks and placing the caret after the separator.
 */
export function insertEditorMention(
  editor: Editor,
  query: EditorMentionQuery,
  label: string,
): void {
  const { state } = editor;
  const replacement = `@${label} `;
  const next = state.doc.textBetween(query.to, Math.min(query.to + 1, state.doc.content.size));
  const end = next === " " ? query.to + 1 : query.to;
  const tr = state.tr.insertText(replacement, query.from, end);
  tr.setSelection(TextSelection.create(tr.doc, query.from + replacement.length));
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
}

/** Append `@Label ` at the end of the document (e.g. "mention" from a member profile). */
export function appendEditorMention(editor: Editor, label: string): void {
  const end = TextSelection.atEnd(editor.state.doc);
  const before = editor.state.doc.textBetween(Math.max(0, end.from - 1), end.from);
  const prefix = before && before !== " " && before !== "\n" ? " " : "";
  const text = `${prefix}@${label} `;
  const tr = editor.state.tr.insertText(text, end.from);
  tr.setSelection(TextSelection.create(tr.doc, end.from + text.length));
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
}

/**
 * Insert literal text at the selection. Unlike `insertContent`, this never runs the
 * Markdown parser, so `:party_parrot:` or a pasted label stays exactly as typed.
 */
export function insertEditorText(editor: Editor, text: string): void {
  const { from, to } = editor.state.selection;
  editor.view.dispatch(editor.state.tr.insertText(text, from, to).scrollIntoView());
  editor.view.focus();
}
