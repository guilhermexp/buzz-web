import { HttpError } from "./lib.mjs";

const MAX_PATH_LENGTH = 1024;
// C0 controls and DEL are never valid in workspace paths we hand to the container.
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional control-character guard
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;

/**
 * Validate a client-supplied workspace-relative path and return its normalized form
 * ("" is the workspace root). Absolute paths, `..` segments, backslashes and control
 * characters are rejected with 400 `path_escape`. Symlink escapes are additionally
 * rejected inside the container by `buzz-ws-fs`, which resolves the real path there.
 */
export function normalizeWorkspacePath(raw) {
  const value = raw ?? "";
  if (typeof value !== "string") throw new HttpError(400, "bad_request", "path must be a string");
  if (value.length > MAX_PATH_LENGTH) throw new HttpError(400, "bad_request", "path is too long");
  if (CONTROL_PATTERN.test(value) || value.includes("\\")) {
    throw new HttpError(400, "path_escape", "path contains forbidden characters");
  }
  if (value.startsWith("/") || value.startsWith("~")) {
    throw new HttpError(400, "path_escape", "absolute paths are not allowed");
  }
  const segments = [];
  for (const segment of value.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") throw new HttpError(400, "path_escape", "parent segments are not allowed");
    segments.push(segment);
  }
  return segments.join("/");
}

/** Last segment of a normalized workspace path (for Content-Disposition). */
export function baseName(normalizedPath) {
  const index = normalizedPath.lastIndexOf("/");
  return index === -1 ? normalizedPath : normalizedPath.slice(index + 1);
}
