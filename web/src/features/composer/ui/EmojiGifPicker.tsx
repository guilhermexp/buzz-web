import { SmilePlus } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { CustomEmoji } from "@/features/composer/lib/custom-emoji";
import type { RelayGif, RelayGifCapability } from "@/features/composer/lib/gif-api";
import { CustomEmojiManager } from "@/features/composer/ui/CustomEmojiManager";
import { EmojiPanel } from "@/features/composer/ui/EmojiPanel";
import { GifPanel, useRelayGifCapability } from "@/features/composer/ui/GifPanel";
import type { BuzzRelayClient } from "@/shared/api/relay-client";
import { type MessageKey, t } from "@/shared/i18n";

type Tab = "emoji" | "gif" | "manage";

const TAB_LABELS = {
  emoji: "composer.emojiTab",
  gif: "composer.gifTab",
  manage: "composer.customManageTab",
} as const satisfies Record<Tab, MessageKey>;

/** Composer emoji/GIF popover (desktop ComposerEmojiPicker), anchored above the composer. */
export function EmojiGifPicker({
  relayUrl,
  pubkey,
  demo,
  disabled,
  gifDisabled,
  customEmoji,
  client,
  onEmoji,
  onGif,
  onClose,
}: {
  relayUrl: string;
  pubkey: string;
  demo: boolean;
  disabled: boolean;
  gifDisabled: boolean;
  customEmoji: readonly CustomEmoji[];
  client: BuzzRelayClient | null;
  onEmoji: (value: string) => void;
  onGif: (gif: RelayGif, capability: RelayGifCapability) => void;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("emoji");
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const capability = useRelayGifCapability(relayUrl, !demo);
  const label = capability.data ? t("composer.insertEmojiOrGif") : t("composer.insertEmoji");
  // Managing the caller's own emoji set needs a live Relay session (not the demo fixture).
  const tabs: Tab[] = client && !demo ? ["emoji", "gif", "manage"] : ["emoji", "gif"];

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [open]);

  const close = () => {
    setOpen(false);
    onClose();
  };

  return (
    <div ref={rootRef} className="static">
      <button
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={label}
        className="buzz-icon-button"
        data-testid="composer-emoji-button"
        disabled={disabled}
        title={capability.data ? t("composer.emojiPicker") : t("composer.emojiTab")}
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <SmilePlus className="h-4 w-4" />
      </button>
      {open ? (
        <div
          aria-label={t("composer.emojiPicker")}
          className="absolute bottom-full right-0 z-50 mb-1 flex h-[min(24rem,60vh)] w-[min(22rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg"
          id={panelId}
          role="dialog"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
          }}
        >
          <div className="flex border-b border-border/60 px-2 pt-1.5" role="tablist">
            {tabs.map((id) => (
              <button
                key={id}
                aria-controls={`${panelId}-${id}`}
                aria-selected={tab === id}
                className={`-mb-px border-b-2 px-3 py-1.5 text-xs font-medium ${tab === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                id={`${panelId}-tab-${id}`}
                role="tab"
                type="button"
                onClick={() => setTab(id)}
              >
                {t(TAB_LABELS[id])}
              </button>
            ))}
          </div>
          <div
            aria-labelledby={`${panelId}-tab-${tab}`}
            className="flex min-h-0 flex-1 flex-col"
            id={`${panelId}-${tab}`}
            role="tabpanel"
          >
            {tab === "emoji" ? (
              <EmojiPanel
                customEmoji={customEmoji}
                pubkey={pubkey}
                relayUrl={relayUrl}
                onSelect={(value) => {
                  setOpen(false);
                  onEmoji(value);
                }}
              />
            ) : tab === "manage" && client ? (
              <CustomEmojiManager client={client} pubkey={pubkey} relayUrl={relayUrl} />
            ) : gifDisabled ? (
              <p className="flex-1 px-4 py-8 text-center text-xs leading-5 text-muted-foreground">
                {t("composer.gifVoiceNoteConflict")}
              </p>
            ) : (
              <GifPanel
                pubkey={pubkey}
                relayUrl={relayUrl}
                onSelect={(gif, available) => {
                  setOpen(false);
                  onGif(gif, available);
                }}
              />
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
