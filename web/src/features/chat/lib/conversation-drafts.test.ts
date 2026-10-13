import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearConversationDraft,
  conversationDraftKey,
  readConversationDraft,
  writeConversationDraft,
} from "@/features/chat/lib/conversation-drafts";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

beforeEach(() => vi.stubGlobal("localStorage", new MemoryStorage()));
afterEach(() => vi.unstubAllGlobals());

describe("conversation drafts", () => {
  it("isolates channel and thread drafts by Relay and identity", () => {
    const first = conversationDraftKey("wss://one.example", "AA", "general");
    const keys = new Set([
      first,
      conversationDraftKey("wss://two.example", "AA", "general"),
      conversationDraftKey("wss://one.example", "BB", "general"),
      conversationDraftKey("wss://one.example", "AA", "engineering"),
      conversationDraftKey("wss://one.example", "AA", "general", "root-event"),
    ]);

    expect(keys.size).toBe(5);
    writeConversationDraft(first, { content: "private draft", attachments: [] });
    expect(readConversationDraft(first).content).toBe("private draft");
    for (const key of [...keys].slice(1)) {
      expect(readConversationDraft(key)).toEqual({ content: "", attachments: [] });
    }
  });

  it("restores valid attachments and removes empty or cleared drafts", () => {
    const key = conversationDraftKey("wss://relay.example", "AA", "general");
    const attachment = {
      url: "https://relay.example/media/file.png",
      sha256: "ab".repeat(32),
      size: 42,
      type: "image/png",
      uploaded: 42,
      filename: "file.png",
    };

    writeConversationDraft(key, { content: "", attachments: [attachment] });
    expect(readConversationDraft(key)).toEqual({ content: "", attachments: [attachment] });
    clearConversationDraft(key);
    expect(localStorage.getItem(key)).toBeNull();

    writeConversationDraft(key, { content: "   ", attachments: [] });
    expect(localStorage.getItem(key)).toBeNull();
  });
});

describe("formatted drafts", () => {
  it("restores Markdown and exact mention bindings only in their own scope", () => {
    const key = conversationDraftKey("wss://relay.example", "AA", "general", "root");
    const pubkey = "c".repeat(64);
    writeConversationDraft(key, {
      content: "**ship** it @Alex (cccc)",
      attachments: [],
      mentions: [["Alex", pubkey]],
    });
    expect(readConversationDraft(key)).toEqual({
      content: "**ship** it @Alex (cccc)",
      attachments: [],
      mentions: [["Alex", pubkey]],
    });
    expect(
      readConversationDraft(conversationDraftKey("wss://relay.example", "AA", "general")),
    ).toEqual({ content: "", attachments: [] });
  });

  it("drops tampered mention bindings that are not exact keys", () => {
    const key = conversationDraftKey("wss://relay.example", "AA", "general");
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        content: "@Alex",
        attachments: [],
        mentions: [["Alex", "not-a-key"], ["Bo", "d".repeat(64)], "junk"],
      }),
    );
    expect(readConversationDraft(key).mentions).toEqual([["Bo", "d".repeat(64)]]);
  });
});
