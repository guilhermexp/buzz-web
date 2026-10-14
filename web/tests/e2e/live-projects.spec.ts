import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, type Page, test } from "@playwright/test";
import { finalizeEvent } from "nostr-tools/pure";
import {
  createPrivateChannel,
  identityFromEnvironment,
  importIdentity,
  type LiveIdentity,
  liveRelayUrl,
} from "./support/live-session";
import { NodeRelayClient } from "./support/node-relay";

const admin = identityFromEnvironment("BUZZ_LIVE_ADMIN_NSEC");
const member = identityFromEnvironment("BUZZ_LIVE_MEMBER_NSEC");
const runFile = promisify(execFile);

/** Repository root the NIP-98 `u` tag must name (set once the repo URL is known). */
let repoAuthUrl = "";

/** Fresh kind 27235 token per git invocation (the Relay accepts a ±60 s window). */
function nip98Header(identity: LiveIdentity): string {
  const event = finalizeEvent(
    {
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      content: "",
      tags: [
        ["u", repoAuthUrl],
        ["method", "GET"],
      ],
    },
    identity.secretKey,
  );
  return `Authorization: Nostr ${Buffer.from(JSON.stringify(event)).toString("base64")}`;
}

function evidence(name: string): string | undefined {
  const directory = process.env.PROJECTS_EVIDENCE_DIR;
  return directory ? `${directory}/${name}` : undefined;
}

type GitResult = { ok: boolean; stdout: string; stderr: string };

/**
 * git CLI authenticated with NIP-98 via `http.extraHeader` (passed through the
 * environment, never argv). The system git predates the `authtype` credential
 * capability git-credential-nostr needs, so the header is signed here instead.
 */
async function git(cwd: string, args: string[], identity?: LiveIdentity): Promise<GitResult> {
  const home = path.join(cwd, "..", ".git-home");
  await mkdir(home, { recursive: true });
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: home,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
  if (identity) {
    env.GIT_CONFIG_COUNT = "1";
    env.GIT_CONFIG_KEY_0 = "http.extraHeader";
    env.GIT_CONFIG_VALUE_0 = nip98Header(identity);
  }
  const config = [
    "-c",
    "user.name=Buzz Live Test",
    "-c",
    "user.email=live-test@buzz.invalid",
    "-c",
    "init.defaultBranch=main",
  ];
  try {
    const { stdout, stderr } = await runFile("git", [...config, ...args], { cwd, env });
    return { ok: true, stdout, stderr };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    return { ok: false, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
}

async function gitOk(cwd: string, args: string[], identity?: LiveIdentity): Promise<string> {
  const result = await git(cwd, args, identity);
  if (!result.ok) throw new Error(`git ${args[0]} failed: ${result.stderr.slice(0, 2_000)}`);
  return result.stdout.trim();
}

async function remoteHead(cwd: string, url: string, branch: string, identity: LiveIdentity) {
  const out = await gitOk(cwd, ["ls-remote", url, `refs/heads/${branch}`], identity);
  return out.split(/\s+/)[0] ?? "";
}

async function openProjects(page: Page) {
  const panel = page.getByTestId("workspace-tool-repos");
  // The navigation entry toggles the tool; reopen it to start from the overview.
  if (await panel.isVisible()) await panel.getByRole("button", { name: "Close Projects" }).click();
  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("button", { name: "Projects", exact: true })
    .click();
  await expect(panel.getByRole("heading", { name: "Projects" })).toBeVisible();
  return panel;
}

/** Like the shared helper, but retries when the shared Relay rate-limits the identity. */
async function addMemberWithRetry(page: Page, pubkey: string) {
  await page.getByRole("button", { name: /^Members: \d+$/ }).click();
  const members = page.getByRole("dialog", { name: /Members · / });
  await members.getByRole("button", { name: "Add member", exact: true }).click();
  await members.getByLabel("Member public key", { exact: true }).fill(pubkey);
  await members.getByLabel("Role", { exact: true }).selectOption("member");
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await members.getByRole("button", { name: "Add member", exact: true }).last().click();
    try {
      await expect(page.getByRole("dialog", { name: "Members · 2" })).toBeVisible({
        timeout: 8_000,
      });
      break;
    } catch (error) {
      if (attempt === 5) throw error;
      await page.waitForTimeout(3_000);
    }
  }
  await members.getByRole("button", { name: "Close", exact: true }).click();
}

async function openRepository(page: Page, projectName: string) {
  const panel = await openProjects(page);
  await panel.getByRole("button", { name: "Refresh" }).click();
  await panel.getByRole("button", { name: new RegExp(`published project ${projectName}`) }).click();
  await panel
    .getByRole("button", { name: new RegExp(`^${projectName}`) })
    .first()
    .click();
  await expect(panel.getByRole("tab", { name: "Code" })).toBeVisible();
  return panel;
}

test("project forge: publish, issue, PR, revision review, browser merge and protected rejection", async ({
  browser,
}) => {
  const relayUrl = liveRelayUrl();
  const relayOrigin = relayUrl.replace(/^ws/, "http");
  const suffix = Date.now().toString(36);
  const channelName = `forge-${suffix}`;
  const projectName = `forge-${suffix}`;
  const cloneUrl = `${relayOrigin}/git/${admin.pubkey}/${projectName}`;
  repoAuthUrl = cloneUrl;
  const work = await mkdtemp(path.join(process.env.PROJECTS_WORK_DIR ?? tmpdir(), "forge-"));
  const relay = await NodeRelayClient.connect(relayUrl, admin.secretKey);

  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const memberContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const adminPage = await adminContext.newPage();
  const memberPage = await memberContext.newPage();
  await importIdentity(adminPage, admin);
  await importIdentity(memberPage, member);

  // 1. Owner publishes a project + repository bound to a private channel with the member.
  await createPrivateChannel(adminPage, channelName);
  await addMemberWithRetry(adminPage, member.pubkey);
  const adminPanel = await openProjects(adminPage);
  await adminPanel.getByRole("button", { name: "Publish a project" }).click();
  await adminPanel.getByLabel("Name").fill(projectName);
  await adminPanel.getByLabel("Description").fill("Live forge acceptance");
  await adminPanel.getByLabel("Access channel").selectOption({ label: `#${channelName}` });
  await adminPanel.getByRole("button", { name: "Publish project" }).click();
  await expect(adminPanel.getByRole("heading", { name: projectName, level: 3 })).toBeVisible();
  const [projectEvent] = await relay.query([
    { kinds: [30621], authors: [admin.pubkey], "#d": [projectName] },
  ]);
  const [repoEvent] = await relay.query([
    { kinds: [30617], authors: [admin.pubkey], "#d": [projectName] },
  ]);
  expect(projectEvent?.tags).toContainEqual(["a", `30617:${admin.pubkey}:${projectName}`]);
  expect(repoEvent?.tags).toContainEqual(["clone", cloneUrl]);
  const channelId = repoEvent?.tags.find((tag) => tag[0] === "buzz-channel")?.[1];
  expect(channelId).toBeTruthy();

  // 2. Initial commit (owner), feature branch (member), then a divergent main commit (owner).
  const ownerDir = path.join(work, "owner");
  await mkdir(path.join(ownerDir, "src"), { recursive: true });
  await gitOk(ownerDir, ["init"]);
  await writeFile(path.join(ownerDir, "README.md"), `# ${projectName}\n\nForge acceptance.\n`);
  await writeFile(path.join(ownerDir, "src", "app.ts"), 'export const app = "forge";\n');
  await gitOk(ownerDir, ["add", "."]);
  await gitOk(ownerDir, ["commit", "-m", "Initial commit"]);
  await gitOk(ownerDir, ["remote", "add", "origin", cloneUrl]);
  await gitOk(ownerDir, ["push", "origin", "main"], admin);

  const memberDir = path.join(work, "member");
  await gitOk(work, ["clone", cloneUrl, "member"], member);
  const featureLine = `export const feature = "${suffix}";`;
  await gitOk(memberDir, ["checkout", "-b", "feature"]);
  await writeFile(
    path.join(memberDir, "src", "app.ts"),
    `export const app = "forge";\n${featureLine}\n`,
  );
  await mkdir(path.join(memberDir, "docs"), { recursive: true });
  await writeFile(path.join(memberDir, "docs", "notes.md"), "Notes from the member.\n");
  await gitOk(memberDir, ["add", "."]);
  await gitOk(memberDir, ["commit", "-m", "Add feature flag"]);
  await gitOk(memberDir, ["push", "origin", "feature"], member);
  const featureTip = await gitOk(memberDir, ["rev-parse", "HEAD"]);

  await writeFile(path.join(ownerDir, "CHANGELOG.md"), "- main moved on\n");
  await gitOk(ownerDir, ["add", "."]);
  await gitOk(ownerDir, ["commit", "-m", "Add changelog"]);
  await gitOk(ownerDir, ["push", "origin", "main"], admin);
  const mainBeforeMerge = await gitOk(ownerDir, ["rev-parse", "HEAD"]);

  // 3. Member browses the nested tree, opens an issue and a pull request.
  let memberPanel = await openRepository(memberPage, projectName);
  await expect(memberPanel.getByRole("heading", { name: "README.md" })).toBeVisible({
    timeout: 60_000,
  });
  await memberPanel.getByRole("button", { name: "src" }).click();
  await expect(memberPanel.getByRole("link", { name: "app.ts" })).toBeVisible();
  await memberPanel.getByRole("tab", { name: "Commits" }).click();
  await expect(memberPanel.getByText("Add changelog")).toBeVisible();

  await memberPanel.getByRole("tab", { name: "Issues" }).click();
  await memberPanel.getByRole("button", { name: "New issue" }).click();
  const issueTitle = `Crash on start ${suffix}`;
  await memberPanel.getByLabel("Title").fill(issueTitle);
  await memberPanel.getByLabel("Description").fill("Steps: run the app.");
  await memberPanel.getByRole("button", { name: "Submit issue" }).click();
  await expect(memberPanel.getByRole("heading", { name: issueTitle })).toBeVisible();

  await memberPanel.getByRole("button", { name: projectName, exact: true }).last().click();
  await memberPanel.getByRole("tab", { name: "Pull Requests" }).click();
  await memberPanel.getByRole("button", { name: "New pull request" }).click();
  await memberPanel.getByLabel("Compare branch").selectOption("feature");
  const prTitle = `Add feature flag ${suffix}`;
  await memberPanel.getByLabel("Title").fill(prTitle);
  await memberPanel.getByRole("button", { name: "Open pull request" }).click();
  await expect(memberPanel.getByRole("heading", { name: prTitle })).toBeVisible({
    timeout: 60_000,
  });
  const [prEvent] = await relay.query([
    { kinds: [1618], "#a": [`30617:${admin.pubkey}:${projectName}`] },
  ]);
  expect(prEvent?.pubkey).toBe(member.pubkey);
  expect(prEvent?.tags).toContainEqual(["c", featureTip]);
  expect(prEvent?.tags).toContainEqual(["branch-name", "feature"]);
  const [issueEvent] = await relay.query([
    { kinds: [1621], "#a": [`30617:${admin.pubkey}:${projectName}`] },
  ]);
  expect(issueEvent?.pubkey).toBe(member.pubkey);

  // 4. Owner sees real counts, reviews the exact revision diff, comments inline and approves.
  let adminRepo = await openRepository(adminPage, projectName);
  await adminRepo.getByRole("tab", { name: "Pull Requests" }).click();
  await expect(adminRepo.getByRole("tab", { name: "1 open" })).toBeVisible();
  await adminRepo.getByRole("button", { name: new RegExp(prTitle) }).click();
  await adminRepo.getByRole("tab", { name: "Files changed" }).click();
  const addedRow = adminRepo.getByRole("row").filter({ hasText: featureLine });
  await expect(addedRow).toBeVisible({ timeout: 90_000 });
  await expect(adminRepo.getByText("docs/notes.md")).toBeVisible();
  await addedRow.getByRole("button", { name: "Comment on this line" }).click();
  await adminRepo
    .getByRole("textbox", { name: "Inline review comment" })
    .fill("Please document this flag.");
  await adminRepo.getByRole("button", { name: "Add comment" }).click();
  await expect(adminRepo.getByText("Please document this flag.")).toBeVisible();
  await adminRepo.getByRole("button", { name: "Approve" }).click();
  await expect(
    adminRepo.getByText(`1 approvals · 0 change requests on ${featureTip.slice(0, 7)}`),
  ).toBeVisible();
  const reviewEvents = await relay.query([{ kinds: [1], "#e": [prEvent?.id ?? ""] }]);
  const inline = reviewEvents.find((event) => event.tags.some((tag) => tag[0] === "file"));
  expect(inline?.tags).toEqual(
    expect.arrayContaining([
      ["c", featureTip],
      ["file", "src/app.ts"],
      ["side", "new"],
      ["line", "2"],
    ]),
  );
  const approval = reviewEvents.find((event) =>
    event.tags.some((tag) => tag[0] === "t" && tag[1] === "approval"),
  );
  expect(approval?.tags).toContainEqual(["c", featureTip]);
  await adminPage.screenshot({ path: evidence("pr-review-desktop.png"), fullPage: false });

  // 5. Owner merges in the browser: git push first, then the 1631 status.
  await adminRepo.getByRole("button", { name: "Merge", exact: true }).click();
  await adminRepo.getByRole("button", { name: "Merge into main" }).click();
  await expect(adminRepo.getByText(/merged as [0-9a-f]{7}/)).toBeVisible({ timeout: 120_000 });
  const mergedHead = await remoteHead(work, cloneUrl, "main", admin);
  expect(mergedHead).not.toBe(mainBeforeMerge);
  const [mergedStatus] = await relay.query([{ kinds: [1631], "#e": [prEvent?.id ?? ""] }]);
  expect(mergedStatus?.pubkey).toBe(admin.pubkey);
  expect(mergedStatus?.tags).toContainEqual(["merge-commit", mergedHead]);
  const states = await relay.query([{ kinds: [30618], "#d": [projectName] }]);
  const latestState = states.sort((left, right) => right.created_at - left.created_at)[0];
  expect(latestState?.tags).toContainEqual(["refs/heads/main", mergedHead]);
  await gitOk(ownerDir, ["fetch", "origin", "main"], admin);
  const parents = (await gitOk(ownerDir, ["log", "-1", "--format=%P", mergedHead])).split(" ");
  expect(parents.sort()).toEqual([featureTip, mainBeforeMerge].sort());
  await adminPage.setViewportSize({ width: 390, height: 844 });
  await adminPage.screenshot({ path: evidence("pr-merged-mobile.png"), fullPage: false });
  await adminPage.setViewportSize({ width: 1440, height: 900 });

  // The member's client shows the same merged state after reload.
  memberPanel = await openRepository(memberPage, projectName);
  await memberPanel.getByRole("tab", { name: "Pull Requests" }).click();
  await memberPanel.getByRole("tab", { name: /closed/ }).click();
  await expect(memberPanel.getByRole("button", { name: new RegExp(prTitle) })).toContainText(
    "Merged",
  );

  // 6. Protect main (require-patch): direct pushes by anyone are rejected.
  if (!repoEvent) throw new Error("repository announcement missing");
  await relay.publish(
    {
      kind: 30617,
      created_at: Math.max(Math.floor(Date.now() / 1000), repoEvent.created_at + 1),
      content: repoEvent.content,
      tags: [...repoEvent.tags, ["buzz-protect", "refs/heads/main", "push:owner", "require-patch"]],
    },
    admin.secretKey,
  );
  await gitOk(memberDir, ["fetch", "origin", "main"], member);
  await gitOk(memberDir, ["checkout", "-B", "direct", "origin/main"]);
  await writeFile(path.join(memberDir, "direct.txt"), "direct push\n");
  await gitOk(memberDir, ["add", "."]);
  await gitOk(memberDir, ["commit", "-m", "Direct push attempt"]);
  const direct = await git(memberDir, ["push", "origin", "direct:main"], member);
  expect(direct.ok).toBe(false);
  expect(direct.stderr).toMatch(/denied|declined/);
  expect(await remoteHead(work, cloneUrl, "main", admin)).toBe(mergedHead);
  await writeFile(
    path.join(process.env.PROJECTS_EVIDENCE_DIR ?? work, "direct-push-rejection.txt"),
    direct.stderr,
  );

  // A second PR whose browser merge the Relay rejects: the UI reports it with no merged state.
  await gitOk(memberDir, ["checkout", "-b", "feature2", "origin/main"]);
  await writeFile(path.join(memberDir, "src", "second.ts"), "export const second = true;\n");
  await gitOk(memberDir, ["add", "."]);
  await gitOk(memberDir, ["commit", "-m", "Second change"]);
  await gitOk(memberDir, ["push", "origin", "feature2"], member);
  memberPanel = await openRepository(memberPage, projectName);
  await memberPanel.getByRole("tab", { name: "Pull Requests" }).click();
  await memberPanel.getByRole("button", { name: "New pull request" }).click();
  await memberPanel.getByLabel("Compare branch").selectOption("feature2");
  const pr2Title = `Second change ${suffix}`;
  await memberPanel.getByLabel("Title").fill(pr2Title);
  await memberPanel.getByRole("button", { name: "Open pull request" }).click();
  await expect(memberPanel.getByRole("heading", { name: pr2Title })).toBeVisible({
    timeout: 60_000,
  });

  adminRepo = await openRepository(adminPage, projectName);
  await adminRepo.getByRole("tab", { name: "Pull Requests" }).click();
  await adminRepo.getByRole("button", { name: new RegExp(pr2Title) }).click();
  await adminRepo.getByRole("button", { name: "Merge", exact: true }).click();
  await adminRepo.getByRole("button", { name: "Merge into main" }).click();
  const rejection = adminRepo
    .getByRole("alert")
    .filter({ hasText: "The Relay rejected the push to main." });
  await expect(rejection).toBeVisible({ timeout: 120_000 });
  await expect(rejection).toContainText("require-patch");
  await expect(rejection).toContainText("Nothing was merged");
  await expect(adminRepo.getByRole("heading", { name: pr2Title })).toBeVisible();
  await expect(adminRepo.locator("header").filter({ hasText: pr2Title })).toContainText("Open");
  await adminPage.screenshot({ path: evidence("merge-rejected-desktop.png"), fullPage: false });
  await adminPage.setViewportSize({ width: 390, height: 844 });
  await rejection.scrollIntoViewIfNeeded();
  await adminPage.screenshot({ path: evidence("merge-rejected-mobile.png"), fullPage: false });
  expect(await remoteHead(work, cloneUrl, "main", admin)).toBe(mergedHead);
  const pr2 = (
    await relay.query([{ kinds: [1618], "#a": [`30617:${admin.pubkey}:${projectName}`] }])
  ).find((event) => event.tags.some((tag) => tag[0] === "subject" && tag[1] === pr2Title));
  expect(pr2?.pubkey).toBe(member.pubkey);
  const pr2Statuses = pr2 ? await relay.query([{ kinds: [1631], "#e": [pr2.id] }]) : [];
  expect(pr2Statuses).toHaveLength(0);

  await writeFile(
    path.join(process.env.PROJECTS_EVIDENCE_DIR ?? work, "summary.json"),
    JSON.stringify(
      {
        project: `30621:${admin.pubkey}:${projectName}`,
        repository: `30617:${admin.pubkey}:${projectName}`,
        channelId,
        featureTip,
        mainBeforeMerge,
        mergeCommit: mergedHead,
        mergeParents: parents,
        pullRequest: prEvent?.id,
        mergedStatus: mergedStatus?.id,
        protectedPullRequest: pr2?.id ?? null,
        protectedPullRequestMergedStatuses: pr2Statuses.length,
      },
      null,
      2,
    ),
  );
  await adminContext.close();
  await memberContext.close();
});
