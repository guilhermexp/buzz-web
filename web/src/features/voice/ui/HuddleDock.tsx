import {
  AlertTriangle,
  HeadphoneOff,
  Headphones,
  LoaderCircle,
  Mic,
  MicOff,
  PhoneOff,
  RotateCcw,
  Settings2,
  SmilePlus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import type { HuddleController } from "@/features/voice/lib/huddle-session";
import type { HuddleSnapshot } from "@/features/voice/lib/huddle-types";
import type { AudioDevice } from "@/features/voice/lib/microphone";
import { useHuddle } from "@/features/voice/lib/use-huddle";
import { DockPopover } from "@/features/voice/ui/DockPopover";
import { HuddleParticipants, participantProfile } from "@/features/voice/ui/HuddleParticipants";
import { voiceErrorMessage } from "@/features/voice/ui/voice-copy";
import { type MessageKey, t } from "@/shared/i18n";
import { cn } from "@/shared/lib/cn";

const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉", "👏", "🙌"];

const PHASE_KEYS: Record<Exclude<HuddleSnapshot["phase"], "idle">, MessageKey> = {
  starting: "voice.phase.starting",
  joining: "voice.phase.joining",
  connected: "voice.phase.connected",
  reconnecting: "voice.phase.reconnecting",
};

function DeviceSelect({
  label,
  devices,
  value,
  onChange,
}: {
  label: string;
  devices: AudioDevice[];
  value: string | null;
  onChange: (deviceId: string | null) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
      {label}
      <select
        className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">{t("voice.systemDefault")}</option>
        {devices
          .filter((device) => device.deviceId !== "default")
          .map((device, index) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || t("voice.unnamedDevice", { index: index + 1 })}
            </option>
          ))}
      </select>
    </label>
  );
}

function AudioSettings({
  controller,
  snapshot,
}: {
  controller: HuddleController;
  snapshot: HuddleSnapshot;
}) {
  return (
    <div className="flex flex-col gap-3">
      <DeviceSelect
        devices={snapshot.inputs}
        label={t("voice.microphone")}
        value={snapshot.inputDeviceId === "default" ? null : snapshot.inputDeviceId}
        onChange={(deviceId) => void controller.selectInput(deviceId)}
      />
      {snapshot.outputSelectable ? (
        <DeviceSelect
          devices={snapshot.outputs}
          label={t("voice.speaker")}
          value={snapshot.outputDeviceId}
          onChange={(deviceId) => void controller.selectOutput(deviceId)}
        />
      ) : (
        <p className="text-xs text-muted-foreground">{t("voice.outputFixed")}</p>
      )}
    </div>
  );
}

/**
 * Live huddle bar: roster, mic/deafen, devices, reactions, leave. Rendered above
 * the channel timeline and, with `inTool`, above full-surface tool views.
 */
export function HuddleDock({ inTool = false }: { inTool?: boolean }) {
  const { controller, snapshot } = useHuddle();
  const { channels, profiles, pubkey, selectedChannel, selectChannel } = useWorkspace();
  if (!controller || snapshot.phase === "idle") return null;

  const parent = channels.find((channel) => channel.id === snapshot.parentChannelId) ?? null;
  // Selecting a channel closes any open tool, so from a tool the link is always useful.
  const elsewhere = parent && (inTool || selectedChannel?.id !== parent.id);
  const connected = snapshot.phase === "connected";
  const micLabel = snapshot.microphoneLost
    ? t("voice.microphoneUnavailable")
    : snapshot.muted
      ? t("voice.unmuteMicrophone")
      : t("voice.muteMicrophone");
  const selfName = participantProfile(profiles, pubkey.toLowerCase()).name;

  return (
    <section
      aria-label={t("voice.huddleTitle")}
      className="relative z-20 flex shrink-0 flex-col gap-2 border-b bg-[hsl(var(--buzz-positive)/0.06)] px-3 py-2 sm:px-4"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
          {connected ? (
            <Headphones
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-[hsl(var(--buzz-positive))]"
            />
          ) : (
            <LoaderCircle
              aria-hidden="true"
              className="h-4 w-4 shrink-0 animate-spin text-muted-foreground"
            />
          )}
          <span className="truncate text-[13px] font-semibold">
            {parent ? t("voice.huddleInChannel", { channel: parent.name }) : t("voice.huddleTitle")}
          </span>
          <output aria-live="polite" className="shrink-0 text-xs text-muted-foreground">
            {t(PHASE_KEYS[snapshot.phase])}
          </output>
          {elsewhere ? (
            <button
              className="min-w-0 truncate text-xs font-medium text-primary underline-offset-2 hover:underline"
              title={t("voice.openHuddleChannel", { channel: parent.name })}
              type="button"
              onClick={() => selectChannel(parent.id)}
            >
              {t("voice.openHuddleChannel", { channel: parent.name })}
            </button>
          ) : null}
        </div>

        <div className="ml-auto flex items-center gap-1">
          <button
            aria-label={micLabel}
            aria-pressed={snapshot.muted}
            className={cn(
              "buzz-icon-button",
              (snapshot.muted || snapshot.microphoneLost) && "bg-destructive/10 text-destructive",
            )}
            disabled={snapshot.microphoneLost || !connected}
            title={micLabel}
            type="button"
            onClick={() => controller.toggleMute()}
          >
            {snapshot.muted || snapshot.microphoneLost ? (
              <MicOff className="h-4 w-4" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
          </button>
          <button
            aria-label={snapshot.deafened ? t("voice.undeafen") : t("voice.deafen")}
            aria-pressed={snapshot.deafened}
            className={cn(
              "buzz-icon-button",
              snapshot.deafened && "bg-destructive/10 text-destructive",
            )}
            title={snapshot.deafened ? t("voice.undeafen") : t("voice.deafen")}
            type="button"
            onClick={() => controller.toggleDeafen()}
          >
            {snapshot.deafened ? (
              <HeadphoneOff className="h-4 w-4" />
            ) : (
              <Headphones className="h-4 w-4" />
            )}
          </button>
          <DockPopover
            icon={<Settings2 className="h-4 w-4" />}
            label={t("voice.audioSettings")}
            panelClassName="w-64"
          >
            {() => <AudioSettings controller={controller} snapshot={snapshot} />}
          </DockPopover>
          {connected ? (
            <DockPopover
              icon={<SmilePlus className="h-4 w-4" />}
              label={t("voice.reactions")}
              panelClassName="flex gap-0.5 p-1"
            >
              {(close) =>
                QUICK_REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    aria-label={t("voice.react", { emoji })}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-lg hover:bg-foreground/8"
                    type="button"
                    onClick={() => {
                      close();
                      controller
                        .sendReaction(emoji, selfName)
                        .catch(() => toast.error(t("voice.reactionFailed")));
                    }}
                  >
                    {emoji}
                  </button>
                ))
              }
            </DockPopover>
          ) : null}
          <button
            aria-label={t("voice.leaveHuddle")}
            className="ml-1 inline-flex h-8 items-center gap-1.5 rounded-md bg-destructive px-3 text-xs font-medium text-destructive-foreground shadow-xs transition-colors hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            title={t("voice.leaveHuddle")}
            type="button"
            onClick={() => void controller.leave()}
          >
            <PhoneOff aria-hidden="true" className="h-3.5 w-3.5" />
            {t("voice.leave")}
          </button>
        </div>
      </div>

      <HuddleParticipants muted={snapshot.muted} participants={snapshot.participants} />

      {snapshot.reactions.length ? (
        <ul aria-live="polite" className="flex flex-wrap gap-1.5">
          {snapshot.reactions.map((reaction) => {
            const name =
              reaction.senderName ||
              participantProfile(profiles, reaction.pubkey.toLowerCase()).name;
            return (
              <li
                key={reaction.id}
                className="rounded-full border bg-background px-2 py-0.5 text-xs shadow-xs"
              >
                {t("voice.reactionFrom", { name, emoji: reaction.emoji })}
              </li>
            );
          })}
        </ul>
      ) : null}

      {snapshot.error ? (
        <div
          className="flex items-center gap-2 rounded-md bg-destructive/8 px-2.5 py-1.5 text-xs text-destructive"
          role="alert"
        >
          <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1">{voiceErrorMessage(snapshot.error)}</span>
          {snapshot.microphoneLost ? (
            <button
              className="inline-flex shrink-0 items-center gap-1 font-medium underline-offset-2 hover:underline"
              type="button"
              onClick={() => void controller.retryMicrophone()}
            >
              <RotateCcw aria-hidden="true" className="h-3 w-3" />
              {t("voice.retryMicrophone")}
            </button>
          ) : (
            <button
              aria-label={t("voice.dismissError")}
              className="shrink-0 rounded p-0.5 hover:bg-destructive/10"
              title={t("voice.dismissError")}
              type="button"
              onClick={() => controller.dismissError()}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ) : null}
    </section>
  );
}
