import { LoaderCircle } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import type { AgentPersona, AgentTeam } from "@/features/agents/lib/catalog-model";
import {
  fieldClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/features/agents/ui/agent-labels";
import { DialogFrame } from "@/features/chat/ui/AppDialogs";
import { t } from "@/shared/i18n";

export function TeamEditor({
  team,
  isNew,
  personas,
  pending,
  error,
  onSave,
  onClose,
}: {
  team: AgentTeam;
  isNew: boolean;
  personas: readonly AgentPersona[];
  pending: boolean;
  error: string | null;
  onSave: (team: AgentTeam) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(team);
  const [localError, setLocalError] = useState<string | null>(null);
  const update = (patch: Partial<AgentTeam>) => setDraft((current) => ({ ...current, ...patch }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.name.trim()) {
      setLocalError(t("agents.teamNameRequired"));
      return;
    }
    setLocalError(null);
    onSave({ ...draft, name: draft.name.trim() });
  };

  const shownError = localError ?? error;
  return (
    <DialogFrame
      title={isNew ? t("agents.newTeam") : t("agents.editTeam", { name: team.name })}
      width="max-w-xl"
      onClose={onClose}
    >
      <form
        className="buzz-scrollbar max-h-[calc(85dvh-3.25rem)] space-y-4 overflow-y-auto p-4"
        onSubmit={submit}
      >
        <label className={labelClass} htmlFor={`${id}-name`}>
          {t("agents.teamNameLabel")}
          <input
            className={fieldClass}
            disabled={pending}
            id={`${id}-name`}
            maxLength={256}
            value={draft.name}
            onChange={(event) => update({ name: event.target.value })}
          />
        </label>
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
        <label className={labelClass} htmlFor={`${id}-instructions`}>
          {t("agents.teamInstructions")}
          <textarea
            className={`${fieldClass} min-h-24`}
            disabled={pending}
            id={`${id}-instructions`}
            maxLength={16_384}
            value={draft.instructions ?? ""}
            onChange={(event) => update({ instructions: event.target.value || null })}
          />
        </label>
        <fieldset>
          <legend className={labelClass}>{t("agents.teamMembers")}</legend>
          {personas.length ? (
            <div className="mt-1.5 max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
              {personas.map((persona) => (
                <label key={persona.id} className="flex items-center gap-2 text-sm">
                  <input
                    checked={draft.personaIds.includes(persona.id)}
                    disabled={pending}
                    type="checkbox"
                    onChange={(event) =>
                      update({
                        personaIds: event.target.checked
                          ? [...draft.personaIds, persona.id]
                          : draft.personaIds.filter((value) => value !== persona.id),
                      })
                    }
                  />
                  <span className="truncate">{persona.displayName}</span>
                </label>
              ))}
            </div>
          ) : (
            <p className="mt-1.5 text-sm text-muted-foreground">{t("agents.teamNeedsPersonas")}</p>
          )}
        </fieldset>
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
            <span className="block text-xs text-muted-foreground">{t("agents.teamShareHint")}</span>
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
            {t("agents.saveTeam")}
          </button>
        </div>
      </form>
    </DialogFrame>
  );
}
