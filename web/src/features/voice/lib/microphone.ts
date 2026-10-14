export type MicrophoneErrorCode = "denied" | "notFound" | "busy" | "insecure" | "unavailable";

/** Map a getUserMedia failure to a stable, user-actionable category. */
export function microphoneErrorCode(cause: unknown): MicrophoneErrorCode {
  if (typeof window !== "undefined" && !window.isSecureContext) return "insecure";
  const name = cause instanceof DOMException || cause instanceof Error ? cause.name : "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
    return "denied";
  }
  if (
    name === "NotFoundError" ||
    name === "OverconstrainedError" ||
    name === "DevicesNotFoundError"
  ) {
    return "notFound";
  }
  if (name === "NotReadableError" || name === "AbortError" || name === "TrackStartError") {
    return "busy";
  }
  return "unavailable";
}

/** Voice capture constraints used by Huddles (desktop parity: AEC, NS, AGC). */
export function huddleAudioConstraints(deviceId: string | null): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
}

export type AudioDevice = { deviceId: string; label: string };

/** Enumerate audio devices; labels are empty until permission is granted. */
export async function listAudioDevices(): Promise<{
  inputs: AudioDevice[];
  outputs: AudioDevice[];
}> {
  if (!navigator.mediaDevices?.enumerateDevices) return { inputs: [], outputs: [] };
  const devices = await navigator.mediaDevices.enumerateDevices();
  const pick = (kind: MediaDeviceKind) =>
    devices
      .filter((device) => device.kind === kind && device.deviceId)
      .map((device) => ({ deviceId: device.deviceId, label: device.label }));
  return { inputs: pick("audioinput"), outputs: pick("audiooutput") };
}

/** Whether the browser can route an AudioContext to a chosen output device. */
export function supportsOutputSelection(): boolean {
  return typeof AudioContext !== "undefined" && "setSinkId" in AudioContext.prototype;
}
