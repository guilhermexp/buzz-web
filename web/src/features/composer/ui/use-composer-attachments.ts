import { useCallback, useRef, useState } from "react";
import type { AttachmentDescriptor } from "@/features/chat/lib/chat-types";
import {
  MAX_COMPOSER_ATTACHMENTS,
  namedClipboardFile,
  triageComposerFiles,
} from "@/features/composer/lib/attachment-intake";
import type { LocalVoiceNote, PendingUpload } from "@/features/composer/ui/AttachmentTray";
import { uploadAttachment } from "@/shared/api/media-client";
import { t } from "@/shared/i18n";

export type ComposerNotice = { id: string; message: string };

const errorText = (error: unknown) =>
  error instanceof Error && error.message ? error.message : t("error.attachmentUpload");

/**
 * Attachment state for one composer: Relay uploads (picker, paste, drop) through the existing
 * sanitizer, content-only GIFs, and a local voice note that is uploaded exactly once, at send.
 */
export function useComposerAttachments(relayUrl: string, initial: AttachmentDescriptor[]) {
  const [attachments, setAttachments] = useState<AttachmentDescriptor[]>(initial);
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [notices, setNotices] = useState<ComposerNotice[]>([]);
  const [voiceNote, setVoiceNoteState] = useState<LocalVoiceNote | null>(null);
  const voiceUpload = useRef<{ file: File; descriptor: AttachmentDescriptor } | null>(null);
  const countRef = useRef(initial.length);
  countRef.current = attachments.length + uploads.length;

  const notify = useCallback((messages: string[]) => {
    if (!messages.length) return;
    setNotices((current) => [
      ...current,
      ...messages.map((message) => ({ id: crypto.randomUUID(), message })),
    ]);
  }, []);

  const addFiles = useCallback(
    async (files: readonly File[]) => {
      const { accepted, rejected } = triageComposerFiles(files, countRef.current);
      notify(rejected.map(({ name, reason }) => t("composer.fileRejected", { name, reason })));
      const queued = accepted.map((file) => ({
        id: crypto.randomUUID(),
        file: namedClipboardFile(file),
      }));
      if (!queued.length) return;
      countRef.current += queued.length;
      setUploads((current) => [
        ...current,
        ...queued.map(({ id, file }) => ({ id, name: file.name })),
      ]);
      for (const { id, file } of queued) {
        try {
          const descriptor = await uploadAttachment(file, relayUrl);
          setAttachments((current) =>
            current.some((item) => item.sha256 === descriptor.sha256)
              ? current
              : [...current, descriptor].slice(0, MAX_COMPOSER_ATTACHMENTS),
          );
        } catch (error) {
          notify([t("composer.fileRejected", { name: file.name, reason: errorText(error) })]);
        } finally {
          setUploads((current) => current.filter((upload) => upload.id !== id));
        }
      }
    },
    [notify, relayUrl],
  );

  const setVoiceNote = useCallback((next: LocalVoiceNote | null) => {
    if (voiceUpload.current && voiceUpload.current.file !== next?.file) voiceUpload.current = null;
    setVoiceNoteState(next);
  }, []);

  /** Upload the local voice note once; a retried send after a publish failure reuses it. */
  const uploadVoiceNote = useCallback(async (): Promise<AttachmentDescriptor | null> => {
    if (!voiceNote) return null;
    if (voiceUpload.current?.file === voiceNote.file) return voiceUpload.current.descriptor;
    const uploaded = await uploadAttachment(voiceNote.file, relayUrl);
    const descriptor: AttachmentDescriptor = {
      ...uploaded,
      type: voiceNote.file.type || uploaded.type,
      filename: voiceNote.file.name,
      duration: Math.round(voiceNote.durationSeconds * 100) / 100,
    };
    voiceUpload.current = { file: voiceNote.file, descriptor };
    return descriptor;
  }, [relayUrl, voiceNote]);

  const reset = useCallback((next: AttachmentDescriptor[] = []) => {
    setAttachments(next);
    setVoiceNoteState(null);
    voiceUpload.current = null;
    setNotices([]);
  }, []);

  /**
   * Swap the visible media for a send in flight (`[]`, `null`) or back after it failed. The
   * voice upload cache survives so a retried send reuses the already uploaded voice note.
   */
  const replaceMedia = useCallback(
    (next: AttachmentDescriptor[], nextVoiceNote: LocalVoiceNote | null) => {
      setAttachments(next);
      setVoiceNoteState(nextVoiceNote);
      setNotices([]);
    },
    [],
  );

  return {
    attachments,
    setAttachments,
    uploads,
    notices,
    notify,
    dismissNotice: (id: string) =>
      setNotices((current) => current.filter((notice) => notice.id !== id)),
    addFiles,
    voiceNote,
    setVoiceNote,
    uploadVoiceNote,
    reset,
    replaceMedia,
  };
}
