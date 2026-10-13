import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import {
  Bold,
  Code,
  Italic,
  Link2,
  List,
  ListOrdered,
  type LucideIcon,
  SquareCode,
  Strikethrough,
  TextQuote,
} from "lucide-react";
import { type MessageKey, t } from "@/shared/i18n";

type FormatAction = {
  id: string;
  label: MessageKey;
  icon: LucideIcon;
  shortcut?: string;
  active: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
};

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? "⌘" : "Ctrl+";
const shift = isMac ? "⇧" : "Shift+";

const ACTIONS: FormatAction[] = [
  {
    id: "bold",
    label: "composer.bold",
    icon: Bold,
    shortcut: `${mod}B`,
    active: (editor) => editor.isActive("bold"),
    run: (editor) => editor.chain().focus().toggleBold().run(),
  },
  {
    id: "italic",
    label: "composer.italic",
    icon: Italic,
    shortcut: `${mod}I`,
    active: (editor) => editor.isActive("italic"),
    run: (editor) => editor.chain().focus().toggleItalic().run(),
  },
  {
    id: "strike",
    label: "composer.strike",
    icon: Strikethrough,
    shortcut: `${mod}${shift}S`,
    active: (editor) => editor.isActive("strike"),
    run: (editor) => editor.chain().focus().toggleStrike().run(),
  },
  {
    id: "code",
    label: "composer.code",
    icon: Code,
    shortcut: `${mod}E`,
    active: (editor) => editor.isActive("code"),
    run: (editor) => editor.chain().focus().toggleCode().run(),
  },
  {
    id: "codeBlock",
    label: "composer.codeBlock",
    icon: SquareCode,
    active: (editor) => editor.isActive("codeBlock"),
    run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: "bulletList",
    label: "composer.bulletList",
    icon: List,
    shortcut: `${mod}${shift}8`,
    active: (editor) => editor.isActive("bulletList"),
    run: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    id: "orderedList",
    label: "composer.orderedList",
    icon: ListOrdered,
    shortcut: `${mod}${shift}7`,
    active: (editor) => editor.isActive("orderedList"),
    run: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    id: "quote",
    label: "composer.quote",
    icon: TextQuote,
    shortcut: `${mod}${shift}B`,
    active: (editor) => editor.isActive("blockquote"),
    run: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
];

const LINK_INDEX = 4;

/** Desktop-order formatting controls; each reflects the mark/node state at the selection. */
export function FormattingBar({
  editor,
  disabled,
  onLink,
}: {
  editor: Editor;
  disabled: boolean;
  onLink: () => void;
}) {
  const active = useEditorState({
    editor,
    selector: ({ editor: current }): Record<string, boolean> => ({
      ...Object.fromEntries(ACTIONS.map((action) => [action.id, action.active(current)])),
      link: current.isActive("link"),
    }),
  });
  const buttons = ACTIONS.map((action) => {
    const Icon = action.icon;
    const label = t(action.label);
    return (
      <button
        key={action.id}
        aria-label={label}
        aria-pressed={Boolean(active[action.id])}
        className="buzz-icon-button h-7 w-7 flex-[0_0_1.75rem]"
        disabled={disabled}
        title={
          action.shortcut ? t("composer.withShortcut", { label, shortcut: action.shortcut }) : label
        }
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => action.run(editor)}
      >
        <Icon className="h-3.5 w-3.5" />
      </button>
    );
  });
  buttons.splice(
    LINK_INDEX + 1,
    0,
    <button
      key="link"
      aria-label={t("composer.link")}
      aria-pressed={Boolean(active.link)}
      className="buzz-icon-button h-7 w-7 flex-[0_0_1.75rem]"
      disabled={disabled}
      title={t("composer.withShortcut", { label: t("composer.link"), shortcut: `${mod}K` })}
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onLink}
    >
      <Link2 className="h-3.5 w-3.5" />
    </button>,
  );
  return (
    <div
      aria-label={t("composer.formattingToolbar")}
      className="buzz-scrollbar flex items-center gap-0.5 overflow-x-auto border-b border-border/55 px-1.5 py-1"
      role="toolbar"
    >
      {buttons}
    </div>
  );
}
