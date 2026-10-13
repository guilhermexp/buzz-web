import { bytesToHex, concatBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { verifyEvent } from "nostr-tools/pure";
import { isRecord } from "@/features/agents/lib/guards";
import type { NostrEvent } from "@/shared/api/nostr-types";

export const AGENT_MEMORY_KIND = 30174;
const SLUG = /^mem\/[a-z0-9][a-z0-9_-]{0,63}(\/[a-z0-9][a-z0-9_-]{0,63})*$/;
const REFERENCE = /\[\[([^[\]\s]{1,255})\]\]/g;

export type EngramBody = { slug: "core"; profile: string } | { slug: string; value: string | null };

export type EngramRecord = {
  eventId: string;
  createdAt: number;
  dTag: string;
  body: EngramBody;
};

export type MemoryEntry = {
  slug: string;
  value: string;
  eventId: string;
  createdAt: number;
  references: string[];
  reachable: boolean;
};

export type AgentMemoryView = {
  core: { profile: string; eventId: string; createdAt: number; references: string[] } | null;
  memories: MemoryEntry[];
};

export function isValidSlug(slug: string): boolean {
  return slug === "core" || (SLUG.test(slug) && utf8ToBytes(slug).length <= 255);
}

/** NIP-AE d = HMAC-SHA256(K_c, "agent-memory/v1/d-tag" || 0x00 || slug), via the signer's HMAC. */
export function deriveMemoryDTag(
  hmacWithConversationKey: (message: Uint8Array) => Uint8Array | null,
  slug: string,
): string | null {
  const mac = hmacWithConversationKey(
    concatBytes(utf8ToBytes("agent-memory/v1/d-tag"), new Uint8Array([0]), utf8ToBytes(slug)),
  );
  return mac ? bytesToHex(mac) : null;
}

/** NIP-AE rules 1–2: envelope and signature, checked before any decryption. */
export function validateEngramEnvelope(
  event: NostrEvent,
  agentPubkey: string,
  ownerPubkey: string,
): string | null {
  if (event.kind !== AGENT_MEMORY_KIND) return null;
  if (event.pubkey.toLowerCase() !== agentPubkey.toLowerCase()) return null;
  const dTags = event.tags.filter((tag) => tag[0] === "d");
  const pTags = event.tags.filter((tag) => tag[0] === "p");
  if (dTags.length !== 1 || pTags.length !== 1) return null;
  if (pTags[0]?.[1]?.toLowerCase() !== ownerPubkey.toLowerCase()) return null;
  const dTag = dTags[0]?.[1] ?? "";
  if (!/^[0-9a-f]{64}$/.test(dTag)) return null;
  try {
    return verifyEvent(event) ? dTag : null;
  } catch {
    return null;
  }
}

/** Throws when any JSON object in `text` repeats a member name (NIP-AE rule 3). */
function assertNoDuplicateMembers(text: string): void {
  const stack: Array<Set<string> | null> = [];
  let expectKey = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      let end = index + 1;
      while (end < text.length && text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
      const keys = stack[stack.length - 1];
      if (expectKey && keys) {
        const key = JSON.parse(text.slice(index, end + 1)) as string;
        if (keys.has(key)) throw new Error("duplicate member");
        keys.add(key);
        expectKey = false;
      }
      index = end;
    } else if (char === "{") {
      stack.push(new Set());
      expectKey = true;
    } else if (char === "[") {
      stack.push(null);
    } else if (char === "}" || char === "]") {
      stack.pop();
    } else if (char === ",") {
      expectKey = stack[stack.length - 1] != null;
    }
  }
}

/** NIP-AE rules 3–5. `derivedD` is null when the signer cannot expose K_c (NIP-07). */
export function parseEngramBody(
  plaintext: string,
  dTag: string,
  derive: ((slug: string) => string | null) | null,
): EngramBody | null {
  let value: unknown;
  try {
    value = JSON.parse(plaintext);
    assertNoDuplicateMembers(plaintext);
  } catch {
    return null;
  }
  if (!isRecord(value) || typeof value.slug !== "string" || !isValidSlug(value.slug)) return null;
  const expected = derive?.(value.slug) ?? null;
  if (expected !== null && expected !== dTag) return null;
  if (value.slug === "core") {
    return typeof value.profile === "string" ? { slug: "core", profile: value.profile } : null;
  }
  if (!("value" in value) || (value.value !== null && typeof value.value !== "string")) return null;
  return { slug: value.slug, value: value.value };
}

export function extractReferences(text: string): string[] {
  const references = new Set<string>();
  for (const match of text.matchAll(REFERENCE)) {
    const slug = match[1];
    if (slug && slug !== "core" && isValidSlug(slug)) references.add(slug);
  }
  return [...references];
}

/** Head per d: greatest created_at, ties broken by lowest event id. */
export function selectHeads(records: readonly EngramRecord[]): EngramRecord[] {
  const heads = new Map<string, EngramRecord>();
  for (const record of records) {
    const current = heads.get(record.dTag);
    if (
      !current ||
      record.createdAt > current.createdAt ||
      (record.createdAt === current.createdAt && record.eventId < current.eventId)
    ) {
      heads.set(record.dTag, record);
    }
  }
  return [...heads.values()];
}

/** Listing: heads, tombstones dropped, plus reachability from core over [[slug]] links. */
export function buildMemoryView(records: readonly EngramRecord[]): AgentMemoryView {
  let core: AgentMemoryView["core"] = null;
  const live = new Map<string, Omit<MemoryEntry, "reachable">>();
  for (const head of selectHeads(records)) {
    const body = head.body;
    if ("profile" in body) {
      if (!core || head.createdAt > core.createdAt) {
        core = {
          profile: body.profile,
          eventId: head.eventId,
          createdAt: head.createdAt,
          references: extractReferences(body.profile),
        };
      }
    } else if (body.value !== null) {
      live.set(body.slug, {
        slug: body.slug,
        value: body.value,
        eventId: head.eventId,
        createdAt: head.createdAt,
        references: extractReferences(body.value),
      });
    }
  }
  const reachable = new Set<string>();
  const queue = [...(core?.references ?? [])];
  while (queue.length) {
    const slug = queue.shift() as string;
    if (reachable.has(slug)) continue;
    const entry = live.get(slug);
    if (!entry) continue;
    reachable.add(slug);
    queue.push(...entry.references);
  }
  const memories = [...live.values()]
    .map((entry) => ({ ...entry, reachable: reachable.has(entry.slug) }))
    .sort((left, right) => left.slug.localeCompare(right.slug));
  return { core, memories };
}

export type AgentMemoryResult = AgentMemoryView & {
  truncated: boolean;
  /** False when the signer (NIP-07) cannot expose K_c, so d-tags were not re-derived. */
  dTagsVerified: boolean;
};

/**
 * Owner read pipeline: envelope + signature first, then decrypt with the agent↔owner key, then
 * strict body validation (and d re-derivation when `hmac` can reach K_c), then head selection.
 */
export async function readAgentMemory(
  events: readonly NostrEvent[],
  agentPubkey: string,
  ownerPubkey: string,
  decryptFromPeer: (peerPubkey: string, ciphertext: string) => Promise<string>,
  hmac: (message: Uint8Array) => Uint8Array | null,
  limit: number,
): Promise<AgentMemoryResult> {
  const agent = agentPubkey.toLowerCase();
  const dTagsVerified = hmac(new Uint8Array([0])) !== null;
  const derive = dTagsVerified ? (slug: string) => deriveMemoryDTag(hmac, slug) : null;
  const records = await Promise.all(
    events.map(async (event): Promise<EngramRecord | null> => {
      const dTag = validateEngramEnvelope(event, agent, ownerPubkey);
      if (!dTag) return null;
      try {
        const body = parseEngramBody(await decryptFromPeer(agent, event.content), dTag, derive);
        return body ? { eventId: event.id, createdAt: event.created_at, dTag, body } : null;
      } catch {
        return null;
      }
    }),
  );
  return {
    ...buildMemoryView(records.filter((record): record is EngramRecord => record !== null)),
    truncated: events.length >= limit,
    dTagsVerified,
  };
}
