import { Loader2, Paperclip, X } from "lucide-react";
import {
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { detectMentionQuery, type MentionQuery } from "@/features/chat/lib/composer-mentions";
import { Avatar } from "@/features/chat/ui/Avatar";
import {
  type ComposerMentionCandidate,
  MentionAutocomplete,
} from "@/features/chat/ui/MentionAutocomplete";
import { filesFromDataTransfer } from "@/features/composer/lib/attachment-intake";
import { selectedMentionLabel } from "@/features/composer/lib/mention-bindings";
import { AttachmentTray } from "@/features/composer/ui/AttachmentTray";
import { useComposerAttachments } from "@/features/composer/ui/use-composer-attachments";
import { type ComposedNote, composeNote } from "@/features/pulse/lib/pulse-compose";
import { MAX_NOTE_BYTES, utf8Length } from "@/features/pulse/lib/pulse-events";
import { usePulseSession } from "@/features/pulse/ui/pulse-context";
import type { NostrEvent } from "@/shared/api/nostr-types";
import { t } from "@/shared/i18n";

const MAX_SUGGESTIONS = 8;

/**
 * Note or reply composer (desktop ForumComposer in Pulse): `@` mentions of me,
 * my follows and agents, Relay media uploads, and length feedback against the
 * Relay's 64 KiB content cap.
 */
export function PulseComposer({
  parent = null,
  autoFocus = false,
  onPosted,
  onCancel,
}: {
  parent?: NostrEvent | null;
  autoFocus?: boolean;
  onPosted?: (note: NostrEvent) => void;
  onCancel?: () => void;
}) {
  const { me, relayUrl, profile, publishNote, mentionCandidates } = usePulseSession();
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [mention, setMention] = useState<MentionQuery | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const bindings = useRef(new Map<string, string>());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Caret after an inserted mention, applied in the same commit so fast typing
  // never lands before it (a deferred frame can run after further keystrokes).
  const pendingCaret = useRef<number | null>(null);
  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    if (caret === null || !textareaRef.current) return;
    pendingCaret.current = null;
    textareaRef.current.focus();
    textareaRef.current.setSelectionRange(caret, caret);
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const files = useComposerAttachments(relayUrl, []);
  const counterId = useId();
  const listId = useId();
  const trimmed = content.trim();
  const hasMedia = files.attachments.length > 0;
  const overBy = utf8Length(trimmed) - MAX_NOTE_BYTES;
  const canSend =
    (trimmed.length > 0 || hasMedia) && overBy <= 0 && !sending && !files.uploads.length;
  const label = parent
    ? t("collab.pulse.reply.placeholder")
    : t("collab.pulse.composer.placeholder");

  const suggestions = useMemo<ComposerMentionCandidate[]>(() => {
    if (!mention) return [];
    const query = mention.query.trim().toLocaleLowerCase();
    return mentionCandidates
      .filter((candidate) => candidate.profile.name.toLocaleLowerCase().includes(query))
      .slice(0, MAX_SUGGESTIONS);
  }, [mention, mentionCandidates]);
  const knownNames = useMemo(
    () => mentionCandidates.map((candidate) => candidate.profile.name),
    [mentionCandidates],
  );

  const updateMention = (value: string, cursor: number) => {
    setMention(detectMentionQuery(value, cursor, knownNames));
    setSelectedIndex(0);
  };

  const selectMention = (candidate: ComposerMentionCandidate) => {
    if (!mention) return;
    const mentionLabel = selectedMentionLabel(
      candidate.profile.name,
      candidate.pubkey,
      bindings.current,
    );
    bindings.current.set(mentionLabel, candidate.pubkey);
    const inserted = `@${mentionLabel} `;
    const next = content.slice(0, mention.startIndex) + inserted + content.slice(mention.endIndex);
    const cursor = mention.startIndex + inserted.length;
    setContent(next);
    setMention(null);
    pendingCaret.current = cursor;
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!canSend) return;
    let note: ComposedNote;
    try {
      note = composeNote(
        trimmed,
        files.attachments,
        bindings.current,
        mentionCandidates.map((candidate) => ({
          displayName: candidate.profile.name,
          pubkey: candidate.pubkey,
        })),
      );
    } catch (mentionError) {
      toast.error(t("collab.pulse.error.publish"), {
        description: mentionError instanceof Error ? mentionError.message : undefined,
      });
      return;
    }
    if (utf8Length(note.content) > MAX_NOTE_BYTES) {
      toast.error(
        t("collab.pulse.composer.tooLong", { count: utf8Length(note.content) - MAX_NOTE_BYTES }),
      );
      return;
    }
    setSending(true);
    try {
      const published = await publishNote(note.content, {
        parent,
        mentions: note.mentions,
        mediaTags: note.mediaTags,
      });
      setContent("");
      setMention(null);
      bindings.current = new Map();
      files.reset();
      onPosted?.(published);
    } catch (error) {
      toast.error(t("collab.pulse.error.publish"), {
        description: error instanceof Error ? error.message.slice(0, 200) : undefined,
      });
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setSelectedIndex((index) => (index + step + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        selectMention(suggestions[Math.min(selectedIndex, suggestions.length - 1)]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMention(null);
        return;
      }
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit();
    } else if (event.key === "Escape" && onCancel) {
      event.preventDefault();
      onCancel();
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = filesFromDataTransfer(event.clipboardData);
    if (!pasted.length) return;
    event.preventDefault();
    void files.addFiles(pasted);
  };

  const activeId =
    suggestions.length > 0
      ? `${listId}-${suggestions[Math.min(selectedIndex, suggestions.length - 1)]?.pubkey}`
      : undefined;

  return (
    <form
      className={
        parent
          ? "mt-3 rounded-xl border bg-background/60 p-2.5"
          : "rounded-2xl border bg-background/80 p-3 shadow-xs"
      }
      onSubmit={submit}
    >
      <div className="flex items-start gap-2.5">
        {parent ? null : <Avatar profile={profile(me)} relayUrl={relayUrl} size={32} />}
        <div className="relative min-w-0 flex-1">
          <textarea
            ref={textareaRef}
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            aria-controls={suggestions.length ? listId : undefined}
            aria-describedby={counterId}
            aria-label={label}
            // biome-ignore lint/a11y/noAutofocus: opening the reply composer is an explicit request to type.
            autoFocus={autoFocus}
            className="min-h-[3.25rem] w-full resize-y bg-transparent py-1.5 text-sm leading-relaxed outline-none placeholder:text-muted-foreground"
            disabled={sending}
            placeholder={label}
            rows={parent ? 2 : 3}
            value={content}
            onBlur={() => setMention(null)}
            onChange={(event) => {
              setContent(event.target.value);
              updateMention(event.target.value, event.target.selectionStart);
            }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onSelect={(event) =>
              updateMention(event.currentTarget.value, event.currentTarget.selectionStart)
            }
          />
          {/* The shared list opens upward; inside a scrolling feed it must open below the field. */}
          <div className="relative [&>div]:top-0 [&>div]:bottom-auto [&>div]:mb-0">
            <MentionAutocomplete
              candidates={suggestions}
              listId={listId}
              relayUrl={relayUrl}
              selectedIndex={selectedIndex}
              onSelect={selectMention}
            />
          </div>
        </div>
      </div>
      <div className="mt-2">
        <AttachmentTray
          attachments={files.attachments}
          uploads={files.uploads}
          voiceNote={null}
          onRemoveAttachment={(attachment) =>
            files.setAttachments((current) => current.filter((item) => item !== attachment))
          }
          onRemoveVoiceNote={() => files.setVoiceNote(null)}
        />
      </div>
      {files.notices.map((notice) => (
        <p
          key={notice.id}
          className="mb-1.5 flex items-start gap-1.5 text-xs text-destructive"
          role="alert"
        >
          <span className="min-w-0 flex-1 break-words">{notice.message}</span>
          <button
            aria-label={t("composer.dismissError")}
            className="rounded p-0.5 hover:bg-foreground/10"
            type="button"
            onClick={() => files.dismissNotice(notice.id)}
          >
            <X className="h-3 w-3" />
          </button>
        </p>
      ))}
      <div className="flex items-center justify-end gap-2">
        <input
          ref={fileRef}
          className="hidden"
          multiple
          type="file"
          onChange={(event) => {
            void files.addFiles([...(event.target.files ?? [])]);
            event.target.value = "";
          }}
        />
        <button
          aria-label={t("message.addAttachment")}
          className="buzz-icon-button h-8 w-8"
          disabled={sending}
          title={t("message.addAttachment")}
          type="button"
          onClick={() => fileRef.current?.click()}
        >
          {files.uploads.length ? (
            <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          ) : (
            <Paperclip aria-hidden className="h-4 w-4" />
          )}
        </button>
        <span
          aria-live="polite"
          className={`mr-auto text-xs tabular-nums ${overBy > 0 ? "font-medium text-destructive" : "text-muted-foreground"}`}
          id={counterId}
        >
          {overBy > 0
            ? t("collab.pulse.composer.tooLong", { count: overBy.toLocaleString() })
            : t("collab.pulse.composer.length", { count: [...trimmed].length.toLocaleString() })}
        </span>
        {onCancel ? (
          <button
            className="h-8 rounded-md px-3 text-xs font-medium text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
            type="button"
            onClick={onCancel}
          >
            {t("collab.pulse.reply.cancel")}
          </button>
        ) : null}
        <button
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          disabled={!canSend}
          type="submit"
        >
          {sending ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : null}
          {sending
            ? t("collab.pulse.composer.posting")
            : parent
              ? t("collab.pulse.reply.submit")
              : t("collab.pulse.composer.post")}
        </button>
      </div>
    </form>
  );
}
