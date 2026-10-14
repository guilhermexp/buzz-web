import { MicOff } from "lucide-react";
import { useEffect } from "react";
import type { UserProfile } from "@/features/chat/lib/chat-types";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import { Avatar } from "@/features/chat/ui/Avatar";
import type { HuddleParticipant } from "@/features/voice/lib/huddle-types";
import { t } from "@/shared/i18n";
import { cn } from "@/shared/lib/cn";
import { truncatePubkey } from "@/shared/lib/pubkey";

export function participantProfile(
  profiles: Record<string, UserProfile>,
  pubkey: string,
): UserProfile {
  return (
    profiles[pubkey] ?? {
      pubkey,
      name: truncatePubkey(pubkey),
      about: "",
      picture: null,
      isAgent: false,
    }
  );
}

/** Everyone connected to the huddle audio room, including this user. */
export function HuddleParticipants({
  participants,
  muted,
}: {
  participants: HuddleParticipant[];
  muted: boolean;
}) {
  const { profiles, relayUrl, ensureProfiles } = useWorkspace();
  const missing = participants
    .map((participant) => participant.pubkey)
    .filter((pubkey) => !profiles[pubkey])
    .join(",");

  useEffect(() => {
    if (missing) void ensureProfiles(missing.split(","));
  }, [missing, ensureProfiles]);

  return (
    <ul
      aria-label={t("voice.participants")}
      className="flex min-w-0 flex-wrap items-center gap-1.5"
    >
      {participants.map((participant) => {
        const profile = participantProfile(profiles, participant.pubkey);
        const name = participant.self
          ? t("voice.participantSelf", { name: profile.name })
          : profile.name;
        const selfMuted = participant.self && muted;
        return (
          <li
            key={participant.pubkey}
            className="flex min-w-0 max-w-44 items-center gap-1.5 rounded-full bg-foreground/5 py-0.5 pl-0.5 pr-2"
            title={participant.speaking ? `${name} · ${t("voice.speaking")}` : name}
          >
            <span
              className={cn(
                "relative shrink-0 rounded-full ring-2 ring-offset-1 ring-offset-background transition-shadow duration-150",
                participant.speaking ? "ring-[hsl(var(--buzz-positive))]" : "ring-transparent",
              )}
            >
              <Avatar profile={profile} relayUrl={relayUrl} size={22} />
            </span>
            <span className="truncate text-xs font-medium">{name}</span>
            {participant.speaking ? <span className="sr-only">{t("voice.speaking")}</span> : null}
            {selfMuted ? (
              <MicOff
                aria-label={t("voice.muted")}
                className="h-3 w-3 shrink-0 text-muted-foreground"
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
