import { describe, expect, it } from "vitest";
import type { BuzzChannel } from "@/features/chat/lib/chat-types";
import {
  applyPendingRoles,
  freshestRosters,
  type PendingRoleChange,
  settlePendingRoles,
} from "@/features/workspace/lib/roster-merge";
import type { NostrEvent } from "@/shared/api/nostr-types";

const CHANNEL = "11111111-2222-4333-8444-555555555555";
const OWNER = "a".repeat(64);
const MEMBER = "b".repeat(64);

function roster(createdAt: number, role: string, channel = CHANNEL): NostrEvent {
  return {
    id: `${createdAt}`.padStart(64, "0"),
    pubkey: "f".repeat(64),
    created_at: createdAt,
    kind: 39002,
    content: "",
    sig: "0".repeat(128),
    tags: [
      ["d", channel],
      ["p", OWNER, "", "owner"],
      ["p", MEMBER, "", role],
    ],
  };
}

function channel(role: BuzzChannel["members"][number]["role"]): BuzzChannel {
  return {
    id: CHANNEL,
    name: "ops",
    description: "",
    topic: null,
    type: "stream",
    visibility: "private",
    archived: false,
    isMember: true,
    members: [
      { pubkey: OWNER, role: "owner" },
      { pubkey: MEMBER, role },
    ],
    participantPubkeys: [OWNER, MEMBER],
  };
}

describe("roster freshness", () => {
  it("never lets a late, older roster response regress a newer one", () => {
    const cache = new Map<string, NostrEvent>();
    expect(freshestRosters(cache, [roster(20, "admin")])[0]?.created_at).toBe(20);
    // A query issued before the promotion resolves afterwards.
    expect(freshestRosters(cache, [roster(10, "guest")])[0]?.created_at).toBe(20);
  });

  it("does not resurrect cached rosters for channels absent from a fetch", () => {
    const cache = new Map<string, NostrEvent>();
    freshestRosters(cache, [roster(20, "member")]);
    expect(freshestRosters(cache, [])).toEqual([]);
  });
});

describe("pending role changes", () => {
  const pending: PendingRoleChange[] = [
    { channelId: CHANNEL, pubkey: MEMBER, role: "admin", rosterVersion: 10 },
  ];

  it("keeps an accepted promotion over a stale roster that still says guest", () => {
    const [view] = applyPendingRoles([channel("guest")], pending);
    expect(view?.members.find((member) => member.pubkey === MEMBER)?.role).toBe("admin");
    expect(settlePendingRoles(pending, { [CHANNEL]: 10 })).toEqual(pending);
  });

  it("yields to the first roster newer than the change, whatever it says", () => {
    expect(settlePendingRoles(pending, { [CHANNEL]: 11 })).toEqual([]);
    expect(applyPendingRoles([channel("member")], [])[0]?.members[1]?.role).toBe("member");
  });

  it("shows an accepted add before the roster lists the new member", () => {
    const base = { ...channel("member"), members: [{ pubkey: OWNER, role: "owner" as const }] };
    const [view] = applyPendingRoles(
      [base],
      [{ ...pending[0], role: "guest" } as PendingRoleChange],
    );
    expect(view?.members).toContainEqual({ pubkey: MEMBER, role: "guest" });
    expect(view?.participantPubkeys).toContain(MEMBER);
  });
});
