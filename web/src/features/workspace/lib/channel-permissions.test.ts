import { describe, expect, it } from "vitest";
import type { BuzzChannel, MemberRole } from "@/features/chat/lib/chat-types";
import { channelAddRoles } from "@/features/workspace/lib/channel-permissions";

const SELF = "a".repeat(64);
const OTHER = "b".repeat(64);

function channel(role: MemberRole | null, overrides: Partial<BuzzChannel> = {}): BuzzChannel {
  return {
    id: "c",
    name: "ops",
    description: "",
    topic: null,
    type: "stream",
    visibility: "private",
    archived: false,
    isMember: role !== null,
    members: [{ pubkey: OTHER, role: "owner" }, ...(role ? [{ pubkey: SELF, role }] : [])],
    participantPubkeys: [],
    ...overrides,
  };
}

describe("channelAddRoles (relay put-user rule)", () => {
  it("lets a plain member or guest add people, but never grant an elevated role", () => {
    expect(channelAddRoles(channel("member"), SELF)).toEqual(["member", "guest"]);
    expect(channelAddRoles(channel("guest"), SELF)).toEqual(["member", "guest"]);
  });

  it("lets channel owners and admins grant admin", () => {
    expect(channelAddRoles(channel("owner"), SELF)).toContain("admin");
    expect(channelAddRoles(channel("admin"), SELF.toUpperCase())).toContain("admin");
  });

  it("offers nothing to non-members, in DMs or in archived channels", () => {
    expect(channelAddRoles(channel(null), SELF)).toEqual([]);
    expect(channelAddRoles(channel("owner", { type: "dm" }), SELF)).toEqual([]);
    expect(channelAddRoles(channel("owner", { archived: true }), SELF)).toEqual([]);
  });
});
