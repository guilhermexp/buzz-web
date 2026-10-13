import { Braces, Download, Image, LoaderCircle, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import type { AgentPersona, AgentTeam } from "@/features/agents/lib/catalog-model";
import { ContextMenu } from "@/features/workspace/ui/ContextMenu";
import { t } from "@/shared/i18n";
import {
  type AgentPersonaDraft,
  agentSnapshotFromPersona,
  personaDraftFromAgentSnapshot,
  SnapshotError,
  snapshotSlug,
} from "../lib/agent-snapshot";
import { downloadBlob } from "../lib/download";
import { snapshotAvatarPngBody } from "../lib/snapshot-avatar-body";
import {
  encodeAgentSnapshotPng,
  encodeSnapshotJsonFile,
  encodeTeamSnapshotPng,
  type SnapshotFileFormat,
} from "../lib/snapshot-card";
import {
  readAnySnapshotFile,
  type TeamDraft,
  teamDraftFromSnapshot,
  teamSnapshotFromTeam,
} from "../lib/team-snapshot";

const iconButton =
  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/7 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-40";

function errorMessage(error: unknown): string {
  return error instanceof SnapshotError ? error.message : t("collab.export.snapshot.errorRead");
}

export type SnapshotExportButtonProps =
  | { persona: AgentPersona }
  | { team: AgentTeam; personas: readonly AgentPersona[] };

/** Desktop naming: `<slug>.agent.(png|json)` / `<slug>.team.(png|json)`. */
async function exportSnapshot(props: SnapshotExportButtonProps, format: SnapshotFileFormat) {
  if ("persona" in props) {
    const snapshot = agentSnapshotFromPersona(props.persona);
    const base = `${snapshotSlug(props.persona.displayName, "agent")}.agent`;
    if (format === "json") {
      const body = encodeSnapshotJsonFile(snapshot);
      downloadBlob(new Blob([body], { type: "application/json" }), `${base}.json`);
      return;
    }
    const png = encodeAgentSnapshotPng(
      snapshot,
      await snapshotAvatarPngBody(props.persona.avatarUrl),
    );
    downloadBlob(new Blob([png], { type: "image/png" }), `${base}.png`);
    return;
  }
  const snapshot = teamSnapshotFromTeam(props.team, props.personas);
  const base = `${snapshotSlug(props.team.name, "team")}.team`;
  if (format === "json") {
    const body = encodeSnapshotJsonFile(snapshot);
    downloadBlob(new Blob([body], { type: "application/json" }), `${base}.json`);
  } else {
    downloadBlob(new Blob([encodeTeamSnapshotPng(snapshot)], { type: "image/png" }), `${base}.png`);
  }
}

export function SnapshotExportButton(props: SnapshotExportButtonProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const label =
    "persona" in props
      ? t("collab.export.snapshot.exportAgent")
      : t("collab.export.snapshot.exportTeam");
  const run = async (format: SnapshotFileFormat) => {
    setBusy(true);
    try {
      await exportSnapshot(props, format);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        ref={buttonRef}
        aria-expanded={menuAt !== null}
        aria-haspopup="menu"
        aria-label={label}
        className={iconButton}
        disabled={busy}
        title={label}
        type="button"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setMenuAt({ x: rect.left, y: rect.bottom + 4 });
        }}
      >
        {busy ? (
          <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
        ) : (
          <Download aria-hidden="true" className="h-4 w-4" />
        )}
      </button>
      {menuAt ? (
        <ContextMenu
          items={[
            {
              id: "png",
              label: t("collab.export.snapshot.formatPng"),
              icon: Image,
              onSelect: () => void run("png"),
            },
            {
              id: "json",
              label: t("collab.export.snapshot.formatJson"),
              icon: Braces,
              onSelect: () => void run("json"),
            },
          ]}
          label={t("collab.export.snapshot.fileFormat")}
          point={menuAt}
          returnFocus={buttonRef.current}
          onClose={() => setMenuAt(null)}
        />
      ) : null}
    </>
  );
}

export type SnapshotImportResult =
  | { kind: "persona"; persona: AgentPersonaDraft }
  | { kind: "team"; team: TeamDraft; personas: AgentPersonaDraft[] };

export function SnapshotImportButton({
  onImported,
}: {
  onImported: (result: SnapshotImportResult) => void | Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const label = t("collab.export.snapshot.import");

  const importFile = async (file: File) => {
    setBusy(true);
    try {
      const read = await readAnySnapshotFile(file);
      const result: SnapshotImportResult =
        read.kind === "persona"
          ? { kind: "persona", persona: personaDraftFromAgentSnapshot(read.snapshot) }
          : { kind: "team", ...teamDraftFromSnapshot(read.snapshot) };
      await onImported(result);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        aria-label={label}
        className={iconButton}
        disabled={busy}
        title={label}
        type="button"
        onClick={() => inputRef.current?.click()}
      >
        {busy ? (
          <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
        ) : (
          <Upload aria-hidden="true" className="h-4 w-4" />
        )}
      </button>
      <input
        ref={inputRef}
        accept=".json,.png,application/json,image/png"
        className="hidden"
        tabIndex={-1}
        type="file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void importFile(file);
        }}
      />
    </>
  );
}
