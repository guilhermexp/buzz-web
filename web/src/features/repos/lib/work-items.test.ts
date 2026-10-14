import { describe, expect, it } from "vitest";
import {
  AUTHOR,
  COMMIT_1,
  COMMIT_2,
  OWNER,
  REPO_ADDRESS,
  REVIEWER,
  STRANGER,
  testEvent,
} from "./test-events";
import {
  foldIssues,
  foldPullRequest,
  nextReviewCreatedAt,
  nextStatusCreatedAt,
} from "./work-items";

function pullRequestRoot(extraTags: string[][] = []) {
  return testEvent({
    kind: 1618,
    pubkey: AUTHOR,
    created_at: 100,
    tags: [
      ["a", REPO_ADDRESS],
      ["p", OWNER],
      ["subject", "Add feature"],
      ["c", COMMIT_1],
      ["clone", "http://relay/git/owner/demo"],
      ["branch-name", "feature"],
      ["target-branch", "main"],
      ...extraTags,
    ],
  });
}

function update(root: { id: string }, pubkey: string, commit: string, createdAt: number) {
  return testEvent({
    kind: 1619,
    pubkey,
    created_at: createdAt,
    tags: [
      ["a", REPO_ADDRESS],
      ["E", root.id],
      ["P", AUTHOR],
      ["c", commit],
      ["clone", "http://relay/git/owner/demo"],
    ],
  });
}

function decision(
  root: { id: string },
  pubkey: string,
  label: string,
  commit: string,
  createdAt: number,
) {
  return testEvent({
    kind: 1,
    pubkey,
    created_at: createdAt,
    tags: [
      ["e", root.id, "", "root"],
      ["a", REPO_ADDRESS],
      ["t", label],
      ["c", commit],
    ],
  });
}

function status(
  root: { id: string },
  pubkey: string,
  kind: number,
  createdAt: number,
  extra: string[][] = [],
) {
  return testEvent({
    kind,
    pubkey,
    created_at: createdAt,
    tags: [["e", root.id, "", "root"], ["a", REPO_ADDRESS], ...extra],
  });
}

describe("pull request fold", () => {
  it("advances the revision only for updates from the author or repository owner", () => {
    const root = pullRequestRoot();
    const pr = foldPullRequest(root, [update(root, STRANGER, COMMIT_2, 200)], [], []);
    expect(pr.commit).toBe(COMMIT_1);
    const trusted = foldPullRequest(root, [update(root, OWNER, COMMIT_2, 200)], [], []);
    expect(trusted.commit).toBe(COMMIT_2);
    expect(trusted.revisions.map((revision) => revision.commit)).toEqual([COMMIT_1, COMMIT_2]);
  });

  it("ignores lifecycle statuses from anyone but the author or owner", () => {
    const root = pullRequestRoot();
    const pr = foldPullRequest(root, [], [], [status(root, STRANGER, 1631, 300)]);
    expect(pr.status).toBe("open");
    expect(pr.mergeCommit).toBeNull();
    const merged = foldPullRequest(
      root,
      [],
      [],
      [
        status(root, AUTHOR, 1632, 200),
        status(root, OWNER, 1631, 300, [["merge-commit", COMMIT_2]]),
      ],
    );
    expect(merged.status).toBe("merged");
    expect(merged.mergeCommit).toBe(COMMIT_2);
  });

  it("counts decisions only from trusted non-author reviewers on the current revision", () => {
    const root = pullRequestRoot([["p", REVIEWER]]);
    const pr = foldPullRequest(
      root,
      [update(root, AUTHOR, COMMIT_2, 150)],
      [
        decision(root, AUTHOR, "approval", COMMIT_2, 160),
        decision(root, STRANGER, "approval", COMMIT_2, 161),
        decision(root, REVIEWER, "approval", COMMIT_1, 120),
        decision(root, OWNER, "changes-requested", COMMIT_2, 170),
      ],
      [],
    );
    expect(pr.approvals).toEqual([]);
    expect(pr.changeRequests.map((entry) => entry.author)).toEqual([OWNER]);
    const reviewerComment = pr.comments.find((comment) => comment.author === REVIEWER);
    expect(reviewerComment?.decision).toBe("approved");
    expect(reviewerComment?.revisionStatus).toBe("historical");
    expect(pr.comments.find((comment) => comment.author === AUTHOR)?.decision).toBeNull();
  });

  it("keeps only each reviewer's latest decision for the revision", () => {
    const root = pullRequestRoot([["p", REVIEWER]]);
    const pr = foldPullRequest(
      root,
      [],
      [
        decision(root, REVIEWER, "changes-requested", COMMIT_1, 110),
        decision(root, REVIEWER, "approval", COMMIT_1, 120),
      ],
      [],
    );
    expect(pr.approvals.map((entry) => [entry.author, entry.commit])).toEqual([
      [REVIEWER, COMMIT_1],
    ]);
    expect(pr.changeRequests).toEqual([]);
    expect(nextReviewCreatedAt(pr, 50)).toBe(121);
  });

  it("adds reviewers from review requests signed by the author or owner only", () => {
    const root = pullRequestRoot();
    const request = (pubkey: string) =>
      testEvent({
        kind: 1,
        pubkey,
        tags: [
          ["e", root.id, "", "root"],
          ["a", REPO_ADDRESS],
          ["p", REVIEWER],
          ["t", "review-request"],
        ],
      });
    expect(foldPullRequest(root, [], [request(STRANGER)], []).reviewers).not.toContain(REVIEWER);
    expect(foldPullRequest(root, [], [request(AUTHOR)], []).reviewers).toContain(REVIEWER);
  });

  it("binds inline comments to their revision and rejects unsafe anchors", () => {
    const root = pullRequestRoot();
    const inline = (file: string) =>
      testEvent({
        kind: 1,
        pubkey: STRANGER,
        tags: [
          ["e", root.id, "", "root"],
          ["t", "inline-comment"],
          ["c", COMMIT_1],
          ["file", file],
          ["side", "new"],
          ["line", "4"],
        ],
      });
    const pr = foldPullRequest(
      root,
      [update(root, AUTHOR, COMMIT_2, 500)],
      [inline("src/a.ts"), inline("../etc/passwd")],
      [],
    );
    expect(pr.comments[0]?.anchor).toEqual({ path: "src/a.ts", side: "new", line: 4 });
    expect(pr.comments[0]?.revisionStatus).toBe("historical");
    expect(pr.comments[1]?.anchor).toBeNull();
  });
});

describe("issue fold and timestamps", () => {
  it("derives issue state from trusted statuses and keeps comments ordered", () => {
    const issue = testEvent({
      kind: 1621,
      pubkey: AUTHOR,
      created_at: 10,
      tags: [
        ["a", REPO_ADDRESS],
        ["subject", "Bug"],
      ],
    });
    const comment = testEvent({
      kind: 1,
      pubkey: STRANGER,
      created_at: 30,
      tags: [["e", issue.id, "", "root"]],
    });
    const [folded] = foldIssues(
      [issue],
      [status(issue, STRANGER, 1632, 40), status(issue, OWNER, 1632, 20)],
      [comment],
    );
    expect(folded?.status).toBe("closed");
    expect(folded?.statusCreatedAt).toBe(20);
    expect(folded?.comments.map((entry) => entry.id)).toEqual([comment.id]);
    expect(nextStatusCreatedAt({ statusCreatedAt: 20 }, 15)).toBe(21);
    expect(nextStatusCreatedAt({ statusCreatedAt: null }, 15)).toBe(15);
  });
});
