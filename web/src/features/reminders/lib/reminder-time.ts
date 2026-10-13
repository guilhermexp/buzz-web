/** Desktop's reminder presets (create dialog and snooze menu share them). */
export const REMINDER_PRESETS = [
  "in30Minutes",
  "in1Hour",
  "in3Hours",
  "tomorrow9",
  "nextMonday9",
] as const;

export type ReminderPreset = (typeof REMINDER_PRESETS)[number];

/** `dayOffset` days from `now` at 09:00 local; rolls a day forward if that is not in the future. */
function dayAtNine(now: Date, dayOffset: number): number {
  const target = new Date(now);
  target.setDate(target.getDate() + dayOffset);
  target.setHours(9, 0, 0, 0);
  if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
  return Math.floor(target.getTime() / 1_000);
}

/** Unix seconds for a preset, always strictly after `now`. */
export function presetTimestamp(preset: ReminderPreset, now: Date = new Date()): number {
  const seconds = Math.floor(now.getTime() / 1_000);
  switch (preset) {
    case "in30Minutes":
      return seconds + 30 * 60;
    case "in1Hour":
      return seconds + 60 * 60;
    case "in3Hours":
      return seconds + 3 * 60 * 60;
    case "tomorrow9":
      return dayAtNine(now, 1);
    case "nextMonday9":
      return dayAtNine(now, (8 - now.getDay()) % 7 || 7);
  }
}

/** `YYYY-MM-DD` / `HH:MM` of a local date, for native date/time inputs. */
export function localDateInput(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function localTimeInput(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/**
 * Local `YYYY-MM-DD` + `HH:MM[:SS]` → Unix seconds, or null when malformed or not
 * strictly after `now` (a past time would otherwise fire immediately).
 */
export function parseCustomDateTime(
  date: string,
  time: string,
  now: Date = new Date(),
): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}(:\d{2})?$/.test(time)) return null;
  const milliseconds = new Date(`${date}T${time}`).getTime();
  if (Number.isNaN(milliseconds) || milliseconds <= now.getTime()) return null;
  return Math.floor(milliseconds / 1_000);
}
