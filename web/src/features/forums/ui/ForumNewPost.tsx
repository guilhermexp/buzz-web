import { X } from "lucide-react";
import { useId, useState } from "react";
import type { BuzzChannel, UserProfile } from "@/features/chat/lib/chat-types";
import { conversationDraftKey } from "@/features/chat/lib/conversation-drafts";
import { MessageComposer } from "@/features/chat/ui/MessageComposer";
import type { ComposerSendExtras } from "@/features/composer/lib/send-extras";
import type { ForumChannelData } from "@/features/forums/lib/use-forum-channel";
import { t } from "@/shared/i18n";

/** Title + Markdown body; the composer's send publishes a kind 45001 post. */
export function ForumNewPost({
  channel,
  pubkey,
  profiles,
  relayUrl,
  createPost,
  onClose,
}: {
  channel: BuzzChannel;
  pubkey: string;
  profiles: Record<string, UserProfile>;
  relayUrl: string;
  createPost: ForumChannelData["createPost"];
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const titleId = useId();
  return (
    <section
      aria-label={t("collab.forums.newPost")}
      className="shrink-0 border-b bg-foreground/[0.015]"
    >
      <div className="mx-auto w-full max-w-[880px]">
        <div className="flex items-center justify-between px-3 pt-3 sm:px-4">
          <h2 className="text-sm font-semibold">{t("collab.forums.newPost")}</h2>
          <button
            aria-label={t("collab.forums.cancelPost")}
            className="buzz-icon-button"
            title={t("collab.forums.cancelPost")}
            type="button"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-3 pt-2 pb-2 sm:px-4">
          <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor={titleId}>
            {t("collab.forums.title")}
          </label>
          <input
            // biome-ignore lint/a11y/noAutofocus: opened by an explicit "New post" action.
            autoFocus
            className="h-9 w-full rounded-md border bg-background px-3 text-sm font-medium outline-none focus:ring-2 focus:ring-primary/30"
            id={titleId}
            maxLength={300}
            placeholder={t("collab.forums.titlePlaceholder")}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
            }}
          />
        </div>
        <MessageComposer
          draftKey={conversationDraftKey(relayUrl, pubkey, channel.id)}
          members={channel.members}
          placeholder={t("collab.forums.bodyPlaceholder")}
          profiles={profiles}
          relayUrl={relayUrl}
          onSend={async (content, attachments, extras?: ComposerSendExtras) => {
            await createPost(title, content, attachments, extras);
            onClose();
          }}
          onTyping={() => undefined}
        />
      </div>
    </section>
  );
}
