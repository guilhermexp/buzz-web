import { describe, expect, it } from "vitest";
import {
  buildCommentTemplate,
  buildMergedStatusTemplate,
  buildProjectMembershipTemplate,
  buildProjectTemplate,
  buildPullRequestTemplate,
  buildPullRequestUpdateTemplate,
  buildRepositoryTemplate,
  buildReviewDecisionTemplate,
  buildStatusTemplate,
} from "./forge-events";
import { AUTHOR, COMMIT_1, COMMIT_2, OWNER, REPO_ADDRESS } from "./test-events";

const CHANNEL = "0b5c5e3e-8a0f-4c2e-9d1a-2f3b4c5d6e7f";
const repository = { address: REPO_ADDRESS, owner: OWNER, cloneUrls: ["http://relay/git/a/demo"] };

describe("project and repository templates", () => {
  it("binds the repository to its channel and keeps announced remotes", () => {
    const template = buildRepositoryTemplate({
      dtag: "demo",
      name: "Demo",
      description: " ",
      channelId: CHANNEL,
      cloneUrls: ["http://relay/git/a/demo", "https://mirror.example/demo.git"],
    });
    expect(template.kind).toBe(30617);
    expect(template.tags).toEqual([
      ["d", "demo"],
      ["name", "Demo"],
      ["clone", "http://relay/git/a/demo", "https://mirror.example/demo.git"],
      ["buzz-channel", CHANNEL],
    ]);
    expect(() =>
      buildRepositoryTemplate({
        dtag: "..x",
        name: "x",
        description: "",
        channelId: CHANNEL,
        cloneUrls: [],
      }),
    ).toThrow("repo-id-invalid");
  });

  it("publishes a NIP-MP project with sorted unique members", () => {
    const template = buildProjectTemplate({
      dtag: "demo",
      name: "Demo",
      description: "",
      channelId: CHANNEL,
      visibility: "unlisted",
      repositoryAddresses: [`30617:${OWNER}:z`, REPO_ADDRESS, REPO_ADDRESS],
    });
    expect(template.tags.filter((tag) => tag[0] === "a")).toEqual([
      ["a", REPO_ADDRESS],
      ["a", `30617:${OWNER}:z`],
    ]);
    expect(template.tags).toContainEqual(["buzz-visibility", "unlisted"]);
  });

  it("patches only membership on the live head, preserving unknown tags and hints", () => {
    const liveHead = {
      pubkey: OWNER,
      content: "kept",
      created_at: 500,
      tags: [
        ["d", "demo"],
        ["name", "Demo"],
        ["x-future", "value"],
        ["auth", "stale"],
        ["a", REPO_ADDRESS, "wss://hint"],
      ],
    };
    const added = `30617:${AUTHOR}:other`;
    const template = buildProjectMembershipTemplate({
      liveHead,
      viewerPubkey: OWNER,
      add: [added],
      now: 100,
    });
    expect(template.created_at).toBe(501);
    expect(template.content).toBe("kept");
    expect(template.tags).toContainEqual(["x-future", "value"]);
    expect(template.tags).not.toContainEqual(["auth", "stale"]);
    expect(template.tags).toContainEqual(["a", REPO_ADDRESS, "wss://hint"]);
    expect(template.tags).toContainEqual(["a", added]);
    expect(() =>
      buildProjectMembershipTemplate({ liveHead, viewerPubkey: AUTHOR, add: [added], now: 100 }),
    ).toThrow("project-not-owner");
    expect(() =>
      buildProjectMembershipTemplate({
        liveHead,
        viewerPubkey: OWNER,
        add: [REPO_ADDRESS],
        now: 100,
      }),
    ).toThrow("project-member-exists");
  });
});

describe("work item templates", () => {
  it("opens a pull request naming its exact revision and target", () => {
    const template = buildPullRequestTemplate({
      repository,
      title: "Feature",
      body: "Body",
      branch: "feature",
      targetBranch: "main",
      commit: COMMIT_1.toUpperCase(),
      mergeBase: COMMIT_2,
      reviewers: [OWNER],
    });
    expect(template.kind).toBe(1618);
    expect(template.tags.filter((tag) => tag[0] === "p")).toEqual([["p", OWNER]]);
    expect(template.tags).toContainEqual(["c", COMMIT_1]);
    expect(template.tags).toContainEqual(["branch-name", "feature"]);
    expect(template.tags).toContainEqual(["target-branch", "main"]);
    expect(template.tags).toContainEqual(["merge-base", COMMIT_2]);
    expect(() =>
      buildPullRequestTemplate({
        ...{
          repository,
          title: "x",
          body: "",
          branch: "main",
          targetBranch: "main",
          commit: COMMIT_1,
          mergeBase: null,
          reviewers: [],
        },
      }),
    ).toThrow("branch-same");
  });

  it("orders a revision update after every prior update", () => {
    const template = buildPullRequestUpdateTemplate({
      repository,
      pullRequest: {
        id: "f".repeat(64),
        author: AUTHOR,
        cloneUrls: [],
        updates: [{ createdAt: 900 } as never],
      },
      commit: COMMIT_2,
      mergeBase: null,
      now: 10,
    });
    expect(template.created_at).toBe(901);
    expect(template.tags).toContainEqual(["E", "f".repeat(64)]);
    expect(template.tags).toContainEqual(["P", AUTHOR]);
    expect(template.tags).toContainEqual(["clone", ...repository.cloneUrls]);
  });

  it("never encodes merged state as a lifecycle status", () => {
    const closed = buildStatusTemplate({
      rootId: "e".repeat(64),
      rootAuthor: AUTHOR,
      repository,
      status: "closed",
      createdAt: 5,
    });
    expect(closed.kind).toBe(1632);
    const merged = buildMergedStatusTemplate({
      pullRequest: { id: "e".repeat(64), author: AUTHOR },
      repository,
      mergeCommit: COMMIT_2,
      createdAt: 6,
    });
    expect(merged.kind).toBe(1631);
    expect(merged.tags).toContainEqual(["merge-commit", COMMIT_2]);
    expect(merged.tags).toContainEqual(["r", COMMIT_2]);
    expect(() =>
      buildMergedStatusTemplate({
        pullRequest: { id: "e", author: AUTHOR },
        repository,
        mergeCommit: "",
        createdAt: 1,
      }),
    ).toThrow("commit-invalid");
  });

  it("binds review decisions and inline comments to a revision commit", () => {
    const pullRequest = { id: "e".repeat(64), author: AUTHOR, commit: COMMIT_2 };
    const approval = buildReviewDecisionTemplate({
      pullRequest,
      repository,
      decision: "approve",
      content: "",
      defaultContent: "Approved these changes",
      createdAt: 7,
    });
    expect(approval.content).toBe("Approved these changes");
    expect(approval.tags).toContainEqual(["t", "approval"]);
    expect(approval.tags).toContainEqual(["c", COMMIT_2]);
    expect(() =>
      buildReviewDecisionTemplate({
        pullRequest: { ...pullRequest, commit: null },
        repository,
        decision: "approve",
        content: "",
        defaultContent: "",
        createdAt: 1,
      }),
    ).toThrow("review-commit-missing");

    const inline = buildCommentTemplate({
      rootId: pullRequest.id,
      rootAuthor: AUTHOR,
      repository,
      content: "nit",
      anchor: { path: "src/a.ts", side: "old", line: 3, commit: COMMIT_1 },
    });
    expect(inline.tags).toEqual(
      expect.arrayContaining([
        ["t", "inline-comment"],
        ["c", COMMIT_1],
        ["file", "src/a.ts"],
        ["side", "old"],
        ["line", "3"],
      ]),
    );
    expect(() =>
      buildCommentTemplate({
        rootId: "x",
        rootAuthor: AUTHOR,
        repository,
        content: "x",
        anchor: { path: "/abs", side: "new", line: 1, commit: COMMIT_1 },
      }),
    ).toThrow("anchor-invalid");
  });
});
