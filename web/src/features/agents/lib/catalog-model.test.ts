import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import {
  type AgentPersona,
  type AgentTeam,
  isPortableAcpCommand,
  isSharedEvent,
  latestByAddress,
  personaContent,
  personaFromEvent,
  personaTags,
  teamCatalogContent,
  teamCatalogFromEvent,
  teamContent,
  uniqueSlug,
} from "@/features/agents/lib/catalog-model";
import type { NostrEvent } from "@/shared/api/nostr-types";

const ALLOWED = "d".repeat(64);

function persona(overrides: Partial<AgentPersona> = {}): AgentPersona {
  return {
    id: "reviewer",
    displayName: "Reviewer",
    systemPrompt: "Review code.",
    description: null,
    avatarUrl: null,
    runtime: "custom-runtime",
    acpCommand: "/home/someone/bin/custom-acp",
    model: "m",
    provider: null,
    namePool: [],
    respondTo: "allowlist",
    respondToAllowlist: [ALLOWED],
    parallelism: 99,
    sessionPolicy: "thread",
    shared: false,
    eventId: null,
    createdAt: 0,
    ...overrides,
  };
}

const team: AgentTeam = {
  id: "team-1",
  name: "Crew",
  description: "desc",
  instructions: "Coordinate.",
  personaIds: ["reviewer"],
  shared: true,
  eventId: null,
  createdAt: 0,
};

describe("catalog sharing", () => {
  it("only treats the exact ['shared','true'] tag as shared", () => {
    const base = { id: "x", pubkey: "p", kind: 30175, created_at: 1, content: "{}", sig: "s" };
    expect(isSharedEvent({ ...base, tags: [["shared", "true"]] })).toBe(true);
    expect(isSharedEvent({ ...base, tags: [["shared", "true", "x"]] })).toBe(false);
    expect(isSharedEvent({ ...base, tags: [["shared", "yes"]] })).toBe(false);
    expect(
      isSharedEvent({
        ...base,
        tags: [
          ["shared", "true"],
          ["shared", "true"],
        ],
      }),
    ).toBe(false);
    expect(isSharedEvent({ ...base, tags: [] })).toBe(false);
  });

  it("keeps private persona fields private and strips allowlists/local commands when shared", () => {
    const privateContent = personaContent(persona());
    expect(privateContent.respond_to_allowlist).toEqual([ALLOWED]);
    expect(personaTags(persona())).toEqual([["d", "reviewer"]]);

    const sharedPersona = persona({ shared: true });
    const shared = personaContent(sharedPersona);
    expect(personaTags(sharedPersona)).toEqual([
      ["d", "reviewer"],
      ["shared", "true"],
    ]);
    expect(JSON.stringify(shared)).not.toContain(ALLOWED);
    expect(shared.respond_to).toBe("owner-only");
    expect(shared.acp_command).toBe("buzz-acp");
    expect(JSON.stringify(shared)).not.toContain("/home/someone");
    expect(shared.parallelism).toBe(32);
  });

  it("carries acp_command privately and only portable commands across share boundaries", () => {
    expect(personaContent(persona()).acp_command).toBe("/home/someone/bin/custom-acp");
    const portable = persona({ shared: true, acpCommand: "buzz-goose-acp" });
    expect(personaContent(portable).acp_command).toBe("buzz-goose-acp");
    const [member] = teamCatalogContent(team, [portable]).members as Array<Record<string, unknown>>;
    expect(member?.acp_command).toBe("buzz-goose-acp");
    const local = teamCatalogContent(team, [persona()]).members as Array<Record<string, unknown>>;
    expect(local[0]).not.toHaveProperty("acp_command");
    expect(isPortableAcpCommand("buzz-acp")).toBe(true);
    expect(isPortableAcpCommand("buzz-agent")).toBe(false);
    expect(isPortableAcpCommand("buzz-x-acp; rm -rf")).toBe(false);
  });

  it("projects a team into a 30178 body with only sanitized member fields", () => {
    const projection = teamCatalogContent(team, [
      persona({ avatarUrl: "https://buzz.example.com/a.png" }),
    ]);
    const text = JSON.stringify(projection);
    expect(projection).toMatchObject({ v: 1, name: "Crew", instructions: "Coordinate." });
    expect(text).not.toContain(ALLOWED);
    expect(text).not.toContain("respond_to_allowlist");
    expect(text).not.toContain("/home/someone");
    expect(text).not.toContain('"reviewer"');
    const [member] = projection.members as Array<Record<string, unknown>>;
    expect(member).toMatchObject({
      display_name: "Reviewer",
      respond_to: "owner-only",
      parallelism: 32,
      session_policy: "thread",
    });
    expect(member?.member_key).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(teamContent(team)).sort()).toEqual([
      "description",
      "instructions",
      "name",
      "persona_ids",
    ]);
  });

  it("round-trips signed events and keeps the newest head per address", () => {
    const secret = generateSecretKey();
    const sign = (kind: number, createdAt: number, content: unknown, tags: string[][]) =>
      finalizeEvent(
        { kind, created_at: createdAt, content: JSON.stringify(content), tags },
        secret,
      ) as NostrEvent;
    const older = sign(30175, 1, personaContent(persona()), personaTags(persona()));
    const newer = sign(30175, 2, personaContent(persona({ shared: true, displayName: "New" })), [
      ["d", "reviewer"],
      ["shared", "true"],
    ]);
    const heads = latestByAddress([older, newer]);
    expect(heads).toHaveLength(1);
    expect(personaFromEvent(heads[0] as NostrEvent)).toMatchObject({
      displayName: "New",
      shared: true,
      respondToAllowlist: [],
    });

    const catalogEvent = sign(30178, 3, teamCatalogContent(team, [persona()]), [
      ["d", "team-1"],
      ["shared", "true"],
    ]);
    expect(teamCatalogFromEvent(catalogEvent)?.members[0]).toMatchObject({
      displayName: "Reviewer",
      respondTo: "owner-only",
    });
    expect(teamCatalogFromEvent({ ...catalogEvent, content: "{}" })).toBeNull();
  });

  it("allocates unique slugs within the d-tag grammar", () => {
    expect(uniqueSlug("Code Reviewer!", new Set())).toBe("code-reviewer-");
    expect(uniqueSlug("Reviewer", new Set(["reviewer", "reviewer-2"]))).toBe("reviewer-3");
    expect(uniqueSlug("x".repeat(80), new Set(["x".repeat(64)]))).toHaveLength(64);
  });
});
