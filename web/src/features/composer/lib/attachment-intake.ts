import { t } from "@/shared/i18n";

export const MAX_COMPOSER_ATTACHMENTS = 8;

/** Desktop and Relay deny-list for active content and executables. */
const BLOCKED_MIME_TYPES = new Set([
  "application/xhtml+xml",
  "image/svg+xml",
  "application/javascript",
  "text/javascript",
  "application/x-msdownload",
  "application/x-executable",
  "application/vnd.microsoft.portable-executable",
  "application/x-mach-binary",
  "application/x-sharedlib",
  "application/x-elf",
  "application/x-msi",
  "application/vnd.android.package-archive",
  "application/x-apple-diskimage",
]);
const BLOCKED_EXTENSIONS = new Set([
  "svg",
  "svgz",
  "xhtml",
  "js",
  "mjs",
  "exe",
  "msi",
  "apk",
  "dmg",
]);

export type RejectedFile = { name: string; reason: string };

/** Files carried by a paste or drop; text-only clipboard data yields none. */
export function filesFromDataTransfer(transfer: DataTransfer | null): File[] {
  if (!transfer) return [];
  const fromItems = [...(transfer.items ?? [])]
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
  return fromItems.length ? fromItems : [...(transfer.files ?? [])];
}

/** Whether a drag carries files (rather than text or an in-editor node move). */
export function dragHasFiles(transfer: DataTransfer | null): boolean {
  return Boolean(transfer && [...transfer.types].includes("Files"));
}

/**
 * Split incoming files into ones worth uploading and visible rejections. Image content and
 * metadata are validated again by the upload sanitizer; this only rejects what can never pass.
 */
export function triageComposerFiles(
  files: readonly File[],
  existingCount: number,
): { accepted: File[]; rejected: RejectedFile[] } {
  const accepted: File[] = [];
  const rejected: RejectedFile[] = [];
  for (const file of files) {
    const name = file.name || t("message.attachment");
    const extension = file.name.split(".").pop()?.toLocaleLowerCase() ?? "";
    if (file.size === 0) {
      rejected.push({ name, reason: t("composer.fileEmpty") });
    } else if (
      BLOCKED_MIME_TYPES.has(file.type.toLocaleLowerCase()) ||
      BLOCKED_EXTENSIONS.has(extension)
    ) {
      rejected.push({ name, reason: t("composer.fileBlocked") });
    } else if (existingCount + accepted.length >= MAX_COMPOSER_ATTACHMENTS) {
      rejected.push({
        name,
        reason: t("composer.fileLimit", { count: MAX_COMPOSER_ATTACHMENTS }),
      });
    } else {
      accepted.push(file);
    }
  }
  return { accepted, rejected };
}

/** Clipboard images often arrive as "image.png"; give them a stable, descriptive name. */
export function namedClipboardFile(file: File, now = Date.now()): File {
  if (file.name && file.name !== "image.png" && file.name !== "image") return file;
  const extension = file.type.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "bin";
  return new File([file], `pasted-${now}.${extension}`, {
    type: file.type,
    lastModified: file.lastModified,
  });
}
