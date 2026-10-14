import { type AnyExtension, type Editor, Extension, InputRule } from "@tiptap/core";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { mentionOccurrences } from "@/features/composer/lib/mention-occurrences";

/** Callbacks read lazily so one editor instance follows the latest React state. */
export type ComposerEditorHooks = {
  placeholder: () => string;
  /** Plain Enter outside code fences; return false to let ProseMirror handle the key. */
  submit: () => boolean;
  /** An autocomplete list owns Enter/Tab/arrows while open. */
  autocompleteOpen: () => boolean;
  /** Mod-K: open the link editor. */
  linkShortcut: () => boolean;
  /** Labels currently bound by the mention picker, for highlighting. */
  boundMentionLabels: () => readonly string[];
};

const FENCE_AT_START = /^(?:```|~~~)([a-z+]*)$/;
const FENCE_AFTER_BREAK = /\n(?:```|~~~)([a-z+]*)$/;

/** Mirror desktop: Enter after a typed ``` fence opens a code block instead of sending. */
export function handleCodeFenceEnter(editor: Editor): boolean | undefined {
  if (editor.isActive("codeBlock")) return undefined;
  const { $cursor } = editor.state.selection as TextSelection;
  if (!$cursor) return undefined;
  const textBefore = $cursor.parent.textBetween(0, $cursor.parentOffset, undefined, "\n");
  const { tr, schema } = editor.state;
  const startMatch = textBefore.match(FENCE_AT_START);
  if (startMatch) {
    tr.delete($cursor.start(), $cursor.pos);
    const start = tr.mapping.map($cursor.start());
    tr.setBlockType(start, start, schema.nodes.codeBlock, {
      language: startMatch[1] || null,
    });
    editor.view.dispatch(tr);
    return true;
  }
  const breakMatch = textBefore.match(FENCE_AFTER_BREAK);
  if (!breakMatch) return undefined;
  const hardBreakPosition = $cursor.start() + ($cursor.parentOffset - breakMatch[0].length);
  const afterParagraph = $cursor.after();
  tr.delete(hardBreakPosition, $cursor.pos);
  const mapped = tr.mapping.map(afterParagraph);
  tr.insert(mapped, schema.nodes.codeBlock.create({ language: breakMatch[1] || null }));
  tr.setSelection(TextSelection.near(tr.doc.resolve(mapped + 1)));
  editor.view.dispatch(tr);
  return true;
}

function exitListIfEmptyLast(editor: Editor): boolean {
  if (!editor.isActive("listItem")) return false;
  const { $from } = editor.state.selection;
  let listItemDepth = -1;
  for (let depth = $from.depth; depth >= 1; depth -= 1) {
    if ($from.node(depth).type.name === "listItem") {
      listItemDepth = depth;
      break;
    }
  }
  if (listItemDepth < 1) return false;
  const listItem = $from.node(listItemDepth);
  if (listItem.childCount !== 1 || listItem.firstChild?.textContent !== "") return false;
  const listDepth = listItemDepth - 1;
  const list = $from.node(listDepth);
  if ($from.index(listDepth) !== list.childCount - 1) return false;
  const { tr, schema } = editor.state;
  const paragraph = schema.nodes.paragraph.create();
  if (list.childCount === 1) {
    const listStart = $from.before(listDepth);
    tr.replaceWith(listStart, $from.after(listDepth), paragraph);
    tr.setSelection(TextSelection.near(tr.doc.resolve(listStart + 1)));
  } else {
    tr.delete($from.before(listItemDepth), $from.after(listItemDepth));
    const listEnd = tr.mapping.map($from.after(listDepth));
    tr.insert(listEnd, paragraph);
    tr.setSelection(TextSelection.near(tr.doc.resolve(listEnd + 1)));
  }
  editor.view.dispatch(tr);
  return true;
}

const mentionHighlightKey = new PluginKey<DecorationSet>("buzzMentionHighlight");

function mentionDecorations(
  doc: Parameters<typeof DecorationSet.create>[0],
  labels: readonly string[],
) {
  if (!labels.length) return DecorationSet.empty;
  const candidates = labels.map((displayName) => ({ displayName }));
  const decorations: Decoration[] = [];
  doc.descendants((node, position) => {
    if (!node.isTextblock || node.type.name === "codeBlock") return true;
    // Hard breaks are one position wide, so "\n" keeps text offsets aligned with positions.
    const text = node.textBetween(0, node.content.size, undefined, "\n");
    for (const occurrence of mentionOccurrences(text, candidates)) {
      decorations.push(
        Decoration.inline(position + 1 + occurrence.start, position + 1 + occurrence.end, {
          class: "buzz-composer-mention",
        }),
      );
    }
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

/** Ask the highlight plugin to recompute after picker bindings change outside the document. */
export function refreshMentionHighlights(editor: Editor): void {
  editor.view.dispatch(editor.state.tr.setMeta(mentionHighlightKey, true));
}

/** The desktop-compatible composer schema, keymap and Markdown bridge. */
export function composerExtensions(hooks: ComposerEditorHooks): AnyExtension[] {
  return [
    StarterKit.configure({
      hardBreak: { keepMarks: true },
      // "#channel" must stay literal text in chat.
      heading: false,
      code: { HTMLAttributes: { spellcheck: "false" } },
      codeBlock: { HTMLAttributes: { spellcheck: "false" } },
      horizontalRule: false,
      trailingNode: false,
      // Underline has no Markdown form; desktop renders messages from Markdown only.
      underline: false,
      link: false,
    }),
    Extension.create({
      name: "buzzComposerKeys",
      addKeyboardShortcuts() {
        return {
          Enter: ({ editor }) => {
            if (editor.view.composing || hooks.autocompleteOpen()) return false;
            const fence = handleCodeFenceEnter(editor);
            if (fence !== undefined) return fence;
            if (editor.isActive("codeBlock")) return false;
            return hooks.submit();
          },
          "Shift-Enter": ({ editor }) => {
            if (editor.isActive("codeBlock")) {
              return editor.commands.command(({ tr }) => {
                tr.insertText("\n");
                return true;
              });
            }
            if (exitListIfEmptyLast(editor)) return true;
            if (editor.isActive("listItem")) return editor.commands.splitListItem("listItem");
            if (editor.isActive("blockquote")) {
              if (editor.state.selection.$from.parent.textContent === "") {
                return editor.commands.lift("blockquote");
              }
              return editor.commands.splitBlock();
            }
            return false;
          },
          ArrowDown: ({ editor }) => exitListIfEmptyLast(editor),
          "Mod-k": () => hooks.linkShortcut(),
        };
      },
      addInputRules() {
        const codeBlock = this.editor.schema.nodes.codeBlock;
        return [
          new InputRule({
            find: /\n(?:```|~~~)([a-z+]*)[\s]$/,
            handler: ({ state, range, match }) => {
              const $from = state.doc.resolve(range.from);
              if ($from.parent.type.name === "codeBlock") return null;
              const afterParagraph = $from.after();
              state.tr.delete(range.from, range.to);
              const mapped = state.tr.mapping.map(afterParagraph);
              state.tr.insert(mapped, codeBlock.create({ language: match[1] || null }));
              state.tr.setSelection(TextSelection.near(state.tr.doc.resolve(mapped + 1)));
            },
          }),
        ];
      },
      addProseMirrorPlugins() {
        return [
          new Plugin<DecorationSet>({
            key: mentionHighlightKey,
            state: {
              init: (_, state) => mentionDecorations(state.doc, hooks.boundMentionLabels()),
              apply: (tr, previous, _, state) =>
                tr.docChanged || tr.getMeta(mentionHighlightKey)
                  ? mentionDecorations(state.doc, hooks.boundMentionLabels())
                  : previous,
            },
            props: {
              decorations: (state) => mentionHighlightKey.getState(state),
            },
          }),
        ];
      },
    }),
    Placeholder.configure({ placeholder: () => hooks.placeholder() }),
    Link.extend({ inclusive: () => false }).configure({
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      defaultProtocol: "https",
      protocols: ["mailto"],
      HTMLAttributes: { class: "buzz-composer-link", rel: "noreferrer noopener", target: null },
    }),
    Markdown.configure({
      html: false,
      transformPastedText: true,
      transformCopiedText: true,
      breaks: true,
    }),
  ];
}

/**
 * Desktop-compatible Markdown for the current document (desktop useRichTextEditor
 * getMarkdownFromEditor): hard breaks become plain newlines and characters the user
 * typed literally (backticks, emphasis markers, brackets) are not backslash-escaped,
 * because messages are rendered as Markdown on every client.
 */
export function composerMarkdown(editor: Editor): string {
  const storage = (editor.storage as unknown as Record<string, unknown>).markdown as
    | { getMarkdown?: () => string }
    | undefined;
  if (!storage?.getMarkdown) return editor.state.doc.textContent;
  return storage
    .getMarkdown()
    .replace(/\\\n/g, "\n")
    .replace(/\\([`*\\~[\]_])/g, "$1");
}

/** Empty the document after a send, even while the editor is read-only during publishing. */
export function clearComposer(editor: Editor): void {
  const { tr, doc } = editor.state;
  editor.view.dispatch(tr.delete(0, doc.content.size).setStoredMarks([]));
}

/** Whether the document holds sendable text (whitespace-only and empty blocks do not count). */
export function composerHasText(editor: Editor): boolean {
  return !editor.isEmpty && editor.state.doc.textContent.trim().length > 0;
}
