import { ChevronDown, ChevronRight, Ellipsis } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useId, useState } from "react";
import type { BuzzChannel } from "@/features/chat/lib/chat-types";
import { ContextMenu, type ContextMenuItem } from "@/features/workspace/ui/ContextMenu";
import { t } from "@/shared/i18n";

export function sidebarRowClass(active: boolean, unread = false): string {
  return `flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2.5 text-left text-[13px] transition-colors ${
    active
      ? "bg-foreground/10 font-semibold text-foreground"
      : unread
        ? "font-semibold text-foreground hover:bg-foreground/5"
        : "text-foreground/85 hover:bg-foreground/5"
  }`;
}

export type SidebarRow = {
  channel: BuzzChannel;
  /** Visible label; also the row's accessible name. */
  name: string;
  selected: boolean;
  unreadCount: number;
  leading: ReactNode;
  trailing: ReactNode;
};

/**
 * A collapsible sidebar section of channel rows. Each row offers a context
 * menu (right click / long press, the row's actions button or Shift+F10) and
 * Alt+ArrowUp/Down to reorder within the section.
 */
export function SidebarChannelSection({
  title,
  collapsed,
  headerActions,
  rows,
  menuItemsFor,
  onToggleCollapsed,
  onSelect,
  onMove,
}: {
  title: string;
  collapsed: boolean;
  headerActions?: ReactNode;
  rows: SidebarRow[];
  menuItemsFor: (row: SidebarRow) => ContextMenuItem[];
  onToggleCollapsed: () => void;
  onSelect: (channelId: string) => void;
  /** Returns the new index, or null when the row cannot move further. */
  onMove: (channelId: string, delta: -1 | 1) => number | null;
}) {
  const listId = useId();
  const [menu, setMenu] = useState<{
    row: SidebarRow;
    point: { x: number; y: number };
    trigger: HTMLElement;
  } | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const openMenuAt = (row: SidebarRow, trigger: HTMLElement, point?: { x: number; y: number }) => {
    const rect = trigger.getBoundingClientRect();
    setMenu({ row, trigger, point: point ?? { x: rect.left + 8, y: rect.bottom + 2 } });
  };

  const onRowKeyDown = (event: KeyboardEvent<HTMLButtonElement>, row: SidebarRow) => {
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      const index = onMove(row.channel.id, event.key === "ArrowUp" ? -1 : 1);
      if (index !== null) {
        setAnnouncement(
          t("workspace.sidebar.moved", { name: row.name, position: index + 1, total: rows.length }),
        );
        // Keep focus on the moved row after React reorders the list.
        const button = event.currentTarget;
        requestAnimationFrame(() => button.focus());
      }
    } else if ((event.shiftKey && event.key === "F10") || event.key === "ContextMenu") {
      event.preventDefault();
      openMenuAt(row, event.currentTarget);
    }
  };

  return (
    <section className="mt-4">
      <div className="group/section mb-0.5 flex h-7 items-center justify-between pl-1 pr-1.5">
        <button
          aria-controls={listId}
          aria-expanded={!collapsed}
          className="flex h-6 min-w-0 items-center gap-1 rounded px-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
          type="button"
          onClick={onToggleCollapsed}
        >
          {collapsed ? (
            <ChevronRight aria-hidden="true" className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronDown aria-hidden="true" className="h-3 w-3 shrink-0" />
          )}
          <span className="truncate">{title}</span>
        </button>
        {headerActions ? <span className="flex items-center gap-0.5">{headerActions}</span> : null}
      </div>
      {collapsed ? null : (
        <ul className="space-y-px" id={listId}>
          {rows.map((row) => (
            <li key={row.channel.id} className="group/row relative flex items-center">
              <button
                aria-label={row.name}
                aria-pressed={row.selected}
                className={`${sidebarRowClass(row.selected, row.unreadCount > 0)} pr-8`}
                title={
                  row.unreadCount > 0
                    ? t("nav.unreadIn", { count: row.unreadCount, name: row.name })
                    : undefined
                }
                type="button"
                onClick={() => onSelect(row.channel.id)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  openMenuAt(row, event.currentTarget, { x: event.clientX, y: event.clientY });
                }}
                onKeyDown={(event) => onRowKeyDown(event, row)}
              >
                {row.leading}
                <span className="min-w-0 flex-1 truncate">{row.name}</span>
                {row.trailing}
              </button>
              <button
                aria-haspopup="menu"
                aria-label={t("workspace.sidebar.channelActions", { name: row.name })}
                className="buzz-icon-button absolute right-1 h-6 w-6 flex-none opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100 max-md:opacity-100"
                title={t("workspace.sidebar.channelActions", { name: row.name })}
                type="button"
                onClick={(event) => openMenuAt(row, event.currentTarget)}
              >
                <Ellipsis className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>
      {menu ? (
        <ContextMenu
          items={menuItemsFor(menu.row)}
          label={t("workspace.sidebar.channelActions", { name: menu.row.name })}
          point={menu.point}
          returnFocus={menu.trigger}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </section>
  );
}
