// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Editor, TiptapEditorHTMLElement } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AttachmentDescriptor } from "@/features/chat/lib/chat-types";
import {
  conversationDraftKey,
  readConversationDraft,
  writeConversationDraft,
} from "@/features/chat/lib/conversation-drafts";
import {
  type WorkspaceContextValue,
  WorkspaceProvider,
} from "@/features/chat/lib/workspace-context";
import { MessageComposer } from "@/features/chat/ui/MessageComposer";
import { composerMarkdown } from "@/features/composer/lib/editor-extensions";

const RELAY = "wss://relay.example";
const SELF = "a".repeat(64);
const ALEX = "b".repeat(64);
const channelKey = conversationDraftKey(RELAY, SELF, "general");
const threadKey = (root: string) => conversationDraftKey(RELAY, SELF, "general", root);

const plan: AttachmentDescriptor = {
  url: "https://relay.example/media/plan.pdf",
  sha256: "c".repeat(64),
  size: 2048,
  type: "application/pdf",
  uploaded: 1_760_000_000,
  filename: "plan.pdf",
};

const workspace: WorkspaceContextValue = {
  client: null,
  demo: true,
  config: {
    communityName: "Example",
    relayUrl: RELAY,
    communities: [],
    agents: [],
    agentControlUrl: null,
    features: { projects: false, forum: false },
    demoMode: true,
  },
  relayUrl: RELAY,
  pubkey: SELF,
  connected: true,
  channels: [],
  profiles: {},
  selectedChannel: null,
  canManageSelectedChannel: false,
  ensureProfiles: async () => undefined,
  selectChannel: () => undefined,
  revealMessage: () => undefined,
  showSidePanel: () => undefined,
  readContexts: {},
  markContextRead: () => undefined,
  mutedChannelIds: new Set(),
  presence: {},
  refreshChannels: async () => undefined,
};

type Props = ComponentProps<typeof MessageComposer>;
const mounted: Root[] = [];

beforeAll(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(() => {
  for (const root of mounted.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  localStorage.clear();
});

function mountComposer(props: Partial<Props> & Pick<Props, "onSend">) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push(root);
  const queryClient = new QueryClient();
  let current: Props = {
    relayUrl: RELAY,
    placeholder: "Send a message to #general",
    members: [{ pubkey: ALEX, role: "member" }],
    profiles: { [ALEX]: { pubkey: ALEX, name: "Alex", about: "", picture: null, isAgent: false } },
    onTyping: () => undefined,
    ...props,
  };
  const render = (next: Partial<Props> = {}) => {
    current = { ...current, ...next };
    act(() =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <WorkspaceProvider value={workspace}>
            <MessageComposer {...current} />
          </WorkspaceProvider>
        </QueryClientProvider>,
      ),
    );
  };
  render();
  const editor = () => {
    const dom = container.querySelector<TiptapEditorHTMLElement>(".ProseMirror");
    if (!dom?.editor) throw new Error("The composer editor is not mounted.");
    return dom.editor;
  };
  return { container, render, editor };
}

function pressEnter(editor: Editor) {
  const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  editor.view.someProp("handleKeyDown", (handler) => handler(editor.view, event));
}

function type(editor: Editor, text: string) {
  editor.view.dispatch(editor.state.tr.insertText(text));
}

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("MessageComposer sending", () => {
  it("sends a restored draft ending in a picked mention instead of re-picking it", async () => {
    writeConversationDraft(channelKey, {
      content: "ship it @Alex",
      attachments: [],
      mentions: [["Alex", ALEX]],
    });
    const onSend = vi.fn(async () => undefined);
    const { editor } = mountComposer({ draftKey: channelKey, onSend });

    // The user puts the caret at the end (End key / click) and presses Enter.
    act(() => {
      editor().view.dispatch(
        editor().state.tr.setSelection(TextSelection.atEnd(editor().state.doc)),
      );
    });
    await act(async () => pressEnter(editor()));

    expect(onSend).toHaveBeenCalledWith("ship it @Alex", [], {
      mentionPubkeys: [ALEX],
      emojiTags: [],
    });
    expect(editor().isEmpty).toBe(true);
    expect(readConversationDraft(channelKey)).toEqual({ content: "", attachments: [] });
  });

  it("sends text that Enter follows before React re-renders", async () => {
    const onSend = vi.fn(async () => undefined);
    const { editor } = mountComposer({ draftKey: channelKey, onSend });

    await act(async () => {
      type(editor(), "hello");
      pressEnter(editor());
    });

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("hello", [], { mentionPubkeys: [], emojiTags: [] });
    expect(editor().isEmpty).toBe(true);
  });

  it("keeps the caret where a mention is typed while the thread re-renders", () => {
    const replyTarget = () => ({ id: "e".repeat(64), author: "Sam", body: "deploy?" });
    const { render, editor } = mountComposer({
      draftKey: threadKey("root-c"),
      replyTarget: replyTarget(),
      onSend: vi.fn(async () => undefined),
    });
    act(() => type(editor(), " later"));
    act(() => {
      editor().view.dispatch(
        editor().state.tr.setSelection(TextSelection.create(editor().state.doc, 1)),
      );
    });
    act(() => type(editor(), "@"));
    // ThreadPanel passes a fresh (equal) reply target object whenever it renders.
    render({ replyTarget: replyTarget() });

    expect(editor().state.selection.from).toBe(2);
    expect(editor().state.doc.textContent).toBe("@ later");
  });

  it("clears a reused thread composer at send and never re-seeds or wipes another thread", async () => {
    writeConversationDraft(threadKey("root-a"), {
      content: "alpha for @Alex",
      attachments: [plan],
      mentions: [["Alex", ALEX]],
    });
    const publish = deferred();
    const onSend = vi.fn(() => publish.promise);
    const { container, render, editor } = mountComposer({
      draftKey: threadKey("root-b"),
      onSend,
    });

    act(() => type(editor(), "reply to b"));
    await act(async () => pressEnter(editor()));

    // The timeline shows the optimistic reply now; the composer must not show it twice.
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(editor().isEmpty).toBe(true);
    expect(readConversationDraft(threadKey("root-b")).content).toBe("");

    // Switch threads while the Relay has not acknowledged yet.
    render({ draftKey: threadKey("root-a") });
    expect(composerMarkdown(editor())).toBe("alpha for @Alex");

    await act(async () => {
      publish.resolve();
      await publish.promise;
    });
    expect(composerMarkdown(editor())).toBe("alpha for @Alex");
    expect(container.querySelector('[data-testid="composer-attachments"]')?.textContent).toContain(
      "plan.pdf",
    );
    expect(readConversationDraft(threadKey("root-a"))).toEqual({
      content: "alpha for @Alex",
      attachments: [plan],
      mentions: [["Alex", ALEX]],
    });

    render({ draftKey: threadKey("root-b") });
    expect(editor().isEmpty).toBe(true);
    expect(readConversationDraft(threadKey("root-b")).content).toBe("");
  });

  it("restores the exact message, attachment and mention after a rejected send", async () => {
    writeConversationDraft(channelKey, {
      content: "**ship** it @Alex",
      attachments: [plan],
      mentions: [["Alex", ALEX]],
    });
    const onSend = vi
      .fn<Props["onSend"]>()
      .mockRejectedValueOnce(new Error("blocked: rate-limited"))
      .mockResolvedValueOnce(undefined);
    const { container, editor } = mountComposer({ draftKey: channelKey, onSend });

    await act(async () => pressEnter(editor()));

    expect(container.querySelector('[role="alert"]')?.textContent).toBe("blocked: rate-limited");
    expect(composerMarkdown(editor())).toBe("**ship** it @Alex");
    expect(readConversationDraft(channelKey)).toEqual({
      content: "**ship** it @Alex",
      attachments: [plan],
      mentions: [["Alex", ALEX]],
    });

    await act(async () => pressEnter(editor()));

    expect(onSend).toHaveBeenLastCalledWith(
      `**ship** it @Alex\n\n[plan.pdf](${plan.url})`,
      [plan],
      { mentionPubkeys: [ALEX], emojiTags: [] },
    );
    expect(editor().isEmpty).toBe(true);
    expect(readConversationDraft(channelKey)).toEqual({ content: "", attachments: [] });
  });
});
