import { FilePlus2, Pencil, Save, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { publishCanvasRevision } from "@/features/canvas/lib/canvas-api";
import { mergeCanvasText } from "@/features/canvas/lib/canvas-merge";
import {
  type CanvasRevision,
  type CanvasWriteFailure,
  classifyCanvasError,
  isCanvasConflict,
} from "@/features/canvas/lib/canvas-protocol";
import { CanvasConflict } from "@/features/canvas/ui/CanvasConflict";
import { CanvasMarkdown } from "@/features/canvas/ui/CanvasMarkdown";
import { CanvasNotice } from "@/features/canvas/ui/CanvasNotice";
import { formatCanvasTime } from "@/features/canvas/ui/canvas-display";
import type { BuzzRelayClient } from "@/shared/api/relay-client";
import { t } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";

type Editing = {
  /** Head the draft was started from or last rebased onto; null when no canvas existed. */
  base: CanvasRevision | null;
  draft: string;
};

type Conflict = { reason: "conflict" | "review"; theirs: CanvasRevision | null };

type Notice = "unverified" | "superseded" | { merged: number } | null;

function saveErrorMessage(failure: CanvasWriteFailure | null, error: unknown): string {
  if (failure === "forbidden") return t("collab.canvas.forbidden");
  if (failure === "archived") return t("collab.canvas.archivedRejected");
  if (failure === "timeline") return t("collab.canvas.timeline");
  const detail = error instanceof Error ? error.message : String(error);
  return t("collab.canvas.saveFailed", { detail: detail.slice(0, 300) });
}

export function CanvasDocument({
  client,
  channelId,
  head,
  canEdit,
  authorName,
  adoptHead,
  refreshHead,
}: {
  client: BuzzRelayClient;
  channelId: string;
  head: CanvasRevision | null;
  canEdit: boolean;
  authorName: (pubkey: string) => string;
  adoptHead: (revision: CanvasRevision) => void;
  refreshHead: () => Promise<CanvasRevision | null>;
}) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusToEdit = useRef(false);

  const dirty = editing !== null && editing.draft !== (editing.base?.content ?? "");
  const headMoved =
    editing !== null && head !== null && head.eventId !== editing.base?.eventId && !saving;

  // A newer head while the editor is open: adopt it when the draft is
  // untouched; otherwise leave the draft alone and surface a notice.
  useEffect(() => {
    if (!head || saving || conflict) return;
    setEditing((current) =>
      current &&
      current.base?.eventId !== head.eventId &&
      current.draft === (current.base?.content ?? "")
        ? { base: head, draft: head.content }
        : current,
    );
  }, [conflict, head, saving]);

  useEffect(() => {
    if (editing === null && restoreFocusToEdit.current) {
      restoreFocusToEdit.current = false;
      editButtonRef.current?.focus();
    }
  }, [editing]);

  // Losing owner/admin (or the channel being archived) ends the edit session.
  useEffect(() => {
    if (canEdit) return;
    setEditing(null);
    setConflict(null);
  }, [canEdit]);

  function startEditing() {
    setEditing({ base: head, draft: head?.content ?? "" });
    setConflict(null);
    setSaveError(null);
    setNotice(null);
    requestAnimationFrame(() => editorRef.current?.focus());
  }

  function closeEditor() {
    restoreFocusToEdit.current = true;
    setEditing(null);
    setConflict(null);
    setSaveError(null);
  }

  async function save(draft: string, base: CanvasRevision | null) {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await publishCanvasRevision(client, channelId, draft, base);
      adoptHead(result.revision);
      closeEditor();
      setNotice(result.verified ? null : "unverified");
    } catch (error) {
      const failure = classifyCanvasError(error);
      if (isCanvasConflict(failure)) {
        // The draft was not published. Keep it and show the head that won.
        let theirs: CanvasRevision | null = head;
        try {
          theirs = await refreshHead();
        } catch {
          // Fall back to the live head already in view.
        }
        setEditing({ base, draft });
        setConflict({ reason: "conflict", theirs });
      } else if (failure === "superseded") {
        closeEditor();
        setNotice("superseded");
        void refreshHead().catch(() => undefined);
      } else {
        setSaveError(saveErrorMessage(failure, error));
      }
    } finally {
      setSaving(false);
    }
  }

  function merge() {
    if (!editing || !conflict?.theirs) return;
    const theirs = conflict.theirs;
    const merged = mergeCanvasText(editing.base?.content ?? "", editing.draft, theirs.content, {
      ours: t("collab.canvas.merge.ours"),
      theirs: t("collab.canvas.merge.theirs"),
    });
    setEditing({ base: theirs, draft: merged.text });
    setConflict(null);
    setNotice({ merged: merged.conflicts });
    requestAnimationFrame(() => editorRef.current?.focus());
  }

  if (editing) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
        {conflict ? (
          <CanvasConflict
            authorName={authorName}
            busy={saving}
            reason={conflict.reason}
            theirs={conflict.theirs}
            onDiscard={closeEditor}
            onMerge={merge}
            onOverwrite={() => void save(editing.draft, conflict.theirs)}
          />
        ) : headMoved && dirty && head ? (
          <CanvasNotice
            action={{
              label: t("collab.canvas.review"),
              onClick: () => setConflict({ reason: "review", theirs: head }),
            }}
          >
            {t("collab.canvas.updated", { name: authorName(head.author) })}
          </CanvasNotice>
        ) : null}
        {notice && typeof notice === "object" ? (
          <CanvasNotice>
            {notice.merged > 0
              ? t("collab.canvas.merged.conflicts", { count: notice.merged })
              : t("collab.canvas.merged.clean")}
          </CanvasNotice>
        ) : null}
        <textarea
          aria-label={t("collab.canvas.content")}
          className="buzz-scrollbar min-h-64 w-full flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 font-mono text-[13px] leading-relaxed shadow-xs outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60"
          disabled={saving}
          placeholder={t("collab.canvas.placeholder")}
          ref={editorRef}
          spellCheck
          value={editing.draft}
          onChange={(event) => {
            const draft = event.target.value;
            setEditing((current) => (current ? { ...current, draft } : current));
          }}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
              event.preventDefault();
              if (!conflict) void save(editing.draft, editing.base);
            }
          }}
        />
        {saveError ? (
          <p className="text-sm text-destructive" role="alert">
            {saveError}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={saving || conflict !== null}
            size="sm"
            type="button"
            onClick={() => void save(editing.draft, editing.base)}
          >
            <Save aria-hidden="true" />
            {saving ? t("collab.canvas.saving") : t("collab.canvas.save")}
          </Button>
          <Button disabled={saving} size="sm" type="button" variant="outline" onClick={closeEditor}>
            <X aria-hidden="true" />
            {t("collab.canvas.cancel")}
          </Button>
          <span className="ml-auto text-[11px] text-muted-foreground max-sm:hidden">
            {t("collab.canvas.saveShortcut")}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-3">
      {notice === "unverified" || notice === "superseded" ? (
        <CanvasNotice>
          {notice === "unverified" ? t("collab.canvas.unverified") : t("collab.canvas.superseded")}
        </CanvasNotice>
      ) : null}
      {head ? (
        <>
          <p className="text-xs text-muted-foreground">
            {t("collab.canvas.lastEdited", {
              name: authorName(head.author),
              time: formatCanvasTime(head.createdAt),
            })}
          </p>
          <CanvasMarkdown content={head.content} />
          {canEdit ? (
            <Button
              ref={editButtonRef}
              size="sm"
              type="button"
              variant="outline"
              onClick={startEditing}
            >
              <Pencil aria-hidden="true" />
              {t("collab.canvas.edit")}
            </Button>
          ) : null}
        </>
      ) : (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed px-4 py-6">
          <h3 className="text-sm font-semibold">{t("collab.canvas.empty.title")}</h3>
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            {canEdit ? t("collab.canvas.empty.body") : t("collab.canvas.empty.readOnly")}
          </p>
          {canEdit ? (
            <Button ref={editButtonRef} size="sm" type="button" onClick={startEditing}>
              <FilePlus2 aria-hidden="true" />
              {t("collab.canvas.create")}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
