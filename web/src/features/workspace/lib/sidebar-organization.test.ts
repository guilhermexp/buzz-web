import { describe, expect, it } from "vitest";
import {
  moveInSection,
  orderSection,
  parseSidebarOrganization,
  sidebarOrganizationKey,
} from "@/features/workspace/lib/sidebar-organization";

const byName = (left: string, right: string) => left.localeCompare(right);

describe("sidebar organization", () => {
  it("keeps the saved order and appends new channels alphabetically", () => {
    expect(
      orderSection(["alpha", "beta", "gamma", "delta"], ["gamma", "alpha"], (id) => id, byName),
    ).toEqual(["gamma", "alpha", "beta", "delta"]);
  });

  it("moves within the displayed order and refuses moves past either edge", () => {
    const displayed = ["gamma", "alpha", "beta"];
    expect(moveInSection(displayed, "beta", -1)).toEqual(["gamma", "beta", "alpha"]);
    expect(moveInSection(displayed, "gamma", -1)).toBeNull();
    expect(moveInSection(displayed, "beta", 1)).toBeNull();
    expect(moveInSection(displayed, "missing", 1)).toBeNull();
  });

  it("scopes the stored arrangement by Relay and identity", () => {
    const a = sidebarOrganizationKey("ws://127.0.0.1:47300", "A".repeat(64));
    expect(a).toBe(sidebarOrganizationKey("ws://127.0.0.1:47300", "a".repeat(64)));
    expect(a).not.toBe(sidebarOrganizationKey("ws://127.0.0.1:47320", "a".repeat(64)));
    expect(a).not.toBe(sidebarOrganizationKey("ws://127.0.0.1:47300", "b".repeat(64)));
  });

  it("sanitizes stored data: unknown sections, duplicates and non-strings are dropped", () => {
    const parsed = parseSidebarOrganization(
      JSON.stringify({
        order: { channels: ["x", "x", 3, "y"], bogus: ["z"] },
        collapsed: { dms: true, starred: "yes" },
      }),
    );
    expect(parsed.order.channels).toEqual(["x", "y"]);
    expect(parsed.order).not.toHaveProperty("bogus");
    expect(parsed.collapsed).toEqual({ starred: false, channels: false, forums: false, dms: true });
    expect(parseSidebarOrganization("{").order.channels).toEqual([]);
  });
});
