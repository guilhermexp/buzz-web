import { describe, expect, it } from "vitest";
import { detectMentionQuery } from "@/features/chat/lib/composer-mentions";

describe("composer mentions", () => {
  it("detects names with parentheses", () => {
    const content = "ask @Co";
    expect(detectMentionQuery(content, content.length, ["Codex(remote)", "Grok(remote)"])).toEqual({
      query: "Co",
      startIndex: 4,
      endIndex: 7,
    });
  });

  it("keeps a multi-word mention open only while it matches a known member", () => {
    const content = "(@Codex Remote";
    expect(detectMentionQuery(content, content.length, ["Codex Remote"])).toMatchObject({
      query: "Codex Remote",
      startIndex: 1,
    });
    expect(detectMentionQuery("mail@example.com", 16, ["Example"])).toBeNull();
    expect(detectMentionQuery("@Codex Remote ", 14, ["Codex Remote"])).toBeNull();
  });

  it("does not continue a query across a line break", () => {
    expect(detectMentionQuery("@Co\nx", 5, ["Codex"])).toBeNull();
  });
});
