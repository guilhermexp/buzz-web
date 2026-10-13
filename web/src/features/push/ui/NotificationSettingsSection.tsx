import { BellOff, BellRing, LoaderCircle } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import { PushPermissionError } from "@/features/push/lib/push-enrollment";
import { DEFAULT_PREFERENCES, type PushPreferences } from "@/features/push/lib/push-store";
import { type PushStatus, usePushEnrollment } from "@/features/push/lib/use-push-enrollment";
import { type MessageKey, t } from "@/shared/i18n";
import { relativeTime } from "@/shared/lib/relative-time";

const STATUS_LABEL: Record<PushStatus, MessageKey> = {
  checking: "push.checking",
  unsupported: "push.statusUnavailable",
  insecure: "push.statusUnavailable",
  "relay-unsupported": "push.statusUnavailable",
  blocked: "push.statusBlocked",
  off: "push.statusOff",
  stale: "push.statusOff",
  on: "push.statusOn",
};

const STATUS_DETAIL: Partial<Record<PushStatus, MessageKey>> = {
  unsupported: "push.unsupported",
  insecure: "push.insecure",
  "relay-unsupported": "push.relayUnsupported",
  blocked: "push.blocked",
  off: "push.offDescription",
  stale: "push.stale",
  on: "push.activeDescription",
};

const ERROR_MESSAGE: Record<string, MessageKey> = {
  "push-too-many-channels": "push.errorTooManyChannels",
};

function errorText(error: unknown): string {
  if (error instanceof PushPermissionError) return error.message;
  if (error instanceof Error && ERROR_MESSAGE[error.message]) {
    return t(ERROR_MESSAGE[error.message]);
  }
  return error instanceof Error && error.message ? error.message : t("push.errorUpdate");
}

/** Settings › Notifications: opt-in browser push for the current community. */
export function NotificationSettingsSection() {
  const { channels, connected } = useWorkspace();
  const push = usePushEnrollment();
  const headingId = useId();
  // Reflect a toggle immediately while the lease republishes; revert on failure.
  const [draft, setDraft] = useState<PushPreferences | null>(null);
  const preferences = draft ?? push.preferences ?? DEFAULT_PREFERENCES;
  const selectable = channels
    .filter((channel) => channel.isMember && !channel.archived && channel.type !== "dm")
    .sort((left, right) => left.name.localeCompare(right.name));
  const detail = STATUS_DETAIL[push.status];
  const canEnable = push.status === "off" || push.status === "stale";
  const offline = !connected;

  const apply = (operation: Promise<void>, success: MessageKey) =>
    operation.then(
      () => toast.success(t(success)),
      (error) => toast.error(errorText(error)),
    );
  const savePreferences = (next: PushPreferences) => {
    setDraft(next);
    void apply(push.updatePreferences(next), "push.updatedToast").finally(() => setDraft(null));
  };

  return (
    <section aria-labelledby={headingId} className="max-w-2xl">
      <h2 className="text-xl font-semibold" id={headingId}>
        {t("push.title")}
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{t("push.description")}</p>

      <div className="mt-6 border-y py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
            {push.status === "on" ? (
              <BellRing aria-hidden className="h-4 w-4" />
            ) : (
              <BellOff aria-hidden className="h-4 w-4 text-muted-foreground" />
            )}
            <span>{t("push.statusLabel")}</span>
            <span
              className="rounded-md border px-2 py-0.5 text-xs text-muted-foreground"
              data-push-status={push.status}
            >
              {t(STATUS_LABEL[push.status])}
            </span>
          </div>
          {push.status === "on" ? (
            <button
              className="inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium hover:bg-foreground/5 disabled:opacity-40"
              disabled={push.busy || offline}
              type="button"
              onClick={() => void apply(push.disable(), "push.disabledToast")}
            >
              {push.busy ? (
                <LoaderCircle aria-hidden className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {push.busy ? t("push.disabling") : t("push.disable")}
            </button>
          ) : canEnable ? (
            <button
              className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-40"
              disabled={push.busy || offline}
              type="button"
              onClick={() => void apply(push.enable(preferences), "push.enabledToast")}
            >
              {push.busy ? (
                <LoaderCircle aria-hidden className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {push.busy ? t("push.enabling") : t("push.enable")}
            </button>
          ) : null}
        </div>
        {detail ? (
          <p className="mt-3 text-xs leading-5 text-muted-foreground">{t(detail)}</p>
        ) : null}
        {push.status === "on" && push.lastReceivedAt ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {t("push.lastReceived", { time: relativeTime(push.lastReceivedAt / 1000) })}
          </p>
        ) : null}
      </div>

      {push.status === "on" ? (
        <fieldset className="mt-6 space-y-5" disabled={push.busy || offline}>
          <p className="text-xs leading-5 text-muted-foreground">{t("push.mentionsAlways")}</p>
          <label className="flex cursor-pointer items-start gap-3">
            <input
              checked={preferences.directMessages}
              className="mt-0.5 h-4 w-4 accent-primary"
              type="checkbox"
              onChange={(event) =>
                savePreferences({ ...preferences, directMessages: event.target.checked })
              }
            />
            <span>
              <span className="block text-sm font-medium">{t("push.directMessages")}</span>
              <span className="block text-xs text-muted-foreground">
                {t("push.directMessagesHint")}
              </span>
            </span>
          </label>
          <div>
            <h3 className="text-sm font-medium">{t("push.channels")}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{t("push.channelsHint")}</p>
            {selectable.length ? (
              <ul className="mt-3 max-h-72 divide-y overflow-y-auto rounded-md border">
                {selectable.map((channel) => {
                  const checked = preferences.channelIds.includes(channel.id);
                  return (
                    <li key={channel.id}>
                      <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-foreground/5">
                        <input
                          checked={checked}
                          className="h-4 w-4 accent-primary"
                          type="checkbox"
                          onChange={() =>
                            savePreferences({
                              ...preferences,
                              channelIds: checked
                                ? preferences.channelIds.filter((id) => id !== channel.id)
                                : [...preferences.channelIds, channel.id],
                            })
                          }
                        />
                        <span className="min-w-0 truncate">{`#${channel.name}`}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">{t("push.noChannels")}</p>
            )}
          </div>
        </fieldset>
      ) : null}
    </section>
  );
}
