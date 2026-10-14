import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import {
  detectPushSupport,
  disablePush,
  enablePush,
  fetchPushDescriptor,
  refreshPush,
} from "@/features/push/lib/push-enrollment";
import { listReceivedPushes } from "@/features/push/lib/push-idb";
import {
  type PushEnrollmentRecord,
  type PushPreferences,
  readEnrollment,
} from "@/features/push/lib/push-store";

export type PushStatus =
  | "checking"
  | "unsupported"
  | "insecure"
  | "relay-unsupported"
  | "blocked"
  | "off"
  | "stale"
  | "on";

function currentPermission(): NotificationPermission {
  return typeof Notification === "undefined" ? "denied" : Notification.permission;
}

/** Enrollment state and actions for the current community + identity. */
export function usePushEnrollment() {
  const { client, relayUrl, pubkey, channels, mutedChannelIds, demo, config } = useWorkspace();
  const support = detectPushSupport();
  const [permission, setPermission] = useState(currentPermission);
  const [record, setRecord] = useState<PushEnrollmentRecord | null>(() =>
    support === "supported" ? readEnrollment(relayUrl, pubkey) : null,
  );
  const [subscriptionEndpoint, setSubscriptionEndpoint] = useState<string | null | undefined>();
  const [lastReceivedAt, setLastReceivedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const descriptor = useQuery({
    queryKey: ["push-descriptor", relayUrl],
    enabled: support === "supported" && !demo,
    staleTime: 5 * 60_000,
    queryFn: () => fetchPushDescriptor(relayUrl),
  });

  const reloadBrowserState = useCallback(async () => {
    if (support !== "supported") return;
    setPermission(currentPermission());
    setRecord(readEnrollment(relayUrl, pubkey));
    const registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
    const subscription = await registration?.pushManager.getSubscription();
    setSubscriptionEndpoint(subscription?.endpoint ?? null);
    const origin = readEnrollment(relayUrl, pubkey)?.origin;
    const received = await listReceivedPushes().catch(() => []);
    const latest = received
      .filter((entry) => entry.shown && entry.origin === origin)
      .reduce((max, entry) => Math.max(max, entry.receivedAt), 0);
    setLastReceivedAt(latest || null);
  }, [pubkey, relayUrl, support]);

  useEffect(() => {
    void reloadBrowserState();
    if (support !== "supported" || !navigator.permissions?.query) return;
    let status: PermissionStatus | null = null;
    const onChange = () => void reloadBrowserState();
    void navigator.permissions
      .query({ name: "notifications" })
      .then((result) => {
        status = result;
        result.addEventListener("change", onChange);
      })
      .catch(() => undefined);
    return () => status?.removeEventListener("change", onChange);
  }, [reloadBrowserState, support]);

  const run = useCallback(
    async (operation: () => Promise<unknown>) => {
      setBusy(true);
      try {
        await operation();
      } finally {
        await reloadBrowserState().catch(() => undefined);
        setBusy(false);
      }
    },
    [reloadBrowserState],
  );

  const context = client
    ? { client, relayUrl, pubkey, channels, mutedChannelIds, communityName: config.communityName }
    : null;

  let status: PushStatus;
  if (support === "unsupported" || demo) status = "unsupported";
  else if (support === "insecure") status = "insecure";
  else if (descriptor.isPending) status = "checking";
  else if (!descriptor.data) status = "relay-unsupported";
  else if (permission === "denied") status = "blocked";
  else if (!record?.active) {
    status = record && record.endpoint === null && record.fingerprint !== null ? "stale" : "off";
  } else if (subscriptionEndpoint === undefined) status = "checking";
  else if (permission !== "granted" || subscriptionEndpoint !== record.endpoint) status = "stale";
  else status = "on";

  return {
    status,
    busy,
    preferences: record?.preferences ?? null,
    lastReceivedAt,
    enable: (preferences?: PushPreferences) =>
      run(async () => {
        if (!context) throw new Error("push-offline");
        await enablePush({ ...context, preferences });
      }),
    disable: () =>
      run(async () => {
        if (!client) throw new Error("push-offline");
        await disablePush({ client, relayUrl, pubkey });
      }),
    updatePreferences: (preferences: PushPreferences) =>
      run(async () => {
        if (!context) throw new Error("push-offline");
        await refreshPush({ ...context, preferences, force: true });
      }),
  };
}
