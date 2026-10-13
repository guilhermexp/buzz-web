import { LoaderCircle, X } from "lucide-react";
import { useEffect, useState } from "react";
import { t } from "@/shared/i18n";

export function DialogFrame({
  title,
  children,
  onClose,
  closeOnEscape = true,
  width = "max-w-lg",
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  closeOnEscape?: boolean;
  width?: string;
}) {
  useEffect(() => {
    if (!closeOnEscape) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeOnEscape, onClose]);
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
      role="presentation"
    >
      <section
        aria-label={title}
        aria-modal="true"
        className={`max-h-[85dvh] w-full ${width} overflow-hidden rounded-lg border bg-popover shadow-2xl`}
        role="dialog"
      >
        <header className="flex h-13 items-center justify-between border-b px-4">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button
            aria-label={t("common.close")}
            className="buzz-icon-button"
            title={t("common.close")}
            type="button"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

export type CreateChannelInput = {
  name: string;
  description: string;
  type: "stream" | "forum";
  visibility: "open" | "private";
};

export function CreateChannelForm({
  allowForum,
  onCancel,
  onCreate,
}: {
  allowForum: boolean;
  onCancel: () => void;
  onCreate: (input: CreateChannelInput) => Promise<unknown>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<"stream" | "forum">("stream");
  const [visibility, setVisibility] = useState<"open" | "private">("open");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-4 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) return;
        setSubmitting(true);
        setError(null);
        void onCreate({ name, description, type, visibility })
          .catch((createError) =>
            setError(createError instanceof Error ? createError.message : t("error.channelCreate")),
          )
          .finally(() => setSubmitting(false));
      }}
    >
      <label className="block text-xs font-medium">
        {t("dialog.channelName")}
        <input
          className="mt-1.5 h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          maxLength={80}
          placeholder={t("dialog.channelExample")}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="block text-xs font-medium">
        {t("dialog.channelSummary")}
        <textarea
          className="mt-1.5 min-h-20 w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          maxLength={500}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs font-medium">
          {t("dialog.channelType")}
          <select
            className="mt-1.5 h-9 w-full rounded-md border bg-background px-2 text-sm"
            value={type}
            onChange={(event) => setType(event.target.value as "stream" | "forum")}
          >
            <option value="stream">{t("dialog.channelTypeStream")}</option>
            {allowForum ? <option value="forum">{t("dialog.channelTypeForum")}</option> : null}
          </select>
        </label>
        <label className="block text-xs font-medium">
          {t("dialog.channelVisibility")}
          <select
            className="mt-1.5 h-9 w-full rounded-md border bg-background px-2 text-sm"
            value={visibility}
            onChange={(event) => setVisibility(event.target.value as "open" | "private")}
          >
            <option value="open">{t("dialog.visibilityOpen")}</option>
            <option value="private">{t("dialog.visibilityPrivate")}</option>
          </select>
        </label>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <div className="flex justify-end gap-2 border-t pt-4">
        <button
          className="h-9 rounded-md px-3 text-sm hover:bg-foreground/5"
          type="button"
          onClick={onCancel}
        >
          {t("common.cancel")}
        </button>
        <button
          className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-40"
          disabled={!name.trim() || submitting}
          type="submit"
        >
          {submitting ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
          {t("common.create")}
        </button>
      </div>
    </form>
  );
}
