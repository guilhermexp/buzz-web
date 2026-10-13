/** Join a workspace-relative directory and an entry name ("" is the workspace root). */
export function joinWorkspacePath(directory: string, name: string): string {
  return directory ? `${directory}/${name}` : name;
}

/** Breadcrumb segments from the root to `path`, each with its own cumulative path. */
export function workspaceBreadcrumbs(path: string): { name: string; path: string }[] {
  const segments = path.split("/").filter(Boolean);
  return segments.map((name, index) => ({ name, path: segments.slice(0, index + 1).join("/") }));
}

/**
 * Normalize a user-typed relative file name inside `directory`. Returns null for names the
 * service would reject (absolute, parent segments, empty) so the UI can explain before sending.
 */
export function resolveNewFilePath(directory: string, typed: string): string | null {
  const value = typed.trim();
  if (!value || value.startsWith("/") || value.startsWith("~") || value.includes("\\")) return null;
  const segments = value.split("/").filter((segment) => segment && segment !== ".");
  if (!segments.length || segments.includes("..")) return null;
  return joinWorkspacePath(directory, segments.join("/"));
}

/** Whether downloaded bytes are safe to show in the plain-text editor. */
export function isEditableText(bytes: Uint8Array, limit = 1024 * 1024): boolean {
  if (bytes.length > limit) return false;
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}
