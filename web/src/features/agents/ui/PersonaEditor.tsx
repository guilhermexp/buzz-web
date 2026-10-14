import { LoaderCircle } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import type {
  AgentPersona,
  PersonaRespondTo,
  SessionPolicy,
} from "@/features/agents/lib/catalog-model";
import {
  fieldClass,
  labelClass,
  primaryButtonClass,
  RESPOND_TO_OPTIONS,
  respondToLabel,
  secondaryButtonClass,
} from "@/features/agents/ui/agent-labels";
import { DialogFrame } from "@/features/chat/ui/AppDialogs";
import { t } from "@/shared/i18n";
import { parsePublicKey } from "@/shared/lib/pubkey";

export function PersonaEditor({
  persona,
  isNew,
  pending,
  error,
  onSave,
  onClose,
}: {
  persona: AgentPersona;
  isNew: boolean;
  pending: boolean;
  error: string | null;
  onSave: (persona: AgentPersona) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(persona);
  const [allowlistText, setAllowlistText] = useState(persona.respondToAllowlist.join("\n"));
  const [localError, setLocalError] = useState<string | null>(null);
  const update = (patch: Partial<AgentPersona>) =>
    setDraft((current) => ({ ...current, ...patch }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.displayName.trim()) {
      setLocalError(t("agents.personaNameRequired"));
      return;
    }
    let allowlist: string[] = [];
    try {
      allowlist =
        draft.respondTo === "allowlist"
          ? [
              ...new Set(
                allowlistText
                  .split(/[\s,]+/)
                  .filter(Boolean)
                  .map(parsePublicKey),
              ),
            ]
          : [];
    } catch (parseError) {
      setLocalError(parseError instanceof Error ? parseError.message : t("error.pubkeyInvalid"));
      return;
    }
    setLocalError(null);
    onSave({ ...draft, displayName: draft.displayName.trim(), respondToAllowlist: allowlist });
  };

  const shownError = localError ?? error;
  return (
    <DialogFrame
      title={
        isNew ? t("agents.newPersona") : t("agents.editPersona", { name: persona.displayName })
      }
      width="max-w-xl"
      onClose={onClose}
    >
      <form
        className="buzz-scrollbar max-h-[calc(85dvh-3.25rem)] space-y-4 overflow-y-auto p-4"
        onSubmit={submit}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={labelClass} htmlFor={`${id}-name`}>
            {t("agents.nameLabel")}
            <input
              className={fieldClass}
              disabled={pending}
              id={`${id}-name`}
              maxLength={256}
              value={draft.displayName}
              onChange={(event) => update({ displayName: event.target.value })}
            />
          </label>
          <label className={labelClass} htmlFor={`${id}-model`}>
            {t("agents.modelLabel")}
            <input
              className={fieldClass}
              disabled={pending}
              id={`${id}-model`}
              value={draft.model ?? ""}
              onChange={(event) => update({ model: event.target.value.trim() || null })}
            />
          </label>
        </div>
        <label className={labelClass} htmlFor={`${id}-description`}>
          {t("agents.descriptionLabel")}
          <input
            className={fieldClass}
            disabled={pending}
            id={`${id}-description`}
            maxLength={4096}
            value={draft.description ?? ""}
            onChange={(event) => update({ description: event.target.value || null })}
          />
        </label>
        <label className={labelClass} htmlFor={`${id}-prompt`}>
          {t("agents.personaLabel")}
          <textarea
            className={`${fieldClass} min-h-32`}
            disabled={pending}
            id={`${id}-prompt`}
            maxLength={16_384}
            value={draft.systemPrompt}
            onChange={(event) => update({ systemPrompt: event.target.value })}
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className={labelClass} htmlFor={`${id}-respond`}>
            {t("agents.responsePolicy")}
            <select
              className={fieldClass}
              disabled={pending}
              id={`${id}-respond`}
              value={draft.respondTo ?? ""}
              onChange={(event) =>
                update({ respondTo: (event.target.value || null) as PersonaRespondTo | null })
              }
            >
              <option value="">{t("agents.respondDefault")}</option>
              {RESPOND_TO_OPTIONS.map((mode) => (
                <option key={mode} value={mode}>
                  {respondToLabel(mode)}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass} htmlFor={`${id}-session`}>
            {t("agents.sessionPolicyLabel")}
            <select
              className={fieldClass}
              disabled={pending}
              id={`${id}-session`}
              value={draft.sessionPolicy}
              onChange={(event) => update({ sessionPolicy: event.target.value as SessionPolicy })}
            >
              <option value="channel">{t("agents.sessionChannel")}</option>
              <option value="thread">{t("agents.sessionThread")}</option>
            </select>
          </label>
          <label className={labelClass} htmlFor={`${id}-parallelism`}>
            {t("agents.parallelismLabel")}
            <input
              className={fieldClass}
              disabled={pending}
              id={`${id}-parallelism`}
              max={32}
              min={1}
              type="number"
              value={draft.parallelism ?? ""}
              onChange={(event) =>
                update({
                  parallelism: event.target.value
                    ? Math.min(32, Math.max(1, Math.round(Number(event.target.value))))
                    : null,
                })
              }
            />
          </label>
        </div>
        {draft.respondTo === "allowlist" ? (
          <label className={labelClass} htmlFor={`${id}-allowlist`}>
            {t("agents.allowlistLabel")}
            <textarea
              className={`${fieldClass} min-h-20 font-mono text-xs`}
              disabled={pending}
              id={`${id}-allowlist`}
              placeholder={t("agents.allowlistPlaceholder")}
              value={allowlistText}
              onChange={(event) => setAllowlistText(event.target.value)}
            />
          </label>
        ) : null}
        <label className="flex items-start gap-2 text-sm" htmlFor={`${id}-shared`}>
          <input
            checked={draft.shared}
            className="mt-1"
            disabled={pending}
            id={`${id}-shared`}
            type="checkbox"
            onChange={(event) => update({ shared: event.target.checked })}
          />
          <span>
            <span className="font-medium">{t("agents.shareToCatalog")}</span>
            <span className="block text-xs text-muted-foreground">{t("agents.shareHint")}</span>
          </span>
        </label>
        {shownError ? (
          <p
            className="rounded-md bg-destructive/8 px-3 py-2 text-xs text-destructive"
            role="alert"
          >
            {shownError}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button
            className={secondaryButtonClass}
            disabled={pending}
            type="button"
            onClick={onClose}
          >
            {t("common.cancel")}
          </button>
          <button className={primaryButtonClass} disabled={pending} type="submit">
            {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
            {t("agents.savePersona")}
          </button>
        </div>
      </form>
    </DialogFrame>
  );
}
