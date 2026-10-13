import type { LucideIcon } from "lucide-react";
import { type KeyboardEvent, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type ContextMenuItem =
  | {
      kind?: "item";
      id: string;
      label: string;
      icon: LucideIcon;
      destructive?: boolean;
      onSelect: () => void;
    }
  | { kind: "separator"; id: string };

/**
 * Menu rendered in a body portal at a fixed point (pointer position or the
 * trigger's corner) so sidebars with transforms or overflow never clip it.
 * Focus moves into the menu, arrows cycle items, Escape/Tab close it and
 * focus returns to `returnFocus`.
 */
export function ContextMenu({
  label,
  point,
  items,
  returnFocus,
  onClose,
}: {
  label: string;
  point: { x: number; y: number };
  items: ContextMenuItem[];
  returnFocus: HTMLElement | null;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(point);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    setPosition({
      x: Math.max(8, Math.min(point.x, window.innerWidth - rect.width - 8)),
      y: Math.max(8, Math.min(point.y, window.innerHeight - rect.height - 8)),
    });
    menu.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [point]);

  const close = (restoreFocus: boolean) => {
    onClose();
    if (restoreFocus) returnFocus?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const entries = [
      ...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
    ];
    const index = entries.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      entries[(index + step + entries.length) % entries.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      entries[event.key === "Home" ? 0 : entries.length - 1]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab") {
      close(false);
    }
  };

  return createPortal(
    <>
      <div
        aria-hidden="true"
        className="fixed inset-0 z-[80]"
        onContextMenu={(event) => {
          event.preventDefault();
          close(false);
        }}
        onPointerDown={() => close(false)}
      />
      <div
        ref={menuRef}
        aria-label={label}
        className="fixed z-[81] min-w-52 rounded-lg border border-border/70 bg-popover p-1.5 text-popover-foreground shadow-xl"
        role="menu"
        style={{ left: position.x, top: position.y }}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        {items.map((item) =>
          item.kind === "separator" ? (
            <hr key={item.id} className="my-1 border-0 border-t border-border" />
          ) : (
            <button
              key={item.id}
              className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs outline-none hover:bg-foreground/6 focus-visible:bg-foreground/8 ${item.destructive ? "text-destructive" : ""}`}
              role="menuitem"
              tabIndex={-1}
              type="button"
              onClick={() => {
                close(true);
                item.onSelect();
              }}
            >
              <item.icon
                aria-hidden="true"
                className={`h-4 w-4 ${item.destructive ? "" : "text-muted-foreground"}`}
              />
              {item.label}
            </button>
          ),
        )}
      </div>
    </>,
    document.body,
  );
}
