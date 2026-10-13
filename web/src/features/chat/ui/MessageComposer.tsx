import { EditorContent } from "@tiptap/react";
import { ALargeSmall, CornerUpLeft, LoaderCircle, Paperclip, Send, X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { contentWithAttachments, fallbackProfile } from "@/features/chat/lib/chat-model";
import type {
  AttachmentDescriptor,
  ChannelMember,
  UserProfile,
} from "@/features/chat/lib/chat-types";
import {
  type ConversationDraft,
  clearConversationDraft,
  readConversationDraft,
  writeConversationDraft,
} from "@/features/chat/lib/conversation-drafts";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import {
  type ComposerMentionCandidate,
  MentionAutocomplete,
} from "@/features/chat/ui/MentionAutocomplete";
import { dragHasFiles } from "@/features/composer/lib/attachment-intake";
import { customEmojiTags } from "@/features/composer/lib/custom-emoji";
import {
  clearComposer,
  composerHasText,
  composerMarkdown,
  refreshMentionHighlights,
} from "@/features/composer/lib/editor-extensions";
import {
  appendEditorMention,
  type EditorMentionQuery,
  editorMentionQuery,
  insertEditorMention,
  insertEditorText,
} from "@/features/composer/lib/editor-mentions";
import { gifAttachment, reportRelayGifShare } from "@/features/composer/lib/gif-api";
import {
  extractMentionPubkeys,
  pruneMentionBindings,
  selectedMentionLabel,
} from "@/features/composer/lib/mention-bindings";
import type { ComposerSendExtras } from "@/features/composer/lib/send-extras";
import { useCustomEmojiPalette } from "@/features/composer/lib/use-custom-emoji";
import { AttachmentTray } from "@/features/composer/ui/AttachmentTray";
import { EmojiGifPicker } from "@/features/composer/ui/EmojiGifPicker";
import { FormattingBar } from "@/features/composer/ui/FormattingBar";
import { LinkEditor } from "@/features/composer/ui/LinkEditor";
import { useComposerAttachments } from "@/features/composer/ui/use-composer-attachments";
import { useComposerEditor } from "@/features/composer/ui/use-composer-editor";
import "@/features/composer/ui/composer.css";
import { ComposerVoiceNote } from "@/features/voice/ui/ComposerVoiceNote";
import { t } from "@/shared/i18n";

const EMPTY_DRAFT: ConversationDraft = { content: "", attachments: [] };

export function MessageComposer({
  relayUrl,
  placeholder,
  disabled,
  compact = false,
  draftKey,
  insertMention,
  members = [],
  profiles = {},
  replyTarget,
  onMentionInserted,
  onCancelReply,
  onTyping,
  onSend,
}: {
  relayUrl: string;
  placeholder: string;
  disabled?: boolean;
  compact?: boolean;
  draftKey?: string;
  insertMention?: string | null;
  members?: ChannelMember[];
  profiles?: Record<string, UserProfile>;
  replyTarget?: { id: string; author: string; body: string } | null;
  onMentionInserted?: () => void;
  onCancelReply?: () => void;
  onTyping: () => void;
  onSend: (
    content: string,
    attachments: AttachmentDescriptor[],
    extras: ComposerSendExtras,
  ) => Promise<void>;
}) {
  const { client, demo, pubkey } = useWorkspace();
  const initialDraft = useMemo(
    () => (draftKey ? readConversationDraft(draftKey) : EMPTY_DRAFT),
    [draftKey],
  );
  const files = useComposerAttachments(relayUrl, initialDraft.attachments);
  const customEmoji = useCustomEmojiPalette(demo ? null : client, relayUrl, pubkey);
  const [hasText, setHasText] = useState(Boolean(initialDraft.content.trim()));
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formattingOpen, setFormattingOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<EditorMentionQuery | null>(null);
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
  const bindings = useRef(new Map<string, string>(initialDraft.mentions ?? []));
  const draftTimer = useRef<number | null>(null);
  const draftDirty = useRef(false);
  const focusFrame = useRef<number | null>(null);
  const activeDraftKey = useRef(draftKey);
  const mentionListId = useId();
  const fileRef = useRef<HTMLInputElement>(null);

  const mentionCandidates = useMemo<ComposerMentionCandidate[]>(
    () =>
      members.map((member) => {
        const key = member.pubkey.toLowerCase();
        return { pubkey: key, profile: profiles[key] ?? fallbackProfile(key), role: member.role };
      }),
    [members, profiles],
  );
  const mentionMatches = useMemo(() => {
    if (!mentionQuery) return [];
    const query = mentionQuery.query.trim().toLocaleLowerCase();
    return mentionCandidates
      .filter((candidate) => candidate.profile.name.toLocaleLowerCase().includes(query))
      .sort(
        (left, right) =>
          Number(right.profile.name.toLocaleLowerCase().startsWith(query)) -
          Number(left.profile.name.toLocaleLowerCase().startsWith(query)),
      )
      .slice(0, 12);
  }, [mentionCandidates, mentionQuery]);

  const busy = sending || files.uploads.length > 0 || recording;
  const canSend =
    !disabled && !busy && (hasText || files.attachments.length > 0 || files.voiceNote !== null);

  const state = useRef({ mentionMatches, mentionSelectedIndex, mentionQuery });
  state.current = { mentionMatches, mentionSelectedIndex, mentionQuery };
  const sendingRef = useRef(false);
  const submitRef = useRef<() => void>(() => undefined);
  const selectMentionRef = useRef<(candidate: ComposerMentionCandidate) => void>(() => undefined);

  const editor = useComposerEditor({
    initialMarkdown: initialDraft.content,
    ariaLabel: placeholder,
    ariaAutocomplete: mentionMatches.length
      ? {
          controls: mentionListId,
          activeDescendant: `${mentionListId}-${mentionMatches[mentionSelectedIndex]?.pubkey}`,
        }
      : {},
    editable: !disabled && !sending,
    compact,
    callbacks: {
      placeholder: () => placeholder,
      submit: () => {
        submitRef.current();
        return true;
      },
      autocompleteOpen: () => state.current.mentionMatches.length > 0,
      linkShortcut: () => {
        setFormattingOpen(true);
        setLinkOpen(true);
        return true;
      },
      boundMentionLabels: () => [...bindings.current.keys()],
      files: (incoming) => void files.addFiles(incoming),
      keyDown: (event) => {
        const { mentionMatches: matches, mentionSelectedIndex: index } = state.current;
        if (event.isComposing) return false;
        if (matches.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
          setMentionSelectedIndex((current) =>
            event.key === "ArrowDown"
              ? (current + 1) % matches.length
              : (current - 1 + matches.length) % matches.length,
          );
          return true;
        }
        if (matches.length && (event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
          const selected = matches[index];
          if (selected) selectMentionRef.current(selected);
          return true;
        }
        if (event.key === "Escape" && state.current.mentionQuery) {
          setMentionQuery(null);
          return true;
        }
        return false;
      },
      change: (current, docChanged) => {
        const names = mentionCandidates.map((candidate) => candidate.profile.name);
        const query = editorMentionQuery(current, names);
        // Like desktop, only typing opens suggestions. A caret move may follow or close an open
        // list but never reopens one: a restored draft ending in a picked mention would
        // otherwise turn the next Enter into a re-pick instead of a send.
        setMentionQuery((open) => (docChanged || open ? query : null));
        if (!docChanged) return;
        setMentionSelectedIndex(0);
        const text = composerHasText(current);
        setHasText(text);
        if (text) onTyping();
        draftDirty.current = true;
        if (draftTimer.current) window.clearTimeout(draftTimer.current);
        draftTimer.current = window.setTimeout(() => saveDraftRef.current(), 250);
      },
    },
  });

  const saveDraftRef = useRef<() => void>(() => undefined);
  saveDraftRef.current = () => {
    const key = activeDraftKey.current;
    if (!key || editor.isDestroyed) return;
    draftDirty.current = false;
    const content = composerMarkdown(editor);
    writeConversationDraft(key, {
      content,
      attachments: files.attachments,
      mentions: [...pruneMentionBindings(content, bindings.current)],
    });
  };

  // Attachment changes are draft changes too.
  // biome-ignore lint/correctness/useExhaustiveDependencies: saving reads the latest refs.
  useEffect(() => {
    if (activeDraftKey.current === draftKey) saveDraftRef.current();
  }, [files.attachments]);

  // A reused composer (thread panel) switching conversations saves the old scope and
  // restores the new one, so drafts never leak between conversations.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a scope change triggers this.
  useEffect(() => {
    if (activeDraftKey.current === draftKey) return;
    saveDraftRef.current();
    activeDraftKey.current = draftKey;
    bindings.current = new Map(initialDraft.mentions ?? []);
    editor.commands.setContent(initialDraft.content, { emitUpdate: false });
    files.reset(initialDraft.attachments);
    setHasText(composerHasText(editor));
    setMentionQuery(null);
    setError(null);
  }, [draftKey]);

  useEffect(
    () => () => {
      if (draftTimer.current) window.clearTimeout(draftTimer.current);
      if (focusFrame.current !== null) window.cancelAnimationFrame(focusFrame.current);
      if (draftDirty.current) saveDraftRef.current();
    },
    [],
  );

  selectMentionRef.current = (candidate) => {
    const query = state.current.mentionQuery;
    if (!query) return;
    const label = selectedMentionLabel(candidate.profile.name, candidate.pubkey, bindings.current);
    bindings.current.set(label, candidate.pubkey);
    insertEditorMention(editor, query, label);
    refreshMentionHighlights(editor);
    setMentionQuery(null);
    setMentionSelectedIndex(0);
  };

  submitRef.current = () => {
    if (sendingRef.current || disabled || busy) return;
    // Read the document, not `hasText`: Enter can arrive before React renders the input
    // flush that preceded it, and stale state silently swallowed that keypress.
    if (!composerHasText(editor) && !files.attachments.length && !files.voiceNote) return;
    void submit();
  };

  const submit = async () => {
    const markdown = composerMarkdown(editor).trim();
    let mentionPubkeys: string[];
    try {
      mentionPubkeys = extractMentionPubkeys(
        markdown,
        pruneMentionBindings(markdown, bindings.current),
        mentionCandidates.map((candidate) => ({
          displayName: candidate.profile.name,
          pubkey: candidate.pubkey,
        })),
      );
    } catch (mentionError) {
      setError(mentionError instanceof Error ? mentionError.message : t("error.messageSend"));
      return;
    }
    const sentKey = draftKey;
    const content = composerMarkdown(editor);
    const sent = {
      doc: editor.getJSON(),
      voiceNote: files.voiceNote,
      draft: {
        content,
        attachments: files.attachments,
        mentions: [...pruneMentionBindings(content, bindings.current)],
      } satisfies ConversationDraft,
    };
    const uploadVoiceNote = files.uploadVoiceNote;
    sendingRef.current = true;
    setSending(true);
    setError(null);
    // Desktop clears before publishing: the timeline already shows the optimistic message,
    // and this composer may switch conversations while the send is in flight, so all
    // clearing happens here, in the sent conversation's scope, never after the await.
    clearComposer(editor);
    files.replaceMedia([], null);
    bindings.current = new Map();
    setMentionQuery(null);
    if (draftTimer.current) window.clearTimeout(draftTimer.current);
    draftDirty.current = false;
    if (sentKey) clearConversationDraft(sentKey);
    try {
      const voice = await uploadVoiceNote();
      const attachments = voice ? [...sent.draft.attachments, voice] : sent.draft.attachments;
      await onSend(contentWithAttachments(markdown, attachments), attachments, {
        mentionPubkeys,
        emojiTags: customEmojiTags(markdown, customEmoji),
      });
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : t("error.messageSend"));
      // Restore the failed message where it was written, unless that composer moved on.
      if (!editor.isDestroyed && activeDraftKey.current === sentKey && !composerHasText(editor)) {
        bindings.current = new Map(sent.draft.mentions);
        editor.commands.setContent(sent.doc, { emitUpdate: false });
        files.replaceMedia(sent.draft.attachments, sent.voiceNote);
        setHasText(composerHasText(editor));
      }
      if (sentKey) {
        const stored = readConversationDraft(sentKey);
        if (!stored.content.trim() && !stored.attachments.length) {
          writeConversationDraft(sentKey, sent.draft);
        }
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
      // A surface may unmount the composer once the send resolves (Forums closes its form).
      focusFrame.current = window.requestAnimationFrame(() => {
        focusFrame.current = null;
        if (!editor.isDestroyed) editor.commands.focus();
      });
    }
  };

  useEffect(() => {
    if (!insertMention) return;
    appendEditorMention(editor, insertMention);
    setMentionQuery(null);
    onMentionInserted?.();
  }, [editor, insertMention, onMentionInserted]);

  // Keyed by id: `replyTarget` is a fresh object every render, and refocusing at the end on
  // each render would yank the caret away from a mention typed mid-text.
  const replyTargetId = replyTarget?.id;
  useEffect(() => {
    if (replyTargetId) editor.commands.focus("end");
  }, [editor, replyTargetId]);

  const onRecordingChange = useCallback((active: boolean) => setRecording(active), []);
  const onRecorded = useCallback(
    (file: File, durationSeconds: number) => files.setVoiceNote({ file, durationSeconds }),
    [files.setVoiceNote],
  );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: file drop target; "Add attachment" is the keyboard path.
    <div
      className={compact ? "px-3 pb-3" : "px-3 pb-3 sm:px-4"}
      onDragEnter={(event) => {
        if (dragHasFiles(event.dataTransfer) && !disabled && !sending) setDragging(true);
      }}
      onDragOver={(event) => {
        if (!dragHasFiles(event.dataTransfer) || disabled || sending) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        setDragging(false);
        if (!dragHasFiles(event.dataTransfer) || disabled || sending) return;
        event.preventDefault();
        void files.addFiles([...event.dataTransfer.files]);
      }}
    >
      <AttachmentTray
        attachments={files.attachments}
        uploads={files.uploads}
        voiceNote={files.voiceNote}
        onRemoveAttachment={(attachment) =>
          files.setAttachments((current) => current.filter((item) => item !== attachment))
        }
        onRemoveVoiceNote={() => files.setVoiceNote(null)}
      />
      <div className="relative">
        {replyTarget ? (
          <div
            className="relative -mb-2 flex items-start gap-2 rounded-t-md border border-b-0 border-border/70 bg-muted/55 px-3 pb-4 pt-2 text-sm text-muted-foreground"
            data-testid="reply-target"
          >
            <CornerUpLeft aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-foreground">
                {t("message.replyingTo", { name: replyTarget.author })}
              </p>
              {replyTarget.body ? (
                <p className="truncate text-xs text-muted-foreground/80">{replyTarget.body}</p>
              ) : null}
            </div>
            <button
              aria-label={t("message.cancelReply")}
              className="buzz-icon-button -mr-1 h-7 w-7 shrink-0"
              type="button"
              onClick={onCancelReply}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : null}
        <MentionAutocomplete
          candidates={mentionMatches}
          listId={mentionListId}
          relayUrl={relayUrl}
          selectedIndex={mentionSelectedIndex}
          onSelect={(candidate) => selectMentionRef.current(candidate)}
        />
        <div
          className={`relative z-10 rounded-md border bg-background/90 shadow-sm focus-within:border-ring/55 ${dragging ? "border-primary/70" : "border-border/90"}`}
        >
          {dragging ? (
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-md bg-background/85 text-sm font-medium text-primary">
              {t("composer.dropFiles")}
            </div>
          ) : null}
          {formattingOpen ? (
            <FormattingBar
              disabled={Boolean(disabled) || sending}
              editor={editor}
              onLink={() => setLinkOpen(true)}
            />
          ) : null}
          {linkOpen ? <LinkEditor editor={editor} onClose={() => setLinkOpen(false)} /> : null}
          <EditorContent className="buzz-composer-editor" editor={editor} />
          <div className="flex min-h-8 items-center justify-between gap-1 border-t border-border/55 px-1.5">
            <div className="flex min-w-0 items-center">
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
                className="buzz-icon-button"
                disabled={disabled || sending}
                title={t("message.addAttachment")}
                type="button"
                onClick={() => fileRef.current?.click()}
              >
                {files.uploads.length ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Paperclip className="h-4 w-4" />
                )}
              </button>
              {files.voiceNote ? null : (
                <ComposerVoiceNote
                  disabled={Boolean(disabled) || sending}
                  onRecorded={onRecorded}
                  onRecordingChange={onRecordingChange}
                />
              )}
              {recording ? null : (
                <>
                  <EmojiGifPicker
                    customEmoji={customEmoji}
                    client={demo ? null : client}
                    demo={demo}
                    disabled={Boolean(disabled) || sending}
                    gifDisabled={files.voiceNote !== null}
                    pubkey={pubkey}
                    relayUrl={relayUrl}
                    onClose={() => editor.commands.focus()}
                    onEmoji={(value) => insertEditorText(editor, value)}
                    onGif={(gif, capability) => {
                      files.setAttachments((current) => [...current, gifAttachment(gif)]);
                      editor.commands.focus();
                      void reportRelayGifShare(relayUrl, pubkey, capability, gif).catch(
                        () => undefined,
                      );
                    }}
                  />
                  <button
                    aria-label={t("composer.toggleFormatting")}
                    aria-pressed={formattingOpen}
                    className="buzz-icon-button"
                    disabled={disabled}
                    title={t("composer.formatting")}
                    type="button"
                    onClick={() => {
                      setFormattingOpen((current) => !current);
                      setLinkOpen(false);
                    }}
                  >
                    <ALargeSmall className="h-4 w-4" />
                  </button>
                </>
              )}
            </div>
            <button
              aria-label={t("message.send")}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-foreground text-background transition-opacity disabled:opacity-25"
              disabled={!canSend}
              title={recording ? t("composer.voiceNoteRecording") : t("message.send")}
              type="button"
              onClick={() => submitRef.current()}
            >
              {sending ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </div>
      </div>
      {error ? (
        <p className="mt-1.5 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {files.notices.map((notice) => (
        <p
          key={notice.id}
          className="mt-1.5 flex items-start gap-1.5 text-xs text-destructive"
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
    </div>
  );
}
