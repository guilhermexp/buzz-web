import { FileText, ImageIcon, LoaderCircle, X } from "lucide-react";
import type { AttachmentDescriptor } from "@/features/chat/lib/chat-types";
import { VoiceNoteAttachment } from "@/features/voice/ui/VoiceNoteAttachment";
import { t } from "@/shared/i18n";

export type PendingUpload = { id: string; name: string };
export type LocalVoiceNote = { file: File; durationSeconds: number };

/** Draft attachments: uploaded files, in-flight uploads and the local (unsent) voice note. */
export function AttachmentTray({
  attachments,
  uploads,
  voiceNote,
  onRemoveAttachment,
  onRemoveVoiceNote,
}: {
  attachments: AttachmentDescriptor[];
  uploads: PendingUpload[];
  voiceNote: LocalVoiceNote | null;
  onRemoveAttachment: (attachment: AttachmentDescriptor) => void;
  onRemoveVoiceNote: () => void;
}) {
  if (!attachments.length && !uploads.length && !voiceNote) return null;
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2" data-testid="composer-attachments">
      {attachments.map((attachment) => {
        const Icon = attachment.type.startsWith("image/") ? ImageIcon : FileText;
        return (
          <span
            key={attachment.sha256 || attachment.url}
            className="inline-flex max-w-56 items-center gap-1.5 rounded bg-foreground/7 px-2 py-1 text-xs"
          >
            <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{attachment.filename || t("message.attachment")}</span>
            <button
              aria-label={t("message.removeAttachment")}
              className="rounded p-0.5 hover:bg-foreground/10"
              type="button"
              onClick={() => onRemoveAttachment(attachment)}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        );
      })}
      {uploads.map((upload) => (
        <span
          key={upload.id}
          aria-live="polite"
          className="inline-flex max-w-56 items-center gap-1.5 rounded bg-foreground/5 px-2 py-1 text-xs text-muted-foreground"
        >
          <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 shrink-0 animate-spin" />
          <span className="truncate">{t("composer.uploading", { name: upload.name })}</span>
        </span>
      ))}
      {voiceNote ? (
        <VoiceNoteAttachment
          durationSeconds={voiceNote.durationSeconds}
          source={{ file: voiceNote.file }}
          onRemove={onRemoveVoiceNote}
        />
      ) : null}
    </div>
  );
}
