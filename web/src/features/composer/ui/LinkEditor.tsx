import type { Editor } from "@tiptap/core";
import { Check, Link2Off, X } from "lucide-react";
import { useId, useState } from "react";
import { t } from "@/shared/i18n";

/** Accept http(s)/mailto links; a bare host gets https:// like desktop's default protocol. */
export function normalizeLinkHref(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (url.protocol === "mailto:") return url.pathname ? candidate : null;
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname
      ? candidate
      : null;
  } catch {
    return null;
  }
}

/** Inline editor for the link at the selection (Mod-K or the toolbar Link button). */
export function LinkEditor({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const inputId = useId();
  const errorId = useId();
  const existing = editor.getAttributes("link").href as string | undefined;
  const [href, setHref] = useState(existing ?? "");
  const [invalid, setInvalid] = useState(false);

  const close = () => {
    onClose();
    editor.commands.focus();
  };

  const apply = () => {
    const normalized = normalizeLinkHref(href);
    if (!normalized) {
      setInvalid(true);
      return;
    }
    const chain = editor.chain().focus();
    if (editor.isActive("link")) chain.extendMarkRange("link");
    if (editor.state.selection.empty && !editor.isActive("link")) {
      const { from } = editor.state.selection;
      chain
        .command(({ tr }) => {
          tr.insertText(normalized, from);
          return true;
        })
        .setTextSelection({ from, to: from + normalized.length });
    }
    chain.setLink({ href: normalized }).run();
    onClose();
  };

  return (
    <form
      aria-label={t("composer.linkEditor")}
      className="flex flex-wrap items-center gap-1.5 border-b border-border/55 px-2 py-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        apply();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <label className="sr-only" htmlFor={inputId}>
        {t("composer.linkUrl")}
      </label>
      <input
        // biome-ignore lint/a11y/noAutofocus: opened by an explicit link command; focus moves to its only field.
        autoFocus
        aria-describedby={invalid ? errorId : undefined}
        aria-invalid={invalid}
        className="h-7 min-w-0 flex-1 rounded border border-border/80 bg-background px-2 text-sm outline-none focus:border-ring/60"
        id={inputId}
        inputMode="url"
        type="text"
        value={href}
        onChange={(event) => {
          setHref(event.target.value);
          setInvalid(false);
        }}
      />
      <button
        aria-label={t("composer.linkApply")}
        className="buzz-icon-button h-7 w-7"
        title={t("composer.linkApply")}
        type="submit"
      >
        <Check className="h-3.5 w-3.5" />
      </button>
      {existing ? (
        <button
          aria-label={t("composer.linkRemove")}
          className="buzz-icon-button h-7 w-7"
          title={t("composer.linkRemove")}
          type="button"
          onClick={() => {
            editor.chain().focus().extendMarkRange("link").unsetLink().run();
            onClose();
          }}
        >
          <Link2Off className="h-3.5 w-3.5" />
        </button>
      ) : null}
      <button
        aria-label={t("composer.linkCancel")}
        className="buzz-icon-button h-7 w-7"
        title={t("composer.linkCancel")}
        type="button"
        onClick={close}
      >
        <X className="h-3.5 w-3.5" />
      </button>
      {invalid ? (
        <p className="w-full text-xs text-destructive" id={errorId}>
          {t("composer.linkInvalid")}
        </p>
      ) : null}
    </form>
  );
}
