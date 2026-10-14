import { Bot, Copy, Globe2, LoaderCircle, Lock, Pencil, Plus, Rocket, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { type AgentPersona, uniqueSlug } from "@/features/agents/lib/catalog-model";
import {
  dangerButtonClass,
  errorMessage,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/features/agents/ui/agent-labels";
import { PersonaEditor } from "@/features/agents/ui/PersonaEditor";
import type { AgentCatalogApi } from "@/features/agents/use-agent-catalog";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import type { AgentPersonaDraft } from "@/features/export/lib/agent-snapshot";
import { SnapshotExportButton, SnapshotImportButton } from "@/features/export/ui/SnapshotButtons";
import { t } from "@/shared/i18n";
import { truncatePubkey } from "@/shared/lib/pubkey";

export function newPersona(id: string): AgentPersona {
  return {
    id,
    displayName: "",
    systemPrompt: "",
    description: null,
    avatarUrl: null,
    runtime: null,
    acpCommand: null,
    model: null,
    provider: null,
    namePool: [],
    respondTo: null,
    respondToAllowlist: [],
    parallelism: null,
    sessionPolicy: "channel",
    shared: false,
    eventId: null,
    createdAt: 0,
  };
}

/** Imported or copied definitions always start private; sharing is a separate explicit step. */
export function personaFromDraft(
  draft: AgentPersonaDraft,
  taken: ReadonlySet<string>,
): AgentPersona {
  return {
    ...draft,
    id: uniqueSlug(draft.displayName, taken),
    shared: false,
    eventId: null,
    createdAt: 0,
  };
}

function PersonaRow({
  persona,
  actions,
  meta,
}: {
  persona: AgentPersona;
  actions: React.ReactNode;
  meta: React.ReactNode;
}) {
  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground/[0.055]">
        <Bot className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{persona.displayName}</div>
        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {meta}
        </div>
        {persona.description ? (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{persona.description}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">{actions}</div>
    </li>
  );
}

export function PersonaCatalog({
  catalog,
  canCreateAgent,
  onCreateAgent,
}: {
  catalog: AgentCatalogApi;
  canCreateAgent: boolean;
  onCreateAgent: (persona: AgentPersona) => void;
}) {
  const { profiles } = useWorkspace();
  const [editing, setEditing] = useState<{ persona: AgentPersona; isNew: boolean } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const { personas, sharedPersonas } = catalog.catalog;
  const taken = new Set(personas.map((persona) => persona.id));

  const save = (persona: AgentPersona) =>
    catalog.savePersona.mutate(persona, {
      onSuccess: () => {
        setEditing(null);
        toast.success(t("agents.personaSaved"));
      },
    });
  const importDrafts = async (drafts: AgentPersonaDraft[]): Promise<AgentPersona[]> => {
    const ids = new Set(taken);
    const saved: AgentPersona[] = [];
    for (const draft of drafts) {
      const persona = personaFromDraft(draft, ids);
      ids.add(persona.id);
      saved.push(await catalog.savePersona.mutateAsync(persona));
    }
    return saved;
  };

  return (
    <section aria-labelledby="agents-personas-heading" className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="min-w-0 flex-1 text-base font-semibold" id="agents-personas-heading">
          {t("agents.myPersonas")}
        </h3>
        <SnapshotImportButton
          onImported={async (result) => {
            const drafts = result.kind === "persona" ? [result.persona] : result.personas;
            const saved = await importDrafts(drafts);
            if (result.kind === "team") {
              await catalog.saveTeam.mutateAsync({
                team: {
                  ...result.team,
                  id: crypto.randomUUID(),
                  personaIds: saved.map((persona) => persona.id),
                  shared: false,
                  eventId: null,
                  createdAt: 0,
                },
                wasShared: false,
              });
            }
            toast.success(t("agents.importDone", { count: saved.length }));
          }}
        />
        <button
          className={primaryButtonClass}
          type="button"
          onClick={() => setEditing({ persona: newPersona(""), isNew: true })}
        >
          <Plus className="h-4 w-4" />
          {t("agents.newPersona")}
        </button>
      </div>
      {catalog.loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          {t("agents.catalogLoading")}
        </p>
      ) : personas.length ? (
        <ul className="divide-y rounded-lg border" data-testid="agent-personas">
          {personas.map((persona) => (
            <PersonaRow
              key={persona.id}
              actions={
                confirmDelete === persona.id ? (
                  <>
                    <button
                      className={dangerButtonClass}
                      disabled={catalog.removePersona.isPending}
                      type="button"
                      onClick={() =>
                        catalog.removePersona.mutate(persona, {
                          onSettled: () => setConfirmDelete(null),
                        })
                      }
                    >
                      {t("agents.deleteConfirm")}
                    </button>
                    <button
                      className={secondaryButtonClass}
                      type="button"
                      onClick={() => setConfirmDelete(null)}
                    >
                      {t("common.cancel")}
                    </button>
                  </>
                ) : (
                  <>
                    {canCreateAgent ? (
                      <button
                        className={secondaryButtonClass}
                        type="button"
                        onClick={() => onCreateAgent(persona)}
                      >
                        <Rocket className="h-4 w-4" />
                        {t("agents.createFromPersona")}
                      </button>
                    ) : null}
                    <SnapshotExportButton persona={persona} />
                    <button
                      aria-label={t("agents.editPersona", { name: persona.displayName })}
                      className="buzz-icon-button"
                      title={t("agents.editPersona", { name: persona.displayName })}
                      type="button"
                      onClick={() => setEditing({ persona, isNew: false })}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      aria-label={t("agents.deletePersona", { name: persona.displayName })}
                      className="buzz-icon-button"
                      title={t("agents.deletePersona", { name: persona.displayName })}
                      type="button"
                      onClick={() => setConfirmDelete(persona.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </>
                )
              }
              meta={
                <>
                  <span className="inline-flex items-center gap-1">
                    {persona.shared ? (
                      <Globe2 className="h-3.5 w-3.5" />
                    ) : (
                      <Lock className="h-3.5 w-3.5" />
                    )}
                    {persona.shared ? t("agents.sharedLabel") : t("agents.privateLabel")}
                  </span>
                  {persona.model ? <span className="truncate">{persona.model}</span> : null}
                </>
              }
              persona={persona}
            />
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          {t("agents.personasEmpty")}
        </p>
      )}
      {catalog.removePersona.error ? (
        <p className="text-xs text-destructive" role="alert">
          {errorMessage(catalog.removePersona.error, t("error.agentUpdate"))}
        </p>
      ) : null}

      <div className="space-y-3">
        <h3 className="text-base font-semibold">{t("agents.communityCatalog")}</h3>
        <p className="text-xs text-muted-foreground">{t("agents.communityCatalogHint")}</p>
        {sharedPersonas.length ? (
          <ul className="divide-y rounded-lg border" data-testid="agent-shared-personas">
            {sharedPersonas.map((persona) => (
              <PersonaRow
                key={`${persona.ownerPubkey}:${persona.id}`}
                actions={
                  <button
                    className={secondaryButtonClass}
                    disabled={catalog.savePersona.isPending}
                    type="button"
                    onClick={() =>
                      // Another owner's allowlist names their contacts; it never transfers.
                      void importDrafts([
                        {
                          ...persona,
                          respondTo:
                            persona.respondTo === "allowlist" ? "owner-only" : persona.respondTo,
                          respondToAllowlist: [],
                        },
                      ]).then(
                        () => toast.success(t("agents.importDone", { count: 1 })),
                        (error: unknown) =>
                          toast.error(errorMessage(error, t("error.agentUpdate"))),
                      )
                    }
                  >
                    <Copy className="h-4 w-4" />
                    {t("agents.addToMine")}
                  </button>
                }
                meta={
                  <span className="truncate">
                    {t("agents.sharedBy", {
                      owner:
                        profiles[persona.ownerPubkey]?.name ?? truncatePubkey(persona.ownerPubkey),
                    })}
                  </span>
                }
                persona={persona}
              />
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            {t("agents.communityEmpty")}
          </p>
        )}
      </div>

      {editing ? (
        <PersonaEditor
          error={
            catalog.savePersona.error
              ? errorMessage(catalog.savePersona.error, t("error.agentUpdate"))
              : null
          }
          isNew={editing.isNew}
          pending={catalog.savePersona.isPending}
          persona={editing.persona}
          onClose={() => setEditing(null)}
          onSave={(persona) =>
            save(
              editing.isNew ? { ...persona, id: uniqueSlug(persona.displayName, taken) } : persona,
            )
          }
        />
      ) : null}
    </section>
  );
}
