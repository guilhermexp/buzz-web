/**
 * Authenticated git operations for the project forge, run entirely in the
 * browser with isomorphic-git against Buzz git smart HTTP. Each repository
 * gets a full-history object store (IndexedDB via LightningFS) scoped by
 * relay URL + viewer pubkey, separate from the shallow browse clone.
 */
import "../git-client";
import LightningFS from "@isomorphic-git/lightning-fs";
import {
  addRemote,
  Errors,
  findMergeBase,
  fetch as gitFetch,
  init,
  isDescendent,
  listServerRefs,
  merge,
  push,
  readBlob,
  resolveRef,
  TREE,
  walk,
  writeRef,
} from "isomorphic-git";
import http from "isomorphic-git/http/web";
import { relayHttpOrigin } from "@/shared/config/runtime-config";
import { makeNip98AuthHeader } from "@/shared/lib/nip98";
import { type PushRejection, parseHttpRejection, parsePolicyRejection } from "./push-result";

export class ForgeGitError extends Error {
  constructor(
    readonly code:
      | "branch_missing"
      | "branch_changed"
      | "revision_unavailable"
      | "merge_conflict"
      | "push_rejected"
      | "push_unverified"
      | "transport",
    message: string,
    readonly rejection: PushRejection | null = null,
    readonly paths: string[] = [],
  ) {
    super(message);
  }
}

export interface ForgeRepoHandle {
  fs: LightningFS;
  dir: string;
  relayUrl: string;
}

const handles = new Map<string, ForgeRepoHandle>();

function hashKey(value: string): string {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

/** One object store per (relay, viewer, repository); reused across hooks. */
export async function openForgeRepo(
  relayUrl: string,
  viewer: string,
  owner: string,
  dtag: string,
): Promise<ForgeRepoHandle> {
  const name = `buzz-forge-${hashKey(relayUrl)}-${viewer.slice(0, 16)}-${owner.slice(0, 16)}-${dtag}`;
  let handle = handles.get(name);
  if (!handle) {
    handle = { fs: new LightningFS(name), dir: "/repo", relayUrl };
    handles.set(name, handle);
  }
  try {
    await handle.fs.promises.stat(`${handle.dir}/.git`);
  } catch {
    await init({ fs: handle.fs, dir: handle.dir, defaultBranch: "buzz-local" });
  }
  return handle;
}

/**
 * NIP-98 headers for a clone URL. Tokens are only minted for the configured
 * relay's own git endpoint (never for third-party clone hosts) and are signed
 * fresh per request because the relay accepts a ±60 s window.
 */
async function authHeaders(relayUrl: string, url: string): Promise<Record<string, string>> {
  const target = new URL(url);
  if (target.origin !== relayHttpOrigin(relayUrl)) return {};
  const repoRoot = `${target.origin}${target.pathname.replace(/\/+$/, "")}`;
  return { Authorization: await makeNip98AuthHeader(repoRoot, "GET") };
}

function remoteName(url: string): string {
  return `r${hashKey(url)}`;
}

function transportError(error: unknown): ForgeGitError {
  if (error instanceof Errors.HttpError) {
    return new ForgeGitError(
      "transport",
      error.message,
      parseHttpRejection(error.data.statusCode, error.data.response ?? ""),
    );
  }
  return new ForgeGitError("transport", error instanceof Error ? error.message : String(error));
}

export interface RemoteBranch {
  name: string;
  oid: string;
}

/** Live branch heads from git-upload-pack ref advertisement. */
export async function listRemoteBranches(relayUrl: string, url: string): Promise<RemoteBranch[]> {
  try {
    const refs = await listServerRefs({
      http,
      url,
      prefix: "refs/heads/",
      headers: await authHeaders(relayUrl, url),
    });
    return refs
      .map((ref) => ({ name: ref.ref.slice("refs/heads/".length), oid: ref.oid }))
      .sort((left, right) => left.name.localeCompare(right.name));
  } catch (error) {
    throw transportError(error);
  }
}

/** Fetch one branch with full history; resolves to its fetched tip oid. */
export async function fetchBranch(
  handle: ForgeRepoHandle,
  url: string,
  branch: string,
): Promise<string> {
  const remote = remoteName(url);
  const { fs, dir } = handle;
  await addRemote({ fs, dir, remote, url, force: true });
  try {
    await gitFetch({
      fs,
      http,
      dir,
      remote,
      url,
      ref: branch,
      remoteRef: `refs/heads/${branch}`,
      singleBranch: true,
      tags: false,
      headers: await authHeaders(handle.relayUrl, url),
    });
  } catch (error) {
    if (error instanceof Errors.NotFoundError) {
      throw new ForgeGitError("branch_missing", branch);
    }
    throw transportError(error);
  }
  try {
    return await resolveRef({ fs, dir, ref: `refs/remotes/${remote}/${branch}` });
  } catch {
    throw new ForgeGitError("branch_missing", branch);
  }
}

async function hasCommit(handle: ForgeRepoHandle, oid: string): Promise<boolean> {
  try {
    await walk({
      fs: handle.fs,
      dir: handle.dir,
      trees: [TREE({ ref: oid })],
      map: async () => null,
    });
    return true;
  } catch {
    return false;
  }
}

export interface FileChange {
  path: string;
  oldPath: string | null;
  status: "added" | "deleted" | "modified" | "renamed";
  oldOid: string | null;
  newOid: string | null;
}

export interface RevisionDiff {
  baseOid: string;
  headOid: string;
  mergeBase: string;
  files: FileChange[];
}

/**
 * Files changed by `headOid` relative to its merge base with `baseOid`
 * (git's `base...head`). Content diffing is done lazily per file.
 */
export async function diffRevision(
  handle: ForgeRepoHandle,
  baseOid: string,
  headOid: string,
): Promise<RevisionDiff> {
  if (!(await hasCommit(handle, headOid))) {
    throw new ForgeGitError("revision_unavailable", headOid);
  }
  const { fs, dir } = handle;
  const bases = (await findMergeBase({ fs, dir, oids: [baseOid, headOid] })) as string[];
  const mergeBase = bases[0] ?? baseOid;
  const changes: FileChange[] = [];
  await walk({
    fs,
    dir,
    trees: [TREE({ ref: mergeBase }), TREE({ ref: headOid })],
    map: async (filepath, entries) => {
      if (filepath === ".") return true;
      const [before, after] = entries ?? [];
      const beforeType = before ? await before.type() : null;
      const afterType = after ? await after.type() : null;
      if (beforeType === "tree" || afterType === "tree") {
        if (beforeType === afterType) {
          return (await before?.oid()) !== (await after?.oid());
        }
      }
      const oldOid = beforeType === "blob" ? ((await before?.oid()) ?? null) : null;
      const newOid = afterType === "blob" ? ((await after?.oid()) ?? null) : null;
      if (oldOid === newOid) return beforeType === "tree" || afterType === "tree";
      changes.push({
        path: filepath,
        oldPath: oldOid ? filepath : null,
        status: oldOid && newOid ? "modified" : oldOid ? "deleted" : "added",
        oldOid,
        newOid,
      });
      return beforeType === "tree" || afterType === "tree";
    },
  });
  // Exact-content renames: pair a deleted and an added path with the same blob.
  const deleted = changes.filter((change) => change.status === "deleted");
  for (const change of changes) {
    if (change.status !== "added") continue;
    const source = deleted.find((candidate) => candidate.oldOid === change.newOid);
    if (!source) continue;
    deleted.splice(deleted.indexOf(source), 1);
    change.status = "renamed";
    change.oldPath = source.path;
    change.oldOid = source.oldOid;
  }
  const files = changes.filter((change) => change.status !== "deleted");
  return {
    baseOid,
    headOid,
    mergeBase,
    files: [...files, ...deleted].sort((left, right) => left.path.localeCompare(right.path)),
  };
}

/** Tip of `sourceBranch` and its merge base with `targetBranch` (for 1618/1619). */
export async function resolveBranchRevision(input: {
  handle: ForgeRepoHandle;
  sourceUrl: string;
  sourceBranch: string;
  targetUrl: string;
  targetBranch: string;
}): Promise<{ commit: string; mergeBase: string | null }> {
  const { handle } = input;
  const target = await fetchBranch(handle, input.targetUrl, input.targetBranch);
  const commit = await fetchBranch(handle, input.sourceUrl, input.sourceBranch);
  const bases = (await findMergeBase({
    fs: handle.fs,
    dir: handle.dir,
    oids: [target, commit],
  })) as string[];
  return { commit, mergeBase: bases[0] ?? null };
}

export const DIFF_TEXT_LIMIT_BYTES = 512 * 1024;

export type BlobText = { kind: "text"; text: string } | { kind: "binary" | "too-large" };

export async function readBlobText(handle: ForgeRepoHandle, oid: string | null): Promise<BlobText> {
  if (!oid) return { kind: "text", text: "" };
  const { blob } = await readBlob({ fs: handle.fs, dir: handle.dir, oid });
  if (blob.byteLength > DIFF_TEXT_LIMIT_BYTES) return { kind: "too-large" };
  if (blob.subarray(0, 8_000).includes(0)) return { kind: "binary" };
  return { kind: "text", text: new TextDecoder().decode(blob) };
}

export interface MergeOutcome {
  mergeCommit: string;
  strategy: "fast-forward" | "merge-commit" | "already-merged";
  previousTarget: string;
}

const MERGE_BRANCH = "buzz-merge";

/**
 * Merge a PR revision into the target branch and push it through
 * git-receive-pack. Resolves only when the relay accepted the ref update and
 * a fresh ref advertisement shows the target at the merge commit; any policy
 * or transport rejection throws `ForgeGitError` and nothing is published.
 */
export async function mergeAndPush(input: {
  handle: ForgeRepoHandle;
  targetUrl: string;
  targetBranch: string;
  sourceUrl: string;
  sourceBranch: string;
  expectedCommit: string;
  viewerPubkey: string;
  message: string;
}): Promise<MergeOutcome> {
  const { handle, expectedCommit } = input;
  const { fs, dir } = handle;
  const targetTip = await fetchBranch(handle, input.targetUrl, input.targetBranch);
  const sourceTip = await fetchBranch(handle, input.sourceUrl, input.sourceBranch);
  if (sourceTip !== expectedCommit) {
    throw new ForgeGitError("branch_changed", sourceTip);
  }
  if (
    targetTip === expectedCommit ||
    (await isDescendent({ fs, dir, oid: targetTip, ancestor: expectedCommit, depth: -1 }))
  ) {
    return { mergeCommit: targetTip, strategy: "already-merged", previousTarget: targetTip };
  }
  const fastForward = await isDescendent({
    fs,
    dir,
    oid: expectedCommit,
    ancestor: targetTip,
    depth: -1,
  });
  let mergeCommit = expectedCommit;
  if (!fastForward) {
    await writeRef({ fs, dir, ref: `refs/heads/${MERGE_BRANCH}`, value: targetTip, force: true });
    const identity = {
      name: "Buzz User",
      email: `${input.viewerPubkey}@users.noreply.buzz`,
    };
    try {
      const result = await merge({
        fs,
        dir,
        ours: MERGE_BRANCH,
        theirs: expectedCommit,
        fastForward: false,
        abortOnConflict: true,
        message: input.message,
        author: identity,
        committer: identity,
      });
      if (!result.oid) throw new ForgeGitError("merge_conflict", input.targetBranch);
      mergeCommit = result.oid;
    } catch (error) {
      if (error instanceof Errors.MergeConflictError) {
        throw new ForgeGitError("merge_conflict", input.targetBranch, null, error.data.filepaths);
      }
      if (error instanceof Errors.MergeNotSupportedError) {
        throw new ForgeGitError("merge_conflict", input.targetBranch);
      }
      throw error;
    }
  }
  await writeRef({ fs, dir, ref: `refs/heads/${MERGE_BRANCH}`, value: mergeCommit, force: true });

  const messages: string[] = [];
  try {
    await push({
      fs,
      http,
      dir,
      url: input.targetUrl,
      ref: `refs/heads/${MERGE_BRANCH}`,
      remoteRef: `refs/heads/${input.targetBranch}`,
      headers: await authHeaders(handle.relayUrl, input.targetUrl),
      onMessage: (line) => {
        messages.push(line);
      },
    });
  } catch (error) {
    // Side-band lines are delivered asynchronously; let them drain.
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (error instanceof Errors.GitPushError) {
      const refErrors = Object.fromEntries(
        Object.entries(error.data.result.refs).map(([ref, status]) => [ref, status.error]),
      );
      const rejection = parsePolicyRejection(messages, refErrors);
      throw new ForgeGitError("push_rejected", rejection.detail, rejection);
    }
    if (error instanceof Errors.HttpError) {
      const rejection = parseHttpRejection(error.data.statusCode, error.data.response ?? "");
      throw new ForgeGitError("push_rejected", rejection.detail, rejection);
    }
    throw transportError(error);
  }

  const advertised = await listRemoteBranches(handle.relayUrl, input.targetUrl);
  const head = advertised.find((branch) => branch.name === input.targetBranch);
  if (head?.oid !== mergeCommit) {
    throw new ForgeGitError("push_unverified", head?.oid ?? "");
  }
  return {
    mergeCommit,
    strategy: fastForward ? "fast-forward" : "merge-commit",
    previousTarget: targetTip,
  };
}
