import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import {
  type BuzzDeepLink,
  parseBuzzDeepLink,
  stripBuzzDeepLink,
} from "@/features/push/lib/deep-link";
import {
  detectPushSupport,
  leaseRefreshKey,
  refreshPush,
  retireForeignEnrollments,
} from "@/features/push/lib/push-enrollment";
import { resolveDeepLink } from "@/features/push/lib/resolve-deep-link";
import { t } from "@/shared/i18n";

const REFRESH_DELAY_MS = 2_000;

/**
 * Background push duties for the mounted workspace: retire enrollments of
 * other identities, keep this community's lease current, and open
 * notification deep links (from the URL or the service worker) only after
 * re-checking access for the current community and identity.
 */
export function PushNotificationBridge() {
  const {
    client,
    relayUrl,
    pubkey,
    channels,
    mutedChannelIds,
    connected,
    config,
    revealMessage,
    selectChannel,
  } = useWorkspace();
  const [pendingLink, setPendingLink] = useState<BuzzDeepLink | null>(() =>
    parseBuzzDeepLink(window.location.search),
  );
  const resolving = useRef(false);
  const supported = detectPushSupport() === "supported";

  useEffect(() => {
    if (!supported) return;
    void retireForeignEnrollments(pubkey)
      .then((retired) => {
        if (retired) toast.info(t("push.retiredForeign"));
      })
      .catch(() => undefined);
  }, [pubkey, supported]);

  // Joined DMs, mutes and expiry feed the lease; republish when they change.
  // `channels` is a fresh array each render, so the effect keys on its content.
  const latest = useRef({ channels, mutedChannelIds });
  latest.current = { channels, mutedChannelIds };
  const refreshKey = leaseRefreshKey(channels, mutedChannelIds);
  useEffect(() => {
    if (!supported || !client || !connected || !refreshKey) return;
    const timer = window.setTimeout(() => {
      void refreshPush({
        client,
        relayUrl,
        pubkey,
        ...latest.current,
        communityName: config.communityName,
      }).catch(() => undefined);
    }, REFRESH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [refreshKey, client, connected, config.communityName, pubkey, relayUrl, supported]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent<{ type?: unknown; url?: unknown }>) => {
      if (event.data?.type !== "buzz-push-open" || typeof event.data.url !== "string") return;
      const link = parseBuzzDeepLink(new URL(event.data.url).search);
      if (link) setPendingLink(link);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    // Channel list loads after connect; resolving earlier would misjudge access.
    if (!pendingLink || !client || !connected || !channels.length || resolving.current) return;
    resolving.current = true;
    const search = stripBuzzDeepLink(window.location.search);
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${search}${window.location.hash}`,
    );
    void resolveDeepLink(pendingLink, {
      relayUrl,
      channels,
      fetchEvent: async (eventId) =>
        (await client.query({ ids: [eventId], limit: 1 })).find((event) => event.id === eventId) ??
        null,
    })
      .then((resolution) => {
        if (resolution.kind === "open") {
          if (resolution.eventId) {
            revealMessage(resolution.channelId, resolution.eventId, resolution.threadRootId);
          } else {
            selectChannel(resolution.channelId);
          }
        } else if (resolution.kind === "missing") {
          selectChannel(resolution.channelId);
          toast.info(t("push.linkMissing"));
        } else if (resolution.kind === "other-community") {
          toast.info(
            t("push.linkOtherCommunity", { community: new URL(resolution.relayUrl).host }),
          );
        } else {
          toast.error(t("push.linkNoAccess"));
        }
      })
      .catch(() => toast.error(t("push.linkNoAccess")))
      .finally(() => {
        resolving.current = false;
        setPendingLink(null);
      });
  }, [channels, client, connected, pendingLink, relayUrl, revealMessage, selectChannel]);

  return null;
}
