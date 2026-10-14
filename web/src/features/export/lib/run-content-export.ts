import { describeSystemMessage, systemMessagePubkeys } from "@/features/chat/lib/chat-model";
import { truncatePubkey } from "@/shared/lib/pubkey";
import {
  buildContentArchive,
  type ContentExportManifest,
  type ExportChannelSummary,
  type ExportedChannel,
} from "./content-export-archive";
import { fetchAuthorProfiles, fetchChannelEvents, type QueryClient } from "./content-export-fetch";
import { renderChannelTranscript, type TranscriptLabels } from "./content-export-markdown";
import { channelEventsInScope, type ExportRange, scopeChannelEvents } from "./content-export-model";

export type ExportProgress = {
  channelIndex: number;
  channelCount: number;
  channelName: string;
  fetched: number;
};

export type ContentExportResult = { manifest: ContentExportManifest; zip: Uint8Array };

export async function runContentExport(input: {
  client: QueryClient;
  channels: readonly ExportChannelSummary[];
  range: ExportRange;
  relayUrl: string;
  exporterPubkey: string;
  signal: AbortSignal;
  labels: Omit<TranscriptLabels, "nameOf" | "describeSystem">;
  onProgress: (progress: ExportProgress) => void;
}): Promise<ContentExportResult> {
  const fetched = [];
  for (const [channelIndex, channel] of input.channels.entries()) {
    const report = (count: number) =>
      input.onProgress({
        channelIndex,
        channelCount: input.channels.length,
        channelName: channel.name,
        fetched: count,
      });
    report(0);
    const result = await fetchChannelEvents(
      input.client,
      channel.id,
      input.range,
      input.signal,
      report,
    );
    fetched.push({
      channel,
      inScope: channelEventsInScope(result.events, channel.id, input.range),
      archived: scopeChannelEvents(result.events, channel.id, input.range),
      canvasHead: result.canvasHead,
      truncated: result.truncated,
    });
  }

  const authors = fetched.flatMap(({ archived, canvasHead }) => [
    ...archived.flatMap((event) => [event.pubkey, ...systemMessagePubkeys(event)]),
    ...(canvasHead ? [canvasHead.pubkey] : []),
  ]);
  const profiles = await fetchAuthorProfiles(input.client, authors, input.signal);
  const labels: TranscriptLabels = {
    ...input.labels,
    nameOf: (pubkey) => profiles[pubkey.toLowerCase()]?.name ?? truncatePubkey(pubkey),
    describeSystem: (event) => {
      const presentation = describeSystemMessage(event, "", profiles);
      return presentation ? `${presentation.title} ${presentation.action}` : null;
    },
  };

  const channels: ExportedChannel[] = fetched.map(
    ({ channel, inScope, archived, canvasHead, truncated }) => ({
      channel,
      events: canvasHead ? [...archived, canvasHead] : archived,
      markdown: renderChannelTranscript(channel, inScope, canvasHead, labels),
      truncated,
    }),
  );
  return buildContentArchive({
    relayUrl: input.relayUrl,
    exporterPubkey: input.exporterPubkey,
    exportedAt: new Date(),
    range: input.range,
    channels,
  });
}
