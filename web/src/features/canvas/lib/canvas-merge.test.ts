import { describe, expect, it } from "vitest";
import { diffCanvasLines, mergeCanvasText } from "@/features/canvas/lib/canvas-merge";

const LABELS = { ours: "Your draft", theirs: "Latest canvas" };

describe("mergeCanvasText", () => {
  it("combines edits to different lines without conflicts", () => {
    const base = "# Plan\n- one\n- two\n- three\n";
    const ours = "# Plan\n- one (mine)\n- two\n- three\n";
    const theirs = "# Plan\n- one\n- two\n- three (theirs)\n";
    expect(mergeCanvasText(base, ours, theirs, LABELS)).toEqual({
      text: "# Plan\n- one (mine)\n- two\n- three (theirs)\n",
      conflicts: 0,
    });
  });

  it("keeps insertions from both sides at different anchors", () => {
    const base = "a\nb\nc";
    const ours = "start\na\nb\nc";
    const theirs = "a\nb\nc\nend";
    expect(mergeCanvasText(base, ours, theirs, LABELS)).toEqual({
      text: "start\na\nb\nc\nend",
      conflicts: 0,
    });
  });

  it("marks a line both sides changed differently and keeps both versions", () => {
    const base = "title\nstatus: draft\nfooter";
    const ours = "title\nstatus: review\nfooter";
    const theirs = "title\nstatus: shipped\nfooter";
    const result = mergeCanvasText(base, ours, theirs, LABELS);
    expect(result.conflicts).toBe(1);
    expect(result.text).toBe(
      [
        "title",
        "<<<<<<< Your draft",
        "status: review",
        "=======",
        "status: shipped",
        ">>>>>>> Latest canvas",
        "footer",
      ].join("\n"),
    );
  });

  it("treats identical edits on both sides as clean", () => {
    const base = "x\ny";
    const both = "x\nz";
    expect(mergeCanvasText(base, both, both, LABELS)).toEqual({ text: both, conflicts: 0 });
    expect(mergeCanvasText("p\nq\nr", "p\nQ\nr\ns", "p\nQ\nr", LABELS)).toEqual({
      text: "p\nQ\nr\ns",
      conflicts: 0,
    });
  });

  it("takes a deletion on one side when the other side left the region untouched", () => {
    const base = "keep\nremove me\nkeep too";
    const ours = "keep\nkeep too";
    const theirs = "keep\nremove me\nkeep too\nappended";
    expect(mergeCanvasText(base, ours, theirs, LABELS)).toEqual({
      text: "keep\nkeep too\nappended",
      conflicts: 0,
    });
  });

  it("conflicts when one side deletes a line the other side edited", () => {
    const result = mergeCanvasText("a\nb\nc", "a\nc", "a\nB\nc", LABELS);
    expect(result.conflicts).toBe(1);
    expect(result.text).toBe("a\n<<<<<<< Your draft\n=======\nB\n>>>>>>> Latest canvas\nc");
  });

  it("merges against an empty base (first canvas raced by another creator)", () => {
    const result = mergeCanvasText("", "mine", "theirs", LABELS);
    expect(result.conflicts).toBe(1);
    expect(result.text).toContain("mine");
    expect(result.text).toContain("theirs");
  });

  it("returns the untouched side when only one side changed", () => {
    expect(mergeCanvasText("a", "a", "b", LABELS)).toEqual({ text: "b", conflicts: 0 });
    expect(mergeCanvasText("a", "b", "a", LABELS)).toEqual({ text: "b", conflicts: 0 });
  });

  it("stays lossless when a huge region is too large to align", () => {
    const base = Array.from({ length: 2_500 }, (_, index) => `base ${index}`).join("\n");
    const ours = Array.from({ length: 2_500 }, (_, index) => `ours ${index}`).join("\n");
    const theirs = Array.from({ length: 2_500 }, (_, index) => `theirs ${index}`).join("\n");
    const result = mergeCanvasText(base, ours, theirs, LABELS);
    expect(result.conflicts).toBe(1);
    expect(result.text).toContain("ours 2499");
    expect(result.text).toContain("theirs 0");
    expect(result.text).not.toContain("base 7");
  });
});

describe("diffCanvasLines", () => {
  it("lists removed, added and unchanged lines in document order", () => {
    expect(diffCanvasLines("a\nb\nc", "a\nB\nc\nd")).toEqual([
      { kind: "same", text: "a" },
      { kind: "removed", text: "b" },
      { kind: "added", text: "B" },
      { kind: "same", text: "c" },
      { kind: "added", text: "d" },
    ]);
    expect(diffCanvasLines("x", "x").every((line) => line.kind === "same")).toBe(true);
  });
});
