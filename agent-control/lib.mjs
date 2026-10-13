import { createHash } from "node:crypto";
import { schnorr } from "@noble/curves/secp256k1.js";
import { hexToBytes } from "@noble/hashes/utils.js";
import { verifyEvent } from "nostr-tools/pure";

export const PUBKEY_PATTERN = /^[0-9a-f]{64}$/;
const SIGNATURE_PATTERN = /^[0-9a-f]{128}$/;

/** HTTP failure with a stable machine-readable code (`{error:{code,message}}`). */
export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

function singleTag(event, name) {
  const values = (Array.isArray(event.tags) ? event.tags : [])
    .filter((tag) => Array.isArray(tag) && tag[0] === name)
    .map((tag) => tag[1]);
  if (values.length !== 1 || typeof values[0] !== "string" || !values[0]) {
    throw new HttpError(401, "unauthorized", `NIP-98 requires exactly one ${name} tag`);
  }
  return values[0];
}

function decodeAuthorization(authorization) {
  if (typeof authorization !== "string" || !authorization.startsWith("Nostr ")) {
    throw new HttpError(401, "unauthorized", "Missing NIP-98 authorization");
  }
  try {
    const encoded = authorization.slice("Nostr ".length).trim();
    const event = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    if (!event || typeof event !== "object") throw new Error("not an object");
    return event;
  } catch {
    throw new HttpError(401, "unauthorized", "Invalid NIP-98 authorization");
  }
}

/** Hex SHA-256 of a string (UTF-8) or byte buffer. */
export function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Verify a NIP-98 request: kind 27235 signature, |Δt| ≤ freshness, exact `u`, `method`,
 * `payload` = sha256(body) (an empty body hashes the empty string), a `nonce`, and a
 * not-yet-seen event id. Returns the signer pubkey. The caller authorizes that pubkey.
 */
export function verifyNip98Request({
  authorization,
  method,
  url,
  body,
  seenEventIds,
  nowSeconds = Math.floor(Date.now() / 1000),
  freshnessSeconds = 60,
}) {
  const event = decodeAuthorization(authorization);
  if (event.kind !== 27235 || !verifyEvent(event)) {
    throw new HttpError(401, "unauthorized", "Invalid NIP-98 signature");
  }
  if (Math.abs(nowSeconds - event.created_at) > freshnessSeconds) {
    throw new HttpError(401, "unauthorized", "Expired NIP-98 authorization");
  }
  if (singleTag(event, "u") !== url) throw new HttpError(401, "unauthorized", "NIP-98 URL mismatch");
  if (singleTag(event, "method").toUpperCase() !== method.toUpperCase()) {
    throw new HttpError(401, "unauthorized", "NIP-98 method mismatch");
  }
  if (singleTag(event, "payload") !== sha256Hex(body ?? "")) {
    throw new HttpError(401, "unauthorized", "NIP-98 payload mismatch");
  }
  singleTag(event, "nonce");
  if (seenEventIds.has(event.id)) {
    throw new HttpError(409, "replayed", "NIP-98 authorization already used");
  }
  seenEventIds.set(event.id, event.created_at + freshnessSeconds);
  return String(event.pubkey).toLowerCase();
}

export function pruneSeenEventIds(seenEventIds, nowSeconds = Math.floor(Date.now() / 1000)) {
  for (const [eventId, expiresAt] of seenEventIds) {
    if (expiresAt < nowSeconds) seenEventIds.delete(eventId);
  }
}

/** NIP-OA preimage the owner signs to authorize `agentHex` without conditions. */
export function agentAuthChallenge(agentHex) {
  return `nostr:agent-auth:${agentHex}:`;
}

/**
 * Verify an unconditional NIP-OA tag `["auth", owner, "", sig]` for `agentHex` signed by
 * `ownerHex`. Returns the normalized tag or throws a 400 `invalid_auth_tag`.
 */
export function verifyAgentAuthTag(tag, { ownerHex, agentHex }) {
  const invalid = (message) => new HttpError(400, "invalid_auth_tag", message);
  if (!Array.isArray(tag) || tag.length !== 4 || tag[0] !== "auth") {
    throw invalid("authTag must be [\"auth\", owner, \"\", sig]");
  }
  const [, owner, conditions, sig] = tag;
  if (owner !== ownerHex) throw invalid("authTag owner must be the signing owner");
  if (conditions !== "") throw invalid("Managed agents require an unconditional authTag");
  if (typeof sig !== "string" || !SIGNATURE_PATTERN.test(sig)) throw invalid("Malformed signature");
  const digest = createHash("sha256").update(agentAuthChallenge(agentHex)).digest();
  let valid = false;
  try {
    valid = schnorr.verify(hexToBytes(sig), new Uint8Array(digest), hexToBytes(ownerHex));
  } catch {
    valid = false;
  }
  if (!valid) throw invalid("authTag signature does not verify");
  return ["auth", owner, "", sig];
}

/** Read a request body as a Buffer, rejecting bodies over `limit` bytes with 413. */
export async function readRequestBody(request, limit = 64 * 1024) {
  const declared = Number.parseInt(request.headers?.["content-length"] ?? "", 10);
  if (Number.isFinite(declared) && declared > limit) {
    throw new HttpError(413, "payload_too_large", "Request body too large");
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limit) throw new HttpError(413, "payload_too_large", "Request body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Parse a JSON object body or throw 400 `bad_request`. */
export function parseJsonObject(buffer) {
  if (!buffer.length) return {};
  let value;
  try {
    value = JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new HttpError(400, "bad_request", "Invalid JSON body");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "bad_request", "JSON body must be an object");
  }
  return value;
}

/** Normalize a community relay URL (ws/wss, no trailing slash) or return null. */
export function normalizeRelayUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "ws:" && url.protocol !== "wss:") return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return url.toString().replace(/\/$/, "");
}
