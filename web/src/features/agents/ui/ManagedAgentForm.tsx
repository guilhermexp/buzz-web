import { LoaderCircle } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import type {
  ChannelAddPolicy,
  ManagedAgentConfig,
  ManagedRespondTo,
} from "@/features/agents/lib/agent-control-client";
import type { AgentPersona } from "@/features/agents/lib/catalog-model";
import {
  ADD_POLICY_OPTIONS,
  addPolicyLabel,
  fieldClass,
  labelClass,
  primaryButtonClass,
  RESPOND_TO_OPTIONS,
  respondToLabel,
  secondaryButtonClass,
} from "@/features/agents/ui/agent-labels";
import type { BuzzChannel } from "@/features/chat/lib/chat-types";
import { t } from "@/shared/i18n";
import { parsePublicKey } from "@/shared/lib/pubkey";

export type ManagedAgentDraft = {
  name: string;
  model: string;
  respondTo: ManagedRespondTo;
  respondToAllowlist: string[];
  channelAddPolicy: ChannelAddPolicy;
  systemPrompt: string;
  parallelism: number | null;
  channels: string[];
  personaRef: string | null;
};

export const EMPTY_AGENT_DRAFT: ManagedAgentDraft = {
  name: "",
  model: "",
  respondTo: "owner-only",
  respondToAllowlist: [],
  channelAddPolicy: "owner_only",
  systemPrompt: "",
  parallelism: null,
  channels: [],
  personaRef: null,
};

/** The config object sent to Agent Control (no secrets: provider keys live server-side). */
export function draftConfig(draft: ManagedAgentDraft): Partial<ManagedAgentConfig> {
  return {
    model: draft.model.trim(),
    respondTo: draft.respondTo,
    respondToAllowlist: draft.respondTo === "allowlist" ? draft.respondToAllowlist : [],
    channelAddPolicy: draft.channelAddPolicy,
    channels: draft.channels,
    systemPrompt: draft.systemPrompt.trim() || undefined,
    parallelism: draft.parallelism ?? undefined,
    personaRef: draft.personaRef ?? undefined,
  };
}

export function personaCoordinate(owner: string, persona: AgentPersona): string {
  return `30175:${owner.toLowerCase()}:${persona.id}`;
}

/** Apply a persona definition to a runtime draft (the persona's private allowlist stays local). */
export function draftFromPersona(
  draft: ManagedAgentDraft,
  persona: AgentPersona,
  owner: string,
): ManagedAgentDraft {
  return {
    ...draft,
    name: draft.name.trim() ? draft.name : persona.displayName,
    model: persona.model ?? draft.model,
    systemPrompt: persona.systemPrompt,
    respondTo: persona.respondTo ?? draft.respondTo,
    respondToAllowlist: persona.respondToAllowlist,
    parallelism: persona.parallelism,
    personaRef: personaCoordinate(owner, persona),
  };
}

export function ManagedAgentForm({
  initial,
  mode,
  owner,
  personas,
  channels,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  initial: ManagedAgentDraft;
  mode: "create" | "edit";
  owner: string;
  personas: readonly AgentPersona[];
  channels: readonly BuzzChannel[];
  pending: boolean;
  error: string | null;
  onSubmit: (draft: ManagedAgentDraft) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(initial);
  const [allowlistText, setAllowlistText] = useState(initial.respondToAllowlist.join("\n"));
  const [localError, setLocalError] = useState<string | null>(null);
  const assignable = channels.filter((channel) => channel.type !== "dm");
  const update = (patch: Partial<ManagedAgentDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.name.trim()) {
      setLocalError(t("agents.nameRequired"));
      return;
    }
    if (!draft.model.trim()) {
      setLocalError(t("agents.modelRequired"));
      return;
    }
    let allowlist: string[] = [];
    if (draft.respondTo === "allowlist") {
      try {
        allowlist = [
          ...new Set(
            allowlistText
              .split(/[\s,]+/)
              .filter(Boolean)
              .map((value) => parsePublicKey(value)),
          ),
        ];
      } catch (parseError) {
        setLocalError(parseError instanceof Error ? parseError.message : t("error.pubkeyInvalid"));
        return;
      }
      if (!allowlist.length) {
        setLocalError(t("agents.allowlistRequired"));
        return;
      }
    }
    setLocalError(null);
    onSubmit({ ...draft, name: draft.name.trim(), respondToAllowlist: allowlist });
  };

  const shownError = localError ?? error;
  return (
    <form className="space-y-4" onSubmit={submit}>
      {personas.length ? (
        <label className={labelClass} htmlFor={`${id}-persona`}>
          {t("agents.fromPersona")}
          <select
            className={fieldClass}
            disabled={pending}
            id={`${id}-persona`}
            value={personas.find((p) => personaCoordinate(owner, p) === draft.personaRef)?.id ?? ""}
            onChange={(event) => {
              const persona = personas.find((candidate) => candidate.id === event.target.value);
              if (persona) setDraft((current) => draftFromPersona(current, persona, owner));
              else update({ personaRef: null });
            }}
          >
            <option value="">{t("agents.noPersona")}</option>
            {personas.map((persona) => (
              <option key={persona.id} value={persona.id}>
                {persona.displayName}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelClass} htmlFor={`${id}-name`}>
          {t("agents.nameLabel")}
          <input
            className={fieldClass}
            disabled={pending || mode === "edit"}
            id={`${id}-name`}
            maxLength={64}
            value={draft.name}
            onChange={(event) => update({ name: event.target.value })}
          />
        </label>
        <label className={labelClass} htmlFor={`${id}-model`}>
          {t("agents.modelLabel")}
          <input
            className={fieldClass}
            disabled={pending}
            id={`${id}-model`}
            maxLength={200}
            placeholder={t("agents.modelPlaceholder")}
            value={draft.model}
            onChange={(event) => update({ model: event.target.value })}
          />
        </label>
        <label className={labelClass} htmlFor={`${id}-respond`}>
          {t("agents.responsePolicy")}
          <select
            className={fieldClass}
            disabled={pending}
            id={`${id}-respond`}
            value={draft.respondTo}
            onChange={(event) => update({ respondTo: event.target.value as ManagedRespondTo })}
          >
            {RESPOND_TO_OPTIONS.map((mode) => (
              <option key={mode} value={mode}>
                {respondToLabel(mode)}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass} htmlFor={`${id}-policy`}>
          {t("agents.addPolicyLabel")}
          <select
            className={fieldClass}
            disabled={pending}
            id={`${id}-policy`}
            value={draft.channelAddPolicy}
            onChange={(event) =>
              update({ channelAddPolicy: event.target.value as ChannelAddPolicy })
            }
          >
            {ADD_POLICY_OPTIONS.map((policy) => (
              <option key={policy} value={policy}>
                {addPolicyLabel(policy)}
              </option>
            ))}
          </select>
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
      <label className={labelClass} htmlFor={`${id}-prompt`}>
        {t("agents.personaLabel")}
        <textarea
          className={`${fieldClass} min-h-28`}
          disabled={pending}
          id={`${id}-prompt`}
          maxLength={16_384}
          placeholder={t("agents.personaPlaceholder")}
          value={draft.systemPrompt}
          onChange={(event) => update({ systemPrompt: event.target.value })}
        />
      </label>
      <label className={labelClass} htmlFor={`${id}-parallelism`}>
        {t("agents.parallelismLabel")}
        <input
          className={`${fieldClass} sm:w-32`}
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
      {mode === "create" && assignable.length ? (
        <fieldset>
          <legend className={labelClass}>{t("agents.initialChannels")}</legend>
          <div className="mt-1.5 max-h-36 space-y-1 overflow-y-auto rounded-md border p-2">
            {assignable.map((channel) => (
              <label key={channel.id} className="flex items-center gap-2 text-sm">
                <input
                  checked={draft.channels.includes(channel.id)}
                  disabled={pending}
                  type="checkbox"
                  onChange={(event) =>
                    update({
                      channels: event.target.checked
                        ? [...draft.channels, channel.id]
                        : draft.channels.filter((value) => value !== channel.id),
                    })
                  }
                />
                <span className="truncate">#{channel.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      {shownError ? (
        <p className="rounded-md bg-destructive/8 px-3 py-2 text-xs text-destructive" role="alert">
          {shownError}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <button
          className={secondaryButtonClass}
          disabled={pending}
          type="button"
          onClick={onCancel}
        >
          {t("common.cancel")}
        </button>
        <button className={primaryButtonClass} disabled={pending} type="submit">
          {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
          {mode === "create" ? t("agents.createAgent") : t("agents.saveConfig")}
        </button>
      </div>
    </form>
  );
}
