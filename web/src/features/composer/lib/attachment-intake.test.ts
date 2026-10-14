import { describe, expect, it } from "vitest";
import {
  filesFromDataTransfer,
  namedClipboardFile,
  triageComposerFiles,
} from "@/features/composer/lib/attachment-intake";

const file = (name: string, type: string, bytes = 4) =>
  new File([new Uint8Array(bytes)], name, { type });

describe("composer attachment intake", () => {
  it("rejects empty, active-content and over-limit files with reasons", () => {
    const { accepted, rejected } = triageComposerFiles(
      [
        file("photo.png", "image/png"),
        file("empty.txt", "text/plain", 0),
        file("logo.svg", "image/svg+xml"),
        file("tool.exe", "application/octet-stream"),
        file("notes.pdf", "application/pdf"),
      ],
      6,
    );
    expect(accepted.map((item) => item.name)).toEqual(["photo.png", "notes.pdf"]);
    expect(rejected).toEqual([
      { name: "empty.txt", reason: "The file is empty." },
      { name: "logo.svg", reason: "This file type is not allowed." },
      { name: "tool.exe", reason: "This file type is not allowed." },
    ]);
    expect(triageComposerFiles([file("x.png", "image/png")], 8).rejected[0].reason).toBe(
      "A message can include up to 8 attachments.",
    );
  });

  it("takes pasted files from clipboard items and ignores text-only pastes", () => {
    const image = file("image.png", "image/png");
    const transfer = {
      items: [
        { kind: "string", getAsFile: () => null },
        { kind: "file", getAsFile: () => image },
      ],
      files: [],
      types: ["Files", "text/plain"],
    } as unknown as DataTransfer;
    expect(filesFromDataTransfer(transfer)).toEqual([image]);
    expect(
      filesFromDataTransfer({
        items: [],
        files: [],
        types: ["text/plain"],
      } as unknown as DataTransfer),
    ).toEqual([]);
  });

  it("gives generic clipboard image names a unique descriptive name", () => {
    expect(namedClipboardFile(file("image.png", "image/png"), 42).name).toBe("pasted-42.png");
    expect(namedClipboardFile(file("diagram.png", "image/png"), 42).name).toBe("diagram.png");
  });
});
