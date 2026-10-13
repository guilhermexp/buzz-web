import { Check, LoaderCircle, Mic, Trash2 } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";
import { useVoiceNoteRecorder } from "@/features/voice/lib/use-voice-note-recorder";
import {
  formatVoiceNoteDuration,
  VOICE_NOTE_MAX_DURATION_SECONDS,
} from "@/features/voice/lib/voice-note";
import { voiceErrorMessage } from "@/features/voice/ui/voice-copy";
import { t } from "@/shared/i18n";

const METER_BARS = 16;

/**
 * Composer control that records a voice note. The recording stays local: the
 * finished WAV is handed to `onRecorded`; discarding produces nothing.
 */
export function ComposerVoiceNote({
  disabled,
  onRecorded,
  onRecordingChange,
}: {
  disabled: boolean;
  onRecorded: (file: File, durationSeconds: number) => void;
  onRecordingChange?: (recording: boolean) => void;
}) {
  const recorder = useVoiceNoteRecorder(({ file, durationSeconds }) =>
    onRecorded(file, durationSeconds),
  );
  const active = recorder.status !== "idle";

  // The composer may unmount this control in the same render that receives the
  // finished note, so the end of recording is also reported on cleanup.
  useEffect(() => {
    if (!active) return;
    onRecordingChange?.(true);
    return () => onRecordingChange?.(false);
  }, [active, onRecordingChange]);

  useEffect(() => {
    if (!recorder.error) return;
    toast.error(voiceErrorMessage(recorder.error));
    recorder.clearError();
  }, [recorder.error, recorder.clearError]);

  if (!active) {
    return (
      <button
        aria-label={t("voice.recordNote")}
        className="buzz-icon-button"
        disabled={disabled}
        title={t("voice.recordNote")}
        type="button"
        onClick={() => void recorder.start()}
      >
        <Mic className="h-4 w-4" />
      </button>
    );
  }

  const recording = recorder.status === "recording";
  const remaining = VOICE_NOTE_MAX_DURATION_SECONDS - recorder.elapsedSeconds;
  const bars = recorder.levels.slice(-METER_BARS);
  return (
    <div className="flex min-w-0 items-center gap-1.5 rounded-md bg-destructive/8 py-0.5 pl-2 pr-0.5">
      {recording ? (
        <span
          aria-hidden="true"
          className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-destructive"
        />
      ) : (
        <LoaderCircle
          aria-hidden="true"
          className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground"
        />
      )}
      <span
        aria-live="polite"
        className="shrink-0 text-xs font-medium tabular-nums text-foreground"
      >
        {recorder.status === "requesting"
          ? t("voice.requestingMicrophone")
          : recorder.status === "processing"
            ? t("voice.preparingNote")
            : t("voice.recordingElapsed", {
                time: formatVoiceNoteDuration(recorder.elapsedSeconds),
              })}
      </span>
      {recording ? (
        <span aria-hidden="true" className="hidden h-4 items-center gap-px sm:flex">
          {Array.from({ length: METER_BARS }, (_, index) => {
            const level = bars[index - (METER_BARS - bars.length)] ?? 0;
            return (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed meter slots
                key={index}
                className="w-0.5 rounded-full bg-destructive/70"
                style={{ height: `${Math.max(2, Math.round(level * 16))}px` }}
              />
            );
          })}
        </span>
      ) : null}
      {recording && remaining <= 30 ? (
        <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
          {t("voice.recordingRemaining", { time: formatVoiceNoteDuration(remaining) })}
        </span>
      ) : null}
      <button
        aria-label={t("voice.discardNote")}
        className="buzz-icon-button h-7 w-7"
        disabled={recorder.status === "processing"}
        title={t("voice.discardNote")}
        type="button"
        onClick={recorder.discard}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
      <button
        aria-label={t("voice.finishNote")}
        className="buzz-icon-button h-7 w-7 text-foreground"
        disabled={!recording}
        title={t("voice.finishNote")}
        type="button"
        onClick={recorder.finish}
      >
        <Check className="h-4 w-4" />
      </button>
    </div>
  );
}
