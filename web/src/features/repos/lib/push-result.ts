/**
 * Interpretation of Buzz git receive-pack rejections. The relay's pre-receive
 * policy hook prints `error: push denied by policy (HTTP 403)` and a JSON
 * `{"allowed":false,"denials":[{"ref_name","reason"}]}` on stderr, which git
 * relays as side-band `remote:` lines while the HTTP status stays 200
 * (crates/buzz-relay/src/api/git/transport.rs). Transport-level denials
 * (bans, auth) arrive as 401/403/404 HTTP responses instead.
 */

export interface PushDenial {
  refName: string;
  reason: string;
}

export interface PushRejection {
  kind: "policy" | "http";
  status: number | null;
  denials: PushDenial[];
  /** Bounded server text for display (remote lines or response body). */
  detail: string;
}

const MAX_DETAIL = 1_000;

function denialsFromJson(text: string): PushDenial[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as {
      allowed?: unknown;
      denials?: unknown;
    };
    if (!Array.isArray(parsed.denials)) return [];
    return parsed.denials.flatMap((denial) => {
      if (!denial || typeof denial !== "object") return [];
      const { ref_name: refName, reason } = denial as Record<string, unknown>;
      return typeof refName === "string" && typeof reason === "string" ? [{ refName, reason }] : [];
    });
  } catch {
    return [];
  }
}

/** Parse side-band progress lines from a rejected receive-pack response. */
export function parsePolicyRejection(
  messages: readonly string[],
  refErrors: Readonly<Record<string, string | undefined>>,
): PushRejection {
  const lines = messages
    .flatMap((message) => message.split(/\r?\n/))
    .map((line) => line.replace(/^remote:\s?/, "").trimEnd())
    .filter(Boolean);
  const joined = lines.join("\n");
  const denials = denialsFromJson(joined);
  const refLines = Object.entries(refErrors)
    .filter(([, error]) => error)
    .map(([ref, error]) => `${ref}: ${error}`);
  return {
    kind: "policy",
    status: null,
    denials,
    detail: [...lines, ...refLines].join("\n").slice(0, MAX_DETAIL),
  };
}

/** Parse a non-2xx git HTTP response body (JSON error or plain text). */
export function parseHttpRejection(status: number, body: string): PushRejection {
  let detail = body.trim();
  try {
    const parsed = JSON.parse(body) as { error?: unknown; message?: unknown };
    const message =
      typeof parsed.error === "string"
        ? parsed.error
        : typeof parsed.message === "string"
          ? parsed.message
          : null;
    if (message) detail = message;
  } catch {
    // plain-text body
  }
  return {
    kind: "http",
    status,
    denials: denialsFromJson(body),
    detail: detail.slice(0, MAX_DETAIL),
  };
}
