// @vitest-environment happy-dom
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearComposer,
  composerExtensions,
  composerMarkdown,
} from "@/features/composer/lib/editor-extensions";

const editors: Editor[] = [];

function createEditor(options: { onSubmit?: () => void; autocompleteOpen?: boolean } = {}) {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: composerExtensions({
      placeholder: () => "Message",
      submit: () => {
        options.onSubmit?.();
        return true;
      },
      autocompleteOpen: () => options.autocompleteOpen ?? false,
      linkShortcut: () => false,
      boundMentionLabels: () => [],
    }),
  });
  editors.push(editor);
  return editor;
}

function roundTrip(markdown: string): string {
  const editor = createEditor();
  editor.commands.setContent(markdown);
  return composerMarkdown(editor);
}

function pressKey(editor: Editor, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  editor.view.someProp("handleKeyDown", (handler) => handler(editor.view, event));
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.innerHTML = "";
});

describe("composer Markdown serialization", () => {
  it.each([
    "**bold** and *italic*",
    "~~gone~~ with `code`",
    "[docs](https://buzz.example.com/docs)",
    "- one\n- two",
    "1. first\n2. second",
    "> quoted words",
    "```ts\nconst value = 1;\n```",
    "first line\nsecond line",
    "para one\n\npara two",
    "@Alex Web ping",
  ])("round-trips desktop Markdown %j", (markdown) => {
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it("keeps literal Markdown the user typed instead of escaping it", () => {
    const editor = createEditor();
    editor.commands.insertContent({ type: "text", text: "![poster](https://x.example/a_b.png)" });
    expect(composerMarkdown(editor)).toBe("![poster](https://x.example/a_b.png)");
  });

  it("serializes toolbar formatting to the marks desktop renders", () => {
    const editor = createEditor();
    editor.commands.insertContent({ type: "text", text: "hello" });
    editor.commands.selectAll();
    editor.commands.toggleBold();
    editor.commands.toggleStrike();
    expect(composerMarkdown(editor)).toBe("**~~hello~~**");
    editor.commands.toggleBold();
    editor.commands.toggleStrike();
    editor.commands.toggleBlockquote();
    expect(composerMarkdown(editor)).toBe("> hello");
  });
});

describe("composer keyboard", () => {
  it("sends on Enter and inserts a newline on Shift+Enter", () => {
    let submitted = 0;
    const editor = createEditor({ onSubmit: () => submitted++ });
    editor.commands.insertContent({ type: "text", text: "line" });
    pressKey(editor, "Enter", { shiftKey: true });
    editor.commands.insertContent({ type: "text", text: "next" });
    expect(submitted).toBe(0);
    expect(composerMarkdown(editor)).toBe("line\nnext");
    pressKey(editor, "Enter");
    expect(submitted).toBe(1);
  });

  it("leaves Enter to an open autocomplete", () => {
    let submitted = 0;
    const editor = createEditor({ onSubmit: () => submitted++, autocompleteOpen: true });
    editor.commands.insertContent({ type: "text", text: "@Al" });
    pressKey(editor, "Enter");
    expect(submitted).toBe(0);
  });

  it("turns a typed fence into a code block instead of sending", () => {
    let submitted = 0;
    const editor = createEditor({ onSubmit: () => submitted++ });
    editor.commands.insertContent({ type: "text", text: "```js" });
    pressKey(editor, "Enter");
    editor.commands.insertContent({ type: "text", text: "run()" });
    expect(submitted).toBe(0);
    expect(composerMarkdown(editor)).toBe("```js\nrun()\n```");
  });
});

describe("composer clearing", () => {
  it("empties a formatted document even while read-only", () => {
    const editor = createEditor();
    editor.commands.setContent("**sent** text\n\n- item");
    editor.setEditable(false, false);
    clearComposer(editor);
    editor.setEditable(true, false);
    expect(editor.isEmpty).toBe(true);
    expect(composerMarkdown(editor)).toBe("");
  });
});
