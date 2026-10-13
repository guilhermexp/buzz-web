import type { NostrEvent } from "@/shared/api/nostr-types";

let counter = 0;

/** Unsigned-but-shaped events for pure fold/model tests (ids are unique hex). */
export function testEvent(input: {
  kind: number;
  pubkey: string;
  tags?: string[][];
  content?: string;
  created_at?: number;
  id?: string;
}): NostrEvent {
  counter += 1;
  return {
    id: input.id ?? counter.toString(16).padStart(64, "0"),
    kind: input.kind,
    pubkey: input.pubkey,
    tags: input.tags ?? [],
    content: input.content ?? "",
    created_at: input.created_at ?? 1_700_000_000 + counter,
    sig: "0".repeat(128),
  };
}

export const OWNER = "a".repeat(64);
export const AUTHOR = "b".repeat(64);
export const REVIEWER = "c".repeat(64);
export const STRANGER = "d".repeat(64);
export const REPO_ADDRESS = `30617:${OWNER}:demo`;
export const COMMIT_1 = "1".repeat(40);
export const COMMIT_2 = "2".repeat(40);
