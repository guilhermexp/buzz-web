import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import type { TimelineMessage } from "@/features/chat/lib/chat-types";
import { DialogFrame } from "@/features/chat/ui/AppDialogs";
import { t } from "@/shared/i18n";

export function EditMessageDialog({
  message,
  onClose,
  onSave,
}: {
  message: TimelineMessage;
  onClose: () => void;
  onSave: (content: string) => Promise<void>;
}) {
  const [content, setContent] = useState(message.content);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <DialogFrame title={t("message.edit")} onClose={onClose}>
      <form
        className="space-y-4 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!content.trim() || content === message.content) return;
          setSaving(true);
          setError(null);
          void onSave(content)
            .then(onClose)
            .catch((saveError) =>
              setError(saveError instanceof Error ? saveError.message : t("error.messageEdit")),
            )
            .finally(() => setSaving(false));
        }}
      >
        <label className="block text-xs font-medium">
          {t("message.content")}
          <textarea
            className="mt-1.5 min-h-36 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm leading-6 outline-none focus:ring-2 focus:ring-primary/30"
            maxLength={65_536}
            value={content}
            onChange={(event) => setContent(event.target.value)}
          />
        </label>
        {error ? (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 border-t pt-4">
          <button
            className="h-9 rounded-md px-3 text-sm hover:bg-foreground/5"
            type="button"
            onClick={onClose}
          >
            {t("common.cancel")}
          </button>
          <button
            className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-40"
            disabled={!content.trim() || content === message.content || saving}
            type="submit"
          >
            {saving ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t("common.save")}
          </button>
        </div>
      </form>
    </DialogFrame>
  );
}

export function DeleteMessageDialog({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <DialogFrame title={t("message.delete")} onClose={onClose}>
      <div className="space-y-4 p-4">
        <p className="text-sm leading-6 text-muted-foreground">{t("message.deleteConfirm")}</p>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2 border-t pt-4">
          <button
            className="h-9 rounded-md px-3 text-sm hover:bg-foreground/5"
            type="button"
            onClick={onClose}
          >
            {t("common.cancel")}
          </button>
          <button
            className="inline-flex h-9 items-center rounded-md bg-destructive px-3 text-sm font-medium text-destructive-foreground disabled:opacity-40"
            disabled={deleting}
            type="button"
            onClick={() => {
              setDeleting(true);
              setError(null);
              void onConfirm()
                .then(onClose)
                .catch((deleteError) =>
                  setError(
                    deleteError instanceof Error ? deleteError.message : t("error.messageDelete"),
                  ),
                )
                .finally(() => setDeleting(false));
            }}
          >
            {deleting ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t("message.delete")}
          </button>
        </div>
      </div>
    </DialogFrame>
  );
}
