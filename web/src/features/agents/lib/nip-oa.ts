import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { verifyEvent } from "nostr-tools/pure";
import { HEX_PUBKEY } from "@/features/agents/lib/guards";
import type { NostrEvent } from "@/shared/api/nostr-types";

const CLAUSE = /^(kind=(0|[1-9][0-9]*)|created_at[<>](0|[1-9][0-9]*))$/;

function clausesHold(conditions: string, event: NostrEvent): boolean {
  if (conditions === "") return true;
  if (/\s/.test(conditions)) return false;
  for (const clause of conditions.split("&")) {
    if (!CLAUSE.test(clause)) return false;
    if (clause.startsWith("kind=")) {
      const kind = Number(clause.slice(5));
      if (kind > 65_535 || event.kind !== kind) return false;
    } else {
      const bound = Number(clause.slice(11));
      if (bound > 4_294_967_295) return false;
      if (clause[10] === "<" ? !(event.created_at < bound) : !(event.created_at > bound)) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Return the NIP-OA owner attested by `event`, or null. The event stays authored by
 * `event.pubkey`; callers MUST present the owner only as "managed by", never as author.
 */
export function verifiedAgentOwner(event: NostrEvent): string | null {
  const authTags = event.tags.filter((tag) => tag[0] === "auth");
  if (authTags.length !== 1) return null;
  const [, owner, conditions, signature] = authTags[0] ?? [];
  if (authTags[0]?.length !== 4 || owner === undefined || conditions === undefined) return null;
  if (!HEX_PUBKEY.test(owner) || !/^[0-9a-f]{128}$/.test(signature ?? "")) return null;
  if (owner === event.pubkey.toLowerCase()) return null;
  if (!clausesHold(conditions, event)) return null;
  try {
    if (!verifyEvent(event)) return null;
    const digest = sha256(
      utf8ToBytes(`nostr:agent-auth:${event.pubkey.toLowerCase()}:${conditions}`),
    );
    return schnorr.verify(hexToBytes(signature ?? ""), digest, hexToBytes(owner)) ? owner : null;
  } catch {
    return null;
  }
}
