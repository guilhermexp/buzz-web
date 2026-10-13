// @vitest-environment happy-dom
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { composerExtensions, composerMarkdown } from "@/features/composer/lib/editor-extensions";
import {
  appendEditorMention,
  editorMentionQuery,
  insertEditorMention,
  insertEditorText,
} from "@/features/composer/lib/editor-mentions";

const editors: Editor[] = [];

function createEditor(markdown = "") {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    content: markdown,
    extensions: composerExtensions({
      placeholder: () => "",
      submit: () => true,
      autocompleteOpen: () => false,
      linkShortcut: () => false,
      boundMentionLabels: () => ["Codex Remote"],
    }),
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.innerHTML = "";
});

describe("editor mentions", () => {
  it("replaces the active query with the full label and one separator", () => {
    const editor = createEditor("ask **@Co** please");
    // Place the caret right after "@Co" inside the bold mark.
    editor.commands.setTextSelection(8);
    const query = editorMentionQuery(editor, ["Codex Remote"]);
    expect(query).toMatchObject({ query: "Co" });
    if (!query) throw new Error("expected a mention query");
    insertEditorMention(editor, query, "Codex Remote");
    expect(composerMarkdown(editor)).toBe("ask **@Codex Remote** please");
    editor.commands.insertContent({ type: "text", text: "x" });
    expect(editor.state.doc.textContent).toBe("ask @Codex Remote xplease");
  });

  it("detects a query after a hard line break but not inside code", () => {
    const editor = createEditor("first\n@Co");
    editor.commands.focus("end");
    expect(editorMentionQuery(editor, ["Codex"])).toMatchObject({ query: "Co" });
    editor.commands.setContent("`@Co`");
    editor.commands.setTextSelection(4);
    expect(editorMentionQuery(editor, ["Codex"])).toBeNull();
  });

  it("appends member mentions and inserts literal emoji shortcodes", () => {
    const editor = createEditor("hi");
    appendEditorMention(editor, "Alex Web");
    insertEditorText(editor, ":party_parrot:");
    expect(composerMarkdown(editor)).toBe("hi @Alex Web :party_parrot:");
  });

  it("highlights picker-bound labels without changing the document", () => {
    const editor = createEditor("ping @Codex Remote now");
    expect(editor.view.dom.querySelector(".buzz-composer-mention")?.textContent).toBe(
      "@Codex Remote",
    );
  });
});
