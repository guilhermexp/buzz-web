import { unzlibSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { AgentPersona, AgentTeam } from "@/features/agents/lib/catalog-model";
import {
  agentSnapshotFromPersona,
  parseAgentSnapshot,
  personaDraftFromAgentSnapshot,
  readAgentSnapshotFile,
  SnapshotError,
  snapshotSlug,
} from "./agent-snapshot";
import { encodeAgentSnapshotPng, encodeTeamSnapshotPng } from "./snapshot-card";
import { readPngChunks } from "./snapshot-png";
import { crc32 } from "./snapshot-png-encode";
import { visibleTextViolation } from "./snapshot-validation";
import {
  readAnySnapshotFile,
  readTeamSnapshotFile,
  teamDraftFromSnapshot,
  teamSnapshotFromTeam,
} from "./team-snapshot";

/**
 * What desktop `build_snapshot(minimal_record(), None, [], None)` serializes to
 * (agent_snapshot_tests.rs): camelCase, None/empty fields omitted, memory level "none".
 */
const DESKTOP_AGENT_FIXTURE = {
  format: "buzz-agent-snapshot",
  version: 1,
  definition: {
    name: "Test Agent Display",
    sourceIsBuiltin: false,
    systemPrompt: "You are a test agent.",
    model: "claude-opus-4",
    provider: "anthropic",
    parallelism: 2,
    idleTimeoutSeconds: 30,
    maxTurnDurationSeconds: 600,
  },
  profile: { displayName: "Test Agent Display", avatarUrl: "https://example.com/avatar.png" },
  memory: { level: "none" },
};

const PERSONA: AgentPersona = {
  id: "persona-uuid-SENTINEL",
  displayName: "Code Reviewer 🐝",
  systemPrompt: "Review changes.\n\tCall out security risks.",
  description: "Reviews pull requests",
  avatarUrl: "https://example.com/reviewer.png",
  runtime: "goose",
  acpCommand: "buzz-goose-acp",
  model: "claude-opus-4",
  provider: "anthropic",
  namePool: ["Ada", "Grace"],
  respondTo: "anyone",
  respondToAllowlist: [],
  parallelism: 3,
  sessionPolicy: "thread",
  shared: true,
  eventId: "e".repeat(64),
  createdAt: 1_700_000_000,
};

function jsonFile(value: unknown, name = "x.agent.json"): File {
  return new File([JSON.stringify(value)], name, { type: "application/json" });
}

function expectSnapshotError(run: () => unknown) {
  expect(run).toThrow(SnapshotError);
}

function crcless(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  new DataView(chunk.buffer).setUint32(0, data.length);
  chunk.set(new TextEncoder().encode(type), 4);
  chunk.set(data, 8);
  return chunk;
}

/** PNG carrying a tEXt chunk; the reader does not check CRCs, so they are left zero. */
function pngWithText(
  keyword: string,
  text: string,
  width = 1,
  height = 1,
): Uint8Array<ArrayBuffer> {
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, width);
  new DataView(ihdr.buffer).setUint32(4, height);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const textData = new TextEncoder().encode(`${keyword}\0${text}`);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    crcless("IHDR", ihdr),
    crcless("tEXt", textData),
    crcless("IDAT", new Uint8Array([1, 2, 3])),
    crcless("IEND", new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

describe("agent snapshot", () => {
  it("accepts desktop's serialized snapshot and maps it to a persona draft", () => {
    const snapshot = parseAgentSnapshot(DESKTOP_AGENT_FIXTURE);
    expect(snapshot).toEqual(DESKTOP_AGENT_FIXTURE);
    expect(personaDraftFromAgentSnapshot(snapshot)).toMatchObject({
      displayName: "Test Agent Display",
      systemPrompt: "You are a test agent.",
      avatarUrl: "https://example.com/avatar.png",
      parallelism: 2,
      respondTo: null,
      sessionPolicy: "channel",
    });
  });

  it("round-trips a persona through desktop-valid JSON without ids, sharing state, or event ids", () => {
    const snapshot = agentSnapshotFromPersona(PERSONA);
    const json = JSON.stringify(snapshot);
    expect(json).not.toContain("SENTINEL");
    expect(json).not.toContain(PERSONA.eventId);
    expect(json).not.toMatch(/nsec|privateKey|private_key|authTag|envVars|relayUrl|"id"|"shared"/);
    expect(snapshot.memory).toEqual({ level: "none" });
    const reparsed = parseAgentSnapshot(JSON.parse(json));
    const { id, shared, eventId, createdAt, ...draft } = PERSONA;
    expect(personaDraftFromAgentSnapshot(reparsed)).toEqual(draft);
  });

  it("maps web-only 'nobody' to desktop's owner-only default and clears foreign allowlists on import", () => {
    const nobody = agentSnapshotFromPersona({ ...PERSONA, respondTo: "nobody" });
    expect(nobody.definition.respondTo).toBeUndefined();
    const allowlisted = parseAgentSnapshot({
      ...DESKTOP_AGENT_FIXTURE,
      definition: {
        ...DESKTOP_AGENT_FIXTURE.definition,
        respondTo: "allowlist",
        respondToAllowlist: ["A".repeat(64)],
      },
    });
    expect(personaDraftFromAgentSnapshot(allowlisted)).toMatchObject({
      respondTo: "owner-only",
      respondToAllowlist: [],
    });
    const empty = parseAgentSnapshot({
      ...DESKTOP_AGENT_FIXTURE,
      definition: { ...DESKTOP_AGENT_FIXTURE.definition, respondTo: "allowlist" },
    });
    expectSnapshotError(() => personaDraftFromAgentSnapshot(empty));
  });

  it.each([
    ["wrong format", { ...DESKTOP_AGENT_FIXTURE, format: "buzz-agent-snapshot-v9" }],
    ["future version", { ...DESKTOP_AGENT_FIXTURE, version: 2 }],
    [
      "empty name",
      { ...DESKTOP_AGENT_FIXTURE, definition: { ...DESKTOP_AGENT_FIXTURE.definition, name: "  " } },
    ],
    [
      "machine-local ACP command",
      {
        ...DESKTOP_AGENT_FIXTURE,
        definition: { ...DESKTOP_AGENT_FIXTURE.definition, acpCommand: "/usr/local/bin/acp" },
      },
    ],
    [
      "bidi override in prompt",
      {
        ...DESKTOP_AGENT_FIXTURE,
        definition: { ...DESKTOP_AGENT_FIXTURE.definition, systemPrompt: "safe\u202Eevil" },
      },
    ],
    [
      "overlong description",
      { ...DESKTOP_AGENT_FIXTURE, profile: { displayName: "A", about: "x".repeat(281) } },
    ],
    [
      "memory none with entries",
      {
        ...DESKTOP_AGENT_FIXTURE,
        memory: { level: "none", entries: [{ slug: "core", body: "x" }] },
      },
    ],
    ["missing memory", { ...DESKTOP_AGENT_FIXTURE, memory: undefined }],
  ])("rejects %s", (_label, value) => {
    expectSnapshotError(() => parseAgentSnapshot(value));
  });

  it("accepts portable buzz-*-acp aliases and rendered emoji sequences", () => {
    expect(
      parseAgentSnapshot({
        ...DESKTOP_AGENT_FIXTURE,
        definition: { ...DESKTOP_AGENT_FIXTURE.definition, acpCommand: "buzz-codex-acp" },
        profile: { displayName: "Reviewer 👩‍💻 1️⃣" },
      }).definition.acpCommand,
    ).toBe("buzz-codex-acp");
    expect(visibleTextViolation("a\u200Db", false)).toMatchObject({ reason: "invisible" });
  });

  it("reads desktop PNG cards, refuses locked cards, and adopts a real PNG body as avatar", async () => {
    const encoded = btoa(JSON.stringify(DESKTOP_AGENT_FIXTURE));
    const placeholder = pngWithText("buzz_agent_snapshot", encoded);
    const fromPlaceholder = await readAgentSnapshotFile(new File([placeholder], "a.agent.png"));
    expect(fromPlaceholder.profile.avatarDataUrl).toBeUndefined();

    const card = pngWithText("buzz_agent_snapshot", encoded, 64, 64);
    const fromCard = await readAgentSnapshotFile(new File([card], "a.agent.png"));
    const avatar = fromCard.profile.avatarDataUrl ?? "";
    expect(avatar.startsWith("data:image/png;base64,")).toBe(true);
    expect(atob(avatar.split(",")[1])).not.toContain("buzz_agent_snapshot");

    const locked = btoa(
      JSON.stringify({ format: "buzz-agent-snapshot-encrypted", version: 1, encryption: {} }),
    );
    await expect(
      readAgentSnapshotFile(new File([pngWithText("buzz_agent_snapshot", locked)], "l.agent.png")),
    ).rejects.toBeInstanceOf(SnapshotError);
    await expect(
      readAgentSnapshotFile(new File([pngWithText("other", encoded)], "x.agent.png")),
    ).rejects.toBeInstanceOf(SnapshotError);
  });

  it("uses desktop's slug rules for file names", () => {
    expect(snapshotSlug("Code Reviewer 🐝", "agent")).toBe("code-reviewer");
    expect(snapshotSlug("🐝", "agent")).toBe("agent");
  });
});

describe("acp command", () => {
  it("carries portable commands both ways and never exports a machine-local path", () => {
    const portable = agentSnapshotFromPersona(PERSONA);
    expect(portable.definition.acpCommand).toBe("buzz-goose-acp");
    expect(personaDraftFromAgentSnapshot(portable).acpCommand).toBe("buzz-goose-acp");
    const local = agentSnapshotFromPersona({ ...PERSONA, acpCommand: "/usr/local/bin/acp" });
    expect(JSON.stringify(local)).not.toContain("/usr/local/bin/acp");
    expect(personaDraftFromAgentSnapshot(local).acpCommand).toBeNull();
  });
});

describe("snapshot PNG cards", () => {
  function layout(png: Uint8Array) {
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    return readPngChunks(png).map((chunk) => {
      const crc = view.getUint32(chunk.dataStart + chunk.length);
      expect(crc).toBe(crc32(png.subarray(chunk.start + 4, chunk.dataStart + chunk.length)));
      return chunk.type;
    });
  }

  it("computes the standard PNG CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("writes desktop's placeholder card: 1×1 transparent RGBA, manifest tEXt before IDAT", async () => {
    const snapshot = agentSnapshotFromPersona({ ...PERSONA, avatarUrl: null });
    const png = encodeAgentSnapshotPng(snapshot, null);
    expect(layout(png)).toEqual(["IHDR", "tEXt", "IDAT", "IEND"]);
    const [header, , idat] = readPngChunks(png);
    expect([...png.subarray(header.dataStart, header.dataStart + 13)]).toEqual([
      0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0,
    ]);
    expect([...unzlibSync(png.subarray(idat.dataStart, idat.dataStart + idat.length))]).toEqual([
      0, 0, 0, 0, 0,
    ]);
    const read = await readAgentSnapshotFile(new File([png], "code-reviewer.agent.png"));
    expect(read).toEqual(snapshot);
  });

  it("embeds the manifest in a real avatar body, replacing the avatar's own text chunks", async () => {
    const body = pngWithText("buzz_agent_snapshot", "stale", 64, 64);
    const snapshot = agentSnapshotFromPersona(PERSONA);
    const png = encodeAgentSnapshotPng(snapshot, body);
    const types = readPngChunks(png).map((chunk) => chunk.type);
    expect(types).toEqual(["IHDR", "tEXt", "IDAT", "IEND"]);
    const read = await readAgentSnapshotFile(new File([png], "a.agent.png"));
    expect(read.definition).toEqual(snapshot.definition);
    expect(read.profile.avatarDataUrl?.startsWith("data:image/png;base64,")).toBe(true);
    // Bodies beyond desktop's 512px edge cap fall back to the 1×1 placeholder.
    const oversize = encodeAgentSnapshotPng(snapshot, pngWithText("k", "v", 1024, 8));
    expect(new DataView(oversize.buffer).getUint32(16)).toBe(1);
  });

  it("round-trips a team card through the team reader", async () => {
    const team: AgentTeam = {
      id: "t",
      name: "Card Team",
      description: null,
      instructions: "Be kind.",
      personaIds: [PERSONA.id],
      shared: false,
      eventId: null,
      createdAt: 0,
    };
    const snapshot = teamSnapshotFromTeam(team, [PERSONA]);
    const png = encodeTeamSnapshotPng(snapshot);
    expect(layout(png)).toEqual(["IHDR", "tEXt", "IDAT", "IEND"]);
    expect(await readTeamSnapshotFile(new File([png], "card-team.team.png"))).toEqual(snapshot);
  });
});

describe("team snapshot", () => {
  const team: AgentTeam = {
    id: "team-SENTINEL",
    name: "My Team",
    description: "My Team description",
    instructions: null,
    personaIds: [PERSONA.id],
    shared: false,
    eventId: null,
    createdAt: 1,
  };

  it("round-trips through a .team.json file and sniffs the kind", async () => {
    const snapshot = teamSnapshotFromTeam(team, [PERSONA]);
    expect(snapshot.team).toEqual({ name: "My Team", description: "My Team description" });
    expect(JSON.stringify(snapshot)).not.toContain("SENTINEL");
    const read = await readAnySnapshotFile(jsonFile(snapshot, "my-team.team.json"));
    expect(read.kind).toBe("team");
    if (read.kind !== "team") return;
    const draft = teamDraftFromSnapshot(read.snapshot);
    expect(draft.team).toEqual({
      name: "My Team",
      description: "My Team description",
      instructions: null,
    });
    expect(draft.personas[0].displayName).toBe(PERSONA.displayName);
    expect((await readAnySnapshotFile(jsonFile(DESKTOP_AGENT_FIXTURE))).kind).toBe("persona");
  });

  it("refuses to export a team whose member persona is missing", () => {
    expectSnapshotError(() => teamSnapshotFromTeam(team, []));
  });

  it.each([
    ["legacy flat team JSON", { version: 1, type: "team", name: "Old" }],
    ["no members", { format: "buzz-team-snapshot", version: 1, team: { name: "T" }, members: [] }],
    [
      "blank team name",
      {
        format: "buzz-team-snapshot",
        version: 1,
        team: { name: " " },
        members: [DESKTOP_AGENT_FIXTURE],
      },
    ],
    [
      "version 2",
      {
        format: "buzz-team-snapshot",
        version: 2,
        team: { name: "T" },
        members: [DESKTOP_AGENT_FIXTURE],
      },
    ],
    [
      "invalid member",
      {
        format: "buzz-team-snapshot",
        version: 1,
        team: { name: "T" },
        members: [{ ...DESKTOP_AGENT_FIXTURE, version: 3 }],
      },
    ],
  ])("rejects %s", async (_label, value) => {
    await expect(readTeamSnapshotFile(jsonFile(value, "t.team.json"))).rejects.toBeInstanceOf(
      SnapshotError,
    );
  });

  it("rejects retired persona-pack ZIP files as legacy", async () => {
    const zip = new File([new Uint8Array([0x50, 0x4b, 3, 4, 0, 0])], "pack.team.json");
    await expect(readTeamSnapshotFile(zip)).rejects.toThrow(/Legacy|旧版/);
  });

  it("reads desktop .team.png cards", async () => {
    const snapshot = {
      format: "buzz-team-snapshot",
      version: 1,
      team: { name: "T" },
      members: [DESKTOP_AGENT_FIXTURE],
    };
    const png = pngWithText("buzz_team_snapshot", btoa(JSON.stringify(snapshot)));
    const read = await readAnySnapshotFile(new File([png], "t.team.png"));
    expect(read).toMatchObject({ kind: "team", snapshot });
  });
});
