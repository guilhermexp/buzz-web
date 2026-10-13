import { Check, Copy, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import buzzAppIcon from "@/assets/app-icon@3x.png";
import type { SavedCommunity } from "@/features/workspace/lib/saved-communities";
import { ContextMenu, type ContextMenuItem } from "@/features/workspace/ui/ContextMenu";
import { getLocale, t } from "@/shared/i18n";

export type CommunityControls = {
  communities: SavedCommunity[];
  activeId: string;
  removableIds: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRemove: (community: SavedCommunity) => void;
};

export function communityInitials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const initials = words
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join("");
  return (initials || name.charAt(0) || "B").toLocaleUpperCase(getLocale());
}

/** Desktop-style community rail (md+): one button per saved community. */
export function CommunityRail({
  controls,
  connectionDot,
}: {
  controls: CommunityControls;
  connectionDot: React.ReactNode;
}) {
  const [menu, setMenu] = useState<{
    community: SavedCommunity;
    point: { x: number; y: number };
    trigger: HTMLElement;
  } | null>(null);
  const menuItems = (community: SavedCommunity): ContextMenuItem[] => [
    {
      id: "copy",
      label: t("workspace.community.copyUrl"),
      icon: Copy,
      onSelect: () =>
        void navigator.clipboard
          .writeText(community.relayUrl)
          .then(() => toast.success(t("workspace.community.urlCopied")))
          .catch(() => toast.error(t("workspace.copyFailed"))),
    },
    ...(controls.removableIds.has(community.id)
      ? [
          { kind: "separator" as const, id: "separator" },
          {
            id: "remove",
            label: t("workspace.community.remove"),
            icon: Trash2,
            destructive: true,
            onSelect: () => controls.onRemove(community),
          },
        ]
      : []),
  ];

  return (
    <nav
      aria-label={t("workspace.community.rail")}
      className="hidden w-12 shrink-0 flex-col items-center gap-2 overflow-y-auto py-2 md:flex"
    >
      <img alt="Buzz" className="h-8 w-8 rounded-lg" src={buzzAppIcon} />
      <div className="mt-1 flex flex-col items-center gap-2">
        {controls.communities.map((community) => {
          const active = community.id === controls.activeId;
          return (
            <button
              key={community.id}
              aria-current={active ? "true" : undefined}
              aria-label={community.name}
              className="group relative flex h-9 w-9 items-center justify-center"
              title={`${community.name}\n${community.relayUrl}`}
              type="button"
              onClick={() => controls.onSelect(community.id)}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({
                  community,
                  point: { x: event.clientX, y: event.clientY },
                  trigger: event.currentTarget,
                });
              }}
            >
              {active ? (
                <span
                  aria-hidden="true"
                  className="absolute -left-1.5 h-5 w-1 rounded-r-full bg-primary"
                />
              ) : null}
              <span
                className={`flex h-9 w-9 items-center justify-center rounded-xl text-xs font-semibold transition-colors ${active ? "bg-background text-foreground shadow-sm" : "bg-background/45 text-foreground/75 group-hover:bg-background/75"}`}
              >
                {communityInitials(community.name)}
              </span>
            </button>
          );
        })}
        <button
          aria-label={t("workspace.community.add")}
          className="flex h-9 w-9 items-center justify-center rounded-2xl bg-background/45 text-foreground/70 transition-all hover:rounded-xl hover:bg-background/80"
          title={t("workspace.community.add")}
          type="button"
          onClick={controls.onAdd}
        >
          <Plus className="h-[18px] w-[18px]" />
        </button>
      </div>
      <div className="mt-auto pb-1">{connectionDot}</div>
      {menu ? (
        <ContextMenu
          items={menuItems(menu.community)}
          label={t("workspace.community.actions", { name: menu.community.name })}
          point={menu.point}
          returnFocus={menu.trigger}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </nav>
  );
}

/** Community entries for the profile menu (works at every width, incl. mobile). */
export function CommunityMenuItems({
  controls,
  onDone,
}: {
  controls: CommunityControls;
  onDone: () => void;
}) {
  return (
    <div>
      {controls.communities.map((community) => {
        const active = community.id === controls.activeId;
        return (
          <button
            key={community.id}
            aria-checked={active}
            className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs hover:bg-foreground/6"
            role="menuitemradio"
            type="button"
            onClick={() => {
              onDone();
              if (!active) controls.onSelect(community.id);
            }}
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-foreground/8 text-[9px] font-semibold">
              {communityInitials(community.name)}
            </span>
            <span className="min-w-0 flex-1 truncate">{community.name}</span>
            {active ? <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0" /> : null}
          </button>
        );
      })}
      <button
        className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs hover:bg-foreground/6"
        role="menuitem"
        type="button"
        onClick={() => {
          onDone();
          controls.onAdd();
        }}
      >
        <Plus aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
        {t("workspace.community.add")}
      </button>
    </div>
  );
}
