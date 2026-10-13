import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, LoaderCircle, Trash2 } from "lucide-react";
import { type FormEvent, useId, useRef, useState } from "react";
import {
  CUSTOM_EMOJI_SET_D_TAG,
  CUSTOM_EMOJI_SET_KIND,
  type CustomEmoji,
  customEmojiFromTags,
  normalizeShortcode,
  ownEmojiSetTemplate,
  suggestShortcode,
} from "@/features/composer/lib/custom-emoji";
import { customEmojiQueryKey } from "@/features/composer/lib/use-custom-emoji";
import { CustomEmojiImage } from "@/features/composer/ui/CustomEmojiImage";
import { uploadAttachment } from "@/shared/api/media-client";
import type { NostrEvent } from "@/shared/api/nostr-types";
import type { BuzzRelayClient } from "@/shared/api/relay-client";
import { t } from "@/shared/i18n";

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Manage the caller's own NIP-30 `buzz:custom-emoji` set (desktop CustomEmojiSettingsCard):
 * upload an image through the sanitizer, then read-modify-write the replaceable kind 30030.
 */
export function CustomEmojiManager({
  client,
  relayUrl,
  pubkey,
}: {
  client: BuzzRelayClient;
  relayUrl: string;
  pubkey: string;
}) {
  const queryClient = useQueryClient();
  const fileId = useId();
  const nameId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<{ error: boolean; message: string } | null>(null);
  const ownKey = ["composer", "own-custom-emoji", relayUrl, pubkey.toLowerCase()];
  const loadOwn = async (): Promise<CustomEmoji[]> => {
    const events = await client.query({
      kinds: [CUSTOM_EMOJI_SET_KIND],
      authors: [pubkey],
      "#d": [CUSTOM_EMOJI_SET_D_TAG],
      limit: 1,
    });
    const latest = events.sort((left, right) => right.created_at - left.created_at)[0];
    return latest ? customEmojiFromTags(latest.tags) : [];
  };
  const own = useQuery({ queryKey: ownKey, queryFn: loadOwn });

  const publish = async (change: { add: CustomEmoji } | { remove: string }) => {
    // Re-read right before writing so a set changed on another device is not clobbered.
    const current = await loadOwn();
    const { event } = await client.publish(ownEmojiSetTemplate(current, change));
    queryClient.setQueryData(ownKey, customEmojiFromTags(event.tags));
    queryClient.setQueryData<NostrEvent[]>(customEmojiQueryKey(relayUrl, pubkey), (events = []) => [
      ...events.filter((item) => item.pubkey !== event.pubkey),
      event,
    ]);
  };

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!file?.type.startsWith("image/")) {
      setStatus({ error: true, message: t("composer.customImageRequired") });
      return;
    }
    const shortcode = normalizeShortcode(name);
    if (!shortcode) {
      setStatus({ error: true, message: t("composer.customInvalidName") });
      return;
    }
    setBusy("add");
    setStatus(null);
    try {
      const uploaded = await uploadAttachment(file, relayUrl);
      await publish({ add: { shortcode, url: uploaded.url } });
      setStatus({ error: false, message: t("composer.customAdded", { shortcode }) });
      setFile(null);
      setName("");
      if (fileRef.current) fileRef.current.value = "";
    } catch (error) {
      setStatus({ error: true, message: t("composer.customFailed", { reason: reason(error) }) });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (shortcode: string) => {
    setBusy(shortcode);
    setStatus(null);
    try {
      await publish({ remove: shortcode });
      setStatus({ error: false, message: t("composer.customRemoved", { shortcode }) });
    } catch (error) {
      setStatus({ error: true, message: t("composer.customFailed", { reason: reason(error) }) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="buzz-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 text-sm">
      <form className="flex flex-col gap-2" onSubmit={(event) => void add(event)}>
        <h3 className="text-xs font-medium text-muted-foreground">
          {t("composer.customAddTitle")}
        </h3>
        <label className="sr-only" htmlFor={fileId}>
          {t("composer.customImage")}
        </label>
        <input
          ref={fileRef}
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="hidden"
          id={fileId}
          type="file"
          onChange={(event) => {
            const next = event.target.files?.[0] ?? null;
            setFile(next);
            if (next && !name) setName(suggestShortcode(next.name));
          }}
        />
        <button
          className="flex h-8 items-center gap-2 rounded-md border border-border/80 px-2 text-left text-xs hover:bg-foreground/5"
          type="button"
          onClick={() => fileRef.current?.click()}
        >
          <ImagePlus aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{file ? file.name : t("composer.customChooseImage")}</span>
        </button>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor={nameId}>
            {t("composer.customName")}
          </label>
          <input
            className="h-8 min-w-0 flex-1 rounded-md border border-border/80 bg-background px-2 text-sm outline-none focus:border-ring/60"
            id={nameId}
            maxLength={66}
            placeholder={t("composer.customName")}
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <button
            className="flex h-8 items-center gap-1.5 rounded-md bg-foreground px-3 text-xs font-medium text-background disabled:opacity-40"
            disabled={busy !== null}
            type="submit"
          >
            {busy === "add" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
            {t("composer.customAdd")}
          </button>
        </div>
      </form>
      {status ? (
        <p
          className={`text-xs ${status.error ? "text-destructive" : "text-muted-foreground"}`}
          role={status.error ? "alert" : "status"}
        >
          {status.message}
        </p>
      ) : null}
      <section className="flex flex-col gap-1">
        <h3 className="text-xs font-medium text-muted-foreground">{t("composer.customMine")}</h3>
        {own.isPending ? (
          <LoaderCircle className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : own.isError ? (
          <p className="text-xs text-destructive">{reason(own.error)}</p>
        ) : own.data.length ? (
          <ul className="flex flex-col">
            {own.data.map((emoji) => (
              <li key={emoji.shortcode} className="flex items-center gap-2 py-1">
                <CustomEmojiImage
                  className="h-6 w-6 object-contain"
                  relayUrl={relayUrl}
                  shortcode={emoji.shortcode}
                  url={emoji.url}
                />
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{`:${emoji.shortcode}:`}</span>
                <button
                  aria-label={t("composer.customRemove", { shortcode: emoji.shortcode })}
                  className="buzz-icon-button h-7 w-7"
                  disabled={busy !== null}
                  title={t("composer.customRemove", { shortcode: emoji.shortcode })}
                  type="button"
                  onClick={() => void remove(emoji.shortcode)}
                >
                  {busy === emoji.shortcode ? (
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">{t("composer.customNone")}</p>
        )}
      </section>
    </div>
  );
}
