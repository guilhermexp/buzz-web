import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import { DialogFrame } from "@/features/chat/ui/AppDialogs";
import { t } from "@/shared/i18n";

export function ForumDeleteDialog({
  kind,
  onClose,
  onConfirm,
}: {
  kind: "post" | "reply";
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isPost = kind === "post";
  return (
    <DialogFrame
      title={t(isPost ? "collab.forums.deletePostTitle" : "collab.forums.deleteReplyTitle")}
      onClose={onClose}
    >
      <div className="space-y-4 p-4">
        <p className="text-sm leading-6 text-muted-foreground">
          {t(isPost ? "collab.forums.deletePostConfirm" : "collab.forums.deleteReplyConfirm")}
        </p>
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
            className="inline-flex h-9 items-center rounded-md bg-destructive px-3 text-sm font-medium text-destructive-foreground disabled:opacity-40"
            disabled={deleting}
            type="button"
            onClick={() => {
              setDeleting(true);
              setError(null);
              void onConfirm()
                .then(onClose)
                .catch((deleteError: unknown) => {
                  setError(
                    deleteError instanceof Error
                      ? deleteError.message
                      : t("collab.forums.error.delete"),
                  );
                  setDeleting(false);
                });
            }}
          >
            {deleting ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t(isPost ? "collab.forums.deletePost" : "collab.forums.deleteReply")}
          </button>
        </div>
      </div>
    </DialogFrame>
  );
}
