import { CalendarClock, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DialogFrame } from "@/features/chat/ui/AppDialogs";
import type { ReminderTarget } from "@/features/reminders/lib/reminder-codec";
import { createReminder } from "@/features/reminders/lib/reminder-store";
import {
  localDateInput,
  localTimeInput,
  parseCustomDateTime,
  presetTimestamp,
  REMINDER_PRESETS,
} from "@/features/reminders/lib/reminder-time";
import type { ReminderSession } from "@/features/reminders/lib/use-reminders";
import { t } from "@/shared/i18n";

const FIELD =
  "h-9 min-w-0 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";
/** The Relay rejects `not_before` more than a year ahead (default horizon). */
const MAX_HORIZON_DAYS = 364;

export function RemindMeDialog({
  session,
  target,
  onClose,
}: {
  session: ReminderSession;
  target: ReminderTarget;
  onClose: () => void;
}) {
  const [note, setNote] = useState("");
  const [date, setDate] = useState(() => localDateInput(new Date()));
  const [time, setTime] = useState(() => localTimeInput(new Date(Date.now() + 60 * 60 * 1_000)));
  const [pending, setPending] = useState(false);
  const customTimestamp = parseCustomDateTime(date, time);

  const submit = (notBefore: number) => {
    if (pending) return;
    setPending(true);
    createReminder(session.client, session.store, { target, notBefore, note })
      .then(() => {
        toast.success(t("collab.reminders.created"));
        onClose();
      })
      .catch((error: unknown) => {
        toast.error(t("collab.reminders.createFailed"), {
          description: error instanceof Error ? error.message.slice(0, 200) : undefined,
        });
      })
      .finally(() => setPending(false));
  };

  return (
    <DialogFrame
      title={t("collab.reminders.remindMeLater")}
      width="max-w-[400px]"
      onClose={onClose}
    >
      <form
        className="space-y-4 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (customTimestamp !== null) submit(customTimestamp);
        }}
      >
        <p className="text-sm text-muted-foreground">{t("collab.reminders.dialogDescription")}</p>
        <div className="flex flex-col gap-1.5">
          {REMINDER_PRESETS.map((preset) => (
            <button
              key={preset}
              className="h-9 rounded-md border px-3 text-left text-sm hover:bg-foreground/5 disabled:opacity-50"
              disabled={pending}
              type="button"
              onClick={() => submit(presetTimestamp(preset))}
            >
              {t(`collab.reminders.preset.${preset}`)}
            </button>
          ))}
        </div>
        <div className="space-y-2 border-t pt-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <CalendarClock className="h-4 w-4 text-muted-foreground" />
            {t("collab.reminders.customDateTime")}
          </p>
          <div className="flex gap-2">
            <input
              aria-label={t("collab.reminders.reminderDate")}
              className={`${FIELD} flex-1`}
              max={localDateInput(new Date(Date.now() + MAX_HORIZON_DAYS * 86_400_000))}
              min={localDateInput(new Date())}
              disabled={pending}
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
            <input
              aria-label={t("collab.reminders.reminderTime")}
              className={`${FIELD} w-[7.5rem]`}
              disabled={pending}
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
            />
          </div>
          {customTimestamp === null ? (
            <p className="text-xs text-destructive">{t("collab.reminders.futureRequired")}</p>
          ) : null}
        </div>
        <label className="block text-xs font-medium text-muted-foreground">
          {t("collab.reminders.note")}
          <textarea
            className="mt-1.5 w-full resize-none rounded-md border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/30"
            disabled={pending}
            maxLength={2_000}
            placeholder={t("collab.reminders.notePlaceholder")}
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <div className="flex justify-between gap-2 border-t pt-4">
          <button
            className="h-9 rounded-md px-3 text-sm hover:bg-foreground/5 disabled:opacity-50"
            disabled={pending}
            type="button"
            onClick={onClose}
          >
            {t("common.cancel")}
          </button>
          <button
            className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-40"
            disabled={pending || customTimestamp === null}
            type="submit"
          >
            {pending ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t("collab.reminders.setReminder")}
          </button>
        </div>
      </form>
    </DialogFrame>
  );
}
