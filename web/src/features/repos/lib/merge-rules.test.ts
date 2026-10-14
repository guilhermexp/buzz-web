import { describe, expect, it } from "vitest";
import { diffLines, splitLines, toHunks, toSplitRows } from "./line-diff";
import { buildProjectReadModels, eventToRepoState } from "./nip34";
import { canChangeStatus, canReview, mergeBlocker } from "./permissions";
import { parseHttpRejection, parsePolicyRejection } from "./push-result";
import { AUTHOR, COMMIT_1, OWNER, REVIEWER, STRANGER, testEvent } from "./test-events";

const openPr = {
  author: AUTHOR,
  status: "open" as const,
  branchName: "feature",
  commit: COMMIT_1,
  cloneUrls: ["http://relay/git/a/demo"],
  reviewers: [REVIEWER],
};
const repository = { owner: OWNER, cloneUrls: ["http://relay/git/a/demo"] };

describe("merge preconditions", () => {
  it("allows only the repository owner to merge an open PR with a revision", () => {
    expect(mergeBlocker(OWNER, repository, openPr)).toBeNull();
    expect(mergeBlocker(AUTHOR, repository, openPr)).toBe("not-owner");
    expect(mergeBlocker(REVIEWER, repository, openPr)).toBe("not-owner");
    expect(mergeBlocker(OWNER, repository, { ...openPr, status: "draft" })).toBe("not-open");
    expect(mergeBlocker(OWNER, repository, { ...openPr, status: "merged" })).toBe("not-open");
    expect(mergeBlocker(OWNER, repository, { ...openPr, branchName: null })).toBe("missing-branch");
    expect(mergeBlocker(OWNER, repository, { ...openPr, commit: null })).toBe("missing-commit");
    expect(mergeBlocker(null, repository, openPr)).toBe("not-owner");
  });

  it("lets owners and requested reviewers review, never the author", () => {
    expect(canReview(OWNER, repository, openPr)).toBe(true);
    expect(canReview(REVIEWER, repository, openPr)).toBe(true);
    expect(canReview(AUTHOR, repository, openPr)).toBe(false);
    expect(canReview(STRANGER, repository, openPr)).toBe(false);
    expect(canReview(OWNER, repository, { ...openPr, status: "closed" })).toBe(false);
    expect(canChangeStatus(AUTHOR, repository, openPr)).toBe(true);
    expect(canChangeStatus(STRANGER, repository, openPr)).toBe(false);
  });
});

describe("push rejection parsing", () => {
  it("extracts policy denials from remote side-band lines", () => {
    const rejection = parsePolicyRejection(
      [
        "remote: error: push denied by policy (HTTP 403)\n",
        'remote: {"allowed":false,"denials":[{"ref_name":"refs/heads/main","reason":"requires owner role (you have member)"}]}\n',
      ],
      { "refs/heads/main": "pre-receive hook declined" },
    );
    expect(rejection.denials).toEqual([
      { refName: "refs/heads/main", reason: "requires owner role (you have member)" },
    ]);
    expect(rejection.detail).toContain("refs/heads/main: pre-receive hook declined");
  });

  it("reads JSON error bodies of transport denials", () => {
    const rejection = parseHttpRejection(403, '{"error":"blocked: banned from this community"}');
    expect(rejection).toMatchObject({
      kind: "http",
      status: 403,
      detail: "blocked: banned from this community",
    });
    expect(parseHttpRejection(404, "not found").detail).toBe("not found");
  });
});

describe("line diff", () => {
  it("produces an edit script that reconstructs both sides", () => {
    const before = splitLines("a\nb\nc\nd\ne\nf\n");
    const after = splitLines("a\nB\nc\nd\nx\ne\n");
    const script = diffLines(before, after);
    expect(script.filter((line) => line.type !== "add").map((line) => line.text)).toEqual(before);
    expect(script.filter((line) => line.type !== "del").map((line) => line.text)).toEqual(after);
    const hunks = toHunks(script, 1);
    expect(hunks.length).toBeGreaterThan(0);
    for (const hunk of hunks) {
      expect(hunk.lines.filter((line) => line.type !== "add")).toHaveLength(hunk.oldLines);
      expect(hunk.lines.filter((line) => line.type !== "del")).toHaveLength(hunk.newLines);
    }
  });

  it("handles additions to and deletions from empty files", () => {
    expect(toHunks(diffLines([], ["x", "y"]))[0]).toMatchObject({
      oldLines: 0,
      newStart: 1,
      newLines: 2,
    });
    expect(toHunks(diffLines(["x"], []))[0]).toMatchObject({
      oldStart: 1,
      oldLines: 1,
      newLines: 0,
    });
    expect(toHunks(diffLines(["same"], ["same"]))).toEqual([]);
  });

  it("pairs deletions with additions for split view", () => {
    const rows = toSplitRows(diffLines(["a", "b", "c"], ["a", "B", "C", "D"]));
    expect(rows.map((row) => [row.left?.text ?? null, row.right?.text ?? null])).toEqual([
      ["a", "a"],
      ["b", "B"],
      ["c", "C"],
      [null, "D"],
    ]);
  });
});

describe("project read models", () => {
  const channel = "0b5c5e3e-8a0f-4c2e-9d1a-2f3b4c5d6e7f";
  const repoEvent = (pubkey: string, dtag: string, tags: string[][] = []) =>
    testEvent({ kind: 30617, pubkey, tags: [["d", dtag], ["buzz-channel", channel], ...tags] });

  it("lets a project claim only repositories its owner owns or maintains", () => {
    const own = repoEvent(OWNER, "own");
    const maintained = repoEvent(AUTHOR, "maintained", [["maintainers", OWNER]]);
    const foreign = repoEvent(STRANGER, "foreign");
    const project = testEvent({
      kind: 30621,
      pubkey: OWNER,
      tags: [
        ["d", "p"],
        ["name", "P"],
        ["a", `30617:${OWNER}:own`],
        ["a", `30617:${AUTHOR}:maintained`],
        ["a", `30617:${STRANGER}:foreign`],
      ],
    });
    const { projects, repositories } = buildProjectReadModels({
      projectEvents: [project],
      repositoryEvents: [own, maintained, foreign],
      relayOrigin: "http://relay",
      viewerPubkey: null,
    });
    expect(repositories.find((repo) => repo.dtag === "own")?.cloneUrls).toEqual([
      `http://relay/git/${OWNER}/own`,
    ]);
    const explicit = projects.find((candidate) => !candidate.legacy);
    expect(explicit?.repositories).toHaveLength(3);
    // The foreign repository is not claimed, so it still appears on its own.
    expect(
      projects.filter((candidate) => candidate.legacy).map((candidate) => candidate.dtag),
    ).toEqual(["foreign"]);
  });

  it("hides unlisted projects from other viewers and drops invalid or deleted heads", () => {
    const unlisted = testEvent({
      kind: 30621,
      pubkey: OWNER,
      tags: [
        ["d", "u"],
        ["buzz-visibility", "unlisted"],
      ],
    });
    const invalid = testEvent({
      kind: 30621,
      pubkey: OWNER,
      tags: [
        ["d", "x"],
        ["name", "a"],
        ["name", "b"],
      ],
    });
    const deleted = testEvent({
      kind: 30621,
      pubkey: OWNER,
      created_at: 10,
      tags: [["d", "gone"]],
    });
    const deletion = testEvent({
      kind: 5,
      pubkey: OWNER,
      created_at: 20,
      tags: [["a", `30621:${OWNER}:gone`]],
    });
    const forged = testEvent({
      kind: 5,
      pubkey: STRANGER,
      created_at: 20,
      tags: [["a", `30621:${OWNER}:u`]],
    });
    const read = (viewer: string | null) =>
      buildProjectReadModels({
        projectEvents: [unlisted, invalid, deleted],
        repositoryEvents: [],
        deletionEvents: [deletion, forged],
        relayOrigin: "http://relay",
        viewerPubkey: viewer,
      }).projects.map((project) => project.dtag);
    expect(read(STRANGER)).toEqual([]);
    expect(read(OWNER)).toEqual(["u"]);
  });

  it("parses relay ref state", () => {
    const state = eventToRepoState(
      testEvent({
        kind: 30618,
        pubkey: STRANGER,
        tags: [
          ["d", "demo"],
          ["refs/heads/main", COMMIT_1],
          ["refs/tags/v1", COMMIT_1],
          ["HEAD", "ref: refs/heads/main"],
        ],
      }),
    );
    expect(state.head).toBe("main");
    expect(state.branches).toEqual([{ name: "main", oid: COMMIT_1 }]);
    expect(state.tags).toEqual([{ name: "v1", oid: COMMIT_1 }]);
  });
});
