import { describe, expect, it } from "vitest";
import {
  AmbiguousMentionError,
  extractMentionPubkeys,
  pruneMentionBindings,
  selectedMentionLabel,
} from "@/features/composer/lib/mention-bindings";

const ALEX_A = "a".repeat(64);
const ALEX_B = "b".repeat(64);
const CODEX = "c".repeat(64);
const members = [
  { displayName: "Alex", pubkey: ALEX_A },
  { displayName: "Alex", pubkey: ALEX_B },
  { displayName: "Codex Remote", pubkey: CODEX },
];

describe("mention bindings", () => {
  it("qualifies a second same-name selection with its full key", () => {
    const bindings = new Map([["Alex", ALEX_A]]);
    expect(selectedMentionLabel("Alex", ALEX_A, bindings)).toBe("Alex");
    expect(selectedMentionLabel("Alex", ALEX_B, bindings)).toBe(`Alex (${ALEX_B})`);
    bindings.set(`Alex (${ALEX_B})`, CODEX);
    expect(selectedMentionLabel("Alex", ALEX_B, bindings)).toBe(`Alex (${ALEX_B}) 2`);
  });

  it("binds picker selections to their exact key even when the name is shared", () => {
    const bindings = new Map([
      ["Alex", ALEX_B],
      [`Alex (${ALEX_A})`, ALEX_A],
    ]);
    expect(extractMentionPubkeys(`hi @Alex and @Alex (${ALEX_A})`, bindings, members)).toEqual([
      ALEX_B,
      ALEX_A,
    ]);
  });

  it("fails visibly instead of fanning out to every member sharing a typed name", () => {
    expect(() => extractMentionPubkeys("ping @Alex", new Map(), members)).toThrow(
      AmbiguousMentionError,
    );
  });

  it("resolves unique typed names, multi-word labels and ignores code", () => {
    expect(extractMentionPubkeys("@Codex Remote, look", new Map(), members)).toEqual([CODEX]);
    expect(extractMentionPubkeys("`@Alex` and\n```\n@Alex\n```", new Map(), members)).toEqual([]);
    expect(extractMentionPubkeys("mail@Alex.dev", new Map(), members)).toEqual([]);
  });

  it("drops bindings whose label was deleted from the draft", () => {
    const bindings = new Map([
      ["Alex", ALEX_A],
      ["Codex Remote", CODEX],
    ]);
    expect([...pruneMentionBindings("only @Codex Remote now", bindings)]).toEqual([
      ["Codex Remote", CODEX],
    ]);
  });
});
