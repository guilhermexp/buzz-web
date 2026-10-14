import { Download, LoaderCircle, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { channelDisplayName } from "@/features/chat/lib/chat-model";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import { getLocale, t } from "@/shared/i18n";
import { type ExportRange, exportableChannels } from "../lib/content-export-model";
import { downloadBlob } from "../lib/download";
import { type ExportProgress, runContentExport } from "../lib/run-content-export";

type Status =
  | { phase: "idle" }
  | { phase: "running"; progress: ExportProgress | null }
  | { phase: "done"; channels: number; events: number; truncated: boolean }
  | { phase: "error"; message: string };

/** `YYYY-MM-DD` (local) → unix seconds at the start (or end) of that local day. */
function dayBoundary(value: string, end: boolean): number | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = end ? new Date(year, month - 1, day, 23, 59, 59) : new Date(year, month - 1, day);
  return Math.floor(date.getTime() / 1000);
}

function archiveFileName(date: Date): string {
  const stamp = date
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace(/-\d{3}Z$/, "Z");
  return `buzz-content-export-${stamp}.zip`;
}

export function ExportSettingsSection() {
  const { client, demo, relayUrl, pubkey, channels, profiles } = useWorkspace();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [status, setStatus] = useState<Status>({ phase: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const sinceId = useId();
  const untilId = useId();
  const unmountedRef = useRef(false);
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      abortRef.current?.abort();
    };
  }, []);
  const available = useMemo(
    () =>
      exportableChannels(channels)
        .map((channel) => ({ channel, label: channelDisplayName(channel, profiles, pubkey) }))
        .sort((left, right) => left.label.localeCompare(right.label, getLocale())),
    [channels, profiles, pubkey],
  );
  const running = status.phase === "running";
  const range: ExportRange = { since: dayBoundary(since, false), until: dayBoundary(until, true) };
  const rangeInvalid = range.since !== null && range.until !== null && range.since > range.until;
  const chosen = available.filter(({ channel }) => selected.has(channel.id));
  const numberFormat = new Intl.NumberFormat(getLocale());

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const start = async () => {
    if (!client || !chosen.length || rangeInvalid) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus({ phase: "running", progress: null });
    try {
      const { manifest, zip } = await runContentExport({
        client,
        channels: chosen.map(({ channel, label }) => ({
          id: channel.id,
          name: label,
          type: channel.type,
          visibility: channel.visibility,
        })),
        range,
        relayUrl,
        exporterPubkey: pubkey,
        signal: controller.signal,
        labels: {
          channelId: t("collab.export.transcriptChannelId"),
          edited: t("collab.export.transcriptEdited"),
          deleted: t("collab.export.transcriptDeleted"),
          reactions: t("collab.export.transcriptReactions"),
          canvas: t("collab.export.transcriptCanvas"),
          empty: t("collab.export.transcriptEmpty"),
        },
        onProgress: (progress) => {
          if (!controller.signal.aborted) setStatus({ phase: "running", progress });
        },
      });
      if (controller.signal.aborted) throw new DOMException("cancelled", "AbortError");
      downloadBlob(
        new Blob([zip as Uint8Array<ArrayBuffer>], { type: "application/zip" }),
        archiveFileName(new Date(manifest.exportedAt)),
      );
      setStatus({
        phase: "done",
        channels: manifest.channels.length,
        events: manifest.channels.reduce((total, channel) => total + channel.eventCount, 0),
        truncated: manifest.channels.some((channel) => channel.truncated),
      });
    } catch (error) {
      if (unmountedRef.current) return;
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus({ phase: "idle" });
        toast(t("collab.export.cancelled"));
      } else {
        const message = error instanceof Error && error.message ? error.message : "";
        setStatus({ phase: "error", message: t("collab.export.failed", { reason: message }) });
      }
    } finally {
      abortRef.current = null;
    }
  };

  return (
    <div className="max-w-2xl">
      <h2 className="text-xl font-semibold">{t("collab.export.title")}</h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{t("collab.export.intro")}</p>

      <section aria-labelledby={`${sinceId}-channels`} className="mt-6 border-y py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold" id={`${sinceId}-channels`}>
            {t("collab.export.channels")}
          </h3>
          {available.length ? (
            <div className="flex gap-1">
              <button
                className="h-8 rounded-md px-2.5 text-xs font-medium hover:bg-foreground/7 disabled:opacity-40"
                disabled={running || selected.size === available.length}
                type="button"
                onClick={() => setSelected(new Set(available.map(({ channel }) => channel.id)))}
              >
                {t("collab.export.selectAll")}
              </button>
              <button
                className="h-8 rounded-md px-2.5 text-xs font-medium hover:bg-foreground/7 disabled:opacity-40"
                disabled={running || selected.size === 0}
                type="button"
                onClick={() => setSelected(new Set())}
              >
                {t("collab.export.clearSelection")}
              </button>
            </div>
          ) : null}
        </div>
        {demo || !client ? (
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            {t("collab.export.unavailable")}
          </p>
        ) : available.length ? (
          <ul className="mt-3 max-h-72 divide-y overflow-y-auto rounded-md border">
            {available.map(({ channel, label }) => (
              <li key={channel.id}>
                <label className="flex min-h-10 cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-foreground/4">
                  <input
                    checked={selected.has(channel.id)}
                    className="h-4 w-4 accent-primary"
                    disabled={running}
                    type="checkbox"
                    onChange={() => toggle(channel.id)}
                  />
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {channel.visibility === "private"
                      ? t("collab.export.private")
                      : t("collab.export.open")}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            {t("collab.export.noChannels")}
          </p>
        )}
      </section>

      <section className="mt-6">
        <h3 className="text-sm font-semibold">{t("collab.export.dateRange")}</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {t("collab.export.dateRangeHint")}
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-medium" htmlFor={sinceId}>
            {t("collab.export.from")}
            <input
              className="mt-1.5 h-9 w-full rounded-md border bg-background px-3 text-sm"
              disabled={running}
              id={sinceId}
              max={until || undefined}
              type="date"
              value={since}
              onChange={(event) => setSince(event.target.value)}
            />
          </label>
          <label className="block text-xs font-medium" htmlFor={untilId}>
            {t("collab.export.to")}
            <input
              className="mt-1.5 h-9 w-full rounded-md border bg-background px-3 text-sm"
              disabled={running}
              id={untilId}
              min={since || undefined}
              type="date"
              value={until}
              onChange={(event) => setUntil(event.target.value)}
            />
          </label>
        </div>
        {rangeInvalid ? (
          <p className="mt-2 text-xs text-destructive" role="alert">
            {t("collab.export.rangeInvalid")}
          </p>
        ) : null}
      </section>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {running ? (
          <button
            className="inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium hover:bg-foreground/5"
            type="button"
            onClick={() => abortRef.current?.abort()}
          >
            <X aria-hidden="true" className="mr-2 h-4 w-4" />
            {t("collab.export.cancel")}
          </button>
        ) : (
          <button
            className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-40"
            disabled={!client || !chosen.length || rangeInvalid}
            type="button"
            onClick={() => void start()}
          >
            <Download aria-hidden="true" className="mr-2 h-4 w-4" />
            {t("collab.export.download", { count: chosen.length })}
          </button>
        )}
        <p aria-live="polite" className="min-w-0 flex-1 text-xs leading-5 text-muted-foreground">
          {status.phase === "running" ? (
            <span className="inline-flex items-center gap-2">
              <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 shrink-0 animate-spin" />
              {status.progress
                ? t("collab.export.progress", {
                    index: status.progress.channelIndex + 1,
                    total: status.progress.channelCount,
                    name: status.progress.channelName,
                    count: numberFormat.format(status.progress.fetched),
                  })
                : t("collab.export.preparing")}
            </span>
          ) : status.phase === "done" ? (
            `${t("collab.export.done", {
              channels: numberFormat.format(status.channels),
              events: numberFormat.format(status.events),
            })}${status.truncated ? ` ${t("collab.export.truncated")}` : ""}`
          ) : null}
        </p>
      </div>
      {status.phase === "error" ? (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {status.message}
        </p>
      ) : null}

      <section className="mt-8 border-t pt-4 text-xs leading-5 text-muted-foreground">
        <p>{t("collab.export.privacyNote")}</p>
        <p className="mt-2">{t("collab.export.identitySeparate")}</p>
        <p className="mt-2">{t("collab.export.snapshotsPointer")}</p>
      </section>
    </div>
  );
}
