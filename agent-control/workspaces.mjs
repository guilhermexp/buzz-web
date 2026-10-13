import { createHash } from "node:crypto";
import { mkdirSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { MANAGED_LABEL } from "./docker.mjs";
import { isValidWorkspaceId } from "./grants.mjs";
import { HttpError } from "./lib.mjs";
import { baseName, normalizeWorkspacePath } from "./paths.mjs";

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
const HELPER = "/usr/local/bin/buzz-ws-fs";
const TYPE_NAMES = { d: "directory", f: "file", l: "symlink" };

export function communityKey(community) {
  return createHash("sha256").update(community).digest("hex").slice(0, 12);
}

/**
 * Remove a wiped bind-mount directory. It is owned by the container user (unreadable from the
 * host), so only the now-empty entry is unlinked; a non-empty directory is a real failure.
 */
export function removeEmptyDir(path) {
  try {
    rmdirSync(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function recordKey(owner, community, id) {
  return `${owner}|${community}|${id}`;
}

/** Map a buzz-ws-fs exit status to the public error contract. */
export function helperError(code, stderr) {
  const detail = String(stderr || "").trim().split("\n")[0] || "operation failed";
  if (code === 3) return new HttpError(400, "path_escape", "Path resolves outside the workspace");
  if (code === 4) return new HttpError(404, "not_found", "No such file or directory");
  if (code === 5) return new HttpError(400, detail, "Path has the wrong type for this operation");
  if (code === 6) return new HttpError(400, "workspace_root", "The workspace root cannot be modified");
  if (code === 7) return new HttpError(500, "write_failed", "The workspace could not be modified");
  return new HttpError(502, "runtime_error", `Workspace helper failed (${code})`);
}

/** Parse `find -printf '%y\t%s\t%T@\t%f\0'` output into directory entries. */
export function parseListing(buffer) {
  const entries = [];
  for (const record of buffer.toString("utf8").split("\0")) {
    if (!record) continue;
    const [type, size, mtime, ...nameParts] = record.split("\t");
    const name = nameParts.join("\t");
    if (!name || name.startsWith(".buzz-upload.")) continue;
    entries.push({
      name,
      type: TYPE_NAMES[type] ?? "other",
      size: Number.parseInt(size, 10) || 0,
      modifiedAt: Math.floor(Number.parseFloat(mtime) || 0),
    });
  }
  entries.sort((a, b) =>
    a.type === "directory" && b.type !== "directory"
      ? -1
      : b.type === "directory" && a.type !== "directory"
        ? 1
        : a.name.localeCompare(b.name),
  );
  return entries;
}

/** Owner+community-bound workspace containers and their confined filesystem operations. */
export class WorkspaceService {
  constructor({ runtime, state, dataRoot, log = console }) {
    this.runtime = runtime;
    this.state = state;
    this.dataRoot = dataRoot;
    this.log = log;
  }

  containerName(owner, community, id) {
    const digest = createHash("sha256").update(recordKey(owner, community, id)).digest("hex");
    return `buzz-ws-${digest.slice(0, 16)}`;
  }

  dataDir(owner, community, id) {
    return join(this.dataRoot, owner, communityKey(community), id);
  }

  records(owner, community) {
    return Object.values(this.state.workspaces).filter(
      (record) => record.owner === owner && record.community === community,
    );
  }

  all() {
    return Object.values(this.state.workspaces);
  }

  exists(owner, community, id) {
    return Boolean(this.state.workspaces[recordKey(owner, community, id)]);
  }

  /** The caller's own workspace or 404 (other owners' workspaces are indistinguishable). */
  get(owner, community, id) {
    const record = this.state.workspaces[recordKey(owner, community, id)];
    if (!record) throw new HttpError(404, "not_found", "Workspace not found");
    return record;
  }

  async describe(record) {
    const info = await this.runtime.inspect(record.container);
    const status = !info ? "missing" : info.State.Running ? "running" : "stopped";
    return { id: record.id, name: record.name, status, createdAt: record.createdAt };
  }

  async list(owner, community) {
    const records = this.records(owner, community).sort((a, b) => a.createdAt - b.createdAt);
    return Promise.all(records.map((record) => this.describe(record)));
  }

  async create(owner, community, grant, input) {
    const id = input.id;
    if (!isValidWorkspaceId(id)) {
      throw new HttpError(400, "bad_request", "id must match ^[a-z0-9][a-z0-9-]{0,31}$");
    }
    const name = typeof input.name === "string" && input.name.trim() ? input.name.trim() : id;
    if (name.length > 64) throw new HttpError(400, "bad_request", "name is too long");
    if (grant.workspaces !== "*" && !grant.workspaces.has(id)) {
      throw new HttpError(403, "forbidden", "This workspace id is not granted");
    }
    if (this.exists(owner, community, id)) {
      throw new HttpError(409, "conflict", "A workspace with this id already exists");
    }
    if (this.records(owner, community).length >= grant.maxWorkspaces) {
      throw new HttpError(409, "quota_exceeded", "Workspace limit reached for this grant");
    }
    const record = {
      id,
      name,
      owner,
      community,
      container: this.containerName(owner, community, id),
      createdAt: Math.floor(Date.now() / 1000),
    };
    const dataDir = this.dataDir(owner, community, id);
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    await this.runtime.chownForContainerUser(dataDir);
    await this.runtime.removeContainer(record.container);
    await this.runtime.docker.createContainer({
      name: record.container,
      Image: this.runtime.image,
      Cmd: ["sleep", "infinity"],
      User: "1000:1000",
      WorkingDir: "/workspace",
      Env: ["TERM=xterm-256color", "HOME=/home/buzz", "LANG=C.UTF-8"],
      Labels: { [MANAGED_LABEL]: "workspace", "buzz.workspace": id },
      HostConfig: this.runtime.hostConfig({ binds: [`${dataDir}:/workspace`] }),
    });
    await this.runtime.container(record.container).start();
    this.state.workspaces[recordKey(owner, community, id)] = record;
    this.state.save();
    return this.describe(record);
  }

  /** Start the container if it is stopped (e.g. after a daemon restart). */
  async ensureRunning(record) {
    const info = await this.runtime.inspect(record.container);
    if (!info) throw new HttpError(409, "workspace_missing", "Workspace container is missing");
    if (!info.State.Running) await this.runtime.container(record.container).start();
  }

  async remove(record) {
    const info = await this.runtime.inspect(record.container);
    if (info) {
      if (!info.State.Running) await this.runtime.container(record.container).start();
      const result = await this.runtime.execCollect(record.container, [HELPER, "wipe"], {
        timeoutMs: 120_000,
      });
      if (result.code !== 0) throw helperError(result.code, result.stderr);
      await this.runtime.removeContainer(record.container);
    }
    removeEmptyDir(this.dataDir(record.owner, record.community, record.id));
    delete this.state.workspaces[recordKey(record.owner, record.community, record.id)];
    this.state.save();
  }

  async helper(record, args, options) {
    await this.ensureRunning(record);
    const result = await this.runtime.execCollect(record.container, [HELPER, ...args], options);
    if (result.code !== 0) throw helperError(result.code, result.stderr);
    return result.stdout;
  }

  async listFiles(record, rawPath) {
    const path = normalizeWorkspacePath(rawPath);
    const output = await this.helper(record, ["list", path]);
    return { path, entries: parseListing(output) };
  }

  async readFile(record, rawPath) {
    const path = normalizeWorkspacePath(rawPath);
    const [type, size] = (await this.helper(record, ["stat", path])).toString("utf8").split("\t");
    if (type !== "f") throw new HttpError(400, "not_a_file", "Path is not a regular file");
    if (Number.parseInt(size, 10) > MAX_FILE_BYTES) {
      throw new HttpError(413, "payload_too_large", "File is too large to download");
    }
    const bytes = await this.helper(record, ["read", path], {
      maxBytes: MAX_FILE_BYTES,
      timeoutMs: 120_000,
    });
    return { path, name: baseName(path), bytes };
  }

  async writeFile(record, rawPath, bytes) {
    const path = normalizeWorkspacePath(rawPath);
    if (!path) throw new HttpError(400, "workspace_root", "A file path is required");
    const output = await this.helper(record, ["write", path], { stdin: bytes, timeoutMs: 120_000 });
    return { path, size: Number.parseInt(output.toString("utf8"), 10) || 0 };
  }

  async deleteFile(record, rawPath) {
    const path = normalizeWorkspacePath(rawPath);
    if (!path) throw new HttpError(400, "workspace_root", "The workspace root cannot be deleted");
    await this.helper(record, ["delete", path]);
    return { path, deleted: true };
  }
}
