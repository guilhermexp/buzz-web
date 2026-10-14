import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CanvasRevision } from "@/features/canvas/lib/canvas-protocol";
import { CanvasConflict } from "@/features/canvas/ui/CanvasConflict";

const THEIRS: CanvasRevision = {
  eventId: "a".repeat(64),
  content: "# Launch plan\n\n- status: shipped",
  createdAt: 1_791_914_868,
  author: "b".repeat(64),
  expectedRevision: "c".repeat(64),
};

function render(theirs: CanvasRevision | null) {
  return renderToStaticMarkup(
    <CanvasConflict
      authorName={() => "Ada"}
      busy={false}
      reason="conflict"
      theirs={theirs}
      onDiscard={() => undefined}
      onMerge={() => undefined}
      onOverwrite={() => undefined}
    />,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("CanvasConflict", () => {
  it("shows the newer head as rendered Markdown with its author", () => {
    vi.stubGlobal("navigator", { languages: ["en-US"], language: "en-US" });
    const html = render(THEIRS);
    expect(html).toContain("<h1>Launch plan</h1>");
    expect(html).toContain("status: shipped");
    expect(html).toContain("Latest version by Ada");
    expect(html).toContain("Merge changes");
  });

  it("offers no merge when no head exists to merge with", () => {
    vi.stubGlobal("navigator", { languages: ["en-US"], language: "en-US" });
    const html = render(null);
    expect(html).not.toContain("Merge changes");
    expect(html).toContain("Overwrite with my draft");
    expect(html).toContain("Discard my draft");
  });

  it("localizes the recovery copy for Simplified Chinese", () => {
    vi.stubGlobal("navigator", { languages: ["zh-CN"], language: "zh-CN" });
    const html = render(THEIRS);
    expect(html).toContain("自你加载以来，画布已被更改");
    expect(html).toContain("合并更改");
  });
});
