import { useState } from "react";
import { DialogFrame } from "@/features/chat/ui/AppDialogs";
import type { SavedCommunity } from "@/features/workspace/lib/saved-communities";
import { t } from "@/shared/i18n";

const INPUT_CLASS =
  "mt-1.5 h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30";

export function AddCommunityDialog({
  onAdd,
  onClose,
}: {
  /** Throws a localized error for an invalid Relay URL. */
  onAdd: (input: { name: string; relayUrl: string }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [relayUrl, setRelayUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <DialogFrame title={t("workspace.community.add")} onClose={onClose}>
      <form
        className="space-y-3 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          try {
            onAdd({ name, relayUrl });
            onClose();
          } catch (addError) {
            setError(addError instanceof Error ? addError.message : t("error.relayUrlInvalid"));
          }
        }}
      >
        <p className="text-xs leading-5 text-muted-foreground">
          {t("workspace.community.addDescription")}
        </p>
        <label className="block text-xs font-medium">
          {t("workspace.community.relayUrl")}
          <input
            autoComplete="url"
            className={`${INPUT_CLASS} font-mono text-xs`}
            inputMode="url"
            placeholder={t("workspace.community.relayUrlPlaceholder")}
            spellCheck={false}
            value={relayUrl}
            onChange={(event) => setRelayUrl(event.target.value)}
          />
        </label>
        <label className="block text-xs font-medium">
          {t("workspace.community.name")}
          <input
            className={INPUT_CLASS}
            maxLength={80}
            placeholder={t("workspace.community.namePlaceholder")}
            value={name}
            onChange={(event) => setName(event.target.value)}
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
            className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-40"
            disabled={!relayUrl.trim()}
            type="submit"
          >
            {t("workspace.community.addAction")}
          </button>
        </div>
      </form>
    </DialogFrame>
  );
}

export function RemoveCommunityDialog({
  community,
  onConfirm,
  onClose,
}: {
  community: SavedCommunity;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <DialogFrame title={t("workspace.community.remove")} onClose={onClose}>
      <div className="space-y-4 p-4">
        <p className="text-sm leading-6 text-muted-foreground">
          {t("workspace.community.removeConfirm", { name: community.name })}
        </p>
        <div className="flex justify-end gap-2 border-t pt-4">
          <button
            className="h-9 rounded-md px-3 text-sm hover:bg-foreground/5"
            type="button"
            onClick={onClose}
          >
            {t("common.cancel")}
          </button>
          <button
            className="h-9 rounded-md bg-destructive px-3 text-sm font-medium text-destructive-foreground"
            type="button"
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {t("workspace.community.removeAction")}
          </button>
        </div>
      </div>
    </DialogFrame>
  );
}
