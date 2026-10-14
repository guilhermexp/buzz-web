import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { cn } from "@/shared/lib/cn";

/**
 * A disclosure button with an anchored panel for the huddle dock. Closes on
 * Escape (returning focus to the trigger) and on outside pointer presses.
 */
export function DockPopover({
  label,
  icon,
  className,
  panelClassName,
  children,
}: {
  label: string;
  icon: ReactNode;
  className?: string;
  panelClassName?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        aria-label={label}
        className={cn("buzz-icon-button", className)}
        title={label}
        type="button"
        onClick={() => setOpen((value) => !value)}
      >
        {icon}
      </button>
      {open ? (
        <div
          id={panelId}
          className={cn(
            "absolute right-0 top-full z-40 mt-1.5 rounded-lg border bg-popover p-2 text-popover-foreground shadow-lg",
            panelClassName,
          )}
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}
