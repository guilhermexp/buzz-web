import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useHuddle } from "@/features/voice/lib/use-huddle";
import { voiceErrorMessage } from "@/features/voice/ui/voice-copy";

/**
 * Workspace-lifetime host for the Huddle session: announces session-ending
 * errors (removed from channel, huddle ended, microphone denied, connection
 * lost) once, and releases capture, audio and socket when the workspace
 * unmounts (sign-out, identity or Relay switch).
 */
export function HuddleSessionHost() {
  const { controller, snapshot } = useHuddle();
  const announced = useRef<string | null>(null);

  useEffect(() => {
    if (!controller || snapshot.phase !== "idle" || !snapshot.error) {
      announced.current = null;
      return;
    }
    if (announced.current === snapshot.error) return;
    announced.current = snapshot.error;
    toast.error(voiceErrorMessage(snapshot.error));
    controller.dismissError();
  }, [controller, snapshot.phase, snapshot.error]);

  useEffect(() => {
    if (!controller) return;
    return () => controller.hangUp();
  }, [controller]);

  return null;
}
