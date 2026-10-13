import { describe, expect, it } from "vitest";
import {
  communityList,
  configForCommunity,
  defaultCommunityName,
  parseSavedCommunities,
} from "@/features/workspace/lib/saved-communities";
import type { RuntimeConfig } from "@/shared/config/runtime-config";

const config: RuntimeConfig = {
  communityName: "Community A",
  relayUrl: "ws://127.0.0.1:47300",
  communities: [],
  agents: [{ pubkey: "c".repeat(64), name: "Codex" }],
  agentControlUrl: "http://127.0.0.1:47410",
  features: { projects: true, forum: true },
  demoMode: false,
};

describe("saved communities", () => {
  it("normalizes, de-duplicates and rejects non-WebSocket Relay URLs", () => {
    const parsed = parseSavedCommunities(
      JSON.stringify([
        { name: "B", relayUrl: "ws://127.0.0.1:47320/" },
        { name: "B again", relayUrl: "ws://127.0.0.1:47320" },
        { name: "Bad", relayUrl: "https://buzz.example.com" },
        { relayUrl: "wss://relay.buzz.example.com" },
        "garbage",
      ]),
    );
    expect(parsed.map((community) => [community.name, community.relayUrl])).toEqual([
      ["B", "ws://127.0.0.1:47320"],
      ["Buzz", "wss://relay.buzz.example.com"],
    ]);
  });

  it("always lists the configured community first and never duplicates it", () => {
    const list = communityList(
      config,
      parseSavedCommunities(
        JSON.stringify([
          { name: "Copy", relayUrl: config.relayUrl },
          { relayUrl: "ws://127.0.0.1:47320" },
        ]),
      ),
    );
    expect(list.map((community) => [community.relayUrl, community.configured])).toEqual([
      ["ws://127.0.0.1:47300", true],
      ["ws://127.0.0.1:47320", false],
    ]);
    expect(list[1]?.name).toBe(defaultCommunityName("ws://127.0.0.1:47320"));
  });

  it("does not leak the configured Relay's agents, Agent Control or flags to another community", () => {
    const [, other] = communityList(
      config,
      parseSavedCommunities(JSON.stringify([{ name: "B", relayUrl: "ws://127.0.0.1:47320" }])),
    );
    if (!other) throw new Error("missing community");
    const scoped = configForCommunity(config, other);
    expect(scoped).toMatchObject({
      relayUrl: "ws://127.0.0.1:47320",
      communityName: "B",
      agents: [],
      agentControlUrl: null,
      features: { projects: false, forum: false },
    });
    expect(configForCommunity(config, communityList(config, [])[0] ?? other)).toBe(config);
  });
});
