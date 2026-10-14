import { AudioLines, LoaderCircle, Pause, Play, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatVoiceNoteDuration } from "@/features/voice/lib/voice-note";
import { authenticatedMediaObjectUrl } from "@/shared/api/media-client";
import { t } from "@/shared/i18n";

type Source = { url: string; relayUrl: string } | { file: File };

/** Play a voice note — a local recording before send, or an uploaded one. */
export function VoiceNoteAttachment({
  source,
  durationSeconds,
  onRemove,
}: {
  source: Source;
  durationSeconds?: number;
  onRemove?: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [mediaDuration, setMediaDuration] = useState<number | null>(null);
  const file = "file" in source ? source.file : null;
  const remoteUrl = "url" in source ? source.url : null;
  const relayUrl = "relayUrl" in source ? source.relayUrl : null;

  useEffect(() => {
    setLoadFailed(false);
    setObjectUrl(null);
    if (file) {
      const url = URL.createObjectURL(file);
      setObjectUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    if (!remoteUrl || !relayUrl) return;
    let cancelled = false;
    authenticatedMediaObjectUrl(remoteUrl, relayUrl).then(
      (url) => {
        if (!cancelled) setObjectUrl(url);
      },
      () => {
        if (!cancelled) setLoadFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [file, remoteUrl, relayUrl]);

  useEffect(() => () => audioRef.current?.pause(), []);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    audio.play().catch(() => {
      setPlaying(false);
      setLoadFailed(true);
    });
  };

  const total = mediaDuration ?? durationSeconds ?? 0;
  const progress = total > 0 ? Math.min(1, position / total) : 0;
  const ready = Boolean(objectUrl) && !loadFailed;

  return (
    <div className="inline-flex w-full max-w-72 items-center gap-2 rounded-md border border-border/70 bg-background/70 py-1 pl-1 pr-2 text-xs">
      <button
        aria-label={playing ? t("voice.pauseNote") : t("voice.playNote")}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity disabled:opacity-35"
        disabled={!ready}
        title={playing ? t("voice.pauseNote") : t("voice.playNote")}
        type="button"
        onClick={toggle}
      >
        {!objectUrl && !loadFailed ? (
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
        ) : playing ? (
          <Pause className="h-3.5 w-3.5" />
        ) : (
          <Play className="ml-0.5 h-3.5 w-3.5" />
        )}
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-1 text-muted-foreground">
          <AudioLines aria-hidden="true" className="h-3 w-3 shrink-0" />
          <span className="truncate">
            {loadFailed ? t("voice.noteUnavailable") : t("voice.noteLabel")}
          </span>
        </span>
        <span aria-hidden="true" className="h-1 overflow-hidden rounded-full bg-foreground/10">
          <span
            className="block h-full rounded-full bg-foreground/55"
            style={{ width: `${progress * 100}%` }}
          />
        </span>
      </div>
      <span className="shrink-0 tabular-nums text-muted-foreground">
        {formatVoiceNoteDuration(playing || position > 0 ? position : total)}
      </span>
      {onRemove ? (
        <button
          aria-label={t("voice.removeNote")}
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
          title={t("voice.removeNote")}
          type="button"
          onClick={() => {
            audioRef.current?.pause();
            onRemove();
          }}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
      {objectUrl ? (
        // biome-ignore lint/a11y/useMediaCaption: voice notes carry no caption track; the controls above are the accessible surface
        <audio
          ref={audioRef}
          preload="metadata"
          src={objectUrl}
          onEnded={() => {
            setPlaying(false);
            setPosition(0);
          }}
          onError={() => setLoadFailed(true)}
          onLoadedMetadata={(event) => {
            const value = event.currentTarget.duration;
            if (Number.isFinite(value) && value > 0) setMediaDuration(value);
          }}
          onPause={() => setPlaying(false)}
          onPlay={() => setPlaying(true)}
          onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
        />
      ) : null}
    </div>
  );
}
