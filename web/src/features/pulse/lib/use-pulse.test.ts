import { describe, expect, it, vi } from "vitest";
import { subscribeLive } from "@/features/pulse/lib/use-pulse";
import type { BuzzRelayClient } from "@/shared/api/relay-client";

type Lifecycle = { onClosed?: (error: Error) => void };

function fakeClient() {
  // The app's TS lib predates Promise.withResolvers, so capture the executor.
  let resolve: (stop: () => void) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const opening = new Promise<() => void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  let lifecycle: Lifecycle = {};
  const client = {
    subscribe: vi.fn((_filter: unknown, _onEvent: unknown, value: Lifecycle) => {
      lifecycle = value;
      return opening;
    }),
  } as unknown as BuzzRelayClient;
  return {
    client,
    resolve,
    reject,
    // Reactions run in registration order, so this settles after subscribeLive's handlers.
    settled: () =>
      opening.then(
        () => undefined,
        () => undefined,
      ),
    closeFromRelay: (message: string) => lifecycle.onClosed?.(new Error(message)),
  };
}

describe("subscribeLive", () => {
  it("closes a subscription whose open resolves after teardown", async () => {
    const relay = fakeClient();
    const unsubscribe = vi.fn();
    const stop = subscribeLive(relay.client, { kinds: [1] }, () => undefined, vi.fn());
    stop();
    relay.resolve(unsubscribe);
    await relay.settled();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("reports a failed open instead of leaving an unhandled rejection", async () => {
    const relay = fakeClient();
    const onError = vi.fn();
    subscribeLive(relay.client, { kinds: [1] }, () => undefined, onError);
    relay.reject(new Error("relay session closed"));
    await relay.settled();
    expect(onError).toHaveBeenCalledWith("relay session closed");
  });

  it("reports a terminal CLOSED while open, and nothing after teardown", async () => {
    const relay = fakeClient();
    const onError = vi.fn();
    const unsubscribe = vi.fn();
    const stop = subscribeLive(relay.client, { kinds: [1] }, () => undefined, onError);
    relay.resolve(unsubscribe);
    await relay.settled();
    relay.closeFromRelay("auth-required: not a member");
    expect(onError).toHaveBeenCalledWith("auth-required: not a member");
    stop();
    relay.closeFromRelay("late");
    expect(onError).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
