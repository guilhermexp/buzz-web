import { Clock } from "lucide-react";
import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  localDateInput,
  localTimeInput,
  parseCustomDateTime,
  presetTimestamp,
  REMINDER_PRESETS,
} from "@/features/reminders/lib/reminder-time";
import { t } from "@/shared/i18n";

const MENU_WIDTH = 232;
const MENU_ITEM =
  "flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-xs hover:bg-foreground/6 focus-visible:bg-foreground/6 focus-visible:outline-none";
const FIELD =
  "h-8 min-w-0 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring";

/** One hour ahead, rounded to the minute: a sensible custom-time default. */
function defaultCustom(): { date: string; time: string } {
  const date = new Date(Date.now() + 60 * 60 * 1_000);
  return { date: localDateInput(date), time: localTimeInput(date) };
}

/**
 * Clock button opening Desktop's snooze presets plus a custom date/time. The
 * menu is `position: fixed` so it escapes scrolling list containers.
 */
export function SnoozeMenu({
  disabled,
  onSnooze,
}: {
  disabled: boolean;
  onSnooze: (notBefore: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [custom, setCustom] = useState(defaultCustom);
  const [position, setPosition] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const customTimestamp = parseCustomDateTime(custom.date, custom.time);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      const menuHeight = menuRef.current?.offsetHeight ?? 0;
      if (!trigger) return;
      const left = Math.max(
        8,
        Math.min(trigger.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8),
      );
      const below = trigger.bottom + 4;
      const top =
        below + menuHeight > window.innerHeight - 8
          ? Math.max(8, trigger.top - 4 - menuHeight)
          : below;
      setPosition({ left, top, width: MENU_WIDTH });
    };
    place();
    // The custom date/time form changes the menu height; keep it inside the viewport.
    const resize = new ResizeObserver(place);
    if (menuRef.current) resize.observe(menuRef.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      resize.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  const choose = (notBefore: number) => {
    setOpen(false);
    setCustomOpen(false);
    onSnooze(notBefore);
  };

  return (
    <>
      <button
        ref={triggerRef}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t("collab.reminders.snooze")}
        className="buzz-icon-button h-8 w-8"
        disabled={disabled}
        title={t("collab.reminders.snooze")}
        type="button"
        onClick={() => {
          setCustom(defaultCustom());
          setCustomOpen(false);
          setOpen((value) => !value);
        }}
      >
        <Clock className="h-4 w-4" />
      </button>
      {open ? (
        <div
          ref={menuRef}
          aria-label={t("collab.reminders.snoozeOptions")}
          className="fixed z-[80] overflow-hidden rounded-lg border bg-popover p-1 shadow-xl"
          role="menu"
          style={position}
        >
          {REMINDER_PRESETS.map((preset) => (
            <button
              key={preset}
              className={MENU_ITEM}
              role="menuitem"
              type="button"
              onClick={() => choose(presetTimestamp(preset))}
            >
              {t(`collab.reminders.preset.${preset}`)}
            </button>
          ))}
          <div className="my-1 border-t" />
          <button
            aria-expanded={customOpen}
            className={MENU_ITEM}
            role="menuitem"
            type="button"
            onClick={() => setCustomOpen((value) => !value)}
          >
            {t("collab.reminders.custom")}
          </button>
          {customOpen ? (
            <form
              className="space-y-2 px-2 pt-1 pb-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (customTimestamp !== null) choose(customTimestamp);
              }}
            >
              <p className="text-xs font-medium">{t("collab.reminders.snoozeUntil")}</p>
              <div className="flex gap-1.5">
                <input
                  aria-label={t("collab.reminders.snoozeDate")}
                  className={`${FIELD} flex-1`}
                  min={localDateInput(new Date())}
                  type="date"
                  value={custom.date}
                  onChange={(event) =>
                    setCustom((value) => ({ ...value, date: event.target.value }))
                  }
                />
                <input
                  aria-label={t("collab.reminders.snoozeTime")}
                  className={`${FIELD} w-[5.5rem]`}
                  type="time"
                  value={custom.time}
                  onChange={(event) =>
                    setCustom((value) => ({ ...value, time: event.target.value }))
                  }
                />
              </div>
              {customTimestamp === null ? (
                <p className="text-[11px] text-destructive">
                  {t("collab.reminders.futureRequired")}
                </p>
              ) : null}
              <button
                className="h-8 w-full rounded-md bg-primary text-xs font-medium text-primary-foreground disabled:opacity-40"
                disabled={customTimestamp === null}
                type="submit"
              >
                {t("collab.reminders.snooze")}
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
