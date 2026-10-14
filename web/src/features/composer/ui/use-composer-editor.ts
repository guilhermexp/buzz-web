import type { Editor } from "@tiptap/core";
import { useEditor } from "@tiptap/react";
import { useEffect, useRef } from "react";
import { dragHasFiles, filesFromDataTransfer } from "@/features/composer/lib/attachment-intake";
import {
  type ComposerEditorHooks,
  composerExtensions,
} from "@/features/composer/lib/editor-extensions";

export type ComposerEditorCallbacks = ComposerEditorHooks & {
  /** Files pasted or dropped into the editor. */
  files: (files: File[]) => void;
  /** Any document or selection change (mention detection, drafts, typing). */
  change: (editor: Editor, docChanged: boolean) => void;
  /** Runs before the editor keymap; return true to consume the key (autocomplete lists). */
  keyDown: (event: KeyboardEvent) => boolean;
};

/**
 * One TipTap editor per composer. Callbacks are read through a ref so the editor is not
 * recreated when React state changes; only `initialMarkdown` seeds the first document.
 */
export function useComposerEditor({
  initialMarkdown,
  ariaLabel,
  ariaAutocomplete,
  editable,
  compact,
  callbacks,
}: {
  initialMarkdown: string;
  ariaLabel: string;
  /** Mention list wiring: `aria-controls`/`aria-activedescendant` while suggestions show. */
  ariaAutocomplete: { controls?: string; activeDescendant?: string };
  editable: boolean;
  compact: boolean;
  callbacks: ComposerEditorCallbacks;
}) {
  const latest = useRef(callbacks);
  latest.current = callbacks;

  // useEditor re-applies `editorProps` on every render, so attributes must live here.
  const { controls, activeDescendant } = ariaAutocomplete;
  const attributes: Record<string, string> = {
    role: "textbox",
    "aria-multiline": "true",
    "aria-label": ariaLabel,
    "aria-autocomplete": "list",
    autocapitalize: "none",
    autocorrect: "off",
    spellcheck: "true",
    "data-testid": "message-input",
    class: `buzz-message-markdown buzz-composer-input ${compact ? "max-h-32" : "max-h-48"}`,
  };
  if (controls) attributes["aria-controls"] = controls;
  if (activeDescendant) attributes["aria-activedescendant"] = activeDescendant;

  const editor = useEditor({
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    content: initialMarkdown,
    editable,
    extensions: composerExtensions({
      placeholder: () => latest.current.placeholder(),
      submit: () => latest.current.submit(),
      autocompleteOpen: () => latest.current.autocompleteOpen(),
      linkShortcut: () => latest.current.linkShortcut(),
      boundMentionLabels: () => latest.current.boundMentionLabels(),
    }),
    editorProps: {
      attributes,
      handleKeyDown: (_view, event) => latest.current.keyDown(event),
      handlePaste: (_view, event) => {
        const files = filesFromDataTransfer(event.clipboardData);
        if (!files.length) return false;
        event.preventDefault();
        latest.current.files(files);
        return true;
      },
      handleDrop: (_view, event) => {
        if (!dragHasFiles(event.dataTransfer)) return false;
        const files = filesFromDataTransfer(event.dataTransfer);
        if (!files.length) return false;
        event.preventDefault();
        latest.current.files(files);
        return true;
      },
    },
    onUpdate: ({ editor }) => latest.current.change(editor, true),
    onSelectionUpdate: ({ editor }) => latest.current.change(editor, false),
  });

  useEffect(() => {
    editor.setEditable(editable, false);
  }, [editable, editor]);

  return editor;
}
