import { FolderGit2, Import, LoaderCircle, Plus } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import { relayHttpOrigin } from "@/shared/config/runtime-config";
import { t } from "@/shared/i18n";
import {
  buildProjectMembershipTemplate,
  buildProjectTemplate,
  buildRepositoryTemplate,
  canClaimRepository,
} from "../../lib/forge-events";
import {
  isValidRepoId,
  KIND_PROJECT,
  KIND_REPO_ANNOUNCEMENT,
  type Project,
  parseRepositoryAddress,
  type Repository,
  relayCloneUrl,
  repositoryAddress,
  slugFromName,
} from "../../lib/nip34";
import { fetchOwnHead, useForgePublish } from "../../use-forge";
import {
  ErrorNote,
  fieldClass,
  forgeErrorMessage,
  primaryButton,
  secondaryButton,
  textareaClass,
} from "./forge-ui";

function ChannelSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { channels } = useWorkspace();
  const options = channels.filter((channel) => channel.isMember && !channel.archived);
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium">{t("projects.field.channel")}</span>
      <select
        className={fieldClass}
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{t("projects.field.chooseChannel")}</option>
        {options.map((channel) => (
          <option key={channel.id} value={channel.id}>
            #{channel.name}
          </option>
        ))}
      </select>
      <span className="block text-[11px] leading-4 text-muted-foreground">
        {t("projects.field.channelHint")}
      </span>
    </label>
  );
}

/**
 * Publish a project (30621) with a default repository (30617) bound to a
 * channel the viewer belongs to, like Desktop's channel-first projects. An
 * existing own repository with the same identifier is reused unchanged so
 * its announced remotes are preserved.
 */
export function CreateProjectForm({
  breadcrumbs,
  onCreated,
  onCancel,
}: {
  breadcrumbs: ReactNode;
  onCreated: (projectId: string) => void;
  onCancel: () => void;
}) {
  const { client, pubkey, relayUrl, selectedChannel } = useWorkspace();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [channelId, setChannelId] = useState(selectedChannel?.isMember ? selectedChannel.id : "");
  const [visibility, setVisibility] = useState<"listed" | "unlisted">("listed");
  const [error, setError] = useState<string | null>(null);
  const publish = useForgePublish();
  const dtag = slugFromName(name);

  const submit = async () => {
    if (!dtag || !isValidRepoId(dtag)) throw new Error("repo-id-invalid");
    if (await fetchOwnHead(client, KIND_PROJECT, pubkey, dtag)) {
      throw new Error(t("projects.create.exists", { name: dtag }));
    }
    const templates = [];
    if (!(await fetchOwnHead(client, KIND_REPO_ANNOUNCEMENT, pubkey, dtag))) {
      templates.push(
        buildRepositoryTemplate({
          dtag,
          name,
          description,
          channelId,
          cloneUrls: [relayCloneUrl(relayHttpOrigin(relayUrl), pubkey, dtag)],
        }),
      );
    }
    templates.push(
      buildProjectTemplate({
        dtag,
        name,
        description,
        channelId,
        visibility,
        repositoryAddresses: [repositoryAddress(pubkey, dtag)],
      }),
    );
    await publish.mutateAsync(templates);
    toast.success(t("projects.create.done"));
    onCreated(`${KIND_PROJECT}:${pubkey}:${dtag}`);
  };

  return (
    <div className="mt-8 max-w-2xl">
      {breadcrumbs}
      <h3 className="mt-5 text-xl font-semibold">{t("projects.create.title")}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{t("projects.create.description")}</p>
      <form
        className="mt-5 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          void submit().catch((failure) => setError(forgeErrorMessage(failure)));
        }}
      >
        <label className="block space-y-1.5">
          <span className="text-xs font-medium">{t("projects.field.name")}</span>
          <input
            className={fieldClass}
            maxLength={64}
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          {dtag ? (
            <span className="block font-mono text-[11px] text-muted-foreground">
              {t("projects.field.identifier", { id: dtag })}
            </span>
          ) : null}
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium">{t("projects.field.description")}</span>
          <textarea
            className={textareaClass}
            maxLength={2_048}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <ChannelSelect value={channelId} onChange={setChannelId} />
        <fieldset className="space-y-1.5">
          <legend className="text-xs font-medium">{t("projects.field.visibility")}</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            {(["listed", "unlisted"] as const).map((value) => (
              <label key={value} className="flex items-center gap-2">
                <input
                  checked={visibility === value}
                  name="project-visibility"
                  type="radio"
                  onChange={() => setVisibility(value)}
                />
                {value === "listed" ? t("projects.field.listed") : t("projects.field.unlisted")}
              </label>
            ))}
          </div>
        </fieldset>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        <div className="flex justify-end gap-2">
          <button className={secondaryButton} type="button" onClick={onCancel}>
            {t("common.cancel")}
          </button>
          <button
            className={primaryButton}
            disabled={!dtag || !channelId || publish.isPending}
            type="submit"
          >
            {publish.isPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <FolderGit2 className="h-4 w-4" />
            )}
            {t("projects.create.submit")}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Add a repository to a project the viewer owns: either announce a new one
 * bound to the project channel, or import an existing announcement by
 * coordinate. Imports only patch the project's `a` tags; the repository's
 * own event (and its clone remotes) is never rewritten.
 */
export function AddRepositoryForm({
  project,
  repositories,
  breadcrumbs,
  onDone,
  onCancel,
}: {
  project: Project;
  repositories: readonly Repository[];
  breadcrumbs: ReactNode;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { client, pubkey, relayUrl } = useWorkspace();
  const [mode, setMode] = useState<"import" | "new">("import");
  const [coordinate, setCoordinate] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [channelId, setChannelId] = useState(project.channelId ?? "");
  const [error, setError] = useState<string | null>(null);
  const publish = useForgePublish();
  const importable = repositories.filter(
    (repository) =>
      !project.repositoryAddresses.includes(repository.address) &&
      canClaimRepository(repository, pubkey),
  );

  const submit = async () => {
    const liveHead = await fetchOwnHead(client, KIND_PROJECT, pubkey, project.dtag);
    if (!liveHead) throw new Error("project-not-owner");
    const now = Math.floor(Date.now() / 1_000);
    if (mode === "import") {
      const address = coordinate.trim();
      const parsed = parseRepositoryAddress(address);
      if (!parsed) throw new Error("repo-address-invalid");
      const repository = repositories.find((candidate) => candidate.address === address);
      if (!repository) throw new Error(t("projects.import.notFound"));
      if (!canClaimRepository(repository, pubkey))
        throw new Error(t("projects.import.notMaintainer"));
      await publish.mutateAsync([
        buildProjectMembershipTemplate({ liveHead, viewerPubkey: pubkey, add: [address], now }),
      ]);
    } else {
      const dtag = slugFromName(name);
      if (!dtag || !isValidRepoId(dtag)) throw new Error("repo-id-invalid");
      if (await fetchOwnHead(client, KIND_REPO_ANNOUNCEMENT, pubkey, dtag)) {
        throw new Error(t("projects.repo.exists", { name: dtag }));
      }
      await publish.mutateAsync([
        buildRepositoryTemplate({
          dtag,
          name,
          description,
          channelId,
          cloneUrls: [relayCloneUrl(relayHttpOrigin(relayUrl), pubkey, dtag)],
        }),
        buildProjectMembershipTemplate({
          liveHead,
          viewerPubkey: pubkey,
          add: [repositoryAddress(pubkey, dtag)],
          now,
        }),
      ]);
    }
    toast.success(t("projects.repo.added"));
    onDone();
  };

  return (
    <div className="mt-8 max-w-2xl">
      {breadcrumbs}
      <h3 className="mt-5 text-xl font-semibold">
        {t("projects.repo.addTitle", { project: project.name })}
      </h3>
      <div
        aria-label={t("projects.repo.addMode")}
        className="mt-4 flex gap-1 rounded-md border p-0.5"
        role="tablist"
      >
        {(
          [
            ["import", t("projects.import.tab")],
            ["new", t("projects.repo.newTab")],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            aria-selected={mode === value}
            className={`h-8 flex-1 rounded px-3 text-xs font-medium ${
              mode === value ? "bg-foreground/10" : "text-muted-foreground hover:text-foreground"
            }`}
            role="tab"
            type="button"
            onClick={() => setMode(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <form
        className="mt-5 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          void submit().catch((failure) => setError(forgeErrorMessage(failure)));
        }}
      >
        {mode === "import" ? (
          <>
            {importable.length ? (
              <label className="block space-y-1.5">
                <span className="text-xs font-medium">{t("projects.import.choose")}</span>
                <select
                  className={fieldClass}
                  value={coordinate}
                  onChange={(event) => setCoordinate(event.target.value)}
                >
                  <option value="">{t("projects.import.choosePlaceholder")}</option>
                  {importable.map((repository) => (
                    <option key={repository.address} value={repository.address}>
                      {repository.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="block space-y-1.5">
              <span className="text-xs font-medium">{t("projects.import.coordinate")}</span>
              <input
                className={`${fieldClass} font-mono`}
                placeholder={t("projects.import.placeholder")}
                value={coordinate}
                onChange={(event) => setCoordinate(event.target.value)}
              />
              <span className="block text-[11px] leading-4 text-muted-foreground">
                {t("projects.import.hint")}
              </span>
            </label>
          </>
        ) : (
          <>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium">{t("projects.field.name")}</span>
              <input
                className={fieldClass}
                maxLength={64}
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium">{t("projects.field.description")}</span>
              <textarea
                className={textareaClass}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <ChannelSelect value={channelId} onChange={setChannelId} />
          </>
        )}
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        <div className="flex justify-end gap-2">
          <button className={secondaryButton} type="button" onClick={onCancel}>
            {t("common.cancel")}
          </button>
          <button
            className={primaryButton}
            disabled={
              publish.isPending ||
              (mode === "import" ? !coordinate.trim() : !name.trim() || !channelId)
            }
            type="submit"
          >
            {publish.isPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : mode === "import" ? (
              <Import className="h-4 w-4" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            {mode === "import" ? t("projects.import.submit") : t("projects.repo.create")}
          </button>
        </div>
      </form>
    </div>
  );
}
