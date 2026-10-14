import { Copy, Globe2, LoaderCircle, Lock, Pencil, Plus, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  type AgentPersona,
  type AgentTeam,
  personaFromCatalogMember,
  type TeamCatalogEntry,
  uniqueSlug,
} from "@/features/agents/lib/catalog-model";
import {
  dangerButtonClass,
  errorMessage,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/features/agents/ui/agent-labels";
import { TeamEditor } from "@/features/agents/ui/TeamEditor";
import type { AgentCatalogApi } from "@/features/agents/use-agent-catalog";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import { SnapshotExportButton } from "@/features/export/ui/SnapshotButtons";
import { t } from "@/shared/i18n";
import { truncatePubkey } from "@/shared/lib/pubkey";

function emptyTeam(): AgentTeam {
  return {
    id: crypto.randomUUID(),
    name: "",
    description: null,
    instructions: null,
    personaIds: [],
    shared: false,
    eventId: null,
    createdAt: 0,
  };
}

/** Persisted teams (30176) with explicit sharing as a sanitized 30178 projection. */
export function TeamCatalog({ catalog }: { catalog: AgentCatalogApi }) {
  const { profiles } = useWorkspace();
  const [editing, setEditing] = useState<{ team: AgentTeam; isNew: boolean } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const { teams, personas, sharedTeams } = catalog.catalog;
  const personaName = (id: string) =>
    personas.find((persona) => persona.id === id)?.displayName ?? id;

  const addShared = async (entry: TeamCatalogEntry) => {
    setAdding(entry.eventId);
    try {
      const ids = new Set(personas.map((persona) => persona.id));
      const saved: AgentPersona[] = [];
      for (const member of entry.members) {
        const persona = personaFromCatalogMember(member, uniqueSlug(member.displayName, ids));
        ids.add(persona.id);
        saved.push(await catalog.savePersona.mutateAsync(persona));
      }
      await catalog.saveTeam.mutateAsync({
        team: {
          ...emptyTeam(),
          name: entry.name,
          description: entry.description,
          instructions: entry.instructions,
          personaIds: saved.map((persona) => persona.id),
        },
        wasShared: false,
      });
      toast.success(t("agents.teamAdded", { name: entry.name }));
    } catch (error) {
      toast.error(errorMessage(error, t("error.agentUpdate")));
    } finally {
      setAdding(null);
    }
  };

  return (
    <section aria-labelledby="agents-teams-heading" className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold" id="agents-teams-heading">
            {t("agents.teams")}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("agents.teamsPersisted")}</p>
        </div>
        <button
          className={primaryButtonClass}
          type="button"
          onClick={() => setEditing({ team: emptyTeam(), isNew: true })}
        >
          <Plus className="h-4 w-4" />
          {t("agents.newTeam")}
        </button>
      </div>
      {catalog.loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          {t("agents.catalogLoading")}
        </p>
      ) : teams.length ? (
        <ul className="divide-y rounded-lg border" data-testid="agent-teams">
          {teams.map((team) => (
            <li key={team.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground/[0.055]">
                <Users className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{team.name}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    {team.shared ? (
                      <Globe2 className="h-3.5 w-3.5" />
                    ) : (
                      <Lock className="h-3.5 w-3.5" />
                    )}
                    {team.shared ? t("agents.sharedLabel") : t("agents.privateLabel")}
                  </span>
                  <span className="truncate">
                    {team.personaIds.length
                      ? team.personaIds.map(personaName).join(", ")
                      : t("agents.teamNoMembers")}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {confirmDelete === team.id ? (
                  <>
                    <button
                      className={dangerButtonClass}
                      disabled={catalog.removeTeam.isPending}
                      type="button"
                      onClick={() =>
                        catalog.removeTeam.mutate(team, { onSettled: () => setConfirmDelete(null) })
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
                    <SnapshotExportButton personas={personas} team={team} />
                    <button
                      aria-label={t("agents.editTeam", { name: team.name })}
                      className="buzz-icon-button"
                      title={t("agents.editTeam", { name: team.name })}
                      type="button"
                      onClick={() => setEditing({ team, isNew: false })}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      aria-label={t("agents.deleteTeam", { name: team.name })}
                      className="buzz-icon-button"
                      title={t("agents.deleteTeam", { name: team.name })}
                      type="button"
                      onClick={() => setConfirmDelete(team.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          {t("agents.noTeams")}
        </p>
      )}
      {catalog.removeTeam.error ? (
        <p className="text-xs text-destructive" role="alert">
          {errorMessage(catalog.removeTeam.error, t("error.agentUpdate"))}
        </p>
      ) : null}

      <div className="space-y-3">
        <h3 className="text-base font-semibold">{t("agents.communityTeams")}</h3>
        {sharedTeams.length ? (
          <ul className="divide-y rounded-lg border" data-testid="agent-shared-teams">
            {sharedTeams.map((entry) => (
              <li
                key={entry.eventId}
                className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{entry.name}</div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {t("agents.sharedBy", {
                      owner: profiles[entry.ownerPubkey]?.name ?? truncatePubkey(entry.ownerPubkey),
                    })}
                    {" · "}
                    {entry.members.map((member) => member.displayName).join(", ")}
                  </div>
                </div>
                <button
                  className={secondaryButtonClass}
                  disabled={adding !== null}
                  type="button"
                  onClick={() => void addShared(entry)}
                >
                  {adding === entry.eventId ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  {t("agents.addTeamToMine")}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            {t("agents.communityTeamsEmpty")}
          </p>
        )}
      </div>

      {editing ? (
        <TeamEditor
          error={
            catalog.saveTeam.error
              ? errorMessage(catalog.saveTeam.error, t("error.agentUpdate"))
              : null
          }
          isNew={editing.isNew}
          pending={catalog.saveTeam.isPending}
          personas={personas}
          team={editing.team}
          onClose={() => setEditing(null)}
          onSave={(team) =>
            catalog.saveTeam.mutate(
              { team, wasShared: editing.team.shared },
              {
                onSuccess: () => {
                  setEditing(null);
                  toast.success(t("agents.teamSaved"));
                },
              },
            )
          }
        />
      ) : null}
    </section>
  );
}
