import { Bell, Check, ChevronDown, ChevronRight, Clock, ExternalLink, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import {
  groupReminders,
  hasNavigableTarget,
  type Reminder,
  type ReminderTransition,
} from "@/features/reminders/lib/reminder-codec";
import { transitionReminder } from "@/features/reminders/lib/reminder-store";
import { type ReminderSession, useReminderSession } from "@/features/reminders/lib/use-reminders";
import {
  authorName,
  formatAbsoluteSeconds,
  formatRelativeSeconds,
  reminderHeadline,
  reminderLocation,
  useOpenReminderTarget,
} from "@/features/reminders/ui/reminder-presentation";
import { SnoozeMenu } from "@/features/reminders/ui/SnoozeMenu";
import { type MessageKey, t } from "@/shared/i18n";

type Outcome = { success: MessageKey; failure: MessageKey };

const OUTCOMES: Record<ReminderTransition["status"], Outcome> = {
  pending: { success: "collab.reminders.snoozed", failure: "collab.reminders.snoozeFailed" },
  done: { success: "collab.reminders.completed", failure: "collab.reminders.completeFailed" },
  cancelled: { success: "collab.reminders.cancelled", failure: "collab.reminders.cancelFailed" },
};

function Notice({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="px-5 py-14 text-center">
      <Bell className="mx-auto h-8 w-8 text-muted-foreground/50" />
      <p className="mt-3 text-sm text-muted-foreground">{title}</p>
      {detail ? <p className="mt-1 text-xs text-muted-foreground/80">{detail}</p> : null}
    </div>
  );
}

function ReminderRow({
  reminder,
  now,
  busy,
  onTransition,
}: {
  reminder: Reminder;
  now: number;
  busy: boolean;
  onTransition: (reminder: Reminder, transition: ReminderTransition) => void;
}) {
  const { channels, profiles, pubkey } = useWorkspace();
  const openTarget = useOpenReminderTarget();
  const target = reminder.content.target;
  const navigable = hasNavigableTarget(target);
  const pending = reminder.content.status === "pending";
  const due = pending && reminder.notBefore !== undefined && reminder.notBefore <= now;
  const headline = reminderHeadline(reminder);
  return (
    <li
      aria-label={headline}
      className="flex gap-3 border-b px-3 py-3 transition-colors hover:bg-foreground/[0.035] sm:px-4"
    >
      <span
        className={`mt-0.5 hidden h-8 w-8 shrink-0 items-center justify-center rounded-full sm:flex ${
          due ? "bg-primary/12 text-primary" : "bg-muted text-muted-foreground"
        }`}
      >
        <Bell className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        {navigable ? (
          <p className="truncate text-[11px] text-muted-foreground">
            {t("collab.reminders.source", {
              author: authorName(target.authorPubkey, profiles),
              location: reminderLocation(target.channelId, channels, profiles, pubkey),
            })}
          </p>
        ) : null}
        <p className="mt-0.5 line-clamp-2 break-words text-[13px] leading-5 font-medium">
          {headline}
        </p>
        {target && reminder.content.note ? (
          <p className="mt-1 line-clamp-2 break-words text-xs text-muted-foreground">
            {reminder.content.note}
          </p>
        ) : null}
        <div className="mt-1 flex items-center justify-between gap-2">
          <p
            className={`flex min-w-0 items-center gap-1 text-[11px] ${
              due ? "font-medium text-destructive" : "text-muted-foreground"
            }`}
            title={
              reminder.notBefore !== undefined
                ? formatAbsoluteSeconds(reminder.notBefore)
                : undefined
            }
          >
            <Clock className="h-3 w-3 shrink-0" />
            <span className="truncate">
              {pending && reminder.notBefore !== undefined
                ? t("collab.reminders.dueRelative", {
                    relative: formatRelativeSeconds(reminder.notBefore, now),
                  })
                : t("collab.reminders.completedRelative", {
                    relative: formatRelativeSeconds(reminder.createdAt, now),
                  })}
            </span>
          </p>
          <div className="-mr-1.5 flex shrink-0 items-center gap-0.5">
            {navigable ? (
              <button
                aria-label={t("collab.reminders.openMessage")}
                className="buzz-icon-button h-8 w-8"
                title={t("collab.reminders.openMessage")}
                type="button"
                onClick={() => void openTarget(target)}
              >
                <ExternalLink className="h-4 w-4" />
              </button>
            ) : null}
            {pending ? (
              <>
                <button
                  aria-label={t("collab.reminders.complete")}
                  className="buzz-icon-button h-8 w-8"
                  disabled={busy}
                  title={t("collab.reminders.complete")}
                  type="button"
                  onClick={() => onTransition(reminder, { status: "done" })}
                >
                  <Check className="h-4 w-4" />
                </button>
                <SnoozeMenu
                  disabled={busy}
                  onSnooze={(notBefore) => onTransition(reminder, { status: "pending", notBefore })}
                />
                <button
                  aria-label={t("collab.reminders.cancel")}
                  className="buzz-icon-button h-8 w-8"
                  disabled={busy}
                  title={t("collab.reminders.cancel")}
                  type="button"
                  onClick={() => onTransition(reminder, { status: "cancelled" })}
                >
                  <X className="h-4 w-4" />
                </button>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </li>
  );
}

function ReminderGroup({
  label,
  reminders,
  ...row
}: {
  label: string;
  reminders: readonly Reminder[];
  now: number;
  busyIds: ReadonlySet<string>;
  onTransition: (reminder: Reminder, transition: ReminderTransition) => void;
}) {
  if (!reminders.length) return null;
  return (
    <section aria-label={label}>
      <h3 className="px-3 pt-4 pb-1.5 text-xs font-semibold text-muted-foreground sm:px-4">
        {label}
      </h3>
      <ul>
        {reminders.map((reminder) => (
          <ReminderRow
            key={reminder.id}
            busy={row.busyIds.has(reminder.id)}
            now={row.now}
            reminder={reminder}
            onTransition={row.onTransition}
          />
        ))}
      </ul>
    </section>
  );
}

function ReminderLists({ session }: { session: ReminderSession }) {
  const { ensureProfiles } = useWorkspace();
  const { snapshot } = session;
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const [showCompleted, setShowCompleted] = useState(false);
  const groups = useMemo(
    () => groupReminders(snapshot.reminders, snapshot.now),
    [snapshot.reminders, snapshot.now],
  );
  const authorKey = snapshot.reminders
    .map((reminder) => reminder.content.target?.authorPubkey ?? "")
    .filter(Boolean)
    .sort()
    .join(",");
  useEffect(() => {
    if (authorKey) void ensureProfiles([...new Set(authorKey.split(","))]);
  }, [authorKey, ensureProfiles]);

  const onTransition = (reminder: Reminder, transition: ReminderTransition) => {
    const outcome = OUTCOMES[transition.status];
    setBusyIds((ids) => new Set(ids).add(reminder.id));
    transitionReminder(session.client, session.store, reminder, transition)
      .then(() => toast.success(t(outcome.success)))
      .catch((error: unknown) =>
        toast.error(t(outcome.failure), {
          description: error instanceof Error ? error.message.slice(0, 200) : undefined,
        }),
      )
      .finally(() =>
        setBusyIds((ids) => {
          const next = new Set(ids);
          next.delete(reminder.id);
          return next;
        }),
      );
  };

  if (snapshot.status === "unsupported") {
    return <Notice title={snapshot.error ?? t("collab.reminders.loadFailed")} />;
  }
  const empty = !groups.due.length && !groups.upcoming.length && !groups.completed.length;
  const row = { now: snapshot.now, busyIds, onTransition };
  return (
    <>
      {snapshot.status === "error" ? (
        <div className="border-b bg-destructive/8 px-3 py-2 text-xs text-destructive" role="alert">
          {t("collab.reminders.loadFailed")}
          {snapshot.error ? `: ${snapshot.error.slice(0, 200)}` : ""}
        </div>
      ) : null}
      {snapshot.status === "loading" && empty ? (
        <div aria-busy="true" className="space-y-px">
          <span className="sr-only" role="status">
            {t("collab.reminders.loading")}
          </span>
          {[0, 1, 2].map((index) => (
            <div key={index} className="flex gap-3 border-b px-4 py-3">
              <div className="h-8 w-8 animate-pulse rounded-full bg-muted" />
              <div className="flex-1 space-y-2 py-0.5">
                <div className="h-2.5 w-1/3 animate-pulse rounded bg-muted" />
                <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {snapshot.status === "ready" && empty ? (
        <Notice title={t("collab.reminders.empty")} detail={t("collab.reminders.emptyHint")} />
      ) : null}
      <ReminderGroup label={t("collab.reminders.groupDue")} reminders={groups.due} {...row} />
      <ReminderGroup
        label={t("collab.reminders.groupUpcoming")}
        reminders={groups.upcoming}
        {...row}
      />
      {groups.completed.length ? (
        <section>
          <button
            aria-expanded={showCompleted}
            className="flex h-9 w-full items-center gap-1.5 px-3 pt-2 text-left text-xs font-semibold text-muted-foreground hover:text-foreground sm:px-4"
            type="button"
            onClick={() => setShowCompleted((value) => !value)}
          >
            {showCompleted ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            {t("collab.reminders.groupCompleted", { count: groups.completed.length })}
          </button>
          {showCompleted ? (
            <ul>
              {groups.completed.map((reminder) => (
                <ReminderRow
                  key={reminder.id}
                  busy={false}
                  now={snapshot.now}
                  reminder={reminder}
                  onTransition={onTransition}
                />
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

/** Inbox "Reminders" section: due, upcoming and completed reminders with their actions. */
export function InboxReminders() {
  const session = useReminderSession();
  return (
    <section
      aria-label={t("collab.reminders.title")}
      className="buzz-scrollbar min-h-0 flex-1 overflow-y-auto pb-4"
    >
      {session ? (
        <ReminderLists session={session} />
      ) : (
        <Notice title={t("collab.reminders.demoUnavailable")} />
      )}
    </section>
  );
}
